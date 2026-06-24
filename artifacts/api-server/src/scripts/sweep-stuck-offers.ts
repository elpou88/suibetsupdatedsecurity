/**
 * sweep-stuck-offers.ts
 * ─────────────────────
 * One-shot admin sweep: finds every expired / open-but-past-expiry offer and
 * parlay on Railway, checks on-chain state, and triggers refund TXs immediately
 * without waiting for the 5-minute settlement scheduler.
 *
 * Usage (local, pointing at prod):
 *   RAILWAY_URL=https://web-production-4d574.up.railway.app \
 *   ADMIN_SECRET=<your_admin_secret> \
 *   pnpm --filter @workspace/api-server run sweep-stuck
 *
 * Or run directly inside Railway via one-off command:
 *   node dist/sweep-stuck-offers.mjs
 */

const RAILWAY_URL = (process.env.RAILWAY_URL ?? 'https://web-production-4d574.up.railway.app').replace(/\/$/, '');
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? '';

if (!ADMIN_SECRET) {
  console.error('❌ ADMIN_SECRET env var is required');
  process.exit(1);
}

const HEADERS = {
  'Authorization': `Bearer ${ADMIN_SECRET}`,
  'Content-Type': 'application/json',
};

const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';

const OK   = (s: string) => console.log(`${GREEN}  ✅  ${s}${RESET}`);
const FAIL = (s: string) => console.log(`${RED}  ❌  ${s}${RESET}`);
const WARN = (s: string) => console.log(`${YELLOW}  ⏳  ${s}${RESET}`);
const INFO = (s: string) => console.log(`${CYAN}  ℹ️   ${s}${RESET}`);

async function apiFetch(path: string, method = 'GET', body?: object) {
  const res = await fetch(`${RAILWAY_URL}${path}`, {
    method,
    headers: HEADERS,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: text }; }
}

async function sweepOffers() {
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  SuiBets — Manual Offer Sweep`);
  console.log(`  Target: ${RAILWAY_URL}`);
  console.log(`${'═'.repeat(62)}\n`);

  // ── 1. Fetch health check ─────────────────────────────────────────
  const health = await apiFetch('/api/health');
  if (health.status !== 200) {
    FAIL(`Railway not responding (HTTP ${health.status})`);
    process.exit(1);
  }
  OK(`Railway is UP — ${JSON.stringify(health.data)}`);

  // ── 2. Fetch all expired + open offers ───────────────────────────
  const now = Date.now();
  const [expiredRes, openRes] = await Promise.all([
    apiFetch('/api/p2p/admin/offers?status=expired&limit=200'),
    apiFetch('/api/p2p/admin/offers?status=open&limit=200'),
  ]);

  if (expiredRes.status !== 200 || openRes.status !== 200) {
    FAIL(`Admin offers endpoint failed — check ADMIN_SECRET. Expired: ${expiredRes.status}, Open: ${openRes.status}`);
    process.exit(1);
  }

  const expiredOffers: any[] = expiredRes.data?.offers ?? [];
  const openOffers:    any[] = openRes.data?.offers ?? [];

  // Open offers that are past their expiry date
  const pastExpiry = openOffers.filter((o: any) => {
    if (!o.expiresAt) return false;
    return new Date(o.expiresAt).getTime() < now;
  });

  // Expired offers that haven't been refunded yet
  const needsRefund = expiredOffers.filter((o: any) =>
    !o.refundTxHash || o.refundTxHash === 'PENDING'
  );

  // Also include expired offers with ONCHAIN_TERMINAL / ON_CHAIN_SETTLED markers (no TX)
  const alreadyTerminal = expiredOffers.filter((o: any) =>
    o.refundTxHash === 'ONCHAIN_TERMINAL' || o.refundTxHash === 'ON_CHAIN_SETTLED'
  );

  INFO(`Expired offers needing refund:   ${needsRefund.length}`);
  INFO(`Open offers past expiry:         ${pastExpiry.length}`);
  INFO(`Already terminal (no TX needed): ${alreadyTerminal.length}`);

  const toExpire = [...needsRefund, ...pastExpiry];

  if (toExpire.length === 0) {
    OK('No stuck offers found — everything looks clean!');
  } else {
    console.log(`\n${'─'.repeat(62)}`);
    console.log(`  Force-expiring ${toExpire.length} offer(s)...`);
    console.log(`${'─'.repeat(62)}`);
  }

  let expiredOk = 0, expiredFail = 0, expiredSkip = 0;

  for (const offer of toExpire) {
    await new Promise(r => setTimeout(r, 800)); // avoid rate limiting
    const r = await apiFetch(`/api/p2p/admin/force-expire/${offer.id}`, 'POST');
    if (r.status === 200 && r.data?.success) {
      OK(`Offer #${offer.id} (${offer.homeTeam ?? '?'} vs ${offer.awayTeam ?? '?'}) → refunded. TX: ${r.data.txHash ?? r.data.refundTxHash ?? '?'}`);
      expiredOk++;
    } else if (r.status === 409 || (typeof r.data === 'object' && r.data?.message?.includes('not reached'))) {
      WARN(`Offer #${offer.id} — on-chain clock not yet at expiry. Will retry next cycle.`);
      expiredSkip++;
    } else if (r.status === 400 && typeof r.data === 'object' && r.data?.message?.includes('already')) {
      INFO(`Offer #${offer.id} — already handled: ${r.data.message}`);
      expiredSkip++;
    } else {
      FAIL(`Offer #${offer.id} — ${r.status}: ${typeof r.data === 'object' ? r.data?.message ?? JSON.stringify(r.data) : r.data}`);
      expiredFail++;
    }
  }

  // ── 3. Fetch expired + open parlays ──────────────────────────────
  const [expParlayRes, openParlayRes] = await Promise.all([
    apiFetch('/api/p2p/admin/parlays?status=expired&limit=200'),
    apiFetch('/api/p2p/admin/parlays?status=open&limit=200'),
  ]);

  const expiredParlays: any[] = expParlayRes.data?.parlays ?? [];
  const openParlays:    any[] = openParlayRes.data?.parlays ?? [];

  const pastExpiryParlays = openParlays.filter((p: any) =>
    p.expiresAt && new Date(p.expiresAt).getTime() < now
  );
  const parlaysNeedRefund = expiredParlays.filter((p: any) =>
    !p.refundTxHash || p.refundTxHash === 'PENDING'
  );

  const toExpireParlays = [...parlaysNeedRefund, ...pastExpiryParlays];

  INFO(`Expired parlays needing refund:  ${parlaysNeedRefund.length}`);
  INFO(`Open parlays past expiry:        ${pastExpiryParlays.length}`);

  let parlayOk = 0, parlayFail = 0, parlaySkip = 0;

  if (toExpireParlays.length > 0) {
    console.log(`\n${'─'.repeat(62)}`);
    console.log(`  Force-expiring ${toExpireParlays.length} parlay(s)...`);
    console.log(`${'─'.repeat(62)}`);

    for (const parlay of toExpireParlays) {
      await new Promise(r => setTimeout(r, 800));
      const r = await apiFetch(`/api/p2p/admin/expire-parlay`, 'POST', { parlayId: parlay.id });
      if (r.status === 200 && r.data?.success) {
        OK(`Parlay #${parlay.id} → refunded. TX: ${r.data.txHash ?? '?'}`);
        parlayOk++;
      } else if (r.status === 409 || r.data?.message?.includes('not reached')) {
        WARN(`Parlay #${parlay.id} — on-chain clock not yet at expiry.`);
        parlaySkip++;
      } else if (r.status === 400 && r.data?.message?.includes('already')) {
        INFO(`Parlay #${parlay.id} — already handled: ${r.data.message}`);
        parlaySkip++;
      } else {
        FAIL(`Parlay #${parlay.id} — ${r.status}: ${typeof r.data === 'object' ? r.data?.message ?? JSON.stringify(r.data) : r.data}`);
        parlayFail++;
      }
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  SWEEP COMPLETE`);
  console.log(`${'─'.repeat(62)}`);
  console.log(`  Offers:  ✅ ${expiredOk} refunded  ⏳ ${expiredSkip} skipped  ❌ ${expiredFail} failed`);
  console.log(`  Parlays: ✅ ${parlayOk} refunded  ⏳ ${parlaySkip} skipped  ❌ ${parlayFail} failed`);
  console.log(`${'═'.repeat(62)}\n`);

  if (expiredFail + parlayFail > 0) process.exit(1);
}

sweepOffers().catch(e => {
  console.error('Sweep crashed:', e);
  process.exit(1);
});
