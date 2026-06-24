/**
 * SuiBets Full On-Chain End-to-End Test
 *
 * Flows tested:
 *  1. post_offer → accept_offer → instant_settle_bet   (payout inside instant_settle, no claim needed)
 *  2. post_offer → cancel_offer                        (stake refunded)
 *  3. post_parlay → accept_parlay → instant_settle_parlay (payout inside instant_settle)
 *  4. post_offer → accept_offer → queue_settle_bet → claim_settlement
 *  5. post_parlay → accept_parlay → settle_parlay_leg×2 → queue_finalize_parlay → claim_parlay
 *
 * Admin sets dispute_window=0 before tests so claims work immediately, restores after.
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { bcs } from '@mysten/sui/bcs';

const PKG        = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const CONFIG     = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const REGISTRY   = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const ORACLE_CAP = '0x4319c676800594d69680eb4616a0cb345480d839b0ae9909ceb418f7252ace55';
const ADMIN_CAP  = '0xc9480246d7bc717bc6478fff3002de30998b190a46bef310652d3546b6c39e25';
const CLOCK      = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SBETS_TYPE = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const ORIG_WINDOW = 7_200_000n;

const client  = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' });
const toBytes = s => new TextEncoder().encode(s);
const sleep   = ms => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0, results = [];
const ok   = msg => { console.log(`  ✅ ${msg}`); passed++; results.push({ ok: true,  msg }); };
const fail = msg => { console.log(`  ❌ ${msg}`); failed++; results.push({ ok: false, msg }); };
const log  = msg => console.log(`     ${msg}`);

async function sendTx(tx, kp, label) {
  try {
    const built  = await tx.build({ client });
    const signed = await kp.signTransaction(built);
    const resp   = await client.executeTransactionBlock({
      transactionBlock: signed.bytes,
      signature:        signed.signature,
      options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true },
    });
    const status = resp?.effects?.status?.status;
    const digest = resp?.digest ?? '';
    if (status === 'success') {
      ok(label);
      log(`digest: ${digest}`);
      log(`🔗 https://suiscan.xyz/mainnet/tx/${digest}`);
      const sbetstChg = (resp.balanceChanges ?? []).find(c => c.coinType?.includes('sbets') && c.amount > 0);
      if (sbetstChg) log(`SBETS received: ${Number(sbetstChg.amount)/1e9}`);
    } else {
      fail(`${label} — ${resp?.effects?.status?.error ?? 'unknown'}`);
    }
    return { status, digest, changes: resp?.objectChanges ?? [] };
  } catch (e) {
    fail(`${label} — threw: ${e.message?.slice(0,180)}`);
    return { status: 'error', digest: '', changes: [] };
  }
}

const findCreated = (changes, frag) =>
  changes.find(c => c.type === 'created' && c.objectType?.includes(frag));

async function getSbets(addr) {
  return (await client.getCoins({ owner: addr, coinType: SBETS_TYPE })).data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildPostOffer(tx, adminAddr, sbets, stakeAmt, eventId, odds) {
  tx.setSender(adminAddr);
  tx.setGasBudget(20_000_000);
  const primary = tx.object(sbets[0].coinObjectId);
  if (sbets.length > 1) tx.mergeCoins(primary, sbets.slice(1).map(c => tx.object(c.coinObjectId)));
  const [stake] = tx.splitCoins(primary, [stakeAmt]);
  const expires = BigInt(Date.now() + 24 * 3600 * 1000);
  tx.moveCall({
    target: `${PKG}::p2p_betting::post_offer`,
    typeArguments: [SBETS_TYPE],
    arguments: [
      tx.object(CONFIG), tx.object(REGISTRY), stake,
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes(eventId))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('Team A vs Team B'))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
      tx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
      tx.pure.u64(odds),
      tx.pure.u64(BigInt(Date.now() + 24 * 3600 * 1000)),
      tx.object(CLOCK),
    ],
  });
}

function buildPostParlay(tx, adminAddr, sbets, stakeAmt, eventBase, legs) {
  tx.setSender(adminAddr);
  tx.setGasBudget(20_000_000);
  const primary = tx.object(sbets[0].coinObjectId);
  if (sbets.length > 1) tx.mergeCoins(primary, sbets.slice(1).map(c => tx.object(c.coinObjectId)));
  const [stake] = tx.splitCoins(primary, [stakeAmt]);
  const ids    = legs.map((_,i) => toBytes(`${eventBase}_E${i+1}`));
  const names  = legs.map((_,i) => toBytes(`Match ${eventBase} ${i+1}`));
  const preds  = legs.map(l => toBytes(l.pred));
  const odds   = legs.map(l => l.odds);
  const total  = odds.reduce((a,b)=> a*b/10000n, 10000n);
  tx.moveCall({
    target: `${PKG}::p2p_betting::post_parlay`,
    typeArguments: [SBETS_TYPE],
    arguments: [
      tx.object(CONFIG), tx.object(REGISTRY), stake,
      tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(ids)),
      tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(names)),
      tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(preds)),
      tx.pure(bcs.vector(bcs.u64()).serialize(odds)),
      tx.pure.u64(total),
      tx.pure.u64(BigInt(Date.now() + 24 * 3600 * 1000)),
      tx.object(CLOCK),
    ],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('   SuiBets — Full On-Chain End-to-End Test (Final)   ');
  console.log('══════════════════════════════════════════════════════\n');

  // Load admin
  const privKey = process.env.ADMIN_PRIVATE_KEY;
  if (!privKey) { console.error('No ADMIN_PRIVATE_KEY'); process.exit(1); }
  let adminKP;
  if (privKey.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(privKey);
    adminKP = Ed25519Keypair.fromSecretKey(secretKey);
  } else {
    adminKP = Ed25519Keypair.fromSecretKey(Buffer.from(privKey, 'base64'));
  }
  const adminAddr = adminKP.getPublicKey().toSuiAddress();
  const takerKP   = new Ed25519Keypair();
  const takerAddr = takerKP.getPublicKey().toSuiAddress();

  let sbets = await getSbets(adminAddr);
  console.log(`Admin : ${adminAddr}`);
  console.log(`Taker : ${takerAddr} (ephemeral)`);
  console.log(`SBETS : ${Number(sbets.reduce((s,c)=>s+BigInt(c.balance),0n))/1e9}\n`);

  // ══ Set dispute_window = 0 for immediate claiming ════════════════════════════
  console.log('══ Admin: dispute_window → 0ms ══');
  {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(10_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::set_dispute_window`,
      arguments: [tx.object(ADMIN_CAP), tx.object(CONFIG), tx.pure.u64(0n), tx.object(CLOCK)],
    });
    await sendTx(tx, adminKP, 'set_dispute_window → 0ms');
  }
  await sleep(2000);

  // ══ Fund taker: 0.08 SUI (gas) + 280 SBETS (stakes) ════════════════════════
  console.log('\n══ Fund taker wallet ══');
  sbets = await getSbets(adminAddr);
  {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(10_000_000);
    const [suiOut] = tx.splitCoins(tx.gas, [80_000_000n]);
    tx.transferObjects([suiOut], takerAddr);
    await sendTx(tx, adminKP, '0.08 SUI → taker');
  }
  await sleep(2000);
  sbets = await getSbets(adminAddr);
  {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(10_000_000);
    const primary = tx.object(sbets[0].coinObjectId);
    if (sbets.length > 1) tx.mergeCoins(primary, sbets.slice(1).map(c => tx.object(c.coinObjectId)));
    const [out] = tx.splitCoins(primary, [280_000_000_000n]);
    tx.transferObjects([out], takerAddr);
    await sendTx(tx, adminKP, '280 SBETS → taker');
  }
  await sleep(2500);

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: post_offer → accept_offer → instant_settle_bet
  //   instant_settle_bet pays out in the same tx — no separate claim needed
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══ TEST 1: post_offer → accept_offer → instant_settle_bet ══');
  let offerObjId1 = '', matchedBet1 = '';

  sbets = await getSbets(adminAddr);
  {
    const tx = new Transaction();
    buildPostOffer(tx, adminAddr, sbets, 100_000_000_000n, 'T1_OFFER_001', 20_000n);
    const r = await sendTx(tx, adminKP, 'post_offer — 100 SBETS @ 2.0x');
    offerObjId1 = findCreated(r.changes, 'P2POffer')?.objectId ?? '';
    if (offerObjId1) log(`P2POffer: ${offerObjId1}`);
  }
  await sleep(3000);

  if (offerObjId1) {
    const takerSbets = await getSbets(takerAddr);
    const tx = new Transaction();
    tx.setSender(takerAddr);
    tx.setGasBudget(20_000_000);
    const primary = tx.object(takerSbets[0].coinObjectId);
    if (takerSbets.length > 1) tx.mergeCoins(primary, takerSbets.slice(1).map(c => tx.object(c.coinObjectId)));
    const [stake] = tx.splitCoins(primary, [100_000_000_000n]);
    tx.moveCall({
      target: `${PKG}::p2p_betting::accept_offer`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(CONFIG), tx.object(REGISTRY), tx.object(offerObjId1),
                  stake, tx.pure.u64(100_000_000_000n), tx.object(CLOCK)],
    });
    const r = await sendTx(tx, takerKP, 'accept_offer — taker stakes 100 SBETS');
    matchedBet1 = findCreated(r.changes, 'P2PMatchedBet')?.objectId ?? '';
    if (matchedBet1) log(`P2PMatchedBet: ${matchedBet1}`);
  }
  await sleep(3000);

  if (matchedBet1) {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(20_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::instant_settle_bet`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(ORACLE_CAP), tx.object(CONFIG), tx.object(REGISTRY),
                  tx.object(matchedBet1), tx.pure.bool(true), tx.object(CLOCK)],
    });
    const r = await sendTx(tx, adminKP, 'instant_settle_bet — maker wins (payout in same tx)');
    if (r.status === 'success') log('✓ Payout transferred inside instant_settle_bet');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: post_offer → cancel_offer
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══ TEST 2: post_offer → cancel_offer ══');
  await sleep(2000);
  sbets = await getSbets(adminAddr);
  let cancelObjId = '';

  {
    const tx = new Transaction();
    buildPostOffer(tx, adminAddr, sbets, 50_000_000_000n, 'T2_CANCEL_001', 15_000n);
    const r = await sendTx(tx, adminKP, 'post_offer — 50 SBETS @ 1.5x (to cancel)');
    cancelObjId = findCreated(r.changes, 'P2POffer')?.objectId ?? '';
    if (cancelObjId) log(`P2POffer: ${cancelObjId}`);
  }
  await sleep(3000);

  if (cancelObjId) {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(20_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::cancel_offer`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(cancelObjId), tx.object(REGISTRY), tx.object(CLOCK)],
    });
    await sendTx(tx, adminKP, 'cancel_offer — 50 SBETS returned to maker');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: post_parlay → accept_parlay → instant_settle_parlay
  //   payout occurs inside instant_settle_parlay — no separate claim needed
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══ TEST 3: post_parlay → accept_parlay → instant_settle_parlay ══');
  await sleep(2000);
  sbets = await getSbets(adminAddr);
  let parlay3 = '';

  {
    const tx = new Transaction();
    const legs = [{ pred:'home', odds:15_000n }, { pred:'away', odds:15_000n }];
    buildPostParlay(tx, adminAddr, sbets, 50_000_000_000n, 'T3_INSTANT', legs);
    const r = await sendTx(tx, adminKP, 'post_parlay — 50 SBETS, 2 legs @ 2.25x');
    parlay3 = findCreated(r.changes, 'P2PParlay')?.objectId ?? '';
    if (parlay3) log(`P2PParlay: ${parlay3}`);
  }
  await sleep(3000);

  if (parlay3) {
    const obj = await client.getObject({ id: parlay3, options: { showContent: true } });
    const takerReq = BigInt(obj?.data?.content?.fields?.taker_required ?? 62_500_000_000n);
    log(`taker_required: ${Number(takerReq)/1e9} SBETS`);

    const takerSbets = await getSbets(takerAddr);
    const tx = new Transaction();
    tx.setSender(takerAddr);
    tx.setGasBudget(20_000_000);
    const primary = tx.object(takerSbets[0].coinObjectId);
    if (takerSbets.length > 1) tx.mergeCoins(primary, takerSbets.slice(1).map(c => tx.object(c.coinObjectId)));
    const [stake] = tx.splitCoins(primary, [takerReq]);
    tx.moveCall({
      target: `${PKG}::p2p_betting::accept_parlay`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(CONFIG), tx.object(parlay3), stake, tx.object(CLOCK)],
    });
    await sendTx(tx, takerKP, `accept_parlay — taker stakes ${Number(takerReq)/1e9} SBETS`);
  }
  await sleep(3000);

  if (parlay3) {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(20_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::instant_settle_parlay`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(ORACLE_CAP), tx.object(CONFIG), tx.object(REGISTRY),
                  tx.object(parlay3), tx.pure.bool(true), tx.object(CLOCK)],
    });
    const r = await sendTx(tx, adminKP, 'instant_settle_parlay — maker wins (payout in same tx)');
    if (r.status === 'success') log('✓ Payout transferred inside instant_settle_parlay');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: post_offer → accept_offer → queue_settle_bet → claim_settlement
  //   queue_settle_bet sets pending winner; claim_settlement pays out after dispute window
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══ TEST 4: post_offer → accept_offer → queue_settle_bet → claim_settlement ══');
  await sleep(2000);
  sbets = await getSbets(adminAddr);
  let offerObjId4 = '', matchedBet4 = '';

  {
    const tx = new Transaction();
    buildPostOffer(tx, adminAddr, sbets, 50_000_000_000n, 'T4_QUEUE_001', 20_000n);
    const r = await sendTx(tx, adminKP, 'post_offer — 50 SBETS @ 2.0x');
    offerObjId4 = findCreated(r.changes, 'P2POffer')?.objectId ?? '';
    if (offerObjId4) log(`P2POffer: ${offerObjId4}`);
  }
  await sleep(3000);

  if (offerObjId4) {
    const takerSbets = await getSbets(takerAddr);
    const tx = new Transaction();
    tx.setSender(takerAddr);
    tx.setGasBudget(20_000_000);
    const primary = tx.object(takerSbets[0].coinObjectId);
    if (takerSbets.length > 1) tx.mergeCoins(primary, takerSbets.slice(1).map(c => tx.object(c.coinObjectId)));
    const [stake] = tx.splitCoins(primary, [50_000_000_000n]);
    tx.moveCall({
      target: `${PKG}::p2p_betting::accept_offer`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(CONFIG), tx.object(REGISTRY), tx.object(offerObjId4),
                  stake, tx.pure.u64(50_000_000_000n), tx.object(CLOCK)],
    });
    const r = await sendTx(tx, takerKP, 'accept_offer — taker stakes 50 SBETS');
    matchedBet4 = findCreated(r.changes, 'P2PMatchedBet')?.objectId ?? '';
    if (matchedBet4) log(`P2PMatchedBet: ${matchedBet4}`);
  }
  await sleep(3000);

  if (matchedBet4) {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(20_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::queue_settle_bet`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(ORACLE_CAP), tx.object(CONFIG),
                  tx.object(matchedBet4), tx.pure.bool(true), tx.object(CLOCK)],
    });
    await sendTx(tx, adminKP, 'queue_settle_bet — maker_wins=true (queued, dispute_window=0)');
  }
  await sleep(3000);

  if (matchedBet4) {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(20_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::claim_settlement`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(CONFIG), tx.object(REGISTRY), tx.object(matchedBet4), tx.object(CLOCK)],
    });
    await sendTx(tx, adminKP, 'claim_settlement — maker claims 98 SBETS payout');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 5: post_parlay → accept_parlay → settle_parlay_leg×2 → queue_finalize_parlay → claim_parlay
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n══ TEST 5: post_parlay → accept_parlay → settle_parlay_leg×2 → queue_finalize_parlay → claim_parlay ══');
  await sleep(2000);
  sbets = await getSbets(adminAddr);
  let parlay5 = '';

  {
    const tx = new Transaction();
    const legs = [{ pred:'home', odds:15_000n }, { pred:'away', odds:15_000n }];
    buildPostParlay(tx, adminAddr, sbets, 30_000_000_000n, 'T5_QUEUE', legs);
    const r = await sendTx(tx, adminKP, 'post_parlay — 30 SBETS, 2 legs @ 2.25x');
    parlay5 = findCreated(r.changes, 'P2PParlay')?.objectId ?? '';
    if (parlay5) log(`P2PParlay: ${parlay5}`);
  }
  await sleep(3000);

  if (parlay5) {
    const obj = await client.getObject({ id: parlay5, options: { showContent: true } });
    const takerReq = BigInt(obj?.data?.content?.fields?.taker_required ?? 37_500_000_000n);
    log(`taker_required: ${Number(takerReq)/1e9} SBETS`);

    const takerSbets = await getSbets(takerAddr);
    const tx = new Transaction();
    tx.setSender(takerAddr);
    tx.setGasBudget(20_000_000);
    const primary = tx.object(takerSbets[0].coinObjectId);
    if (takerSbets.length > 1) tx.mergeCoins(primary, takerSbets.slice(1).map(c => tx.object(c.coinObjectId)));
    const [stake] = tx.splitCoins(primary, [takerReq]);
    tx.moveCall({
      target: `${PKG}::p2p_betting::accept_parlay`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(CONFIG), tx.object(parlay5), stake, tx.object(CLOCK)],
    });
    await sendTx(tx, takerKP, `accept_parlay — taker stakes ${Number(takerReq)/1e9} SBETS`);
  }
  await sleep(3000);

  // settle_parlay_leg for each leg (maker wins leg 0 and leg 1)
  if (parlay5) {
    for (const legIdx of [0n, 1n]) {
      const tx = new Transaction();
      tx.setSender(adminAddr);
      tx.setGasBudget(20_000_000);
      tx.moveCall({
        target: `${PKG}::p2p_betting::settle_parlay_leg`,
        typeArguments: [SBETS_TYPE],
        arguments: [tx.object(ORACLE_CAP), tx.object(parlay5),
                    tx.pure.u64(legIdx), tx.pure.bool(true), tx.object(CLOCK)],
      });
      await sendTx(tx, adminKP, `settle_parlay_leg — leg ${legIdx} maker wins`);
      await sleep(2000);
    }
  }

  if (parlay5) {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(20_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::queue_finalize_parlay`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(ORACLE_CAP), tx.object(CONFIG), tx.object(parlay5), tx.object(CLOCK)],
    });
    await sendTx(tx, adminKP, 'queue_finalize_parlay — queues payout (dispute_window=0)');
  }
  await sleep(3000);

  if (parlay5) {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(20_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::claim_parlay`,
      typeArguments: [SBETS_TYPE],
      arguments: [tx.object(CONFIG), tx.object(REGISTRY), tx.object(parlay5), tx.object(CLOCK)],
    });
    await sendTx(tx, adminKP, 'claim_parlay — maker claims ~65 SBETS payout');
  }

  // ══ Restore dispute_window = 2 hours ═════════════════════════════════════════
  console.log('\n══ Admin: Restore dispute_window → 7,200,000ms (2 hours) ══');
  // Retry up to 3 times — object version can be stale after many back-to-back txs
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(3000 * attempt); // progressive backoff
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(10_000_000);
    tx.moveCall({
      target: `${PKG}::p2p_betting::set_dispute_window`,
      arguments: [tx.object(ADMIN_CAP), tx.object(CONFIG), tx.pure.u64(ORIG_WINDOW), tx.object(CLOCK)],
    });
    const r = await sendTx(tx, adminKP, `set_dispute_window → 7,200,000ms (attempt ${attempt})`);
    if (r.status === 'success') break;
    if (attempt === 3) fail('Could not restore dispute_window after 3 attempts — please run manually');
    // Remove the failed result so we can re-try cleanly
    results.pop(); failed--;
    console.log(`     retrying (attempt ${attempt+1})...`);
  }

  // ══ Summary ══════════════════════════════════════════════════════════════════
  const finalSbets = (await getSbets(adminAddr)).reduce((s,c)=>s+BigInt(c.balance),0n);
  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed  /  ${passed+failed} total  (${failed} failed)`);
  console.log('══════════════════════════════════════════════════════');
  for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'} ${r.msg}`);
  console.log(`\n  Admin SBETS balance after test: ${Number(finalSbets)/1e9}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
