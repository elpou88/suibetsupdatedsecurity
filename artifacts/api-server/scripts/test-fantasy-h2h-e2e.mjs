/**
 * E2E test: Fantasy H2H full flow
 * Creator posts → Taker accepts → Settlement → Payout to winner
 *
 * Usage: node scripts/test-fantasy-h2h-e2e.mjs [API_BASE]
 * Default API_BASE = http://localhost:8080
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const API_BASE = process.argv[2] || 'http://localhost:8080';
const HEADERS  = { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' };

const CREATOR_WALLET = '0xaaaa000000000000000000000000000000000000000000000000000000000001';
const TAKER_WALLET   = '0xbbbb000000000000000000000000000000000000000000000000000000000002';

// ── helpers ──────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    process.exitCode = 1;
  }
}

// ── seed fantasy teams directly via DB API ───────────────────────────────────
async function seedFantasyTeams(creatorPts, takerPts) {
  // Use the /api/fantasy/team endpoints or raw SQL via the test-seed endpoint.
  // We call the dedicated test endpoint added for seeding.
  const r = await api('POST', '/api/p2p/fantasy/test-seed-teams', {
    teams: [
      { walletAddress: CREATOR_WALLET, totalPoints: creatorPts },
      { walletAddress: TAKER_WALLET,   totalPoints: takerPts   },
    ],
  });
  return r;
}

// ── main test ────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Fantasy H2H E2E Test`);
  console.log(`  API: ${API_BASE}`);
  console.log(`${'═'.repeat(60)}\n`);

  // ── Step 0: health check ──────────────────────────────────────────────────
  console.log('Step 0: API health check');
  const health = await api('GET', '/api/health');
  ok('API reachable', health.status < 500, `HTTP ${health.status}`);

  // ── Step 1: creator posts challenge ──────────────────────────────────────
  console.log('\nStep 1: Creator posts Fantasy H2H challenge (5 SUI stake)');
  const kickoff = new Date(Date.now() + 86400000 * 7).toISOString(); // 7 days out
  const postRes = await api('POST', '/api/p2p/offers', {
    creatorWallet: CREATOR_WALLET,
    eventId:       'fantasy_wc2026_h2h_group',
    eventName:     'Fantasy WC2026 H2H — Group Stage',
    homeTeam:      'Test Creator Team',
    awayTeam:      'Open Challenge',
    leagueName:    'Fantasy World Cup 2026',
    sportName:     'fantasy',
    prediction:    'home',
    marketType:    'fantasy_h2h',
    odds:          2.0,
    creatorStake:  5,
    currency:      'SUI',
    matchDate:     kickoff,
    expiresAt:     kickoff,
    creatorTxHash: 'TEST_CREATOR_TX_' + Date.now(),
  });
  console.log(`  POST /api/p2p/offers → HTTP ${postRes.status}`);
  if (!postRes.ok) {
    console.error('  Response:', JSON.stringify(postRes.json, null, 2));
  }
  ok('Offer created (HTTP 201)', postRes.status === 201);
  const offerId = postRes.json?.offer?.id ?? postRes.json?.id;
  ok('offerId returned', !!offerId, `offerId=${offerId}`);
  ok('marketType=fantasy_h2h', (postRes.json?.offer?.marketType ?? postRes.json?.marketType) === 'fantasy_h2h');

  if (!offerId) {
    console.error('\nCannot continue — no offerId from create step.');
    return;
  }

  // ── Step 2: verify offer is visible ──────────────────────────────────────
  console.log('\nStep 2: Verify offer is visible in /api/p2p/offers');
  const listRes = await api('GET', '/api/p2p/offers?limit=50');
  ok('Offers list OK', listRes.ok);
  const listed = (listRes.json?.offers ?? listRes.json ?? []).find(o => o.id === offerId);
  ok('Offer appears in list', !!listed, `id=${offerId}`);

  // ── Step 3: taker accepts challenge ──────────────────────────────────────
  console.log('\nStep 3: Taker accepts challenge (5 SUI stake)');
  const acceptRes = await api('POST', `/api/p2p/offers/${offerId}/accept`, {
    takerWallet:  TAKER_WALLET,
    stake:        5,
    takerTxHash:  'TEST_TAKER_TX_' + Date.now(),
  });
  console.log(`  POST /api/p2p/offers/${offerId}/accept → HTTP ${acceptRes.status}`);
  if (!acceptRes.ok) {
    console.error('  Response:', JSON.stringify(acceptRes.json, null, 2));
  }
  ok('Challenge accepted (HTTP 201)', acceptRes.status === 201);
  const matchId = acceptRes.json?.id ?? acceptRes.json?.match?.id;
  ok('matchId returned', !!matchId, `matchId=${matchId}`);

  // ── Step 4: seed fantasy points — creator wins ────────────────────────────
  console.log('\nStep 4: Seed fantasy points (creator 85pts vs taker 72pts — creator wins)');
  const seedRes = await seedFantasyTeams(85, 72);
  if (!seedRes.ok) {
    console.log(`  Warning: seed endpoint returned ${seedRes.status} — ${JSON.stringify(seedRes.json)}`);
    console.log('  Attempting fallback: seeding via /api/fantasy/team/lock-points ...');
    // Fallback: try the fantasy team update endpoints
    for (const [wallet, pts] of [[CREATOR_WALLET, 85], [TAKER_WALLET, 72]]) {
      await api('POST', '/api/fantasy/test-set-points', { walletAddress: wallet, totalPoints: pts });
    }
  } else {
    ok('Fantasy teams seeded', seedRes.ok);
  }

  // ── Step 5: trigger test settlement ──────────────────────────────────────
  console.log('\nStep 5: Trigger test settlement (bypasses July 20 date gate)');
  const settleRes = await api('POST', `/api/p2p/fantasy/settle-test/${offerId}`);
  console.log(`  POST /api/p2p/fantasy/settle-test/${offerId} → HTTP ${settleRes.status}`);
  console.log(`  Response: ${JSON.stringify(settleRes.json)}`);
  ok('Settlement triggered OK', settleRes.ok, settleRes.json?.message);

  // ── Step 6: verify final state ───────────────────────────────────────────
  console.log('\nStep 6: Verify offer settled in DB');
  await new Promise(r => setTimeout(r, 800)); // brief wait for DB writes
  const finalOffer = await api('GET', `/api/p2p/offers/${offerId}`);
  // The offer endpoint returns the row directly (or wrapped in {offer:...})
  const offerData = finalOffer.json?.offer ?? finalOffer.json;
  console.log(`  Offer data: status=${offerData?.status}, winner=${offerData?.winner}`);
  ok('Offer status=settled', offerData?.status === 'settled', `status=${offerData?.status}`);
  ok('Winner=creator', offerData?.winner === 'creator', `winner=${offerData?.winner}`);

  // ── Step 7: run tie scenario ──────────────────────────────────────────────
  console.log('\nStep 7: Tie scenario — both 80pts → expect refund + winner=tie');
  const kickoff2 = new Date(Date.now() + 86400000 * 7).toISOString();
  const post2 = await api('POST', '/api/p2p/offers', {
    creatorWallet: CREATOR_WALLET,
    eventId:       'fantasy_wc2026_h2h_group_tie',
    eventName:     'Fantasy WC2026 H2H — Group Stage (Tie test)',
    homeTeam:      'Test Creator Team',
    awayTeam:      'Open Challenge',
    leagueName:    'Fantasy World Cup 2026',
    sportName:     'fantasy',
    prediction:    'home',
    marketType:    'fantasy_h2h',
    odds:          2.0,
    creatorStake:  3,
    currency:      'SUI',
    matchDate:     kickoff2,
    expiresAt:     kickoff2,
    creatorTxHash: 'TEST_TIE_CREATOR_TX_' + Date.now(),
  });
  ok('Tie offer created', post2.status === 201);
  const offerId2 = post2.json?.offer?.id ?? post2.json?.id;

  if (offerId2) {
    const accept2 = await api('POST', `/api/p2p/offers/${offerId2}/accept`, {
      takerWallet:  TAKER_WALLET,
      stake:        3,
      takerTxHash:  'TEST_TIE_TAKER_TX_' + Date.now(),
    });
    ok('Tie offer accepted', accept2.status === 201);

    await seedFantasyTeams(80, 80); // equal points
    const settle2 = await api('POST', `/api/p2p/fantasy/settle-test/${offerId2}`);
    ok('Tie settlement triggered', settle2.ok);

    await new Promise(r => setTimeout(r, 500));
    const final2 = await api('GET', `/api/p2p/offers/${offerId2}`);
    const d2 = final2.json?.offer ?? final2.json;
    ok('Tie offer settled', d2?.status === 'settled', `status=${d2?.status}`);
    ok('Tie winner=tie', d2?.winner === 'tie', `winner=${d2?.winner}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  if (process.exitCode === 1) {
    console.log('  ❌ Some tests FAILED — see above');
  } else {
    console.log('  ✅ ALL TESTS PASSED — Fantasy H2H E2E flow works end-to-end');
  }
  console.log(`${'═'.repeat(60)}\n`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
