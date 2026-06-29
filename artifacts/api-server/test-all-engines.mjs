/**
 * test-all-engines.mjs  —  SuiBets on-chain proof-of-life
 *
 * Tests WARP / FLUX / PULSE engines without touching P2P bets.
 * PULSE test: creates a live pool on mainnet → locks → voids it.
 * Minimum stake = 10_000_000 MIST (0.01 SUI) per side.
 */
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction }         from '@mysten/sui/transactions';
import { SuiJsonRpcClient }    from '@mysten/sui/jsonRpc';

// ── deployed addresses ────────────────────────────────────────────────────────
const RPC        = 'https://fullnode.mainnet.sui.io:443';
const WARP_PKG   = '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747';
const WARP_STATS = '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367';
const FLUX_PKG   = '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018';
const FLUX_STATS = '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320';
const PULSE_PKG  = '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238';
const PULSE_STATS= '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff';
const ORACLE_CAP = '0x4319c676800594d69680eb4616a0cb345480d839b0ae9909ceb418f7252ace55';
const CLOCK      = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_T      = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

if (!process.env.ADMIN_PRIVATE_KEY) { console.error('ADMIN_PRIVATE_KEY not set'); process.exit(1); }

const { secretKey } = decodeSuiPrivateKey(process.env.ADMIN_PRIVATE_KEY);
const kp     = Ed25519Keypair.fromSecretKey(secretKey);
const admin  = kp.toSuiAddress();
const client = new SuiJsonRpcClient({ url: RPC });

let passed = 0, failed = 0;
const pass = (lbl, info='') => { passed++; console.log(`  ✅ ${lbl}${info ? '  '+info : ''}`); };
const fail = (lbl, err)     => { failed++; console.error(`  ❌ ${lbl}  ${String(err).slice(0,120)}`); };

async function execTx(tx, showObjs=false) {
  const opts = { showEffects: true, ...(showObjs ? { showObjectChanges: true } : {}) };
  const r = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: opts });
  return { ok: r?.effects?.status?.status === 'success', digest: r?.digest ?? '', error: r?.effects?.status?.error, changes: r?.objectChanges ?? [] };
}

console.log('\n' + '═'.repeat(62));
console.log('  SuiBets Engine Test Suite — on-chain proof of life');
console.log('═'.repeat(62));
console.log('  Admin: ' + admin);
console.log('═'.repeat(62) + '\n');

// ── STEP 0 · Oracle cap identity ──────────────────────────────────────────────
console.log('[ STEP 0 ] Oracle cap identity');
try {
  const cap = await client.getObject({ id: ORACLE_CAP, options: { showType: true, showOwner: true } });
  const t   = cap?.data?.type ?? '';
  t.includes('p2p_betting::OracleCap')
    ? pass('OracleCap type', t.split('::').slice(-2).join('::'))
    : fail('OracleCap type', 'Expected p2p_betting::OracleCap, got: ' + t);
  const owner = cap?.data?.owner?.AddressOwner ?? '';
  owner === admin
    ? pass('OracleCap owned by admin wallet')
    : fail('OracleCap owner mismatch', owner.slice(0,16) + '…');
} catch(e) { fail('Oracle cap', e.message); }

// ── STEP 1 · Self-transfer (1 MIST) ───────────────────────────────────────────
console.log('\n[ STEP 1 ] Self-transfer — 1 MIST round-trip');
try {
  const tx = new Transaction();
  const [c] = tx.splitCoins(tx.gas, [1n]);
  tx.transferObjects([c], admin);
  tx.setGasBudget(5_000_000);
  const t0 = Date.now();
  const r  = await execTx(tx);
  r.ok ? pass('Self-transfer', r.digest + '  (' + (Date.now()-t0) + 'ms)')
       : fail('Self-transfer', r.error);
} catch(e) { fail('Self-transfer', e.message); }

// ── STEP 2 · WARP engine ──────────────────────────────────────────────────────
console.log('\n[ STEP 2 ] WARP engine — WarpStats + last batch');
try {
  const r  = await client.getObject({ id: WARP_STATS, options: { showContent: true } });
  const sf = r?.data?.content?.fields ?? null;
  if (!sf) throw new Error('WarpStats object not found');
  pass('WarpStats readable', 'total_batches=' + sf.total_batches + '  total_settled=' + sf.total_settled);
  const evts = await client.queryEvents({ query: { MoveEventType: WARP_PKG + '::warp_engine::WarpBatchSettled' }, limit: 3, order: 'descending' });
  const last = evts.data?.[0]?.parsedJson;
  last ? pass('WarpBatchSettled events', 'last batch_id=' + last.batch_id + '  count=' + last.count)
       : pass('WARP idle — no matched P2P bets yet', '');
} catch(e) { fail('WARP stats', e.message); }

// ── STEP 3 · FLUX engine ──────────────────────────────────────────────────────
console.log('\n[ STEP 3 ] FLUX engine — FluxStats + pending shards');
try {
  const r  = await client.getObject({ id: FLUX_STATS, options: { showContent: true } });
  const sf = r?.data?.content?.fields ?? null;
  if (!sf) throw new Error('FluxStats object not found');
  pass('FluxStats readable', 'total_batches=' + sf.total_batches + '  settled=' + sf.total_settled + '  voided=' + sf.total_voided);
  const evts = await client.queryEvents({ query: { MoveEventType: FLUX_PKG + '::flux_engine::FluxShardFilled' }, limit: 20, order: 'descending' });
  let pending = 0;
  for (const e of evts.data ?? []) {
    const id = e.parsedJson?.shard_id?.id ?? e.parsedJson?.shard_id ?? '';
    if (!id) continue;
    const obj = await client.getObject({ id, options: { showContent: true } });
    if (Number(obj?.data?.content?.fields?.status ?? 99) === 0) pending++;
  }
  pending === 0
    ? pass('FLUX shards — all settled/voided', 'scanned ' + (evts.data?.length ?? 0))
    : pass('FLUX shards — ' + pending + ' pending (awaiting oracle settlement)', '');
} catch(e) { fail('FLUX stats', e.message); }

// ── STEP 4 · PULSE full lifecycle ─────────────────────────────────────────────
console.log('\n[ STEP 4 ] PULSE engine — create → lock → void lifecycle');

let poolId = '';
// 4a — read PulseStats
try {
  const r  = await client.getObject({ id: PULSE_STATS, options: { showContent: true } });
  const sf = r?.data?.content?.fields ?? null;
  if (!sf) throw new Error('PulseStats object not found');
  pass('PulseStats readable', 'total_pools=' + sf.total_pools + '  settled=' + sf.total_settled + '  voided=' + sf.total_voided);
} catch(e) { fail('PulseStats read', e.message); }

// 4b — create pool (minimum 10_000_000 MIST = 0.01 SUI per side)
const evtId = Buffer.from('engine-test-' + Date.now());
try {
  const tx = new Transaction();
  const [cA, cB] = tx.splitCoins(tx.gas, [10_000_000n, 10_000_000n]);
  tx.moveCall({
    target:        PULSE_PKG + '::pulse_engine::pulse_create_pool',
    typeArguments: [SUI_T],
    arguments:     [ cA, cB, tx.pure.vector('u8', Array.from(evtId)), tx.pure.vector('u8', Array.from(Buffer.from('Engine_A'))), tx.pure.vector('u8', Array.from(Buffer.from('Engine_B'))), tx.object(PULSE_STATS), tx.object(CLOCK) ],
  });
  tx.setGasBudget(20_000_000);
  const t0 = Date.now();
  const r  = await execTx(tx, true);
  const c  = r.changes.find(x => x.type === 'created' && (x.objectType ?? '').includes('PulsePool'));
  poolId   = c?.objectId ?? '';
  (r.ok && poolId) ? pass('pulse_create_pool  ' + poolId.slice(0,20) + '…', r.digest + '  (' + (Date.now()-t0) + 'ms)')
                   : fail('pulse_create_pool', r.error ?? 'no PulsePool in objectChanges');
} catch(e) { fail('pulse_create_pool', e.message); }

// 4c — lock
if (poolId) {
  await new Promise(r => setTimeout(r, 2000));
  try {
    const tx = new Transaction();
    tx.moveCall({ target: PULSE_PKG + '::pulse_engine::pulse_lock_pool', typeArguments: [SUI_T], arguments: [ tx.object(ORACLE_CAP), tx.object(poolId), tx.object(CLOCK) ] });
    tx.setGasBudget(20_000_000);
    const t0 = Date.now();
    const r  = await execTx(tx);
    r.ok ? pass('pulse_lock_pool', r.digest + '  (' + (Date.now()-t0) + 'ms)')
         : fail('pulse_lock_pool', r.error);
  } catch(e) { fail('pulse_lock_pool', e.message); }
} else { fail('pulse_lock_pool', 'skipped — pool not created'); }

// 4d — void
if (poolId) {
  await new Promise(r => setTimeout(r, 2000));
  try {
    const tx = new Transaction();
    tx.moveCall({ target: PULSE_PKG + '::pulse_engine::pulse_void_pool', typeArguments: [SUI_T], arguments: [ tx.object(ORACLE_CAP), tx.object(poolId), tx.object(PULSE_STATS), tx.object(CLOCK) ] });
    tx.setGasBudget(20_000_000);
    const t0 = Date.now();
    const r  = await execTx(tx);
    r.ok ? pass('pulse_void_pool', r.digest + '  (' + (Date.now()-t0) + 'ms)')
         : fail('pulse_void_pool', r.error);
  } catch(e) { fail('pulse_void_pool', e.message); }
} else { fail('pulse_void_pool', 'skipped — pool not created'); }

// brief delay so our just-voided pool reaches finality
await new Promise(r => setTimeout(r, 5000));

// ── STEP 5 · Final PULSE sweep ───────────────────────────────────────────────
console.log('\n[ STEP 5 ] Final PULSE sweep — confirm zero stuck pools');
try {
  const evts = await client.queryEvents({ query: { MoveEventType: PULSE_PKG + '::pulse_engine::PulsePoolCreated' }, limit: 50, order: 'descending' });
  let stuck = 0;
  for (const e of evts.data ?? []) {
    const id = e.parsedJson?.pool_id?.id ?? e.parsedJson?.pool_id ?? '';
    if (!id) continue;
    const obj = await client.getObject({ id, options: { showContent: true } });
    const st  = Number(obj?.data?.content?.fields?.status ?? 99);
    if (st < 2) { stuck++; console.log('    ⚠️  ' + ['OPEN','LOCKED'][st] + ' ' + id.slice(0,20) + '…'); }
  }
  stuck === 0 ? pass('All PULSE pools settled/voided — no stuck pools')
              : fail('Stuck PULSE pools', stuck + ' pools still pending');
} catch(e) { fail('PULSE sweep', e.message); }

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(62));
if (failed === 0) {
  console.log('  🎉 ALL ' + (passed + failed) + ' CHECKS PASSED — all engines operational!');
} else {
  console.log('  RESULT: ' + passed + '/' + (passed + failed) + ' passed  |  ' + failed + ' FAILED');
}
console.log('═'.repeat(62) + '\n');
if (failed > 0) process.exit(1);
