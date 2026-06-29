#!/usr/bin/env node
/**
 * fire-all-engines-onchain.mjs
 *
 * Fires REAL on-chain transactions on all 3 engine packages (WARP · FLUX · PULSE).
 * Every tx is visible in Suivision. Confirmed working on SUI mainnet.
 *
 * Usage (Railway shell or local):
 *   node scripts/fire-all-engines-onchain.mjs
 *
 * Required env vars (set in Railway service variables):
 *   PRIVATE_KEY   — oracle wallet private key (suiprivkey… format)
 *     OR
 *   ADMIN_PRIVATE_KEY  — same key, legacy name
 *
 * Optional:
 *   P2P_ORACLE_CAP_ID  — OracleCap object ID (auto-discovered from wallet if not set)
 *   WARP_PACKAGE_ID / WARP_STATS_ID
 *   FLUX_PACKAGE_ID / FLUX_STATS_ID
 *   PULSE_PACKAGE_ID / PULSE_STATS_ID
 *   SUI_RPC_URL
 *
 * Executes (in order):
 *   1. PULSE pulse_create_pool   → creates PulsePool (PULSE package tx)
 *   2. PULSE pulse_lock_pool     → locks the pool   (PULSE package tx)
 *   3. PULSE pulse_void_pool     → voids the pool   (PULSE package tx)
 *   4. WARP  warp_batch_marker   → emits WarpBatchSettled event (WARP package tx)
 *   5. FLUX  flux_batch_close    → emits FluxBatchSettled event (FLUX package tx)
 *
 * All 5 tx digests printed with Suivision links.
 *
 * Tested on SUI mainnet 2026-06-29 — all 5 txs confirmed successful.
 */

import { Transaction }         from '@mysten/sui/transactions';
import { Ed25519Keypair }      from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { SuiClient }           from '@mysten/sui/client';

// ── Config ────────────────────────────────────────────────────────────────────

const SUI_RPC = process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443';

// Accept PRIVATE_KEY (Railway default) or ADMIN_PRIVATE_KEY (legacy)
const RAW_KEY = (process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();

const WARP_PKG    = (process.env.WARP_PACKAGE_ID  || '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747').trim();
const WARP_STATS  = (process.env.WARP_STATS_ID    || '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367').trim();
const FLUX_PKG    = (process.env.FLUX_PACKAGE_ID  || '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018').trim();
const FLUX_STATS  = (process.env.FLUX_STATS_ID    || '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320').trim();
const PULSE_PKG   = (process.env.PULSE_PACKAGE_ID || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238').trim();
const PULSE_STATS = (process.env.PULSE_STATS_ID   || '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff').trim();

const CLOCK = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_T = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BAR = '═'.repeat(66);
const ok  = msg => console.log(`  ✅  ${msg}`);
const err = msg => console.log(`  ❌  ${msg}`);
const inf = msg => console.log(`  ℹ   ${msg}`);

function buildKeypair() {
  if (!RAW_KEY) throw new Error('No private key — set PRIVATE_KEY or ADMIN_PRIVATE_KEY on Railway');
  if (RAW_KEY.startsWith('suiprivkey')) {
    const { secretKey } = decodeSuiPrivateKey(RAW_KEY);
    return Ed25519Keypair.fromSecretKey(secretKey);
  }
  let bytes = RAW_KEY.startsWith('0x')
    ? new Uint8Array(Buffer.from(RAW_KEY.slice(2), 'hex'))
    : new Uint8Array(Buffer.from(RAW_KEY, 'base64'));
  if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
  if (bytes.length === 64) bytes = bytes.slice(0, 32);
  return Ed25519Keypair.fromSecretKey(bytes);
}

async function execTx(client, tx, kp, label, showChanges = false) {
  const opts = { showEffects: true };
  if (showChanges) opts.showObjectChanges = true;
  const t0  = Date.now();
  const res = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: opts });
  const ms  = Date.now() - t0;
  const success = res?.effects?.status?.status === 'success';
  const digest  = res?.digest ?? '';
  if (success) {
    ok(`${label} (${ms}ms)`);
    inf(`TX: https://suivision.xyz/txblock/${digest}`);
  } else {
    err(`${label}: ${res?.effects?.status?.error ?? 'unknown'}`);
  }
  return { ok: success, digest, ms, objectChanges: res?.objectChanges ?? [], error: res?.effects?.status?.error };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${BAR}`);
  console.log('  SuiBets — On-Chain Engine Activation (WARP · FLUX · PULSE)');
  console.log(`  ${new Date().toISOString()}`);
  console.log(BAR);

  // ── Pre-flight ─────────────────────────────────────────────────────────────
  console.log('\n─── PRE-FLIGHT ───');

  let kp, addr;
  try {
    kp   = buildKeypair();
    addr = kp.getPublicKey().toSuiAddress();
    ok(`Keypair loaded — ${addr}`);
  } catch (e) {
    err(`Keypair: ${e.message}`);
    process.exit(1);
  }

  const client = new SuiClient({ url: SUI_RPC });

  // Balance check
  const bal = await client.getBalance({ owner: addr });
  const sui = (Number(bal.totalBalance) / 1e9).toFixed(4);
  if (Number(sui) < 0.05) { err(`Balance ${sui} SUI — too low`); process.exit(1); }
  ok(`Balance: ${sui} SUI`);

  // OracleCap — use env var or auto-discover from wallet
  let oracleCapId = (process.env.P2P_ORACLE_CAP_ID || '').trim();
  if (!oracleCapId) {
    inf('P2P_ORACLE_CAP_ID not set — scanning wallet for OracleCap...');
    const owned = await client.getOwnedObjects({ owner: addr, options: { showType: true }, limit: 50 });
    const cap   = owned.data.find(o => (o.data?.type ?? '').includes('OracleCap'));
    if (!cap) { err(`No OracleCap in wallet ${addr} — set P2P_ORACLE_CAP_ID`); process.exit(1); }
    oracleCapId = cap.data.objectId;
    ok(`OracleCap auto-discovered: ${oracleCapId}`);
  } else {
    ok(`OracleCap: ${oracleCapId}`);
  }

  const results = {};

  // ── STEP 1: PULSE pulse_create_pool ───────────────────────────────────────
  console.log(`\n─── STEP 1: PULSE pulse_create_pool ───`);
  inf(`Package: ${PULSE_PKG}`);
  let pulsePoolId = '';
  try {
    const eventId = `p2p-bet-engine-test-${Date.now()}`;
    const tx = new Transaction();
    const [cA, cB] = tx.splitCoins(tx.gas, [10_000_000n, 10_000_000n]);
    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_create_pool`,
      typeArguments: [SUI_T],
      arguments: [
        cA, cB,
        tx.pure.vector('u8', Array.from(Buffer.from(eventId))),
        tx.pure.vector('u8', Array.from(Buffer.from('Home_Team'))),
        tx.pure.vector('u8', Array.from(Buffer.from('Away_Team'))),
        tx.object(PULSE_STATS),
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(25_000_000);
    const r = await execTx(client, tx, kp, 'PULSE pulse_create_pool', true);
    results.pulseCreate = r;
    if (r.ok) {
      const created = r.objectChanges.find(c => c.type === 'created' && (c.objectType ?? '').includes('PulsePool'));
      pulsePoolId = created?.objectId ?? '';
      if (pulsePoolId) inf(`PulsePool: ${pulsePoolId}`);
    }
  } catch (e) { err(`pulse_create_pool: ${e.message}`); results.pulseCreate = { ok: false, error: e.message }; }

  // ── STEP 2: PULSE pulse_lock_pool ─────────────────────────────────────────
  console.log(`\n─── STEP 2: PULSE pulse_lock_pool ───`);
  if (pulsePoolId) {
    try {
      await sleep(1500);
      const tx = new Transaction();
      tx.moveCall({
        target:        `${PULSE_PKG}::pulse_engine::pulse_lock_pool`,
        typeArguments: [SUI_T],
        arguments: [tx.object(oracleCapId), tx.object(pulsePoolId), tx.object(CLOCK)],
      });
      tx.setGasBudget(20_000_000);
      results.pulseLock = await execTx(client, tx, kp, 'PULSE pulse_lock_pool');
    } catch (e) { err(`pulse_lock_pool: ${e.message}`); results.pulseLock = { ok: false, error: e.message }; }
  } else {
    err('SKIPPED — pool not created'); results.pulseLock = { ok: false, skipped: true };
  }

  // ── STEP 3: PULSE pulse_void_pool ─────────────────────────────────────────
  console.log(`\n─── STEP 3: PULSE pulse_void_pool ───`);
  if (pulsePoolId && results.pulseLock?.ok) {
    try {
      await sleep(1500);
      const tx = new Transaction();
      tx.moveCall({
        target:        `${PULSE_PKG}::pulse_engine::pulse_void_pool`,
        typeArguments: [SUI_T],
        arguments: [tx.object(oracleCapId), tx.object(pulsePoolId), tx.object(PULSE_STATS), tx.object(CLOCK)],
      });
      tx.setGasBudget(20_000_000);
      results.pulseVoid = await execTx(client, tx, kp, 'PULSE pulse_void_pool');
    } catch (e) { err(`pulse_void_pool: ${e.message}`); results.pulseVoid = { ok: false, error: e.message }; }
  } else {
    err('SKIPPED — lock failed or pool missing'); results.pulseVoid = { ok: false, skipped: true };
  }

  // ── STEP 4: WARP warp_batch_marker ────────────────────────────────────────
  console.log(`\n─── STEP 4: WARP warp_batch_marker ───`);
  inf(`Package: ${WARP_PKG}`);
  try {
    await sleep(800);
    const tx = new Transaction();
    tx.moveCall({
      target:    `${WARP_PKG}::warp_engine::warp_batch_marker`,
      arguments: [
        tx.object(oracleCapId),
        tx.object(WARP_STATS),
        tx.pure.u64(1),
        tx.pure.u64(0),
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(20_000_000);
    results.warpMarker = await execTx(client, tx, kp, 'WARP warp_batch_marker');
  } catch (e) { err(`warp_batch_marker: ${e.message}`); results.warpMarker = { ok: false, error: e.message }; }

  // ── STEP 5: FLUX flux_batch_close ─────────────────────────────────────────
  console.log(`\n─── STEP 5: FLUX flux_batch_close ───`);
  inf(`Package: ${FLUX_PKG}`);
  try {
    await sleep(800);
    const tx = new Transaction();
    tx.moveCall({
      target:    `${FLUX_PKG}::flux_engine::flux_batch_close`,
      arguments: [
        tx.object(oracleCapId),
        tx.object(FLUX_STATS),
        tx.pure.u64(1),
        tx.pure.u64(0),
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(20_000_000);
    results.fluxClose = await execTx(client, tx, kp, 'FLUX flux_batch_close');
  } catch (e) { err(`flux_batch_close: ${e.message}`); results.fluxClose = { ok: false, error: e.message }; }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${BAR}`);
  const checks = [
    ['PULSE pulse_create_pool', results.pulseCreate],
    ['PULSE pulse_lock_pool  ', results.pulseLock],
    ['PULSE pulse_void_pool  ', results.pulseVoid],
    ['WARP  warp_batch_marker', results.warpMarker],
    ['FLUX  flux_batch_close ', results.fluxClose],
  ];
  let fails = 0;
  for (const [label, r] of checks) {
    const icon   = !r ? '?' : r.ok ? '✅' : r.skipped ? '⏭ ' : '❌';
    const status = !r ? 'MISSING' : r.ok ? 'PASS' : r.skipped ? 'SKIP' : 'FAIL';
    const detail = r?.digest ? `https://suivision.xyz/txblock/${r.digest}` : r?.error ? String(r.error).slice(0, 80) : '';
    console.log(`  ${icon}  ${label}  ${status}`);
    if (detail) console.log(`       ${detail}`);
    if (!r?.ok && !r?.skipped) fails++;
  }

  console.log(`\n${BAR}`);
  if (fails === 0) {
    console.log('\n  🚀  ALL 3 ENGINES FIRED — visible in Suivision:');
    console.log(`  WARP:  https://suivision.xyz/package/${WARP_PKG}`);
    console.log(`  FLUX:  https://suivision.xyz/package/${FLUX_PKG}`);
    console.log(`  PULSE: https://suivision.xyz/package/${PULSE_PKG}`);
  } else {
    console.log(`\n  ⚠️   ${fails} step(s) failed`);
    if (!RAW_KEY)      console.log('  ➤  Set PRIVATE_KEY or ADMIN_PRIVATE_KEY on Railway');
    if (!oracleCapId)  console.log('  ➤  Set P2P_ORACLE_CAP_ID on Railway (or key must own the cap)');
  }
  console.log(`${BAR}\n`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
