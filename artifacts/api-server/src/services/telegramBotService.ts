/**
 * SuiBets Telegram Bot — webhook + long-polling mode
 * Commands: /start /startminiapp /app /offers /parlays /top /sports /price /share /leaderboard /stats /settled /mybets /link /bet /watch /unwatch /notify /unnotify /help
 */

import postgres from 'postgres';

const TOKEN      = process.env.TELEGRAM_BOT_TOKEN ?? '';
const BASE       = `https://api.telegram.org/bot${TOKEN}`;
const APP_URL    = process.env.TELEGRAM_APP_URL ?? 'https://web-production-4d574.up.railway.app';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID ? Number(process.env.TELEGRAM_CHANNEL_ID) : null;

// In-memory stores (reset on restart — fine for MVP)
const subscribers      = new Set<number>();
const linkedWallets    = new Map<number, string>(); // chatId → 0x wallet
const notifySubs       = new Map<number, string>(); // chatId → 0x wallet (personal bet alerts)
const offerStatusCache = new Map<string, string>(); // `${chatId}:${offerId}` → last known status
let   lastSeenOfferId  = 0;

// ── Security ────────────────────────────────────────────────────────────────────
const SUI_WALLET_RE = /^0x[0-9a-fA-F]{64}$/;
function isValidSuiWallet(w: unknown): w is string {
  return typeof w === 'string' && SUI_WALLET_RE.test(w);
}

// Per-chatId rate limiting — max 1 command per RATE_MS ms
const RATE_MS = 3_000;
const lastCmd = new Map<number, number>();
function isRateLimited(chatId: number): boolean {
  const now = Date.now();
  const last = lastCmd.get(chatId) ?? 0;
  if (now - last < RATE_MS) return true;
  lastCmd.set(chatId, now);
  return false;
}

// ── DB ─────────────────────────────────────────────────────────────────────────
const DB_URL = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL || '';
let pgClient: ReturnType<typeof postgres> | null = null;
function getDb() {
  if (!pgClient && DB_URL) {
    pgClient = postgres(DB_URL, { max: 3, idle_timeout: 20, connect_timeout: 10 });
  }
  return pgClient;
}

// ── Data fetchers ───────────────────────────────────────────────────────────────
async function fetchOffers(limit = 20, sportFilter?: string): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  const rows = sportFilter
    ? await db`
        SELECT id, event_name, home_team, away_team, sport_name, league_name,
               prediction, market_type, odds, creator_stake, taker_stake,
               currency, filled_stake, status, expires_at, created_at
        FROM   p2p_bet_offers
        WHERE  status = 'open'
          AND  expires_at > NOW()
          AND  (LOWER(sport_name) LIKE ${'%' + sportFilter.toLowerCase() + '%'}
                OR LOWER(league_name) LIKE ${'%' + sportFilter.toLowerCase() + '%'})
        ORDER  BY id DESC
        LIMIT  ${limit}
      `
    : await db`
        SELECT id, event_name, home_team, away_team, sport_name, league_name,
               prediction, market_type, odds, creator_stake, taker_stake,
               currency, filled_stake, status, expires_at, created_at
        FROM   p2p_bet_offers
        WHERE  status = 'open'
          AND  expires_at > NOW()
        ORDER  BY id DESC
        LIMIT  ${limit}
      `;
  return rows.map((r: any) => ({
    id:           r.id,
    eventName:    r.event_name,
    homeTeam:     r.home_team,
    awayTeam:     r.away_team,
    sportName:    r.sport_name,
    leagueName:   r.league_name,
    prediction:   r.prediction,
    marketType:   r.market_type,
    odds:         r.odds,
    creatorStake: r.creator_stake,
    takerStake:   r.taker_stake,
    currency:     r.currency,
    filledStake:  r.filled_stake,
    status:       r.status,
    expiresAt:    r.expires_at,
    createdAt:    r.created_at,
  }));
}

async function fetchOfferById(id: number): Promise<any | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db`
    SELECT id, event_name, home_team, away_team, sport_name, league_name,
           prediction, market_type, odds, creator_stake, taker_stake,
           currency, filled_stake, status, expires_at, creator_wallet
    FROM   p2p_bet_offers
    WHERE  id = ${id}
    LIMIT  1
  `;
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id:           r.id,
    eventName:    r.event_name,
    homeTeam:     r.home_team,
    awayTeam:     r.away_team,
    sportName:    r.sport_name,
    leagueName:   r.league_name,
    prediction:   r.prediction,
    marketType:   r.market_type,
    odds:         r.odds,
    creatorStake: r.creator_stake,
    takerStake:   r.taker_stake,
    currency:     r.currency,
    filledStake:  r.filled_stake,
    status:       r.status,
    expiresAt:    r.expires_at,
    creatorWallet: r.creator_wallet,
  };
}

async function fetchTopOffers(limit = 6): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db`
    SELECT id, event_name, home_team, away_team, sport_name, league_name,
           prediction, market_type, odds, creator_stake, taker_stake,
           currency, filled_stake, status, expires_at
    FROM   p2p_bet_offers
    WHERE  status = 'open'
      AND  expires_at > NOW()
    ORDER  BY (creator_stake + taker_stake) DESC NULLS LAST
    LIMIT  ${limit}
  `;
  return rows.map((r: any) => ({
    id:           r.id,
    eventName:    r.event_name,
    homeTeam:     r.home_team,
    awayTeam:     r.away_team,
    sportName:    r.sport_name,
    leagueName:   r.league_name,
    prediction:   r.prediction,
    odds:         r.odds,
    creatorStake: r.creator_stake,
    takerStake:   r.taker_stake,
    currency:     r.currency,
    filledStake:  r.filled_stake,
    status:       r.status,
    expiresAt:    r.expires_at,
  }));
}

async function fetchParlays(limit = 10): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  return db`
    SELECT p.id, p.creator_wallet, p.taker_wallet, p.leg_count,
           p.total_odds, p.creator_stake, p.taker_stake, p.currency,
           p.status, p.expires_at, p.created_at,
           COALESCE(
             json_agg(json_build_object(
               'eventName', l.event_name,
               'homeTeam',  l.home_team,
               'awayTeam',  l.away_team,
               'prediction',l.prediction,
               'odds',      l.odds
             )) FILTER (WHERE l.id IS NOT NULL),
             '[]'
           ) AS legs
    FROM   p2p_parlay_offers p
    LEFT JOIN p2p_parlay_legs l ON l.parlay_offer_id = p.id
    WHERE  p.status = 'open'
      AND  p.expires_at > NOW()
    GROUP  BY p.id
    ORDER  BY p.id DESC
    LIMIT  ${limit}
  `;
}

async function fetchLeaderboard(limit = 10): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  // Real-time aggregation across singles + parlays (both maker + taker sides).
  // p2p_volume_stats is a snapshot cache that may be empty — never use it here.
  return db`
    WITH maker AS (
      SELECT creator_wallet                                                             AS wallet,
             COUNT(*)::int                                                              AS bets,
             COALESCE(SUM(CASE WHEN currency='SUI'   THEN creator_stake ELSE 0 END),0)::float AS vol_sui,
             COALESCE(SUM(CASE WHEN currency='SBETS' THEN creator_stake ELSE 0 END),0)::float AS vol_sbets,
             COUNT(*) FILTER (WHERE winner='creator')::int                             AS wins,
             COUNT(*) FILTER (WHERE winner='taker')::int                               AS losses
      FROM   p2p_bet_offers
      WHERE  creator_wallet IS NOT NULL
      GROUP  BY creator_wallet
    ),
    taker AS (
      SELECT m.taker_wallet                                                             AS wallet,
             COUNT(*)::int                                                              AS bets,
             COALESCE(SUM(CASE WHEN o.currency='SUI'   THEN m.stake ELSE 0 END),0)::float AS vol_sui,
             COALESCE(SUM(CASE WHEN o.currency='SBETS' THEN m.stake ELSE 0 END),0)::float AS vol_sbets,
             COUNT(*) FILTER (WHERE m.status='won')::int                               AS wins,
             COUNT(*) FILTER (WHERE m.status='lost')::int                              AS losses
      FROM   p2p_bet_matches m
      JOIN   p2p_bet_offers  o ON o.id = m.offer_id
      WHERE  m.taker_wallet IS NOT NULL
      GROUP  BY m.taker_wallet
    ),
    parlay_maker AS (
      SELECT creator_wallet                                                             AS wallet,
             COUNT(*) FILTER (WHERE status IN ('open','filled','settled','cancelled'))::int AS bets,
             COALESCE(SUM(creator_stake) FILTER (WHERE status IN ('open','filled','settled')),0)::float AS vol_sui,
             0::float                                                                   AS vol_sbets,
             COUNT(*) FILTER (WHERE winner='creator')::int                             AS wins,
             COUNT(*) FILTER (WHERE winner='taker')::int                               AS losses
      FROM   p2p_parlay_offers
      WHERE  creator_wallet IS NOT NULL
      GROUP  BY creator_wallet
    ),
    parlay_taker AS (
      SELECT taker_wallet                                                               AS wallet,
             COUNT(*) FILTER (WHERE status IN ('filled','settled') AND taker_wallet IS NOT NULL)::int AS bets,
             COALESCE(SUM(taker_stake) FILTER (WHERE status IN ('filled','settled') AND taker_wallet IS NOT NULL),0)::float AS vol_sui,
             0::float                                                                   AS vol_sbets,
             COUNT(*) FILTER (WHERE winner='taker')::int                               AS wins,
             COUNT(*) FILTER (WHERE winner='creator')::int                             AS losses
      FROM   p2p_parlay_offers
      WHERE  taker_wallet IS NOT NULL
      GROUP  BY taker_wallet
    ),
    combined AS (
      SELECT wallet, bets, vol_sui, vol_sbets, wins, losses FROM maker
      UNION ALL
      SELECT wallet, bets, vol_sui, vol_sbets, wins, losses FROM taker
      UNION ALL
      SELECT wallet, bets, vol_sui, vol_sbets, wins, losses FROM parlay_maker
      UNION ALL
      SELECT wallet, bets, vol_sui, vol_sbets, wins, losses FROM parlay_taker
    )
    SELECT wallet                           AS wallet_address,
           SUM(vol_sui)::float             AS vol_sui,
           SUM(vol_sbets)::float           AS vol_sbets,
           SUM(wins)::int                  AS wins,
           SUM(losses)::int                AS losses,
           SUM(bets)::int                  AS total_bets
    FROM   combined
    WHERE  wallet IS NOT NULL AND wallet <> ''
    GROUP  BY wallet
    HAVING SUM(bets) > 0
    ORDER  BY SUM(vol_sui) DESC NULLS LAST
    LIMIT  ${limit}
  `;
}

async function fetchPlatformStats(): Promise<any> {
  const db = getDb();
  if (!db) return null;
  const [offers, parlays, matched, volume, uniqueWallets] = await Promise.all([
    db`SELECT COUNT(*)::int AS n FROM p2p_bet_offers WHERE status = 'open'`,
    db`SELECT COUNT(*)::int AS n FROM p2p_parlay_offers WHERE status = 'open'`,
    db`SELECT COUNT(*)::int AS n FROM p2p_bet_offers WHERE status IN ('matched','settled')`,
    db`
      SELECT
        COALESCE(SUM(CASE WHEN currency='SUI'   THEN creator_stake ELSE 0 END),0)::float AS sui,
        COALESCE(SUM(CASE WHEN currency='SBETS' THEN creator_stake ELSE 0 END),0)::float AS sbets
      FROM p2p_bet_offers
    `,
    db`SELECT COUNT(DISTINCT creator_wallet)::int AS n FROM p2p_bet_offers`,
  ]);
  return {
    openOffers:    offers[0]?.n   ?? 0,
    openParlays:   parlays[0]?.n  ?? 0,
    totalMatched:  matched[0]?.n  ?? 0,
    suiVolume:     volume[0]?.sui ?? 0,
    sbetsVolume:   volume[0]?.sbets ?? 0,
    uniqueWallets: uniqueWallets[0]?.n ?? 0,
  };
}

async function fetchSettledTape(limit = 8): Promise<any[]> {
  const db = getDb();
  if (!db) return [];
  return db`
    SELECT 'single' AS type,
           o.id, o.event_name, o.home_team, o.away_team, o.prediction,
           o.sport_name,
           COALESCE(o.odds,1)::float             AS odds,
           COALESCE(o.creator_stake,0)::float    AS creator_stake,
           COALESCE(o.taker_stake,0)::float      AS taker_stake,
           o.winner, o.creator_wallet,
           m.taker_wallet,
           m.actual_payout::float                AS payout_amount,
           o.settled_at,
           NULL::text                            AS leg_count,
           COALESCE(o.currency,'SUI')            AS currency
    FROM   p2p_bet_offers o
    LEFT JOIN LATERAL (
      SELECT taker_wallet, actual_payout FROM p2p_bet_matches WHERE offer_id = o.id LIMIT 1
    ) m ON true
    WHERE  o.status = 'settled' AND o.settled_at IS NOT NULL

    UNION ALL

    SELECT 'parlay' AS type,
           p.id, NULL, NULL, NULL, 'parlay',
           NULL,
           COALESCE(p.total_odds,1)::float,
           COALESCE(p.creator_stake,0)::float,
           COALESCE(p.taker_stake,0)::float,
           p.winner, p.creator_wallet, p.taker_wallet,
           p.actual_payout::float,
           p.settled_at, p.leg_count::text,
           COALESCE(p.currency,'SUI')
    FROM   p2p_parlay_offers p
    WHERE  p.status = 'settled' AND p.settled_at IS NOT NULL

    ORDER  BY settled_at DESC NULLS LAST
    LIMIT  ${limit}
  `;
}

async function fetchMyBets(wallet: string): Promise<any> {
  const db = getDb();
  if (!db) return null;
  const [offers, parlays, matched] = await Promise.all([
    db`
      SELECT id, event_name, prediction, odds, creator_stake, currency, status, settled_at, winner, expires_at
      FROM   p2p_bet_offers
      WHERE  creator_wallet = ${wallet}
      ORDER  BY id DESC LIMIT 10
    `,
    db`
      SELECT id, leg_count, total_odds, creator_stake, currency, status, settled_at, winner, expires_at
      FROM   p2p_parlay_offers
      WHERE  creator_wallet = ${wallet}
      ORDER  BY id DESC LIMIT 5
    `,
    db`
      SELECT m.id, o.event_name, m.taker_wallet, m.actual_payout, o.currency,
             m.status, o.settled_at, m.winner, m.offer_id
      FROM   p2p_bet_matches m
      JOIN   p2p_bet_offers  o ON o.id = m.offer_id
      WHERE  m.taker_wallet = ${wallet}
      ORDER  BY m.id DESC LIMIT 10
    `,
  ]);
  return { offers, parlays, matched };
}

// CoinGecko free-tier price fetch (no key needed)
let priceCache: { data: any; fetchedAt: number } = { data: null, fetchedAt: 0 };
async function fetchSuiPrice(): Promise<{ sui: number; suiChange: number } | null> {
  if (Date.now() - priceCache.fetchedAt < 60_000 && priceCache.data) return priceCache.data;
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(5000) },
    );
    const json = await res.json();
    const data = { sui: json?.sui?.usd ?? 0, suiChange: json?.sui?.usd_24h_change ?? 0 };
    priceCache = { data, fetchedAt: Date.now() };
    return data;
  } catch {
    return priceCache.data ?? null;
  }
}

// ── Telegram API ────────────────────────────────────────────────────────────────
async function tg(method: string, body: Record<string, unknown> = {}): Promise<any> {
  try {
    const res = await fetch(`${BASE}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) console.warn(`[TelegramBot] ${method} error:`, json.description);
    return json;
  } catch (e: any) {
    console.warn(`[TelegramBot] fetch error on ${method}:`, e.message);
    return { ok: false };
  }
}

async function send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
}

// ── Formatting helpers ──────────────────────────────────────────────────────────
const SPORT_EMOJI: Record<string, string> = {
  football: '⚽', soccer: '⚽', basketball: '🏀', baseball: '⚾',
  tennis: '🎾', mma: '🥊', boxing: '🥊', rugby: '🏉', cricket: '🏏',
  hockey: '🏒', volleyball: '🏐', formula1: '🏎', 'formula 1': '🏎', f1: '🏎',
  golf: '⛳', esports: '🎮', darts: '🎯', snooker: '🎱', cycling: '🚴',
  swimming: '🏊', athletics: '🏃', handball: '🤾', afl: '🏈', nfl: '🏈',
  fantasy: '🌟', 'fantasy h2h': '🌟',
};
const sportEmoji = (s?: string) => SPORT_EMOJI[s?.toLowerCase() ?? ''] ?? '🏆';

function sportLabel(o: any): string {
  if (o.sportName && o.sportName !== 'null') return o.sportName;
  if (o.leagueName && o.leagueName !== 'null') return o.leagueName;
  return 'P2P Bet';
}

function formatAmt(n: number, cur: string) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M ${cur}`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K ${cur}`;
  return `${n.toFixed(2)} ${cur}`;
}

function shortWallet(w?: string) {
  if (!w || w.length < 10) return w ?? '???';
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function formatOffer(o: any, idx?: number): string {
  const sport = sportLabel(o);
  const em    = sportEmoji(sport);
  const num   = idx !== undefined ? `<b>${idx + 1}.</b> ` : '';
  const odds  = Number(o.odds).toFixed(2);
  const ts    = Number(o.takerStake)   || 0;
  const cs    = Number(o.creatorStake) || 0;
  const cur   = o.currency ?? 'SUI';
  const exp   = o.expiresAt
    ? new Date(o.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—';
  return (
    `${num}${em} <b>${o.eventName ?? `${o.homeTeam} vs ${o.awayTeam}`}</b>\n` +
    `📅 ${exp}  •  ${sport}\n` +
    `🎯 Pick: <b>${o.prediction}</b>  @  <b>${odds}x</b>\n` +
    `💰 Your stake: <b>${formatAmt(ts, cur)}</b>  |  🏆 Win: <b>${formatAmt(cs + ts, cur)}</b>\n` +
    `🔗 <a href="${APP_URL}/p2p/offer/${o.id}">Accept offer #${o.id} →</a>`
  );
}

function formatParlay(p: any, idx?: number): string {
  const num  = idx !== undefined ? `<b>${idx + 1}.</b> ` : '';
  const odds = Number(p.total_odds ?? p.totalOdds).toFixed(2);
  const cs   = Number(p.creator_stake ?? p.creatorStake) || 0;
  const ts   = Number(p.taker_stake  ?? p.takerStake)   || 0;
  const cur  = p.currency ?? 'SUI';
  const legs = Number(p.leg_count ?? p.legCount) || 0;
  const exp  = p.expires_at
    ? new Date(p.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—';
  const legSummary = Array.isArray(p.legs) && p.legs.length
    ? p.legs.slice(0, 3).map((l: any) =>
        `  • ${l.homeTeam ?? '?'} vs ${l.awayTeam ?? '?'} — <b>${l.prediction}</b> @ ${Number(l.odds).toFixed(2)}x`
      ).join('\n') + (p.legs.length > 3 ? `\n  <i>+${p.legs.length - 3} more legs</i>` : '')
    : `  <i>${legs}-leg parlay</i>`;
  return (
    `${num}🎰 <b>${legs}-Leg Parlay  @  ${odds}x</b>\n` +
    `📅 Exp: ${exp}\n` +
    `${legSummary}\n` +
    `💰 Your stake: <b>${formatAmt(ts, cur)}</b>  |  🏆 Win: <b>${formatAmt(cs + ts, cur)}</b>\n` +
    `🔗 <a href="${APP_URL}/p2p/parlay/${p.id}">Accept parlay #${p.id} →</a>`
  );
}

// Build per-offer Accept buttons grid (2 per row)
function offerButtons(offers: any[], label = '⚡ Accept'): any[][] {
  const buttons: any[] = offers.map((o: any) => ({
    text: `${label} #${o.id}`,
    url:  `${APP_URL}/p2p/offer/${o.id}`,
  }));
  const rows: any[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return rows;
}

function parlayButtons(parlays: any[]): any[][] {
  const buttons: any[] = parlays.map((p: any) => ({
    text: `🎰 Accept Parlay #${p.id}`,
    url:  `${APP_URL}/p2p/parlay/${p.id}`,
  }));
  const rows: any[][] = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  return rows;
}

function liveOffers(list: any[]) {
  return list.filter((o: any) =>
    Math.max(0, (Number(o.takerStake) || 0) - (Number(o.filledStake) || 0)) > 0
  );
}

// ── Command handlers ────────────────────────────────────────────────────────────
async function handleApp(chatId: number) {
  await send(chatId,
    `⚡ <b>SuiBets Mini App</b>\n\n` +
    `The full P2P betting experience — right inside Telegram.\n\n` +
    `<b>Inside the app you can:</b>\n` +
    `╔ 📋 Browse & accept live offers\n` +
    `╠ 🎰 Build parlays across multiple matches\n` +
    `╠ 💼 Post your own bets with custom odds\n` +
    `╠ 📊 Track your bets & win rate\n` +
    `╚ 💎 Stake $SBETS to earn revenue share\n\n` +
    `Tap the button below to open — no external browser needed.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Open SuiBets App', web_app: { url: `${APP_URL}/p2p` } }],
          [
            { text: '💎 $SBETS Token', url: `${APP_URL}/revenue` },
            { text: '📢 X / Twitter',  url: 'https://x.com/Sui_Bets' },
          ],
        ],
      },
    },
  );
}

async function handleStart(chatId: number, firstName: string) {
  await send(chatId,
    `🚀 <b>Welcome to SuiBets, ${firstName}!</b>\n\n` +
    `The world's first <b>pure P2P sports betting</b> platform on Sui blockchain.\n\n` +
    `<b>Why SuiBets?</b>\n` +
    `╔ ✅ 0% house edge — you vs another fan\n` +
    `╠ ⚡ &lt;1s settlement on-chain\n` +
    `╠ 🔒 On-chain escrow — no trust needed\n` +
    `╠ 🏆 900+ markets · 10 sports\n` +
    `╚ 💎 $SBETS token — revenue share for holders\n\n` +
    `<b>Quick Commands:</b>\n` +
    `/offers — browse open bets  •  /parlays — parlay bets\n` +
    `/top — biggest pots  •  /price — SUI price\n` +
    `/leaderboard — top traders  •  /stats — platform stats\n` +
    `/link 0x... — link wallet  •  /mybets — your bets\n` +
    `/help — all commands`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⚡ Open SuiBets', web_app: { url: `${APP_URL}/p2p` } },
            { text: '💎 Buy $SBETS',   url: `${APP_URL}/revenue` },
          ],
          [
            { text: '📊 Live Offers',    web_app: { url: `${APP_URL}/p2p` } },
            { text: '📢 @Sui_Bets on X', url: 'https://x.com/Sui_Bets' },
          ],
        ],
      },
    },
  );
}

async function handleOffers(chatId: number, sportFilter?: string) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const raw     = await fetchOffers(20, sportFilter);
    const allLive = liveOffers(raw);
    const live    = allLive.slice(0, 6);
    const filterLabel = sportFilter ? ` · <b>${sportFilter}</b>` : '';

    if (!live.length) {
      const tip = sportFilter
        ? `No open offers for <b>${sportFilter}</b> right now.\nTry /offers to see all sports, or /sports for a breakdown.`
        : `📭 <b>No open offers right now</b>\n\nBe the first to post one!`;
      return send(chatId, tip + `\n👉 <a href="${APP_URL}/p2p">Browse SuiBets →</a>`,
        { reply_markup: { inline_keyboard: [[{ text: '➕ Post a Bet', url: `${APP_URL}/p2p` }]] } },
      );
    }

    // Sum remaining taker-side stakes across ALL open offers by currency
    const balTotals: Record<string, number> = {};
    for (const o of allLive) {
      const cur       = (o.currency ?? 'SUI') as string;
      const remaining = Math.max(0, (Number(o.takerStake) || 0) - (Number(o.filledStake) || 0));
      balTotals[cur]  = (balTotals[cur] ?? 0) + remaining;
    }
    const balStr = Object.entries(balTotals)
      .map(([cur, amt]) => formatAmt(amt, cur))
      .join(' + ');

    const lines = live.map((o, i) => formatOffer(o, i)).join('\n\n━━━━━━━━━━━━━━\n\n');

    // Per-offer Accept buttons grid + bottom nav
    const acceptRows = offerButtons(live, '⚡ Accept');
    acceptRows.push([
      { text: '🔄 Refresh',    url: `${APP_URL}/p2p` },
      { text: '➕ Post a Bet', url: `${APP_URL}/p2p` },
    ]);

    await send(chatId,
      `📋 <b>Open P2P Offers</b>${filterLabel}  •  ${allLive.length} available  •  💰 ${balStr}\n\n${lines}\n\n<i>Tap an Accept button or offer link to bet on SuiBets</i>`,
      { reply_markup: { inline_keyboard: acceptRows } },
    );
  } catch (e: any) {
    console.error('[TelegramBot] handleOffers error:', e.message);
    await send(chatId, `⚠️ Could not load offers. Try <a href="${APP_URL}/p2p">opening the app →</a>`);
  }
}

async function handleParlays(chatId: number) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const rows = await fetchParlays(6);
    if (!rows.length) {
      return send(chatId,
        `📭 <b>No open parlays right now</b>\n\nPost one in the app!\n👉 <a href="${APP_URL}/p2p">Create a parlay →</a>`,
        { reply_markup: { inline_keyboard: [[{ text: '➕ Post a Parlay', url: `${APP_URL}/p2p` }]] } },
      );
    }
    const lines = rows.map((p, i) => formatParlay(p, i)).join('\n\n━━━━━━━━━━━━━━\n\n');

    const acceptRows = parlayButtons(rows);
    acceptRows.push([
      { text: '🔄 Refresh',       url: `${APP_URL}/p2p` },
      { text: '➕ Post a Parlay', url: `${APP_URL}/p2p` },
    ]);

    await send(chatId,
      `🎰 <b>Open P2P Parlays</b>  •  ${rows.length} available\n\n${lines}\n\n<i>Tap an Accept button to bet on SuiBets</i>`,
      { reply_markup: { inline_keyboard: acceptRows } },
    );
  } catch (e: any) {
    console.error('[TelegramBot] handleParlays error:', e.message);
    await send(chatId, `⚠️ Could not load parlays. Try <a href="${APP_URL}/p2p">opening the app →</a>`);
  }
}

async function handleTop(chatId: number) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const offers = await fetchTopOffers(6);
    if (!offers.length) {
      return send(chatId, `📭 No open offers yet.\n👉 <a href="${APP_URL}/p2p">Post the first bet →</a>`);
    }

    const lines = offers.map((o, i) => {
      const sport = sportLabel(o);
      const em    = sportEmoji(sport);
      const cur   = o.currency ?? 'SUI';
      const cs    = Number(o.creatorStake) || 0;
      const ts    = Number(o.takerStake)   || 0;
      const pot   = cs + ts;
      const odds  = Number(o.odds).toFixed(2);
      const exp   = o.expiresAt
        ? new Date(o.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : '—';
      return (
        `<b>${i + 1}.</b> ${em} <b>${o.eventName ?? `${o.homeTeam} vs ${o.awayTeam}`}</b>\n` +
        `🎯 ${o.prediction}  @  <b>${odds}x</b>  •  📅 ${exp}\n` +
        `🔥 Pot: <b>${formatAmt(pot, cur)}</b>  |  Your stake: <b>${formatAmt(ts, cur)}</b>\n` +
        `🔗 <a href="${APP_URL}/p2p/offer/${o.id}">Accept #${o.id} →</a>`
      );
    }).join('\n\n━━━━━━━━━━━━━━\n\n');

    const acceptRows = offerButtons(offers, '🔥 Join');
    acceptRows.push([{ text: '📋 All Offers', url: `${APP_URL}/p2p` }]);

    await send(chatId,
      `🔥 <b>Biggest Open Pots</b>  •  highest stakes first\n\n${lines}`,
      { reply_markup: { inline_keyboard: acceptRows } },
    );
  } catch (e: any) {
    console.error('[TelegramBot] handleTop error:', e.message);
    await send(chatId, '⚠️ Could not load top offers. Try again shortly.');
  }
}

async function handleSports(chatId: number) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const raw  = await fetchOffers(200);
    const live = liveOffers(raw);
    if (!live.length) return send(chatId, `📭 No open offers.\n👉 <a href="${APP_URL}/p2p">Post one →</a>`);

    const map: Record<string, any[]> = {};
    for (const o of live) {
      const s = sportLabel(o);
      (map[s] ??= []).push(o);
    }

    const lines = Object.entries(map)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([sport, os]) => {
        const total = os.reduce((s: number, o: any) => s + (Number(o.takerStake) || 0), 0);
        return (
          `${sportEmoji(sport)} <b>${sport}</b> — ${os.length} offer${os.length > 1 ? 's' : ''} · ` +
          `${formatAmt(total, os[0]?.currency ?? 'SUI')} at stake\n` +
          `<i>  → /offers ${sport.toLowerCase().split(' ')[0]}</i>`
        );
      }).join('\n\n');

    await send(chatId,
      `📊 <b>P2P Offers by Sport</b>\n\n${lines}\n\n👉 <a href="${APP_URL}/p2p">Browse all offers →</a>`,
      { reply_markup: { inline_keyboard: [[{ text: '🏆 View All Offers', url: `${APP_URL}/p2p` }]] } },
    );
  } catch (e: any) {
    console.error('[TelegramBot] handleSports error:', e.message);
    await send(chatId, '⚠️ Could not load sports data. Try again shortly.');
  }
}

async function handlePrice(chatId: number) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const price = await fetchSuiPrice();
    if (!price) return send(chatId, '⚠️ Could not fetch price data right now. Try again shortly.');

    const changeSign  = price.suiChange >= 0 ? '📈 +' : '📉 ';
    const changeColor = price.suiChange >= 0 ? '🟢' : '🔴';
    const sui         = price.sui.toFixed(4);
    const suiChange   = Math.abs(price.suiChange).toFixed(2);

    await send(chatId,
      `💰 <b>SUI Price</b>\n\n` +
      `${changeColor} <b>$${sui} USD</b>\n` +
      `${changeSign}${suiChange}% (24h)\n\n` +
      `<i>Data: CoinGecko  •  Refreshes every 60s</i>\n\n` +
      `💎 <b>$SBETS</b> — SuiBets platform token\n` +
      `Revenue share for holders · Buy on SuiBets DEX`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '💎 Get $SBETS',        url: `${APP_URL}/revenue` },
            { text: '📊 Platform Stats',    url: `${APP_URL}/p2p` },
          ]],
        },
      },
    );
  } catch (e: any) {
    console.error('[TelegramBot] handlePrice error:', e.message);
    await send(chatId, '⚠️ Could not fetch price. Try again shortly.');
  }
}

async function handleShare(chatId: number, idArg?: string) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

  const id = idArg ? parseInt(idArg.replace('#', ''), 10) : NaN;
  if (isNaN(id)) {
    return send(chatId,
      `📤 <b>Share a Bet</b>\n\n` +
      `Provide an offer ID to generate a shareable card:\n\n` +
      `<code>/share 158</code>\n\n` +
      `The card can be forwarded to any group or friend.`,
    );
  }

  try {
    const o = await fetchOfferById(id);
    if (!o) return send(chatId, `❌ Offer #${id} not found. Use /offers to browse open bets.`);

    const sport = sportLabel(o);
    const em    = sportEmoji(sport);
    const cur   = o.currency ?? 'SUI';
    const cs    = Number(o.creatorStake) || 0;
    const ts    = Number(o.takerStake)   || 0;
    const odds  = Number(o.odds).toFixed(2);
    const exp   = o.expiresAt
      ? new Date(o.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—';
    const statusTag = o.status === 'open' ? '🟢 OPEN' : o.status === 'matched' ? '🔵 MATCHED' : '⚪ ' + o.status.toUpperCase();

    const card =
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `${em} <b>${o.eventName ?? `${o.homeTeam} vs ${o.awayTeam}`}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📌 Status: <b>${statusTag}</b>\n` +
      `🏅 Sport:  <b>${sport}</b>\n` +
      `📅 Expires: <b>${exp}</b>\n\n` +
      `🎯 Pick:   <b>${o.prediction}</b>  @  <b>${odds}x</b>\n\n` +
      `💰 Stake to accept: <b>${formatAmt(ts, cur)}</b>\n` +
      `🏆 Win:             <b>${formatAmt(cs + ts, cur)}</b>\n` +
      `🎲 Creator staked:  <b>${formatAmt(cs, cur)}</b>\n\n` +
      `👤 Posted by: <code>${shortWallet(o.creatorWallet)}</code>\n\n` +
      `⚡ <b>Accept this bet on SuiBets:</b>\n` +
      `<a href="${APP_URL}/p2p/offer/${o.id}">${APP_URL}/p2p/offer/${o.id}</a>`;

    await send(chatId, card, {
      reply_markup: {
        inline_keyboard: [[
          { text: '⚡ Accept This Bet',  url: `${APP_URL}/p2p/offer/${o.id}` },
          { text: '📋 All Open Offers', url: `${APP_URL}/p2p` },
        ]],
      },
    });
  } catch (e: any) {
    console.error('[TelegramBot] handleShare error:', e.message);
    await send(chatId, '⚠️ Could not load offer. Try again shortly.');
  }
}

async function handleLeaderboard(chatId: number) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const rows = await fetchLeaderboard(10);
    if (!rows.length) {
      return send(chatId, `📭 No leaderboard data yet.\n👉 <a href="${APP_URL}/p2p">Place the first bet →</a>`);
    }
    const medals = ['🥇','🥈','🥉'];
    const lines = rows.map((r: any, i: number) => {
      const suiVol  = Number(r.vol_sui)   || 0;
      const sbetsVol = Number(r.vol_sbets) || 0;
      const vol     = suiVol > 0 ? formatAmt(suiVol, 'SUI') : formatAmt(sbetsVol, 'SBETS');
      const wins    = Number(r.wins)   || 0;
      const losses  = Number(r.losses) || 0;
      const total   = Number(r.total_bets) || 0;
      const settled = wins + losses;
      const wr      = settled > 0 ? ` · ${Math.round(wins / settled * 100)}% WR` : '';
      const wl      = `${wins}W · ${losses}L${wr}`;
      const medal   = medals[i] ?? `${i + 1}.`;
      return `${medal} <code>${shortWallet(r.wallet_address)}</code>\n   📊 ${vol}  •  ${wl}  •  ${total} bets`;
    }).join('\n\n');
    await send(chatId,
      `🏅 <b>Top P2P Traders</b>  •  by volume\n\n${lines}\n\n<i>Win a spot? Link your wallet with /link and use /mybets</i>`,
      { reply_markup: { inline_keyboard: [[{ text: '🚀 Start Betting', web_app: { url: `${APP_URL}/p2p` } }]] } },
    );
  } catch (e: any) {
    console.error('[TelegramBot] handleLeaderboard error:', e.message);
    await send(chatId, '⚠️ Could not load leaderboard. Try again shortly.');
  }
}

async function handleStats(chatId: number) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const [s, price] = await Promise.all([fetchPlatformStats(), fetchSuiPrice()]);
    if (!s) return send(chatId, '⚠️ Stats unavailable right now.');
    const suiUsd = price ? `  ≈ $${(s.suiVolume * price.sui).toLocaleString('en-US', { maximumFractionDigits: 0 })} USD` : '';
    await send(chatId,
      `📊 <b>SuiBets Platform Stats</b>\n\n` +
      `📋 Open offers:    <b>${s.openOffers}</b>\n` +
      `🎰 Open parlays:   <b>${s.openParlays}</b>\n` +
      `✅ Total matched:  <b>${s.totalMatched}</b>\n` +
      `👥 Unique bettors: <b>${s.uniqueWallets}</b>\n\n` +
      `💧 SUI volume:     <b>${formatAmt(s.suiVolume, 'SUI')}</b>${suiUsd}\n` +
      `💎 SBETS volume:   <b>${formatAmt(s.sbetsVolume, 'SBETS')}</b>\n\n` +
      `<i>All bets settled on-chain · 0% house edge · Sui blockchain</i>`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📋 View Offers',  url: `${APP_URL}/p2p` },
            { text: '💎 $SBETS Token', url: `${APP_URL}/revenue` },
          ]],
        },
      },
    );
  } catch (e: any) {
    console.error('[TelegramBot] handleStats error:', e.message);
    await send(chatId, '⚠️ Could not load stats. Try again shortly.');
  }
}

async function handleSettled(chatId: number) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  try {
    const rows = await fetchSettledTape(8);
    if (!rows.length) {
      return send(chatId, `📭 No settled bets yet.\n👉 <a href="${APP_URL}/p2p">Place the first bet →</a>`);
    }
    const lines = rows.map((r: any) => {
      const isParlay = r.type === 'parlay';
      const winner   = r.winner === 'creator' ? 'Creator 🎉' : r.winner === 'taker' ? 'Taker 🎉' : r.winner ?? '?';
      const pot      = Number(r.creator_stake) + Number(r.taker_stake);
      const cur      = r.currency ?? 'SUI';
      const when     = r.settled_at
        ? new Date(r.settled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
        : '—';
      if (isParlay) {
        return `🎰 <b>${r.leg_count}-Leg Parlay</b>  •  🏆 ${winner}\n💰 Pot: <b>${formatAmt(pot, cur)}</b>  •  ${when}`;
      }
      const sport = sportLabel({ sportName: r.sport_name });
      const em = sportEmoji(sport);
      return (
        `${em} <b>${r.event_name ?? `${r.home_team} vs ${r.away_team}`}</b>\n` +
        `🎯 ${r.prediction}  •  🏆 ${winner}\n` +
        `💰 Pot: <b>${formatAmt(pot, cur)}</b>  •  ${when}`
      );
    }).join('\n\n━━━━━━━━━━━━━━\n\n');
    await send(chatId,
      `✅ <b>Recent Settled Bets</b>\n\n${lines}\n\n👉 <a href="${APP_URL}/p2p">Place your bet →</a>`,
      { reply_markup: { inline_keyboard: [[{ text: '📋 View Open Offers', url: `${APP_URL}/p2p` }]] } },
    );
  } catch (e: any) {
    console.error('[TelegramBot] handleSettled error:', e.message);
    await send(chatId, '⚠️ Could not load settled bets. Try again shortly.');
  }
}

async function handleMyBets(chatId: number, walletArg?: string) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });

  const wallet = walletArg ?? linkedWallets.get(chatId);
  if (!wallet) {
    return send(chatId,
      `👤 <b>My Bets</b>\n\n` +
      `To see your bets, link your Sui wallet first:\n\n` +
      `<code>/link 0xYourWalletAddress</code>\n\n` +
      `Or pass it inline:\n` +
      `<code>/mybets 0xYourWalletAddress</code>\n\n` +
      `💡 Your wallet address shows in the SuiBets app after connecting.`,
      { reply_markup: { inline_keyboard: [[{ text: '🔗 Open App to Connect', url: `${APP_URL}/p2p` }]] } },
    );
  }
  if (!isValidSuiWallet(wallet)) {
    return send(chatId, `❌ Invalid wallet address. Sui wallets are 66 characters starting with <code>0x</code>.\n\nExample:\n<code>/link 0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43</code>`);
  }

  try {
    const data = await fetchMyBets(wallet);
    if (!data) return send(chatId, '⚠️ Could not load your bets. Try again.');

    const { offers, parlays, matched } = data;
    const total = offers.length + parlays.length + matched.length;

    if (!total) {
      return send(chatId,
        `📭 <b>No bets found for</b>\n<code>${shortWallet(wallet)}</code>\n\n` +
        `Once you place bets in the dApp, they'll appear here.\n` +
        `👉 <a href="${APP_URL}/p2p">Go bet now →</a>`,
        { reply_markup: { inline_keyboard: [[{ text: '🎯 Place a Bet', url: `${APP_URL}/p2p` }]] } },
      );
    }

    const sEmoji = (s: string) =>
      s === 'open' ? '🟢' : s === 'matched' ? '🔵' : s === 'settled' ? '✅' : s === 'cancelled' ? '❌' : '⏳';

    let msg = `👤 <b>Your Bets</b>\n<code>${shortWallet(wallet)}</code>\n\n`;

    if (offers.length) {
      msg += `📋 <b>Singles you created (${offers.length})</b>\n`;
      for (const o of offers.slice(0, 5)) {
        const cur = o.currency ?? 'SUI';
        const result = o.status === 'settled'
          ? (o.winner === 'creator' ? ' 🏆 <b>Won!</b>' : ' 💀 Lost')
          : '';
        msg += `${sEmoji(o.status)} #${o.id} <b>${o.event_name ?? 'Event'}</b> — ${o.prediction} @ ${Number(o.odds).toFixed(2)}x — ${formatAmt(Number(o.creator_stake), cur)}${result}\n`;
      }
      if (offers.length > 5) msg += `<i>  ...and ${offers.length - 5} more</i>\n`;
      msg += '\n';
    }

    if (parlays.length) {
      msg += `🎰 <b>Parlays you created (${parlays.length})</b>\n`;
      for (const p of parlays.slice(0, 3)) {
        const cur = p.currency ?? 'SUI';
        const result = p.status === 'settled'
          ? (p.winner === 'creator' ? ' 🏆 <b>Won!</b>' : ' 💀 Lost')
          : '';
        msg += `${sEmoji(p.status)} #${p.id} ${p.leg_count}-Leg @ ${Number(p.total_odds).toFixed(2)}x — ${formatAmt(Number(p.creator_stake), cur)}${result}\n`;
      }
      msg += '\n';
    }

    if (matched.length) {
      msg += `⚡ <b>Bets you accepted (${matched.length})</b>\n`;
      for (const m of matched.slice(0, 5)) {
        const result = m.status === 'settled'
          ? (m.winner === 'taker' ? ' 🏆 <b>Won!</b>' : ' 💀 Lost')
          : '';
        msg += `${sEmoji(m.status)} #${m.offer_id} <b>${m.event_name ?? 'Event'}</b>${result}\n`;
      }
    }

    // Win rate summary
    const settled = [...offers, ...parlays].filter((o: any) => o.status === 'settled');
    const wins    = settled.filter((o: any) => o.winner === 'creator').length;
    if (settled.length) {
      const rate = Math.round((wins / settled.length) * 100);
      msg += `\n📈 <b>Win rate:</b> ${wins}/${settled.length} settled  (${rate}%)\n`;
    }

    msg += `\n👉 <a href="${APP_URL}/p2p">Open app to place or accept bets →</a>`;

    await send(chatId, msg, {
      reply_markup: {
        inline_keyboard: [[
          { text: '📋 Browse Offers',  url: `${APP_URL}/p2p` },
          { text: '🎰 Browse Parlays', url: `${APP_URL}/p2p` },
        ]],
      },
    });
  } catch (e: any) {
    console.error('[TelegramBot] handleMyBets error:', e.message);
    await send(chatId, '⚠️ Could not load your bets. Try again shortly.');
  }
}

async function handleLink(chatId: number, wallet?: string) {
  if (!wallet || !isValidSuiWallet(wallet)) {
    const existing = linkedWallets.get(chatId);
    const hint = existing
      ? `\n\nCurrently linked: <code>${shortWallet(existing)}</code>`
      : '';
    return send(chatId,
      `🔗 <b>Link Your Wallet</b>\n\n` +
      `Send your Sui wallet address:\n\n` +
      `<code>/link 0xYourWalletAddress</code>\n\n` +
      `Your address is shown in the SuiBets app after connecting.\n` +
      `Once linked, /mybets works without typing your address every time.${hint}`,
    );
  }
  linkedWallets.set(chatId, wallet);
  await send(chatId,
    `✅ <b>Wallet linked!</b>\n\n` +
    `<code>${wallet}</code>\n\n` +
    `You can now use:\n` +
    `• /mybets — see all your bets\n` +
    `• /link — update your wallet anytime\n\n` +
    `To place or accept bets, open the dApp — the same on-chain transaction happens either way:\n` +
    `👉 <a href="${APP_URL}/p2p">SuiBets P2P Hub →</a>`,
  );
}

async function handleBet(chatId: number) {
  await send(chatId,
    `⚡ <b>How to Post a P2P Bet</b>\n\n` +
    `<b>1.</b> Open SuiBets and connect your Sui wallet\n` +
    `<b>2.</b> Pick a match → choose your prediction\n` +
    `<b>3.</b> Set your stake and odds\n` +
    `<b>4.</b> Your offer goes live on the order book\n` +
    `<b>5.</b> Another user takes the opposite side\n` +
    `<b>6.</b> Match settles on-chain — winner paid instantly\n\n` +
    `💡 <i>Funds locked in escrow until settlement. No trust required.</i>\n\n` +
    `📤 Share any offer with /share &lt;id&gt;`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎯 Post a Bet Now',    url: `${APP_URL}/p2p` }],
          [{ text: '📋 View Open Offers',  url: `${APP_URL}/p2p` }],
        ],
      },
    },
  );
}

async function handleWatch(chatId: number) {
  subscribers.add(chatId);
  await send(chatId,
    `🔔 <b>Subscribed!</b>\n\n` +
    `You'll get a DM whenever a new P2P offer is posted.\n\n` +
    `Active subscribers: <b>${subscribers.size}</b>\n\nSend /unwatch to stop.`,
  );
}

async function handleUnwatch(chatId: number) {
  subscribers.delete(chatId);
  await send(chatId, `🔕 <b>Unsubscribed.</b>\nSend /watch to re-subscribe anytime.`);
}

// ── /notify — personal bet status alerts ────────────────────────────────────────
async function handleNotify(chatId: number, arg?: string) {
  // /notify off → unsubscribe
  if (arg?.toLowerCase() === 'off') {
    notifySubs.delete(chatId);
    return send(chatId, `🔕 <b>Bet alerts off.</b>\nSend /notify 0x... to re-enable anytime.`);
  }

  // /notify alone with a linked wallet → use linked wallet
  const wallet = isValidSuiWallet(arg) ? arg : linkedWallets.get(chatId);

  if (!wallet) {
    return send(chatId,
      `🔔 <b>Personal Bet Alerts</b>\n\n` +
      `Get a DM the moment one of your bets is accepted or settled.\n\n` +
      `<b>Usage:</b>\n` +
      `<code>/notify 0xYourWalletAddress</code>\n\n` +
      `Or link your wallet first with /link, then just type /notify.\n\n` +
      `<code>/notify off</code> — stop alerts${notifySubs.has(chatId) ? `\n\n✅ Currently active for: <code>${shortWallet(notifySubs.get(chatId))}</code>` : ''}`,
    );
  }

  if (arg && !isValidSuiWallet(arg)) {
    return send(chatId, `❌ Invalid wallet address. Sui wallets are 66 chars starting with <code>0x</code>.`);
  }

  notifySubs.set(chatId, wallet);
  // Also link the wallet so /mybets works without re-typing
  linkedWallets.set(chatId, wallet);

  await send(chatId,
    `🔔 <b>Bet alerts ON</b>\n\n` +
    `Wallet: <code>${shortWallet(wallet)}</code>\n\n` +
    `You'll get a private DM when:\n` +
    `• 🎯 Someone accepts one of your offers\n` +
    `• 🏆 A bet you're in is settled\n` +
    `• ❌ An offer you placed is cancelled\n\n` +
    `Send <code>/notify off</code> to stop.\n` +
    `👉 <a href="${APP_URL}/p2p">View your bets →</a>`,
    { reply_markup: { inline_keyboard: [[{ text: '👤 My Bets', url: `${APP_URL}/p2p` }]] } },
  );
}

// ── Notify polling — runs every 30s, checks for status changes ──────────────────
async function runNotifyPoll() {
  if (!notifySubs.size) return;
  const db = getDb();
  if (!db) return;

  for (const [chatId, wallet] of notifySubs) {
    try {
      // Fetch all non-open offers for this wallet (as creator or taker)
      const rows = await db`
        SELECT o.id, o.event_name, o.currency, o.creator_stake, o.taker_stake,
               o.status AS offer_status, o.winner,
               m.id AS match_id, m.status AS match_status, m.taker_wallet,
               m.actual_payout, m.stake AS taker_stake_match
        FROM   p2p_bet_offers o
        LEFT JOIN p2p_bet_matches m ON m.offer_id = o.id
        WHERE  (o.creator_wallet = ${wallet} OR m.taker_wallet = ${wallet})
        AND    o.status != 'open'
        ORDER  BY o.id DESC
        LIMIT  30
      `;

      for (const r of rows) {
        const key     = `${chatId}:${r.id}`;
        const status  = r.match_status ?? r.offer_status;
        const lastSeen = offerStatusCache.get(key);

        // Skip if status unchanged or we've seen it before at this exact status
        if (!lastSeen) {
          // First time we see this offer — record it silently, don't alert
          offerStatusCache.set(key, status);
          continue;
        }
        if (lastSeen === status) continue;

        // Status changed — update cache and alert
        offerStatusCache.set(key, status);

        const name  = r.event_name ?? `Offer #${r.id}`;
        const cur   = r.currency ?? 'SUI';
        const isCreator = true; // we queried both sides; determine role below
        const takerWallet = (r.taker_wallet ?? '').toLowerCase();
        const role  = takerWallet === wallet.toLowerCase() ? 'taker' : 'creator';

        let msg = '';

        if (status === 'matched') {
          const pot = (Number(r.creator_stake ?? 0) + Number(r.taker_stake ?? 0)).toFixed(4);
          msg =
            `🎯 <b>Bet Accepted!</b>\n\n` +
            `<b>${name}</b>\n` +
            `Pot: <b>${pot} ${cur}</b>\n\n` +
            `Someone took the other side. Your funds are in escrow — winner gets paid on-chain after the match.\n\n` +
            `👉 <a href="${APP_URL}/p2p/offer/${r.id}">View offer #${r.id} →</a>`;
        } else if (status === 'maker_won' || status === 'taker_won') {
          const won = (role === 'creator' && status === 'maker_won') || (role === 'taker' && status === 'taker_won');
          const payout = Number(r.actual_payout ?? 0).toFixed(4);
          if (won) {
            msg =
              `🏆 <b>You Won!</b>\n\n` +
              `<b>${name}</b>\n` +
              `Payout: <b>${payout} ${cur}</b> sent to your wallet.\n\n` +
              `👉 <a href="${APP_URL}/p2p/offer/${r.id}">View result →</a>`;
          } else {
            const stake = role === 'creator'
              ? Number(r.creator_stake ?? 0).toFixed(4)
              : Number(r.taker_stake_match ?? 0).toFixed(4);
            msg =
              `😔 <b>Bet Settled — Loss</b>\n\n` +
              `<b>${name}</b>\n` +
              `Stake lost: <b>${stake} ${cur}</b>\n\n` +
              `Better luck next time!\n` +
              `👉 <a href="${APP_URL}/p2p">Browse new offers →</a>`;
          }
        } else if (status === 'settled') {
          msg =
            `✅ <b>Bet Settled</b>\n\n` +
            `<b>${name}</b>\n\n` +
            `👉 <a href="${APP_URL}/p2p/offer/${r.id}">View result →</a>`;
        } else if (status === 'cancelled') {
          msg =
            `❌ <b>Bet Cancelled</b>\n\n` +
            `<b>${name}</b>\n\n` +
            `Your stake has been refunded.\n` +
            `👉 <a href="${APP_URL}/p2p">Browse open offers →</a>`;
        }

        if (msg) {
          await send(chatId, msg, {
            reply_markup: { inline_keyboard: [[{ text: '👤 My Bets', url: `${APP_URL}/p2p` }]] },
          });
          console.log(`[TelegramBot] 🔔 Notify alert → chatId=${chatId} offer=#${r.id} status=${status}`);
        }
      }
    } catch (e: any) {
      console.warn(`[TelegramBot] runNotifyPoll error for chatId=${chatId}:`, e.message);
    }
  }
}

async function handleHelp(chatId: number) {
  await send(chatId,
    `<b>🤖 SuiBets Bot — All Commands</b>\n\n` +
    `<b>— Browse Offers —</b>\n` +
    `/offers — open single bets\n` +
    `/offers football — filter by sport\n` +
    `/parlays — open parlay bets\n` +
    `/top — biggest pots right now\n` +
    `/sports — breakdown by sport\n\n` +
    `<b>— Market Info —</b>\n` +
    `/price — live SUI price\n` +
    `/stats — platform stats\n` +
    `/leaderboard — top traders\n` +
    `/settled — recent results\n\n` +
    `<b>— Your Account —</b>\n` +
    `/link 0x... — link your Sui wallet\n` +
    `/mybets — your bets, results & win rate\n\n` +
    `<b>— Actions —</b>\n` +
    `/share &lt;id&gt; — shareable card for any offer\n` +
    `/app — open SuiBets as a Mini App inside Telegram\n` +
    `/bet — how to post a bet\n` +
    `/watch — new offer alerts (DM)\n` +
    `/unwatch — stop new-offer alerts\n` +
    `/notify 0x... — DM me when MY bets are matched/settled\n` +
    `/notify off — stop personal bet alerts\n` +
    `/start — welcome screen\n` +
    `/help — this menu\n\n` +
    `🌐 <a href="${APP_URL}/p2p">SuiBets P2P Hub</a>  |  ` +
    `💎 <a href="${APP_URL}/revenue">$SBETS Token</a>  |  ` +
    `📢 <a href="https://x.com/Sui_Bets">@Sui_Bets</a>`,
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────────────────
export async function handleWebhookUpdate(update: any) {
  try {
    const msg = update.message ?? update.channel_post;
    if (!msg?.text) return;

    const chatId    = msg.chat.id as number;
    const chatType  = msg.chat.type as string;
    const firstName = msg.from?.first_name ?? 'Trader';

    // Strip @botname suffix for group commands
    const text = msg.text.trim().replace(/@\w+$/, '').trim();
    console.log(`[TelegramBot] [${chatType}] ${msg.from?.username ?? chatId}: ${text}`);

    const spaceIdx = text.indexOf(' ');
    const cmd = (spaceIdx > -1 ? text.slice(0, spaceIdx) : text).toLowerCase();
    const arg = spaceIdx > -1 ? text.slice(spaceIdx + 1).trim() : undefined;

    // Rate limit: ignore rapid-fire commands (silent drop — no error message to avoid spam loops)
    if (isRateLimited(chatId)) return;

    if (cmd === '/start')        return handleStart(chatId, firstName);
    if (cmd === '/startminiapp') return handleApp(chatId);
    if (cmd === '/app')          return handleApp(chatId);
    if (cmd === '/offers')      return handleOffers(chatId, arg || undefined);
    if (cmd === '/parlays')     return handleParlays(chatId);
    if (cmd === '/top')         return handleTop(chatId);
    if (cmd === '/sports')      return handleSports(chatId);
    if (cmd === '/price')       return handlePrice(chatId);
    if (cmd === '/share')       return handleShare(chatId, arg);
    if (cmd === '/leaderboard') return handleLeaderboard(chatId);
    if (cmd === '/stats')       return handleStats(chatId);
    if (cmd === '/settled')     return handleSettled(chatId);
    if (cmd === '/mybets')      return handleMyBets(chatId, arg);
    if (cmd === '/link')        return handleLink(chatId, arg);
    if (cmd === '/bet')         return handleBet(chatId);
    if (cmd === '/watch')       return handleWatch(chatId);
    if (cmd === '/unwatch')     return handleUnwatch(chatId);
    if (cmd === '/notify')      return handleNotify(chatId, arg);
    if (cmd === '/unnotify')    return handleNotify(chatId, 'off');
    if (cmd === '/help')        return handleHelp(chatId);

    // In groups: only respond to explicit /commands
    if (chatType !== 'private') return;

    await send(chatId,
      `❓ Unknown command. Try /offers to see live bets or /start for the full menu.`,
      { reply_markup: { inline_keyboard: [[{ text: '📋 View Offers', url: `${APP_URL}/p2p` }]] } },
    );
  } catch (e: any) {
    console.warn('[TelegramBot] handleUpdate error:', e.message);
  }
}

// ── Auto-broadcast: called instantly when a new offer is posted in the dApp ────
export async function broadcastNewOffer(offer: {
  id: number;
  eventName?: string;
  homeTeam?: string;
  awayTeam?: string;
  sportName?: string;
  leagueName?: string;
  prediction?: string;
  odds: number;
  creatorStake: number;
  takerStake: number;
  currency?: string;
  expiresAt?: Date | string | null;
}) {
  if (!TOKEN) return;
  try {
    const cur  = offer.currency ?? 'SUI';
    const cs   = Number(offer.creatorStake) || 0;
    const ts   = Number(offer.takerStake)   || 0;
    const odds = Number(offer.odds).toFixed(2);
    const sport = offer.sportName || offer.leagueName || 'P2P Bet';
    const em   = sportEmoji(sport);
    const exp  = offer.expiresAt
      ? new Date(offer.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : '—';

    const text =
      `🆕 <b>New P2P Offer!</b> ${em}\n\n` +
      `${em} <b>${offer.eventName ?? `${offer.homeTeam} vs ${offer.awayTeam}`}</b>\n` +
      `📅 ${exp}  •  ${sport}\n` +
      `🎯 Pick: <b>${offer.prediction}</b>  @  <b>${odds}x</b>\n` +
      `💰 Stake to accept: <b>${formatAmt(ts, cur)}</b>  |  🏆 Win: <b>${formatAmt(cs + ts, cur)}</b>\n\n` +
      `🔗 <a href="${APP_URL}/p2p/offer/${offer.id}">Accept offer #${offer.id} on SuiBets →</a>`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [[
          { text: '⚡ Accept This Offer', web_app: { url: `${APP_URL}/p2p/offer/${offer.id}` } },
          { text: '📋 All Offers',        web_app: { url: `${APP_URL}/p2p` } },
        ]],
      },
    };

    if (CHANNEL_ID) {
      await send(CHANNEL_ID, text, keyboard);
      console.log(`[TelegramBot] 📢 Broadcast offer #${offer.id} to channel ${CHANNEL_ID}`);
    }

    if (subscribers.size) {
      for (const chatId of subscribers) {
        if (chatId === CHANNEL_ID) continue;
        await send(chatId, text, keyboard);
        await new Promise(r => setTimeout(r, 50));
      }
      console.log(`[TelegramBot] 📣 Notified ${subscribers.size} subscriber(s) of offer #${offer.id}`);
    }

    if (offer.id > lastSeenOfferId) lastSeenOfferId = offer.id;
  } catch (e: any) {
    console.warn('[TelegramBot] broadcastNewOffer error:', e.message);
  }
}

// ── Polling broadcaster (fallback — catches offers missed by the hook) ──────────
export async function broadcastNewOffers() {
  if (!subscribers.size && !CHANNEL_ID) return;
  try {
    const raw   = await fetchOffers(20);
    const fresh = raw.filter((o: any) => o.id > lastSeenOfferId);
    if (!fresh.length) return;
    for (const offer of fresh.slice(0, 3)) {
      await broadcastNewOffer(offer);
    }
  } catch (e: any) {
    console.warn('[TelegramBot] poll-broadcast error:', e.message);
  }
}

// ── Startup ─────────────────────────────────────────────────────────────────────
export async function startTelegramBot(_app: any) {
  if (!TOKEN) {
    console.warn('[TelegramBot] TELEGRAM_BOT_TOKEN not set — bot disabled.');
    return;
  }

  const info = await tg('getMe');
  if (!info.ok) {
    console.warn('[TelegramBot] Invalid token:', info.description);
    return;
  }

  const commands = [
    { command: 'start',        description: '🚀 Welcome & open P2P hub' },
    { command: 'startminiapp', description: '📱 Open SuiBets Mini App directly' },
    { command: 'app',          description: '📱 Open SuiBets inside Telegram' },
    { command: 'offers',      description: '📋 Open single bets (add sport to filter)' },
    { command: 'parlays',     description: '🎰 Open parlay bets' },
    { command: 'top',         description: '🔥 Biggest pots right now' },
    { command: 'sports',      description: '⚽ Offers by sport' },
    { command: 'price',       description: '💰 Live SUI price' },
    { command: 'share',       description: '📤 Share a bet card (add offer ID)' },
    { command: 'leaderboard', description: '🏅 Top P2P traders' },
    { command: 'stats',       description: '📊 Platform stats' },
    { command: 'settled',     description: '✅ Recent results' },
    { command: 'mybets',      description: '👤 Your bets & win rate' },
    { command: 'link',        description: '🔗 Link your Sui wallet' },
    { command: 'bet',         description: '⚡ How to post a bet' },
    { command: 'watch',       description: '🔔 New offer DM alerts' },
    { command: 'unwatch',     description: '🔕 Stop new-offer alerts' },
    { command: 'notify',      description: '🔔 DM me when MY bets are matched/settled' },
    { command: 'unnotify',    description: '🔕 Stop personal bet alerts' },
    { command: 'help',        description: '❓ All commands' },
  ];

  await tg('setMyCommands', { commands, scope: { type: 'all_private_chats' } });
  await tg('setMyCommands', { commands, scope: { type: 'all_group_chats' } });

  // Set the persistent menu button — opens the dApp as a Mini App inside Telegram
  await tg('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: '⚡ SuiBets',
      web_app: { url: `${APP_URL}/p2p` },
    },
  });
  console.log(`[TelegramBot] 📱 Mini App menu button set → ${APP_URL}/p2p`);

  try {
    const ex = await fetchOffers(1);
    if (ex.length) lastSeenOfferId = ex[0].id;
    console.log(`[TelegramBot] Seeded lastSeenOfferId = ${lastSeenOfferId}`);
  } catch { /* non-fatal */ }

  const webhookBase = process.env.TELEGRAM_WEBHOOK_URL ?? null;

  if (webhookBase) {
    const webhookUrl = `${webhookBase}/api/telegram/webhook`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) {
      console.warn('[TelegramBot] ⚠️  TELEGRAM_WEBHOOK_SECRET not set — skipping webhook registration. Set this env var on Railway.');
      return;
    }
    const wh = await tg('setWebhook', {
      url: webhookUrl,
      secret_token: secret,
      drop_pending_updates: false,
      allowed_updates: ['message', 'channel_post'],
    });
    if (wh.ok) {
      console.log(`[TelegramBot] ✅ @${info.result.username} — webhook: ${webhookUrl}`);
    } else {
      console.warn('[TelegramBot] Webhook registration failed:', wh.description);
    }
  } else {
    console.log('[TelegramBot] No TELEGRAM_WEBHOOK_URL — falling back to long polling');
    await tg('deleteWebhook', { drop_pending_updates: false });
    let offset = 0;
    const poll = async () => {
      while (true) {
        try {
          const res = await tg('getUpdates', { offset, timeout: 10, limit: 100 });
          if (res.ok && res.result?.length) {
            for (const u of res.result) {
              offset = u.update_id + 1;
              handleWebhookUpdate(u);
            }
          } else if (!res.ok) {
            await new Promise(r => setTimeout(r, 5000));
          }
        } catch {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    };
    setTimeout(poll, 2000);
    console.log(`[TelegramBot] ✅ @${info.result.username} — polling started`);
  }

  if (CHANNEL_ID) {
    console.log(`[TelegramBot] 📢 Auto-broadcast channel: ${CHANNEL_ID}`);
  }

  setInterval(broadcastNewOffers, 120_000);

  // Re-assert the correct menu button URL every 3 minutes.
  // This corrects the menu button if another server instance (e.g. Railway with old code) overrides it.
  const keepMenuButton = async () => {
    try {
      await tg('setChatMenuButton', {
        menu_button: { type: 'web_app', text: '⚡ SuiBets', web_app: { url: `${APP_URL}/p2p` } },
      });
    } catch { /* non-fatal */ }
  };
  setInterval(keepMenuButton, 180_000);

  // Personal bet status alerts — poll every 30s
  const notifyPoll = async () => {
    while (true) {
      await new Promise(r => setTimeout(r, 30_000));
      await runNotifyPoll().catch(e => console.warn('[TelegramBot] notifyPoll error:', e.message));
    }
  };
  notifyPoll();
  console.log('[TelegramBot] 🔔 Personal bet alert poller started (30s interval)');
}
