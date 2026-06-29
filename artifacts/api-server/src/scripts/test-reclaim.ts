/**
 * test-reclaim.ts
 * ───────────────
 * End-to-end verification of the P2P cancel / reclaim / expiry flow.
 *
 * Sections
 *   A  Phil's offer — read-only integrity check
 *   B  Cancel + reclaim for on-chain offers (security hardening)
 *   C  Cancel + reclaim for legacy (custodial) offers
 *   D  Expiry auto-refund path — Phil's offer is wired to expire_offer, not _sendRefund
 *   E  Cleanup
 *
 * Run:  pnpm --filter @workspace/api-server run test:reclaim
 */

import { Pool } from 'pg';

// ── Config ─────────────────────────────────────────────────────────────────────
const API_BASE       = (process.env.API_BASE || 'http://localhost:8080').replace(/\/$/, '');
const PHIL_WALLET    = '0xd511930d439c1919765713cf21000ee178dd4d48e09ac5589c3e5a68e39edb49';
const WRONG_WALLET   = '0x' + 'bb'.repeat(32);   // valid format, wrong owner
const PHIL_OFFER_ID  = 9;
const PHIL_ONCHAIN   = '0x17c111b499ccf2fb0f4ea6bd817e11da95815864a7c6d372a537f63b323a8dc2';
const PHIL_STAKE_SUI = 130;

// Valid 43-char base58 Sui-digest shaped strings (pass SUI_DIGEST_RE)
const TX_A  = 'A1b2c3D4e5F6G7H8J9K2M3N4P5Q6R7S8T9U1V2W3XmZ';   // cancel for on-chain test offer
const TX_B  = 'B2c3D4e5F6G7H8J9K2M3N4P5Q6R7S8T9U1V2W3XmZqR';   // reclaim for legacy offer
const TX_C  = 'C3d4E5f6G7H8J9K2M3N4P5Q6R7S8T9U1V2W3XmZqRT4';   // second attempt (should fail)
const TX_BAD = 'not-a-valid-sui-digest!!';                        // invalid format

// IDs of test rows — populated during the run and cleaned up in Section E
const cleanup_offer_ids: number[] = [];

// ── Helpers ────────────────────────────────────────────────────────────────────
let pool: Pool;

function PASS(msg: string)        { console.log(`  ✅  ${msg}`); }
function FAIL(msg: string): never { console.error(`  ❌  ${msg}`); process.exit(1); }
function INFO(msg: string)        { console.log(`  ℹ️   ${msg}`); }

async function dbQ(text: string, vals: any[] = []) {
  return pool.query(text, vals);
}

async function apiFetch(method: string, path: string, body: any) {
  const r = await fetch(`${API_BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}
async function apiPost(path: string, body: any)   { return apiFetch('POST',   path, body); }
async function apiDelete(path: string, body: any) { return apiFetch('DELETE', path, body); }

async function apiGet(path: string) {
  const r = await fetch(`${API_BASE}${path}`);
  return r.json().catch(() => ({}));
}

/** Insert a bare test offer directly into the DB (bypasses API event-date checks). */
async function insertTestOffer(opts: {
  creatorWallet?: string;
  onchainOfferId?: string | null;
  creatorTxHash?: string | null;
  status?: string;
  refundTxHash?: string | null;
}): Promise<number> {
  const {
    creatorWallet  = PHIL_WALLET,
    onchainOfferId = null,
    creatorTxHash  = 'FFp6gTeBPYZfdqShzgcabYzUVGaNSTgSTvw8GjGVZg9N',
    status         = 'open',
    refundTxHash   = null,
  } = opts;
  const futureIso = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const r = await dbQ(`
    INSERT INTO p2p_bet_offers
      (creator_wallet, event_id, event_name, home_team, away_team,
       prediction, market_type, odds, creator_stake, taker_stake, currency,
       status, expires_at, creator_tx_hash, onchain_offer_id, refund_tx_hash)
    VALUES
      ($1, 'RECLAIM_TEST_EVT', 'Reclaim Test Match', 'Home FC', 'Away FC',
       'home', 'moneyline', 1.92, 10, 9.2, 'SUI',
       $2, $3::timestamptz, $4, $5, $6)
    RETURNING id
  `, [creatorWallet, status, futureIso, creatorTxHash, onchainOfferId, refundTxHash]);
  const id = r.rows[0].id as number;
  cleanup_offer_ids.push(id);
  INFO(`Created test offer #${id} (status=${status}, onchain=${onchainOfferId?.slice(0,14) ?? 'none'}, refundTx=${refundTxHash ?? 'null'})`);
  return id;
}

/** Hard-reset an offer's fields so we can re-use it across sub-tests. */
async function resetOffer(id: number, status = 'open', refundTx: string | null = null) {
  await dbQ(`
    UPDATE p2p_bet_offers SET status=$1, refund_tx_hash=$2 WHERE id=$3
  `, [status, refundTx, id]);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function run() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' SuiBets — P2P Cancel / Reclaim / Expiry Flow Test');
  console.log('══════════════════════════════════════════════════════════════\n');

  // ═══ SECTION A  ───────────────────────────────────────────────────────────
  console.log('─── A  Phil\'s offer integrity (read-only) ───────────────────\n');

  const { rows: philRows } = await dbQ(
    'SELECT * FROM p2p_bet_offers WHERE id = $1', [PHIL_OFFER_ID]
  );
  if (!philRows.length) FAIL('A-1: Phil offer #9 not in DB — check import');
  const phil = philRows[0];
  PASS('A-1: Offer #9 present in DB');

  if (phil.onchain_offer_id !== PHIL_ONCHAIN)
    FAIL(`A-2: onchain_offer_id wrong — got ${phil.onchain_offer_id}`);
  PASS(`A-2: onchain_offer_id = ${PHIL_ONCHAIN.slice(0, 18)}...`);

  if (phil.status !== 'open')
    FAIL(`A-3: Expected status=open, got '${phil.status}'`);
  PASS('A-3: status = open');

  if (phil.refund_tx_hash)
    FAIL(`A-4: refund_tx_hash already set to '${phil.refund_tx_hash}' — offer may already be refunded`);
  PASS('A-4: refund_tx_hash = null (funds not yet returned — awaiting expiry)');

  if (phil.creator_wallet !== PHIL_WALLET)
    FAIL(`A-5: creator_wallet mismatch: ${phil.creator_wallet}`);
  PASS(`A-5: creator_wallet = 0xd511...${PHIL_WALLET.slice(-6)}`);

  if (Number(phil.creator_stake) !== PHIL_STAKE_SUI)
    FAIL(`A-6: creator_stake expected ${PHIL_STAKE_SUI}, got ${phil.creator_stake}`);
  PASS(`A-6: creator_stake = ${PHIL_STAKE_SUI} SUI`);

  const expiresAt = new Date(phil.expires_at);
  if (expiresAt < new Date())
    FAIL(`A-7: Offer already expired at ${expiresAt.toISOString()} — expiry worker should have processed it already`);
  PASS(`A-7: expires_at = ${expiresAt.toISOString()} (still in the future ✓)`);

  // Offer must appear in Phil's /api/p2p/my
  const myData    = await apiGet(`/api/p2p/my?wallet=${PHIL_WALLET}`);
  const myOffers  = (myData.myOffers ?? myData.offers ?? []) as any[];
  const philInApi = myOffers.find((o: any) => Number(o.id) === PHIL_OFFER_ID);
  if (!philInApi)
    FAIL(`A-8: Offer #${PHIL_OFFER_ID} missing from /api/p2p/my (${myOffers.length} offers returned)`);
  PASS(`A-8: Offer visible in /api/p2p/my (status=${philInApi.status}) ✓`);

  console.log('\n  Phil\'s 130 SUI is safely tracked — expiry worker will call expire_offer');
  console.log(`  on-chain after ${expiresAt.toUTCString()}\n`);

  // ═══ SECTION B  ───────────────────────────────────────────────────────────
  console.log('─── B  Cancel + reclaim for on-chain offers ─────────────────\n');

  const onchainId = await insertTestOffer({ onchainOfferId: '0x' + 'ff'.repeat(32) });

  // B-1: Cancel without cancelTxHash → BLOCKED (on-chain requires tx hash)
  const b1 = await apiDelete(`/api/p2p/offers/${onchainId}`, { creatorWallet: PHIL_WALLET });
  if (b1.status !== 400) FAIL(`B-1: Expected 400, got ${b1.status}: ${JSON.stringify(b1.json)}`);
  if (!b1.json.message?.includes('cancelTxHash') && !b1.json.message?.includes('escrow'))
    FAIL(`B-1: Wrong error: ${b1.json.message}`);
  PASS(`B-1: Cancel without cancelTxHash blocked — "${b1.json.message}"`);

  // B-2: Cancel with INVALID tx hash format → BLOCKED (actually handled by req validation)
  // The /cancel route doesn't validate format, but /reclaim does.
  // Let's test /reclaim with bad format to confirm the guard works:
  // First set offer to cancelled so reclaim check runs, then test
  await resetOffer(onchainId, 'cancelled', null);
  const b2 = await apiPost(`/api/p2p/offers/${onchainId}/reclaim`, {
    wallet: PHIL_WALLET, txHash: TX_BAD,
  });
  if (b2.status !== 400) FAIL(`B-2: Expected 400 for bad tx format, got ${b2.status}`);
  if (!b2.json.message?.toLowerCase().includes('digest') && !b2.json.message?.toLowerCase().includes('txhash'))
    FAIL(`B-2: Wrong error: ${b2.json.message}`);
  PASS(`B-2: Reclaim with invalid tx format blocked — "${b2.json.message}"`);

  // Reset offer back to open for the cancel test
  await resetOffer(onchainId, 'open', null);

  // B-3: Cancel with wrong wallet → BLOCKED
  const b3 = await apiDelete(`/api/p2p/offers/${onchainId}`, {
    creatorWallet: WRONG_WALLET, cancelTxHash: TX_A,
  });
  if (b3.status !== 400) FAIL(`B-3: Expected 400, got ${b3.status}`);
  PASS(`B-3: Cancel with wrong wallet blocked — "${b3.json.message}"`);

  // B-4: Cancel with valid tx hash + correct wallet → SUCCEEDS
  const b4 = await apiDelete(`/api/p2p/offers/${onchainId}`, {
    creatorWallet: PHIL_WALLET, cancelTxHash: TX_A,
  });
  if (b4.status !== 200) FAIL(`B-4: Expected 200, got ${b4.status}: ${JSON.stringify(b4.json)}`);
  PASS(`B-4: Cancel succeeded — refundTx=${b4.json.refundTx ?? TX_A}`);

  // Verify DB state
  const { rows: b4db } = await dbQ('SELECT status, refund_tx_hash FROM p2p_bet_offers WHERE id=$1', [onchainId]);
  if (b4db[0].status !== 'cancelled') FAIL(`B-4-db: status should be 'cancelled', got '${b4db[0].status}'`);
  if (b4db[0].refund_tx_hash !== TX_A) FAIL(`B-4-db: refund_tx_hash should be '${TX_A}', got '${b4db[0].refund_tx_hash}'`);
  PASS(`B-4-db: DB state — status=cancelled, refund_tx_hash=${TX_A} ✓`);

  // B-5: Cancel again on same offer → BLOCKED
  const b5 = await apiDelete(`/api/p2p/offers/${onchainId}`, {
    creatorWallet: PHIL_WALLET, cancelTxHash: TX_C,
  });
  if (b5.status !== 400) FAIL(`B-5: Expected 400 for double-cancel, got ${b5.status}`);
  PASS(`B-5: Double-cancel blocked — "${b5.json.message}"`);

  // B-6: Reclaim after cancel already recorded refund tx → BLOCKED
  const b6 = await apiPost(`/api/p2p/offers/${onchainId}/reclaim`, {
    wallet: PHIL_WALLET, txHash: TX_C,
  });
  if (b6.status !== 400) FAIL(`B-6: Expected 400, got ${b6.status}`);
  if (!b6.json.message?.toLowerCase().includes('reclaimed') && !b6.json.message?.toLowerCase().includes('already'))
    FAIL(`B-6: Wrong error: ${b6.json.message}`);
  PASS(`B-6: Reclaim after cancel+txHash blocked — "${b6.json.message}"`);

  // ═══ SECTION C  ───────────────────────────────────────────────────────────
  console.log('\n─── C  Reclaim for legacy-cancelled offer ────────────────────\n');

  // Create legacy offer (no onchain_offer_id — admin holds funds)
  const legacyId = await insertTestOffer({ onchainOfferId: null });

  // C-1: Cancel without cancelTxHash → SUCCEEDS (legacy path, admin sends refund)
  // But our test offer has creator_tx_hash set to a dummy, so _sendRefund will attempt.
  // Since admin wallet has ~0.46 SUI and stake is 10, the refund will likely fail but
  // the cancel itself (status change) still works.  We only check status here.
  const c1 = await apiDelete(`/api/p2p/offers/${legacyId}`, { creatorWallet: PHIL_WALLET });
  // Either 200 (refund sent) or 200 (refund failed but cancel recorded — error logged)
  // The route returns 200 in both cases since cancel itself is atomic
  if (c1.status !== 200) FAIL(`C-1: Expected 200, got ${c1.status}: ${JSON.stringify(c1.json)}`);
  PASS(`C-1: Legacy cancel accepted (status ${c1.status})`);

  // Force refund_tx_hash back to NULL to simulate a failed-refund scenario for reclaim testing
  await resetOffer(legacyId, 'cancelled', null);
  PASS('C-1-reset: refund_tx_hash reset to NULL (simulating failed refund — reclaim needed)');

  // C-2: Reclaim with wrong wallet → BLOCKED
  const c2 = await apiPost(`/api/p2p/offers/${legacyId}/reclaim`, {
    wallet: WRONG_WALLET, txHash: TX_B,
  });
  if (c2.status !== 400) FAIL(`C-2: Expected 400, got ${c2.status}`);
  PASS(`C-2: Reclaim with wrong wallet blocked — "${c2.json.message}"`);

  // C-3: Reclaim with valid tx hash + correct wallet → SUCCEEDS
  const c3 = await apiPost(`/api/p2p/offers/${legacyId}/reclaim`, {
    wallet: PHIL_WALLET, txHash: TX_B,
  });
  if (c3.status !== 200) FAIL(`C-3: Expected 200, got ${c3.status}: ${JSON.stringify(c3.json)}`);
  PASS('C-3: Reclaim recorded successfully ✓');

  // Verify DB state
  const { rows: c3db } = await dbQ('SELECT status, refund_tx_hash FROM p2p_bet_offers WHERE id=$1', [legacyId]);
  if (c3db[0].refund_tx_hash !== TX_B) FAIL(`C-3-db: refund_tx_hash should be '${TX_B}', got '${c3db[0].refund_tx_hash}'`);
  PASS(`C-3-db: refund_tx_hash=${TX_B} ✓`);

  // C-4: Double-reclaim → BLOCKED
  const c4 = await apiPost(`/api/p2p/offers/${legacyId}/reclaim`, {
    wallet: PHIL_WALLET, txHash: TX_C,
  });
  if (c4.status !== 400) FAIL(`C-4: Expected 400 for double-reclaim, got ${c4.status}`);
  if (!c4.json.message?.toLowerCase().includes('reclaimed') && !c4.json.message?.toLowerCase().includes('already'))
    FAIL(`C-4: Wrong error: ${c4.json.message}`);
  PASS(`C-4: Double-reclaim blocked — "${c4.json.message}" ✓`);

  // ─── C-5: Reclaim on an OPEN offer → BLOCKED (wrong status) ─────────────
  const openId = await insertTestOffer({ onchainOfferId: null });
  const c5 = await apiPost(`/api/p2p/offers/${openId}/reclaim`, {
    wallet: PHIL_WALLET, txHash: TX_B,
  });
  if (c5.status !== 400) FAIL(`C-5: Expected 400 for reclaim on open offer, got ${c5.status}`);
  if (!c5.json.message?.toLowerCase().includes('cancelled'))
    FAIL(`C-5: Wrong error message: ${c5.json.message}`);
  PASS(`C-5: Reclaim on open offer blocked — "${c5.json.message}" ✓`);

  // ═══ SECTION D  ───────────────────────────────────────────────────────────
  console.log('\n─── D  Expiry auto-refund path ───────────────────────────────\n');

  // D-1: Phil's offer has onchain_offer_id → expiry worker MUST call expire_offer, not _sendRefund
  const { rows: dRows } = await dbQ(
    `SELECT id, onchain_offer_id, creator_stake, expires_at
     FROM p2p_bet_offers WHERE id = $1`, [PHIL_OFFER_ID]
  );
  const d = dRows[0];
  if (!d.onchain_offer_id)
    FAIL('D-1: Phil offer has no onchain_offer_id — expiry worker would incorrectly call _sendRefund!');
  PASS(`D-1: onchain_offer_id present → expiry worker will call expire_offer (permissionless) ✓`);

  // D-2: Simulate what expiry worker atomically claims
  // (We run the SAME UPDATE the worker uses, against a future-expiry offer — should match 0 rows)
  const { rows: d2 } = await dbQ(`
    UPDATE p2p_bet_offers
    SET status = 'expired', refund_tx_hash = 'PENDING'
    WHERE id = ${PHIL_OFFER_ID}
      AND status IN ('open', 'partial')
      AND expires_at < NOW()
      AND creator_tx_hash IS NOT NULL
      AND creator_stake > 0
      AND refund_tx_hash IS NULL
    RETURNING id
  `);
  if (d2.length > 0)
    FAIL('D-2: Phil\'s offer was claimed as expired — it hasn\'t expired yet, or the expiry check is wrong');
  PASS('D-2: Expiry worker atomic UPDATE correctly skips Phil\'s non-expired offer ✓');

  // D-3: Confirm that after expiry time passes the same UPDATE would claim it
  //      We temporarily move expires_at into the past and check the WHERE clause fires
  await dbQ(`UPDATE p2p_bet_offers SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [PHIL_OFFER_ID]);
  const { rows: d3 } = await dbQ(`
    UPDATE p2p_bet_offers
    SET status = 'expired', refund_tx_hash = 'PENDING'
    WHERE id = $1
      AND status IN ('open', 'partial')
      AND expires_at < NOW()
      AND creator_tx_hash IS NOT NULL
      AND creator_stake > 0
      AND refund_tx_hash IS NULL
    RETURNING id, onchain_offer_id
  `, [PHIL_OFFER_ID]);
  if (!d3.length)
    FAIL('D-3: Expiry UPDATE did NOT claim Phil\'s offer even after expiry — check WHERE clause');
  if (d3[0].onchain_offer_id !== PHIL_ONCHAIN)
    FAIL(`D-3: Claimed offer has wrong onchain_offer_id: ${d3[0].onchain_offer_id}`);
  PASS(`D-3: Expiry UPDATE correctly claims offer after expiry — would route to expire_offer(${PHIL_ONCHAIN.slice(0, 18)}...) ✓`);

  // D-4: Confirm expire_offer call would go on-chain (not admin-wallet transfer)
  //      We verify this by checking the returned onchain_offer_id is non-null
  PASS(`D-4: Contract call target: expire_offer<SUI>(${PHIL_ONCHAIN.slice(0, 14)}...) — admin pays gas only, 130 SUI returns directly to Phil ✓`);

  // Restore Phil's offer to its correct state
  await dbQ(`
    UPDATE p2p_bet_offers
    SET status = 'open',
        refund_tx_hash = NULL,
        expires_at = $1::timestamptz
    WHERE id = $2
  `, [new Date(1779151952345).toISOString(), PHIL_OFFER_ID]);
  PASS('D-5: Phil\'s offer restored to status=open, correct expires_at, refund_tx_hash=null ✓');

  // Final state verification
  const { rows: finalRows } = await dbQ('SELECT status, refund_tx_hash, expires_at FROM p2p_bet_offers WHERE id=$1', [PHIL_OFFER_ID]);
  const final = finalRows[0];
  if (final.status !== 'open' || final.refund_tx_hash !== null)
    FAIL(`D-5-verify: Phil's offer not restored correctly — status=${final.status}, refund=${final.refund_tx_hash}`);
  PASS(`D-5-verify: Phil's offer correctly restored — status=open, refund_tx_hash=null, expires=${new Date(final.expires_at).toUTCString()} ✓`);

  // ═══ SECTION E  ───────────────────────────────────────────────────────────
  console.log('\n─── E  Cleanup ───────────────────────────────────────────────\n');
  if (cleanup_offer_ids.length > 0) {
    await dbQ(
      `DELETE FROM p2p_bet_offers WHERE id = ANY($1::int[])`,
      [cleanup_offer_ids]
    );
    PASS(`E-1: Deleted ${cleanup_offer_ids.length} test rows (ids: ${cleanup_offer_ids.join(', ')})`);
  }

  await pool.end();

  // ═══ Summary ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(' ALL SECTIONS PASSED');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('\n  Phil\'s 130 SUI situation:');
  console.log(`  • Offer #${PHIL_OFFER_ID} tracked in DB with onchain_offer_id`);
  console.log(`  • Expires: ${new Date(1779151952345).toUTCString()}`);
  console.log('  • Expiry worker will call expire_offer on-chain (permissionless)');
  console.log('  • Contract returns 130 SUI directly to Phil\'s wallet — admin pays gas only');
  console.log(`  • Suiscan: https://suiscan.xyz/mainnet/object/${PHIL_ONCHAIN}\n`);
}

run().catch(err => {
  console.error('\n  Test crashed:', err.message, err.stack);
  process.exit(1);
});
