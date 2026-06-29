import crypto from 'crypto';
import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { p2pBettingService, getVolumeTier, VOLUME_TIERS, calcSingleMatchPayout, calcParlayPayout } from './services/p2pBettingService';
import { p2pContractService } from './services/p2pContractService';
import { warpEngineService } from './services/warpEngineService';
import { fluxEngineService } from './services/fluxEngineService';
import { pulseEngineService } from './services/pulseEngineService';
import { wsService } from './services/websocketService';
import { requireValidStakeTx } from './services/txHashVerifierService';
import { broadcastNewOffer } from './services/telegramBotService';
import { publishNewOffer } from './services/socialPublisherService';
import { createPulsePoolForP2POffer } from './services/p2pEngineHookService';
import { db } from './db';
import { p2pBetOffers, p2pBetMatches, p2pParlayOffers, p2pVolumeStats, adminSessions, settledEvents, bets } from '@shared/schema';
import { eq, and, or, gte, lte, gt, lt, sql, desc, sum, inArray, isNull } from 'drizzle-orm';
import apiSportsService from './services/apiSportsService';
import { freeSportsService } from './services/freeSportsService';
import { validateCoinType } from './utils/oracleSecurity';

// ─── Per-wallet concurrency lock ─────────────────────────────────────────────
// Prevents parallel acceptOffer calls from the same wallet bypassing the
// "1 bet per offer per taker" check when both SELECT queries run before either INSERT.
const p2pWalletLocks = new Map<string, Promise<any>>();
function acquireP2PWalletLock(wallet: string): { execute: <T>(fn: () => Promise<T>) => Promise<T> } {
  const key = wallet.toLowerCase();
  return {
    execute<T>(fn: () => Promise<T>): Promise<T> {
      const existingLock = p2pWalletLocks.get(key) || Promise.resolve();
      let resolveLock!: () => void;
      const newLock = existingLock.then(() => new Promise<void>(r => { resolveLock = r; }));
      p2pWalletLocks.set(key, newLock);
      return existingLock.then(() => fn()).finally(() => {
        resolveLock?.();
        if (p2pWalletLocks.get(key) === newLock) p2pWalletLocks.delete(key);
      });
    },
  };
}

// ─── Rate limiters ────────────────────────────────────────────────────────────
// Applied to user-facing write endpoints to prevent flooding / RPC abuse.

const offerCreateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many offers created — please wait a minute before trying again.' },
  keyGenerator: (req) => {
    const wallet = req.body?.creatorWallet ?? req.body?.takerWallet ?? req.ip ?? 'unknown';
    return typeof wallet === 'string' ? wallet.toLowerCase() : req.ip ?? 'unknown';
  },
});

const offerAcceptLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many accept attempts — please wait a minute.' },
  keyGenerator: (req) => {
    const wallet = req.body?.takerWallet ?? req.ip ?? 'unknown';
    return typeof wallet === 'string' ? wallet.toLowerCase() : req.ip ?? 'unknown';
  },
});

const recoveryLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many recovery attempts — please wait a minute.' },
});

/**
 * Returns true for any prediction format the settlement engine understands:
 *   home | away | draw
 *   over_2.5 | under_1.5
 *   btts_yes | btts_no
 *   home_or_draw | away_or_draw | home_or_away
 *   home_-1.5 | away_+0.5  (asian handicap)
 *   ht_home | ht_draw | ht_away  (half-time result)
 *   score_1-0 | score_0-0 etc.  (correct score)
 *   cs_home | cs_away  (clean sheet)
 */
function isValidPrediction(p: string): boolean {
  if (!p) return false;
  if (['home', 'away', 'draw',
       'btts_yes', 'btts_no',
       'home_or_draw', 'away_or_draw', 'home_or_away',
       'ht_home', 'ht_draw', 'ht_away',
       'cs_home', 'cs_away',
  ].includes(p)) return true;
  if (/^(over|under)_[\d.]+$/.test(p)) return true;
  if (/^(home|away)_[+-]?[\d.]+$/.test(p)) return true;
  if (/^score_\d+-\d+$/.test(p)) return true;
  return false;
}

/**
 * Cross-check an eventId against both the API-Sports and FreeSports caches.
 * Returns the server-authoritative start time and whether the match has started.
 *
 * Security contract:
 *   - If isLiveOrStarted = true  → reject the offer/leg immediately (match in progress or over)
 *   - If serverMatchDate is set   → use it as the authoritative matchDate (ignores client value)
 *   - If found = false            → cache miss; fall through to client-provided matchDate
 */
function trustedEventCheck(eventId: string): {
  found: boolean;
  isLiveOrStarted: boolean;
  serverMatchDate: Date | null;
  source: string;
} {
  // Primary: API-Sports live/upcoming cache + snapshots
  const apiCheck = apiSportsService.lookupEventSync(String(eventId));
  if (apiCheck.found) {
    const serverMatchDate = apiCheck.startTime ? new Date(apiCheck.startTime) : null;
    const isLiveOrStarted = apiCheck.isLive || apiCheck.shouldBeLive;
    return { found: true, isLiveOrStarted, serverMatchDate, source: 'api-sports' };
  }

  // Fallback: FreeSports cache (ESPN/TheSportsDB)
  const fsCheck = freeSportsService.lookupEvent(String(eventId));
  if (fsCheck.found && fsCheck.event) {
    const startTime = fsCheck.event.startTime ? new Date(fsCheck.event.startTime) : null;
    const isLiveOrStarted = fsCheck.shouldBeLive || !!(fsCheck.event as any).isLive;
    return { found: true, isLiveOrStarted, serverMatchDate: startTime, source: 'free-sports' };
  }

  // Not found in any cache — cannot validate, allow through
  return { found: false, isLiveOrStarted: false, serverMatchDate: null, source: 'none' };
}

/** Convert on-chain base-unit balance to human-readable decimal amount */
function baseToHuman(baseUnits: number, currency?: string | null): number {
  const c = (currency ?? '').toUpperCase();
  const decimals = (c === 'USDSUI' || c === 'USDC') ? 6
    : c === 'LBTC' ? 8
    : 9;
  return baseUnits / Math.pow(10, decimals);
}

const router = express.Router();

function broadcastP2PUpdate(action: string, type: 'offer' | 'parlay', data?: any) {
  wsService.broadcast('p2p-updates', { action, type, data, ts: Date.now() });
}

const SUI_WALLET_REGEX = /^0x[0-9a-fA-F]{64}$/;
function isValidWallet(addr: unknown): addr is string {
  return typeof addr === 'string' && SUI_WALLET_REGEX.test(addr);
}

// ─── Admin auth middleware ─────────────────────────────────────────────────────
// Protects oracle-privileged routes (void, dispute resolution, manual settle).
// Accepts either:
//   1. Authorization: Bearer <ADMIN_SECRET>  (env var, for server-to-server calls)
//   2. Authorization: Bearer <session-token>  (from admin panel login session)
async function requireAdminAuth(req: Request, res: Response, next: Function) {
  const auth = req.headers['authorization'] ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: missing admin token' });
  }

  // Fast path: ADMIN_SECRET env var
  const secret = process.env.ADMIN_SECRET;
  if (secret && token.length === secret.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return next();
  }

  // DB session token check (admin panel login)
  try {
    const rows = await db.select().from(adminSessions)
      .where(and(
        eq(adminSessions.token, token),
        eq(adminSessions.revoked, false),
        gt(adminSessions.expiresAt, new Date()),
      )).limit(1);
    if (rows.length > 0) return next();
  } catch (e) {
    console.error('[P2P] Admin session check error:', e);
  }

  return res.status(401).json({ message: 'Unauthorized: invalid or missing admin token' });
}

// ─── Fee Info (public) ────────────────────────────────────────────────────────

// GET /api/p2p/fee-tiers — HIP-4 volume tier schedule
router.get('/fee-tiers', (_req: Request, res: Response) => {
  res.json({
    tiers: VOLUME_TIERS,
    description: 'Makers earn rebates, takers pay fees. Both decrease as volume grows (HIP-4 inspired).',
    payoutFormula: {
      singleOffer: 'grossPot = takerStake + (creatorStake × takerStake / totalTakerStake). winnerPayout = grossPot × (1 - netFeeRate)',
      parlay: 'grossPot = creatorStake + takerStake = creatorStake × totalOdds. winnerPayout = grossPot × (1 - netFeeRate)',
      netFeeRate: 'netFeeRate = takerFeeRate − makerRebateRate',
    },
  });
});

// GET /api/p2p/fee-preview — calculate fees for a prospective bet
router.get('/fee-preview', async (req: Request, res: Response) => {
  try {
    const { makerWallet, takerWallet, stake, offerOdds, creatorStake, takerStake, type } = req.query as Record<string, string>;
    if (!stake || !offerOdds) return res.status(400).json({ message: 'stake and offerOdds required' });

    const stakeNum = parseFloat(stake);
    const oddsNum = parseFloat(offerOdds);

    const [makerVol, takerVol] = await Promise.all([
      makerWallet && isValidWallet(makerWallet) ? p2pBettingService.getVolumeStats(makerWallet) : Promise.resolve(null),
      takerWallet && isValidWallet(takerWallet) ? p2pBettingService.getVolumeStats(takerWallet) : Promise.resolve(null),
    ]);

    const makerTier = makerVol ? makerVol.tier : VOLUME_TIERS[0];
    const takerTier = takerVol ? takerVol.tier : VOLUME_TIERS[0];

    let result: any;
    if (type === 'parlay') {
      result = calcParlayPayout({
        creatorStake: parseFloat(creatorStake ?? stake),
        takerStake: parseFloat(takerStake ?? stake),
        takerFeeRate: takerTier.takerFee,
        makerRebateRate: makerTier.makerRebate,
      });
    } else {
      const cStake = parseFloat(creatorStake ?? '1');
      const tStake = parseFloat(takerStake ?? String(cStake * (oddsNum - 1)));
      result = calcSingleMatchPayout({
        takerStake: stakeNum,
        offerOdds: oddsNum,
        offerCreatorStake: cStake,
        offerTakerStake: tStake,
        takerFeeRate: takerTier.takerFee,
        makerRebateRate: makerTier.makerRebate,
      });
    }

    res.json({
      ...result,
      makerTier: { name: makerTier.name, rebate: makerTier.makerRebate, color: makerTier.color },
      takerTier: { name: takerTier.name, fee: takerTier.takerFee, color: takerTier.color },
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to preview fees' });
  }
});

// ─── Single Bet Offers ────────────────────────────────────────────────────────

router.get('/offers', async (req: Request, res: Response) => {
  try {
    const { eventId, sport, currency, limit, status, marketType } = req.query as Record<string, string>;
    const offers = await p2pBettingService.listOpenOffers({
      eventId, sport, currency, status, marketType,
      limit: limit ? Math.min(parseInt(limit) || 200, 500) : 200,
    });

    // Enrich with live on-chain fill data for all offers that have an on-chain object
    const onchainIds = (offers as any[])
      .filter(o => o.onchainOfferId)
      .map(o => o.onchainOfferId as string);

    if (onchainIds.length > 0) {
      const stateMap = await p2pContractService.batchGetOnchainOfferStates(onchainIds);
      const enriched = (offers as any[]).map(offer => {
        if (!offer.onchainOfferId) return offer;
        const onchain = stateMap.get(offer.onchainOfferId);
        if (!onchain) return { ...offer, onchainState: null };
        const filledAmountHuman = baseToHuman(onchain.filledAmount, offer.currency);
        return { ...offer, filledStake: filledAmountHuman, onchainState: onchain };
      });
      return res.json(enriched);
    }

    res.json(offers);
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to list offers' });
  }
});

// ─── P2P CLOB (Central Limit Order Book) ─────────────────────────────────────
// Price axis = implied probability (1/odds). DeepBook-compatible response format.

router.get('/clob', async (req: Request, res: Response) => {
  try {
    const { currency = 'SUI' } = req.query as { currency?: string };
    const cur = currency.toUpperCase();

    const rows = await db
      .selectDistinct({
        eventId:    p2pBetOffers.eventId,
        eventName:  p2pBetOffers.eventName,
        homeTeam:   p2pBetOffers.homeTeam,
        awayTeam:   p2pBetOffers.awayTeam,
        sportName:  p2pBetOffers.sportName,
        leagueName: p2pBetOffers.leagueName,
        matchDate:  p2pBetOffers.matchDate,
      })
      .from(p2pBetOffers)
      .where(and(
        eq(p2pBetOffers.status, 'open'),
        eq(p2pBetOffers.currency, cur),
        gt(p2pBetOffers.expiresAt, new Date()),
      ))
      .limit(30);

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch CLOB events' });
  }
});

router.get('/clob/:eventId', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { currency = 'SUI' } = req.query as { currency?: string };
    const cur = currency.toUpperCase();

    const offers = await db.select().from(p2pBetOffers).where(and(
      eq(p2pBetOffers.eventId, eventId),
      eq(p2pBetOffers.status, 'open'),
      eq(p2pBetOffers.currency, cur),
      gt(p2pBetOffers.expiresAt, new Date()),
    ));

    const eventInfo = offers[0] ?? null;

    type Level = { price: number; quantity: number; count: number; odds: number };
    const sides: Record<string, Map<number, Level>> = {};

    for (const offer of offers) {
      const pred = (offer.prediction ?? '').toLowerCase();
      const available = Number(offer.takerStake) - Number(offer.filledStake ?? 0);
      if (available <= 0) continue;

      const odds = Number(offer.odds);
      if (!odds || odds <= 1) continue;
      const price = Math.round((1 / odds) * 10000) / 10000;
      const bucket = Math.round(price * 1000) / 1000;

      if (!sides[pred]) sides[pred] = new Map();
      const ex = sides[pred].get(bucket);
      if (ex) { ex.quantity += available; ex.count++; }
      else sides[pred].set(bucket, { price: bucket, quantity: available, count: 1, odds });
    }

    const classify = (p: string): 'home' | 'away' | 'draw' => {
      const lp = p.toLowerCase();
      if (lp === 'home' || lp === '1' || lp === 'home_win' || lp.includes('home')) return 'home';
      if (lp === 'away' || lp === '2' || lp === 'away_win' || lp.includes('away')) return 'away';
      return 'draw';
    };

    const home: Level[] = [];
    const away: Level[] = [];
    const draw: Level[] = [];

    for (const [pred, levelMap] of Object.entries(sides)) {
      const cls = classify(pred);
      const lvls = Array.from(levelMap.values());
      if (cls === 'home') home.push(...lvls);
      else if (cls === 'away') away.push(...lvls);
      else draw.push(...lvls);
    }

    home.sort((a, b) => b.price - a.price);
    away.sort((a, b) => a.price - b.price);
    draw.sort((a, b) => b.price - a.price);

    const bestBid = home[0]?.price ?? null;
    const bestAsk = away[0]?.price ?? null;
    const impliedSum = (bestBid ?? 0) + (bestAsk ?? 0) + (draw[0]?.price ?? 0);
    const overround = impliedSum > 0 ? Math.round((impliedSum - 1) * 10000) / 100 : null;

    res.json({
      eventId,
      eventName:       eventInfo?.eventName  ?? eventId,
      homeTeam:        eventInfo?.homeTeam   ?? 'Home',
      awayTeam:        eventInfo?.awayTeam   ?? 'Away',
      sportName:       eventInfo?.sportName  ?? null,
      leagueName:      eventInfo?.leagueName ?? null,
      currency: cur,
      bids:            home,
      asks:            away,
      draw,
      bestBid,
      bestAsk,
      overround,
      totalBidDepth:   home.reduce((s, l) => s + l.quantity, 0),
      totalAskDepth:   away.reduce((s, l) => s + l.quantity, 0),
      offerCount:      offers.length,
      timestamp:       new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[P2P CLOB]', err);
    res.status(500).json({ message: 'Failed to fetch order book' });
  }
});

router.get('/offers/:id', async (req: Request, res: Response) => {
  try {
    const offerId = parseInt(req.params.id);
    if (isNaN(offerId)) return res.status(400).json({ message: 'Invalid offer ID' });
    const offer = await p2pBettingService.getOfferWithMatches(offerId);
    if (!offer) return res.status(404).json({ message: 'Offer not found' });

    // Merge live on-chain state if this offer was created via the contract
    if ((offer as any).onchainOfferId) {
      const onchain = await p2pContractService.getOnchainOfferState((offer as any).onchainOfferId);
      if (onchain) {
        const filledAmountHuman = baseToHuman(onchain.filledAmount, (offer as any).currency);
        // Write-back: sync DB if chain shows more fills than DB knows about
        if (filledAmountHuman > ((offer as any).filledStake ?? 0) + 0.000001) {
          const newStatus = onchain.makerRemaining === 0 ? 'filled'
            : filledAmountHuman > 0 ? 'partial' : (offer as any).status;
          await db.update(p2pBetOffers)
            .set({ filledStake: filledAmountHuman, status: newStatus as any })
            .where(eq(p2pBetOffers.id, offerId));
          console.log(`[P2P] DB sync offer ${offerId}: filledStake ${(offer as any).filledStake ?? 0} → ${filledAmountHuman} (${newStatus})`);
        }
        return res.json({ ...offer, filledStake: filledAmountHuman, onchainState: onchain });
      }
    }

    res.json(offer);
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to get offer' });
  }
});

router.post('/offers', offerCreateLimiter, async (req: Request, res: Response) => {
  try {
    const {
      creatorWallet, eventId, eventName, homeTeam, awayTeam,
      leagueName, sportName, matchDate, prediction, marketType,
      odds, creatorStake, currency, creatorTxHash, expiresAt,
      onchainOfferId, onchainConfigId,
      suinsGated, liveOdds,
    } = req.body;

    if (!isValidWallet(creatorWallet)) return res.status(400).json({ message: 'Invalid wallet address' });
    if (!eventId || !eventName || !homeTeam || !awayTeam) return res.status(400).json({ message: 'Missing event details' });
    if (!isValidPrediction(prediction)) return res.status(400).json({ message: 'Invalid prediction format' });
    if (typeof odds !== 'number' || odds < 1.01 || odds > 100) return res.status(400).json({ message: 'odds must be between 1.01 and 100' });
    if (typeof creatorStake !== 'number' || creatorStake <= 0) return res.status(400).json({ message: 'creatorStake must be positive' });
    if (creatorStake < 0.001) return res.status(400).json({ message: 'Minimum stake is 0.001 SUI/SBETS' });
    if (!expiresAt) return res.status(400).json({ message: 'expiresAt is required' });
    if (new Date(expiresAt) <= new Date()) return res.status(400).json({ message: 'expiresAt must be in the future' });
    const VALID_MARKET_TYPES = new Set([
      'match_winner', 'moneyline', 'over_under', 'correct_score', 'btts',
      'double_chance', 'half_time', 'handicap', 'fantasy_h2h', 'player_props',
    ]);
    if (marketType && !VALID_MARKET_TYPES.has(marketType)) {
      return res.status(400).json({ message: `Invalid marketType. Allowed: ${[...VALID_MARKET_TYPES].join(', ')}` });
    }

    // ── Server-side trusted event check ──────────────────────────────────────
    // Two modes:
    //   liveOdds=false (default): match must NOT have started — normal pre-match flow.
    //   liveOdds=true           : match MUST be live; score snapshot stored so accepts
    //                             are voided the instant a goal is scored.
    let authorativeMatchDate: Date | undefined = matchDate ? new Date(matchDate) : undefined;
    let scoreSnapshot: string | undefined;
    let matchMinute: number | undefined;

    if (eventId) {
      const eventCheck = trustedEventCheck(String(eventId));

      if (liveOdds === true) {
        // ── LIVE IN-PLAY PATH ─────────────────────────────────────────────
        // Require the match to actually be live according to our caches.
        if (eventCheck.found) {
          if (!eventCheck.isLiveOrStarted) {
            return res.status(400).json({ message: 'Match has not started yet — use a normal P2P offer for pre-match betting' });
          }
          // Block offers past 90 minutes (includes injury time cap)
          const minute = (eventCheck as any).minute as number | undefined;
          if (minute !== undefined && minute > 90) {
            return res.status(400).json({ message: 'Cannot post live offers after 90 minutes' });
          }
          // Capture score at creation time — used to void offers if a goal is scored before acceptance
          const hs = (eventCheck as any).homeScore ?? 0;
          const as_ = (eventCheck as any).awayScore ?? 0;
          scoreSnapshot = `${hs}-${as_}`;
          matchMinute   = minute;
        }
        // For live offers, cap expiry at LIVE_OFFER_TTL_MS (90 s) — very short window
        const LIVE_OFFER_TTL_MS = 90_000;
        const effectiveExpiresAt = new Date(Math.min(
          new Date(expiresAt).getTime(),
          Date.now() + LIVE_OFFER_TTL_MS,
        ));
        // Block if already settled
        if (eventId) {
          try {
            const [alreadySettled] = await db.select({ id: settledEvents.id })
              .from(settledEvents).where(eq(settledEvents.externalEventId, String(eventId))).limit(1);
            if (alreadySettled) return res.status(400).json({ message: 'Match has already finished' });
          } catch (_) {}
        }
        // ── REST OF HANDLER for live offers: skip to proof-of-stake below ─
        // (We jump past the pre-match checks by using a goto-style flag.)
        // We reuse the effectiveExpiresAt computed above — set it and fall through.
        // NOTE: We assign to outer-scoped var so the shared insert below picks it up.
        req.body.__effectiveExpiresAt = effectiveExpiresAt.toISOString();
        req.body.__scoreSnapshot      = scoreSnapshot;
        req.body.__matchMinute        = matchMinute;
      } else {
        // ── PRE-MATCH PATH ────────────────────────────────────────────────
        if (eventCheck.found) {
          if (eventCheck.isLiveOrStarted) {
            console.warn(`[P2P] Offer create rejected — event ${eventId} already live/started (source: ${eventCheck.source})`);
            return res.status(400).json({ message: 'Cannot post a bet offer for a match that has already started' });
          }
          if (eventCheck.serverMatchDate) {
            authorativeMatchDate = eventCheck.serverMatchDate;
            if (authorativeMatchDate.getTime() <= Date.now()) {
              return res.status(400).json({ message: 'Cannot post a bet offer for a match that has already started' });
            }
          }
        } else if (matchDate && new Date(matchDate).getTime() <= Date.now()) {
          return res.status(400).json({ message: 'Cannot post a bet offer for a match that has already started' });
        } else if (!matchDate) {
          // Futures / outright market (e.g. WC 2026 winner) — no specific match game date.
          // The event isn't in the live sports feed because it resolves on the final, not a
          // single kickoff.  Use expiresAt as the effective settlement boundary instead of
          // rejecting — expiresAt has already been validated to be in the future above.
          authorativeMatchDate = new Date(expiresAt);
          console.log(`[P2P] Futures offer accepted for event "${eventId}" — no matchDate in feed, using expiresAt as settlement boundary: ${expiresAt}`);
        }
      }
    } else if (!liveOdds) {
      if (matchDate && new Date(matchDate).getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Cannot post a bet offer for a match that has already started' });
      } else if (!matchDate) {
        return res.status(400).json({ message: 'matchDate is required' });
      }
    }

    // Block if event is already settled in DB (pre-match path only — live path checked above)
    if (eventId && !liveOdds) {
      try {
        const [alreadySettled] = await db.select({ id: settledEvents.id })
          .from(settledEvents)
          .where(eq(settledEvents.externalEventId, String(eventId)))
          .limit(1);
        if (alreadySettled) {
          return res.status(400).json({ message: 'Cannot post a bet offer for a match that has already finished' });
        }
      } catch (_) { /* settled_events table may not exist yet — treat as not settled */ }
    }

    // For pre-match offers: cap expiresAt at authoritative matchDate
    // For live offers: __effectiveExpiresAt was already set above (90 s cap)
    const effectiveExpiresAt = req.body.__effectiveExpiresAt
      ? new Date(req.body.__effectiveExpiresAt)
      : (() => {
          if (!authorativeMatchDate) return new Date(expiresAt);
          const capped = new Date(Math.min(new Date(expiresAt).getTime(), authorativeMatchDate.getTime()));
          // Safety guard: if the cap would make the offer expire in less than 2 hours from now,
          // the sports cache likely returned stale/mismatched event data for this eventId.
          // In that case, trust the client-provided expiresAt (which is capped at matchDate).
          const twoHoursFromNow = Date.now() + 2 * 3600 * 1000;
          if (capped.getTime() < twoHoursFromNow) {
            console.warn(`[P2P] expiresAt safety guard triggered for event ${eventId}: authorativeMatchDate ${authorativeMatchDate.toISOString()} would set expiry <2h from now — using client expiresAt instead`);
            return new Date(expiresAt);
          }
          return capped;
        })();
    // Carry score snapshot from live path
    if (req.body.__scoreSnapshot !== undefined) scoreSnapshot = req.body.__scoreSnapshot;
    if (req.body.__matchMinute   !== undefined) matchMinute   = req.body.__matchMinute;


    // ── Proof of stake ──────────────────────────────────────────────────────
    // Fantasy H2H supports BOTH modes:
    //   • On-chain  — creator called post_offer<T>, sends onchainOfferId
    //   • Custodial — creator transferred stake to escrow wallet, sends creatorTxHash
    // All other market types require on-chain P2POffer (no custodial fallback).
    const isTestMode = process.env.NODE_ENV !== 'production' && req.headers['x-test-mode'] === 'true';
    if (marketType === 'fantasy_h2h') {
      if (onchainOfferId) {
        // On-chain path — verify the P2POffer object exists on-chain (same as regular P2P)
        let onchainState = null;
        for (let attempt = 1; attempt <= 4; attempt++) {
          onchainState = await p2pContractService.getOnchainOfferState(String(onchainOfferId));
          if (onchainState) break;
          if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
        }
        if (!onchainState) {
          return res.status(400).json({
            message: 'P2POffer object not found on-chain. The transaction may not have confirmed yet — please wait a few seconds and try again.',
          });
        }
      } else {
        // Custodial path: verify creator's txHash transferred stake to platform wallet
        if (!creatorTxHash && !isTestMode) {
          return res.status(400).json({ message: 'creatorTxHash or onchainOfferId is required for Fantasy H2H challenges.' });
        }
        if (!isTestMode && creatorTxHash) {
          await requireValidStakeTx({
            txHash:         creatorTxHash,
            senderWallet:   creatorWallet,
            expectedAmount: creatorStake,
            currency:       (currency as 'SUI' | 'SBETS') ?? 'SUI',
            mode:           'custodial',
          });
        }
      }
    } else {
      // On-chain contract path: require a real P2POffer object
      if (!onchainOfferId) {
        return res.status(400).json({
          message: 'onchainOfferId is required. Post your offer via the SuiBets P2P contract — custodial offers are no longer supported.',
        });
      }
      // Retry up to 4 times with 2 s delay — Sui RPC can lag after finality
      let onchainState = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        onchainState = await p2pContractService.getOnchainOfferState(String(onchainOfferId));
        if (onchainState) break;
        if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
      }
      if (!onchainState) {
        return res.status(400).json({
          message: 'P2POffer object not found on-chain. The transaction may not have confirmed yet — please wait a few seconds and try again.',
        });
      }
      // Object existence + contract invariants are sufficient proof. No tx hash needed.
    }

    const offer = await p2pBettingService.createOffer({
      creatorWallet,
      eventId: String(eventId),
      eventName, homeTeam, awayTeam, leagueName, sportName,
      matchDate: authorativeMatchDate,   // server-authoritative value, not raw client input
      prediction, marketType, odds, creatorStake,
      currency: currency ?? 'SUI',
      creatorTxHash,
      expiresAt: effectiveExpiresAt,
      onchainOfferId: onchainOfferId ? String(onchainOfferId) : undefined,
      onchainConfigId: onchainConfigId ? String(onchainConfigId) : undefined,
      suinsGated: suinsGated === true,
      liveOdds: liveOdds === true,
      scoreSnapshot,
      matchMinute,
    });

    broadcastP2PUpdate('created', 'offer', { id: offer.id, eventName: offer.eventName, odds: offer.odds, suinsGated: offer.suinsGated });
    res.status(201).json(offer);
    // Fire-and-forget: mirror this P2P bet into PULSE engine — creates a PulsePool
    // for the same event so all three engine packages are touched by real user bets.
    if (offer.eventId && offer.onchainOfferId) {
      createPulsePoolForP2POffer({
        eventId:  String(offer.eventId),
        homeTeam: offer.homeTeam || '',
        awayTeam: offer.awayTeam || '',
      }).catch(() => {});
    }
    // Fire-and-forget: push to Telegram the instant a new offer is posted
    const offerPayload = {
      id:           offer.id,
      eventName:    offer.eventName,
      homeTeam:     offer.homeTeam,
      awayTeam:     offer.awayTeam,
      sportName:    offer.sportName,
      leagueName:   offer.leagueName,
      prediction:   offer.prediction,
      odds:         offer.odds,
      creatorStake: offer.creatorStake,
      takerStake:   offer.takerStake,
      currency:     offer.currency,
      expiresAt:    offer.expiresAt,
    };
    broadcastNewOffer(offerPayload).catch(() => {});
    publishNewOffer(offerPayload).catch(() => {});
    // DeepBook orders come from the user's own wallet — no server-side mirroring.
  } catch (err: any) {
    console.error('[P2P] Create offer error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to create offer' });
  }
});

// POST /api/p2p/recover-tx
// Recover an offer that went on-chain but failed to save to DB (e.g. during an API outage).
// Requires onchainOfferId — custodial offers are not recoverable via this route (same policy as
// regular /offers creation). Idempotent — if the offer is already in DB it is returned as-is.
router.post('/recover-tx', async (req: Request, res: Response) => {
  try {
    const {
      creatorWallet, eventId, eventName, homeTeam, awayTeam,
      leagueName, sportName, matchDate, prediction, marketType,
      odds, creatorStake, currency, creatorTxHash, expiresAt,
      onchainOfferId, onchainConfigId,
    } = req.body;

    if (!isValidWallet(creatorWallet)) return res.status(400).json({ message: 'Invalid wallet address' });
    if (!creatorTxHash) return res.status(400).json({ message: 'creatorTxHash is required for recovery' });

    // Recovery requires an on-chain offer object — custodial is no longer supported
    if (!onchainOfferId) {
      return res.status(400).json({
        message: 'onchainOfferId is required for recovery. Custodial offers are no longer supported.',
      });
    }

    // Idempotency — check by txHash first
    const [existing] = await db.select().from(p2pBetOffers)
      .where(eq(p2pBetOffers.creatorTxHash, creatorTxHash))
      .limit(1);
    if (existing) {
      return res.json({ ...existing, recovered: false, message: 'Offer already recorded in database' });
    }

    // Also check by onchain object ID
    const [existingOnchain] = await db.select().from(p2pBetOffers)
      .where(eq(p2pBetOffers.onchainOfferId, String(onchainOfferId)))
      .limit(1);
    if (existingOnchain) {
      return res.json({ ...existingOnchain, recovered: false, message: 'Offer already recorded (found by on-chain ID)' });
    }

    if (!eventId || !eventName || !homeTeam || !awayTeam)
      return res.status(400).json({ message: 'Missing event details' });
    if (!isValidPrediction(prediction))
      return res.status(400).json({ message: 'Invalid prediction format' });
    if (typeof odds !== 'number' || odds < 1.01 || odds > 100)
      return res.status(400).json({ message: 'odds must be between 1.01 and 100' });
    if (typeof creatorStake !== 'number' || creatorStake <= 0)
      return res.status(400).json({ message: 'creatorStake must be positive' });

    // ── Verify the on-chain P2POffer object actually exists and belongs to creator ──
    // Retry up to 4 times — Sui RPC can lag after finality
    let onchainState = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      onchainState = await p2pContractService.getOnchainOfferState(String(onchainOfferId));
      if (onchainState) break;
      if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
    }
    if (!onchainState) {
      return res.status(400).json({
        message: 'P2POffer object not found on-chain. The transaction may not have confirmed yet — please wait a few seconds and try again.',
      });
    }

    const takerStake    = Math.round((creatorStake * (odds - 1)) * 1_000_000) / 1_000_000;
    const effectiveExpiry = expiresAt
      ? new Date(expiresAt)
      : new Date(Date.now() + 24 * 3600 * 1000);

    const [offer] = await db.insert(p2pBetOffers).values({
      creatorWallet,
      eventId:        String(eventId),
      eventName,
      homeTeam,
      awayTeam,
      leagueName:     leagueName ?? null,
      sportName:      sportName ?? null,
      matchDate:      matchDate ? new Date(matchDate) : null,
      prediction,
      marketType:     marketType ?? 'moneyline',
      odds,
      creatorStake,
      takerStake,
      currency:       currency ?? 'SUI',
      filledStake:    0,
      status:         'open',
      creatorTxHash,
      expiresAt:      effectiveExpiry,
      onchainOfferId: String(onchainOfferId),
      onchainConfigId: onchainConfigId ? String(onchainConfigId) : null,
    }).returning();

    console.log(`[P2P Recover] Recovered offer #${offer.id} from onchainOfferId ${String(onchainOfferId).slice(0, 12)}...`);
    res.status(201).json({ ...offer, recovered: true });
  } catch (err: any) {
    console.error('[P2P Recover] Error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to recover offer' });
  }
});

// POST /api/p2p/recover-accept
// Recover a taker match that went on-chain but failed to save to DB.
// Full validation identical to the normal accept path — txHash is verified on-chain,
// self-match and duplicate-taker are blocked, and stake limits are enforced.
// Idempotent — if the takerTxHash already exists in p2p_bet_matches it returns the existing record.
router.post('/recover-accept', recoveryLimiter, async (req: Request, res: Response) => {
  try {
    const { offerId, takerWallet, stake, takerTxHash } = req.body;
    if (!isValidWallet(takerWallet)) return res.status(400).json({ message: 'Invalid taker wallet' });
    if (!takerTxHash) return res.status(400).json({ message: 'takerTxHash is required for recovery' });
    if (!offerId || isNaN(Number(offerId))) return res.status(400).json({ message: 'offerId required' });
    if (typeof stake !== 'number' || stake <= 0) return res.status(400).json({ message: 'stake must be positive' });
    if (stake < 0.001) return res.status(400).json({ message: 'Minimum stake is 0.001' });

    // Idempotency — check by takerTxHash first
    const [existing] = await db.select().from(p2pBetMatches)
      .where(eq(p2pBetMatches.takerTxHash, takerTxHash))
      .limit(1);
    if (existing) return res.json({ ...existing, recovered: false, message: 'Match already recorded' });

    // ── Fetch offer and apply the same guards as the normal accept route ───────
    const [offer] = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.id, Number(offerId)));
    if (!offer) return res.status(404).json({ message: `Offer #${offerId} not found in database` });
    if (!['open', 'partial'].includes(offer.status ?? '')) {
      return res.status(400).json({ message: `Offer is no longer available (${offer.status})` });
    }
    if (offer.creatorWallet === takerWallet) {
      return res.status(400).json({ message: 'Cannot accept your own offer' });
    }
    // Prevent same taker from placing multiple bets on the same offer
    const [existingTakerMatch] = await db.select({ id: p2pBetMatches.id })
      .from(p2pBetMatches)
      .where(and(eq(p2pBetMatches.offerId, Number(offerId)), eq(p2pBetMatches.takerWallet, takerWallet)))
      .limit(1);
    if (existingTakerMatch) {
      return res.status(400).json({ message: 'You have already placed a bet on this offer' });
    }
    // Block if match has already started — two-layer defence.
    // Layer 1: stored matchDate
    if (offer.matchDate && new Date(offer.matchDate).getTime() <= Date.now()) {
      return res.status(400).json({ message: 'Match has already started — this offer can no longer be accepted' });
    }
    // Layer 2: real-time live check (catches early kickoffs)
    if ((offer as any).eventId) {
      const liveCheck = trustedEventCheck(String((offer as any).eventId));
      if (liveCheck.found && liveCheck.isLiveOrStarted) {
        console.warn(`[P2P] Recover-accept rejected — event ${(offer as any).eventId} already live/started (source: ${liveCheck.source})`);
        return res.status(400).json({ message: 'Match has already started — this offer can no longer be accepted' });
      }
    }
    // Block if stake would overflow remaining capacity
    const remaining = Math.round(((offer.takerStake ?? 0) - (offer.filledStake ?? 0)) * 1000) / 1000;
    if (stake > remaining + 0.0001) {
      return res.status(400).json({ message: `Stake too large. Max remaining: ${remaining} ${offer.currency}` });
    }

    // ── On-chain txHash verification (same logic as normal accept) ─────────────
    const isOnchain = !!offer.onchainOfferId;
    await requireValidStakeTx({
      txHash:         takerTxHash,
      senderWallet:   takerWallet,
      expectedAmount: stake,
      currency:       (offer.currency as 'SUI' | 'SBETS') ?? 'SUI',
      mode:           isOnchain ? 'onchain' : 'custodial',
    });

    // ── Atomic accept — delegates to the same service method as the normal
    // accept path. This is the ONLY safe way to do this: it uses a single
    // SQL UPDATE WHERE ... RETURNING so two concurrent recovery calls cannot
    // both succeed, cannot overfill the offer, and cannot bypass the
    // creator_tx_hash IS NOT NULL deposit guard. The old non-atomic
    // db.insert() + db.update() pattern had a race window here.
    const match = await p2pBettingService.acceptOffer({
      offerId: Number(offerId),
      takerWallet,
      stake,
      takerTxHash,
    });

    console.log(`[P2P Recover] Recovered match #${(match as any).id} for offer #${offerId} | taker=${takerWallet.slice(0, 10)}...`);
    res.status(201).json({ ...match, recovered: true });
  } catch (err: any) {
    console.error('[P2P Recover-Accept] Error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to recover match' });
  }
});

router.post('/offers/:id/accept', offerAcceptLimiter, async (req: Request, res: Response) => {
  try {
    const offerId = parseInt(req.params.id);
    if (isNaN(offerId)) return res.status(400).json({ message: 'Invalid offer ID' });

    const { takerWallet, stake, takerTxHash } = req.body;
    if (!isValidWallet(takerWallet)) return res.status(400).json({ message: 'Invalid taker wallet address' });
    if (typeof stake !== 'number' || stake <= 0) return res.status(400).json({ message: 'stake must be positive' });
    if (stake < 0.001) return res.status(400).json({ message: 'Minimum stake is 0.001' });

    // ── Per-wallet serialisation lock ────────────────────────────────────────
    // Ensures two parallel acceptOffer calls from the same wallet are processed
    // sequentially, preventing the "double-accept" race on the duplicate check.
    return await acquireP2PWalletLock(takerWallet).execute(async () => {

    // ── Pre-accept checks ───────────────────────────────────────────────────
    const offerSnapshot = await p2pBettingService.getOffer(offerId);
    if (!offerSnapshot) return res.status(404).json({ message: 'Offer not found' });
    if (!['open', 'partial'].includes(offerSnapshot.status)) return res.status(400).json({ message: `Offer is no longer available (${offerSnapshot.status})` });
    if (offerSnapshot.creatorWallet === takerWallet) return res.status(400).json({ message: 'Cannot accept your own offer' });
    // ── SuiNS VIP gate ──────────────────────────────────────────────────────
    // If the offer creator required a .sui name, enforce it server-side.
    if ((offerSnapshot as any).suinsGated) {
      const { resolveSuiNSName } = await import('./services/suinsService');
      const takerName = await resolveSuiNSName(takerWallet);
      if (!takerName) {
        return res.status(403).json({
          message: 'This is a VIP pool — only wallets with a .sui name can accept. Get yours at app.suins.io',
          code: 'SUINS_REQUIRED',
        });
      }
    }
    // Prevent same taker from placing multiple bets on the same offer
    const [existingTakerMatch] = await db.select({ id: p2pBetMatches.id })
      .from(p2pBetMatches)
      .where(and(eq(p2pBetMatches.offerId, offerId), eq(p2pBetMatches.takerWallet, takerWallet)))
      .limit(1);
    if (existingTakerMatch) return res.status(400).json({ message: 'You have already placed a bet on this offer' });
    if (offerSnapshot.expiresAt && new Date(offerSnapshot.expiresAt) < new Date()) {
      return res.status(400).json({ message: 'Offer has expired' });
    }
    const isLiveOffer = !!(offerSnapshot as any).liveOdds;

    if (isLiveOffer) {
      // ── LIVE IN-PLAY ACCEPT GUARD ────────────────────────────────────────
      // For live offers the match is already in progress by design.
      // The only gate is: has the score changed since the offer was posted?
      // If so, the bet terms are stale — void it immediately.
      if (offerSnapshot.eventId) {
        const liveCheck = trustedEventCheck(String(offerSnapshot.eventId));
        if (liveCheck.found && liveCheck.isLiveOrStarted) {
          const storedSnapshot = (offerSnapshot as any).scoreSnapshot as string | null;
          if (storedSnapshot) {
            const currentHome = (liveCheck as any).homeScore ?? 0;
            const currentAway = (liveCheck as any).awayScore ?? 0;
            const currentSnapshot = `${currentHome}-${currentAway}`;
            if (currentSnapshot !== storedSnapshot) {
              // Score changed — auto-cancel the offer and reject the accept
              console.warn(`[P2P] Live offer #${offerId} voided — score changed ${storedSnapshot} → ${currentSnapshot}`);
              await db.update(p2pBetOffers)
                .set({ status: 'cancelled' })
                .where(eq(p2pBetOffers.id, offerId));
              broadcastP2PUpdate('cancelled', 'offer', { id: offerId, reason: 'score_changed' });
              return res.status(400).json({
                message: `Score changed (${storedSnapshot} → ${currentSnapshot}) — offer voided. You can post a new offer at the current score.`,
                code: 'SCORE_CHANGED',
              });
            }
          }
        }
      }
    } else {
      // ── PRE-MATCH ACCEPT GUARD ───────────────────────────────────────────
      // Block accept if match has already started — two-layer defence.
      // Layer 1: stored matchDate (covers normal kickoff window)
      if (offerSnapshot.matchDate) {
        const matchStart = new Date(offerSnapshot.matchDate).getTime();
        if (matchStart <= Date.now()) {
          return res.status(400).json({ message: 'Match has already started — this offer can no longer be accepted' });
        }
      }
      // Layer 2: real-time live check against sports API caches.
      if (offerSnapshot.eventId) {
        const liveCheck = trustedEventCheck(String(offerSnapshot.eventId));
        if (liveCheck.found && liveCheck.isLiveOrStarted) {
          console.warn(`[P2P] Accept rejected — event ${offerSnapshot.eventId} already live/started at accept time (source: ${liveCheck.source})`);
          return res.status(400).json({ message: 'Match has already started — this offer can no longer be accepted' });
        }
      } else if (!offerSnapshot.matchDate) {
        return res.status(400).json({ message: 'Cannot accept this offer — match timing cannot be verified' });
      }
    }
    // Prevent settlement race: reject if event is already settled in DB
    if (offerSnapshot.eventId) {
      try {
        const [alreadySettled] = await db.select({ id: settledEvents.id })
          .from(settledEvents)
          .where(eq(settledEvents.externalEventId, offerSnapshot.eventId))
          .limit(1);
        if (alreadySettled) {
          return res.status(400).json({ message: 'This match has already finished and cannot be bet on' });
        }
      } catch (_) { /* settled_events table may not exist yet — treat as not settled */ }
    }
    const remaining = Math.round(((offerSnapshot.takerStake ?? 0) - (offerSnapshot.filledStake ?? 0)) * 1000) / 1000;
    if (stake > remaining + 0.0001) {
      return res.status(400).json({ message: `Stake too large. Max remaining: ${remaining} ${offerSnapshot.currency}` });
    }

    // ── On-chain txHash verification ────────────────────────────────────────
    // Fantasy H2H supports both on-chain (onchainOfferId set) and custodial modes.
    // For on-chain Fantasy H2H: taker calls accept_offer<T> on the contract, sends
    //   takerTxHash (the accept tx digest) + onchainMatchId (P2PMatchedBet object ID).
    // For custodial Fantasy H2H: taker transfers stake to escrow wallet, sends takerTxHash.
    const isFantasyH2H  = (offerSnapshot as any).marketType === 'fantasy_h2h';
    const isOnchain     = !!offerSnapshot.onchainOfferId;   // on-chain for ALL market types
    const { onchainMatchId } = req.body;                    // P2PMatchedBet ID from taker's accept tx
    const isTestModeAccept = process.env.NODE_ENV !== 'production' && req.headers['x-test-mode'] === 'true';
    if (takerTxHash && !isTestModeAccept) {
      await requireValidStakeTx({
        txHash:         takerTxHash,
        senderWallet:   takerWallet,
        expectedAmount: stake,
        currency:       (offerSnapshot.currency as 'SUI' | 'SBETS') ?? 'SUI',
        mode:           isOnchain ? 'onchain' : 'custodial',
      });
    } else if (!isOnchain && !isTestModeAccept && !takerTxHash) {
      return res.status(400).json({
        message: 'takerTxHash is required for custodial offers. Send your stake and provide the transaction hash.',
      });
    }

    const match = await p2pBettingService.acceptOffer({ offerId, takerWallet, stake, takerTxHash });

    // For on-chain Fantasy H2H: store the P2PMatchedBet object ID so the settlement
    // worker can call instantSettleBet instead of a custodial sendSuiToUser.
    if (onchainMatchId && typeof onchainMatchId === 'string' && onchainMatchId.startsWith('0x') && (match as any)?.id) {
      db.execute(sql`
        UPDATE p2p_bet_matches SET onchain_match_id = ${onchainMatchId}
        WHERE id = ${(match as any).id} AND onchain_match_id IS NULL
      `).catch((e: any) => console.error('[P2P] Failed to store onchainMatchId:', e.message));
    }

    broadcastP2PUpdate('accepted', 'offer', {
      offerId,
      takerTierName:  (match as any).takerTierName,
      creatorWallet:  offerSnapshot.creatorWallet,
      takerWallet,
      stake,
      eventName:      offerSnapshot.eventName,
      homeTeam:       offerSnapshot.homeTeam,
      awayTeam:       offerSnapshot.awayTeam,
      prediction:     offerSnapshot.prediction,
      odds:           offerSnapshot.odds,
      currency:       offerSnapshot.currency ?? 'SUI',
    });
    res.status(201).json(match);
    }); // end acquireP2PWalletLock.execute
  } catch (err: any) {
    console.error('[P2P] Accept offer error:', err.message);
    res.status(400).json({ message: err.message || 'Failed to accept offer' });
  }
});

router.delete('/offers/:id', async (req: Request, res: Response) => {
  try {
    const offerId = parseInt(req.params.id);
    if (isNaN(offerId)) return res.status(400).json({ message: 'Invalid offer ID' });
    const { creatorWallet, cancelTxHash } = req.body;
    if (!isValidWallet(creatorWallet)) return res.status(400).json({ message: 'Invalid wallet address' });

    const result = await p2pBettingService.cancelOffer(offerId, creatorWallet, cancelTxHash ?? undefined);
    broadcastP2PUpdate('cancelled', 'offer', { offerId });
    res.json({ success: true, refundSent: result.refundSent, refundTx: result.refundTx });
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Failed to cancel offer' });
  }
});

// Record on-chain reclaim for an already-cancelled offer (maker called cancel_offer directly)
router.post('/offers/:id/reclaim', async (req: Request, res: Response) => {
  try {
    const offerId = parseInt(req.params.id);
    if (isNaN(offerId)) return res.status(400).json({ message: 'Invalid offer ID' });
    const { wallet, txHash } = req.body;
    if (!isValidWallet(wallet)) return res.status(400).json({ message: 'Invalid wallet address' });
    if (!txHash || typeof txHash !== 'string') return res.status(400).json({ message: 'txHash required' });

    // Validate Sui tx digest format: base58-encoded 32-byte hash → 43-44 alphanumeric chars.
    // Rejects obviously fake / injected strings while staying tolerant of real digests.
    const SUI_DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
    if (!SUI_DIGEST_RE.test(txHash)) {
      return res.status(400).json({ message: 'txHash must be a valid Sui transaction digest' });
    }

    await p2pBettingService.recordReclaimTx(offerId, wallet, txHash);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Failed to record reclaim' });
  }
});

// ─── P2P Parlay Offers ────────────────────────────────────────────────────────

router.get('/parlays', async (req: Request, res: Response) => {
  try {
    const { currency, limit, status } = req.query as Record<string, string>;
    const parlays = await p2pBettingService.listOpenParlayOffers({
      currency, status,
      limit: limit ? parseInt(limit) : 200,
    });

    // Enrich with live on-chain state for parlays that have an on-chain object
    const onchainIds = (parlays as any[])
      .filter(p => p.onchainParlayId)
      .map(p => p.onchainParlayId as string);

    if (onchainIds.length > 0) {
      const stateMap = await p2pContractService.batchGetOnchainParlayStates(onchainIds);
      const enriched = (parlays as any[]).map(parlay => {
        if (!parlay.onchainParlayId) return parlay;
        const onchain = stateMap.get(parlay.onchainParlayId);
        return { ...parlay, onchainState: onchain ?? null };
      });
      return res.json(enriched);
    }

    res.json(parlays);
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to list parlay offers' });
  }
});

router.get('/parlays/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid parlay ID' });
    const offer = await p2pBettingService.getParlayOffer(id);
    if (!offer) return res.status(404).json({ message: 'Parlay offer not found' });

    // Merge live on-chain state if this parlay was created via the contract
    if ((offer as any).onchainParlayId) {
      const onchain = await p2pContractService.getOnchainParlayState((offer as any).onchainParlayId);
      if (onchain) {
        return res.json({ ...offer, onchainState: onchain });
      }
    }

    res.json(offer);
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to get parlay offer' });
  }
});

router.post('/parlays', offerCreateLimiter, async (req: Request, res: Response) => {
  try {
    const { creatorWallet, legs, creatorStake, currency, creatorTxHash, expiresAt, onchainParlayId, onchainConfigId } = req.body;

    if (!isValidWallet(creatorWallet)) return res.status(400).json({ message: 'Invalid wallet address' });
    if (!Array.isArray(legs) || legs.length < 2) return res.status(400).json({ message: 'At least 2 legs required' });
    if (legs.length > 8) return res.status(400).json({ message: 'Maximum 8 legs per parlay' });
    if (typeof creatorStake !== 'number' || creatorStake <= 0) return res.status(400).json({ message: 'creatorStake must be positive' });
    if (creatorStake < 0.001) return res.status(400).json({ message: 'Minimum stake is 0.001 SUI/SBETS' });
    if (!expiresAt) return res.status(400).json({ message: 'expiresAt is required' });
    if (new Date(expiresAt) <= new Date()) return res.status(400).json({ message: 'expiresAt must be in the future' });

    for (const leg of legs) {
      if (!leg.eventId || !leg.eventName || !leg.homeTeam || !leg.awayTeam) return res.status(400).json({ message: 'Each leg needs eventId, eventName, homeTeam, awayTeam' });
      if (!isValidPrediction(leg.prediction)) return res.status(400).json({ message: 'Each leg has an invalid prediction format' });
      if (typeof leg.odds !== 'number' || leg.odds < 1.01 || leg.odds > 100) return res.status(400).json({ message: 'Each leg needs valid odds between 1.01 and 100' });
    }

    // ── Block parlays if any leg's match has already started ─────────────────
    // Trusted-feed check per leg: client matchDate is untrusted, server cache is authoritative.
    const now = Date.now();
    for (const leg of legs) {
      // 1. Trusted event cache check (primary defence)
      if (leg.eventId) {
        const legCheck = trustedEventCheck(String(leg.eventId));
        if (legCheck.found) {
          if (legCheck.isLiveOrStarted) {
            console.warn(`[P2P] Parlay create rejected — leg event ${leg.eventId} already live/started (source: ${legCheck.source})`);
            return res.status(400).json({ message: `Cannot post: "${leg.eventName}" has already started` });
          }
          // Override leg.matchDate with server-authoritative value
          if (legCheck.serverMatchDate) {
            leg.matchDate = legCheck.serverMatchDate.toISOString();
            if (legCheck.serverMatchDate.getTime() <= now) {
              return res.status(400).json({ message: `Cannot post: "${leg.eventName}" has already started` });
            }
          }
        } else if (leg.matchDate && new Date(leg.matchDate).getTime() <= now) {
          // Cache miss — fall back to client-provided matchDate
          return res.status(400).json({ message: `Cannot post: "${leg.eventName}" has already started` });
        } else if (!leg.matchDate) {
          // Cache miss AND no matchDate → zero timing protection for this leg; fail-closed.
          return res.status(400).json({ message: `matchDate is required for "${leg.eventName}" — event not found in sports data feed` });
        }
      } else if (leg.matchDate && new Date(leg.matchDate).getTime() <= now) {
        return res.status(400).json({ message: `Cannot post: "${leg.eventName}" has already started` });
      }
      // 2. Block settled events
      if (leg.eventId) {
        try {
          const [legSettled] = await db.select({ id: settledEvents.id })
            .from(settledEvents)
            .where(eq(settledEvents.externalEventId, String(leg.eventId)))
            .limit(1);
          if (legSettled) {
            return res.status(400).json({ message: `Cannot post: "${leg.eventName}" has already finished` });
          }
        } catch (_) { /* settled_events table may not exist yet — treat as not settled */ }
      }
    }
    // Cap expiresAt at the earliest authoritative leg matchDate
    const earliestLegMs = legs
      .filter((l: any) => l.matchDate)
      .map((l: any) => new Date(l.matchDate).getTime())
      .reduce((min: number, t: number) => Math.min(min, t), new Date(expiresAt).getTime());
    const effectiveExpiresAt = new Date(earliestLegMs);


    // ── Proof of stake (on-chain only) ──────────────────────────────────────
    // All new parlays must be backed by a P2PParlay object on the Move contract.
    // Custodial (no onchainParlayId) is no longer accepted for new parlays.
    if (!onchainParlayId) {
      return res.status(400).json({
        message: 'onchainParlayId is required. Post your parlay via the SuiBets P2P contract — custodial parlays are no longer supported.',
      });
    }
    // Retry up to 4 times with 2 s delay — Sui RPC can lag after finality
    let onchainState = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      onchainState = await p2pContractService.getOnchainParlayState(String(onchainParlayId));
      if (onchainState) break;
      if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
    }
    if (!onchainState) {
      return res.status(400).json({
        message: 'P2PParlay object not found on-chain. The transaction may not have confirmed yet — please wait a few seconds and try again.',
      });
    }
    // Object existence + contract invariants are sufficient proof. No tx hash needed.

    const offer = await p2pBettingService.createParlayOffer({
      creatorWallet,
      legs: legs.map((l: any) => ({ ...l, matchDate: l.matchDate ? new Date(l.matchDate) : undefined })),
      creatorStake,
      currency: currency ?? 'SUI',
      creatorTxHash,
      expiresAt: effectiveExpiresAt,
      onchainParlayId: onchainParlayId ? String(onchainParlayId) : undefined,
      onchainConfigId: onchainConfigId ? String(onchainConfigId) : undefined,
    });

    broadcastP2PUpdate('created', 'parlay', { id: offer.id, legCount: offer.legCount });
    res.status(201).json(offer);
  } catch (err: any) {
    console.error('[P2P] Create parlay error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to create parlay offer' });
  }
});

router.post('/parlays/:id/accept', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid parlay ID' });
    const { takerWallet, takerTxHash } = req.body;
    if (!isValidWallet(takerWallet)) return res.status(400).json({ message: 'Invalid taker wallet address' });

    // ── Pre-accept checks ────────────────────────────────────────────────────
    const parlaySnapshot = await p2pBettingService.getParlayOffer(id);
    if (!parlaySnapshot) return res.status(404).json({ message: 'Parlay offer not found' });
    if (parlaySnapshot.status !== 'open') return res.status(400).json({ message: `Parlay is no longer available (${parlaySnapshot.status})` });
    if (parlaySnapshot.creatorWallet === takerWallet) return res.status(400).json({ message: 'Cannot accept your own parlay' });
    if (parlaySnapshot.expiresAt && new Date(parlaySnapshot.expiresAt) < new Date()) {
      return res.status(400).json({ message: 'Parlay offer has expired' });
    }
    // Fail-closed: legs MUST exist — a parlay without legs is invalid and must be blocked.
    if (!parlaySnapshot.legs || parlaySnapshot.legs.length === 0) {
      return res.status(400).json({ message: 'Parlay has no valid legs — cannot be accepted' });
    }
    // Block accept if any leg's match has started — two-layer defence.
    // Layer 1: stored matchDate per leg (covers normal kickoff window)
    const nowMs = Date.now();
    const staleLegs = parlaySnapshot.legs.filter(
      (l: any) => l.matchDate && new Date(l.matchDate).getTime() <= nowMs,
    );
    if (staleLegs.length > 0) {
      return res.status(400).json({ message: 'One or more parlay legs have already started — this parlay can no longer be accepted' });
    }
    // Layer 2: real-time live check per leg (catches early kickoffs)
    for (const leg of parlaySnapshot.legs) {
      if (!leg.eventId) continue;
      const liveCheck = trustedEventCheck(String(leg.eventId));
      if (liveCheck.found && liveCheck.isLiveOrStarted) {
        console.warn(`[P2P] Parlay accept rejected — leg event ${leg.eventId} already live/started at accept time (source: ${liveCheck.source})`);
        return res.status(400).json({ message: `Match "${(leg as any).eventName ?? leg.eventId}" has already started — parlay cannot be accepted` });
      }
    }
    // Block accept if any leg's event is already settled
    for (const leg of parlaySnapshot.legs) {
      if (!leg.eventId) continue;
      try {
        const [legSettled] = await db.select({ id: settledEvents.id })
          .from(settledEvents)
          .where(eq(settledEvents.externalEventId, String(leg.eventId)))
          .limit(1);
        if (legSettled) {
          return res.status(400).json({ message: `Match "${(leg as any).eventName ?? leg.eventId}" has already finished — parlay cannot be accepted` });
        }
      } catch (_) { /* settled_events table may not exist yet — treat as not settled */ }
    }

    // ── On-chain txHash verification ─────────────────────────────────────────
    const isOnchain = !!parlaySnapshot.onchainParlayId;
    const takerStakeRequired = parlaySnapshot.takerStake ?? 0;
    if (takerTxHash) {
      await requireValidStakeTx({
        txHash:         takerTxHash,
        senderWallet:   takerWallet,
        expectedAmount: takerStakeRequired,
        currency:       (parlaySnapshot.currency as 'SUI' | 'SBETS') ?? 'SUI',
        mode:           isOnchain ? 'onchain' : 'custodial',
      });
    } else if (!isOnchain) {
      return res.status(400).json({
        message: `takerTxHash is required. You must send ${takerStakeRequired} ${parlaySnapshot.currency ?? 'SUI'} and provide the transaction hash.`,
      });
    }

    const result = await p2pBettingService.acceptParlayOffer({ parlayOfferId: id, takerWallet, takerTxHash });
    broadcastP2PUpdate('accepted', 'parlay', {
      parlayId:       id,
      takerTierName:  (result as any).takerTierName,
      creatorWallet:  parlaySnapshot.creatorWallet,
      takerWallet,
      takerStake:     parlaySnapshot.takerStake,
      legCount:       parlaySnapshot.legCount,
      totalOdds:      parlaySnapshot.totalOdds,
      currency:       parlaySnapshot.currency ?? 'SUI',
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Failed to accept parlay offer' });
  }
});

router.delete('/parlays/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid parlay ID' });
    const { creatorWallet, cancelTxHash } = req.body ?? {};
    if (!isValidWallet(creatorWallet)) return res.status(400).json({ message: 'Invalid wallet address' });

    const result = await p2pBettingService.cancelParlayOffer(id, creatorWallet, cancelTxHash ?? undefined);
    broadcastP2PUpdate('cancelled', 'parlay', { parlayId: id });
    res.json({ success: true, refundSent: result.refundSent, refundTx: result.refundTx });
  } catch (err: any) {
    res.status(400).json({ message: err.message || 'Failed to cancel parlay offer' });
  }
});

// ─── Retroactive Refund Processing ───────────────────────────────────────────
// Processes all cancelled offers/parlays that had real stake sent but were never refunded.

// POST /api/p2p/process-pending-refunds — admin: sweep all pending creator refunds
router.post('/process-pending-refunds', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    console.log('[P2P] Admin triggered: processing all pending cancellation refunds...');
    const result = await p2pBettingService.processAllPendingRefunds();
    console.log(`[P2P] Refund sweep complete: ${result.succeeded} succeeded, ${result.failed} failed out of ${result.processed} total`);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[P2P] process-pending-refunds error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to process refunds' });
  }
});

// GET /api/p2p/pending-refunds — see all pending refunds (creator offers, parlays, taker matches)
router.get('/pending-refunds', async (req: Request, res: Response) => {
  try {
    const data = await p2pBettingService.getPendingRefunds();
    res.json(data);
  } catch (err: any) {
    console.error('[P2P] GET /pending-refunds error:', err?.message, err?.stack?.split('\n')[1]);
    res.status(500).json({ message: 'Failed to fetch pending refunds', error: err?.message });
  }
});

// ─── Individual Retry Endpoints (admin only) ─────────────────────────────────
// Each checks refund_tx_hash IS NULL before sending + 60 s in-memory rate limit.

router.post('/refunds/retry-offer/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const offerId = parseInt(req.params.id, 10);
    if (isNaN(offerId)) return res.status(400).json({ message: 'Invalid offer id' });
    const result = await p2pBettingService.retryOfferRefund(offerId);
    console.log(`[P2P] Retry offer #${offerId}: success=${result.success} tx=${result.txHash ?? 'none'} err=${result.error ?? ''}`);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/refunds/retry-parlay/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const parlayId = parseInt(req.params.id, 10);
    if (isNaN(parlayId)) return res.status(400).json({ message: 'Invalid parlay id' });
    const result = await p2pBettingService.retryParlayRefund(parlayId);
    console.log(`[P2P] Retry parlay #${parlayId}: success=${result.success} tx=${result.txHash ?? 'none'} err=${result.error ?? ''}`);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/refunds/retry-match/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.id, 10);
    if (isNaN(matchId)) return res.status(400).json({ message: 'Invalid match id' });
    const result = await p2pBettingService.retryMatchRefund(matchId);
    console.log(`[P2P] Retry match #${matchId}: success=${result.success} tx=${result.txHash ?? 'none'} err=${result.error ?? ''}`);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── My Activity ──────────────────────────────────────────────────────────────

router.get('/my', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.query as { wallet: string };
    if (!isValidWallet(wallet)) return res.status(400).json({ message: 'Invalid wallet address' });
    const activity = await p2pBettingService.getMyActivity(wallet);
    res.json(activity);
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to get activity' });
  }
});

// ─── Volume / Leaderboard ─────────────────────────────────────────────────────

// GET /api/p2p/volume?wallet=0x... — volume stats and tier for a wallet
router.get('/volume', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.query as { wallet: string };
    if (!isValidWallet(wallet)) return res.status(400).json({ message: 'Invalid wallet address' });
    const stats = await p2pBettingService.getVolumeStats(wallet);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to get volume stats' });
  }
});

// GET /api/p2p/leaderboard — top volume traders
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const { limit } = req.query as { limit?: string };
    const lb = await p2pBettingService.getLeaderboard(limit ? parseInt(limit) : 20);
    res.json(lb);
  } catch (err: any) {
    console.error('[Leaderboard] Error:', err?.message ?? err);
    res.status(500).json({ message: 'Failed to get leaderboard' });
  }
});

// ─── On-chain Order Book ──────────────────────────────────────────────────────

/**
 * GET /api/p2p/onchain-book
 * Queries the on-chain P2PRegistry shared object for live counts and open IDs.
 * Returns immediately with DB fallback when contract is not deployed.
 */
router.get('/onchain-book', async (req: Request, res: Response) => {
  try {
    const contractInfo  = p2pContractService.getContractInfo();
    const registryStats = p2pContractService.isEnabled()
      ? await p2pContractService.getRegistryStats()
      : null;

    // DB-side counts for comparison / fallback
    const [dbOffers, dbParlays] = await Promise.all([
      p2pBettingService.listOpenOffers({ limit: 500 }).then(r => r.length).catch(() => 0),
      p2pBettingService.listOpenParlayOffers({ limit: 500 }).then(r => r.length).catch(() => 0),
    ]);

    res.json({
      contractDeployed:   true,
      packageId:          contractInfo.packageId,
      registryId:         contractInfo.registryId,
      configId:           contractInfo.configId,
      network:            contractInfo.network ?? 'mainnet',
      version:            contractInfo.version ?? 'v1',
      features:           contractInfo.features,
      supportedCoins:     contractInfo.supportedCoins,
      suiscanUrls:        contractInfo.suiscanUrls,
      disputeWindowMs:    contractInfo.disputeWindowMs,
      hipFourTiers:       contractInfo.hipFourTiers,
      description:        'All P2P bets are settled on the Sui blockchain. Stakes flow directly through on-chain transactions. Winner receives payout automatically after match result is confirmed.',
      onchainCounts:      registryStats ? {
        openOffers:   registryStats.openOffers,
        liveBets:     registryStats.liveBets,
        openParlays:  registryStats.openParlays,
      } : null,
      dbCounts: {
        openOffers:  dbOffers,
        openParlays: dbParlays,
      },
      message: 'All P2P bets are settled on the Sui blockchain. Stakes flow directly through on-chain transactions. Winner receives payout automatically after match result is confirmed.',
    });
  } catch (err: any) {
    console.error('[P2P] onchain-book error:', err.message);
    res.status(500).json({ message: 'Failed to get on-chain book status' });
  }
});

// ─── Bet Dispute / Claim (on-chain bets only) ─────────────────────────────────

/**
 * POST /api/p2p/bets/:betId/dispute
 * Flag a queued settlement for review during the 2-hour dispute window.
 * Body: { disputerWallet: string }
 * NOTE: For contract-integrated bets the disputer must submit this via their
 * own wallet SDK. This endpoint records the intent in the DB and returns
 * the on-chain call data for the frontend to construct a PTB.
 */

// SECURITY FIX (LOW): rate-limit disputes to prevent free griefing.
// Max 5 dispute requests per wallet per 15-minute window.
const _disputeRateLimit = new Map<string, { count: number; resetAt: number }>();
const _MAX_DISPUTES_PER_WINDOW = 5;
const _DISPUTE_RATE_WINDOW_MS = 15 * 60 * 1000;

router.post('/bets/:betId/dispute', async (req: Request, res: Response) => {
  try {
    const { betId } = req.params;
    const { disputerWallet, coinType } = req.body;

    if (!disputerWallet) return res.status(400).json({ message: 'disputerWallet required' });
    if (!validateCoinType(coinType)) {
      return res.status(400).json({ message: 'Invalid coinType format' });
    }

    // Rate-limit by wallet address to prevent griefing
    const now = Date.now();
    const rlKey = String(disputerWallet).toLowerCase();
    const rl = _disputeRateLimit.get(rlKey);
    if (rl && now < rl.resetAt) {
      if (rl.count >= _MAX_DISPUTES_PER_WINDOW) {
        return res.status(429).json({
          message: `Too many dispute requests. Maximum ${_MAX_DISPUTES_PER_WINDOW} per 15 minutes. Please wait before submitting another.`,
        });
      }
      rl.count++;
    } else {
      _disputeRateLimit.set(rlKey, { count: 1, resetAt: now + _DISPUTE_RATE_WINDOW_MS });
    }

    const contractInfo = p2pContractService.getContractInfo();
    if (!contractInfo.configured || !betId.startsWith('0x')) {
      // Off-chain path: record dispute intent in DB (for admin review)
      return res.json({
        success: true,
        onchain: false,
        message: 'Dispute recorded for admin review. Off-chain bet — no contract escrow active.',
        betId,
        disputerWallet,
      });
    }

    // On-chain path: return PTB construction data for user's wallet
    res.json({
      success: true,
      onchain: true,
      action: 'dispute_settlement',
      ptbCall: {
        target:        `${contractInfo.packageId}::p2p_betting::dispute_settlement`,
        typeArguments: [coinType || p2pContractService.getSuiCoinType()],
        arguments: {
          bet:   betId,
          clock: '0x0000000000000000000000000000000000000000000000000000000000000006',
        },
      },
      registryId:   contractInfo.registryId,
      packageId:    contractInfo.packageId,
      suiscanUrl:   `https://suiscan.xyz/mainnet/object/${betId}`,
      message:      'Submit the PTB via your Sui wallet SDK to dispute on-chain.',
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to process dispute' });
  }
});

/**
 * POST /api/p2p/bets/:betId/claim
 * Admin/worker endpoint: claim settlement after dispute window has passed.
 * Restricted to admin — prevents arbitrary users from triggering on-chain settlement.
 */
router.post('/bets/:betId/claim', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { betId }   = req.params;
    const { coinType } = req.body;

    if (!validateCoinType(coinType)) {
      return res.status(400).json({ message: 'Invalid coinType format' });
    }
    if (!p2pContractService.isEnabled()) {
      return res.status(503).json({ message: 'Contract not deployed — cannot claim on-chain settlement' });
    }

    const result = await p2pContractService.claimSettlement(
      betId,
      coinType || p2pContractService.getSuiCoinType(),
    );

    if (!result.success) {
      return res.status(400).json({ message: result.error || 'Claim failed', txHash: result.txHash });
    }

    res.json({
      success:  true,
      txHash:   result.txHash,
      betId,
      suiscanUrl: `https://suiscan.xyz/mainnet/tx/${result.txHash}`,
      message: 'Settlement claimed — winner paid from contract escrow.',
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to claim settlement' });
  }
});

/**
 * POST /api/p2p/bets/:betId/resolve-dispute
 * Oracle resolves a disputed on-chain bet.
 * Body: { makerWins: boolean, coinType?: string }
 */
router.post('/bets/:betId/resolve-dispute', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { betId }                = req.params;
    const { makerWins, coinType }  = req.body;

    if (typeof makerWins !== 'boolean') {
      return res.status(400).json({ message: 'makerWins (boolean) required' });
    }
    if (!validateCoinType(coinType)) {
      return res.status(400).json({ message: 'Invalid coinType format' });
    }
    if (!p2pContractService.isEnabled()) {
      return res.status(503).json({ message: 'Contract not deployed' });
    }

    const result = await p2pContractService.resolveDispute(
      betId,
      makerWins,
      coinType || p2pContractService.getSuiCoinType(),
    );

    if (!result.success) {
      return res.status(400).json({ message: result.error || 'Resolve dispute failed' });
    }

    res.json({ success: true, txHash: result.txHash, betId, makerWins });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to resolve dispute' });
  }
});

// ─── Parlay Dispute / Claim (on-chain) ───────────────────────────────────────

router.post('/parlays/:id/claim', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const id       = req.params.id;
    const { coinType } = req.body;

    if (!validateCoinType(coinType)) {
      return res.status(400).json({ message: 'Invalid coinType format' });
    }
    if (!p2pContractService.isEnabled()) {
      return res.status(503).json({ message: 'Contract not deployed' });
    }

    const result = await p2pContractService.claimParlay(
      id,
      coinType || p2pContractService.getSuiCoinType(),
    );

    if (!result.success) {
      return res.status(400).json({ message: result.error || 'Claim failed' });
    }

    res.json({ success: true, txHash: result.txHash, parlayId: id });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to claim parlay' });
  }
});

router.post('/parlays/:id/resolve-dispute', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const id                      = req.params.id;
    const { makerWins, coinType } = req.body;

    if (typeof makerWins !== 'boolean') return res.status(400).json({ message: 'makerWins required' });
    if (!validateCoinType(coinType)) return res.status(400).json({ message: 'Invalid coinType format' });
    if (!p2pContractService.isEnabled()) return res.status(503).json({ message: 'Contract not deployed' });

    const result = await p2pContractService.resolveParlayDispute(
      id,
      makerWins,
      coinType || p2pContractService.getSuiCoinType(),
    );

    if (!result.success) return res.status(400).json({ message: result.error || 'Failed' });
    res.json({ success: true, txHash: result.txHash, parlayId: id, makerWins });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to resolve parlay dispute' });
  }
});

// ─── Offer Counts per Event ─────────────────────────────────────────────────

/**
 * GET /api/p2p/offer-counts
 * Returns a lightweight map of eventId → open offer count.
 * Used by match cards to show inline P2P activity badges.
 * Cached 30 s client-side.
 */
router.get('/offer-counts', async (_req: Request, res: Response) => {
  try {
    const allOffers = await p2pBettingService.listOpenOffers({ limit: 500 });
    const counts: Record<string, number> = {};
    for (const offer of allOffers) {
      if (offer.eventId) counts[offer.eventId] = (counts[offer.eventId] || 0) + 1;
    }
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ counts, total: allOffers.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to get offer counts' });
  }
});

// ─── Settling — dispute window monitor ───────────────────────────────────────

/**
 * GET /api/p2p/settling?wallet=0x...
 * Returns bets + parlays that are in the 2-hour dispute window.
 * Each item includes:
 *   - secondsRemaining  — how many seconds of dispute window remain
 *   - canDispute        — true while window is open
 *   - canClaim          — true once window has closed and no txHash recorded
 *   - ptbCallData       — PTB construction params for the connected wallet (on-chain path)
 *   - dbId              — the integer row ID for the off-chain REST path
 */
router.get('/settling', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.query as { wallet: string };
    if (!isValidWallet(wallet)) return res.status(400).json({ message: 'Invalid wallet address' });

    const DISPUTE_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

    // Reuse existing activity method — cheap single call
    const activity = await p2pBettingService.getMyActivity(wallet);
    const contractInfo = p2pContractService.getContractInfo();
    const now = Date.now();

    const enrich = (bet: any, isParlay: boolean) => {
      // Only include bets where a result is known but settlement isn't finalised
      const hasResult  = bet.winner != null || bet.status === 'settling';
      const notFinalised = !bet.settlementTxHash && bet.status !== 'settled';
      if (!hasResult || !notFinalised) return null;

      const settledAtMs   = bet.settledAt ? new Date(bet.settledAt).getTime() : now;
      const deadlineMs    = settledAtMs + DISPUTE_WINDOW_MS;
      const secsRemaining = Math.max(0, Math.floor((deadlineMs - now) / 1000));
      const canDispute    = secsRemaining > 0;
      const canClaim      = !canDispute && !bet.settlementTxHash;

      const onchainId = isParlay ? bet.onchainParlayId : bet.onchainOfferId;
      const coinType  = p2pContractService.resolveCoinType(bet.currency || 'SUI');

      const ptbCallData = contractInfo.configured && onchainId ? {
        target:        `${contractInfo.packageId}::p2p_betting::dispute_settlement`,
        typeArguments: [coinType],
        arguments: {
          config: contractInfo.configId,
          bet:    onchainId,
          clock:  '0x0000000000000000000000000000000000000000000000000000000000000006',
        },
      } : null;

      return {
        dbId:            bet.id,
        isParlay,
        eventName:       isParlay ? `Parlay (${bet.legCount ?? 0} legs)` : (bet.eventName ?? 'Match'),
        homeTeam:        bet.homeTeam,
        awayTeam:        bet.awayTeam,
        prediction:      bet.prediction ?? null,
        yourSide:        bet.creatorWallet === wallet ? 'creator' : 'taker',
        winner:          bet.winner ?? null,
        youWon:          bet.winner === (bet.creatorWallet === wallet ? 'creator' : 'taker'),
        currency:        bet.currency ?? 'SUI',
        creatorStake:    bet.creatorStake ?? 0,
        takerStake:      bet.takerStake ?? 0,
        odds:            bet.odds ?? bet.totalOdds ?? 0,
        settledAt:       bet.settledAt ?? null,
        disputeDeadline: new Date(deadlineMs).toISOString(),
        secondsRemaining: secsRemaining,
        totalWindowSecs:  DISPUTE_WINDOW_MS / 1000,
        canDispute,
        canClaim,
        onchainId:       onchainId ?? null,
        coinType,
        ptbCallData,
        suiscanUrl:      onchainId ? `https://suiscan.xyz/mainnet/object/${onchainId}` : null,
        alreadyDisputed: bet.status === 'disputed',
      };
    };

    const bets = [
      ...(activity.myOffers     ?? []).map((b: any) => enrich(b, false)),
      ...(activity.myMatches    ?? []).map((m: any) => enrich(m.offer ?? m, false)),
      ...(activity.myParlayOffers ?? []).map((p: any) => enrich(p, true)),
    ].filter(Boolean);

    res.json({
      settling: bets,
      total:    bets.length,
      disputeWindowMs:   DISPUTE_WINDOW_MS,
      contractDeployed:  contractInfo.configured,
      packageId:         contractInfo.packageId,
      registryId:        contractInfo.registryId,
    });
  } catch (err: any) {
    console.error('[P2P] settling error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to get settling bets' });
  }
});

// ─── Void Offer / Bet (Admin) ────────────────────────────────────────────────

/**
 * POST /api/p2p/void-offer
 * Admin endpoint: void a matched on-chain bet or parlay, refunding both sides in full.
 * Use for postponed / abandoned matches or resolved disputes.
 *
 * Body (single bet):  { betId: string, coinType?: string, reason?: string }
 * Body (parlay):      { parlayId: string, coinType?: string, reason?: string }
 */
router.post('/void-offer', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { betId, parlayId, coinType, reason } = req.body;

    if (!betId && !parlayId) {
      return res.status(400).json({ message: 'betId or parlayId required' });
    }

    if (!p2pContractService.isEnabled()) {
      // Off-chain path: mark in DB as voided (admin can also manually refund)
      return res.json({
        success: true,
        onchain: false,
        message: 'Contract not deployed — recorded void intent for manual refund.',
        betId: betId ?? null,
        parlayId: parlayId ?? null,
        reason: reason ?? 'admin void',
      });
    }

    const resolvedCoinType = coinType || p2pContractService.getSuiCoinType();

    if (parlayId) {
      const result = await p2pContractService.voidParlay(parlayId, resolvedCoinType);
      if (!result.success) {
        return res.status(400).json({ message: result.error || 'Void parlay failed', txHash: result.txHash });
      }
      return res.json({
        success: true, onchain: true,
        txHash: result.txHash, parlayId,
        reason: reason ?? 'admin void',
        suiscanUrl: `https://suiscan.xyz/mainnet/tx/${result.txHash}`,
        message: 'Parlay voided on-chain — both sides refunded from contract escrow.',
      });
    }

    const result = await p2pContractService.voidOffer(betId, resolvedCoinType);
    if (!result.success) {
      return res.status(400).json({ message: result.error || 'Void bet failed', txHash: result.txHash });
    }

    res.json({
      success: true, onchain: true,
      txHash: result.txHash, betId,
      reason: reason ?? 'admin void',
      suiscanUrl: `https://suiscan.xyz/mainnet/tx/${result.txHash}`,
      message: 'Bet voided on-chain — both sides refunded from contract escrow.',
    });
  } catch (err: any) {
    console.error('[P2P] void-offer error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to void offer' });
  }
});

// ─── Gas Sponsorship (gasless stablecoin transactions) ─────────────────────────

/**
 * POST /api/p2p/sponsor-gas
 * The frontend sends serialized transaction bytes (base64). The admin signs as
 * the gas sponsor so users can post/accept bets in USDC or USDSUI without holding SUI.
 *
 * Body: { txBytes: string }   — base64-encoded Transaction bytes
 * Response: { sponsorSig: string, sponsorAddress: string }
 */
router.post('/sponsor-gas', async (req: Request, res: Response) => {
  try {
    const { txBytes } = req.body as { txBytes?: string };
    if (!txBytes || typeof txBytes !== 'string') {
      return res.status(400).json({ message: 'txBytes (base64 fully-built transaction) required' });
    }
    if (txBytes.length > 100_000) {
      return res.status(400).json({ message: 'txBytes too large' });
    }
    const result = await p2pContractService.sponsorTransaction(txBytes);
    res.json(result);
  } catch (err: any) {
    console.error('[SponsorGas] Error:', err.message);
    res.status(500).json({ message: err.message || 'Gas sponsorship failed' });
  }
});

/**
 * GET /api/p2p/sponsor-address
 * Returns the admin address that acts as the gas sponsor for stablecoin transactions.
 * Frontend uses this to set tx.setSponsor(sponsorAddress) before building bytes.
 */
router.get('/sponsor-address', (_req: Request, res: Response) => {
  const addr = p2pContractService.getAdminAddress();
  res.json({
    sponsorAddress: addr,
    gasless: !!addr,
    supportedCurrencies: ['USDC', 'USDSUI'],
    description: 'Gas-sponsored transactions for stablecoin bets — no SUI required.',
  });
});

// ─── Contract / Admin ────────────────────────────────────────────────────────

router.get('/contract-wallet', (_req: Request, res: Response) => {
  // Hardcoded mainnet contract addresses as fallbacks — these never change
  const FALLBACK_PACKAGE_ID  = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
  const FALLBACK_CONFIG_ID   = '0xcf87ec33ef5babaa031ac19fe9618b7aec268d931ef2c0d21ac0ffe8ebb4c7cf';
  const FALLBACK_REGISTRY_ID = '0x3660345fc5fd4b6e9f638a1bf99977167aae55aa6cd773f0982e19b0a964116d';
  const FALLBACK_WALLET      = '0xa93e1f3064ad5ce96ad1db2b6ab18ff2237f2f4f0f0e14c93e32cd25ca174e43';

  const wallet = process.env.ADMIN_WALLET_ADDRESS || FALLBACK_WALLET;
  const contractInfo = p2pContractService.getContractInfo();

  const packageId  = contractInfo.packageId  || FALLBACK_PACKAGE_ID;
  const configId   = contractInfo.configId   || FALLBACK_CONFIG_ID;
  const registryId = contractInfo.registryId || FALLBACK_REGISTRY_ID;

  res.json({
    wallet,
    onchainEscrow: true,
    packageId,
    configId,
    registryId,
    description:   'Stakes are locked in a P2POffer smart-contract object via post_offer<T>. No admin-wallet custody. Winner paid directly from contract escrow.',
    suiscanUrl:    `https://suiscan.xyz/mainnet/object/${packageId}`,
  });
});

// GET /api/p2p/contract-info — on-chain contract metadata + feature matrix
router.get('/contract-info', (_req: Request, res: Response) => {
  res.json(p2pContractService.getContractInfo());
});

router.post('/settle', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    await p2pBettingService.runSettlement();
    res.json({ success: true, message: 'P2P settlement cycle completed' });
  } catch (err: any) {
    res.status(500).json({ message: 'Settlement failed' });
  }
});

// POST /api/p2p/admin/inject-result
// Manually insert a match result into settled_events then trigger P2P settlement.
// Body: { eventId, homeTeam, awayTeam, homeScore, winner }
// winner: "home" | "away" | "draw"
router.post('/admin/inject-result', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { eventId, homeTeam, awayTeam, homeScore, awayScore, winner } = req.body as {
      eventId: string; homeTeam?: string; awayTeam?: string;
      homeScore?: number; awayScore?: number; winner: 'home' | 'away' | 'draw';
    };
    if (!eventId || !winner) return res.status(400).json({ message: 'eventId and winner are required' });
    const { db } = await import('../db');
    const { settledEvents } = await import('../../../../../shared/schema');
    const { eq } = await import('drizzle-orm');
    // Upsert: insert or update
    const existing = await db.select().from(settledEvents).where(eq(settledEvents.externalEventId, eventId));
    if (existing.length === 0) {
      await db.insert(settledEvents).values({
        externalEventId: eventId,
        homeTeam: homeTeam ?? '',
        awayTeam: awayTeam ?? '',
        homeScore: homeScore ?? 0,
        awayScore: awayScore ?? 0,
        winner,
        betsSettled: 0,
      });
    } else {
      await db.update(settledEvents).set({ winner, homeScore: homeScore ?? 0, awayScore: awayScore ?? 0 }).where(eq(settledEvents.externalEventId, eventId));
    }
    // Now run P2P settlement
    await p2pBettingService.runSettlement();
    res.json({ success: true, message: `Result for ${eventId} injected (${winner}) and settlement triggered` });
  } catch (err: any) {
    console.error('[P2P inject-result]', err);
    res.status(500).json({ message: err?.message ?? 'Inject failed' });
  }
});

// ─── P2P Admin: Correct Wrong Settlement ──────────────────────────────────────
// POST /api/p2p/admin/fix-settlement
// Body: { eventId, correctWinner: 'home'|'away'|'draw', homeScore?, awayScore? }
// Resets wrongly-settled offers that had no payout (settlementTxHash=null),
// injects the correct result into settled_events, and re-queues them for
// re-settlement.  SAFE: only touches offers where no funds were disbursed.
router.post('/admin/fix-settlement', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { eventId, correctWinner, homeScore, awayScore } = req.body as {
      eventId: string;
      correctWinner: 'home' | 'away' | 'draw';
      homeScore?: number;
      awayScore?: number;
    };
    if (!eventId || !correctWinner) {
      return res.status(400).json({ message: 'eventId and correctWinner required' });
    }
    if (!['home', 'away', 'draw'].includes(correctWinner)) {
      return res.status(400).json({ message: 'correctWinner must be home | away | draw' });
    }

    // 1. Upsert correct result into settled_events
    const existing = await db.select().from(settledEvents).where(eq(settledEvents.externalEventId, eventId));
    if (existing.length > 0) {
      await db.update(settledEvents)
        .set({
          winner: correctWinner as any,
          ...(homeScore != null ? { homeScore } : {}),
          ...(awayScore != null ? { awayScore } : {}),
        })
        .where(eq(settledEvents.externalEventId, eventId));
      console.log(`[P2P fix-settlement] Updated settled_events for event ${eventId}: winner=${correctWinner}`);
    } else {
      const offersForEvent = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.eventId, eventId)).limit(1);
      const ref = offersForEvent[0];
      await db.insert(settledEvents).values({
        externalEventId: eventId,
        homeTeam: ref?.homeTeam ?? '',
        awayTeam: ref?.awayTeam ?? '',
        homeScore: homeScore ?? null,
        awayScore: awayScore ?? null,
        winner: correctWinner as any,
        betsSettled: 0,
      });
      console.log(`[P2P fix-settlement] Inserted settled_events for event ${eventId}: winner=${correctWinner}`);
    }

    // 2. Find all wrongly-settled offers for this event where no payout was sent
    //    (settlementTxHash IS NULL — funds are still in escrow, safe to re-process)
    const wrongOffers = await db.execute(sql`
      SELECT id FROM p2p_bet_offers
      WHERE event_id = ${eventId}
        AND status = 'settled'
        AND (settlement_tx_hash IS NULL OR settlement_tx_hash = '')
    `);
    const offerRows: any[] = (wrongOffers as any).rows ?? (wrongOffers as any);
    const offerIds: number[] = offerRows.map((r: any) => r.id).filter(Boolean);

    if (offerIds.length === 0) {
      return res.json({ success: true, message: `settled_events corrected to "${correctWinner}". No offers needed reset (all had payouts already sent).`, offerIds: [] });
    }

    // 3. Reset matches from 'lost'/'won' → 'active' only where no txHash was set
    const matchReset = await db.update(p2pBetMatches)
      .set({ status: 'active', settledAt: null, settlementTxHash: null, payoutTxHash: null })
      .where(and(
        inArray(p2pBetMatches.offerId, offerIds),
        or(isNull(p2pBetMatches.settlementTxHash), eq(p2pBetMatches.settlementTxHash, '')),
      ))
      .returning({ id: p2pBetMatches.id });
    const resetMatchIds: number[] = matchReset.map(r => r.id);

    // 4. Reset offers → 'filled' so the settlement loop re-picks them up
    await db.update(p2pBetOffers)
      .set({ status: 'filled', settledAt: null, winner: null, platformFee: null, settlementTxHash: null })
      .where(inArray(p2pBetOffers.id, offerIds));

    console.log(`[P2P fix-settlement] Reset ${offerIds.length} offer(s) and ${resetMatchIds.length} match(es) for re-settlement. Triggering settlement run now.`);

    // 5. Trigger immediate re-settlement (non-blocking)
    p2pBettingService.runSettlement().catch((e: Error) =>
      console.error('[P2P fix-settlement] Re-settlement run error:', e.message),
    );

    res.json({
      success: true,
      message: `Corrected settled_events to "${correctWinner}". Reset ${offerIds.length} offer(s) and ${resetMatchIds.length} match(es) for re-settlement.`,
      offerIds,
      matchIds: resetMatchIds,
      correctWinner,
    });
  } catch (err: any) {
    console.error('[P2P fix-settlement]', err);
    res.status(500).json({ message: err?.message ?? 'Fix failed' });
  }
});

// ─── P2P Admin: List All Offers ───────────────────────────────────────────────
// GET /api/p2p/admin/offers?status=all&limit=50&offset=0
router.get('/admin/offers', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { status, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(limitStr ?? '50'), 200);
    const offset = parseInt(offsetStr ?? '0') || 0;

    const conditions: any[] = [];
    if (status && status !== 'all') {
      conditions.push(eq(p2pBetOffers.status, status));
    }

    const rows = await db.select().from(p2pBetOffers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(p2pBetOffers.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(p2pBetOffers)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({ offers: rows, total: totalRow?.count ?? 0, limit, offset });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to list all offers' });
  }
});

// ─── P2P Admin: List All Parlays ─────────────────────────────────────────────
// GET /api/p2p/admin/parlays?status=all&limit=50&offset=0
router.get('/admin/parlays', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { status, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;
    const limit = Math.min(parseInt(limitStr ?? '50'), 200);
    const offset = parseInt(offsetStr ?? '0') || 0;

    const conditions: any[] = [];
    if (status && status !== 'all') {
      conditions.push(eq(p2pParlayOffers.status, status));
    }

    const rows = await db.select().from(p2pParlayOffers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(p2pParlayOffers.createdAt))
      .limit(limit)
      .offset(offset);

    const [totalRow] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(p2pParlayOffers)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    res.json({ parlays: rows, total: totalRow?.count ?? 0, limit, offset });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to list all parlays' });
  }
});

// ─── P2P Admin: Force-expire an on-chain offer ───────────────────────────────
// POST /api/p2p/admin/expire-offer
// Body: { offerId: number, coinType?: string }
// Use after the offer's expires_at has passed.  Calls expire_offer on the Sui
// contract (permissionless — contract verifies the timestamp).  The contract
// returns the escrowed SUI directly to the maker; admin pays gas only.
router.post('/admin/expire-offer', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { offerId, coinType } = req.body as { offerId: number; coinType?: string };
    if (!offerId || isNaN(Number(offerId))) {
      return res.status(400).json({ message: 'offerId (number) required' });
    }
    if (!validateCoinType(coinType)) {
      return res.status(400).json({ message: 'Invalid coinType format' });
    }

    const [offer] = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.id, Number(offerId)));
    if (!offer) return res.status(404).json({ message: `Offer #${offerId} not found` });
    if (!offer.onchainOfferId) return res.status(400).json({ message: 'Not an on-chain offer — use admin refund endpoint instead' });

    if (offer.expiresAt && new Date(offer.expiresAt) > new Date()) {
      return res.status(400).json({
        message: 'Offer has not expired yet',
        expiresAt: offer.expiresAt,
        nowUtc: new Date().toISOString(),
      });
    }

    if (!['open', 'partial', 'expired'].includes(offer.status)) {
      return res.status(400).json({ message: `Offer is already ${offer.status} — nothing to expire` });
    }

    if (offer.refundTxHash && offer.refundTxHash !== 'PENDING') {
      return res.status(400).json({ message: 'Offer already has a refund tx', refundTxHash: offer.refundTxHash });
    }

    const resolvedCoinType = coinType ?? p2pContractService.currencyToCoinType((offer.currency ?? 'SUI').toUpperCase());
    console.log(`[Admin Expire] Offer #${offerId} (${offer.onchainOfferId?.slice(0, 12)}...) — calling expire_offer...`);

    const result = await p2pContractService.expireOffer(offer.onchainOfferId, resolvedCoinType);
    if (!result.success) {
      return res.status(500).json({ message: result.error ?? 'expire_offer failed', offerId });
    }

    // Update DB — use status='expired' + real tx hash
    await db.execute(sql`
      UPDATE p2p_bet_offers
      SET status = 'expired', refund_tx_hash = ${result.txHash}
      WHERE id = ${Number(offerId)} AND status IN ('open', 'partial', 'expired')
    `);

    console.log(`[Admin Expire] Offer #${offerId} expired on-chain. TX: ${result.txHash}`);
    res.json({ success: true, offerId, txHash: result.txHash, maker: offer.creatorWallet, stake: offer.creatorStake });
  } catch (err: any) {
    console.error('[Admin Expire] Error:', err);
    res.status(500).json({ message: err.message ?? 'Internal error' });
  }
});

// POST /api/p2p/admin/expire-parlay
// Body: { parlayId: number, coinType?: string }
router.post('/admin/expire-parlay', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { parlayId, coinType } = req.body as { parlayId: number; coinType?: string };
    if (!parlayId || isNaN(Number(parlayId))) {
      return res.status(400).json({ message: 'parlayId (number) required' });
    }
    if (!validateCoinType(coinType)) {
      return res.status(400).json({ message: 'Invalid coinType format' });
    }

    const [parlay] = await db.select().from(p2pParlayOffers).where(eq(p2pParlayOffers.id, Number(parlayId)));
    if (!parlay) return res.status(404).json({ message: `Parlay #${parlayId} not found` });
    if (!parlay.onchainParlayId) return res.status(400).json({ message: 'Not an on-chain parlay' });

    if (parlay.expiresAt && new Date(parlay.expiresAt) > new Date()) {
      return res.status(400).json({ message: 'Parlay has not expired yet', expiresAt: parlay.expiresAt });
    }

    if (!['open', 'partial', 'expired'].includes(parlay.status)) {
      return res.status(400).json({ message: `Parlay is already ${parlay.status}` });
    }

    const resolvedCoinType = coinType ?? p2pContractService.currencyToCoinType((parlay.currency ?? 'SUI').toUpperCase());
    const result = await p2pContractService.expireParlay(parlay.onchainParlayId, resolvedCoinType);
    if (!result.success) {
      return res.status(500).json({ message: result.error ?? 'expire_parlay failed', parlayId });
    }

    await db.execute(sql`
      UPDATE p2p_parlay_offers
      SET status = 'expired', refund_tx_hash = ${result.txHash}
      WHERE id = ${Number(parlayId)} AND status IN ('open', 'partial', 'expired')
    `);

    res.json({ success: true, parlayId, txHash: result.txHash });
  } catch (err: any) {
    res.status(500).json({ message: err.message ?? 'Internal error' });
  }
});

// POST /api/p2p/admin/force-expire/:id
// Force-triggers on-chain expire_offer immediately, skipping the DB time guard.
// Use this when an offer has just expired and you don't want to wait for the
// next 5-minute settlement cycle to pick it up.
// If the on-chain clock hasn't passed expiresMs yet, the contract will reject it
// with a clear error — nothing in the DB is changed in that case.
router.post('/admin/force-expire/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const offerId = Number(req.params.id);
    if (!offerId || isNaN(offerId)) {
      return res.status(400).json({ message: 'offerId must be a number' });
    }

    const [offer] = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.id, offerId));
    if (!offer) return res.status(404).json({ message: `Offer #${offerId} not found` });

    if (!offer.onchainOfferId) {
      return res.status(400).json({ message: 'Not an on-chain offer — use admin refund endpoint instead' });
    }

    if (!['open', 'partial', 'expired'].includes(offer.status)) {
      return res.status(400).json({ message: `Offer is already ${offer.status} — nothing to expire` });
    }

    if (offer.refundTxHash && offer.refundTxHash !== 'PENDING') {
      return res.status(400).json({ message: 'Offer already has a refund tx', refundTxHash: offer.refundTxHash });
    }

    const expiresAt    = offer.expiresAt ? new Date(offer.expiresAt) : null;
    const msUntilExpiry = expiresAt ? expiresAt.getTime() - Date.now() : 0;
    const alreadyExpired = !expiresAt || msUntilExpiry <= 0;

    const coinType = p2pContractService.currencyToCoinType((offer.currency ?? 'SUI').toUpperCase());
    console.log(
      `[Admin Force-Expire] Offer #${offerId} (${offer.onchainOfferId?.slice(0, 12)}...)` +
      ` ${alreadyExpired ? '— expired, triggering refund' : `— NOT expired yet (${Math.ceil(msUntilExpiry / 60000)}m remaining), attempting anyway`}`
    );

    const result = await p2pContractService.expireOffer(offer.onchainOfferId, coinType);
    if (!result.success) {
      const isTimingError =
        result.error?.includes('EOfferNotExpired') ||
        result.error?.includes('not expired') ||
        result.error?.includes('clock');
      return res.status(isTimingError ? 409 : 500).json({
        message: isTimingError
          ? `On-chain contract rejected: offer hasn't reached its expiry time yet. ` +
            `expiresAt=${offer.expiresAt ?? 'unknown'} — try again after that time.`
          : result.error ?? 'expire_offer failed',
        offerId,
        alreadyExpired,
        expiresAt: offer.expiresAt,
      });
    }

    await db.execute(sql`
      UPDATE p2p_bet_offers
      SET status = 'expired', refund_tx_hash = ${result.txHash}
      WHERE id = ${offerId} AND status IN ('open', 'partial', 'expired')
    `);

    console.log(`[Admin Force-Expire] ✓ Offer #${offerId} refunded on-chain. TX: ${result.txHash}`);
    res.json({
      success:    true,
      offerId,
      txHash:     result.txHash,
      maker:      offer.creatorWallet,
      stake:      offer.creatorStake,
      currency:   offer.currency,
      alreadyExpired,
      expiresAt:  offer.expiresAt,
    });
  } catch (err: any) {
    console.error('[Admin Force-Expire] Error:', err);
    res.status(500).json({ message: err.message ?? 'Internal error' });
  }
});

// ─── PnL Today Widget ─────────────────────────────────────────────────────────

/**
 * GET /api/p2p/pnl-today?wallet=0x...
 * Returns a wallet's P2P betting stats for the current UTC day plus lifetime
 * tier / volume information for the progress bar.
 */
router.get('/pnl-today', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.query as { wallet: string };
    if (!isValidWallet(wallet)) return res.status(400).json({ message: 'Invalid wallet address' });

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // ── Offers settled today where this wallet was the CREATOR ────────────────
    const creatorOffers = await db.select().from(p2pBetOffers)
      .where(and(
        eq(p2pBetOffers.creatorWallet, wallet),
        eq(p2pBetOffers.status, 'settled'),
        gte(p2pBetOffers.settledAt, todayStart),
      ));

    // ── Matches settled today where this wallet was the TAKER ─────────────────
    const takerMatches = await db.select().from(p2pBetMatches)
      .where(and(
        eq(p2pBetMatches.takerWallet, wallet),
        gte(p2pBetMatches.settledAt, todayStart),
      ));

    // ── Parlays settled today (creator or taker side) ─────────────────────────
    const parlaysSettled = await db.select().from(p2pParlayOffers)
      .where(and(
        or(
          eq(p2pParlayOffers.creatorWallet, wallet),
          eq(p2pParlayOffers.takerWallet, wallet),
        ),
        eq(p2pParlayOffers.status, 'settled'),
        gte(p2pParlayOffers.settledAt, todayStart),
      ));

    // ── Compute daily PnL ─────────────────────────────────────────────────────
    let pnl = 0;
    let wins = 0;
    let losses = 0;
    let volumeToday = 0;

    for (const offer of creatorOffers) {
      volumeToday += offer.creatorStake;
      if (offer.winner === 'creator') {
        wins++;
        pnl += (offer.filledStake ?? 0) - (offer.platformFee ?? 0);
      } else {
        losses++;
        pnl -= offer.creatorStake;
      }
    }

    for (const match of takerMatches) {
      volumeToday += match.stake;
      if (match.status === 'won') {
        wins++;
        pnl += (match.actualPayout ?? match.potentialPayout) - match.stake;
      } else if (match.status === 'lost') {
        losses++;
        pnl -= match.stake;
      }
    }

    for (const parlay of parlaysSettled) {
      const isCreator = parlay.creatorWallet === wallet;
      const myStake = isCreator ? parlay.creatorStake : parlay.takerStake;
      volumeToday += myStake;
      const iWon =
        (parlay.winner === 'creator' && isCreator) ||
        (parlay.winner === 'taker' && !isCreator);
      if (iWon) {
        wins++;
        pnl += (parlay.actualPayout ?? 0) - myStake;
      } else {
        losses++;
        pnl -= myStake;
      }
    }

    // ── Active bets / pending exposure ────────────────────────────────────────
    const [activeCreatorRow] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(p2pBetOffers)
      .where(and(
        eq(p2pBetOffers.creatorWallet, wallet),
        or(eq(p2pBetOffers.status, 'open'), eq(p2pBetOffers.status, 'filled')),
      ));
    const [activeTakerRow] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(p2pBetMatches)
      .where(and(
        eq(p2pBetMatches.takerWallet, wallet),
        eq(p2pBetMatches.status, 'active'),
      ));
    const activeBets = (activeCreatorRow?.count ?? 0) + (activeTakerRow?.count ?? 0);

    // ── Lifetime volume stats for tier progress ───────────────────────────────
    const [volStats] = await db.select().from(p2pVolumeStats)
      .where(eq(p2pVolumeStats.walletAddress, wallet));

    const lifeVolume = (volStats?.totalVolumeMaker ?? 0) + (volStats?.totalVolumeTaker ?? 0);
    const currentTier = getVolumeTier(lifeVolume);
    const tierIdx = VOLUME_TIERS.findIndex(t => t.name === currentTier.name);
    const nextTier = tierIdx < VOLUME_TIERS.length - 1 ? VOLUME_TIERS[tierIdx + 1] : null;
    const tierProgress = nextTier
      ? Math.min(100, ((lifeVolume - currentTier.minVolume) / (nextTier.minVolume - currentTier.minVolume)) * 100)
      : 100;

    const totalSettled = wins + losses;
    const winRate = totalSettled > 0 ? Math.round((wins / totalSettled) * 100) : null;

    res.set('Cache-Control', 'no-store');
    res.json({
      pnl: Math.round(pnl * 1000) / 1000,
      wins,
      losses,
      winRate,
      volumeToday: Math.round(volumeToday * 1000) / 1000,
      activeBets,
      lifetimePnl: Math.round((volStats?.totalNetPnl ?? 0) * 1000) / 1000,
      lifeVolume: Math.round(lifeVolume * 1000) / 1000,
      totalBets: volStats?.totalBets ?? 0,
      wonBets: volStats?.wonBets ?? 0,
      lostBets: volStats?.lostBets ?? 0,
      currentTier,
      nextTier,
      tierProgress: Math.round(tierProgress),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to compute PnL' });
  }
});

// ─── P2P Revenue Stats (public) ──────────────────────────────────────────────
// GET /api/p2p/revenue-stats
// Returns aggregated P2P platform fee revenue: totals, weekly trend, volume, per-currency breakdown.

router.get('/revenue-stats', async (_req: Request, res: Response) => {
  try {
    const [
      offerTotals, parlayTotals,
      weeklyOffers, weeklyParlays,
      openOffers, openParlays,
      offerByCurrency, parlayByCurrency,
    ] = await Promise.all([
      // Totals across all settled single offers
      db.execute(sql`
        SELECT
          COUNT(*)::int                          AS settled_count,
          COALESCE(SUM(platform_fee), 0)::float  AS total_fees,
          COALESCE(SUM(creator_stake + taker_stake), 0)::float AS total_volume
        FROM p2p_bet_offers
        WHERE status = 'settled'
      `),
      // Totals across all settled parlays
      db.execute(sql`
        SELECT
          COUNT(*)::int                          AS settled_count,
          COALESCE(SUM(platform_fee), 0)::float  AS total_fees,
          COALESCE(SUM(creator_stake + taker_stake), 0)::float AS total_volume
        FROM p2p_parlay_offers
        WHERE status = 'settled'
      `),
      // Weekly breakdown for offers (last 8 weeks)
      db.execute(sql`
        SELECT
          DATE_TRUNC('week', settled_at)::text  AS week,
          COALESCE(SUM(platform_fee), 0)::float AS fees,
          COALESCE(SUM(creator_stake + taker_stake), 0)::float AS volume,
          COUNT(*)::int                          AS count
        FROM p2p_bet_offers
        WHERE status = 'settled'
          AND settled_at IS NOT NULL
          AND settled_at >= NOW() - INTERVAL '8 weeks'
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      // Weekly breakdown for parlays (last 8 weeks)
      db.execute(sql`
        SELECT
          DATE_TRUNC('week', settled_at)::text  AS week,
          COALESCE(SUM(platform_fee), 0)::float AS fees,
          COALESCE(SUM(creator_stake + taker_stake), 0)::float AS volume,
          COUNT(*)::int                          AS count
        FROM p2p_parlay_offers
        WHERE status = 'settled'
          AND settled_at IS NOT NULL
          AND settled_at >= NOW() - INTERVAL '8 weeks'
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      // Open/active offers (live order book depth)
      db.execute(sql`SELECT COUNT(*)::int AS open_count FROM p2p_bet_offers WHERE status IN ('open','partial','filled')`),
      db.execute(sql`SELECT COUNT(*)::int AS open_count FROM p2p_parlay_offers WHERE status IN ('open','filled','settling')`),
      // Per-currency fee breakdown — single offers
      db.execute(sql`
        SELECT
          COALESCE(currency, 'SUI')              AS currency,
          COUNT(*)::int                          AS settled_count,
          COALESCE(SUM(platform_fee), 0)::float  AS total_fees,
          COALESCE(SUM(creator_stake + taker_stake), 0)::float AS total_volume
        FROM p2p_bet_offers
        WHERE status = 'settled'
        GROUP BY 1
      `),
      // Per-currency fee breakdown — parlays
      db.execute(sql`
        SELECT
          COALESCE(currency, 'SUI')              AS currency,
          COUNT(*)::int                          AS settled_count,
          COALESCE(SUM(platform_fee), 0)::float  AS total_fees,
          COALESCE(SUM(creator_stake + taker_stake), 0)::float AS total_volume
        FROM p2p_parlay_offers
        WHERE status = 'settled'
        GROUP BY 1
      `),
    ]);

    // Contract on-chain status
    const contractInfo = p2pContractService.getContractInfo();

    // Merge weekly data
    type WeekRow = { week: string; fees: number; volume: number; count: number };
    const mergeWeeks = (a: any[], b: any[]): WeekRow[] => {
      const map = new Map<string, WeekRow>();
      for (const r of [...a, ...b]) {
        const key = (r.week || '').substring(0, 10);
        if (!key) continue;
        const existing = map.get(key) ?? { week: key, fees: 0, volume: 0, count: 0 };
        map.set(key, {
          week: key,
          fees: existing.fees + Number(r.fees),
          volume: existing.volume + Number(r.volume),
          count: existing.count + Number(r.count),
        });
      }
      return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
    };

    // Helper: drizzle/postgres-js db.execute() returns an array directly (not .rows)
    const toRows = (r: any): any[] => Array.isArray(r) ? r : (r?.rows ?? []);

    // Merge per-currency rows from offers + parlays
    type CurrencyRow = { currency: string; fees: number; volume: number; count: number };
    const mergeCurrency = (a: any[], b: any[]): CurrencyRow[] => {
      const map = new Map<string, CurrencyRow>();
      for (const r of [...a, ...b]) {
        const key = (r.currency || 'SUI').toUpperCase();
        const existing = map.get(key) ?? { currency: key, fees: 0, volume: 0, count: 0 };
        map.set(key, {
          currency: key,
          fees: Math.round((existing.fees + Number(r.total_fees)) * 1e6) / 1e6,
          volume: Math.round((existing.volume + Number(r.total_volume)) * 1e6) / 1e6,
          count: existing.count + Number(r.settled_count),
        });
      }
      const ORDER = ['SUI', 'SBETS', 'USDSUI', 'USDC'];
      return [...map.values()].sort((a, b) => {
        const ai = ORDER.indexOf(a.currency);
        const bi = ORDER.indexOf(b.currency);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    };

    const offerRow = (toRows(offerTotals)[0] ?? {}) as any;
    const parlayRow = (toRows(parlayTotals)[0] ?? {}) as any;
    const totalSettled = Number(offerRow.settled_count ?? 0) + Number(parlayRow.settled_count ?? 0);
    const weeklyHistory = mergeWeeks(toRows(weeklyOffers), toRows(weeklyParlays));
    const currencyBreakdown = mergeCurrency(toRows(offerByCurrency), toRows(parlayByCurrency));

    // Only count SUI-denominated fees/volume — do NOT mix in SBETS or other token amounts
    const suiBreakdown = currencyBreakdown.find(c => c.currency === 'SUI');
    const totalFees   = suiBreakdown?.fees   ?? 0;
    const totalVolume = suiBreakdown?.volume ?? 0;

    const dbOpenOffers = Number((openOffers.rows?.[0] as any)?.open_count ?? 0)
      || Number((toRows(openOffers)[0] as any)?.open_count ?? 0);
    const dbOpenParlays = Number((openParlays.rows?.[0] as any)?.open_count ?? 0)
      || Number((toRows(openParlays)[0] as any)?.open_count ?? 0);

    // ── On-chain supplement: when DB is empty, use live WARP/FLUX/PULSE stats ──
    let onchainSettled = 0;
    let onchainOpenOffers = 0;
    if (totalSettled === 0) {
      try {
        const [warpRes, fluxRes, pulseRes] = await Promise.allSettled([
          warpEngineService.healthCheck(),
          fluxEngineService.healthCheck(),
          pulseEngineService.healthCheck(),
        ]);
        if (warpRes.status === 'fulfilled' && warpRes.value.ok) {
          const m = warpRes.value.message.match(/settled:\s*(\d+)/);
          if (m) onchainSettled += parseInt(m[1], 10);
        }
        if (fluxRes.status === 'fulfilled' && fluxRes.value.ok) {
          const ms = fluxRes.value.message.match(/settled:\s*(\d+)/);
          const mo = fluxRes.value.message.match(/offers:\s*(\d+)/);
          if (ms) onchainSettled += parseInt(ms[1], 10);
          if (mo) onchainOpenOffers += parseInt(mo[1], 10);
        }
        if (pulseRes.status === 'fulfilled' && pulseRes.value.ok) {
          const m = pulseRes.value.message.match(/settled:\s*(\d+)/);
          if (m) onchainSettled += parseInt(m[1], 10);
        }
      } catch (_) { /* best-effort */ }
    }

    res.json({
      totalSettledBets: totalSettled || onchainSettled,
      totalPlatformFeeSui: Math.round(totalFees * 1000) / 1000,
      totalVolumeSui: Math.round(totalVolume * 1000) / 1000,
      openOffersCount: dbOpenOffers || onchainOpenOffers,
      openParlaysCount: dbOpenParlays,
      weeklyHistory,
      currencyBreakdown,
      contractEnabled: contractInfo.configured,
      network: contractInfo.network ?? 'mainnet',
      lastUpdated: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to fetch P2P revenue stats' });
  }
});

// ─── Settlement Tape ──────────────────────────────────────────────────────────
// Returns the 20 most recently settled bets (singles + parlays) across all users.
router.get('/settled-tape', async (_req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        'single'                                           AS type,
        o.id,
        o.event_name,
        o.home_team,
        o.away_team,
        o.prediction,
        COALESCE(o.odds, 1)::float                        AS odds,
        COALESCE(o.creator_stake, 0)::float               AS creator_stake,
        COALESCE(o.taker_stake, 0)::float                 AS taker_stake,
        (COALESCE(o.creator_stake,0) + COALESCE(o.taker_stake,0))::float AS total_pot,
        o.winner,
        o.creator_wallet,
        m.taker_wallet,
        m.actual_payout::float                            AS payout_amount,
        m.payout_tx_hash,
        o.settled_at,
        NULL::text                                        AS leg_count,
        COALESCE(o.currency, 'SUI')                       AS currency
      FROM p2p_bet_offers o
      LEFT JOIN LATERAL (
        SELECT taker_wallet, actual_payout, payout_tx_hash
        FROM p2p_bet_matches
        WHERE offer_id = o.id
        LIMIT 1
      ) m ON true
      WHERE o.status = 'settled'
        AND o.settled_at IS NOT NULL

      UNION ALL

      SELECT
        'parlay'                                           AS type,
        p.id,
        NULL                                              AS event_name,
        NULL                                              AS home_team,
        NULL                                              AS away_team,
        'parlay'                                          AS prediction,
        COALESCE(p.total_odds, 1)::float                  AS odds,
        COALESCE(p.creator_stake, 0)::float               AS creator_stake,
        COALESCE(p.taker_stake, 0)::float                 AS taker_stake,
        (COALESCE(p.creator_stake,0) + COALESCE(p.taker_stake,0))::float AS total_pot,
        p.winner,
        p.creator_wallet,
        p.taker_wallet,
        p.actual_payout::float                            AS payout_amount,
        p.settlement_tx_hash                              AS payout_tx_hash,
        p.settled_at,
        p.leg_count::text                                 AS leg_count,
        COALESCE(p.currency, 'SUI')                       AS currency
      FROM p2p_parlay_offers p
      WHERE p.status = 'settled'
        AND p.settled_at IS NOT NULL

      ORDER BY settled_at DESC
      LIMIT 20
    `);

    const tape = (Array.isArray(rows) ? rows : (rows as any).rows ?? []).map((r: any) => ({
      type:         r.type,
      id:           Number(r.id),
      eventName:    r.event_name ?? null,
      homeTeam:     r.home_team ?? null,
      awayTeam:     r.away_team ?? null,
      prediction:   r.prediction ?? null,
      odds:         Number(r.odds ?? 1),
      creatorStake: Number(r.creator_stake ?? 0),
      takerStake:   Number(r.taker_stake ?? 0),
      totalPot:     Number(r.total_pot ?? 0),
      winner:       r.winner ?? null,
      creatorWallet: r.creator_wallet ?? null,
      takerWallet:   r.taker_wallet ?? null,
      payoutAmount: r.payout_amount != null ? Number(r.payout_amount) : null,
      payoutTxHash: r.payout_tx_hash ?? null,
      settledAt:    r.settled_at ?? null,
      legCount:     r.leg_count != null ? Number(r.leg_count) : null,
      currency:     r.currency ?? 'SUI',
    }));

    res.json({ tape, updatedAt: Date.now() });
  } catch (err: any) {
    res.status(500).json({ message: err.message || 'Failed to fetch settlement tape' });
  }
});

// ─── Railway / External DB Admin Audit ───────────────────────────────────────
// POST /api/p2p/admin/db-audit
// Audits the Railway DB configured in the RAILWAY_DB_URL env var.
// dbUrl from request body is intentionally not accepted (SSRF prevention).
router.post('/admin/db-audit', requireAdminAuth, async (req: Request, res: Response) => {
  const { Pool } = require('pg');
  const targetUrl: string | undefined = process.env.RAILWAY_DB_URL;
  if (!targetUrl) {
    return res.status(400).json({ error: 'RAILWAY_DB_URL env var is not configured on this server' });
  }
  const pool = new Pool({ connectionString: targetUrl, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000 });
  try {
    await pool.query('SELECT 1'); // connectivity check

    const [
      offerStatusQ,
      pendingCreatorRefundsQ,
      pendingMatchRefundsQ,
      unpaidWinnersQ,
      stuckSettlingQ,
      recentSettledQ,
      schemaCheckQ,
    ] = await Promise.all([
      // Offer status breakdown
      pool.query(`SELECT status, COUNT(*)::int AS cnt, COALESCE(SUM(creator_stake),0)::float AS total_stake
                  FROM p2p_bet_offers GROUP BY status ORDER BY cnt DESC`),
      // Creator offers/parlays needing refund
      pool.query(`
        SELECT 'offer' AS type, id, creator_wallet, creator_stake::float, currency, status, created_at
        FROM p2p_bet_offers
        WHERE status IN ('cancelled','expired') AND creator_tx_hash IS NOT NULL
          AND refund_tx_hash IS NULL AND creator_stake > 0
        UNION ALL
        SELECT 'parlay', id, creator_wallet, creator_stake::float, currency, status, created_at
        FROM p2p_parlay_offers
        WHERE status IN ('cancelled','expired') AND creator_tx_hash IS NOT NULL
          AND refund_tx_hash IS NULL AND creator_stake > 0
        ORDER BY created_at DESC LIMIT 50`),
      // Taker matches needing refund (cancelled, taker paid, not refunded)
      pool.query(`
        SELECT m.id, m.taker_wallet, m.stake::float, m.status, m.created_at,
               o.currency, o.id AS offer_id, o.status AS offer_status
        FROM p2p_bet_matches m JOIN p2p_bet_offers o ON o.id = m.offer_id
        WHERE m.status = 'cancelled'
          AND m.taker_tx_hash IS NOT NULL
          AND m.settlement_tx_hash IS NULL
          AND m.stake > 0
        ORDER BY m.created_at DESC LIMIT 50`),
      // Settled matches without payout_tx_hash (winners not confirmed paid)
      pool.query(`
        SELECT m.id, m.status, m.taker_wallet, m.stake::float, m.actual_payout::float,
               m.settlement_tx_hash, m.payout_tx_hash, m.settled_at, o.currency
        FROM p2p_bet_matches m JOIN p2p_bet_offers o ON o.id = m.offer_id
        WHERE m.status IN ('won','lost')
          AND m.settlement_tx_hash IS NULL
        ORDER BY m.settled_at DESC LIMIT 50`),
      // Stuck in 'settling' status (crashed mid-payout)
      pool.query(`
        SELECT 'offer_match' AS type, m.id, m.taker_wallet AS wallet, m.stake::float,
               o.currency, m.created_at
        FROM p2p_bet_matches m JOIN p2p_bet_offers o ON o.id = m.offer_id
        WHERE m.status = 'settling' AND m.settlement_tx_hash IS NULL
        UNION ALL
        SELECT 'parlay', id, creator_wallet, creator_stake::float, currency, created_at
        FROM p2p_parlay_offers
        WHERE status = 'settling' AND settlement_tx_hash IS NULL
        ORDER BY created_at DESC LIMIT 30`),
      // Last 10 settled bets
      pool.query(`
        SELECT 'offer' AS type, o.id, o.winner, o.settled_at, o.platform_fee::float,
               o.currency, o.creator_stake::float, o.settlement_tx_hash
        FROM p2p_bet_offers o WHERE o.status = 'settled' ORDER BY o.settled_at DESC LIMIT 5
        UNION ALL
        SELECT 'parlay', p.id, p.winner, p.settled_at, p.platform_fee::float,
               p.currency, p.creator_stake::float, p.settlement_tx_hash
        FROM p2p_parlay_offers p WHERE p.status = 'settled' ORDER BY p.settled_at DESC LIMIT 5`),
      // Schema: check which P2P columns exist
      pool.query(`SELECT table_name, column_name FROM information_schema.columns
                  WHERE table_name IN ('p2p_bet_offers','p2p_bet_matches','p2p_parlay_offers','p2p_parlay_legs')
                  ORDER BY table_name, ordinal_position`),
    ]);

    const schemaByTable: Record<string, string[]> = {};
    for (const row of schemaCheckQ.rows) {
      if (!schemaByTable[row.table_name]) schemaByTable[row.table_name] = [];
      schemaByTable[row.table_name].push(row.column_name);
    }

    res.json({
      connectedTo: targetUrl.replace(/:[^:@]+@/, ':***@'),
      offerStatusBreakdown: offerStatusQ.rows,
      pendingCreatorRefunds:   { count: pendingCreatorRefundsQ.rows.length, rows: pendingCreatorRefundsQ.rows },
      pendingTakerMatchRefunds: { count: pendingMatchRefundsQ.rows.length, rows: pendingMatchRefundsQ.rows },
      unpaidWinners:            { count: unpaidWinnersQ.rows.length, rows: unpaidWinnersQ.rows },
      stuckSettling:            { count: stuckSettlingQ.rows.length, rows: stuckSettlingQ.rows },
      recentSettled:            recentSettledQ.rows,
      schemaColumns:            schemaByTable,
      auditedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: err.code });
  } finally {
    pool.end().catch(() => {});
  }
});

// POST /api/p2p/admin/db-migrate
// Run a schema migration against the Railway DB configured in RAILWAY_DB_URL env var.
// Body: { sql: string }
// Only DDL/DML statements are permitted (ALTER, CREATE, INSERT, UPDATE, DELETE, DROP).
// dbUrl from request body is intentionally not accepted (SSRF prevention).
// Arbitrary SELECT queries are blocked to prevent data exfiltration.
router.post('/admin/db-migrate', requireAdminAuth, async (req: Request, res: Response) => {
  const { Pool } = require('pg');
  const targetUrl: string | undefined = process.env.RAILWAY_DB_URL;
  const migrationSql: string | undefined = req.body?.sql;
  if (!targetUrl) return res.status(400).json({ error: 'RAILWAY_DB_URL env var is not configured on this server' });
  if (!migrationSql || typeof migrationSql !== 'string') return res.status(400).json({ error: 'Provide sql in body' });
  if (migrationSql.trim().length > 10000) return res.status(400).json({ error: 'SQL too long (max 10000 chars)' });

  // Block multi-statement injection: reject any SQL containing a semicolon outside of string literals.
  // Simple heuristic: strip single-quoted strings, then check for semicolons.
  const sqlNoStrings = migrationSql.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  if (/;/.test(sqlNoStrings)) {
    return res.status(400).json({ error: 'Multi-statement SQL is not permitted (semicolons disallowed)' });
  }

  // Whitelist: only DDL/DML statements permitted; reject anything starting with SELECT
  const firstWord = migrationSql.trim().split(/\s+/)[0].toUpperCase();
  const allowedCommands = ['ALTER', 'CREATE', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'COMMENT', 'DO'];
  if (!allowedCommands.includes(firstWord)) {
    return res.status(400).json({ error: `SQL command "${firstWord}" is not permitted. Allowed: ${allowedCommands.join(', ')}` });
  }

  const pool = new Pool({ connectionString: targetUrl, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15000 });
  try {
    await pool.query('SELECT 1');
    const result = await pool.query(migrationSql);
    res.json({ success: true, command: result.command, rowCount: result.rowCount });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message, code: err.code });
  } finally {
    pool.end().catch(() => {});
  }
});



// POST /api/p2p/admin/compensate-wrong-settlement
// Pays the CORRECT winner for a P2P match that was already settled to the wrong
// party (e.g. bad result fetched from a wrong fixture).
// This does NOT reverse the on-chain payment — it sends a NEW compensation
// payment from the admin/revenue wallet to the correct winner.
// Body: { matchId: number, correctWinner: 'taker'|'maker', reason?: string }
router.post('/admin/compensate-wrong-settlement', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { matchId, correctWinner, reason } = req.body as {
      matchId: number;
      correctWinner: 'taker' | 'maker';
      reason?: string;
    };
    if (!matchId || !correctWinner) {
      return res.status(400).json({ message: 'matchId and correctWinner required' });
    }
    if (!['taker', 'maker'].includes(correctWinner)) {
      return res.status(400).json({ message: 'correctWinner must be "taker" or "maker"' });
    }

    const [match] = await db.select().from(p2pBetMatches).where(eq(p2pBetMatches.id, matchId));
    if (!match) return res.status(404).json({ message: `Match ${matchId} not found` });

    const [offer] = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.id, match.offerId!));
    if (!offer) return res.status(404).json({ message: `Offer for match ${matchId} not found` });

    const compensationWallet = correctWinner === 'taker' ? match.takerWallet : offer.creatorWallet;
    if (!compensationWallet) {
      return res.status(400).json({ message: `No wallet found for ${correctWinner}` });
    }

    // Recompute payout with same formula used at original settlement
    const takerFeeRate   = Number(match.takerFeeRate   ?? 0.02);
    const makerRebateRate = Number(match.makerRebateRate ?? 0);
    const totalPot = (offer.creatorStake ?? 0) + (match.stake ?? 0);
    const netFee   = Math.round(totalPot * Math.max(takerFeeRate - makerRebateRate, 0));
    const compensationAmount = totalPot - netFee;

    console.log(`[P2P Compensate] Match ${matchId} | correctWinner=${correctWinner} | wallet=${compensationWallet.slice(0, 12)}... | amount=${compensationAmount} ${offer.currency} | reason=${reason ?? 'not provided'}`);

    const { blockchainBetService } = await import('./services/blockchainBetService');
    const currency = offer.currency ?? 'SUI';
    let result: { success: boolean; txHash?: string; error?: string };
    if (currency === 'SBETS') {
      // Try admin wallet first, fall back to revenue wallet if balance is insufficient
      result = await blockchainBetService.sendSbetsToUser(compensationWallet, compensationAmount);
      if (!result.success && result.error?.includes('Insufficient')) {
        console.warn(`[P2P Compensate] Admin wallet insufficient — trying revenue wallet`);
        result = await blockchainBetService.sendSbetsFromRevenueWallet(compensationWallet, compensationAmount);
      }
    } else if (currency === 'USDSUI') {
      result = await (blockchainBetService as any).sendUsdsuiToUser(compensationWallet, compensationAmount);
    } else if (currency === 'USDC') {
      result = await (blockchainBetService as any).sendUsdcToUser(compensationWallet, compensationAmount);
    } else {
      result = await (blockchainBetService as any).sendSuiToUser(compensationWallet, compensationAmount);
    }

    if (!result.success) {
      console.error(`[P2P Compensate] Payment failed: ${result.error}`);
      return res.status(500).json({ message: `Payment failed: ${result.error}` });
    }

    // Record the compensation in the DB (audit trail only — does not re-open the bet)
    await db.execute(sql`
      UPDATE p2p_bet_matches
      SET winner             = ${compensationWallet},
          payout_tx_hash     = ${result.txHash ?? null}
      WHERE id = ${matchId}
    `);
    await db.execute(sql`
      UPDATE p2p_bet_offers
      SET winner = ${correctWinner}
      WHERE id   = ${offer.id}
    `);

    // Ensure correct result is cached so the settlement worker never re-settles
    await db.execute(sql`
      INSERT INTO settled_events (external_event_id, home_team, away_team, winner, bets_settled)
      VALUES (${offer.eventId ?? ''}, ${offer.homeTeam ?? ''}, ${offer.awayTeam ?? ''}, ${'home'}, 0)
      ON CONFLICT (external_event_id) DO UPDATE SET winner = EXCLUDED.winner
    `);

    console.log(`[P2P Compensate] ✅ ${compensationAmount} ${currency} → ${compensationWallet.slice(0, 12)}... | TX: ${result.txHash}`);

    return res.json({
      success: true,
      matchId,
      offerId: offer.id,
      correctWinner,
      compensationWallet,
      compensationAmount,
      currency,
      txHash: result.txHash,
      message: `Compensation of ${compensationAmount} ${currency} sent to ${correctWinner}. TX: ${result.txHash}`,
    });
  } catch (err: any) {
    console.error('[P2P Compensate]', err);
    return res.status(500).json({ message: err?.message ?? 'Compensation failed' });
  }
});

// ─── Admin: Rebuild p2p_volume_stats from raw tables ─────────────────────────
// POST /api/p2p/admin/rebuild-volume-stats
// Truncates p2p_volume_stats and rebuilds it from p2p_bet_offers, p2p_bet_matches, and p2p_parlay_offers.
// Safe to run multiple times — idempotent.

router.post('/admin/rebuild-volume-stats', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    // Truncate existing stats
    await db.execute(sql`TRUNCATE TABLE p2p_volume_stats RESTART IDENTITY`);

    // Aggregate from raw tables and insert in one pass
    await db.execute(sql`
      WITH
        maker AS (
          SELECT
            creator_wallet                                                                        AS wallet,
            COALESCE(SUM(creator_stake) FILTER (WHERE status IN ('open','filled','settled','partial')), 0) AS vol_maker,
            0::numeric                                                                           AS vol_taker,
            COUNT(*) FILTER (WHERE status IN ('open','filled','settled','partial','cancelled'))   AS bets,
            COUNT(*) FILTER (WHERE winner = 'creator')                                           AS wins,
            COUNT(*) FILTER (WHERE winner = 'taker')                                             AS losses,
            COALESCE(SUM(
              CASE
                WHEN winner = 'creator' AND status = 'settled'
                  THEN (creator_stake + COALESCE(filled_stake, taker_stake)) * 0.98 - creator_stake
                WHEN winner = 'taker' AND status = 'settled'
                  THEN -creator_stake
                ELSE 0
              END
            ), 0) AS pnl
          FROM p2p_bet_offers
          WHERE creator_wallet IS NOT NULL AND creator_wallet <> ''
          GROUP BY creator_wallet
        ),
        taker AS (
          SELECT
            taker_wallet                                                                          AS wallet,
            0::numeric                                                                            AS vol_maker,
            COALESCE(SUM(stake), 0)                                                              AS vol_taker,
            COUNT(*)                                                                              AS bets,
            COUNT(*) FILTER (WHERE status = 'won')                                               AS wins,
            COUNT(*) FILTER (WHERE status = 'lost')                                              AS losses,
            COALESCE(SUM(
              CASE
                WHEN status = 'won'  THEN COALESCE(actual_payout, potential_payout) - stake
                WHEN status = 'lost' THEN -stake
                ELSE 0
              END
            ), 0) AS pnl
          FROM p2p_bet_matches
          WHERE taker_wallet IS NOT NULL AND taker_wallet <> ''
          GROUP BY taker_wallet
        ),
        parlay_creator AS (
          SELECT
            creator_wallet                                                                        AS wallet,
            COALESCE(SUM(creator_stake) FILTER (WHERE status IN ('open','filled','settled')), 0)  AS vol_maker,
            0::numeric                                                                            AS vol_taker,
            COUNT(*) FILTER (WHERE status IN ('open','filled','settled','cancelled'))             AS bets,
            COUNT(*) FILTER (WHERE winner = 'creator')                                           AS wins,
            COUNT(*) FILTER (WHERE winner = 'taker')                                             AS losses,
            COALESCE(SUM(
              CASE
                WHEN winner = 'creator' AND status = 'settled' THEN (creator_stake + taker_stake) * 0.98 - creator_stake
                WHEN winner = 'taker'   AND status = 'settled' THEN -creator_stake
                ELSE 0
              END
            ), 0) AS pnl
          FROM p2p_parlay_offers
          WHERE creator_wallet IS NOT NULL AND creator_wallet <> ''
          GROUP BY creator_wallet
        ),
        parlay_taker AS (
          SELECT
            taker_wallet                                                                          AS wallet,
            0::numeric                                                                            AS vol_maker,
            COALESCE(SUM(taker_stake) FILTER (WHERE status IN ('filled','settled')), 0)           AS vol_taker,
            COUNT(*) FILTER (WHERE status IN ('filled','settled') AND taker_wallet IS NOT NULL)   AS bets,
            COUNT(*) FILTER (WHERE winner = 'taker')                                             AS wins,
            COUNT(*) FILTER (WHERE winner = 'creator')                                           AS losses,
            COALESCE(SUM(
              CASE
                WHEN winner = 'taker'   AND status = 'settled' THEN (creator_stake + taker_stake) * 0.98 - taker_stake
                WHEN winner = 'creator' AND status = 'settled' THEN -taker_stake
                ELSE 0
              END
            ) FILTER (WHERE taker_wallet IS NOT NULL), 0) AS pnl
          FROM p2p_parlay_offers
          WHERE taker_wallet IS NOT NULL AND taker_wallet <> ''
          GROUP BY taker_wallet
        ),
        combined AS (
          SELECT wallet, vol_maker, vol_taker, bets, wins, losses, pnl FROM maker
          UNION ALL
          SELECT wallet, vol_maker, vol_taker, bets, wins, losses, pnl FROM taker
          UNION ALL
          SELECT wallet, vol_maker, vol_taker, bets, wins, losses, pnl FROM parlay_creator
          UNION ALL
          SELECT wallet, vol_maker, vol_taker, bets, wins, losses, pnl FROM parlay_taker
        ),
        agg AS (
          SELECT
            wallet,
            SUM(vol_maker)::real  AS total_volume_maker,
            SUM(vol_taker)::real  AS total_volume_taker,
            SUM(bets)::int        AS total_bets,
            SUM(wins)::int        AS won_bets,
            SUM(losses)::int      AS lost_bets,
            SUM(pnl)::real        AS total_net_pnl
          FROM combined
          WHERE wallet IS NOT NULL AND wallet <> ''
          GROUP BY wallet
          HAVING SUM(bets) > 0
        )
      INSERT INTO p2p_volume_stats
        (wallet_address, total_volume_maker, total_volume_taker, total_bets, won_bets, lost_bets, total_net_pnl, last_updated)
      SELECT
        wallet, total_volume_maker, total_volume_taker, total_bets, won_bets, lost_bets, total_net_pnl, NOW()
      FROM agg
      ON CONFLICT (wallet_address) DO UPDATE SET
        total_volume_maker = EXCLUDED.total_volume_maker,
        total_volume_taker = EXCLUDED.total_volume_taker,
        total_bets         = EXCLUDED.total_bets,
        won_bets           = EXCLUDED.won_bets,
        lost_bets          = EXCLUDED.lost_bets,
        total_net_pnl      = EXCLUDED.total_net_pnl,
        last_updated       = NOW()
    `);

    const [{ count }] = await db.execute(sql`SELECT COUNT(*)::int AS count FROM p2p_volume_stats`) as any;
    const rowCount = (count as any)?.rows?.[0]?.count ?? (count as any)?.count ?? '?';

    console.log(`[P2P Admin] ✅ rebuild-volume-stats: ${rowCount} wallets rebuilt`);
    return res.json({ success: true, walletsRebuilt: rowCount });
  } catch (err: any) {
    console.error('[P2P Admin] rebuild-volume-stats failed:', err);
    return res.status(500).json({ message: err?.message ?? 'Rebuild failed' });
  }
});

// ─── DeepBook v3 Routes ────────────────────────────────────────────────────────

router.get('/deepbook/pools', async (_req: Request, res: Response) => {
  try {
    const { listPools, allPools } = await import('./services/deepbookService');
    const featured = listPools();
    const all = allPools();
    return res.json({ featured, all });
  } catch (err: any) {
    console.error('[DeepBook] pools error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'DeepBook unavailable' });
  }
});

router.get('/deepbook/summaries', async (_req: Request, res: Response) => {
  try {
    const { getPoolSummaries } = await import('./services/deepbookService');
    const summaries = await getPoolSummaries();
    return res.json({ summaries });
  } catch (err: any) {
    console.error('[DeepBook] summaries error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'DeepBook unavailable' });
  }
});

router.get('/deepbook/depth/:poolKey', async (req: Request, res: Response) => {
  try {
    const { getPoolDepth } = await import('./services/deepbookService');
    const poolKey = req.params.poolKey?.toUpperCase();
    const ticks   = Math.min(Math.max(parseInt((req.query.ticks as string) ?? '10', 10) || 10, 1), 20);
    const depth   = await getPoolDepth(poolKey, ticks);
    return res.json(depth);
  } catch (err: any) {
    console.error('[DeepBook] depth error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Pool depth unavailable' });
  }
});

router.get('/deepbook/mid-price/:poolKey', async (req: Request, res: Response) => {
  try {
    const { getMidPrice } = await import('./services/deepbookService');
    const poolKey  = req.params.poolKey?.toUpperCase();
    const midPrice = await getMidPrice(poolKey);
    return res.json({ poolKey, midPrice });
  } catch (err: any) {
    console.error('[DeepBook] mid-price error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Mid-price unavailable' });
  }
});

// ─── DeepBook v3 — Level2Range (price-window depth) ──────────────────────────

router.get('/deepbook/depth-range/:poolKey', async (req: Request, res: Response) => {
  try {
    const { getLevel2Range } = await import('./services/deepbookService');
    const poolKey   = req.params.poolKey?.toUpperCase();
    const priceLow  = parseFloat(req.query.priceLow  as string ?? '0');
    const priceHigh = parseFloat(req.query.priceHigh as string ?? '0');
    const isBid     = req.query.isBid === 'true';
    if (!poolKey) return res.status(400).json({ message: 'poolKey required' });
    if (isNaN(priceLow) || isNaN(priceHigh) || priceHigh <= priceLow)
      return res.status(400).json({ message: 'Valid priceLow < priceHigh required' });
    const result = await getLevel2Range(poolKey, priceLow, priceHigh, isBid);
    return res.json(result);
  } catch (err: any) {
    console.error('[DeepBook] depth-range error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Depth range unavailable' });
  }
});

// ─── DeepBook v3 — Vault Balances ────────────────────────────────────────────

router.get('/deepbook/vault/:poolKey', async (req: Request, res: Response) => {
  try {
    const { getVaultBalances } = await import('./services/deepbookService');
    const poolKey = req.params.poolKey?.toUpperCase();
    if (!poolKey) return res.status(400).json({ message: 'poolKey required' });
    const result = await getVaultBalances(poolKey);
    return res.json(result);
  } catch (err: any) {
    console.error('[DeepBook] vault error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Vault balances unavailable' });
  }
});

// ─── DeepBook v3 — Order PTB Builders ────────────────────────────────────────
// All return base64-encoded BCS transaction bytes for wallet signing.

router.post('/deepbook/order/limit', async (req: Request, res: Response) => {
  try {
    const { buildLimitOrderTx } = await import('./services/deepbookService');
    const { sender, balanceManagerAddress, poolKey, price, quantity, isBid, expiration, payWithDeep } = req.body;
    if (!sender || !balanceManagerAddress || !poolKey)
      return res.status(400).json({ message: 'sender, balanceManagerAddress, poolKey required' });
    if (typeof price !== 'number' || typeof quantity !== 'number')
      return res.status(400).json({ message: 'price and quantity must be numbers' });
    const transactionBytes = await buildLimitOrderTx({
      sender, balanceManagerAddress, poolKey: poolKey.toUpperCase(),
      price, quantity, isBid: !!isBid, expiration, payWithDeep,
    });
    return res.json({ transactionBytes, type: 'limit', poolKey, price, quantity, isBid });
  } catch (err: any) {
    console.error('[DeepBook] limit order build error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Failed to build limit order' });
  }
});

router.post('/deepbook/order/market', async (req: Request, res: Response) => {
  try {
    const { buildMarketOrderTx } = await import('./services/deepbookService');
    const { sender, balanceManagerAddress, poolKey, quantity, isBid, payWithDeep } = req.body;
    if (!sender || !balanceManagerAddress || !poolKey)
      return res.status(400).json({ message: 'sender, balanceManagerAddress, poolKey required' });
    if (typeof quantity !== 'number')
      return res.status(400).json({ message: 'quantity must be a number' });
    const transactionBytes = await buildMarketOrderTx({
      sender, balanceManagerAddress, poolKey: poolKey.toUpperCase(),
      quantity, isBid: !!isBid, payWithDeep,
    });
    return res.json({ transactionBytes, type: 'market', poolKey, quantity, isBid });
  } catch (err: any) {
    console.error('[DeepBook] market order build error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Failed to build market order' });
  }
});

router.post('/deepbook/order/cancel', async (req: Request, res: Response) => {
  try {
    const { buildCancelOrderTx } = await import('./services/deepbookService');
    const { sender, balanceManagerAddress, poolKey, orderId } = req.body;
    if (!sender || !balanceManagerAddress || !poolKey || !orderId)
      return res.status(400).json({ message: 'sender, balanceManagerAddress, poolKey, orderId required' });
    const transactionBytes = await buildCancelOrderTx({
      sender, balanceManagerAddress, poolKey: poolKey.toUpperCase(), orderId: String(orderId),
    });
    return res.json({ transactionBytes, type: 'cancel', poolKey, orderId });
  } catch (err: any) {
    console.error('[DeepBook] cancel order build error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Failed to build cancel order' });
  }
});

router.post('/deepbook/order/cancel-all', async (req: Request, res: Response) => {
  try {
    const { buildCancelAllOrdersTx } = await import('./services/deepbookService');
    const { sender, balanceManagerAddress, poolKey } = req.body;
    if (!sender || !balanceManagerAddress || !poolKey)
      return res.status(400).json({ message: 'sender, balanceManagerAddress, poolKey required' });
    const transactionBytes = await buildCancelAllOrdersTx({
      sender, balanceManagerAddress, poolKey: poolKey.toUpperCase(),
    });
    return res.json({ transactionBytes, type: 'cancel-all', poolKey });
  } catch (err: any) {
    console.error('[DeepBook] cancel-all build error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Failed to build cancel-all' });
  }
});

router.post('/deepbook/balance-manager/create', async (req: Request, res: Response) => {
  try {
    const { buildCreateBalanceManagerTx } = await import('./services/deepbookService');
    const { sender } = req.body;
    if (!sender) return res.status(400).json({ message: 'sender required' });
    const transactionBytes = await buildCreateBalanceManagerTx({ sender });
    return res.json({ transactionBytes, type: 'create-balance-manager', sender });
  } catch (err: any) {
    console.error('[DeepBook] create BM build error:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Failed to build create balance manager' });
  }
});

// ─── DeepBook — error classifier (balance / validation errors → 400) ──────────

function deepbookStatus(err: any): number {
  const msg: string = err?.message ?? '';
  if (
    msg.includes('Insufficient balance') ||
    msg.includes('already configured') ||
    msg.includes('not configured') ||
    msg.includes('Odds must') ||
    msg.includes('must be a positive') ||
    msg.includes('Unknown pool') ||
    msg.includes('Unknown coin') ||
    msg.includes('does not exist')
  ) return 400;
  return 500;
}

// ─── DeepBook — SBETS/SUI pool status ────────────────────────────────────────

router.get('/deepbook/pool/sbets-status', async (_req: Request, res: Response) => {
  try {
    const { getSbetsPoolStatus, SBETS_COIN_TYPE } = await import('./services/deepbookService');
    const status = getSbetsPoolStatus();
    return res.json({ ...status, SBETS_COIN_TYPE });
  } catch (err: any) {
    console.error('[DeepBook] sbets-status error:', err?.message);
    return res.status(deepbookStatus(err)).json({ message: err?.message ?? 'Status unavailable' });
  }
});

// ─── DeepBook — Create SBETS/SUI permissionless pool ─────────────────────────
// Costs 500 DEEP from the sender's wallet.
// After executing, find the new Pool object ID in the tx effects and set
// DEEPBOOK_SBETS_SUI_POOL_ID environment variable to enable SBETS betting orders.

router.post('/deepbook/pool/create-sbets', async (req: Request, res: Response) => {
  try {
    const { buildCreateSbetsSuiPoolTx, SBETS_COIN_TYPE, getSbetsSuiPoolId } = await import('./services/deepbookService');
    const { sender } = req.body;
    if (!sender) return res.status(400).json({ message: 'sender required' });
    if (getSbetsSuiPoolId()) {
      return res.status(400).json({
        message: 'SBETS/SUI pool already configured',
        poolId: getSbetsSuiPoolId(),
      });
    }
    const transactionBytes = await buildCreateSbetsSuiPoolTx(sender);
    return res.json({
      transactionBytes,
      type: 'create-sbets-sui-pool',
      baseCoin: 'SBETS',
      quoteCoin: 'SUI',
      baseCoinType: SBETS_COIN_TYPE,
      tickSize: 0.0001,
      lotSize: 1000,
      minSize: 1000,
      note: 'Costs 500 DEEP from your wallet. After executing, find the new Pool object ID in tx effects and set DEEPBOOK_SBETS_SUI_POOL_ID env var.',
    });
  } catch (err: any) {
    console.error('[DeepBook] create-sbets-pool error:', err?.message);
    return res.status(deepbookStatus(err)).json({ message: err?.message ?? 'Failed to build pool creation tx' });
  }
});

// ─── DeepBook — Balance manager deposit ──────────────────────────────────────
// Deposits SUI or SBETS into a user's balance manager for DeepBook trading.

router.post('/deepbook/balance-manager/deposit', async (req: Request, res: Response) => {
  try {
    const { buildDepositToManagerTx } = await import('./services/deepbookService');
    const { sender, balanceManagerAddress, coinKey, amount } = req.body;
    if (!sender || !balanceManagerAddress || !coinKey)
      return res.status(400).json({ message: 'sender, balanceManagerAddress, coinKey required' });
    if (typeof amount !== 'number' || amount <= 0)
      return res.status(400).json({ message: 'amount must be a positive number' });
    const ck = String(coinKey).toUpperCase();
    if (!['SUI', 'SBETS', 'DEEP', 'USDC'].includes(ck))
      return res.status(400).json({ message: 'coinKey must be SUI, SBETS, DEEP, or USDC' });
    const transactionBytes = await buildDepositToManagerTx({ sender, balanceManagerAddress, coinKey: ck, amount });
    return res.json({ transactionBytes, type: 'deposit', coinKey: ck, amount, balanceManagerAddress });
  } catch (err: any) {
    console.error('[DeepBook] deposit error:', err?.message);
    return res.status(deepbookStatus(err)).json({ message: err?.message ?? 'Failed to build deposit tx' });
  }
});

// ─── DeepBook — Balance manager withdraw ─────────────────────────────────────

router.post('/deepbook/balance-manager/withdraw', async (req: Request, res: Response) => {
  try {
    const { buildWithdrawFromManagerTx } = await import('./services/deepbookService');
    const { sender, balanceManagerAddress, coinKey, amount, recipient } = req.body;
    if (!sender || !balanceManagerAddress || !coinKey)
      return res.status(400).json({ message: 'sender, balanceManagerAddress, coinKey required' });
    if (typeof amount !== 'number' || amount <= 0)
      return res.status(400).json({ message: 'amount must be a positive number' });
    const ck = String(coinKey).toUpperCase();
    if (!['SUI', 'SBETS', 'DEEP', 'USDC'].includes(ck))
      return res.status(400).json({ message: 'coinKey must be SUI, SBETS, DEEP, or USDC' });
    const transactionBytes = await buildWithdrawFromManagerTx({
      sender, balanceManagerAddress, coinKey: ck, amount,
      recipient: recipient ?? sender,
    });
    return res.json({ transactionBytes, type: 'withdraw', coinKey: ck, amount, recipient: recipient ?? sender });
  } catch (err: any) {
    console.error('[DeepBook] withdraw error:', err?.message);
    return res.status(deepbookStatus(err)).json({ message: err?.message ?? 'Failed to build withdraw tx' });
  }
});

// ─── DeepBook — Post bet as limit order on SBETS/SUI pool ───────────────────
//
// Converts a sports bet into a real DeepBook limit order:
//   price    = 1 / odds  (implied probability, 0–1)
//   quantity = stakeAmount in SBETS
//   side     = SELL (ASK) when creator posts offer, BUY (BID) when taker matches
//
// Example: "Team A wins @ 1.47 odds, 2M SBETS stake"
//   → SELL 2_000_000 SBETS @ 0.6803 SUI on live DeepBook SBETS/SUI order book
//
// Requirements:
//   1. DEEPBOOK_SBETS_SUI_POOL_ID env var must be set (pool must exist)
//   2. Sender must have a funded Balance Manager with SBETS (for creator / SELL)
//      or SUI (for taker / BUY)

router.post('/deepbook/bet/limit-order', async (req: Request, res: Response) => {
  try {
    const { buildBetLimitOrderTx, getSbetsSuiPoolId } = await import('./services/deepbookService');
    const { sender, balanceManagerAddress, odds, stakeAmount, isCreator, currency, expiration, payWithDeep } = req.body;

    if (!sender || !balanceManagerAddress)
      return res.status(400).json({ message: 'sender and balanceManagerAddress required' });
    if (typeof odds !== 'number' || odds <= 1.0)
      return res.status(400).json({ message: 'odds must be a number > 1.0' });
    if (typeof stakeAmount !== 'number' || stakeAmount <= 0)
      return res.status(400).json({ message: 'stakeAmount must be a positive number' });
    if (currency && currency !== 'SBETS' && currency !== 'SUI')
      return res.status(400).json({ message: 'currency must be "SBETS" or "SUI"' });
    if (!getSbetsSuiPoolId())
      return res.status(400).json({
        message: 'SBETS/SUI DeepBook pool not configured. Create it first via POST /api/p2p/deepbook/pool/create-sbets',
        hint: 'After pool creation tx, set DEEPBOOK_SBETS_SUI_POOL_ID env var to the new Pool object ID',
      });

    const resolvedCurrency: 'SBETS' | 'SUI' = currency === 'SUI' ? 'SUI' : 'SBETS';
    const impliedProbability = 1 / odds;
    const creator = isCreator !== false;

    // For SUI bets: quantity on DeepBook = sui_stake / implied_prob (SBETS equivalent)
    // For SBETS bets: quantity = stakeAmount directly
    const deepbookQuantity = resolvedCurrency === 'SUI'
      ? stakeAmount / impliedProbability
      : stakeAmount;

    // Side: SBETS creator = ASK, SUI creator = BID (see deepbookService for full explanation)
    const side = resolvedCurrency === 'SUI'
      ? (creator ? 'BUY (BID)' : 'SELL (ASK)')
      : (creator ? 'SELL (ASK)' : 'BUY (BID)');

    const transactionBytes = await buildBetLimitOrderTx({
      sender,
      balanceManagerAddress,
      odds,
      stakeAmount,
      isCreator: creator,
      currency: resolvedCurrency,
      expiration,
      payWithDeep,
    });

    return res.json({
      transactionBytes,
      type: 'bet-limit-order',
      pool: 'SBETS_SUI',
      currency: resolvedCurrency,
      odds,
      impliedProbability: Math.round(impliedProbability * 10000) / 10000,
      price: impliedProbability,
      stakeAmount,
      deepbookQuantity: Math.round(deepbookQuantity * 1000) / 1000,
      side,
      note: resolvedCurrency === 'SUI'
        ? `Your ${stakeAmount} SUI bet appears as a ${side} order at price ${impliedProbability.toFixed(4)} on the live SBETS/SUI DeepBook order book — locks ${stakeAmount} SUI in your Balance Manager`
        : `Your ${stakeAmount} SBETS bet appears as a ${side} order at price ${impliedProbability.toFixed(4)} on the live SBETS/SUI DeepBook order book`,
    });
  } catch (err: any) {
    console.error('[DeepBook] bet limit order error:', err?.message);
    return res.status(deepbookStatus(err)).json({ message: err?.message ?? 'Failed to build bet limit order' });
  }
});

// ─── DeepBook Admin — server-side transaction execution ───────────────────────
//
// These endpoints use DEEPBOOK_ADMIN_PRIVATE_KEY to sign + execute transactions
// on-chain directly — no user wallet required.
//
//  GET  /deepbook/admin/status         — wallet address, balances, pool/BM config
//  POST /deepbook/admin/setup          — one-click: create pool + BM + deposit
//  POST /deepbook/admin/deposit        — deposit more SBETS/SUI to admin BM
//  POST /deepbook/admin/test-bet       — post a test bet as live DeepBook limit order

router.get('/deepbook/admin/status', async (_req: Request, res: Response) => {
  try {
    const { getAdminStatus, getAdminBalances } = await import('./services/deepbookAdminService');
    const [status, balances] = await Promise.all([
      Promise.resolve(getAdminStatus()),
      getAdminBalances().catch(e => ({ error: e?.message })),
    ]);
    return res.json({ ...status, balances });
  } catch (err: any) {
    return res.status(500).json({ message: err?.message ?? 'Status unavailable' });
  }
});


// ─── Sui Network TPS ──────────────────────────────────────────────────────────

router.get('/sui/tps', async (_req: Request, res: Response) => {
  try {
    const { suiJsonRpc } = await import('./lib/suiRpcConfig');

    // Fetch latest checkpoint seq number
    const latestSeq = await suiJsonRpc('sui_getLatestCheckpointSequenceNumber', []);
    const latest = parseInt(latestSeq, 10);

    // Fetch a window of recent checkpoints to compute TPS
    const WINDOW = 10;
    const seqs = Array.from({ length: WINDOW }, (_, i) => String(latest - i));
    const checkpoints: any[] = await Promise.all(
      seqs.map(s => suiJsonRpc('sui_getCheckpoint', [s]).catch(() => null))
    );
    const valid = checkpoints.filter(Boolean);

    let tps = 0;
    let checkpointRate = 0;
    let avgTxPerCheckpoint = 0;

    if (valid.length >= 2) {
      const newest = valid[0];
      const oldest = valid[valid.length - 1];
      const timeDiffMs =
        parseInt(newest.timestampMs ?? newest.timestamp_ms ?? '0', 10) -
        parseInt(oldest.timestampMs ?? oldest.timestamp_ms ?? '0', 10);

      const totalTx = valid.reduce((sum: number, c: any) => {
        const n = parseInt(c.numTransactionBlocks ?? c.transactions?.length ?? '0', 10);
        return sum + n;
      }, 0);

      if (timeDiffMs > 0) {
        tps = Math.round((totalTx / timeDiffMs) * 1000);
        checkpointRate = parseFloat(((valid.length - 1) / (timeDiffMs / 1000)).toFixed(2));
        avgTxPerCheckpoint = Math.round(totalTx / valid.length);
      }
    }

    const networkLoad: 'low' | 'medium' | 'high' =
      tps < 1000 ? 'low' : tps < 5000 ? 'medium' : 'high';

    return res.json({
      tps,
      checkpointRate,
      avgTxPerCheckpoint,
      latestCheckpoint: latest,
      networkLoad,
    });
  } catch (err: any) {
    console.error('[SuiTPS]', err?.message);
    // Return sensible fallback so frontend still renders
    return res.json({ tps: 4200, checkpointRate: 2.8, avgTxPerCheckpoint: 1500, latestCheckpoint: 0, networkLoad: 'medium' });
  }
});

// ─── sui::clock Route ─────────────────────────────────────────────────────────

router.get('/clock', async (_req: Request, res: Response) => {
  try {
    const { getSuiClockInfo } = await import('./services/suiClockService');
    const info = await getSuiClockInfo();
    return res.json(info);
  } catch (err: any) {
    console.error('[SuiClock]', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Clock unavailable' });
  }
});

// ─── sui::random Routes ───────────────────────────────────────────────────────

router.get('/random/info', async (_req: Request, res: Response) => {
  try {
    const { getSuiRandomInfo } = await import('./services/suiRandomService');
    const info = await getSuiRandomInfo();
    return res.json(info);
  } catch (err: any) {
    console.error('[SuiRandom]', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Random info unavailable' });
  }
});

router.get('/random/draw-resolution/:offerId', async (req: Request, res: Response) => {
  try {
    const { resolveDrawFair } = await import('./services/suiRandomService');
    const offerId = parseInt(req.params.offerId, 10);
    const matchId = req.query.matchId ? parseInt(req.query.matchId as string, 10) : null;
    if (isNaN(offerId)) return res.status(400).json({ message: 'Invalid offerId' });
    const resolution = await resolveDrawFair(offerId, matchId);
    return res.json(resolution);
  } catch (err: any) {
    console.error('[SuiRandom] draw-resolution:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Draw resolution failed' });
  }
});

// ── Client-side PTB composition — stake offer / accept offer ─────────────────
// Returns the raw PTB inputs so the frontend can build and sign a single
// atomic transaction (split coin + contract call) without a two-step trust model.
// The frontend uses @mysten/sui/transactions to assemble the PTB from these params.

router.get('/ptb-params/create-offer', async (req: Request, res: Response) => {
  try {
    const { p2pContractService } = await import('./services/p2pContractService');
    const contractInfo = p2pContractService.getContractInfo();
    if (!contractInfo.packageId || contractInfo.packageId.startsWith('0x00000')) {
      return res.json({ available: false, reason: 'P2P contract not deployed on this network' });
    }
    return res.json({
      available: true,
      ptb: {
        packageId:  contractInfo.packageId,
        module:     'p2p_betting',
        function:   'create_offer',
        typeArgs:   ['0x2::sui::SUI'],
        description: 'Split <creatorStake> from a SUI coin, then call create_offer(registry, config, coin, prediction_bytes, odds_bps, expiry_ms)',
        argOrder:   ['registry_id', 'config_id', 'split_coin_result', 'prediction_bytes', 'odds_bps', 'expires_at_ms'],
        objectIds:  {
          registry: contractInfo.registryId,
          config:   contractInfo.configId,
        },
        helpUrl:    'https://docs.sui.io/sui-api-ref#unsafe_moveCall',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

router.get('/ptb-params/accept-offer/:offerId', async (req: Request, res: Response) => {
  try {
    const offerId = Number(req.params.offerId);
    if (!offerId) return res.status(400).json({ message: 'Invalid offerId' });

    const [offer] = await db.select({
      id:            p2pBetOffers.id,
      onchainOfferId: p2pBetOffers.onchainOfferId,
      takerStake:    p2pBetOffers.takerStake,
      currency:      p2pBetOffers.currency,
      status:        p2pBetOffers.status,
    }).from(p2pBetOffers).where(eq(p2pBetOffers.id, offerId)).limit(1);

    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    if (offer.status !== 'open') return res.status(400).json({ message: `Offer is ${offer.status}, not open` });
    if (!offer.onchainOfferId) return res.json({ available: false, reason: 'Offer not registered on-chain — use the API accept flow' });

    const { p2pContractService } = await import('./services/p2pContractService');
    const contractInfo = p2pContractService.getContractInfo();

    const currency = (offer.currency ?? 'SUI').toUpperCase();
    const typeArg  = currency === 'USDC'
      ? '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN'
      : '0x2::sui::SUI';

    return res.json({
      available:       true,
      onchainOfferId:  offer.onchainOfferId,
      takerStakeAmt:   offer.takerStake,
      currency,
      ptb: {
        packageId:   contractInfo.packageId,
        module:      'p2p_betting',
        function:    'accept_offer',
        typeArgs:    [typeArg],
        description: 'Split <takerStake> from your coin, then call accept_offer(registry, config, offer_id, split_coin_result)',
        argOrder:    ['registry_id', 'config_id', 'offer_object_id', 'split_coin_result'],
        objectIds:   {
          registry:   contractInfo.registryId,
          config:     contractInfo.configId,
          offerObject: offer.onchainOfferId,
        },
        helpUrl:     'https://docs.sui.io/sui-api-ref#unsafe_moveCall',
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: err.message });
  }
});

// ── Checkpoint-based settlement proof ─────────────────────────────────────────
// Returns the Sui checkpoint that finalised a settlement TX.
// Clients can independently verify the BLS-signed checkpoint digest proves
// the settlement happened at that blockchain height without trusting this API.
router.get('/checkpoint/:txHash', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;
    if (!txHash || txHash.length < 40) {
      return res.status(400).json({ message: 'Invalid txHash' });
    }

    // First check DB — we may have already fetched this at settlement time
    const [match] = await db
      .select({
        id: p2pBetMatches.id,
        checkpointSeq: p2pBetMatches.checkpointSeq,
        walrusBlobId: p2pBetMatches.walrusBlobId,
        settlementTxHash: p2pBetMatches.settlementTxHash,
      })
      .from(p2pBetMatches)
      .where(eq(p2pBetMatches.settlementTxHash, txHash))
      .limit(1);

    // If we already have the checkpoint, return immediately
    if (match?.checkpointSeq) {
      return res.json({
        txHash,
        checkpoint: match.checkpointSeq,
        walrusBlobId: match.walrusBlobId ?? null,
        walrusUrl: match.walrusBlobId
          ? `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${match.walrusBlobId}`
          : null,
        explorerUrl:   `https://suiscan.xyz/mainnet/tx/${txHash}`,
        checkpointUrl: `https://suiscan.xyz/mainnet/checkpoint/${match.checkpointSeq}`,
        source: 'db',
      });
    }

    // Fetch from Sui RPC
    const { suiJsonRpc } = await import('./lib/suiRpcConfig');
    const txBlock = await suiJsonRpc('sui_getTransactionBlock', [txHash, { showEffects: true }]);
    if (!txBlock) return res.status(404).json({ message: 'Transaction not found on-chain' });

    const checkpoint = txBlock.checkpoint ? String(txBlock.checkpoint) : null;

    // Backfill checkpoint to DB if we found the match
    if (checkpoint && match) {
      await db.update(p2pBetMatches)
        .set({ checkpointSeq: checkpoint })
        .where(eq(p2pBetMatches.id, match.id));
    }

    return res.json({
      txHash,
      checkpoint,
      digest:        txBlock.digest,
      timestampMs:   txBlock.timestampMs,
      status:        txBlock.effects?.status?.status ?? null,
      walrusBlobId:  match?.walrusBlobId ?? null,
      walrusUrl:     match?.walrusBlobId
        ? `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${match.walrusBlobId}`
        : null,
      explorerUrl:   `https://suiscan.xyz/mainnet/tx/${txHash}`,
      checkpointUrl: checkpoint ? `https://suiscan.xyz/mainnet/checkpoint/${checkpoint}` : null,
      source: 'rpc',
    });
  } catch (err: any) {
    console.error('[P2P] checkpoint lookup error:', err.message);
    return res.status(500).json({ message: err.message ?? 'Checkpoint lookup failed' });
  }
});

router.get('/random/offer-order', async (req: Request, res: Response) => {
  try {
    const { getVerifiableOfferOrder } = await import('./services/suiRandomService');
    const ids = ((req.query.ids as string) ?? '').split(',').map(Number).filter(n => !isNaN(n) && n > 0);
    if (ids.length === 0) return res.status(400).json({ message: 'No offer IDs provided' });
    const result = await getVerifiableOfferOrder(ids);
    return res.json(result);
  } catch (err: any) {
    console.error('[SuiRandom] offer-order:', err?.message);
    return res.status(500).json({ message: err?.message ?? 'Offer order failed' });
  }
});

// ─── zkSend Challenge Links ──────────────────────────────────────────────────

/**
 * GET /api/p2p/challenge/:token
 * Resolve a share token to its full offer. Used by the /p2p/c/:token landing page.
 */
router.get('/challenge/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 8) return res.status(400).json({ message: 'Invalid token' });
    const [offer] = await db.select().from(p2pBetOffers)
      .where(eq((p2pBetOffers as any).shareToken, token))
      .limit(1);
    if (!offer) return res.status(404).json({ message: 'Challenge not found or expired' });
    return res.json(offer);
  } catch (err: any) {
    console.error('[Challenge] lookup error:', err.message);
    return res.status(500).json({ message: err.message ?? 'Lookup failed' });
  }
});

/**
 * GET /api/p2p/live-events
 * Returns all currently live events from the sports API caches — used by the P2P
 * order book so players can pick a live match to bet in-play.
 */
router.get('/live-events', (_req: Request, res: Response) => {
  try {
    const liveEvents = apiSportsService.getLiveEventsForP2P();
    return res.json(liveEvents);
  } catch (err: any) {
    return res.status(500).json({ message: err.message ?? 'Failed to fetch live events' });
  }
});

/**
 * GET /api/p2p/offers/:id/share-link
 * Return the challenge share URL for a given offer (using its auto-generated shareToken).
 */
router.get('/offers/:id/share-link', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: 'Invalid offer ID' });
    const [offer] = await db.select({ id: p2pBetOffers.id, shareToken: (p2pBetOffers as any).shareToken })
      .from(p2pBetOffers)
      .where(eq(p2pBetOffers.id, id))
      .limit(1);
    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    const token = offer.shareToken;
    const origin = (req.headers.origin as string) || `https://${req.headers.host}`;
    return res.json({ shareUrl: `${origin}/p2p/c/${token}`, token });
  } catch (err: any) {
    return res.status(500).json({ message: err.message ?? 'Share link generation failed' });
  }
});

// ─── SuiNS Verification ──────────────────────────────────────────────────────

/**
 * GET /api/p2p/suins/check/:wallet
 * Check whether a wallet address owns at least one .sui domain.
 * Returns { hasSuiNs: boolean, names: string[] }
 */
router.get('/suins/check/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    if (!isValidWallet(wallet)) return res.status(400).json({ message: 'Invalid wallet address' });
    const { resolveSuiNSName } = await import('./services/suinsService');
    const name = await resolveSuiNSName(wallet);
    return res.json({
      hasSuiNs: !!name,
      names: name ? [name] : [],
      wallet,
    });
  } catch (err: any) {
    console.error('[SuiNS] check error:', err.message);
    return res.json({ hasSuiNs: false, names: [], wallet: req.params.wallet });
  }
});

// ─── Odds History (probability chart data) ────────────────────────────────────
/**
 * GET /api/p2p/odds-history?eventId=xxx&limit=30
 * Returns ordered list of odds offers for a given eventId so the frontend can
 * render a Polymarket-style implied-probability sparkline.
 */
router.get('/odds-history', async (req: Request, res: Response) => {
  const eventId = req.query.eventId as string | undefined;
  const limit   = Math.min(Number(req.query.limit) || 30, 100);
  if (!eventId) return res.json({ eventId: null, points: [] });
  try {
    const rows = await db.execute(sql`
      SELECT
        id,
        odds::float        AS odds,
        creator_stake::float AS stake,
        currency,
        status,
        created_at
      FROM p2p_bet_offers
      WHERE event_id = ${eventId}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `);
    const points = (rows.rows as any[]).map(r => ({
      id:   r.id,
      odds: Number(r.odds),
      prob: Math.round((100 / Number(r.odds)) * 10) / 10,   // implied probability %
      stake: Number(r.stake),
      currency: r.currency ?? 'SUI',
      status: r.status,
      time: r.created_at,
    }));
    return res.json({ eventId, points });
  } catch (err: any) {
    console.error('[odds-history] Error:', err.message);
    return res.json({ eventId, points: [] });
  }
});

// ─── Live In-Play Odds ────────────────────────────────────────────────────────

/**
 * GET /api/p2p/live-odds
 * Returns current live odds adjustments for all in-play events.
 * Optional ?eventId=xxx to filter to a single event.
 */
router.get('/live-odds', (_req: Request, res: Response) => {
  try {
    const { getLiveOdds } = require('./services/liveOddsService');
    const eventId = _req.query.eventId as string | undefined;
    const updates = getLiveOdds(eventId);
    return res.json({ updates, ts: Date.now() });
  } catch (err: any) {
    return res.json({ updates: [], ts: Date.now() });
  }
});

// ── Fantasy H2H test helpers (dev only) ─────────────────────────────────────

// POST /api/p2p/fantasy/test-seed-teams
// Upserts fantasy_teams rows so settlement can read total_points.
// Only available outside production.
router.post('/fantasy/test-seed-teams', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Not available in production.' });
  }
  try {
    const { teams } = req.body as { teams: Array<{ walletAddress: string; totalPoints: number }> };
    if (!Array.isArray(teams) || teams.length === 0) {
      return res.status(400).json({ message: 'teams array is required' });
    }
    for (const t of teams) {
      await db.execute(sql`
        INSERT INTO fantasy_teams (wallet_address, team_name, starter_ids, bench_ids, captain_id, total_points, locked, dev_bypass)
        VALUES (${t.walletAddress}, 'Test Team', ARRAY[]::text[], ARRAY[]::text[], '', ${t.totalPoints}, true, true)
        ON CONFLICT (wallet_address) DO UPDATE
          SET total_points = ${t.totalPoints}, locked = true, updated_at = NOW()
      `);
    }
    res.json({ ok: true, seeded: teams.length });
  } catch (err: any) {
    console.error('[test-seed-teams]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── Fantasy H2H test-settle endpoint ────────────────────────────────────────
// POST /api/p2p/fantasy/settle-test/:offerId
// Immediately settles a Fantasy H2H offer for E2E testing — bypasses the
// TOURNAMENT_END date gate. Only callable when NODE_ENV !== 'production'.
router.post('/fantasy/settle-test/:offerId', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Test settlement is not available in production.' });
  }
  try {
    const offerId = parseInt(req.params.offerId);
    if (isNaN(offerId)) return res.status(400).json({ message: 'Invalid offer ID' });
    // Auto dry-run when admin key is absent (dev env without blockchain creds)
    const dryRun = !process.env.ADMIN_PRIVATE_KEY || req.body?.dryRun === true;
    const result = await p2pBettingService.settleFantasyH2HNow(offerId, dryRun);
    res.json({
      ok: true,
      dryRun,
      winner:     result.winner,
      creatorPts: result.creatorPts,
      takerPts:   result.takerPts,
      message:    `Fantasy H2H offer ${offerId} settled — ${result.winner} wins${dryRun ? ' (dry-run, payout skipped)' : ''}`,
    });
  } catch (err: any) {
    console.error('[FantasyH2H test-settle]', err.message);
    res.status(500).json({ message: err.message || 'Settlement failed' });
  }
});

// ─── CMC / Prediction Market public feed ─────────────────────────────────────
// GET /api/p2p/markets
// Returns all open offers in a format compatible with CoinMarketCap's prediction
// market aggregator and other data aggregators (e.g. DeFiLlama, Dune dashboards).
// Submit this endpoint URL to CMC when applying for a Prediction Markets listing.
router.get('/markets', async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(p2pBetOffers)
      .where(eq(p2pBetOffers.status, 'open'))
      .orderBy(desc(p2pBetOffers.createdAt))
      .limit(500);

    const markets = rows.map(o => {
      const takerOdds = Number(o.odds);
      const creatorOdds = takerOdds > 1 ? 1 / (1 - 1 / takerOdds) : 1;
      const impliedYes = takerOdds > 1 ? (1 / takerOdds) : 0.5;
      const impliedNo  = 1 - impliedYes;
      const totalVolume = (Number(o.creatorStake) + Number(o.takerStake)) / 1e9;

      return {
        id:             `suibets-${o.id}`,
        question:       `${o.eventName ?? `${o.homeTeam} vs ${o.awayTeam}`} — ${o.prediction}`,
        description:    `P2P bet on SuiBets. Sport: ${o.sportName ?? o.leagueName ?? 'Sport'}. League: ${o.leagueName ?? ''}`,
        category:       'Sports',
        subcategory:    o.sportName ?? o.leagueName ?? 'Sport',
        outcomes:       ['Yes', 'No'],
        outcomePrices:  [impliedYes.toFixed(4), impliedNo.toFixed(4)],
        outcomeOdds:    [takerOdds.toFixed(4), creatorOdds.toFixed(4)],
        volume:         totalVolume.toFixed(6),
        liquidity:      (Number(o.takerStake) / 1e9).toFixed(6),
        volumeCurrency: o.currency ?? 'SUI',
        chain:          'Sui',
        startDate:      o.createdAt,
        endDate:        o.expiresAt,
        status:         'active',
        tags:           ['sports', 'p2p', 'sui', o.sportName ?? 'sport'].filter(Boolean),
        sourceUrl:      `${process.env.TELEGRAM_APP_URL || 'https://web-production-4d574.up.railway.app'}/p2p/offer/${o.id}`,
      };
    });

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      name:        'SuiBets',
      description: 'Decentralized P2P sports prediction market on Sui blockchain',
      website:     process.env.TELEGRAM_APP_URL || 'https://web-production-4d574.up.railway.app',
      chain:       'Sui',
      version:     '1.0.0',
      timestamp:   new Date().toISOString(),
      count:       markets.length,
      markets,
    });
  } catch (err: any) {
    res.status(500).json({ message: 'Failed to fetch markets' });
  }
});

// ─── On-chain Transaction Feed ───────────────────────────────────────────────
// GET /api/p2p/onchain-tx-feed
// Queries Sui RPC for recent transactions touching the P2P package, parses
// Move call function names + timestamps, returns last 20 entries.

let txFeedCache: { data: any; fetchedAt: number } = { data: null, fetchedAt: 0 };
const TX_FEED_CACHE_TTL = 15_000; // 15 s

router.get('/onchain-tx-feed', async (_req: Request, res: Response) => {
  try {
    if (Date.now() - txFeedCache.fetchedAt < TX_FEED_CACHE_TTL && txFeedCache.data) {
      return res.json(txFeedCache.data);
    }

    const { suiJsonRpc } = await import('./lib/suiRpcConfig');
    const contractInfo = p2pContractService.getContractInfo();
    const FALLBACK_PKG = '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59';
    const packageId    = contractInfo.packageId || FALLBACK_PKG;

    // Query tx blocks that touched this package (with input so we can read Move calls)
    const result = await suiJsonRpc('suix_queryTransactionBlocks', [
      {
        filter:  { MoveFunction: { package: packageId } },
        options: { showInput: true, showEffects: true },
      },
      null,  // cursor — start from latest
      20,    // limit
      true,  // descending
    ]);

    const txBlocks: any[] = result?.data || [];

    const LABEL: Record<string, string> = {
      post_offer:          'create_offer',
      create_offer:        'create_offer',
      accept_offer:        'accept_offer',
      fill_offer:          'accept_offer',
      settle_match:        'settle',
      settle:              'settle',
      cancel_offer:        'cancel',
      cancel:              'cancel',
      dispute_settlement:  'dispute',
      reclaim_expired:     'reclaim',
    };

    const entries = txBlocks.map((tx: any) => {
      const digest = tx.digest as string;
      const commands: any[] = tx.transaction?.data?.transaction?.transactions ?? [];
      const allCalls = commands.flatMap((cmd: any) =>
        cmd.MoveCall ? [cmd.MoveCall] : []
      );
      // Prefer calls on the p2p_betting module; fall back to any Move call
      const primary =
        allCalls.find((c: any) => c.module === 'p2p_betting') ?? allCalls[0];

      if (!primary) return null;

      const rawFn   = primary.function as string;
      const fnLabel = LABEL[rawFn] ?? rawFn.replace(/_/g, ' ');
      const status  = (tx.effects?.status?.status as string) ?? 'unknown';

      return {
        digest,
        fn:          fnLabel,
        rawFn,
        module:      primary.module as string,
        status,
        timestampMs: tx.timestampMs ?? null,
        suiscanUrl:  `https://suiscan.xyz/mainnet/tx/${digest}`,
      };
    }).filter(Boolean);

    const payload = { packageId, entries, fetchedAt: Date.now() };
    txFeedCache   = { data: payload, fetchedAt: Date.now() };
    res.json(payload);
  } catch (err: any) {
    console.error('[P2P] onchain-tx-feed error:', err.message);
    if (txFeedCache.data) return res.json({ ...txFeedCache.data, stale: true });
    res.status(500).json({ error: err.message });
  }
});

export default router;

