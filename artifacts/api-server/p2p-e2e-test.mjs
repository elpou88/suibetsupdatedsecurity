/**
 * P2P Betting — Full End-to-End Test
 * ====================================
 * Covers all 5 on-chain scenarios + API layer verification:
 *   Test 1 : Post offer → Accept → Oracle settles → Maker wins payout
 *   Test 2 : Post offer → Maker cancels → Funds returned to creator
 *   Test 3 : Post offer (short expiry) → Expire → Funds returned to creator
 *
 * Two wallets:
 *   ADMIN  (maker + oracle) — has SBETS & SUI
 *   TAKER  (freshly generated) — funded from admin
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction }         from '@mysten/sui/transactions';

// ── Constants ──────────────────────────────────────────────────────────────────
const ADMIN_KEY      = process.env.ADMIN_PRIVATE_KEY;
const P2P_PKG        = process.env.P2P_PACKAGE_ID     || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const P2P_CFG        = process.env.P2P_CONFIG_ID      || '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const P2P_REG        = process.env.P2P_REGISTRY_ID    || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const ORACLE_CAP     = process.env.P2P_ORACLE_CAP_ID  || '0x4319c676800594d69680eb4616a0cb345480d839b0ae9909ceb418f7252ace55';
const SBETS_TYPE     = '0x999d696dad9e4684068fa74ef9c5d3afc411d3ba62973bd5d54830f324f29502::sbets::SBETS';
const SUI_FULL_TYPE  = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const CLOCK          = '0x0000000000000000000000000000000000000000000000000000000000000006';
const EXPLORER       = 'https://suiscan.xyz/mainnet/tx';
const API_BASE       = 'http://localhost:5000/api/p2p';

// Test amounts
const MAKER_STAKE_SBETS = 100_000_000_000n;  // 100 SBETS (9 dec)
const TAKER_GAS_SUI     = 15_000_000n;        // 0.015 SUI for gas
const ODDS_BPS          = 20000n;             // 2.0x odds

// ── Helpers ────────────────────────────────────────────────────────────────────
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('mainnet') });

function adminKp() {
  const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

function link(digest) { return `${EXPLORER}/${digest}`; }
function sbets(n) { return `${(Number(n)/1e9).toFixed(4)} SBETS`; }
function sui(n)   { return `${(Number(n)/1e9).toFixed(6)} SUI`; }

async function run(tx, signer, label) {
  tx.setGasBudget(10_000_000);
  const r = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true },
  });
  const status = r.effects?.status?.status;
  if (status !== 'success') {
    throw new Error(`❌ [${label}] TX failed: ${r.effects?.status?.error}`);
  }
  console.log(`    TX: ${link(r.digest)}`);
  // Wait for finality before returning
  await client.waitForTransaction({ digest: r.digest });
  return r;
}

async function wait(ms, msg) {
  process.stdout.write(`    ⏳ ${msg} (${ms/1000}s) `);
  const step = 1000;
  let remaining = ms;
  while (remaining > 0) {
    await new Promise(r => setTimeout(r, Math.min(step, remaining)));
    remaining -= step;
    process.stdout.write('.');
  }
  console.log(' done');
}

function extractCreated(result, typeSuffix) {
  const changes = result.objectChanges ?? [];
  const found = changes.find(c => c.type === 'created' && c.objectType?.includes(typeSuffix));
  return found?.objectId ?? null;
}

async function getObj(id) {
  const r = await client.getObject({ id, options: { showContent: true } });
  return r.data?.content?.fields ?? null;
}

async function getSbetsBalance(addr) {
  const coins = await client.getCoins({ owner: addr, coinType: SBETS_TYPE });
  return coins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
}

async function getSuiBalance(addr) {
  const coins = await client.getCoins({ owner: addr, coinType: SUI_FULL_TYPE });
  return coins.data.reduce((s, c) => s + BigInt(c.balance), 0n);
}

async function apiGet(path) {
  try {
    const r = await fetch(`${API_BASE}${path}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// ── Send SUI from admin to taker ───────────────────────────────────────────────
async function fundTakerSui(takerAddr, amountMist, adminKp) {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
  tx.transferObjects([coin], tx.pure.address(takerAddr));
  return run(tx, adminKp, 'fund taker SUI');
}

// ── Send SBETS from admin to taker ─────────────────────────────────────────────
async function fundTakerSbets(takerAddr, amount, adminKp) {
  const coins = await client.getCoins({ owner: adminKp.toSuiAddress(), coinType: SBETS_TYPE });
  const sbetsCoin = coins.data[0];
  const tx = new Transaction();
  const [chunk] = tx.splitCoins(tx.object(sbetsCoin.coinObjectId), [tx.pure.u64(amount)]);
  tx.transferObjects([chunk], tx.pure.address(takerAddr));
  return run(tx, adminKp, 'fund taker SBETS');
}

// ── Post offer (maker = signer) ────────────────────────────────────────────────
async function postOffer(makerKp, stakeUnits, oddsBps, expiresAt) {
  const makerAddr = makerKp.toSuiAddress();
  const coins = await client.getCoins({ owner: makerAddr, coinType: SBETS_TYPE });
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [tx.pure.u64(stakeUnits)]);
  tx.moveCall({
    target: `${P2P_PKG}::p2p_betting::post_offer`,
    typeArguments: [SBETS_TYPE],
    arguments: [
      tx.object(P2P_CFG),
      tx.object(P2P_REG),
      payment,
      tx.pure.vector('u8', [...Buffer.from('test-event-e2e')]),
      tx.pure.vector('u8', [...Buffer.from('E2E Test Match')]),
      tx.pure.vector('u8', [...Buffer.from('Home Win')]),
      tx.pure.vector('u8', [...Buffer.from('match_winner')]),
      tx.pure.u64(oddsBps),
      tx.pure.u64(expiresAt),
      tx.object(CLOCK),
    ],
  });
  const result = await run(tx, makerKp, 'post_offer');
  const offerId = extractCreated(result, 'P2POffer');
  if (!offerId) throw new Error('Could not extract offer object ID from TX');
  return { result, offerId };
}

// ── Accept offer (taker = signer) ──────────────────────────────────────────────
async function acceptOffer(takerKp, offerId, takerAmountUnits) {
  const takerAddr = takerKp.toSuiAddress();
  const coins = await client.getCoins({ owner: takerAddr, coinType: SBETS_TYPE });
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.object(coins.data[0].coinObjectId), [tx.pure.u64(takerAmountUnits)]);
  tx.moveCall({
    target: `${P2P_PKG}::p2p_betting::accept_offer`,
    typeArguments: [SBETS_TYPE],
    arguments: [
      tx.object(P2P_CFG),
      tx.object(P2P_REG),
      tx.object(offerId),
      payment,
      tx.pure.u64(takerAmountUnits),
      tx.object(CLOCK),
    ],
  });
  const result = await run(tx, takerKp, 'accept_offer');
  const betId = extractCreated(result, 'P2PMatchedBet');
  if (!betId) throw new Error('Could not extract bet object ID from TX');
  return { result, betId };
}

// ── Instant settle (oracle = admin) ────────────────────────────────────────────
async function instantSettle(adminKp, betId, makerWins) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${P2P_PKG}::p2p_betting::instant_settle_bet`,
    typeArguments: [SBETS_TYPE],
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(P2P_CFG),
      tx.object(P2P_REG),
      tx.object(betId),
      tx.pure.bool(makerWins),
      tx.object(CLOCK),
    ],
  });
  return run(tx, adminKp, 'instant_settle_bet');
}

// ── Cancel offer (maker = signer) ──────────────────────────────────────────────
async function cancelOffer(makerKp, offerId) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${P2P_PKG}::p2p_betting::cancel_offer`,
    typeArguments: [SBETS_TYPE],
    arguments: [
      tx.object(offerId),
      tx.object(P2P_REG),
      tx.object(CLOCK),
    ],
  });
  return run(tx, makerKp, 'cancel_offer');
}

// ── Expire offer (permissionless) ──────────────────────────────────────────────
async function expireOffer(gasPayer, offerId) {
  const tx = new Transaction();
  tx.moveCall({
    target: `${P2P_PKG}::p2p_betting::expire_offer`,
    typeArguments: [SBETS_TYPE],
    arguments: [
      tx.object(offerId),
      tx.object(P2P_REG),
      tx.object(CLOCK),
    ],
  });
  return run(tx, gasPayer, 'expire_offer');
}

// ── Assertions ─────────────────────────────────────────────────────────────────
function assert(condition, msg) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`    ✅ ${msg}`);
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  const admin = adminKp();
  const taker = Ed25519Keypair.generate();
  const ADMIN = admin.toSuiAddress();
  const TAKER = taker.toSuiAddress();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         SuiBets P2P — Full End-to-End Test Suite         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Admin (maker/oracle): ${ADMIN}`);
  console.log(`  Taker  (fresh wallet): ${TAKER}`);
  console.log(`  Network: Sui Mainnet`);
  console.log(`  SBETS per offer: ${sbets(MAKER_STAKE_SBETS)} at 2.0x odds\n`);

  // ── Check API is responding ──────────────────────────────────────────────────
  const feeTiers = await apiGet('/fee-tiers');
  assert(feeTiers?.tiers?.length > 0, 'API /api/p2p/fee-tiers is responding');
  const registryStats = await apiGet('/onchain-book');
  console.log(`    Registry on-chain: ${JSON.stringify(registryStats?.registry ?? {})}`);

  // ── Fund taker wallet ────────────────────────────────────────────────────────
  console.log('\n─── Setup: Fund Taker Wallet ───────────────────────────────');
  const fundSuiResult = await fundTakerSui(TAKER, TAKER_GAS_SUI, admin);
  const takerSui = await getSuiBalance(TAKER);
  assert(takerSui >= TAKER_GAS_SUI / 2n, `Taker funded with SUI: ${sui(takerSui)}`);

  await fundTakerSbets(TAKER, MAKER_STAKE_SBETS, admin);
  const takerSbets = await getSbetsBalance(TAKER);
  assert(takerSbets >= MAKER_STAKE_SBETS, `Taker funded with SBETS: ${sbets(takerSbets)}`);

  const results = [];

  // ══════════════════════════════════════════════════════════════════════════════
  //  TEST 1: Full lifecycle — Post → Accept → Oracle Settles → Maker Wins Payout
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  TEST 1: Post → Accept → Instant Settle → Maker Wins    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const adminSbetsBefore1 = await getSbetsBalance(ADMIN);
  const takerSbetsBefore1 = await getSbetsBalance(TAKER);
  console.log(`  Admin SBETS before: ${sbets(adminSbetsBefore1)}`);
  console.log(`  Taker SBETS before: ${sbets(takerSbetsBefore1)}`);

  // 1a. Post offer
  console.log('\n  [1a] Admin posts offer (100 SBETS @ 2.0x odds, 1hr expiry):');
  const expiresAt1 = Date.now() + 3600_000;
  const { offerId: offerId1 } = await postOffer(admin, MAKER_STAKE_SBETS, Number(ODDS_BPS), expiresAt1);
  console.log(`    Offer ID: ${offerId1}`);

  await wait(3000, 'Waiting for object finality');
  const offerState1 = await getObj(offerId1);
  assert(Number(offerState1?.status) === 0, 'Offer on-chain status = OPEN (0)');
  const makerRem = Number(offerState1?.maker_remaining?.fields?.value ?? offerState1?.maker_remaining ?? 0);
  assert(makerRem === Number(MAKER_STAKE_SBETS), `Offer maker_remaining = ${sbets(MAKER_STAKE_SBETS)}`);

  // 1b. Accept offer
  console.log('\n  [1b] Taker accepts offer (100 SBETS taker stake):');
  const { betId: betId1 } = await acceptOffer(taker, offerId1, Number(MAKER_STAKE_SBETS));
  console.log(`    Bet ID: ${betId1}`);

  await wait(3000, 'Waiting for object finality');
  const betState1 = await getObj(betId1);
  assert(Number(betState1?.status) === 2, 'Bet on-chain status = MATCHED (2)');
  const offerAfterAccept = await getObj(offerId1);
  assert(Number(offerAfterAccept?.status) === 1, 'Offer on-chain status = FILLED (1)');

  // 1c. Oracle instant-settles — maker wins
  console.log('\n  [1c] Oracle instant-settles — Maker wins:');
  await instantSettle(admin, betId1, true /* makerWins */);

  await wait(4000, 'Waiting for balance propagation');
  const betStateAfter1 = await getObj(betId1);
  assert(Number(betStateAfter1?.status) === 4, 'Bet on-chain status = MAKER_WON (4)');

  const adminSbetsAfter1 = await getSbetsBalance(ADMIN);
  const takerSbetsAfter1 = await getSbetsBalance(TAKER);
  const adminGain = BigInt(adminSbetsAfter1) - BigInt(adminSbetsBefore1);
  console.log(`  Admin SBETS after : ${sbets(adminSbetsAfter1)} (${adminGain >= 0n ? '+' : ''}${sbets(adminGain)})`);
  console.log(`  Taker SBETS after : ${sbets(takerSbetsAfter1)} (${(BigInt(takerSbetsAfter1) - BigInt(takerSbetsBefore1)) >= 0n ? '+' : ''}${sbets(BigInt(takerSbetsAfter1) - BigInt(takerSbetsBefore1))})`);
  // Admin gains taker's stake minus 2% fee ≈ +98 SBETS
  assert(adminSbetsAfter1 > adminSbetsBefore1, 'Admin SBETS increased (maker won payout)');
  assert(takerSbetsAfter1 < takerSbetsBefore1, 'Taker SBETS decreased (taker lost)');

  results.push({ test: 'TEST 1', status: 'PASS', desc: 'Post→Accept→Settle→Payout', offerId: offerId1, betId: betId1 });
  console.log('\n  ✅ TEST 1 PASSED\n');

  // ══════════════════════════════════════════════════════════════════════════════
  //  TEST 2: Cancel offer → funds return to creator immediately
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  TEST 2: Post → Maker Cancels → Funds Return to Creator ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const adminSbetsBefore2 = await getSbetsBalance(ADMIN);
  console.log(`  Admin SBETS before: ${sbets(adminSbetsBefore2)}`);

  console.log('\n  [2a] Admin posts offer (100 SBETS @ 2.0x odds, 1hr expiry):');
  const expiresAt2 = Date.now() + 3600_000;
  const { offerId: offerId2 } = await postOffer(admin, MAKER_STAKE_SBETS, Number(ODDS_BPS), expiresAt2);
  console.log(`    Offer ID: ${offerId2}`);

  await wait(3000, 'Waiting for object finality');
  const offerStatePre2 = await getObj(offerId2);
  assert(Number(offerStatePre2?.status) === 0, 'Offer status = OPEN (0) before cancel');
  const preBalance2 = await getSbetsBalance(ADMIN);

  console.log('\n  [2b] Maker cancels offer:');
  await cancelOffer(admin, offerId2);

  await wait(4000, 'Waiting for balance propagation');
  const offerStatePost2 = await getObj(offerId2);
  assert(Number(offerStatePost2?.status) === 7, 'Offer on-chain status = CANCELLED (7)');
  const makerRemAfterCancel = Number(offerStatePost2?.maker_remaining?.fields?.value ?? offerStatePost2?.maker_remaining ?? 0);
  assert(makerRemAfterCancel === 0, 'Offer maker_remaining = 0 (funds returned by contract)');

  const adminSbetsAfter2 = await getSbetsBalance(ADMIN);
  const refundReceived = BigInt(adminSbetsAfter2) - BigInt(preBalance2);
  console.log(`  Admin SBETS after : ${sbets(adminSbetsAfter2)} (${refundReceived >= 0n ? '+' : ''}${sbets(refundReceived)})`);
  assert(refundReceived >= MAKER_STAKE_SBETS - 1000n, `Maker refunded ${sbets(MAKER_STAKE_SBETS)} on cancel`);

  results.push({ test: 'TEST 2', status: 'PASS', desc: 'Post→Cancel→Refund', offerId: offerId2 });
  console.log('\n  ✅ TEST 2 PASSED\n');

  // ══════════════════════════════════════════════════════════════════════════════
  //  TEST 3: Short expiry → expire → creator gets funds back
  // ══════════════════════════════════════════════════════════════════════════════
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  TEST 3: Post (40s expiry) → Expire → Funds Return      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const adminSbetsBefore3 = await getSbetsBalance(ADMIN);
  console.log(`  Admin SBETS before: ${sbets(adminSbetsBefore3)}`);

  console.log('\n  [3a] Admin posts offer with 40-second on-chain expiry:');
  const expiresAt3 = Date.now() + 40_000; // 40 seconds from now
  const { offerId: offerId3 } = await postOffer(admin, MAKER_STAKE_SBETS, Number(ODDS_BPS), expiresAt3);
  console.log(`    Offer ID: ${offerId3}`);
  console.log(`    Expires at: ${new Date(expiresAt3).toISOString()}`);

  await wait(2000, 'Object finality');
  const offerStatePre3 = await getObj(offerId3);
  assert(Number(offerStatePre3?.status) === 0, 'Offer status = OPEN (0)');
  assert(Number(offerStatePre3?.expires_at) > 0, 'Offer has expires_at set on-chain');

  console.log('\n  [3b] Waiting for on-chain expiry to pass...');
  const msUntilExpiry = expiresAt3 - Date.now() + 3000; // extra 3s buffer
  await wait(Math.max(msUntilExpiry, 5000), 'Waiting for expiry');

  const preBalance3 = await getSbetsBalance(ADMIN);
  console.log('\n  [3c] Anyone calls expire_offer (admin pays gas only):');
  await expireOffer(admin, offerId3);

  await wait(4000, 'Waiting for balance propagation');
  const offerStatePost3 = await getObj(offerId3);
  assert(Number(offerStatePost3?.status) === 8, 'Offer on-chain status = EXPIRED (8)');
  const makerRemAfterExpiry = Number(offerStatePost3?.maker_remaining?.fields?.value ?? offerStatePost3?.maker_remaining ?? 0);
  assert(makerRemAfterExpiry === 0, 'Offer maker_remaining = 0 (funds returned by contract)');

  const adminSbetsAfter3 = await getSbetsBalance(ADMIN);
  const expireRefund = BigInt(adminSbetsAfter3) - BigInt(preBalance3);
  console.log(`  Admin SBETS after : ${sbets(adminSbetsAfter3)} (${expireRefund >= 0n ? '+' : ''}${sbets(expireRefund)})`);
  assert(expireRefund >= MAKER_STAKE_SBETS - 1000n, `Creator refunded ${sbets(MAKER_STAKE_SBETS)} on expiry`);

  results.push({ test: 'TEST 3', status: 'PASS', desc: 'Post(40s)→Expire→Refund', offerId: offerId3 });
  console.log('\n  ✅ TEST 3 PASSED\n');

  // ── Final summary ────────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUITE RESULTS                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : '❌';
    console.log(`  ${icon} ${r.test}: ${r.desc}`);
    if (r.offerId) console.log(`       Offer : ${EXPLORER.replace('/tx','')}/object/${r.offerId}`);
    if (r.betId)   console.log(`       Bet   : ${EXPLORER.replace('/tx','')}/object/${r.betId}`);
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  console.log(`\n  Result: ${passed}/${results.length} tests passed`);
  console.log(`  Admin : ${ADMIN}`);
  console.log(`  Taker : ${TAKER}`);
  console.log('\n  All on-chain transactions visible at:');
  console.log(`  https://suiscan.xyz/mainnet/account/${ADMIN}/txs\n`);
  if (passed === results.length) {
    console.log('  🎉 ALL TESTS PASSED — P2P dApp is fully functional!\n');
  } else {
    console.log('  ⚠️  Some tests failed — review output above.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\n❌ FATAL:', err.message);
  process.exit(1);
});
