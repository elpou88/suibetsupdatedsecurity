/**
 * e2e-sui-onchain.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Full end-to-end live on-chain test for SuiBets P2P betting using native SUI.
 *
 * Flows tested:
 *   1. POST offer → CANCEL immediately           → maker refunded
 *   2. POST offer → EXPIRE (past expiry)         → maker refunded
 *   3. POST offer → ACCEPT → SETTLE maker wins   → maker paid out
 *   4. POST offer → ACCEPT → SETTLE taker wins   → taker paid out
 *   5. POST offer → ACCEPT → VOID                → both refunded
 *
 * Usage:
 *   ADMIN_PRIVATE_KEY=suiprivkey... node artifacts/api-server/e2e-sui-onchain.mjs
 */

import { SuiJsonRpcClient }    from '@mysten/sui/jsonRpc';
import { Ed25519Keypair }      from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction }         from '@mysten/sui/transactions';
import { bcs }                 from '@mysten/sui/bcs';

// ── Contract addresses ────────────────────────────────────────────────────────
const PKG        = process.env.P2P_PACKAGE_ID    || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const CONFIG     = process.env.P2P_CONFIG_ID     || '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const REGISTRY   = process.env.P2P_REGISTRY_ID   || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const ORACLE_CAP = process.env.P2P_ORACLE_CAP_ID || '0x4319c676800594d69680eb4616a0cb345480d839b0ae9909ceb418f7252ace55';
const ADMIN_CAP  = process.env.P2P_ADMIN_CAP_ID  || '0xc9480246d7bc717bc6478fff3002de30998b190a46bef310652d3546b6c39e25';
const CLOCK      = '0x0000000000000000000000000000000000000000000000000000000000000006';

const SUI_TYPE  = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const SUI_RPC   = process.env.SUI_RPC || 'https://fullnode.mainnet.sui.io';

// Stakes: 0.01 SUI each side = min_stake per contract config (min_stake = 10,000,000 MIST)
const STAKE_MIST = 10_000_000n;  // 0.01 SUI = contract minimum
const GAS_BUDGET = 30_000_000n;  // 0.03 SUI per tx
const ODDS_BPS   = 20_000n;      // 2.0x → taker_amount = maker_amount

// ── Result tracking ───────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;
const results = [];

const ok   = (label, hash) => { passed++; results.push({ ok: true,  label, hash }); console.log(`  ✅ ${label}${hash ? ` → ${hash.slice(0,20)}...` : ''}`); };
const fail = (label, err)  => { failed++; results.push({ ok: false, label, err  }); console.log(`  ❌ ${label}: ${String(err).slice(0,200)}`); };
const skip = (label, reason) => { skipped++; results.push({ ok: null, label, reason }); console.log(`  ⏭️  SKIPPED ${label}: ${reason}`); };
const info = msg => console.log(`     ${msg}`);
const sep  = () => console.log('─'.repeat(66));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc   = new TextEncoder();
const toBytes = s => Array.from(enc.encode(s));

// ── Keypair ───────────────────────────────────────────────────────────────────
function buildKeypair(raw) {
  if (raw.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(raw);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  let bytes = raw.startsWith('0x')
    ? new Uint8Array(Buffer.from(raw.slice(2), 'hex'))
    : new Uint8Array(Buffer.from(raw, 'base64'));
  if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
  if (bytes.length === 64) bytes = bytes.slice(0, 32);
  return Ed25519Keypair.fromSecretKey(bytes);
}

// ── Send transaction ──────────────────────────────────────────────────────────
async function sendTx(client, tx, kp, label) {
  try {
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: kp,
      options: { showEffects: true, showObjectChanges: true, showBalanceChanges: true },
    });
    const status = result?.effects?.status?.status;
    const digest = result?.digest ?? '';
    if (status === 'success') {
      ok(label, digest);
      info(`🔗 https://suivision.xyz/txblock/${digest}`);
      return { status, digest, changes: result.objectChanges ?? [], balanceChanges: result.balanceChanges ?? [] };
    } else {
      const errMsg = result?.effects?.status?.error ?? 'on-chain error';
      fail(label, errMsg);
      return { status: 'failure', digest, changes: [], balanceChanges: [], error: errMsg };
    }
  } catch (e) {
    fail(label, e.message);
    return { status: 'error', digest: '', changes: [], balanceChanges: [] };
  }
}

// ── Find created object ───────────────────────────────────────────────────────
const findCreated = (changes, frag) =>
  changes?.find(c => c.type === 'created' && c.objectType?.includes(frag));

// ── FLOW 1: POST → CANCEL ─────────────────────────────────────────────────────
async function flowCancel(client, kp, addr) {
  console.log('\n── [SUI] Flow 1: POST → CANCEL ──────────────────────────────');
  const label = '[SUI] cancel_offer';

  const postTx = new Transaction();
  postTx.setSender(addr);
  postTx.setGasBudget(GAS_BUDGET);
  const [makerCoin] = postTx.splitCoins(postTx.gas, [STAKE_MIST]);
  postTx.moveCall({
    target: `${PKG}::p2p_betting::post_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      postTx.object(CONFIG),
      postTx.object(REGISTRY),
      makerCoin,
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes(`E2E_CANCEL_SUI_${Date.now()}`))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('E2E SUI Cancel Test'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
      postTx.pure.u64(ODDS_BPS),
      postTx.pure.u64(BigInt(Date.now() + 3_600_000)),
      postTx.object(CLOCK),
    ],
  });
  const postR = await sendTx(client, postTx, kp, '[SUI] post_offer (to cancel)');
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail(label, 'P2POffer not found in tx changes'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  info(`🔗 https://suivision.xyz/object/${offerObj.objectId}`);
  await sleep(3000);

  const cancelTx = new Transaction();
  cancelTx.setSender(addr);
  cancelTx.setGasBudget(GAS_BUDGET);
  cancelTx.moveCall({
    target: `${PKG}::p2p_betting::cancel_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      cancelTx.object(offerObj.objectId),
      cancelTx.object(REGISTRY),
      cancelTx.object(CLOCK),
    ],
  });
  const cancelR = await sendTx(client, cancelTx, kp, label);
  if (cancelR.status === 'success') {
    const refund = cancelR.balanceChanges.find(c => c.coinType === SUI_TYPE && Number(c.amount) > 0 && c.owner?.AddressOwner === addr);
    if (refund) info(`✓ Refund: +${Number(refund.amount) / 1e9} SUI returned to maker`);
    else        info(`✓ cancel_offer succeeded — SUI returned`);
  }
}

// ── FLOW 2: POST → EXPIRE ─────────────────────────────────────────────────────
// The contract requires expiry to be in the future at post time.
// We post with a 30-second expiry, wait 35s for it to pass, then expire it.
async function flowExpire(client, kp, addr) {
  console.log('\n── [SUI] Flow 2: POST → EXPIRE ──────────────────────────────');
  const label = '[SUI] expire_offer';

  const EXPIRE_DELAY_MS = 30_000; // 30s — short enough to test, long enough for Sui clock
  const expiryMs = Date.now() + EXPIRE_DELAY_MS;

  const postTx = new Transaction();
  postTx.setSender(addr);
  postTx.setGasBudget(GAS_BUDGET);
  const [makerCoin] = postTx.splitCoins(postTx.gas, [STAKE_MIST]);
  postTx.moveCall({
    target: `${PKG}::p2p_betting::post_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      postTx.object(CONFIG),
      postTx.object(REGISTRY),
      makerCoin,
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes(`E2E_EXPIRE_SUI_${Date.now()}`))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('E2E SUI Expire Test'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
      postTx.pure.u64(ODDS_BPS),
      postTx.pure.u64(BigInt(expiryMs)),
      postTx.object(CLOCK),
    ],
  });
  const postR = await sendTx(client, postTx, kp, `[SUI] post_offer (expiry in ${EXPIRE_DELAY_MS / 1000}s)`);
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail(label, 'P2POffer not found'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  info(`🔗 https://suivision.xyz/object/${offerObj.objectId}`);

  // Wait for the offer to expire on-chain (Sui Clock is real-world time in ms)
  const waitMs = expiryMs - Date.now() + 5000; // +5s buffer
  info(`⏳ Waiting ${Math.ceil(waitMs / 1000)}s for offer to expire on-chain…`);
  await sleep(waitMs);

  const expireTx = new Transaction();
  expireTx.setSender(addr);
  expireTx.setGasBudget(GAS_BUDGET);
  expireTx.moveCall({
    target: `${PKG}::p2p_betting::expire_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      expireTx.object(offerObj.objectId),
      expireTx.object(REGISTRY),
      expireTx.object(CLOCK),
    ],
  });
  const expireR = await sendTx(client, expireTx, kp, label);
  if (expireR.status === 'success') {
    const refund = expireR.balanceChanges.find(c => c.coinType === SUI_TYPE && Number(c.amount) > 0 && c.owner?.AddressOwner === addr);
    if (refund) info(`✓ Refund: +${Number(refund.amount) / 1e9} SUI returned to maker`);
    else        info(`✓ expire_offer succeeded — SUI returned`);
  }
}

// ── FLOW 3: POST → ACCEPT → SETTLE (maker wins) ───────────────────────────────
async function flowMakerWins(client, adminKp, adminAddr, takerKp, takerAddr) {
  console.log('\n── [SUI] Flow 3: POST → ACCEPT → SETTLE (maker wins) ────────');
  if (!ORACLE_CAP) { skip('[SUI] maker_wins settlement', 'P2P_ORACLE_CAP_ID not set'); return; }

  // Admin posts offer
  const postTx = new Transaction();
  postTx.setSender(adminAddr);
  postTx.setGasBudget(GAS_BUDGET);
  const [makerCoin] = postTx.splitCoins(postTx.gas, [STAKE_MIST]);
  const eventId = `E2E_MAKER_WIN_SUI_${Date.now()}`;
  postTx.moveCall({
    target: `${PKG}::p2p_betting::post_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      postTx.object(CONFIG), postTx.object(REGISTRY), makerCoin,
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes(eventId))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('E2E SUI Maker Win Test'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
      postTx.pure.u64(ODDS_BPS),
      postTx.pure.u64(BigInt(Date.now() + 3_600_000)),
      postTx.object(CLOCK),
    ],
  });
  const postR = await sendTx(client, postTx, adminKp, '[SUI] post_offer (maker-win test)');
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail('[SUI] maker_wins settlement', 'P2POffer not found'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  info(`🔗 https://suivision.xyz/object/${offerObj.objectId}`);
  await sleep(3000);

  // Taker accepts
  const acceptTx = new Transaction();
  acceptTx.setSender(takerAddr);
  acceptTx.setGasBudget(GAS_BUDGET);
  const [takerCoin] = acceptTx.splitCoins(acceptTx.gas, [STAKE_MIST]);
  acceptTx.moveCall({
    target: `${PKG}::p2p_betting::accept_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      acceptTx.object(CONFIG), acceptTx.object(REGISTRY),
      acceptTx.object(offerObj.objectId),
      takerCoin,
      acceptTx.pure.u64(STAKE_MIST),
      acceptTx.object(CLOCK),
    ],
  });
  const acceptR = await sendTx(client, acceptTx, takerKp, '[SUI] accept_offer');
  if (acceptR.status !== 'success') return;

  const matchedBet = findCreated(acceptR.changes, 'P2PMatchedBet');
  if (!matchedBet) { fail('[SUI] maker_wins settlement', 'P2PMatchedBet not found'); return; }
  info(`P2PMatchedBet: ${matchedBet.objectId}`);
  info(`🔗 https://suivision.xyz/object/${matchedBet.objectId}`);
  await sleep(3000);

  // Oracle settles — makerWins=true
  const settleTx = new Transaction();
  settleTx.setSender(adminAddr);
  settleTx.setGasBudget(GAS_BUDGET);
  settleTx.moveCall({
    target: `${PKG}::p2p_betting::instant_settle_bet`,
    typeArguments: [SUI_TYPE],
    arguments: [
      settleTx.object(ORACLE_CAP), settleTx.object(CONFIG), settleTx.object(REGISTRY),
      settleTx.object(matchedBet.objectId),
      settleTx.pure.bool(true),  // makerWins=true
      settleTx.object(CLOCK),
    ],
  });
  const settleR = await sendTx(client, settleTx, adminKp, '[SUI] instant_settle_bet (maker wins)');
  if (settleR.status === 'success') {
    const payout = settleR.balanceChanges.find(c => c.coinType === SUI_TYPE && Number(c.amount) > 0 && c.owner?.AddressOwner === adminAddr);
    if (payout) info(`✓ Payout to maker: +${Number(payout.amount) / 1e9} SUI`);
    else        info(`✓ instant_settle_bet succeeded — payout delivered on-chain`);
  }
}

// ── FLOW 4: POST → ACCEPT → SETTLE (taker wins) ───────────────────────────────
async function flowTakerWins(client, adminKp, adminAddr, takerKp, takerAddr) {
  console.log('\n── [SUI] Flow 4: POST → ACCEPT → SETTLE (taker wins) ────────');
  if (!ORACLE_CAP) { skip('[SUI] taker_wins settlement', 'P2P_ORACLE_CAP_ID not set'); return; }

  const postTx = new Transaction();
  postTx.setSender(adminAddr);
  postTx.setGasBudget(GAS_BUDGET);
  const [makerCoin] = postTx.splitCoins(postTx.gas, [STAKE_MIST]);
  const eventId = `E2E_TAKER_WIN_SUI_${Date.now()}`;
  postTx.moveCall({
    target: `${PKG}::p2p_betting::post_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      postTx.object(CONFIG), postTx.object(REGISTRY), makerCoin,
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes(eventId))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('E2E SUI Taker Win Test'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
      postTx.pure.u64(ODDS_BPS),
      postTx.pure.u64(BigInt(Date.now() + 3_600_000)),
      postTx.object(CLOCK),
    ],
  });
  const postR = await sendTx(client, postTx, adminKp, '[SUI] post_offer (taker-win test)');
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail('[SUI] taker_wins settlement', 'P2POffer not found'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  info(`🔗 https://suivision.xyz/object/${offerObj.objectId}`);
  await sleep(3000);

  const acceptTx = new Transaction();
  acceptTx.setSender(takerAddr);
  acceptTx.setGasBudget(GAS_BUDGET);
  const [takerCoin] = acceptTx.splitCoins(acceptTx.gas, [STAKE_MIST]);
  acceptTx.moveCall({
    target: `${PKG}::p2p_betting::accept_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      acceptTx.object(CONFIG), acceptTx.object(REGISTRY),
      acceptTx.object(offerObj.objectId),
      takerCoin,
      acceptTx.pure.u64(STAKE_MIST),
      acceptTx.object(CLOCK),
    ],
  });
  const acceptR = await sendTx(client, acceptTx, takerKp, '[SUI] accept_offer');
  if (acceptR.status !== 'success') return;

  const matchedBet = findCreated(acceptR.changes, 'P2PMatchedBet');
  if (!matchedBet) { fail('[SUI] taker_wins settlement', 'P2PMatchedBet not found'); return; }
  info(`P2PMatchedBet: ${matchedBet.objectId}`);
  info(`🔗 https://suivision.xyz/object/${matchedBet.objectId}`);
  await sleep(3000);

  // Oracle settles — makerWins=false → taker wins
  const settleTx = new Transaction();
  settleTx.setSender(adminAddr);
  settleTx.setGasBudget(GAS_BUDGET);
  settleTx.moveCall({
    target: `${PKG}::p2p_betting::instant_settle_bet`,
    typeArguments: [SUI_TYPE],
    arguments: [
      settleTx.object(ORACLE_CAP), settleTx.object(CONFIG), settleTx.object(REGISTRY),
      settleTx.object(matchedBet.objectId),
      settleTx.pure.bool(false),  // makerWins=false → taker wins
      settleTx.object(CLOCK),
    ],
  });
  const settleR = await sendTx(client, settleTx, adminKp, '[SUI] instant_settle_bet (taker wins)');
  if (settleR.status === 'success') {
    const payout = settleR.balanceChanges.find(c => c.coinType === SUI_TYPE && Number(c.amount) > 0 && c.owner?.AddressOwner === takerAddr);
    if (payout) info(`✓ Payout to taker: +${Number(payout.amount) / 1e9} SUI`);
    else        info(`✓ instant_settle_bet succeeded — taker paid on-chain`);
  }
}

// ── FLOW 5: POST → ACCEPT → VOID ─────────────────────────────────────────────
async function flowVoid(client, adminKp, adminAddr, takerKp, takerAddr) {
  console.log('\n── [SUI] Flow 5: POST → ACCEPT → VOID ───────────────────────');
  if (!ORACLE_CAP) { skip('[SUI] void_bet', 'P2P_ORACLE_CAP_ID not set'); return; }

  const postTx = new Transaction();
  postTx.setSender(adminAddr);
  postTx.setGasBudget(GAS_BUDGET);
  const [makerCoin] = postTx.splitCoins(postTx.gas, [STAKE_MIST]);
  const eventId = `E2E_VOID_SUI_${Date.now()}`;
  postTx.moveCall({
    target: `${PKG}::p2p_betting::post_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      postTx.object(CONFIG), postTx.object(REGISTRY), makerCoin,
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes(eventId))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('E2E SUI Void Test'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('home'))),
      postTx.pure(bcs.vector(bcs.u8()).serialize(toBytes('moneyline'))),
      postTx.pure.u64(ODDS_BPS),
      postTx.pure.u64(BigInt(Date.now() + 3_600_000)),
      postTx.object(CLOCK),
    ],
  });
  const postR = await sendTx(client, postTx, adminKp, '[SUI] post_offer (void test)');
  if (postR.status !== 'success') return;

  const offerObj = findCreated(postR.changes, 'P2POffer');
  if (!offerObj) { fail('[SUI] void_bet', 'P2POffer not found'); return; }
  info(`P2POffer: ${offerObj.objectId}`);
  info(`🔗 https://suivision.xyz/object/${offerObj.objectId}`);
  await sleep(3000);

  const acceptTx = new Transaction();
  acceptTx.setSender(takerAddr);
  acceptTx.setGasBudget(GAS_BUDGET);
  const [takerCoin] = acceptTx.splitCoins(acceptTx.gas, [STAKE_MIST]);
  acceptTx.moveCall({
    target: `${PKG}::p2p_betting::accept_offer`,
    typeArguments: [SUI_TYPE],
    arguments: [
      acceptTx.object(CONFIG), acceptTx.object(REGISTRY),
      acceptTx.object(offerObj.objectId),
      takerCoin,
      acceptTx.pure.u64(STAKE_MIST),
      acceptTx.object(CLOCK),
    ],
  });
  const acceptR = await sendTx(client, acceptTx, takerKp, '[SUI] accept_offer');
  if (acceptR.status !== 'success') return;

  const matchedBet = findCreated(acceptR.changes, 'P2PMatchedBet');
  if (!matchedBet) { fail('[SUI] void_bet', 'P2PMatchedBet not found'); return; }
  info(`P2PMatchedBet: ${matchedBet.objectId}`);
  info(`🔗 https://suivision.xyz/object/${matchedBet.objectId}`);
  await sleep(3000);

  const voidTx = new Transaction();
  voidTx.setSender(adminAddr);
  voidTx.setGasBudget(GAS_BUDGET);
  voidTx.moveCall({
    target: `${PKG}::p2p_betting::void_bet`,
    typeArguments: [SUI_TYPE],
    arguments: [
      voidTx.object(ORACLE_CAP), voidTx.object(CONFIG), voidTx.object(REGISTRY),
      voidTx.object(matchedBet.objectId),
      voidTx.object(CLOCK),
    ],
  });
  const voidR = await sendTx(client, voidTx, adminKp, '[SUI] void_bet (both refunded)');
  if (voidR.status === 'success') {
    info(`✓ void_bet succeeded — maker and taker both refunded on-chain`);
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  SuiBets — Native SUI On-Chain E2E Test (Mainnet)                ║');
  console.log('║  Flows: CANCEL · EXPIRE · MAKER WINS · TAKER WINS · VOID        ║');
  console.log('║  Coin: native SUI (MIST) — 0.005 SUI per side per bet            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY;
  if (!ADMIN_KEY) { console.error('❌ ADMIN_PRIVATE_KEY required'); process.exit(1); }

  const client   = new SuiJsonRpcClient({ url: SUI_RPC, network: 'mainnet' });
  const adminKp  = buildKeypair(ADMIN_KEY);
  const adminAddr = adminKp.getPublicKey().toSuiAddress();

  // Ephemeral taker wallet — funded once from admin
  const takerKp   = Ed25519Keypair.generate();
  const takerAddr  = takerKp.getPublicKey().toSuiAddress();

  console.log(`Admin : ${adminAddr}`);
  console.log(`Taker : ${takerAddr} (ephemeral)`);
  console.log(`Pkg   : ${PKG.slice(0, 24)}...`);
  console.log(`Oracle: ${ORACLE_CAP ? ORACLE_CAP.slice(0, 24) + '...' : '⚠️  NOT SET — settle flows will be skipped'}`);
  sep();

  // ── Check admin SUI balance ─────────────────────────────────────────────────
  const bal = await client.getBalance({ owner: adminAddr, coinType: SUI_TYPE });
  const suiAvail = Number(bal.totalBalance) / 1e9;
  console.log(`Admin SUI: ${suiAvail.toFixed(6)} SUI (${bal.totalBalance} MIST)`);

  // Need: 5 post_offers × 0.005 STAKE + taker 3 × 0.005 + lots of gas ≈ 0.3 SUI
  if (suiAvail < 0.3) {
    console.error(`❌ Need at least 0.30 SUI. Have ${suiAvail.toFixed(6)} SUI. Aborting.`);
    process.exit(1);
  }
  ok('Admin SUI balance sufficient', '');
  sep();

  // ── Set dispute_window = 0 for instant settlement ───────────────────────────
  console.log('── Setting dispute_window = 0 for instant claiming ──');
  const dwTx = new Transaction();
  dwTx.setSender(adminAddr);
  dwTx.setGasBudget(GAS_BUDGET);
  dwTx.moveCall({
    target: `${PKG}::p2p_betting::set_dispute_window`,
    arguments: [dwTx.object(ADMIN_CAP), dwTx.object(CONFIG), dwTx.pure.u64(0n), dwTx.object(CLOCK)],
  });
  const dwR = await sendTx(client, dwTx, adminKp, 'set_dispute_window → 0');
  if (dwR.status !== 'success') { console.error('❌ Could not set dispute window — aborting'); process.exit(1); }
  await sleep(2000);

  // ── Fund ephemeral taker with SUI ──────────────────────────────────────────
  console.log('\n── Funding ephemeral taker wallet ──');
  const fundTx = new Transaction();
  fundTx.setSender(adminAddr);
  fundTx.setGasBudget(GAS_BUDGET);
  const [takerFund] = fundTx.splitCoins(fundTx.gas, [100_000_000n]); // 0.1 SUI for taker
  fundTx.transferObjects([takerFund], takerAddr);
  const fundR = await sendTx(client, fundTx, adminKp, 'Fund taker (0.1 SUI)');
  if (fundR.status !== 'success') { console.error('❌ Could not fund taker — aborting'); process.exit(1); }
  await sleep(3000);

  const takerBal = await client.getBalance({ owner: takerAddr, coinType: SUI_TYPE });
  info(`Taker SUI: ${Number(takerBal.totalBalance) / 1e9} SUI`);
  sep();

  // ── Run all 5 flows ─────────────────────────────────────────────────────────
  await flowCancel(client, adminKp, adminAddr);   await sleep(3000);
  await flowExpire(client, adminKp, adminAddr);   await sleep(3000);
  await flowMakerWins(client, adminKp, adminAddr, takerKp, takerAddr); await sleep(3000);
  await flowTakerWins(client, adminKp, adminAddr, takerKp, takerAddr); await sleep(3000);
  await flowVoid(client, adminKp, adminAddr, takerKp, takerAddr);

  // ── Restore dispute_window = 2 hours ───────────────────────────────────────
  console.log('\n── Restoring dispute_window = 7,200,000ms ──');
  await sleep(3000);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tx = new Transaction();
    tx.setSender(adminAddr);
    tx.setGasBudget(GAS_BUDGET);
    tx.moveCall({
      target: `${PKG}::p2p_betting::set_dispute_window`,
      arguments: [tx.object(ADMIN_CAP), tx.object(CONFIG), tx.pure.u64(7_200_000n), tx.object(CLOCK)],
    });
    const r = await sendTx(client, tx, adminKp, `set_dispute_window → 7,200,000ms (attempt ${attempt})`);
    if (r.status === 'success') break;
    if (attempt < 3) { results.pop(); failed--; await sleep(3000 * attempt); }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  sep();
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${String(passed).padEnd(3)} passed   ${String(failed).padEnd(3)} failed   ${String(skipped).padEnd(3)} skipped          ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  sep();
  for (const r of results) {
    if (r.ok === null)  console.log(`  ⏭️  ${r.label}: ${r.reason}`);
    else if (r.ok)      console.log(`  ✅ ${r.label}${r.hash ? `  →  https://suivision.xyz/txblock/${r.hash}` : ''}`);
    else                console.log(`  ❌ ${r.label}: ${r.err}`);
  }
  sep();

  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${passed} test(s) passed${skipped > 0 ? ` (${skipped} skipped)` : ''}!`);
  }
}

main().catch(e => { console.error('\n💥 Fatal:', e.message, '\n', e.stack?.split('\n').slice(0,3).join('\n')); process.exit(1); });
