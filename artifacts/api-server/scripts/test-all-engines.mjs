/**
 * test-all-engines.mjs  — v5
 *
 * Combined live on-chain integration test for ALL THREE SuiBets engines:
 *   WARP  Engine — batch settlement  (WarpStats health + warp_batch_marker)
 *   FLUX  Engine — fractional fill   (create offer → fill shard → settle)
 *   PULSE Engine — dynamic odds pool (create pool → take position → lock+settle → claim)
 *
 * Root-cause & fix (v5):
 *   The oracle wallet uses a Sui gas accumulator, not a classic Coin<SUI>.
 *   After each settlement TX a payout Coin<SUI> lands in the wallet.  On the NEXT
 *   TX the SDK automatically "smashes" that loose coin into the gas payment alongside
 *   the accumulator.  The validator then reserves the FULL combined balance while only
 *   `full_balance − storage_rebates` is available → InvalidWithdrawReservation.
 *
 *   Fix: at the START of every PTB that calls splitCoins(tx.gas,…), we first list all
 *   loose Coin<SUI> objects as explicit PTB inputs and merge them into the accumulator.
 *   Explicit inputs are excluded from gas-payment smashing; the merge consumes them in
 *   the same PTB, leaving only the accumulator as the gas source.
 *
 *   Additionally: after the WARP TX (which also touches the accumulator) we wait until
 *   the RPC serves the updated accumulator version before building FLUX.
 *
 *   pulse_lock_pool + pulse_settle_pool are combined in ONE PTB to avoid the
 *   OracleCap object-version race between two sequential TXs.
 *
 * Run:
 *   node scripts/test-all-engines.mjs
 */

import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair }       from '@mysten/sui/keypairs/ed25519';
import { Transaction }          from '@mysten/sui/transactions';
import { SuiJsonRpcClient }     from '@mysten/sui/jsonRpc';

// ── Constants ─────────────────────────────────────────────────────────────────

const RPC_URL  = 'https://fullnode.mainnet.sui.io:443';
const CLOCK    = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
// The oracle wallet's gas accumulator object (dynamic_field, not a Coin<SUI>)
const GAS_ACCU = '0x22269de67d9bba8e547678f93f5d4d59025fefaef59727bb8fb83ef563e17db2';
// Both short and long-form coin types that getOwnedObjects may return
const SUI_COIN_TYPE_SHORT = '0x2::coin::Coin<0x2::sui::SUI>';
const SUI_COIN_TYPE_LONG  =
  '0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<' +
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>';

const ORACLE_CAP  = process.env.P2P_ORACLE_CAP_ID  || '';
const WARP_PKG    = process.env.WARP_PACKAGE_ID    || '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747';
const WARP_STATS  = process.env.WARP_STATS_ID      || '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367';
const FLUX_PKG    = process.env.FLUX_PACKAGE_ID    || '';
const FLUX_STATS  = process.env.FLUX_STATS_ID      || '';
const PULSE_PKG   = process.env.PULSE_PACKAGE_ID   || '';
const PULSE_STATS = process.env.PULSE_STATS_ID     || '';
const ADMIN_KEY   = process.env.ADMIN_PRIVATE_KEY  || process.env.admin_private_key || '';

// ── Amounts ───────────────────────────────────────────────────────────────────

const MAKER_STAKE = 15_000_000;   // 0.015 SUI
const TAKER_STAKE = 10_000_000;   // 0.010 SUI
const SEED_A      = 12_000_000;   // 0.012 SUI
const SEED_B      = 12_000_000;   // 0.012 SUI
const STAKE_A     = 10_000_000;   // 0.010 SUI

// ── Sui client + keypair ──────────────────────────────────────────────────────

const client = new SuiJsonRpcClient({ url: RPC_URL, network: 'mainnet' });

function getKeypair() {
  if (!ADMIN_KEY) throw new Error('ADMIN_PRIVATE_KEY not set');
  const { secretKey } = decodeSuiPrivateKey(ADMIN_KEY);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(label)      { console.log(`  ✅ ${label}`); }
function fail(label, err) { console.log(`  ❌ ${label}: ${String(err?.message || err).split('\n')[0]}`); }
function skip(label)      { console.log(`  ⏭  ${label}`); }
function section(title)   { console.log(`\n${'─'.repeat(62)}\n  ${title}\n${'─'.repeat(62)}`); }
function link(digest)     { console.log(`       ↳ https://suiscan.xyz/mainnet/tx/${digest}`); }
function sleep(ms)        { return new Promise(r => setTimeout(r, ms)); }

async function waitForObject(id, maxMs = 10_000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try { const o = await client.getObject({ id, options: { showType: true } }); if (o.data) return; } catch (_) {}
    await sleep(600);
  }
}

async function waitForAccumulator(prevVersion, maxMs = 12_000) {
  process.stdout.write('  ⏳ waiting for accumulator index…');
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const o = await client.getObject({ id: GAS_ACCU, options: { showType: true } });
      if (o.data?.version !== prevVersion) { console.log(' ✓'); return; }
    } catch (_) {}
    await sleep(500);
  }
  console.log(' timeout');
}

function findCreated(changes, frag) {
  return changes.find(o => o.type === 'created' && (o.objectType || '').includes(frag));
}

// ── Fetch loose Coin<SUI> object IDs in the oracle wallet ─────────────────────
//
// Settlement TXs create payout Coin<SUI> owned objects.  If we don't handle
// them before the next splitCoins(tx.gas,…) call the SDK smashes them into
// gas-payment causing "InvalidWithdrawReservation".

async function getLooseSuiCoinIds(address) {
  const owned = await client.getOwnedObjects({
    owner: address,
    filter: { StructType: SUI_COIN_TYPE_LONG },
    options: { showType: true },
  });
  const ids = owned.data.map(o => o.data?.objectId).filter(Boolean);
  if (ids.length === 0) {
    // Try short-form in case RPC returns it differently
    const owned2 = await client.getOwnedObjects({
      owner: address,
      filter: { StructType: SUI_COIN_TYPE_SHORT },
      options: { showType: true },
    });
    ids.push(...owned2.data.map(o => o.data?.objectId).filter(Boolean));
  }
  return [...new Set(ids)];
}

// ── Core TX executor ──────────────────────────────────────────────────────────

async function execTx(tx, label) {
  const kp      = getKeypair();
  const address = kp.getPublicKey().toSuiAddress();
  tx.setSender(address);
  tx.setGasBudget(20_000_000);
  const bytes  = await tx.build({ client });
  const signed = await kp.signTransaction(bytes);
  const res    = await client.executeTransactionBlock({
    transactionBlock: bytes,
    signature:        signed.signature,
    options: { showEffects: true, showObjectChanges: true },
  });
  const status = res.effects?.status?.status;
  if (status !== 'success') {
    const err = res.effects?.status?.error || 'unknown error';
    throw new Error(`[${label}] (${res.digest}): ${err}`);
  }
  return { digest: res.digest, changes: res.objectChanges || [] };
}

// ── Build a TX that:
//    1. Merges any loose Coin<SUI> objects as explicit PTB inputs (so the SDK
//       will not smash them into gas-payment)
//    2. Splits the requested amounts from tx.gas (the accumulator)
//   Returns { tx, splitResults } where splitResults[i] is the i-th coin result
// ─────────────────────────────────────────────────────────────────────────────

async function buildSplitTx(splitAmounts) {
  const kp      = getKeypair();
  const address = kp.getPublicKey().toSuiAddress();

  const looseIds = await getLooseSuiCoinIds(address);
  const tx       = new Transaction();

  if (looseIds.length > 0) {
    // Merge loose coins as explicit inputs → they are consumed in the PTB
    // and therefore NOT included in the SDK-constructed gas-payment list.
    tx.mergeCoins(tx.gas, looseIds.map(id => tx.object(id)));
  }

  const splitResult = tx.splitCoins(tx.gas, splitAmounts.map(a => tx.pure.u64(a)));
  // SDK returns a TransactionResult (indexed object), not a native JS array
  const coins = splitAmounts.map((_, i) => splitResult[i]);
  return { tx, coins };
}

// ── Snapshot accumulator version ──────────────────────────────────────────────

async function accuVersion() {
  const o = await client.getObject({ id: GAS_ACCU, options: { showType: true } });
  return o.data?.version;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE 1 — WARP
// ═══════════════════════════════════════════════════════════════════════════════

async function testWarpEngine() {
  section('ENGINE 1 — WARP  (Weighted Atomic Resolution Protocol)');

  try {
    const obj    = await client.getObject({ id: WARP_STATS, options: { showContent: true } });
    const fields = obj.data?.content?.fields || {};
    pass(`WarpStats online — batches=${fields.total_batches ?? '?'}`);
  } catch (e) { fail('WarpStats read', e); return; }

  if (!ORACLE_CAP) { skip('warp_batch_marker (no ORACLE_CAP)'); return; }

  const verBefore = await accuVersion();
  try {
    const tx = new Transaction();
    tx.moveCall({
      target:    `${WARP_PKG}::warp_engine::warp_batch_marker`,
      arguments: [
        tx.object(ORACLE_CAP),
        tx.object(WARP_STATS),
        tx.pure.u64(1),
        tx.pure.u64(0),
        tx.object(CLOCK),
      ],
    });
    const { digest } = await execTx(tx, 'warp_batch_marker');
    pass('warp_batch_marker'); link(digest);
  } catch (e) { fail('warp_batch_marker', e); return; }

  await waitForAccumulator(verBefore);   // let RPC catch up before FLUX builds
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE 2 — FLUX
// ═══════════════════════════════════════════════════════════════════════════════

async function testFluxEngine() {
  section('ENGINE 2 — FLUX  (Fractional Liquidity Utilization eXchange)');

  if (!FLUX_PKG || !FLUX_STATS) { skip('not deployed'); return; }

  try {
    const obj    = await client.getObject({ id: FLUX_STATS, options: { showContent: true } });
    const fields = obj.data?.content?.fields || {};
    pass(`FluxStats online — offers=${fields.total_offers ?? '?'}  shards=${fields.total_shards ?? '?'}`);
  } catch (e) { fail('FluxStats read', e); return; }

  let fluxOfferId, fluxShardId;

  // flux_create_offer — merge loose coins first, then split maker stake inline
  try {
    const verBefore         = await accuVersion();
    const { tx, coins }     = await buildSplitTx([MAKER_STAKE]);
    const [makerCoin]       = coins;
    tx.moveCall({
      target:        `${FLUX_PKG}::flux_engine::flux_create_offer`,
      typeArguments: [SUI_TYPE],
      arguments: [
        makerCoin,
        tx.pure.vector('u8', Array.from(Buffer.from('flux-test-001'))),
        tx.pure.vector('u8', Array.from(Buffer.from('home'))),
        tx.pure.u64(20_000),
        tx.pure.u64(0),
        tx.object(FLUX_STATS),
        tx.object(CLOCK),
      ],
    });
    const { digest, changes } = await execTx(tx, 'flux_create_offer');
    fluxOfferId = findCreated(changes, 'FluxOffer')?.objectId;
    pass(`flux_create_offer — ${fluxOfferId?.slice(0,20)}…`); link(digest);
    process.stdout.write('  ⏳ waiting for FluxOffer shared object…');
    await waitForObject(fluxOfferId); console.log(' ✓');
    await waitForAccumulator(verBefore);
  } catch (e) { fail('flux_create_offer', e); return; }

  // flux_fill_shard + flux_confirm_fill — one PTB, taker stake split inline
  try {
    const verBefore         = await accuVersion();
    const { tx, coins }     = await buildSplitTx([TAKER_STAKE]);
    const [takerCoin]       = coins;
    const [receipt] = tx.moveCall({
      target:        `${FLUX_PKG}::flux_engine::flux_fill_shard`,
      typeArguments: [SUI_TYPE],
      arguments: [tx.object(fluxOfferId), takerCoin, tx.object(CLOCK)],
    });
    tx.moveCall({
      target:        `${FLUX_PKG}::flux_engine::flux_confirm_fill`,
      typeArguments: [SUI_TYPE],
      arguments: [tx.object(fluxOfferId), receipt, tx.object(FLUX_STATS), tx.object(CLOCK)],
    });
    const { digest, changes } = await execTx(tx, 'flux_fill+confirm');
    fluxShardId = findCreated(changes, 'FluxShard')?.objectId;
    pass(`flux_fill + confirm — shard: ${fluxShardId?.slice(0,20)}…`); link(digest);
    await waitForAccumulator(verBefore);
  } catch (e) { fail('flux_fill + confirm', e); return; }

  if (!ORACLE_CAP) { skip('flux settle (no ORACLE_CAP)'); return; }

  // flux_settle_shard + flux_batch_close — ONE PTB (same OracleCap ref)
  try {
    const tx = new Transaction();
    tx.moveCall({
      target:        `${FLUX_PKG}::flux_engine::flux_settle_shard`,
      typeArguments: [SUI_TYPE],
      arguments: [
        tx.object(ORACLE_CAP),
        tx.object(fluxShardId),
        tx.pure.bool(true),      // taker wins
        tx.object(FLUX_STATS),
        tx.object(CLOCK),
      ],
    });
    tx.moveCall({
      target:    `${FLUX_PKG}::flux_engine::flux_batch_close`,
      arguments: [
        tx.object(ORACLE_CAP),
        tx.object(FLUX_STATS),
        tx.pure.u64(1),
        tx.pure.u64(0),
        tx.object(CLOCK),
      ],
    });
    const { digest } = await execTx(tx, 'flux_settle+batch_close');
    pass('flux_settle + flux_batch_close — taker wins'); link(digest);
    // Allow RPC to index payout Coin<SUI> objects before PULSE queries them
    process.stdout.write('  ⏳ waiting for payout coin indexing…');
    await sleep(4000);
    console.log(' ✓');
  } catch (e) { fail('flux_settle + batch_close', e); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE 3 — PULSE
// ═══════════════════════════════════════════════════════════════════════════════

async function testPulseEngine() {
  section('ENGINE 3 — PULSE  (Pari-mutuel Under-Liquidity Shifting Engine)');

  if (!PULSE_PKG || !PULSE_STATS) { skip('not deployed'); return; }

  try {
    const obj    = await client.getObject({ id: PULSE_STATS, options: { showContent: true } });
    const fields = obj.data?.content?.fields || {};
    pass(`PulseStats online — pools=${fields.total_pools ?? '?'}  positions=${fields.total_positions ?? '?'}`);
  } catch (e) { fail('PulseStats read', e); return; }

  let pulsePoolId, positionId;

  // pulse_create_pool — merge loose coins first, then split both seeds inline
  // (FLUX settlement may have left payout Coin<SUI> objects that would otherwise
  //  be smashed into gas-payment and cause InvalidWithdrawReservation)
  try {
    const verBefore           = await accuVersion();
    const { tx, coins }       = await buildSplitTx([SEED_A, SEED_B]);
    const [coinA, coinB]      = coins;
    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_create_pool`,
      typeArguments: [SUI_TYPE],
      arguments: [
        coinA, coinB,
        tx.pure.vector('u8', Array.from(Buffer.from('pulse-test-001'))),
        tx.pure.vector('u8', Array.from(Buffer.from('Arsenal'))),
        tx.pure.vector('u8', Array.from(Buffer.from('Chelsea'))),
        tx.object(PULSE_STATS),
        tx.object(CLOCK),
      ],
    });
    const { digest, changes } = await execTx(tx, 'pulse_create_pool');
    pulsePoolId = findCreated(changes, 'PulsePool')?.objectId;
    pass(`pulse_create_pool — ${pulsePoolId?.slice(0,20)}…`); link(digest);
    process.stdout.write('  ⏳ waiting for PulsePool shared object…');
    await waitForObject(pulsePoolId); console.log(' ✓');
    await waitForAccumulator(verBefore);
  } catch (e) { fail('pulse_create_pool', e); return; }

  // pulse_take_position — merge + split stake inline
  try {
    const verBefore         = await accuVersion();
    const { tx, coins }     = await buildSplitTx([STAKE_A]);
    const [stakeA]          = coins;
    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_take_position`,
      typeArguments: [SUI_TYPE],
      arguments: [
        tx.object(pulsePoolId),
        stakeA,
        tx.pure.u8(0),           // SIDE_A
        tx.object(PULSE_STATS),
        tx.object(CLOCK),
      ],
    });
    const { digest, changes } = await execTx(tx, 'pulse_take_position');
    positionId = findCreated(changes, 'PulsePosition')?.objectId;
    pass(`pulse_take_position (side A) — ${positionId?.slice(0,20)}…`); link(digest);
    await waitForAccumulator(verBefore);
  } catch (e) { fail('pulse_take_position', e); return; }

  if (!ORACLE_CAP) { skip('pulse lock/settle/claim (no ORACLE_CAP)'); return; }

  // pulse_lock_pool + pulse_settle_pool — ONE PTB, same OracleCap ref, no version race
  try {
    const tx = new Transaction();
    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_lock_pool`,
      typeArguments: [SUI_TYPE],
      arguments: [tx.object(ORACLE_CAP), tx.object(pulsePoolId), tx.object(CLOCK)],
    });
    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_settle_pool`,
      typeArguments: [SUI_TYPE],
      arguments: [
        tx.object(ORACLE_CAP),
        tx.object(pulsePoolId),
        tx.pure.u8(0),           // SIDE_A wins
        tx.object(PULSE_STATS),
        tx.object(CLOCK),
      ],
    });
    const { digest } = await execTx(tx, 'pulse_lock+settle');
    pass('pulse_lock + settle — side A wins'); link(digest);
  } catch (e) { fail('pulse_lock + settle', e); return; }

  // pulse_claim_winnings
  try {
    const tx = new Transaction();
    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_claim_winnings`,
      typeArguments: [SUI_TYPE],
      arguments: [tx.object(pulsePoolId), tx.object(positionId), tx.object(CLOCK)],
    });
    const { digest } = await execTx(tx, 'pulse_claim_winnings');
    pass('pulse_claim_winnings — payout received'); link(digest);
  } catch (e) { fail('pulse_claim_winnings', e); }

  // pulse_batch_close
  try {
    const tx = new Transaction();
    tx.moveCall({
      target:    `${PULSE_PKG}::pulse_engine::pulse_batch_close`,
      arguments: [
        tx.object(ORACLE_CAP),
        tx.object(PULSE_STATS),
        tx.pure.u64(1),
        tx.pure.u64(0),
        tx.object(CLOCK),
      ],
    });
    const { digest } = await execTx(tx, 'pulse_batch_close');
    pass('pulse_batch_close'); link(digest);
  } catch (e) { fail('pulse_batch_close', e); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const kp      = getKeypair();
  const address = kp.getPublicKey().toSuiAddress();

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  SuiBets — All Engines Integration Test  (Sui Mainnet)');
  console.log('  WARP + FLUX + PULSE  |  One oracle. Three engines. Live.');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`\n  Oracle   : ${address}`);
  console.log(`  OracleCap: ${ORACLE_CAP || '(not set)'}`);
  console.log(`  WARP pkg : ${WARP_PKG}`);
  console.log(`  FLUX pkg : ${FLUX_PKG  || '(not set)'}`);
  console.log(`  PULSE pkg: ${PULSE_PKG || '(not set)'}`);

  const t0 = Date.now();
  await testWarpEngine();
  await testFluxEngine();
  await testPulseEngine();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  Completed in ${elapsed}s`);
  console.log(`══════════════════════════════════════════════════════════════\n`);
}

main().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1); });
