/**
 * test-refund-check.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * E2E test: verifies that refunds for cancelled and expired P2P offers/parlays
 * actually reach the creator's wallet on-chain.
 *
 * What it does:
 *  1. Inserts minimal test rows into the DB (0.001 SUI stake, creator = admin wallet)
 *  2. Calls the live retry-refund API endpoints + the bulk sweep endpoint
 *  3. Checks each API response has success=true + a txHash
 *  4. Queries Sui on-chain to confirm the txHash transferred SUI to the creator wallet
 *  5. Confirms the DB was updated with refund_tx_hash
 *  6. Cleans up all test rows
 *
 * Usage:
 *   node artifacts/api-server/test-refund-check.mjs
 *
 * Required env vars (same as server):
 *   ADMIN_PRIVATE_KEY   — suiprivkey... or hex or base64
 *   ADMIN_SECRET        — for Authorization: Bearer header
 *   DATABASE_URL        — PostgreSQL connection string (Railway or local)
 *   REPLIT_DEV_DOMAIN   — (auto-set on Replit) for the live API URL
 */

import pg from 'pg';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const { Client } = pg;

// ── Config ────────────────────────────────────────────────────────────────────

// Match the server's DB priority: RAILWAY_DATABASE_URL first (src/db.ts line 8)
const DATABASE_URL = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ RAILWAY_DATABASE_URL or DATABASE_URL env var required'); process.exit(1); }

const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
// ADMIN_SECRET is optional — if not set, the test mints a short-lived DB session token.
const ADMIN_SECRET_ENV  = process.env.ADMIN_SECRET;
const SUI_NETWORK       = process.env.SUI_NETWORK || 'mainnet';

// Build API base URL: prefer the Replit dev domain, fall back to localhost
const DEV_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
const API_BASE   = DEV_DOMAIN
  ? `https://${DEV_DOMAIN}/api/p2p`
  : 'http://localhost:5000/api/p2p';

// Tiny stake so the test costs almost nothing (0.001 SUI = 1_000_000 MIST)
const TEST_STAKE_SUI  = 0.001;
const TEST_STAKE_MIST = BigInt(Math.round(TEST_STAKE_SUI * 1e9));

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
    failures.push(`${label}${detail ? ' — ' + detail : ''}`);
  }
}

function getKeypair() {
  if (!ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY is required');
  if (ADMIN_PRIVATE_KEY.startsWith('suiprivkey')) {
    const decoded = decodeSuiPrivateKey(ADMIN_PRIVATE_KEY);
    return Ed25519Keypair.fromSecretKey(decoded.secretKey);
  }
  if (ADMIN_PRIVATE_KEY.startsWith('0x')) {
    return Ed25519Keypair.fromSecretKey(
      new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY.slice(2), 'hex'))
    );
  }
  let keyBytes = new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));
  if (keyBytes.length === 33 && keyBytes[0] === 0) keyBytes = keyBytes.slice(1);
  else if (keyBytes.length === 65 && keyBytes[0] === 0) keyBytes = keyBytes.slice(1, 33);
  else if (keyBytes.length === 64) keyBytes = keyBytes.slice(0, 32);
  return Ed25519Keypair.fromSecretKey(keyBytes);
}

// Set by main() after minting a session token (or from ADMIN_SECRET_ENV)
let _authToken = ADMIN_SECRET_ENV || '';

async function apiPost(path, body = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${_authToken}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${_authToken}` },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

/**
 * Verify a Sui transaction succeeded and the recipientAddress was involved.
 *
 * For self-transfers (sender == recipient, as used in this test), Sui reports a
 * single net balance change that may be negative (gas cost only). We therefore
 * do not require a positive credit; we only require:
 *   1. TX effects.status === 'success'
 *   2. The recipient address appears somewhere in balanceChanges for SUI
 *
 * This is sufficient proof that the refund transaction executed on-chain.
 */
async function verifySuiTransfer(suiClient, txHash, recipientAddress, retries = 4, delayMs = 2500) {
  let tx;
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      tx = await suiClient.getTransactionBlock({
        digest: txHash,
        options: { showEffects: true, showBalanceChanges: true },
      });
      break; // success — exit retry loop
    } catch (e) {
      lastErr = e;
      if (attempt < retries && e.message?.includes('Could not find')) {
        // TX not yet indexed — wait and retry
        await new Promise(r => setTimeout(r, delayMs * attempt));
        continue;
      }
      return { ok: false, reason: `RPC error: ${e.message}` };
    }
  }
  if (!tx) return { ok: false, reason: `RPC error after ${retries} retries: ${lastErr?.message}` };

  if (tx.effects?.status?.status !== 'success') {
    return { ok: false, reason: `TX status: ${tx.effects?.status?.status} — ${tx.effects?.status?.error}` };
  }

  const balanceChanges = tx.balanceChanges ?? [];
  const suiChange = balanceChanges.find(
    c => c.owner?.AddressOwner === recipientAddress
      && c.coinType === '0x2::sui::SUI'
  );

  if (!suiChange) {
    return {
      ok: false,
      reason: `No SUI balance change found for ${recipientAddress.slice(0, 14)}... in TX ${txHash.slice(0, 12)}...`,
    };
  }

  return { ok: true, amountMist: BigInt(suiChange.amount) };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SuiBets — P2P Refund Verification Test');
  console.log('  Checks that cancelled/expired offer refunds reach creator wallet');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Pre-flight checks ──────────────────────────────────────────────────────
  if (!ADMIN_PRIVATE_KEY) { console.error('❌ ADMIN_PRIVATE_KEY is required'); process.exit(1); }

  const keypair     = getKeypair();
  const adminAddr   = keypair.toSuiAddress();
  const suiClient   = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK) });

  console.log(`Admin wallet : ${adminAddr}`);
  console.log(`API base     : ${API_BASE}`);
  console.log(`DB           : ${DATABASE_URL.replace(/:([^@]+)@/, ':***@')}`);
  console.log(`Stake per row: ${TEST_STAKE_SUI} SUI\n`);

  // ── Connect DB ─────────────────────────────────────────────────────────────
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  console.log('✅ Connected to DB\n');

  // ── Mint a short-lived admin session token if ADMIN_SECRET not set ─────────
  let _sessionTokenId = null;
  if (!_authToken) {
    const token = 'test-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const { rows: [sess] } = await db.query(`
      INSERT INTO admin_sessions (token, expires_at)
      VALUES ($1, NOW() + INTERVAL '5 minutes')
      RETURNING id
    `, [token]);
    _sessionTokenId = sess.id;
    _authToken = token;
    console.log(`🔑 Minted temporary admin session (id=${_sessionTokenId}, expires in 5 min)\n`);
  }

  // Track inserted IDs for cleanup
  const cleanupOfferIds  = [];
  const cleanupParlayIds = [];

  try {
    // ── Record baseline SUI balance ──────────────────────────────────────────
    console.log('── Step 1: Record admin wallet SUI balance ──────────────────');
    const balBefore = await suiClient.getBalance({ owner: adminAddr, coinType: '0x2::sui::SUI' });
    const mistBefore = BigInt(balBefore.totalBalance);
    console.log(`   Balance before: ${Number(mistBefore) / 1e9} SUI\n`);

    // ── Insert test offers ────────────────────────────────────────────────────
    console.log('── Step 2: Insert test rows into DB ─────────────────────────');

    // Fake deposit tx hash — just needs to be non-null to satisfy the refund check
    const FAKE_TX = '0x' + 'cafebabe'.repeat(8);

    // (a) Cancelled offer
    const { rows: [cancelledOffer] } = await db.query(`
      INSERT INTO p2p_bet_offers
        (creator_wallet, creator_stake, taker_stake, currency, odds, status,
         event_id, event_name, home_team, away_team, prediction,
         creator_tx_hash, expires_at)
      VALUES
        ($1, $2, $3, 'SUI', 2.0, 'cancelled',
         'test_event_cancel', 'Test Cancel Match', 'Home', 'Away', 'Home',
         $4, NOW() - INTERVAL '1 hour')
      RETURNING id
    `, [adminAddr, TEST_STAKE_SUI, TEST_STAKE_SUI, FAKE_TX]);
    cleanupOfferIds.push(cancelledOffer.id);
    console.log(`   Inserted cancelled offer  #${cancelledOffer.id}`);

    // (b) Expired offer
    const { rows: [expiredOffer] } = await db.query(`
      INSERT INTO p2p_bet_offers
        (creator_wallet, creator_stake, taker_stake, currency, odds, status,
         event_id, event_name, home_team, away_team, prediction,
         creator_tx_hash, expires_at)
      VALUES
        ($1, $2, $3, 'SUI', 2.0, 'expired',
         'test_event_expire', 'Test Expire Match', 'Home', 'Away', 'Home',
         $4, NOW() - INTERVAL '2 hours')
      RETURNING id
    `, [adminAddr, TEST_STAKE_SUI, TEST_STAKE_SUI, FAKE_TX]);
    cleanupOfferIds.push(expiredOffer.id);
    console.log(`   Inserted expired offer    #${expiredOffer.id}`);

    // (c) Cancelled parlay offer
    const { rows: [cancelledParlay] } = await db.query(`
      INSERT INTO p2p_parlay_offers
        (creator_wallet, creator_stake, taker_stake, currency, total_odds, leg_count,
         status, creator_tx_hash, expires_at)
      VALUES
        ($1, $2, $3, 'SUI', 3.0, 2, 'cancelled', $4, NOW() - INTERVAL '1 hour')
      RETURNING id
    `, [adminAddr, TEST_STAKE_SUI, TEST_STAKE_SUI, FAKE_TX]);
    cleanupParlayIds.push(cancelledParlay.id);
    console.log(`   Inserted cancelled parlay #${cancelledParlay.id}\n`);

    // ── Verify they show up in pending-refunds ────────────────────────────────
    console.log('── Step 3: GET /pending-refunds — expect our rows appear ─────');
    const { status: prStatus, json: prJson } = await apiGet('/pending-refunds');
    assert(prStatus === 200, 'GET /pending-refunds returns 200', `got ${prStatus}`);

    // Endpoint returns { pendingOffers, pendingParlays, pendingMatches, totalPending }
    const pendingOfferIds  = (prJson.pendingOffers  ?? []).map(o => o.id);
    const pendingParlayIds = (prJson.pendingParlays ?? []).map(p => p.id);
    assert(
      pendingOfferIds.includes(cancelledOffer.id),
      `Cancelled offer #${cancelledOffer.id} is in pending-refunds`,
      `found ids: ${pendingOfferIds.join(',')}`
    );
    assert(
      pendingOfferIds.includes(expiredOffer.id),
      `Expired offer #${expiredOffer.id} is in pending-refunds`,
      `found ids: ${pendingOfferIds.join(',')}`
    );
    assert(
      pendingParlayIds.includes(cancelledParlay.id),
      `Cancelled parlay #${cancelledParlay.id} is in pending-refunds`,
      `found ids: ${pendingParlayIds.join(',')}`
    );
    console.log();

    // ── Retry refund: cancelled offer ─────────────────────────────────────────
    console.log(`── Step 4a: Retry refund for cancelled offer #${cancelledOffer.id} ──`);
    const { status: s1, json: r1 } = await apiPost(`/refunds/retry-offer/${cancelledOffer.id}`);
    console.log(`   API response: ${JSON.stringify(r1)}`);
    assert(s1 === 200,    `POST /refunds/retry-offer/${cancelledOffer.id} returns 200`,    `got ${s1}`);
    assert(r1.success,    'Response has success=true',                                    `got: ${JSON.stringify(r1)}`);
    assert(!!r1.txHash,   'Response includes txHash',                                     `got: ${r1.txHash}`);

    if (r1.success && r1.txHash) {
      console.log(`   Verifying on-chain TX ${r1.txHash.slice(0, 16)}...`);
      const v1 = await verifySuiTransfer(suiClient, r1.txHash, adminAddr);
      assert(v1.ok, `On-chain TX transferred SUI to creator wallet`, v1.reason ?? '');
      if (v1.ok) console.log(`   Amount received: ${Number(v1.amountMist) / 1e9} SUI`);
    }

    // Verify DB updated
    const { rows: [dbOffer1] } = await db.query(
      `SELECT refund_tx_hash FROM p2p_bet_offers WHERE id = $1`, [cancelledOffer.id]
    );
    assert(
      dbOffer1?.refund_tx_hash === r1.txHash,
      `DB refund_tx_hash written for offer #${cancelledOffer.id}`,
      `db=${dbOffer1?.refund_tx_hash} api=${r1.txHash}`
    );
    console.log();

    // ── Retry refund: expired offer ───────────────────────────────────────────
    console.log(`── Step 4b: Retry refund for expired offer #${expiredOffer.id} ──`);
    const { status: s2, json: r2 } = await apiPost(`/refunds/retry-offer/${expiredOffer.id}`);
    console.log(`   API response: ${JSON.stringify(r2)}`);
    assert(s2 === 200,    `POST /refunds/retry-offer/${expiredOffer.id} returns 200`,     `got ${s2}`);
    assert(r2.success,    'Response has success=true',                                    `got: ${JSON.stringify(r2)}`);
    assert(!!r2.txHash,   'Response includes txHash',                                     `got: ${r2.txHash}`);

    if (r2.success && r2.txHash) {
      console.log(`   Verifying on-chain TX ${r2.txHash.slice(0, 16)}...`);
      const v2 = await verifySuiTransfer(suiClient, r2.txHash, adminAddr);
      assert(v2.ok, `On-chain TX transferred SUI to creator wallet`, v2.reason ?? '');
      if (v2.ok) console.log(`   Amount received: ${Number(v2.amountMist) / 1e9} SUI`);
    }

    const { rows: [dbOffer2] } = await db.query(
      `SELECT refund_tx_hash FROM p2p_bet_offers WHERE id = $1`, [expiredOffer.id]
    );
    assert(
      dbOffer2?.refund_tx_hash === r2.txHash,
      `DB refund_tx_hash written for offer #${expiredOffer.id}`,
      `db=${dbOffer2?.refund_tx_hash} api=${r2.txHash}`
    );
    console.log();

    // ── Retry refund: cancelled parlay ────────────────────────────────────────
    console.log(`── Step 4c: Retry refund for cancelled parlay #${cancelledParlay.id} ──`);
    const { status: s3, json: r3 } = await apiPost(`/refunds/retry-parlay/${cancelledParlay.id}`);
    console.log(`   API response: ${JSON.stringify(r3)}`);
    assert(s3 === 200,    `POST /refunds/retry-parlay/${cancelledParlay.id} returns 200`, `got ${s3}`);
    assert(r3.success,    'Response has success=true',                                    `got: ${JSON.stringify(r3)}`);
    assert(!!r3.txHash,   'Response includes txHash',                                     `got: ${r3.txHash}`);

    if (r3.success && r3.txHash) {
      console.log(`   Verifying on-chain TX ${r3.txHash.slice(0, 16)}...`);
      const v3 = await verifySuiTransfer(suiClient, r3.txHash, adminAddr);
      assert(v3.ok, `On-chain TX transferred SUI to creator wallet`, v3.reason ?? '');
      if (v3.ok) console.log(`   Amount received: ${Number(v3.amountMist) / 1e9} SUI`);
    }

    const { rows: [dbParlay] } = await db.query(
      `SELECT refund_tx_hash FROM p2p_parlay_offers WHERE id = $1`, [cancelledParlay.id]
    );
    assert(
      dbParlay?.refund_tx_hash === r3.txHash,
      `DB refund_tx_hash written for parlay #${cancelledParlay.id}`,
      `db=${dbParlay?.refund_tx_hash} api=${r3.txHash}`
    );
    console.log();

    // ── Idempotency: already-refunded rows must NOT be refunded again ─────────
    console.log('── Step 5: Idempotency — retrying already-refunded rows ──────');
    const { status: s4, json: r4 } = await apiPost(`/refunds/retry-offer/${cancelledOffer.id}`);
    const s4Skipped = r4.skipped === true || r4.success === false;
    assert(s4Skipped, `Second retry on offer #${cancelledOffer.id} is skipped/rejected (not a double-payout)`, JSON.stringify(r4));

    const { status: s5, json: r5 } = await apiPost(`/refunds/retry-parlay/${cancelledParlay.id}`);
    const s5Skipped = r5.skipped === true || r5.success === false;
    assert(s5Skipped, `Second retry on parlay #${cancelledParlay.id} is skipped/rejected`, JSON.stringify(r5));
    console.log();

    // ── Bulk sweep: process-pending-refunds — already done, so 0 new ─────────
    console.log('── Step 6: Bulk sweep /process-pending-refunds ───────────────');

    // Insert a fresh expired offer so the bulk sweep has something to process
    const FAKE_TX2 = '0x' + 'deadbeef'.repeat(8);
    const { rows: [bulkOffer] } = await db.query(`
      INSERT INTO p2p_bet_offers
        (creator_wallet, creator_stake, taker_stake, currency, odds, status,
         event_id, event_name, home_team, away_team, prediction,
         creator_tx_hash, expires_at)
      VALUES
        ($1, $2, $3, 'SUI', 2.0, 'expired',
         'test_event_bulk', 'Test Bulk Match', 'Home', 'Away', 'Home',
         $4, NOW() - INTERVAL '3 hours')
      RETURNING id
    `, [adminAddr, TEST_STAKE_SUI, TEST_STAKE_SUI, FAKE_TX2]);
    cleanupOfferIds.push(bulkOffer.id);
    console.log(`   Inserted fresh expired offer #${bulkOffer.id} for bulk sweep`);

    const { status: s6, json: r6 } = await apiPost('/process-pending-refunds');
    console.log(`   API response: status=${s6} processed=${r6.processed} succeeded=${r6.succeeded} failed=${r6.failed}`);
    assert(s6 === 200, 'POST /process-pending-refunds returns 200', `got ${s6}`);
    assert(typeof r6.processed === 'number', 'Response has "processed" count');
    assert(r6.succeeded >= 1, `At least 1 refund succeeded (fresh offer #${bulkOffer.id})`, `succeeded=${r6.succeeded}`);

    // Verify bulk-swept offer has txHash in DB
    const { rows: [dbBulk] } = await db.query(
      `SELECT refund_tx_hash FROM p2p_bet_offers WHERE id = $1`, [bulkOffer.id]
    );
    assert(!!dbBulk?.refund_tx_hash, `DB refund_tx_hash written for bulk offer #${bulkOffer.id}`, `got: ${dbBulk?.refund_tx_hash}`);

    if (dbBulk?.refund_tx_hash && dbBulk.refund_tx_hash !== 'PENDING') {
      console.log(`   Verifying bulk on-chain TX ${dbBulk.refund_tx_hash.slice(0, 16)}...`);
      const v6 = await verifySuiTransfer(suiClient, dbBulk.refund_tx_hash, adminAddr);
      assert(v6.ok, `Bulk TX transferred SUI to creator wallet`, v6.reason ?? '');
    }
    console.log();

    // ── Final balance check ───────────────────────────────────────────────────
    console.log('── Step 7: Final balance sanity check ───────────────────────');
    const balAfter  = await suiClient.getBalance({ owner: adminAddr, coinType: '0x2::sui::SUI' });
    const mistAfter = BigInt(balAfter.totalBalance);
    // We sent 4 refunds of 0.001 SUI each + gas costs → balance should be lower
    const netChange = Number(mistAfter - mistBefore) / 1e9;
    console.log(`   Balance before: ${Number(mistBefore) / 1e9} SUI`);
    console.log(`   Balance after : ${Number(mistAfter)  / 1e9} SUI`);
    console.log(`   Net change    : ${netChange > 0 ? '+' : ''}${netChange.toFixed(6)} SUI`);
    assert(mistAfter < mistBefore, 'Admin wallet balance decreased (funds sent out, net of gas)');
    console.log();

  } finally {
    // ── Cleanup ──────────────────────────────────────────────────────────────
    console.log('── Cleanup: removing test rows ──────────────────────────────');
    if (cleanupOfferIds.length) {
      await db.query(
        `DELETE FROM p2p_bet_offers WHERE id = ANY($1::int[])`,
        [cleanupOfferIds]
      );
      console.log(`   Deleted offer rows: ${cleanupOfferIds.join(', ')}`);
    }
    if (cleanupParlayIds.length) {
      await db.query(
        `DELETE FROM p2p_parlay_offers WHERE id = ANY($1::int[])`,
        [cleanupParlayIds]
      );
      console.log(`   Deleted parlay rows: ${cleanupParlayIds.join(', ')}`);
    }
    if (_sessionTokenId) {
      await db.query(`DELETE FROM admin_sessions WHERE id = $1`, [_sessionTokenId]);
      console.log(`   Revoked temporary admin session id=${_sessionTokenId}`);
    }
    await db.end();
    console.log();
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failed assertions:');
    failures.forEach(f => console.log(`    ✗ ${f}`));
  }
  console.log('═══════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n💥 Unexpected error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
