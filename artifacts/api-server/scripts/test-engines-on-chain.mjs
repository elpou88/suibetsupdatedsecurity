/**
 * test-engines-on-chain.mjs
 *
 * On-chain health + activity check for WARP, FLUX, PULSE engines.
 * Verifies:
 *   1. Oracle wallet balance & OracleCap ownership
 *   2. Stats objects are live on-chain (all fields)
 *   3. IDLE TIME — warns if engine hasn't processed a batch in > WARN_HOURS,
 *      fails if idle > FAIL_HOURS
 *   4. Last real transaction per engine (digest + timestamp)
 *   5. devInspect PTB — confirms every entry function is reachable on-chain
 *
 * Run: node scripts/test-engines-on-chain.mjs
 */
import { Transaction }       from '@mysten/sui/transactions';
import { SuiJsonRpcClient }  from '@mysten/sui/jsonRpc';

const SUI_RPC      = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io';
const SUI_CLOCK_ID = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_COIN_TYPE= '0x2::sui::SUI';

// ── Idle-time thresholds ───────────────────────────────────────────────────
const WARN_HOURS = 6;   // yellow warning
const FAIL_HOURS = 24;  // red failure

// ── Deployed IDs ──────────────────────────────────────────────────────────
const ORACLE_CAP   = process.env.P2P_ORACLE_CAP_ID  || '0x4319c676800594d69680eb4616a0cb345480d839b0ae9909ceb418f7252ace55';
const P2P_PACKAGE  = process.env.P2P_PACKAGE_ID     || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
const P2P_CONFIG   = process.env.P2P_CONFIG_ID      || '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
const P2P_REGISTRY = process.env.P2P_REGISTRY_ID    || '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
const WARP_PACKAGE = process.env.WARP_PACKAGE_ID    || '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747';
const WARP_STATS   = process.env.WARP_STATS_ID      || '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367';
const FLUX_PACKAGE = process.env.FLUX_PACKAGE_ID    || '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018';
const FLUX_STATS   = process.env.FLUX_STATS_ID      || '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320';
const PULSE_PACKAGE= process.env.PULSE_PACKAGE_ID   || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238';
const PULSE_STATS  = process.env.PULSE_STATS_ID     || '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff';
const ORACLE_WALLET= '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';

// DUMMY_OBJ: any real object used as a placeholder in devInspect PTBs.
// A type mismatch (not "function not found") proves the target function exists on-chain.
const DUMMY_OBJ    = ORACLE_CAP;

const client = new SuiJsonRpcClient({ url: SUI_RPC });

// ── Result tracking ────────────────────────────────────────────────────────
let passCount = 0, warnCount = 0, failCount = 0;

function pass(msg)    { console.log(`  ✅ ${msg}`); passCount++; }
function warn(msg)    { console.log(`  ⚠️  ${msg}`); warnCount++; }
function fail(msg)    { console.log(`  ❌ ${msg}`); failCount++; }
function info(msg)    { console.log(`  ℹ  ${msg}`); }
function section(name){ console.log(`\n╔══ ${name} ${'═'.repeat(Math.max(0, 55 - name.length))}╗`); }

// ── Time helpers ───────────────────────────────────────────────────────────
function fmtTs(ms) {
  if (!ms) return 'unknown';
  const d = new Date(Number(ms));
  return `${d.toISOString()} (${msAgo(Number(ms))})`;
}

function msAgo(ms) {
  const diffMs  = Date.now() - ms;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60)   return `${diffMin}m ago`;
  const diffH   = Math.floor(diffMin / 60);
  if (diffH < 24)     return `${diffH}h ago`;
  const diffD   = Math.floor(diffH / 24);
  return `${diffD}d ${diffH % 24}h ago`;
}

function idleHours(lastTsMs) {
  return (Date.now() - Number(lastTsMs)) / 3_600_000;
}

function checkIdle(label, lastTsMs) {
  if (!lastTsMs || lastTsMs === '0') {
    warn(`${label} — last_batch_ts is unset (engine may never have run)`);
    return;
  }
  const h = idleHours(lastTsMs);
  if (h >= FAIL_HOURS) {
    fail(`${label} — IDLE ${h.toFixed(1)}h (last: ${fmtTs(lastTsMs)}) — OVER ${FAIL_HOURS}h THRESHOLD`);
  } else if (h >= WARN_HOURS) {
    warn(`${label} — idle ${h.toFixed(1)}h (last: ${fmtTs(lastTsMs)}) — over ${WARN_HOURS}h warning`);
  } else {
    pass(`${label} — active ${h.toFixed(1)}h ago (last: ${fmtTs(lastTsMs)})`);
  }
}

// ── PTB helpers ────────────────────────────────────────────────────────────
function isFunctionNotFound(error) {
  const e = String(error).toLowerCase();
  return (
    e.includes('function not found') ||
    e.includes('module not found') ||
    e.includes('no function') ||
    e.includes('no module') ||
    e.includes('identifier') ||
    e.includes('resolution failed')
  );
}

async function devInspect(tx, label) {
  tx.setSender(ORACLE_WALLET);
  let bytes;
  try {
    bytes = await tx.build({ client });
  } catch (buildErr) {
    return { ok: false, buildErr: buildErr.message, simErr: null };
  }
  try {
    const sim    = await client.devInspectTransactionBlock({ transactionBlock: bytes, sender: ORACLE_WALLET });
    const status = sim?.effects?.status?.status;
    const error  = sim?.effects?.status?.error;
    return { ok: status === 'success', buildErr: null, simErr: error || null, sim };
  } catch (rpcErr) {
    return { ok: false, buildErr: null, simErr: rpcErr.message };
  }
}

function evalPtb(name, r) {
  if (r.buildErr) { fail(`${name} BUILD error: ${r.buildErr}`); return; }
  if (r.ok) {
    pass(`${name} — PTB executed successfully`);
  } else if (isFunctionNotFound(r.simErr)) {
    fail(`${name} — FUNCTION NOT FOUND: ${r.simErr}`);
  } else {
    pass(`${name} — function found (expected type/state abort: ${String(r.simErr).slice(0, 90)})`);
  }
}

// ── Last transaction per engine ────────────────────────────────────────────
async function checkLastTxn(engine, pkg) {
  try {
    const txns = await client.queryTransactionBlocks({
      filter: { MoveFunction: { package: pkg } },
      options: {},
      limit: 1,
      order: 'descending',
    });
    const digest = txns.data[0]?.digest;
    if (!digest) { info(`${engine} — no transactions found for package`); return null; }

    const blk = await client.getTransactionBlock({
      digest,
      options: { showInput: false, showEffects: true, showEvents: false },
    });
    const tsMs = blk.timestampMs ? Number(blk.timestampMs) : null;
    info(`${engine} last txn: ${digest.slice(0, 16)}…  at ${tsMs ? fmtTs(tsMs) : 'ts unavailable'}`);
    return tsMs;
  } catch (e) {
    info(`${engine} last-txn query error: ${e.message}`);
    return null;
  }
}

// ── Stats reader ───────────────────────────────────────────────────────────
async function checkStats(id, label, engine) {
  try {
    const obj = await client.getObject({ id, options: { showContent: true } });
    if (!obj?.data) { fail(`${label} not found on chain`); return null; }
    const f = obj.data.content?.fields || {};

    if (engine === 'warp') {
      pass(`${label} — batches: ${f.total_batches}, settled: ${f.total_settled}, voided: ${f.total_voided}`);
    } else if (engine === 'flux') {
      const vol = f.total_volume ? (Number(f.total_volume) / 1e9).toFixed(4) : '?';
      pass(`${label} — batches: ${f.total_batches}, shards: ${f.total_shards}, settled: ${f.total_settled}, voided: ${f.total_voided}, volume: ${vol} SUI`);
    } else if (engine === 'pulse') {
      const vol = f.total_volume ? (Number(f.total_volume) / 1e9).toFixed(4) : '?';
      pass(`${label} — batches: ${f.total_batches}, pools: ${f.total_pools}, settled: ${f.total_settled}, voided: ${f.total_voided}, volume: ${vol} SUI`);
    }

    checkIdle(`${label} idle`, f.last_batch_ts);
    return f;
  } catch (e) {
    fail(`${label} error: ${e.message}`);
    return null;
  }
}

// ── Oracle checks ──────────────────────────────────────────────────────────
async function checkOracleCap() {
  try {
    const obj = await client.getObject({ id: ORACLE_CAP, options: { showContent: true, showOwner: true } });
    if (!obj?.data) { fail(`OracleCap not found`); return; }
    const owner = obj.data.owner?.AddressOwner;
    const type  = obj.data.content?.type;
    if (owner === ORACLE_WALLET) {
      pass(`OracleCap owned by oracle wallet ✓`);
    } else {
      fail(`OracleCap owned by ${owner} (expected oracle wallet)`);
    }
    info(`Type: ${type}`);
  } catch (e) {
    fail(`OracleCap check error: ${e.message}`);
  }
}

async function checkOracleBalance() {
  try {
    const bal = await client.getBalance({ owner: ORACLE_WALLET, coinType: SUI_COIN_TYPE });
    const sui  = Number(bal.totalBalance) / 1e9;
    const count= bal.coinObjectCount;
    if (sui >= 1.0) {
      pass(`Oracle wallet: ${sui.toFixed(4)} SUI (${count} coin objects) — healthy`);
    } else {
      fail(`Oracle wallet: ${sui.toFixed(4)} SUI — LOW, needs top-up`);
    }
  } catch (e) {
    fail(`Oracle wallet balance error: ${e.message}`);
  }
}

// ── PTB tests ──────────────────────────────────────────────────────────────

async function testWarpBatchMarker() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${WARP_PACKAGE}::warp_engine::warp_batch_marker`,
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(WARP_STATS),
      tx.pure.u64(1),
      tx.pure.u64(0),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(20_000_000);
  evalPtb('warp_batch_marker', await devInspect(tx, 'warp_batch_marker'));
}

async function testWarpInstantSettle() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${P2P_PACKAGE}::p2p_betting::instant_settle_bet`,
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(P2P_CONFIG),
      tx.object(P2P_REGISTRY),
      tx.object(DUMMY_OBJ),
      tx.pure.bool(true),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(50_000_000);
  evalPtb('instant_settle_bet', await devInspect(tx, 'instant_settle_bet'));
}

async function testWarpSettleParlayAtomic() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${WARP_PACKAGE}::warp_engine::warp_settle_parlay_atomic`,
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(P2P_CONFIG),
      tx.object(P2P_REGISTRY),
      tx.object(DUMMY_OBJ),
      tx.pure.vector('bool', [true]),
      tx.pure.vector('bool', [false]),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(50_000_000);
  evalPtb('warp_settle_parlay_atomic', await devInspect(tx, 'warp_settle_parlay_atomic'));
}

async function testFluxSettleShard() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${FLUX_PACKAGE}::flux_engine::flux_settle_shard`,
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(DUMMY_OBJ),
      tx.pure.bool(true),
      tx.object(FLUX_STATS),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(50_000_000);
  evalPtb('flux_settle_shard', await devInspect(tx, 'flux_settle_shard'));
}

async function testFluxVoidShard() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${FLUX_PACKAGE}::flux_engine::flux_void_shard`,
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(DUMMY_OBJ),
      tx.object(FLUX_STATS),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(50_000_000);
  evalPtb('flux_void_shard', await devInspect(tx, 'flux_void_shard'));
}

async function testFluxBatchClose() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${FLUX_PACKAGE}::flux_engine::flux_batch_close`,
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(FLUX_STATS),
      tx.pure.u64(1),
      tx.pure.u64(0),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(20_000_000);
  evalPtb('flux_batch_close', await devInspect(tx, 'flux_batch_close'));
}

async function testPulseLockPool() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PULSE_PACKAGE}::pulse_engine::pulse_lock_pool`,
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(DUMMY_OBJ),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(20_000_000);
  evalPtb('pulse_lock_pool', await devInspect(tx, 'pulse_lock_pool'));
}

async function testPulseSettlePool() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PULSE_PACKAGE}::pulse_engine::pulse_settle_pool`,
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(DUMMY_OBJ),
      tx.pure.u8(0),
      tx.object(PULSE_STATS),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(50_000_000);
  evalPtb('pulse_settle_pool', await devInspect(tx, 'pulse_settle_pool'));
}

async function testPulseVoidPool() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PULSE_PACKAGE}::pulse_engine::pulse_void_pool`,
    typeArguments: [SUI_COIN_TYPE],
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(DUMMY_OBJ),
      tx.object(PULSE_STATS),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(20_000_000);
  evalPtb('pulse_void_pool', await devInspect(tx, 'pulse_void_pool'));
}

async function testPulseBatchClose() {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PULSE_PACKAGE}::pulse_engine::pulse_batch_close`,
    arguments: [
      tx.object(ORACLE_CAP),
      tx.object(PULSE_STATS),
      tx.pure.u64(1),
      tx.pure.u64(0),
      tx.object(SUI_CLOCK_ID),
    ],
  });
  tx.setGasBudget(20_000_000);
  evalPtb('pulse_batch_close', await devInspect(tx, 'pulse_batch_close'));
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SuiBets Engine On-Chain Verification Report          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Date:    ${new Date().toISOString()}                        `);
  console.log(`║  Network: ${SUI_RPC}`.slice(0, 64));
  console.log(`║  Idle warn: >${WARN_HOURS}h  |  Idle fail: >${FAIL_HOURS}h              `);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ── Env config ────────────────────────────────────────────────────────────
  section('ENV CONFIG');
  const envChecks = [
    ['ADMIN_PRIVATE_KEY', process.env.ADMIN_PRIVATE_KEY],
    ['P2P_ORACLE_CAP_ID', process.env.P2P_ORACLE_CAP_ID],
    ['WARP_PACKAGE_ID',   process.env.WARP_PACKAGE_ID],
    ['WARP_STATS_ID',     process.env.WARP_STATS_ID],
    ['FLUX_PACKAGE_ID',   process.env.FLUX_PACKAGE_ID],
    ['FLUX_STATS_ID',     process.env.FLUX_STATS_ID],
    ['PULSE_PACKAGE_ID',  process.env.PULSE_PACKAGE_ID],
    ['PULSE_STATS_ID',    process.env.PULSE_STATS_ID],
  ];
  for (const [k, v] of envChecks) {
    if (v) info(`${k} = set (${v.slice(0, 20)}…)`);
    else    info(`${k} = NOT SET (using hardcoded default)`);
  }

  // ── Oracle ─────────────────────────────────────────────────────────────
  section('ORACLE WALLET & CAP');
  await checkOracleBalance();
  await checkOracleCap();

  // ── Stats + idle time ──────────────────────────────────────────────────
  section('ENGINE STATS & IDLE TIME');
  await checkStats(WARP_STATS,  'WarpStats',  'warp');
  await checkStats(FLUX_STATS,  'FluxStats',  'flux');
  await checkStats(PULSE_STATS, 'PulseStats', 'pulse');

  // ── Last real transaction per engine ──────────────────────────────────
  section('LAST ON-CHAIN TRANSACTION PER ENGINE');
  await Promise.all([
    checkLastTxn('WARP',  WARP_PACKAGE),
    checkLastTxn('FLUX',  FLUX_PACKAGE),
    checkLastTxn('PULSE', PULSE_PACKAGE),
  ]);

  // ── devInspect PTB checks ──────────────────────────────────────────────
  section('WARP ENGINE PTB VERIFICATION (devInspect)');
  await testWarpBatchMarker();
  await testWarpInstantSettle();
  await testWarpSettleParlayAtomic();

  section('FLUX ENGINE PTB VERIFICATION (devInspect)');
  await testFluxSettleShard();
  await testFluxVoidShard();
  await testFluxBatchClose();

  section('PULSE ENGINE PTB VERIFICATION (devInspect)');
  await testPulseLockPool();
  await testPulseSettlePool();
  await testPulseVoidPool();
  await testPulseBatchClose();

  // ── Summary ────────────────────────────────────────────────────────────
  const total = passCount + warnCount + failCount;
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  SUMMARY:  ✅ ${String(passCount).padEnd(3)} passed  ⚠️  ${String(warnCount).padEnd(3)} warned  ❌ ${String(failCount).padEnd(3)} failed  (${total} checks)`);
  if (failCount > 0) {
    console.log('║  STATUS:   ❌ UNHEALTHY — investigate failed checks above     ║');
  } else if (warnCount > 0) {
    console.log('║  STATUS:   ⚠️  DEGRADED  — warnings require attention          ║');
  } else {
    console.log('║  STATUS:   ✅ HEALTHY   — all engines operational              ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (failCount > 0) process.exit(1);
  if (warnCount > 0) process.exit(2);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
