import { db } from '../db';
import { p2pBetOffers, p2pBetMatches, p2pParlayOffers, p2pParlayLegs, settledEvents, p2pVolumeStats } from '@shared/schema';
import { eq, and, or, inArray, lt, gt, sql, isNull } from 'drizzle-orm';
import blockchainBetService from './blockchainBetService';
import { p2pContractService, ONCHAIN_STATUS } from './p2pContractService';
import { wsService } from './websocketService';
import { revenueTrackerService } from './revenueTrackerService';
import { espnSportsService } from './espnSportsService';
import { getSuiClient, suiJsonRpc } from '../lib/suiRpcConfig';
import { storeBetReceipt } from './walrusStorageService';
import { computeFantasyH2HMarketPoints } from './fantasyScoring';

// ─── HIP-4 Inspired Volume Fee Tiers ─────────────────────────────────────────
// Makers (offer creators) earn rebates for providing liquidity at high volume.
// Takers (offer acceptors) pay fees that decrease as their trading volume grows.
// Net fee = takerFee - makerRebate. Platform revenue = net fee collected.
//
// Volume thresholds are lifetime P2P traded volume in SUI (or SBETS SUI-equiv).
//
// Tier      | Min Volume | Maker Rebate | Taker Fee
// ──────────┼────────────┼──────────────┼──────────
// Bronze    |     0      |    0.00%     |   2.00%
// Silver    |   100      |    0.00%     |   1.50%
// Gold      |  1,000     |    0.10%     |   1.00%
// Diamond   | 10,000     |    0.20%     |   0.75%
// Elite     | 100,000    |    0.30%     |   0.50%

export const VOLUME_TIERS = [
  { name: 'Bronze',  minVolume: 0,       makerRebate: 0,      takerFee: 0.0200, color: '#CD7F32' },
  { name: 'Silver',  minVolume: 100,     makerRebate: 0,      takerFee: 0.0150, color: '#C0C0C0' },
  { name: 'Gold',    minVolume: 1000,    makerRebate: 0.0010, takerFee: 0.0100, color: '#FFD700' },
  { name: 'Diamond', minVolume: 10000,   makerRebate: 0.0020, takerFee: 0.0075, color: '#B9F2FF' },
  { name: 'Elite',   minVolume: 100000,  makerRebate: 0.0030, takerFee: 0.0050, color: '#FF00FF' },
] as const;

export function getVolumeTier(volume: number) {
  for (let i = VOLUME_TIERS.length - 1; i >= 0; i--) {
    if (volume >= VOLUME_TIERS[i].minVolume) return VOLUME_TIERS[i];
  }
  return VOLUME_TIERS[0];
}

// ─── Payout Math (fully documented) ──────────────────────────────────────────
//
// SINGLE OFFER:
//   Creator sets odds X and stakes Y.
//   takerStake = Y * (X - 1)
//   For a partial fill S (taker stake in this match, S ≤ takerStake):
//     creatorEquiv = S / (X - 1)        ← creator's share at risk for this match
//     grossPot     = S + creatorEquiv   = S * X / (X - 1)
//     takerFee     = grossPot * takerFeeRate
//     makerRebate  = grossPot * makerRebateRate
//     netFee       = takerFee - makerRebate   (platform revenue)
//     winnerPayout = grossPot - netFee
//
// PARLAY:
//   Creator stakes Y on all legs winning; taker stakes Y*(totalOdds-1).
//   grossPot     = Y + Y*(totalOdds-1) = Y * totalOdds
//   Fee calculated same way using winner's tier.
//   Creator wins if ALL legs win; taker wins if ANY leg fails.

export function calcSingleMatchPayout(params: {
  takerStake: number;
  offerOdds: number;
  offerCreatorStake: number;
  offerTakerStake: number;
  takerFeeRate: number;
  makerRebateRate: number;
}) {
  const { takerStake: S, offerOdds: X, offerCreatorStake: Y, takerFeeRate, makerRebateRate } = params;
  // Guard against zero/null takerStake to avoid division by zero.
  // Fall back to deriving takerStake from creatorStake × (odds - 1).
  const offerTakerStake = (params.offerTakerStake && params.offerTakerStake > 0)
    ? params.offerTakerStake
    : round3(Y * Math.max(X - 1, 0.0001));
  const creatorEquiv = Y * (S / offerTakerStake);
  const grossPot = round3(S + creatorEquiv);
  const takerFeeAmt = round3(grossPot * takerFeeRate);
  const makerRebateAmt = round3(grossPot * makerRebateRate);
  const netFee = round3(takerFeeAmt - makerRebateAmt);
  const winnerPayout = round3(grossPot - netFee);
  return { grossPot, takerFeeAmt, makerRebateAmt, netFee, winnerPayout };
}

export function calcParlayPayout(params: {
  creatorStake: number;
  takerStake: number;
  takerFeeRate: number;
  makerRebateRate: number;
}) {
  const { creatorStake, takerStake, takerFeeRate, makerRebateRate } = params;
  const grossPot = round3(creatorStake + takerStake);
  const takerFeeAmt = round3(grossPot * takerFeeRate);
  const makerRebateAmt = round3(grossPot * makerRebateRate);
  const netFee = round3(takerFeeAmt - makerRebateAmt);
  const winnerPayout = round3(grossPot - netFee);
  return { grossPot, takerFeeAmt, makerRebateAmt, netFee, winnerPayout };
}

function round3(n: number) { return Math.round(n * 1000) / 1000; }

// ── Walrus archival + checkpoint proof (fire-and-forget after settlement) ──────
async function archiveMatchReceipt(
  matchId: number,
  offer: any,
  match: any,
  winnerWallet: string,
  winnerPayout: number,
  txHash?: string,
): Promise<void> {
  try {
    // 1. Get Sui checkpoint sequence for this settlement TX
    let checkpointSeq: string | undefined;
    if (txHash) {
      try {
        const txBlock = await suiJsonRpc('sui_getTransactionBlock', [txHash, { showEffects: false }]);
        if (txBlock?.checkpoint) checkpointSeq = String(txBlock.checkpoint);
      } catch { /* non-blocking */ }
    }

    // 2. Archive immutable receipt to Walrus
    const receipt = await storeBetReceipt({
      betId:          `p2p-match-${matchId}`,
      walletAddress:  winnerWallet,
      eventId:        offer.eventId,
      eventName:      offer.eventName,
      homeTeam:       offer.homeTeam,
      awayTeam:       offer.awayTeam,
      prediction:     offer.prediction,
      odds:           offer.odds,
      stake:          match.stake ?? 0,
      currency:       offer.currency ?? 'SUI',
      potentialPayout: winnerPayout,
      txHash,
      placedAt:       match.createdAt?.getTime() ?? Date.now(),
      sportName:      offer.sportName ?? undefined,
      marketType:     offer.marketType ?? undefined,
    });

    // 3. Persist blob ID + checkpoint to DB
    // Always save a blob ID — use local_ fallback if Walrus upload failed,
    // consistent with regular bets so the retry worker can surface these.
    const updates: Record<string, any> = {};
    updates.walrusBlobId = receipt.blobId || (receipt.receiptHash ? `local_${receipt.receiptHash}` : null);
    if (receipt.receiptJson) updates.walrusReceiptJson = receipt.receiptJson;
    if (checkpointSeq)       updates.checkpointSeq     = checkpointSeq;

    if (Object.keys(updates).length > 0) {
      await db.update(p2pBetMatches).set(updates).where(eq(p2pBetMatches.id, matchId));
    }

    if (receipt.blobId) {
      console.log(`[P2P] 🐋 Walrus receipt: match #${matchId} → ${receipt.blobId.slice(0, 20)}…`);
    }
    if (checkpointSeq) {
      console.log(`[P2P] 🔍 Checkpoint: match #${matchId} @ #${checkpointSeq}`);
    }
  } catch (err: any) {
    console.warn(`[P2P] archiveMatchReceipt failed for #${matchId}:`, err.message);
  }
}
function round6(n: number) { return Math.round(n * 1000000) / 1000000; }

// ─── Normalisation helpers ───────────────────────────────────────────────────

function normalisePrediction(pred: string, homeTeam: string, awayTeam: string): string {
  const p = pred.toLowerCase().trim();
  if (p === 'home' || p === homeTeam.toLowerCase()) return 'home';
  if (p === 'away' || p === awayTeam.toLowerCase()) return 'away';
  if (p === 'draw' || p === 'x' || p === 'tie') return 'draw';
  return p;
}

function predictionWon(
  prediction: string,
  homeTeam: string,
  awayTeam: string,
  winner: string,
  homeScore?: number,
  awayScore?: number,
): boolean {
  const norm = normalisePrediction(prediction, homeTeam, awayTeam);

  // ── Standard match-winner ──────────────────────────────────────────────────
  if (norm === 'home' || norm === 'away' || norm === 'draw') {
    return norm === winner;
  }

  // ── Over / Under total goals ───────────────────────────────────────────────
  // Prediction format: "over_1.5" or "under_2.5"
  const ouMatch = norm.match(/^(over|under)_([\d.]+)$/);
  if (ouMatch) {
    const line = parseFloat(ouMatch[2]);
    const total = (homeScore ?? 0) + (awayScore ?? 0);
    return ouMatch[1] === 'over' ? total > line : total < line;
  }

  // ── Both Teams to Score ────────────────────────────────────────────────────
  if (norm === 'btts_yes') return (homeScore ?? 0) > 0 && (awayScore ?? 0) > 0;
  if (norm === 'btts_no')  return (homeScore ?? 0) === 0 || (awayScore ?? 0) === 0;

  // ── Double Chance ──────────────────────────────────────────────────────────
  if (norm === 'home_or_draw') return winner === 'home' || winner === 'draw';
  if (norm === 'away_or_draw') return winner === 'away' || winner === 'draw';
  if (norm === 'home_or_away') return winner === 'home' || winner === 'away';

  // ── Asian Handicap ─────────────────────────────────────────────────────────
  // Prediction format: "home_-1.5", "away_+0.5", etc.
  // A handicap of H means: (side's goals + H) > opponent's goals
  const hcapMatch = norm.match(/^(home|away)_([-+]?[\d.]+)$/);
  if (hcapMatch) {
    const side = hcapMatch[1];
    const hcap = parseFloat(hcapMatch[2]);
    const hs = homeScore ?? 0;
    const as_ = awayScore ?? 0;
    if (side === 'home') return hs + hcap > as_;
    else                 return as_ + hcap > hs;
  }

  // ── Correct Score ──────────────────────────────────────────────────────────
  // Prediction format: "score_1-0", "score_2-1", "score_0-0", etc.
  const correctScoreMatch = norm.match(/^score_(\d+)-(\d+)$/);
  if (correctScoreMatch) {
    const predH = parseInt(correctScoreMatch[1], 10);
    const predA = parseInt(correctScoreMatch[2], 10);
    return (homeScore ?? 0) === predH && (awayScore ?? 0) === predA;
  }

  // ── Clean Sheet ────────────────────────────────────────────────────────────
  // cs_home = home team keeps clean sheet (away scores 0)
  // cs_away = away team keeps clean sheet (home scores 0)
  if (norm === 'cs_home') return (awayScore ?? 0) === 0;
  if (norm === 'cs_away') return (homeScore ?? 0) === 0;

  // ── Half-Time Result ───────────────────────────────────────────────────────
  // Settled from winner field when prefixed ht_; requires HT winner context.
  // If the settled event carries a half-time winner, it is passed through as winner
  // with a "ht_" prefix by the settlement worker.
  if (norm === 'ht_home') return winner === 'ht_home' || winner === 'home';
  if (norm === 'ht_draw') return winner === 'ht_draw' || winner === 'draw';
  if (norm === 'ht_away') return winner === 'ht_away' || winner === 'away';

  // Fallback: treat as match-winner for forward-compat
  return norm === winner;
}

// ─── Volume tracking ─────────────────────────────────────────────────────────

async function getWalletVolume(wallet: string): Promise<number> {
  // Rolling 90-day window — rewards recent active users over stale lifetime totals
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN creator_wallet = ${wallet} THEN creator_stake ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN taker_wallet   = ${wallet} THEN stake         ELSE 0 END), 0) AS vol
      FROM (
        SELECT creator_wallet, creator_stake::float, NULL::text AS taker_wallet, 0::float AS stake
        FROM p2p_bet_offers
        WHERE creator_wallet = ${wallet}
          AND status IN ('settled','matched','filled','cancelled')
          AND created_at >= NOW() - INTERVAL '90 days'
        UNION ALL
        SELECT NULL, 0, taker_wallet, stake::float
        FROM p2p_bet_matches m
        JOIN p2p_bet_offers o ON o.id = m.offer_id
        WHERE m.taker_wallet = ${wallet}
          AND m.created_at >= NOW() - INTERVAL '90 days'
        UNION ALL
        SELECT creator_wallet, creator_stake::float, NULL, 0
        FROM p2p_parlay_offers
        WHERE creator_wallet = ${wallet}
          AND status IN ('settled','matched','filled','cancelled')
          AND created_at >= NOW() - INTERVAL '90 days'
      ) sub
    `);
    const rows = (result as any).rows ?? result;
    return Number(rows[0]?.vol ?? 0);
  } catch {
    // Fallback to lifetime totals if 90-day query fails (e.g. missing columns)
    const [stats] = await db.select().from(p2pVolumeStats).where(eq(p2pVolumeStats.walletAddress, wallet));
    if (!stats) return 0;
    return (stats.totalVolumeMaker ?? 0) + (stats.totalVolumeTaker ?? 0);
  }
}

async function upsertVolumeStats(wallet: string, delta: {
  volumeMaker?: number;
  volumeTaker?: number;
  bets?: number;
  won?: number;
  lost?: number;
  pnl?: number;
}) {
  try {
    const existing = await db.select().from(p2pVolumeStats).where(eq(p2pVolumeStats.walletAddress, wallet));
    if (existing.length === 0) {
      await db.insert(p2pVolumeStats).values({
        walletAddress: wallet,
        totalVolumeMaker: delta.volumeMaker ?? 0,
        totalVolumeTaker: delta.volumeTaker ?? 0,
        totalBets: delta.bets ?? 0,
        wonBets: delta.won ?? 0,
        lostBets: delta.lost ?? 0,
        totalNetPnl: delta.pnl ?? 0,
        lastUpdated: new Date(),
      });
    } else {
      await db.update(p2pVolumeStats).set({
        totalVolumeMaker: sql`COALESCE(total_volume_maker, 0) + ${delta.volumeMaker ?? 0}`,
        totalVolumeTaker: sql`COALESCE(total_volume_taker, 0) + ${delta.volumeTaker ?? 0}`,
        totalBets: sql`COALESCE(total_bets, 0) + ${delta.bets ?? 0}`,
        wonBets: sql`COALESCE(won_bets, 0) + ${delta.won ?? 0}`,
        lostBets: sql`COALESCE(lost_bets, 0) + ${delta.lost ?? 0}`,
        totalNetPnl: sql`COALESCE(total_net_pnl, 0) + ${delta.pnl ?? 0}`,
        lastUpdated: new Date(),
      }).where(eq(p2pVolumeStats.walletAddress, wallet));
    }
  } catch (err: any) {
    console.warn('[P2P] Volume stat update failed (non-fatal):', err.message);
  }
}

// ─── Main Service ─────────────────────────────────────────────────────────────

class P2PBettingService {
  private settlementRunning   = false;
  private settlementStartedAt: number | null = null;
  private _expiryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Schedule a one-shot settlement run exactly when an offer/parlay expires.
   * key format: "offer:N" or "parlay:N"
   * This eliminates the up-to-5-minute lag from the polling interval.
   */
  private scheduleExpiryAt(key: string, expiresAt: Date) {
    const existing = this._expiryTimers.get(key);
    if (existing) clearTimeout(existing);

    const msUntilExpiry = expiresAt.getTime() - Date.now();
    if (msUntilExpiry <= 0) {
      // Already expired — run settlement immediately (non-blocking)
      this.runSettlement().catch((e: any) =>
        console.error('[P2P] Immediate expiry settlement error:', e.message)
      );
      return;
    }
    // Node.js setTimeout max ~24.8 days; cap at 24 h and reschedule if farther
    const MAX_MS = 24 * 3600 * 1000;
    const delayMs = Math.min(msUntilExpiry, MAX_MS);
    const timer = setTimeout(() => {
      this._expiryTimers.delete(key);
      if (msUntilExpiry > MAX_MS) {
        // Reschedule for the remaining time
        this.scheduleExpiryAt(key, expiresAt);
      } else {
        console.log(`[P2P] ⏰ Exact-time expiry firing for ${key}`);
        this.runSettlement().catch((e: any) =>
          console.error('[P2P] Expiry settlement error:', e.message)
        );
      }
    }, delayMs);
    this._expiryTimers.set(key, timer);
  }

  /** On startup, schedule exact-time timers for all still-open offers and parlays.
   *  Fires at the EARLIER of match_date and expires_at — ensures that as soon as a
   *  match kicks off, the offer is immediately auto-expired (no 5-minute polling lag). */
  private async scheduleAllActiveExpiries() {
    try {
      const [activeOffers, activeParlays] = await Promise.all([
        db.execute(sql`
          SELECT id, expires_at, match_date FROM p2p_bet_offers
          WHERE status IN ('open', 'partial')
            AND expires_at > NOW()
            AND (match_date IS NULL OR match_date > NOW())
        `),
        db.execute(sql`
          SELECT id, expires_at FROM p2p_parlay_offers
          WHERE status IN ('open', 'partial') AND expires_at > NOW()
        `),
      ]);
      const offerRows  = (activeOffers  as any).rows ?? (activeOffers  as any);
      const parlayRows = (activeParlays as any).rows ?? (activeParlays as any);
      for (const row of offerRows) {
        // Use the EARLIER of match_date and expires_at so kickoff triggers immediate expiry
        const expiresAt  = new Date(row.expires_at);
        const matchDate  = row.match_date ? new Date(row.match_date) : null;
        const triggerAt  = matchDate && matchDate < expiresAt ? matchDate : expiresAt;
        this.scheduleExpiryAt(`offer:${row.id}`, triggerAt);
      }
      for (const row of parlayRows) this.scheduleExpiryAt(`parlay:${row.id}`, new Date(row.expires_at));
      if (offerRows.length + parlayRows.length > 0) {
        console.log(`[P2P] ⏰ Scheduled exact-time expiry for ${offerRows.length} offer(s) and ${parlayRows.length} parlay(s) (triggers at kickoff or expiry, whichever is earlier)`);
      }
    } catch (err: any) {
      console.warn('[P2P] scheduleAllActiveExpiries error (non-fatal):', err.message);
    }
  }

  // ─── Single Bet Offers ──────────────────────────────────────────────────────

  async createOffer(params: {
    creatorWallet: string;
    eventId: string;
    eventName: string;
    homeTeam: string;
    awayTeam: string;
    leagueName?: string;
    sportName?: string;
    matchDate?: Date;
    prediction: string;
    marketType?: string;
    odds: number;
    creatorStake: number;
    currency: string;
    creatorTxHash?: string;
    expiresAt: Date;
    onchainOfferId?: string;
    onchainConfigId?: string;
    // Sui-native feature extensions
    suinsGated?: boolean;
    liveOdds?: boolean;
    // Live in-play anti-exploit
    scoreSnapshot?: string;
    matchMinute?: number;
  }) {
    const takerStake = round3(params.creatorStake * (params.odds - 1));
    // Auto-generate a unique share token for zkSend challenge links
    const { randomUUID } = await import('crypto');
    const shareToken = randomUUID();
    const [offer] = await db.insert(p2pBetOffers).values({
      creatorWallet: params.creatorWallet,
      eventId: params.eventId,
      eventName: params.eventName,
      homeTeam: params.homeTeam,
      awayTeam: params.awayTeam,
      leagueName: params.leagueName,
      sportName: params.sportName,
      matchDate: params.matchDate,
      prediction: params.prediction,
      marketType: params.marketType ?? 'match_winner',
      odds: params.odds,
      creatorStake: params.creatorStake,
      takerStake,
      currency: params.currency,
      status: 'open',
      creatorTxHash: params.creatorTxHash,
      expiresAt: params.expiresAt,
      onchainOfferId: params.onchainOfferId,
      onchainConfigId: params.onchainConfigId,
      shareToken,
      suinsGated: params.suinsGated ?? false,
      liveOdds: params.liveOdds ?? false,
      scoreSnapshot: params.scoreSnapshot ?? null,
      matchMinute: params.matchMinute ?? null,
    }).returning();

    // Note: maker volume is tracked at match-fill time (acceptOffer), not at creation,
    // to prevent volume-tier farming via post-and-cancel.

    // Schedule expiry at the EARLIER of match kickoff and the user's chosen expiry window.
    // This ensures offers are auto-expired at kickoff even if the user chose a long window.
    const triggerAt = params.matchDate && params.matchDate < params.expiresAt
      ? params.matchDate
      : params.expiresAt;
    this.scheduleExpiryAt(`offer:${offer.id}`, triggerAt);
    return offer;
  }

  /**
   * startLiveScoreWatcher
   * Runs every 30 seconds. For every unaccepted live offer (liveOdds=true, status open/partial),
   * checks the current score against the stored snapshot. If the score changed (goal scored),
   * the offer is auto-cancelled so neither side can exploit stale odds.
   */
  startLiveScoreWatcher() {
    const { apiSportsService } = require('./apiSportsService');
    const INTERVAL_MS = 30_000;
    const run = async () => {
      try {
        const rows = await db.execute(sql`
          SELECT id, event_id, score_snapshot
          FROM p2p_bet_offers
          WHERE live_odds = true
            AND status IN ('open', 'partial')
            AND expires_at > NOW()
        `);
        const offers = (rows as any).rows ?? (rows as any);
        if (!offers.length) return;
        for (const row of offers) {
          try {
            const check = apiSportsService.lookupEventSync(String(row.event_id));
            if (!check.found) continue;
            // If match is no longer live (final whistle) — let the settlement worker handle it
            if (!check.isLive) continue;
            const stored = row.score_snapshot as string | null;
            if (!stored) continue;
            const current = `${check.homeScore ?? 0}-${check.awayScore ?? 0}`;
            if (current !== stored) {
              console.log(`[P2P Live] 🔴 Goal! Offer #${row.id} voided (${stored} → ${current})`);
              await db.update(p2pBetOffers)
                .set({ status: 'cancelled' })
                .where(eq(p2pBetOffers.id, row.id));
            }
          } catch (err: any) {
            console.warn(`[P2P Live] Score watcher error for offer #${row.id}:`, err.message);
          }
        }
      } catch (err: any) {
        console.warn('[P2P Live] Score watcher run error (non-fatal):', err.message);
      }
    };
    setInterval(run, INTERVAL_MS);
    console.log('[P2P Live] ⚽ Live score watcher started — checks every 30s, voids offers on goal');
  }

  async listOpenOffers(filters?: { eventId?: string; sport?: string; currency?: string; limit?: number; status?: string; marketType?: string }) {
    const now = new Date();
    const statusFilter = filters?.status;

    // 'all' — return every offer regardless of status (used by the history view)
    // specific status string — filter to that one status exactly
    // default — only open/partial that haven't expired yet (the live order-book)
    // fantasy_h2h offers are season-long — skip the expiresAt gate for them
    const isFantasyH2H = filters?.marketType === 'fantasy_h2h';
    const statusCondition = statusFilter === 'all'
      ? undefined
      : statusFilter && statusFilter !== 'open'
        ? eq(p2pBetOffers.status, statusFilter as any)
        : isFantasyH2H
          ? sql`${p2pBetOffers.status} IN ('open', 'partial')`
          : and(
              sql`${p2pBetOffers.status} IN ('open', 'partial')`,
              gt(p2pBetOffers.expiresAt, now),
              // Hide offers where the match has already kicked off — even if
              // expires_at is still in the future, a started match can't be bet on.
              or(
                isNull(p2pBetOffers.matchDate),
                gt(p2pBetOffers.matchDate, now),
              ),
            );

    const rows = await db.select().from(p2pBetOffers)
      .where(and(
        statusCondition,
        filters?.currency   ? eq(p2pBetOffers.currency,   filters.currency)   : undefined,
        filters?.eventId    ? eq(p2pBetOffers.eventId,    filters.eventId)    : undefined,
        filters?.sport      ? eq(p2pBetOffers.sportName,  filters.sport)      : undefined,
        filters?.marketType ? eq(p2pBetOffers.marketType as any, filters.marketType) : undefined,
      ))
      // Best-odds routing: sort by highest odds DESC for the taker (better deal first),
      // then by creation time DESC as tiebreaker so older orders surface if odds are equal.
      .orderBy(sql`${p2pBetOffers.odds} DESC, ${p2pBetOffers.createdAt} DESC`)
      .limit(filters?.limit ?? 200);
    return rows;
  }

  async getOffer(offerId: number) {
    const [offer] = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.id, offerId));
    return offer;
  }

  async getOfferWithMatches(offerId: number) {
    const [offer] = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.id, offerId));
    if (!offer) return null;
    const matches = await db.select().from(p2pBetMatches).where(eq(p2pBetMatches.offerId, offerId));
    return { ...offer, matches };
  }

  // ─── ATOMIC ACCEPT — race-condition-free, duplicate-taker-proof ──────────────
  // Single SQL UPDATE WHERE status='open' AND NOT EXISTS duplicate match so two
  // concurrent requests from the same taker cannot both succeed. The first one
  // atomically claims the fill; the second gets 0 rows and throws immediately.

  async acceptOffer(params: {
    offerId: number;
    takerWallet: string;
    stake: number;
    takerTxHash?: string;
  }) {
    if (params.stake < 0.0001) throw new Error('Stake too small (minimum 0.0001)');

    // Atomically claim the fill — prevents double-accept, same-taker duplicates,
    // and accepting against an offer where the creator never deposited funds
    // (creator_tx_hash IS NOT NULL guards against free-money exploit on custodial offers:
    //  without it a creator could post an offer without depositing, win the event,
    //  and collect the taker's stake while never having funds at risk themselves).
    const atomicResult = await db.execute(sql`
      UPDATE p2p_bet_offers
      SET
        filled_stake = COALESCE(filled_stake, 0) + ${params.stake},
        status = CASE
          WHEN COALESCE(filled_stake, 0) + ${params.stake} >= taker_stake - 0.0001 THEN 'filled'
          ELSE 'partial'
        END
      WHERE id = ${params.offerId}
        AND status IN ('open', 'partial')
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (match_date IS NULL OR match_date > NOW())
        AND creator_wallet != ${params.takerWallet}
        AND taker_stake - COALESCE(filled_stake, 0) >= ${params.stake} - 0.0001
        AND (creator_tx_hash IS NOT NULL OR onchain_offer_id IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM p2p_bet_matches
          WHERE offer_id = ${params.offerId}
            AND taker_wallet = ${params.takerWallet}
        )
      RETURNING *
    `);

    const updatedRows = (atomicResult as any).rows ?? (atomicResult as any);
    if (!updatedRows || updatedRows.length === 0) {
      // Diagnose the failure reason for a clean user-facing error
      const offer = await this.getOffer(params.offerId);
      if (!offer) throw new Error('Offer not found');
      if (offer.creatorWallet === params.takerWallet) throw new Error('Cannot accept your own offer');
      // Check for duplicate taker
      const dupCheck = await db.execute(sql`
        SELECT 1 FROM p2p_bet_matches
        WHERE offer_id = ${params.offerId} AND taker_wallet = ${params.takerWallet}
        LIMIT 1
      `);
      const dupRows = (dupCheck as any).rows ?? (dupCheck as any);
      if (Array.isArray(dupRows) && dupRows.length > 0) {
        throw new Error('You have already placed a bet on this offer');
      }
      if (offer.status === 'filled') throw new Error('This offer was just accepted by someone else');
      if (offer.status !== 'open' && offer.status !== 'partial') throw new Error(`Offer is no longer available (${offer.status})`);
      const remaining = round3((offer.takerStake ?? 0) - (offer.filledStake ?? 0));
      throw new Error(`Stake too large. Max remaining: ${remaining} ${offer.currency}`);
    }

    const offer = updatedRows[0];
    const offerId = offer.id ?? params.offerId;
    const offerOdds = offer.odds;
    const offerCreatorStake = offer.creator_stake ?? offer.creatorStake;
    const offerTakerStake = offer.taker_stake ?? offer.takerStake;
    const currency = offer.currency ?? 'SUI';
    const creatorWallet = offer.creator_wallet ?? offer.creatorWallet;

    // Resolve fee tiers for both sides
    const [creatorVolume, takerVolume] = await Promise.all([
      getWalletVolume(creatorWallet),
      getWalletVolume(params.takerWallet),
    ]);
    const creatorTier = getVolumeTier(creatorVolume);
    const takerTier = getVolumeTier(takerVolume);

    const { grossPot, takerFeeAmt, makerRebateAmt, netFee, winnerPayout } = calcSingleMatchPayout({
      takerStake: params.stake,
      offerOdds,
      offerCreatorStake,
      offerTakerStake,
      takerFeeRate: takerTier.takerFee,
      makerRebateRate: creatorTier.makerRebate,
    });

    const [match] = await db.insert(p2pBetMatches).values({
      offerId,
      takerWallet: params.takerWallet,
      stake: params.stake,
      potentialPayout: grossPot,
      status: 'active',
      takerTxHash: params.takerTxHash,
      takerFeeRate: takerTier.takerFee,
      makerRebateRate: creatorTier.makerRebate,
      netFee,
      actualPayout: winnerPayout,
    }).returning();

    // If the offer was posted on-chain and the taker provided a txHash, extract the
    // P2PMatchedBet object ID created by accept_offer and store it for settlement.
    // Without this ID we cannot call instant_settle_bet (which requires a P2PMatchedBet).
    const onchainOfferId = offer.onchain_offer_id ?? offer.onchainOfferId;
    if (onchainOfferId && params.takerTxHash) {
      try {
        const suiClient = getSuiClient();
        const txBlock = await (suiClient as any).getTransactionBlock({
          digest: params.takerTxHash,
          options: { showObjectChanges: true },
        });
        const matchedBetChange = (txBlock?.objectChanges ?? []).find(
          (c: any) => c.type === 'created' && (c.objectType ?? '').includes('P2PMatchedBet')
        );
        if (matchedBetChange?.objectId) {
          await db.update(p2pBetMatches)
            .set({ onchainMatchId: matchedBetChange.objectId })
            .where(eq(p2pBetMatches.id, match.id));
          console.log(`[P2P] ✅ P2PMatchedBet ${matchedBetChange.objectId} linked to match ${match.id} (offer ${offerId})`);
        } else {
          console.log(`[P2P] ℹ️ No P2PMatchedBet in takerTxHash for match ${match.id} — will use custodial settlement`);
        }
      } catch (err: any) {
        console.warn(`[P2P] Could not extract P2PMatchedBet from takerTxHash ${params.takerTxHash}: ${err.message}`);
      }
    }

    // Track taker volume and lock in maker volume now that a fill has occurred.
    // safeOfferTakerStake guards against division by zero for legacy/edge-case offers.
    const safeOTS = (offerTakerStake && offerTakerStake > 0)
      ? offerTakerStake
      : round3(offerCreatorStake * Math.max(offerOdds - 1, 0.0001));
    await Promise.all([
      upsertVolumeStats(params.takerWallet, { volumeTaker: params.stake, bets: 1 }),
      upsertVolumeStats(creatorWallet, { volumeMaker: round3(offerCreatorStake * (params.stake / safeOTS)), bets: 0 }),
    ]);

    // ── DeepBook listing cleanup ──────────────────────────────────────────────
    // The creator's DeepBook order (if any) was posted from their own wallet.
    // Only the creator can cancel it — we cannot do it server-side.
    // It will expire naturally at the offer's expiry time (set when listed).
    // The fill listener will stop treating this offer as fillable once matched.

    return {
      ...match,
      grossPot,
      takerFeeAmt,
      makerRebateAmt,
      netFee,
      winnerPayout,
      takerTierName: takerTier.name,
      makerTierName: creatorTier.name,
    };
  }

  async cancelOffer(offerId: number, creatorWallet: string, cancelTxHash?: string) {
    // ── Security pre-flight ──────────────────────────────────────────────────
    // If the offer was posted via the Sui smart contract (has onchain_offer_id),
    // the maker MUST supply the cancel_offer transaction hash.  Without this
    // guard a user could: (1) call cancel_offer on-chain to reclaim escrow from
    // the contract, then (2) call this endpoint without cancelTxHash to also
    // trigger a legacy admin-wallet refund — a double-payout exploit.
    const precheck = await db.execute(sql`
      SELECT onchain_offer_id FROM p2p_bet_offers
      WHERE id = ${offerId} AND creator_wallet = ${creatorWallet}
    `);
    const preRow = ((precheck as any).rows ?? (precheck as any))[0];
    if (!preRow) throw new Error('Offer not found or not your offer');
    if (preRow.onchain_offer_id && !cancelTxHash) {
      throw new Error(
        'This offer uses on-chain escrow — cancel it via the Sui contract and provide the cancelTxHash.'
      );
    }

    // ── Atomic cancel + refund-slot reservation ──────────────────────────────
    // We set refund_tx_hash = 'PENDING' in the same UPDATE that flips the
    // status.  This closes the race window where processAllPendingRefunds or
    // retryOfferRefund could see status='cancelled' + refund_tx_hash IS NULL
    // and dispatch a second refund before we record the first one.
    const placeholderHash = cancelTxHash ?? 'PENDING';
    const result = await db.execute(sql`
      UPDATE p2p_bet_offers
      SET status = 'cancelled',
          refund_tx_hash = ${placeholderHash}
      WHERE id = ${offerId}
        AND creator_wallet = ${creatorWallet}
        AND status IN ('open', 'partial')
        AND refund_tx_hash IS NULL
      RETURNING id, creator_stake, currency, creator_tx_hash
    `);
    const rows = (result as any).rows ?? (result as any);
    if (!rows || rows.length === 0) {
      const offer = await this.getOffer(offerId);
      if (!offer) throw new Error('Offer not found');
      if (offer.creatorWallet !== creatorWallet) throw new Error('Not your offer');
      throw new Error('Only open or partially-filled offers can be cancelled');
    }

    const row      = rows[0];
    const stake    = Number(row.creator_stake ?? 0);
    const currency = (row.currency ?? 'SUI').toUpperCase();
    let refundTx: string | undefined;

    if (cancelTxHash) {
      // On-chain cancel_offer was already executed by the maker — escrow returned
      // directly to their wallet.  refund_tx_hash was already written above.
      refundTx = cancelTxHash;
    } else {
      const hasFunds = !!row.creator_tx_hash && stake > 0;
      if (hasFunds) {
        // Legacy custodial escrow — admin wallet holds the funds.
        const refundResult = await this._sendRefund(creatorWallet, stake, currency, `cancelled offer #${offerId}`);
        if (refundResult.success && refundResult.txHash) {
          refundTx = refundResult.txHash;
          // Overwrite the 'PENDING' placeholder with the real tx hash.
          await db.execute(sql`
            UPDATE p2p_bet_offers SET refund_tx_hash = ${refundTx}
            WHERE id = ${offerId} AND refund_tx_hash = 'PENDING'
          `);
        } else {
          // Refund failed — clear the placeholder so admin retry tools can pick
          // this offer up again via processAllPendingRefunds / retryOfferRefund.
          await db.execute(sql`
            UPDATE p2p_bet_offers SET refund_tx_hash = NULL
            WHERE id = ${offerId} AND refund_tx_hash = 'PENDING'
          `);
        }
      } else {
        // No funds to refund (no creator_tx_hash or zero stake) — clear placeholder.
        await db.execute(sql`
          UPDATE p2p_bet_offers SET refund_tx_hash = NULL
          WHERE id = ${offerId} AND refund_tx_hash = 'PENDING'
        `);
      }
    }

    // Refund any active taker matches (partial fills) in the same currency
    await this._refundActiveTakerMatches(offerId, currency, `cancelled offer #${offerId}`);

    // ── DeepBook listing cleanup ──────────────────────────────────────────────
    // The creator's DeepBook order was posted from their own wallet — only they
    // can cancel it.  It will expire at the offer's expiry time set at listing.

    return { refundSent: true, refundTx };
  }

  /** Record an on-chain reclaim tx for a cancelled offer where the maker called cancel_offer themselves. */
  async recordReclaimTx(offerId: number, wallet: string, txHash: string): Promise<void> {
    // SECURITY: restrict to cancelled offers only.  Without the status guard an
    // attacker could call this on an OPEN offer to poison its refund_tx_hash
    // (blocking any future legitimate refund dispatch).
    //
    // Use RETURNING id so we can detect whether the UPDATE matched a row without
    // relying on rowCount (Drizzle's db.execute does not reliably expose rowCount).
    const result = await db.execute(sql`
      UPDATE p2p_bet_offers
      SET refund_tx_hash = ${txHash}
      WHERE id = ${offerId}
        AND creator_wallet = ${wallet}
        AND status = 'cancelled'
        AND refund_tx_hash IS NULL
      RETURNING id
    `);
    const rows = (result as any).rows ?? (result as any);
    if (!rows || rows.length === 0) {
      // No row matched — fetch to give a specific error.
      const check = await db.execute(sql`
        SELECT status, creator_wallet, refund_tx_hash
        FROM p2p_bet_offers WHERE id = ${offerId}
      `);
      const row = ((check as any).rows ?? (check as any))[0];
      if (!row) throw new Error('Offer not found');
      if (row.creator_wallet !== wallet) throw new Error('Not your offer');
      if (row.refund_tx_hash) throw new Error('Funds already recorded as reclaimed');
      if (row.status !== 'cancelled') throw new Error(`Cannot reclaim: offer is ${row.status}, not cancelled`);
      // Should not reach here, but fail loudly rather than silently.
      throw new Error('Reclaim update failed unexpectedly');
    }
  }

  /** Send refund for a cancelled offer that was never refunded (retroactive). */
  async refundCancelledOffer(offerId: number): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const offer = await this.getOffer(offerId);
    if (!offer) return { success: false, error: 'Offer not found' };
    if (offer.status !== 'cancelled') return { success: false, error: 'Offer is not cancelled' };
    if ((offer as any).refundTxHash) return { success: false, error: 'Already refunded' };
    if (!offer.creatorTxHash || !offer.creatorStake || offer.creatorStake <= 0) {
      return { success: false, error: 'No funds to refund (no tx hash or zero stake)' };
    }

    const currency = (offer.currency ?? 'SUI').toUpperCase();
    const refundResult = await this._sendRefund(offer.creatorWallet, offer.creatorStake, currency, `offer #${offerId}`);
    if (refundResult.success && refundResult.txHash) {
      await db.execute(sql`
        UPDATE p2p_bet_offers SET refund_tx_hash = ${refundResult.txHash} WHERE id = ${offerId}
      `);
    }
    return refundResult;
  }

  /** Process all cancelled offers/parlays that have funds but no refund yet. */
  async processAllPendingRefunds(): Promise<{ processed: number; succeeded: number; failed: number; details: any[] }> {
    const pendingOffers = await db.execute(sql`
      SELECT id, creator_wallet, creator_stake, currency, creator_tx_hash, status
      FROM p2p_bet_offers
      WHERE status IN ('cancelled', 'expired')
        AND creator_tx_hash IS NOT NULL
        AND refund_tx_hash IS NULL
        AND creator_stake > 0
    `);
    const pendingParlays = await db.execute(sql`
      SELECT id, creator_wallet, creator_stake, currency, creator_tx_hash, status
      FROM p2p_parlay_offers
      WHERE status IN ('cancelled', 'expired')
        AND creator_tx_hash IS NOT NULL
        AND refund_tx_hash IS NULL
        AND creator_stake > 0
    `);

    const offerRows = (pendingOffers as any).rows ?? (pendingOffers as any);
    const parlayRows = (pendingParlays as any).rows ?? (pendingParlays as any);
    const details: any[] = [];
    let succeeded = 0;
    let failed = 0;

    // Parallel refunds — each offer/parlay is independent, so we can fire all
    // at once. Promise.allSettled ensures one failure doesn't block the rest.
    const offerRefundJobs = offerRows.map(async (row: any) => {
      const stake = Number(row.creator_stake);
      const currency = (row.currency ?? 'SUI').toUpperCase();
      const refund = await this._sendRefund(row.creator_wallet, stake, currency, `offer #${row.id}`);
      if (refund.success && refund.txHash) {
        await db.execute(sql`UPDATE p2p_bet_offers SET refund_tx_hash = ${refund.txHash} WHERE id = ${row.id}`);
        succeeded++;
      } else {
        failed++;
      }
      details.push({ type: 'offer', id: row.id, wallet: row.creator_wallet, stake, currency, ...refund });
    });
    const parlayRefundJobs = parlayRows.map(async (row: any) => {
      const stake = Number(row.creator_stake);
      const currency = (row.currency ?? 'SUI').toUpperCase();
      const refund = await this._sendRefund(row.creator_wallet, stake, currency, `parlay #${row.id}`);
      if (refund.success && refund.txHash) {
        await db.execute(sql`UPDATE p2p_parlay_offers SET refund_tx_hash = ${refund.txHash} WHERE id = ${row.id}`);
        succeeded++;
      } else {
        failed++;
      }
      details.push({ type: 'parlay', id: row.id, wallet: row.creator_wallet, stake, currency, ...refund });
    });
    await Promise.allSettled([...offerRefundJobs, ...parlayRefundJobs]);

    return { processed: offerRows.length + parlayRows.length, succeeded, failed, details };
  }

  // ─── Individual Retry Refunds ──────────────────────────────────────────────
  // In-memory rate limiter: prevents rapid duplicate retries on the same item.
  // Key format: "offer:N" | "parlay:N" | "match:N" → last attempt timestamp (ms)
  private _refundRetryTimes: Map<string, number> = new Map();

  private _refundRateLimitOk(key: string, cooldownMs = 60_000): boolean {
    const last = this._refundRetryTimes.get(key);
    if (last && Date.now() - last < cooldownMs) return false;
    this._refundRetryTimes.set(key, Date.now());
    return true;
  }

  /**
   * Retry refunding a single cancelled/expired offer creator.
   * Double-payout protection:
   *  1. In-memory rate limit — 60 s cooldown per offer
   *  2. DB check: only proceeds if refund_tx_hash IS NULL (idempotent)
   *  3. Writes txHash immediately after blockchain send
   */
  async retryOfferRefund(offerId: number): Promise<{ success: boolean; txHash?: string; error?: string; skipped?: boolean }> {
    const key = `offer:${offerId}`;
    if (!this._refundRateLimitOk(key)) {
      return { success: false, skipped: true, error: 'Rate limited — please wait 60 s before retrying this offer' };
    }

    const rows = await db.execute(sql`
      SELECT id, creator_wallet, creator_stake, currency, creator_tx_hash, refund_tx_hash, status
      FROM p2p_bet_offers WHERE id = ${offerId}
    `);
    const r = ((rows as any).rows ?? (rows as any))[0];
    if (!r) return { success: false, error: 'Offer not found' };
    if (!['cancelled', 'expired'].includes(r.status)) return { success: false, error: `Not eligible: status='${r.status}'` };
    if (r.refund_tx_hash) return { success: false, skipped: true, error: 'Already refunded' };
    if (!r.creator_tx_hash || Number(r.creator_stake) <= 0) return { success: false, error: 'No funds to refund (no tx hash or zero stake)' };

    // CRITICAL: Never refund if this offer has settled matches (won/lost).
    // Those stakes were already consumed in winner payouts — refunding would be a double-payout.
    const settledCheck = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM p2p_bet_matches
      WHERE offer_id = ${offerId} AND status IN ('won', 'lost')
    `);
    const settledCnt = Number(((settledCheck as any).rows ?? (settledCheck as any))[0]?.cnt ?? 0);
    if (settledCnt > 0) {
      return { success: false, error: `Blocked: offer has ${settledCnt} settled match(es). Accepted bets are never refundable — winners already received their payouts.` };
    }

    const refund = await this._sendRefund(r.creator_wallet, Number(r.creator_stake), (r.currency ?? 'SUI').toUpperCase(), `retry offer #${offerId}`);
    if (refund.success && refund.txHash) {
      await db.execute(sql`UPDATE p2p_bet_offers SET refund_tx_hash = ${refund.txHash} WHERE id = ${offerId} AND refund_tx_hash IS NULL`);
    }
    return refund;
  }

  /** Retry refunding a single cancelled/expired parlay creator. Same protections as retryOfferRefund. */
  async retryParlayRefund(parlayId: number): Promise<{ success: boolean; txHash?: string; error?: string; skipped?: boolean }> {
    const key = `parlay:${parlayId}`;
    if (!this._refundRateLimitOk(key)) {
      return { success: false, skipped: true, error: 'Rate limited — please wait 60 s before retrying this parlay' };
    }

    const rows = await db.execute(sql`
      SELECT id, creator_wallet, creator_stake, currency, creator_tx_hash, refund_tx_hash, status
      FROM p2p_parlay_offers WHERE id = ${parlayId}
    `);
    const r = ((rows as any).rows ?? (rows as any))[0];
    if (!r) return { success: false, error: 'Parlay not found' };
    if (!['cancelled', 'expired'].includes(r.status)) return { success: false, error: `Not eligible: status='${r.status}'` };
    if (r.refund_tx_hash) return { success: false, skipped: true, error: 'Already refunded' };
    if (!r.creator_tx_hash || Number(r.creator_stake) <= 0) return { success: false, error: 'No funds to refund' };

    const refund = await this._sendRefund(r.creator_wallet, Number(r.creator_stake), (r.currency ?? 'SUI').toUpperCase(), `retry parlay #${parlayId}`);
    if (refund.success && refund.txHash) {
      await db.execute(sql`UPDATE p2p_parlay_offers SET refund_tx_hash = ${refund.txHash} WHERE id = ${parlayId} AND refund_tx_hash IS NULL`);
    }
    return refund;
  }

  /** Retry refunding a taker match that was cancelled without a settlement_tx_hash (the refund field). */
  async retryMatchRefund(matchId: number): Promise<{ success: boolean; txHash?: string; error?: string; skipped?: boolean }> {
    const key = `match:${matchId}`;
    if (!this._refundRateLimitOk(key)) {
      return { success: false, skipped: true, error: 'Rate limited — please wait 60 s before retrying this match' };
    }

    // For cancelled taker matches, settlement_tx_hash doubles as refund_tx_hash (per _refundActiveTakerMatches)
    const rows = await db.execute(sql`
      SELECT m.id, m.taker_wallet, m.stake, m.status, m.settlement_tx_hash,
             o.currency
      FROM p2p_bet_matches m
      JOIN p2p_bet_offers o ON o.id = m.offer_id
      WHERE m.id = ${matchId}
    `);
    const r = ((rows as any).rows ?? (rows as any))[0];
    if (!r) return { success: false, error: 'Match not found' };

    // CRITICAL: won/lost matches are settled bet outcomes — the winner was paid,
    // the loser forfeited their stake. Neither side ever gets a refund.
    if (r.status === 'won' || r.status === 'lost') {
      return { success: false, error: `Blocked: match was settled (status='${r.status}'). Accepted bets are never refundable — the winner already received their payout.` };
    }
    // active/pending matches are live bets awaiting outcome — not cancellable via this panel
    if (r.status === 'active' || r.status === 'pending') {
      return { success: false, error: `Blocked: match is still live (status='${r.status}'). It must be settled or cancelled before a refund can be issued.` };
    }
    if (r.status !== 'cancelled') return { success: false, error: `Not eligible: match status='${r.status}'` };
    if (r.settlement_tx_hash) return { success: false, skipped: true, error: 'Already refunded' };
    if (!r.taker_wallet || Number(r.stake) <= 0) return { success: false, error: 'No taker funds to refund' };

    const refund = await this._sendRefund(r.taker_wallet, Number(r.stake), (r.currency ?? 'SUI').toUpperCase(), `retry taker match #${matchId}`);
    if (refund.success && refund.txHash) {
      await db.execute(sql`
        UPDATE p2p_bet_matches SET settlement_tx_hash = ${refund.txHash}, settled_at = NOW()
        WHERE id = ${matchId} AND settlement_tx_hash IS NULL
      `);
    }
    return refund;
  }

  /** Pending refunds summary: cancelled/expired offers, parlays, and taker matches. */
  async getPendingRefunds(): Promise<{ pendingOffers: any[]; pendingParlays: any[]; pendingMatches: any[]; totalPending: number }> {
    // Pass a factory fn so db.execute() is called INSIDE try/catch (avoids sync-throw escaping)
    const safeQuery = async (label: string, fn: () => any) => {
      try {
        const result = await fn();
        return (result as any).rows ?? (result as any) ?? [];
      } catch (e: any) {
        console.error(`[P2P] getPendingRefunds query failed (${label}):`, e?.message ?? String(e));
        return [];
      }
    };

    const [pendingOffers, pendingParlays, pendingMatches] = await Promise.all([
      // Creator offer refunds: only cancelled/expired offers that were NEVER matched
      // (no won/lost matches). If any match settled, those funds were paid to the winner.
      safeQuery('offers', () => db.execute(sql`
        SELECT id, creator_wallet, creator_stake, currency, created_at, status
        FROM p2p_bet_offers
        WHERE status IN ('cancelled', 'expired')
          AND creator_tx_hash IS NOT NULL
          AND refund_tx_hash IS NULL
          AND creator_stake > 0
          AND NOT EXISTS (
            SELECT 1 FROM p2p_bet_matches m
            WHERE m.offer_id = p2p_bet_offers.id
              AND m.status IN ('won', 'lost')
          )
        ORDER BY created_at DESC
      `)),
      // Creator parlay refunds: only cancelled/expired parlays with no settled outcome
      safeQuery('parlays', () => db.execute(sql`
        SELECT id, creator_wallet, creator_stake, currency, created_at, status
        FROM p2p_parlay_offers
        WHERE status IN ('cancelled', 'expired')
          AND creator_tx_hash IS NOT NULL
          AND refund_tx_hash IS NULL
          AND creator_stake > 0
        ORDER BY created_at DESC
      `)),
      // Taker match refunds: ONLY cancelled matches where taker actually sent funds.
      // taker_tx_hash IS NOT NULL means the taker deposited — they need a refund.
      // A NULL taker_tx_hash means they never sent funds (nothing to refund).
      safeQuery('matches', () => db.execute(sql`
        SELECT m.id, m.taker_wallet as wallet, m.stake, m.status, m.created_at,
               o.currency, o.id AS offer_id
        FROM p2p_bet_matches m
        JOIN p2p_bet_offers o ON o.id = m.offer_id
        WHERE m.status = 'cancelled'
          AND m.taker_tx_hash IS NOT NULL
          AND m.settlement_tx_hash IS NULL
          AND m.stake > 0
        ORDER BY m.created_at DESC
      `)),
    ]);

    return {
      pendingOffers,
      pendingParlays,
      pendingMatches,
      totalPending: pendingOffers.length + pendingParlays.length + pendingMatches.length,
    };
  }

  private async _sendRefund(wallet: string, stake: number, currency: string, label: string) {
    console.log(`[P2P Refund] Sending ${stake} ${currency} back to ${wallet.slice(0, 10)}... for ${label}`);
    let result: { success: boolean; txHash?: string; error?: string };
    if (currency === 'SBETS') {
      result = await blockchainBetService.sendSbetsToUser(wallet, stake);
    } else if (currency === 'USDSUI') {
      result = await blockchainBetService.sendUsdsuiToUser(wallet, stake);
    } else if (currency === 'USDC') {
      result = await blockchainBetService.sendUsdcToUser(wallet, stake);
    } else {
      result = await blockchainBetService.sendSuiToUser(wallet, stake);
    }
    if (result.success) {
      console.log(`[P2P Refund] ✅ Refunded ${stake} ${currency} to ${wallet.slice(0, 10)}... | TX: ${result.txHash}`);
    } else {
      console.error(`[P2P Refund] ❌ Failed to refund ${label}: ${result.error}`);
    }
    return result;
  }

  // ─── P2P Parlay Offers ──────────────────────────────────────────────────────

  async createParlayOffer(params: {
    creatorWallet: string;
    legs: Array<{
      eventId: string;
      eventName: string;
      homeTeam: string;
      awayTeam: string;
      leagueName?: string;
      sportName?: string;
      matchDate?: Date;
      prediction: string;
      odds: number;
    }>;
    creatorStake: number;
    currency: string;
    creatorTxHash?: string;
    expiresAt: Date;
    onchainParlayId?: string;
    onchainConfigId?: string;
  }) {
    if (params.legs.length < 2) throw new Error('Parlays require at least 2 legs');
    if (params.legs.length > 10) throw new Error('Maximum 10 legs per parlay');

    // SECURITY FIX (INFO): validate each leg's odds are within a sane range
    // before multiplying — prevents absurdly large payouts from bad data.
    for (let i = 0; i < params.legs.length; i++) {
      const legOdds = params.legs[i].odds;
      if (!Number.isFinite(legOdds) || legOdds < 1.01 || legOdds > 100) {
        throw new Error(`Leg ${i + 1} odds ${legOdds} are outside the valid range (1.01–100)`);
      }
    }

    const totalOdds = round3(params.legs.reduce((acc, l) => acc * l.odds, 1));

    // SECURITY FIX (INFO): cap parlay total odds at 1000x — matches single-bet
    // max odds (10,000,000 bps = 1000x) so the on-chain cap is always reachable.
    const MAX_PARLAY_ODDS = 1000;
    if (totalOdds > MAX_PARLAY_ODDS) {
      throw new Error(`Parlay total odds ${totalOdds.toFixed(2)}x exceed the maximum of ${MAX_PARLAY_ODDS}x`);
    }

    const takerStake = round3(params.creatorStake * (totalOdds - 1));

    const [parlayOffer] = await db.insert(p2pParlayOffers).values({
      creatorWallet: params.creatorWallet,
      totalOdds,
      legCount: params.legs.length,
      creatorStake: params.creatorStake,
      takerStake,
      currency: params.currency,
      status: 'open',
      creatorTxHash: params.creatorTxHash,
      expiresAt: params.expiresAt,
      onchainParlayId: params.onchainParlayId,
      onchainConfigId: params.onchainConfigId,
    }).returning();

    // Schedule exact-time expiry so refund fires the moment the parlay expires
    this.scheduleExpiryAt(`parlay:${parlayOffer.id}`, params.expiresAt);

    for (let i = 0; i < params.legs.length; i++) {
      const leg = params.legs[i];
      await db.insert(p2pParlayLegs).values({
        parlayOfferId: parlayOffer.id,
        legIndex: i,
        eventId: leg.eventId,
        eventName: leg.eventName,
        homeTeam: leg.homeTeam,
        awayTeam: leg.awayTeam,
        leagueName: leg.leagueName,
        sportName: leg.sportName,
        matchDate: leg.matchDate,
        prediction: leg.prediction,
        odds: leg.odds,
        status: 'pending',
      });
    }

    // Note: maker volume is tracked at match-fill time (acceptParlayOffer), not at creation,
    // to prevent volume-tier farming via post-and-cancel.

    return parlayOffer;
  }

  async listOpenParlayOffers(filters?: { currency?: string; limit?: number; status?: string }) {
    const now = new Date();
    const statusFilter = filters?.status;
    const statusCondition = statusFilter === 'all'
      ? undefined
      : statusFilter && statusFilter !== 'open'
        ? eq(p2pParlayOffers.status, statusFilter as any)
        : and(
            eq(p2pParlayOffers.status, 'open'),
            // Hide parlays that have expired or whose earliest leg has started
            gt(p2pParlayOffers.expiresAt, now),
          );

    const rows = await db.select().from(p2pParlayOffers)
      .where(and(
        statusCondition,
        filters?.currency ? eq(p2pParlayOffers.currency, filters.currency) : undefined,
      ))
      .orderBy(sql`${p2pParlayOffers.createdAt} DESC`)
      .limit(filters?.limit ?? 200);

    const withLegs = await Promise.all(rows.map(async (offer) => {
      const legs = await db.select().from(p2pParlayLegs).where(eq(p2pParlayLegs.parlayOfferId, offer.id));
      return { ...offer, legs };
    }));
    return withLegs;
  }

  async getParlayOffer(parlayOfferId: number) {
    const [offer] = await db.select().from(p2pParlayOffers).where(eq(p2pParlayOffers.id, parlayOfferId));
    if (!offer) return null;
    const legs = await db.select().from(p2pParlayLegs).where(eq(p2pParlayLegs.parlayOfferId, parlayOfferId));
    return { ...offer, legs };
  }

  // ─── ATOMIC PARLAY ACCEPT — race-condition-free ────────────────────────────
  // Parlays are winner-takes-all: only ONE taker per parlay.
  // The UPDATE WHERE status='open' is the atomic gate.

  async acceptParlayOffer(params: {
    parlayOfferId: number;
    takerWallet: string;
    takerTxHash?: string;
  }) {
    // Resolve taker fee tier
    const [takerVolume] = await Promise.all([getWalletVolume(params.takerWallet)]);
    const takerTier = getVolumeTier(takerVolume);

    // Atomic accept — sets status to 'filled' only if:
    //  - still 'open' and not expired
    //  - not the creator's own offer
    //  - creator actually deposited funds (prevents free-money exploit)
    const atomicResult = await db.execute(sql`
      UPDATE p2p_parlay_offers
      SET
        status = 'filled',
        taker_wallet = ${params.takerWallet},
        taker_tx_hash = ${params.takerTxHash ?? null},
        taker_fee_rate = ${takerTier.takerFee}
      WHERE id = ${params.parlayOfferId}
        AND status = 'open'
        AND (expires_at IS NULL OR expires_at > NOW())
        AND creator_wallet != ${params.takerWallet}
        AND (creator_tx_hash IS NOT NULL OR onchain_parlay_id IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM p2p_parlay_legs
          WHERE parlay_offer_id = ${params.parlayOfferId}
            AND match_date IS NOT NULL
            AND match_date <= NOW()
        )
      RETURNING *
    `);

    const rows = (atomicResult as any).rows ?? (atomicResult as any);
    if (!rows || rows.length === 0) {
      const offer = await this.getParlayOffer(params.parlayOfferId);
      if (!offer) throw new Error('Parlay offer not found');
      if (offer.creatorWallet === params.takerWallet) throw new Error('Cannot accept your own parlay');
      if (offer.status === 'filled') throw new Error('This parlay was just accepted by someone else');
      throw new Error(`Parlay offer is no longer available (${offer.status})`);
    }

    const parlay = rows[0];
    const creatorWallet = parlay.creator_wallet ?? parlay.creatorWallet;
    const creatorStake = parlay.creator_stake ?? parlay.creatorStake;
    const takerStake = parlay.taker_stake ?? parlay.takerStake;
    const currency = parlay.currency ?? 'SUI';

    const creatorVolume = await getWalletVolume(creatorWallet);
    const creatorTier = getVolumeTier(creatorVolume);

    const { grossPot, netFee, winnerPayout } = calcParlayPayout({
      creatorStake,
      takerStake,
      takerFeeRate: takerTier.takerFee,
      makerRebateRate: creatorTier.makerRebate,
    });

    // Store computed fee rates and payout on the parlay record
    await db.update(p2pParlayOffers).set({
      makerRebateRate: creatorTier.makerRebate,
      actualPayout: winnerPayout,
      platformFee: netFee,
    }).where(eq(p2pParlayOffers.id, params.parlayOfferId));

    // Track taker and maker volume at fill time to prevent post-and-cancel farming
    await Promise.all([
      upsertVolumeStats(params.takerWallet, { volumeTaker: takerStake, bets: 1 }),
      upsertVolumeStats(creatorWallet, { volumeMaker: creatorStake, bets: 0 }),
    ]);

    const legs = await db.select().from(p2pParlayLegs).where(eq(p2pParlayLegs.parlayOfferId, params.parlayOfferId));
    return {
      id: parlay.id,
      creatorWallet,
      takerWallet: params.takerWallet,
      creatorStake,
      takerStake,
      totalOdds: parlay.total_odds ?? parlay.totalOdds,
      legCount: parlay.leg_count ?? parlay.legCount,
      currency,
      status: 'filled',
      grossPot,
      netFee,
      winnerPayout,
      takerTierName: takerTier.name,
      makerTierName: creatorTier.name,
      legs,
    };
  }

  async cancelParlayOffer(parlayOfferId: number, creatorWallet: string, cancelTxHash?: string) {
    // ── Security pre-flight ──────────────────────────────────────────────────
    // If the parlay was posted via the Sui smart contract (has onchain_parlay_id),
    // the maker MUST supply the cancel_parlay transaction hash to prevent double-payout:
    // user reclaims stake from contract on-chain AND triggers a platform refund.
    const precheck = await db.execute(sql`
      SELECT onchain_parlay_id FROM p2p_parlay_offers
      WHERE id = ${parlayOfferId} AND creator_wallet = ${creatorWallet}
    `);
    const preRow = ((precheck as any).rows ?? (precheck as any))[0];
    if (!preRow) throw new Error('Parlay offer not found or not your offer');
    if (preRow.onchain_parlay_id && !cancelTxHash) {
      throw new Error(
        'This parlay uses on-chain escrow — cancel it via the Sui contract and provide the cancelTxHash.'
      );
    }

    // ── Atomic cancel + refund-slot reservation ──────────────────────────────
    // Set refund_tx_hash = 'PENDING' in the same UPDATE that flips the status.
    // This closes the race window where a double-cancel could dispatch two refunds.
    const placeholderHash = cancelTxHash ?? 'PENDING';
    const result = await db.execute(sql`
      UPDATE p2p_parlay_offers
      SET status = 'cancelled',
          refund_tx_hash = ${placeholderHash}
      WHERE id = ${parlayOfferId}
        AND creator_wallet = ${creatorWallet}
        AND status = 'open'
        AND refund_tx_hash IS NULL
      RETURNING id, creator_stake, currency, creator_tx_hash, onchain_parlay_id
    `);
    const rows = (result as any).rows ?? (result as any);
    if (!rows || rows.length === 0) {
      const offer = await this.getParlayOffer(parlayOfferId);
      if (!offer) throw new Error('Parlay offer not found');
      if (offer.creatorWallet !== creatorWallet) throw new Error('Not your offer');
      throw new Error('Only open parlays can be cancelled');
    }

    const row = rows[0];
    const stake = Number(row.creator_stake ?? 0);
    const currency = (row.currency ?? 'SUI').toUpperCase();
    const isOnchain = !!row.onchain_parlay_id;
    let refundTx: string | undefined;

    if (cancelTxHash) {
      // On-chain cancel_parlay already executed by user — escrow returned directly to wallet.
      // refund_tx_hash was already written above.
      refundTx = cancelTxHash;
    } else if (!isOnchain && !!row.creator_tx_hash && stake > 0) {
      // Off-chain (custodial) parlay — platform holds the funds, send refund from admin wallet.
      const refundResult = await this._sendRefund(creatorWallet, stake, currency, `cancelled parlay #${parlayOfferId}`);
      if (refundResult.success && refundResult.txHash) {
        refundTx = refundResult.txHash;
        await db.execute(sql`
          UPDATE p2p_parlay_offers SET refund_tx_hash = ${refundTx}
          WHERE id = ${parlayOfferId} AND refund_tx_hash = 'PENDING'
        `);
      } else {
        // Refund failed — clear placeholder so admin retry can pick it up.
        await db.execute(sql`
          UPDATE p2p_parlay_offers SET refund_tx_hash = NULL
          WHERE id = ${parlayOfferId} AND refund_tx_hash = 'PENDING'
        `);
      }
    } else {
      // No funds to refund (no creator_tx_hash or zero stake) — clear placeholder.
      await db.execute(sql`
        UPDATE p2p_parlay_offers SET refund_tx_hash = NULL
        WHERE id = ${parlayOfferId} AND refund_tx_hash = 'PENDING'
      `);
    }

    return { refundSent: !!refundTx, refundTx };
  }

  // ─── Volume Stats ───────────────────────────────────────────────────────────

  async getVolumeStats(wallet: string) {
    const [stats] = await db.select().from(p2pVolumeStats).where(eq(p2pVolumeStats.walletAddress, wallet));
    if (!stats) {
      return {
        walletAddress: wallet,
        totalVolumeMaker: 0,
        totalVolumeTaker: 0,
        totalBets: 0,
        wonBets: 0,
        totalNetPnl: 0,
        tier: VOLUME_TIERS[0],
        totalVolume: 0,
      };
    }
    const totalVolume = (stats.totalVolumeMaker ?? 0) + (stats.totalVolumeTaker ?? 0);
    return {
      ...stats,
      totalVolume,
      tier: getVolumeTier(totalVolume),
    };
  }

  async getLeaderboard(limit = 20) {
    // Real-time aggregation across all four P2P tables:
    //   1. p2p_bet_offers       — maker (offer creator) activity
    //   2. p2p_bet_matches      — taker (offer acceptor) activity
    //   3. p2p_parlay_offers    — parlay creator activity
    //   4. p2p_parlay_offers    — parlay taker activity (same table, different role)
    // Then UNION ALL → GROUP BY wallet → sort by total volume → enrich with tier.
    const lbRows = await db.execute(sql`
      WITH
        maker_stats AS (
          SELECT
            creator_wallet                                                         AS wallet,
            COUNT(*)          FILTER (WHERE status IN ('open','filled','settled','partial','cancelled')) AS bets,
            COALESCE(SUM(creator_stake) FILTER (WHERE status IN ('open','filled','settled','partial')), 0) AS volume,
            COUNT(*)          FILTER (WHERE winner = 'creator')                   AS wins,
            COUNT(*)          FILTER (WHERE winner = 'taker')                     AS losses,
            COALESCE(SUM(
              CASE
                WHEN winner = 'creator'
                  THEN (creator_stake + COALESCE(filled_stake, taker_stake)) * 0.98 - creator_stake
                WHEN winner = 'taker'
                  THEN -creator_stake
                ELSE 0
              END
            ) FILTER (WHERE status = 'settled'), 0)                               AS pnl
          FROM p2p_bet_offers
          WHERE creator_wallet IS NOT NULL
          GROUP BY creator_wallet
        ),
        taker_stats AS (
          SELECT
            taker_wallet                                                           AS wallet,
            COUNT(*)                                                               AS bets,
            COALESCE(SUM(stake), 0)                                               AS volume,
            COUNT(*)          FILTER (WHERE status = 'won')                       AS wins,
            COUNT(*)          FILTER (WHERE status = 'lost')                      AS losses,
            COALESCE(SUM(
              CASE
                WHEN status = 'won'  THEN COALESCE(actual_payout, potential_payout) - stake
                WHEN status = 'lost' THEN -stake
                ELSE 0
              END
            ), 0)                                                                  AS pnl
          FROM p2p_bet_matches
          WHERE taker_wallet IS NOT NULL
          GROUP BY taker_wallet
        ),
        parlay_creator_stats AS (
          SELECT
            creator_wallet                                                         AS wallet,
            COUNT(*)          FILTER (WHERE status IN ('open','filled','settled','cancelled')) AS bets,
            COALESCE(SUM(creator_stake) FILTER (WHERE status IN ('open','filled','settled')), 0) AS volume,
            COUNT(*)          FILTER (WHERE winner = 'creator')                   AS wins,
            COUNT(*)          FILTER (WHERE winner = 'taker')                     AS losses,
            COALESCE(SUM(
              CASE
                WHEN winner = 'creator' AND status = 'settled'
                  THEN (creator_stake + taker_stake) * 0.98 - creator_stake
                WHEN winner = 'taker'   AND status = 'settled'
                  THEN -creator_stake
                ELSE 0
              END
            ), 0)                                                                  AS pnl
          FROM p2p_parlay_offers
          WHERE creator_wallet IS NOT NULL
          GROUP BY creator_wallet
        ),
        parlay_taker_stats AS (
          SELECT
            taker_wallet                                                           AS wallet,
            COUNT(*)          FILTER (WHERE status IN ('filled','settled') AND taker_wallet IS NOT NULL) AS bets,
            COALESCE(SUM(taker_stake) FILTER (WHERE status IN ('filled','settled') AND taker_wallet IS NOT NULL), 0) AS volume,
            COUNT(*)          FILTER (WHERE winner = 'taker')                     AS wins,
            COUNT(*)          FILTER (WHERE winner = 'creator')                   AS losses,
            COALESCE(SUM(
              CASE
                WHEN winner = 'taker'   AND status = 'settled'
                  THEN (creator_stake + taker_stake) * 0.98 - taker_stake
                WHEN winner = 'creator' AND status = 'settled'
                  THEN -taker_stake
                ELSE 0
              END
            ) FILTER (WHERE taker_wallet IS NOT NULL), 0)                         AS pnl
          FROM p2p_parlay_offers
          WHERE taker_wallet IS NOT NULL
          GROUP BY taker_wallet
        ),
        combined AS (
          SELECT wallet, bets, volume, wins, losses, pnl FROM maker_stats
          UNION ALL
          SELECT wallet, bets, volume, wins, losses, pnl FROM taker_stats
          UNION ALL
          SELECT wallet, bets, volume, wins, losses, pnl FROM parlay_creator_stats
          UNION ALL
          SELECT wallet, bets, volume, wins, losses, pnl FROM parlay_taker_stats
        ),
        aggregated AS (
          SELECT
            wallet,
            SUM(bets)::int                            AS total_bets,
            SUM(volume)                               AS total_volume,
            SUM(wins)::int                            AS total_wins,
            SUM(losses)::int                          AS total_losses,
            SUM(pnl)                                  AS total_pnl
          FROM combined
          WHERE wallet IS NOT NULL AND wallet <> ''
          GROUP BY wallet
          HAVING SUM(bets) > 0
        )
      SELECT * FROM aggregated
      ORDER BY total_volume DESC
      LIMIT ${limit}
    `);

    const lbData: any[] = (lbRows as any).rows ?? (lbRows as any) ?? [];
    return lbData.map((r, i) => {
      const totalVolume = Number(r.total_volume) || 0;
      const totalBets   = Number(r.total_bets)   || 0;
      const totalWins   = Number(r.total_wins)    || 0;
      const totalLosses = Number(r.total_losses)  || 0;
      const totalNetPnl = Number(r.total_pnl)     || 0;
      const settled     = totalWins + totalLosses;
      const winRate     = settled > 0 ? Math.round((totalWins / settled) * 100) : null;
      return {
        rank: i + 1,
        walletAddress: r.wallet,
        totalVolume,
        totalBets,
        totalWins,
        totalLosses,
        winRate,
        totalNetPnl,
        tier: getVolumeTier(totalVolume),
      };
    });
  }

  // ─── My Activity ────────────────────────────────────────────────────────────

  async getMyActivity(walletAddress: string) {
    const [myOffers, myMatches, myParlayOffers] = await Promise.all([
      db.select().from(p2pBetOffers).where(eq(p2pBetOffers.creatorWallet, walletAddress))
        .orderBy(sql`${p2pBetOffers.createdAt} DESC`).limit(50),
      db.select().from(p2pBetMatches).where(eq(p2pBetMatches.takerWallet, walletAddress))
        .orderBy(sql`${p2pBetMatches.createdAt} DESC`).limit(50),
      db.select().from(p2pParlayOffers).where(
        or(eq(p2pParlayOffers.creatorWallet, walletAddress), eq(p2pParlayOffers.takerWallet, walletAddress))
      ).orderBy(sql`${p2pParlayOffers.createdAt} DESC`).limit(50),
    ]);

    const matchesWithOffers = await Promise.all(myMatches.map(async (m) => {
      const [offer] = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.id, m.offerId));
      return { ...m, offer };
    }));

    // For offers the creator posted, look up the match's walrusBlobId so the UI can show a receipt link
    // Include any status that could have a match (filled, settled, won, lost, settling, cancelled-after-match, etc.)
    const filledOfferIds = myOffers
      .filter(o => !['open', 'expired', 'refund_pending', 'refunded'].includes(o.status))
      .map(o => o.id);

    let offerMatchReceipts: Record<number, { walrusBlobId: string | null; walrusReceiptJson: string | null; matchId: number }> = {};
    if (filledOfferIds.length > 0) {
      const matchRows = await db
        .select({ offerId: p2pBetMatches.offerId, walrusBlobId: p2pBetMatches.walrusBlobId, walrusReceiptJson: p2pBetMatches.walrusReceiptJson, id: p2pBetMatches.id })
        .from(p2pBetMatches)
        .where(sql`${p2pBetMatches.offerId} = ANY(ARRAY[${sql.raw(filledOfferIds.join(','))}]::int[])`);
      for (const row of matchRows) {
        offerMatchReceipts[row.offerId] = { walrusBlobId: row.walrusBlobId ?? null, walrusReceiptJson: row.walrusReceiptJson ?? null, matchId: row.id };
      }
    }

    const myOffersEnriched = myOffers.map(o => ({
      ...o,
      matchWalrusBlobId: offerMatchReceipts[o.id]?.walrusBlobId ?? null,
      matchHasLocalReceipt: !offerMatchReceipts[o.id]?.walrusBlobId && !!offerMatchReceipts[o.id]?.walrusReceiptJson,
      matchId: offerMatchReceipts[o.id]?.matchId ?? null,
    }));

    const parlayOffersWithLegs = await Promise.all(myParlayOffers.map(async (p) => {
      const legs = await db.select().from(p2pParlayLegs).where(eq(p2pParlayLegs.parlayOfferId, p.id));
      return { ...p, legs };
    }));

    return {
      myOffers: myOffersEnriched,
      myMatches: matchesWithOffers,
      myParlayOffers: parlayOffersWithLegs,
    };
  }

  // ─── Settlement ─────────────────────────────────────────────────────────────

  async runSettlement() {
    // Watchdog: if a previous cycle has been running for more than 15 min,
    // it is almost certainly stuck (e.g. many orphan-void calls each timing out).
    // Force-reset the flag so the new cycle can proceed.
    if (this.settlementRunning) {
      const stuckMs = this.settlementStartedAt ? Date.now() - this.settlementStartedAt : 0;
      if (stuckMs > 15 * 60 * 1000) {
        console.warn(`[P2P] ⚠️ Settlement cycle stuck for ${Math.round(stuckMs / 60000)}min — force-resetting`);
        this.settlementRunning   = false;
        this.settlementStartedAt = null;
      } else {
        return;
      }
    }
    this.settlementRunning   = true;
    this.settlementStartedAt = Date.now();
    try {
      // Sync orphaned on-chain fills FIRST so newly-discovered match records are
      // available for the settle/expire steps that follow in the same cycle.
      await this.syncOrphanedOnchainFills();
      await this.syncTakenParlays();
      await this.expireOldOffers();
      await this.retryPendingOnchainRefunds();
      await this.retryCancelledCustodialRefunds();
      await this.settleFilledOffers();
      await this.settleFilledParlays();
    } catch (err: any) {
      console.error('[P2P] Settlement error:', err.message);
    } finally {
      this.settlementRunning   = false;
      this.settlementStartedAt = null;
    }
  }

  /**
   * Retroactive orphan reconciliation — runs every settlement cycle.
   *
   * Queries the last N OfferFilled events directly from the Sui node (fresh, no
   * cursor) so fills that occurred before the server started — or while the Move
   * event listener cursor was ahead — are never missed.
   *
   * For each P2PMatchedBet (betId) found on-chain:
   *  A) If a DB match record already has onchain_match_id = betId → skip (OK).
   *  B) If a DB match exists for (offerId, takerWallet) but lacks onchain_match_id
   *     → backfill the ID so the next settlement uses instant_settle_bet.
   *  C) If no DB match at all → insert one (parent offer found in DB) or void the
   *     P2PMatchedBet (no parent offer in DB — stakes would otherwise be stuck).
   */
  private async syncOrphanedOnchainFills() {
    try {
      const { getJsonRpcUrl } = await import('../lib/suiRpcConfig');
      const P2P_PKG = (process.env.P2P_PACKAGE_ID || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59').trim();
      const rpcUrl  = getJsonRpcUrl();

      // Fetch the 50 most-recent OfferFilled events (newest-first, no cursor)
      const resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'suix_queryEvents',
          params: [{ MoveEventType: `${P2P_PKG}::p2p_betting::OfferFilled` }, null, 50, true],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return;

      const json: any = await resp.json();
      const events: any[] = json?.result?.data ?? [];
      if (!events.length) return;

      for (const event of events) {
        try {
          const parsed         = event.parsedJson ?? {};
          const onchainOfferId: string = parsed.offer_id;
          const betId: string          = parsed.bet_id;          // P2PMatchedBet object ID
          const takerWallet: string    = parsed.taker;
          const fillAmountBase: string = parsed.fill_amount;
          const txDigest: string | undefined = event.id?.txDigest;

          if (!onchainOfferId || !betId || !takerWallet) continue;

          // ── A: match already has the right onchain_match_id ─────────────────
          const [existByBetId] = await db
            .select({ id: p2pBetMatches.id })
            .from(p2pBetMatches)
            .where(eq(p2pBetMatches.onchainMatchId, betId))
            .limit(1);
          if (existByBetId) continue;

          // ── Find parent offer ────────────────────────────────────────────────
          const [offer] = await db
            .select()
            .from(p2pBetOffers)
            .where(eq(p2pBetOffers.onchainOfferId, onchainOfferId))
            .limit(1);

          if (!offer) {
            // No DB record for this offer. Check on-chain state first — if the
            // P2PMatchedBet is already settled/voided on-chain (users settled directly),
            // there is nothing to do and we should NOT attempt void_bet (which would
            // fail with EAlreadySettled=11 or TypeMismatch if the object was consumed).
            const coinType = p2pContractService.resolveCoinType('SUI');
            const voidRes = await p2pContractService.voidBet(betId, coinType)
              .catch((e: any) => ({ success: false as const, txHash: '', error: e.message }));
            if (voidRes.success) {
              console.log(`[P2P Orphan] ✅ void_bet TX: ${voidRes.txHash} — orphan bet ${betId.slice(0, 16)}... refunded on-chain`);
            } else if ((voidRes.error ?? '').startsWith('ALREADY_TERMINAL')) {
              // Bet was already settled/voided on-chain by users — funds already distributed.
              // Log at info level (not warn) since this is expected and not an error.
              console.log(`[P2P Orphan] ℹ️ Bet ${betId.slice(0, 16)}... already finalized on-chain (${voidRes.error}) — no action needed`);
            } else {
              console.warn(`[P2P Orphan] ⚠️ void_bet failed for ${betId.slice(0, 16)}...: ${voidRes.error}`);
            }
            // Small delay between void calls to reduce shared-object (Registry) version conflicts
            await new Promise(r => setTimeout(r, 600));
            continue;
          }

          // ── B: match exists by (offerId, takerWallet) — backfill betId ──────
          const [existByWallet] = await db
            .select({ id: p2pBetMatches.id, onchainMatchId: p2pBetMatches.onchainMatchId })
            .from(p2pBetMatches)
            .where(and(
              eq(p2pBetMatches.offerId, offer.id),
              eq(p2pBetMatches.takerWallet, takerWallet),
            ))
            .limit(1);

          if (existByWallet) {
            if (!existByWallet.onchainMatchId) {
              await db.update(p2pBetMatches)
                .set({ onchainMatchId: betId })
                .where(eq(p2pBetMatches.id, existByWallet.id));
              console.log(`[P2P Orphan] 🔧 Backfilled onchainMatchId → match #${existByWallet.id} (offer #${offer.id})`);
            }
            continue;
          }

          // ── C: no DB match at all — create it ───────────────────────────────
          const decimals    = ['USDSUI', 'USDC'].includes((offer.currency ?? '').toUpperCase()) ? 6
            : (offer.currency ?? '').toUpperCase() === 'LBTC' ? 8
            : 9;
          const fillAmount  = Number(fillAmountBase) / Math.pow(10, decimals);
          const odds        = offer.odds ?? 2;
          const safeOTS     = (offer.takerStake && offer.takerStake > 0)
            ? offer.takerStake
            : Math.round(offer.creatorStake * Math.max(odds - 1, 0.0001) * 1_000_000) / 1_000_000;
          const potentialPayout = Math.round(fillAmount * odds * 1_000_000) / 1_000_000;
          const netFee          = Math.round(fillAmount * 0.02 * 1_000_000) / 1_000_000;

          await db.insert(p2pBetMatches).values({
            offerId:         offer.id,
            takerWallet,
            creatorWallet:   offer.creatorWallet,
            stake:           fillAmount,
            creatorStake:    offer.creatorStake,
            takerStake:      fillAmount,
            potentialPayout,
            status:          'active',
            takerTxHash:     txDigest ?? null,
            onchainMatchId:  betId,
            takerFeeRate:    0.02,
            makerRebateRate: 0,
            netFee,
            platformFee:     netFee,
          });

          // Revive offer if it was expired/cancelled — the on-chain match still
          // needs to be settled so the winner can collect.
          const terminalStatuses = ['expired', 'cancelled'];
          if (terminalStatuses.includes(offer.status ?? '')) {
            await db.update(p2pBetOffers)
              .set({
                status:      'filled' as any,
                filledStake: Math.min((offer.filledStake ?? 0) + fillAmount, safeOTS),
                refundTxHash: null,
              })
              .where(eq(p2pBetOffers.id, offer.id));
            console.log(`[P2P Orphan] ♻️  Offer #${offer.id} revived to 'filled' (was '${offer.status}')`);
          } else {
            const newFilled = Math.min((offer.filledStake ?? 0) + fillAmount, safeOTS);
            const newStatus = newFilled >= safeOTS - 0.0001 ? 'filled' : 'partial';
            await db.update(p2pBetOffers)
              .set({ filledStake: newFilled, status: newStatus as any })
              .where(eq(p2pBetOffers.id, offer.id));
          }

          console.log(`[P2P Orphan] ✅ Created missing match for offer #${offer.id} | betId ${betId.slice(0, 16)}... | taker ${takerWallet.slice(0, 12)}... | ${fillAmount} ${offer.currency}`);
        } catch (innerErr: any) {
          console.warn('[P2P Orphan] Per-event error (non-fatal):', innerErr.message);
        }
      }
    } catch (err: any) {
      console.warn('[P2P Orphan] syncOrphanedOnchainFills non-fatal error:', err.message);
    }
  }

  /**
   * Retry on-chain expire_offer / expire_parlay for any cancelled/expired
   * offer or parlay that has an onchain escrow object but no refund tx yet.
   *
   * This covers rows that were flipped to 'cancelled'/'expired' in the DB
   * before the on-chain clock reached the contract's expires_at — the initial
   * attempt fails with EOfferNotExpired (abort 10).  We keep retrying every
   * settlement loop cycle (5 min) until the contract accepts the call and
   * sends the funds directly back to the maker.
   */
  private async retryPendingOnchainRefunds() {
    // NOTE: Only process `expired` offers here.
    // `cancelled` on-chain offers had their stake returned to the maker via the
    // `cancel_offer` Move call at cancellation time — no `expire_offer` needed.
    // Calling `expire_offer` on a cancelled (or already-consumed) offer object
    // would fail with EOfferNotExpired (abort 10) or object-not-found.
    // ── Cleanup: reset stale PENDING entries left by crashed server cycles ────
    // expireOldOffers sets refund_tx_hash='PENDING' then calls expire_offer.
    // If the server crashes between those two steps, the row is stuck with PENDING
    // forever — this query never picks up PENDING, and expireOldOffers only touches
    // 'open'/'partial' rows. Resetting to NULL lets the loop below retry on-chain.
    await db.execute(sql`
      UPDATE p2p_bet_offers
      SET refund_tx_hash = NULL
      WHERE status = 'expired'
        AND onchain_offer_id IS NOT NULL AND onchain_offer_id != ''
        AND refund_tx_hash = 'PENDING'
        AND creator_stake > 0
    `);
    await db.execute(sql`
      UPDATE p2p_parlay_offers
      SET refund_tx_hash = NULL
      WHERE status = 'expired'
        AND onchain_parlay_id IS NOT NULL AND onchain_parlay_id != ''
        AND refund_tx_hash = 'PENDING'
        AND creator_stake > 0
    `);

    const offerRows = (await db.execute(sql`
      SELECT id, creator_wallet, creator_stake, currency, onchain_offer_id, expires_at, created_at
      FROM p2p_bet_offers
      WHERE status = 'expired'
        AND onchain_offer_id IS NOT NULL AND onchain_offer_id != ''
        AND (refund_tx_hash IS NULL OR refund_tx_hash = '')
        AND creator_stake > 0
      ORDER BY id
    `)) as any;

    const parlayRows = (await db.execute(sql`
      SELECT id, creator_wallet, creator_stake, currency, onchain_parlay_id, expires_at, created_at
      FROM p2p_parlay_offers
      WHERE status = 'expired'
        AND onchain_parlay_id IS NOT NULL AND onchain_parlay_id != ''
        AND (refund_tx_hash IS NULL OR refund_tx_hash = '')
        AND creator_stake > 0
      ORDER BY id
    `)) as any;

    const offers  = offerRows.rows  ?? offerRows;
    const parlays = parlayRows.rows ?? parlayRows;

    for (const row of offers) {
      const currency  = (row.currency ?? 'SUI').toUpperCase();
      const coinType  = p2pContractService.resolveCoinType(currency);

      // ── Pre-check: inspect on-chain state before attempting expire_offer ────
      // If the contract object is already in a terminal state (EXPIRED / CANCELLED /
      // VOID) the funds were already returned to the maker by a previous on-chain call.
      // Mark the DB row as settled so we stop retrying, without touching admin wallet.
      const onchainState = await p2pContractService.getOnchainOfferState(row.onchain_offer_id).catch(() => null);
      const nowMs = Date.now();
      if (onchainState) {
        const terminalStatuses = [
          ONCHAIN_STATUS.EXPIRED,    // 8
          ONCHAIN_STATUS.CANCELLED,  // 7
          ONCHAIN_STATUS.VOID,       // 6
        ] as number[];
        if (terminalStatuses.includes(onchainState.status)) {
          console.log(`[P2P Refund] Offer #${row.id} already in terminal state on-chain (${onchainState.statusLabel}) — marking as settled.`);
          await db.execute(sql`
            UPDATE p2p_bet_offers SET refund_tx_hash = ${'ON_CHAIN_SETTLED'}
            WHERE id = ${row.id} AND (refund_tx_hash IS NULL OR refund_tx_hash = '')
          `);
          continue;
        }
        if (onchainState.status !== ONCHAIN_STATUS.OPEN) {
          console.log(`[P2P Refund] Offer #${row.id} on-chain status is ${onchainState.statusLabel} — skipping expire.`);
          continue;
        }
        // On-chain expiresAt (Unix ms) must have passed before the contract will accept expire_offer.
        const onchainExpiryMs = onchainState.expiresAt;
        if (onchainExpiryMs > 0 && onchainExpiryMs > nowMs) {
          const waitSec = Math.ceil((onchainExpiryMs - nowMs) / 1000);
          const waitHuman = waitSec >= 3600
            ? `${Math.floor(waitSec / 3600)}h ${Math.round((waitSec % 3600) / 60)}m`
            : `${Math.round(waitSec / 60)}m`;
          // If the on-chain expiry is far later than DB expiry, it's a known BetSlip/server cap mismatch.
          const dbExpiryMs = new Date(row.expires_at).getTime();
          const mismatchHours = Math.round((onchainExpiryMs - dbExpiryMs) / 3600000);
          if (mismatchHours > 0) {
            console.log(`[P2P Refund] ⏳ Offer #${row.id} on-chain expiry is ${mismatchHours}h later than DB — waiting ${waitHuman} for contract clock. Auto-refund at ${new Date(onchainExpiryMs).toISOString()}`);
            // Sync DB expires_at to the on-chain value so the dapp shows the correct expiry.
            await db.execute(sql`
              UPDATE p2p_bet_offers
              SET expires_at = ${new Date(onchainExpiryMs).toISOString()}
              WHERE id = ${row.id}
                AND (expires_at IS NULL OR ABS(EXTRACT(EPOCH FROM (expires_at - ${new Date(onchainExpiryMs).toISOString()}::timestamptz))) > 60)
            `);
          } else {
            console.log(`[P2P Refund] ⏳ Offer #${row.id} on-chain not expired yet (${waitHuman} remaining) — will retry next cycle.`);
          }
          continue;
        }
      } else {
        // Can't read on-chain state (RPC error or object unreadable).
        // Be conservative: the on-chain expiry may be much later than the DB expiry
        // (e.g. BetSlip used 24h but server capped DB to match kickoff time).
        // Only call expire_offer once we're at least 24h past DB expiry, giving the
        // on-chain clock time to catch up regardless of what expiryHours was used.
        const dbExpiryMs = new Date(row.expires_at).getTime();
        const conservativeGuardMs = dbExpiryMs + 24 * 3600 * 1000;
        if (nowMs < conservativeGuardMs) {
          const waitSec = Math.ceil((conservativeGuardMs - nowMs) / 1000);
          const waitHuman = waitSec >= 3600
            ? `${Math.floor(waitSec / 3600)}h ${Math.round((waitSec % 3600) / 60)}m`
            : `${Math.round(waitSec / 60)}m`;
          console.log(`[P2P Refund] ⏳ Offer #${row.id} on-chain state unreadable — conservative guard: waiting ${waitHuman} before calling expire_offer.`);
          continue;
        }
      }

      console.log(`[P2P Refund] Retrying on-chain expire_offer for Offer #${row.id} (${row.creator_stake} ${currency})`);
      await new Promise(r => setTimeout(r, 1200));
      try {
        const timeoutP = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('expire_offer timeout')), 30000));
        const result = await Promise.race([p2pContractService.expireOffer(row.onchain_offer_id, coinType), timeoutP]);
        if (result.success && result.txHash) {
          await db.execute(sql`
            UPDATE p2p_bet_offers SET refund_tx_hash = ${result.txHash}
            WHERE id = ${row.id} AND (refund_tx_hash IS NULL OR refund_tx_hash = '')
          `);
          console.log(`[P2P Refund] ✅ Offer #${row.id} refunded on-chain. TX: ${result.txHash}`);
        } else if ((result.error ?? '').startsWith('ALREADY_TERMINAL')) {
          // Offer already in terminal state on-chain — funds already handled, stop retrying
          await db.execute(sql`
            UPDATE p2p_bet_offers SET refund_tx_hash = ${'ON_CHAIN_SETTLED'}
            WHERE id = ${row.id} AND (refund_tx_hash IS NULL OR refund_tx_hash = '')
          `);
          console.log(`[P2P Refund] ✅ Offer #${row.id} already terminal on-chain (${result.error}) — marking settled`);
        } else if (result.error?.toLowerCase().includes('abort') && result.error?.includes('10')) {
          // EOfferNotExpired (abort 10): contract clock has not yet reached expires_at.
          // Funds are escrowed in the contract — do NOT fall back to admin wallet.
          // The next settlement cycle will retry once the clock has advanced.
          console.log(`[P2P Refund] ⏳ Offer #${row.id} abort 10 — contract clock not yet at expires_at. Retrying next cycle.`);
        } else {
          console.error(`[P2P Refund] ❌ Offer #${row.id} expire_offer failed: ${result.error}`);
        }
      } catch (e: any) {
        const msg = (e?.message ?? '').toLowerCase();
        const notYet = msg.includes('abort') && (msg.includes(', 10)') || msg.includes('abort code: 10') || msg.includes('eoffernotexpired'));
        if (notYet) {
          // Same as above — do NOT fall back to admin wallet. Keep retrying.
          console.log(`[P2P Refund] ⏳ Offer #${row.id} abort 10 (thrown) — contract clock not yet at expires_at. Retrying next cycle.`);
        } else {
          console.error(`[P2P Refund] ❌ Offer #${row.id} exception: ${e.message}`);
        }
      }
    }

    for (const row of parlays) {
      const currency  = (row.currency ?? 'SUI').toUpperCase();
      const coinType  = p2pContractService.resolveCoinType(currency);

      // ── Pre-check: inspect on-chain state before attempting expire_parlay ───
      const onchainParlay = await p2pContractService.getOnchainParlayState(row.onchain_parlay_id).catch(() => null);
      const nowMsP = Date.now();
      if (onchainParlay) {
        const terminalStatuses = [
          ONCHAIN_STATUS.EXPIRED,    // 8
          ONCHAIN_STATUS.CANCELLED,  // 7
          ONCHAIN_STATUS.VOID,       // 6
        ] as number[];
        if (terminalStatuses.includes(onchainParlay.status)) {
          console.log(`[P2P Refund] Parlay #${row.id} already in terminal state on-chain (${onchainParlay.statusLabel}) — marking as settled.`);
          await db.execute(sql`
            UPDATE p2p_parlay_offers SET refund_tx_hash = ${'ON_CHAIN_SETTLED'}
            WHERE id = ${row.id} AND (refund_tx_hash IS NULL OR refund_tx_hash = '')
          `);
          continue;
        }
        if (onchainParlay.status !== ONCHAIN_STATUS.OPEN) {
          console.log(`[P2P Refund] Parlay #${row.id} on-chain status is ${onchainParlay.statusLabel} — skipping expire.`);
          continue;
        }
        const onchainExpiryMs = onchainParlay.expiresAt;
        if (onchainExpiryMs > 0 && onchainExpiryMs > nowMsP) {
          const waitSec = Math.ceil((onchainExpiryMs - nowMsP) / 1000);
          const waitHuman = waitSec >= 3600
            ? `${Math.floor(waitSec / 3600)}h ${Math.round((waitSec % 3600) / 60)}m`
            : `${Math.round(waitSec / 60)}m`;
          const dbExpiryMs = new Date(row.expires_at).getTime();
          const mismatchHours = Math.round((onchainExpiryMs - dbExpiryMs) / 3600000);
          if (mismatchHours > 0) {
            console.log(`[P2P Refund] ⏳ Parlay #${row.id} on-chain expiry is ${mismatchHours}h later than DB — waiting ${waitHuman} for contract clock. Auto-refund at ${new Date(onchainExpiryMs).toISOString()}`);
          } else {
            console.log(`[P2P Refund] ⏳ Parlay #${row.id} on-chain not expired yet (${waitHuman} remaining) — will retry next cycle.`);
          }
          continue;
        }
      } else {
        // Can't read on-chain state — conservative guard same as offers
        const dbExpiryMs = new Date(row.expires_at).getTime();
        const conservativeGuardMs = dbExpiryMs + 24 * 3600 * 1000;
        if (nowMsP < conservativeGuardMs) {
          const waitSec = Math.ceil((conservativeGuardMs - nowMsP) / 1000);
          const waitHuman = waitSec >= 3600
            ? `${Math.floor(waitSec / 3600)}h ${Math.round((waitSec % 3600) / 60)}m`
            : `${Math.round(waitSec / 60)}m`;
          console.log(`[P2P Refund] ⏳ Parlay #${row.id} on-chain state unreadable — conservative guard: waiting ${waitHuman} before calling expire_parlay.`);
          continue;
        }
      }

      console.log(`[P2P Refund] Retrying on-chain expire_parlay for Parlay #${row.id} (${row.creator_stake} ${currency})`);
      await new Promise(r => setTimeout(r, 1200));
      try {
        const timeoutP2 = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('expire_parlay timeout')), 30000));
        const result = await Promise.race([p2pContractService.expireParlay(row.onchain_parlay_id, coinType), timeoutP2]);
        if (result.success && result.txHash) {
          await db.execute(sql`
            UPDATE p2p_parlay_offers SET refund_tx_hash = ${result.txHash}
            WHERE id = ${row.id} AND (refund_tx_hash IS NULL OR refund_tx_hash = '')
          `);
          console.log(`[P2P Refund] ✅ Parlay #${row.id} refunded on-chain. TX: ${result.txHash}`);
        } else if ((result.error ?? '').startsWith('ALREADY_TERMINAL')) {
          // Parlay already expired/cancelled on-chain — mark settled so retries stop
          await db.execute(sql`
            UPDATE p2p_parlay_offers SET refund_tx_hash = ${'ON_CHAIN_SETTLED'}
            WHERE id = ${row.id} AND (refund_tx_hash IS NULL OR refund_tx_hash = '')
          `);
          console.log(`[P2P Refund] ✅ Parlay #${row.id} already terminal on-chain (${result.error}) — marked settled.`);
        } else if (result.error?.toLowerCase().includes('abort') && result.error?.includes('10')) {
          // EOfferNotExpired (abort 10): contract clock has not yet reached expires_at.
          // Funds are escrowed in the contract — do NOT fall back to admin wallet.
          console.log(`[P2P Refund] ⏳ Parlay #${row.id} abort 10 — contract clock not yet at expires_at. Retrying next cycle.`);
        } else {
          console.error(`[P2P Refund] ❌ Parlay #${row.id} expire_parlay failed: ${result.error}`);
        }
      } catch (e: any) {
        const msg = (e?.message ?? '').toLowerCase();
        const notYet = msg.includes('abort') && (msg.includes(', 10)') || msg.includes('abort code: 10') || msg.includes('eparlaynotexpired'));
        if (notYet) {
          // Same as above — do NOT fall back to admin wallet. Keep retrying.
          console.log(`[P2P Refund] ⏳ Parlay #${row.id} abort 10 (thrown) — contract clock not yet at expires_at. Retrying next cycle.`);
        } else {
          console.error(`[P2P Refund] ❌ Parlay #${row.id} exception: ${e.message}`);
        }
      }
    }
  }

  /**
   * Custodial fallback: send funds from admin wallet when the on-chain
   * expire path is stuck (contract clock lag or permanent abort).
   * Stamps refund_tx_hash so the parlay/offer is never re-processed.
   */
  private async _custodialFallbackRefund(
    type: 'offer' | 'parlay',
    id: number,
    wallet: string,
    stake: number,
    currency: string,
  ) {
    const refund = await this._sendRefund(wallet, stake, currency, `custodial-fallback ${type} #${id}`);
    if (refund.success && refund.txHash) {
      if (type === 'offer') {
        await db.update(p2pBetOffers)
          .set({ refundTxHash: refund.txHash })
          .where(and(eq(p2pBetOffers.id, id), or(isNull(p2pBetOffers.refundTxHash), eq(p2pBetOffers.refundTxHash, ''))));
      } else {
        await db.update(p2pParlayOffers)
          .set({ refundTxHash: refund.txHash })
          .where(and(eq(p2pParlayOffers.id, id), or(isNull(p2pParlayOffers.refundTxHash), eq(p2pParlayOffers.refundTxHash, ''))));
      }
      console.log(`[P2P Refund] ✅ ${type} #${id} custodial fallback refund sent: ${refund.txHash}`);
    } else {
      console.error(`[P2P Refund] ❌ ${type} #${id} custodial fallback ALSO failed: ${refund.error}`);
    }
  }

  /**
   * Auto-retry custodial refunds for cancelled offers/parlays that never received
   * their stake back. Two scenarios handled:
   *
   * 1. Stale 'PENDING' entries — written atomically with the cancel UPDATE but
   *    never resolved (server crashed between writing PENDING and clearing it).
   *    We reset them to NULL so the retry query below (and future cancel calls)
   *    can pick them up.
   *
   * 2. NULL refund_tx_hash on cancelled custodial offers — the _sendRefund call
   *    failed at cancel time (e.g. admin key not configured, network error).
   *    We retry the send now.
   *
   * Only custodial (non-on-chain) offers need this — on-chain offers get stake
   * returned directly to the maker via the cancel_offer Move call.
   */
  private async retryCancelledCustodialRefunds() {
    // Step 1: Clear stale PENDING entries for cancelled offers/parlays.
    // On-chain cancelled offers legitimately have refund_tx_hash = cancelTxHash
    // so we only touch rows where onchain_offer_id IS NULL (custodial).
    await db.execute(sql`
      UPDATE p2p_bet_offers
      SET refund_tx_hash = NULL
      WHERE status = 'cancelled'
        AND onchain_offer_id IS NULL
        AND refund_tx_hash = 'PENDING'
    `);
    await db.execute(sql`
      UPDATE p2p_parlay_offers
      SET refund_tx_hash = NULL
      WHERE status = 'cancelled'
        AND onchain_parlay_id IS NULL
        AND refund_tx_hash = 'PENDING'
    `);

    // Step 2: Retry custodial refunds with no refund tx yet.
    const pendingOffers = (await db.execute(sql`
      SELECT id, creator_wallet, creator_stake, currency
      FROM p2p_bet_offers
      WHERE status = 'cancelled'
        AND onchain_offer_id IS NULL
        AND creator_tx_hash IS NOT NULL
        AND refund_tx_hash IS NULL
        AND creator_stake > 0
      LIMIT 20
    `)) as any;
    const pendingParlays = (await db.execute(sql`
      SELECT id, creator_wallet, creator_stake, currency
      FROM p2p_parlay_offers
      WHERE status = 'cancelled'
        AND onchain_parlay_id IS NULL
        AND creator_tx_hash IS NOT NULL
        AND refund_tx_hash IS NULL
        AND creator_stake > 0
      LIMIT 20
    `)) as any;

    const offerRows  = pendingOffers.rows  ?? pendingOffers;
    const parlayRows = pendingParlays.rows ?? pendingParlays;

    for (const row of offerRows) {
      const stake    = Number(row.creator_stake);
      const currency = (row.currency ?? 'SUI').toUpperCase();
      console.log(`[P2P Refund] Auto-retry custodial refund — cancelled offer #${row.id} (${stake} ${currency} → ${row.creator_wallet.slice(0, 10)}...)`);
      const refund = await this._sendRefund(row.creator_wallet, stake, currency, `auto-retry cancelled offer #${row.id}`);
      if (refund.success && refund.txHash) {
        await db.execute(sql`
          UPDATE p2p_bet_offers SET refund_tx_hash = ${refund.txHash}
          WHERE id = ${row.id} AND refund_tx_hash IS NULL
        `);
        console.log(`[P2P Refund] ✅ Offer #${row.id} refunded: ${refund.txHash}`);
      } else {
        console.error(`[P2P Refund] ❌ Offer #${row.id} refund failed: ${refund.error}`);
      }
    }

    for (const row of parlayRows) {
      const stake    = Number(row.creator_stake);
      const currency = (row.currency ?? 'SUI').toUpperCase();
      console.log(`[P2P Refund] Auto-retry custodial refund — cancelled parlay #${row.id} (${stake} ${currency} → ${row.creator_wallet.slice(0, 10)}...)`);
      const refund = await this._sendRefund(row.creator_wallet, stake, currency, `auto-retry cancelled parlay #${row.id}`);
      if (refund.success && refund.txHash) {
        await db.execute(sql`
          UPDATE p2p_parlay_offers SET refund_tx_hash = ${refund.txHash}
          WHERE id = ${row.id} AND refund_tx_hash IS NULL
        `);
        console.log(`[P2P Refund] ✅ Parlay #${row.id} refunded: ${refund.txHash}`);
      } else {
        console.error(`[P2P Refund] ❌ Parlay #${row.id} refund failed: ${refund.error}`);
      }
    }

    // Step 3: Retry taker match refunds that failed during offer cancel/expiry.
    // When _refundActiveTakerMatches fails to refund a taker, the match is set
    // to status='cancelled' but settlement_tx_hash stays NULL (no refund sent).
    // These must be retried so takers don't permanently lose their stake.
    //
    // Priority path: if the match has an onchain_match_id (P2PMatchedBet object),
    // call void_bet on-chain — the contract returns both maker and taker stakes
    // directly without needing the admin wallet to hold the currency.
    const pendingMatches = (await db.execute(sql`
      SELECT m.id, m.taker_wallet, m.stake, o.currency, m.onchain_match_id
      FROM p2p_bet_matches m
      JOIN p2p_bet_offers o ON o.id = m.offer_id
      WHERE m.status = 'cancelled'
        AND m.taker_tx_hash IS NOT NULL
        AND m.settlement_tx_hash IS NULL
        AND m.stake > 0
      LIMIT 20
    `)) as any;
    const matchRows = pendingMatches.rows ?? pendingMatches;

    for (const row of matchRows) {
      const stake          = Number(row.stake);
      const currency       = (row.currency ?? 'SUI').toUpperCase();
      const onchainMatchId = row.onchain_match_id as string | null;
      console.log(`[P2P Refund] Auto-retry taker match refund — cancelled match #${row.id} (${stake} ${currency} → ${(row.taker_wallet as string).slice(0, 10)}... | ${onchainMatchId ? 'on-chain void_bet' : 'custodial send'})`);

      let refundTx: string | null = null;
      let succeeded = false;

      if (onchainMatchId) {
        // On-chain matched bet: call void_bet — returns both parties' stakes from
        // the contract. No admin wallet balance needed for the payout.
        const coinType = p2pContractService.resolveCoinType(currency);
        const voidResult = await p2pContractService.voidBet(onchainMatchId, coinType)
          .catch((e: any) => ({ success: false as const, txHash: '', error: e.message }));
        if (voidResult.success && voidResult.txHash) {
          refundTx  = voidResult.txHash;
          succeeded = true;
          console.log(`[P2P Refund] ✅ Match #${row.id} void_bet TX: ${voidResult.txHash} — both parties refunded on-chain`);
        } else if ((voidResult.error ?? '').startsWith('ALREADY_TERMINAL')) {
          // Bet already settled/voided on-chain — funds already distributed, mark as done
          refundTx  = `ONCHAIN_TERMINAL:${onchainMatchId.slice(0, 16)}`;
          succeeded = true;
          console.log(`[P2P Refund] ℹ️ Match #${row.id} already finalized on-chain (${voidResult.error}) — marking settled`);
        } else {
          console.error(`[P2P Refund] ❌ Match #${row.id} void_bet failed: ${voidResult.error} — falling back to custodial`);
          // Fall through to custodial send below
        }
      }

      if (!succeeded) {
        // Custodial fallback: admin wallet sends the currency directly
        const refund = await this._sendRefund(row.taker_wallet as string, stake, currency, `auto-retry cancelled match #${row.id}`);
        if (refund.success && refund.txHash) {
          refundTx  = refund.txHash;
          succeeded = true;
        }
      }

      if (succeeded && refundTx) {
        await db.execute(sql`
          UPDATE p2p_bet_matches
          SET settlement_tx_hash = ${refundTx}, settled_at = NOW()
          WHERE id = ${row.id} AND settlement_tx_hash IS NULL
        `);
        console.log(`[P2P Refund] ✅ Match #${row.id} taker refunded: ${refundTx}`);
      } else {
        console.error(`[P2P Refund] ❌ Match #${row.id} taker refund failed (all paths exhausted)`);
      }
    }
  }

  private async syncTakenParlays() {
    // Case A: open parlays that may have been matched on-chain without DB update
    // Case B: expired parlays stuck with PENDING refund that were actually matched
    //         on-chain before they expired — their funds are locked in the contract
    //         and the creator's refund must NOT be sent; instead settle as filled.
    const candidates = await db.execute(sql`
      SELECT id, onchain_parlay_id, creator_wallet, currency, status, refund_tx_hash
      FROM p2p_parlay_offers
      WHERE onchain_parlay_id IS NOT NULL
        AND (
          status = 'open'
          OR (status = 'expired' AND refund_tx_hash = 'PENDING')
        )
      LIMIT 50
    `);
    const rows = (candidates as any).rows ?? (candidates as any);
    if (!rows.length) return;

    for (const row of rows) {
      try {
        const state = await p2pContractService.getOnchainParlayState(row.onchain_parlay_id);
        if (!state) continue;

        if (state.hasBeenTaken) {
          // Parlay was matched on-chain — promote to 'filled' regardless of DB status
          const takerAddr = state.takerAddress ?? null;
          const updated = await db.execute(sql`
            UPDATE p2p_parlay_offers
            SET status = 'filled',
                taker_wallet = ${takerAddr},
                refund_tx_hash = NULL
            WHERE id = ${row.id} AND status IN ('open', 'expired')
            RETURNING id
          `);
          const updatedRows = (updated as any).rows ?? (updated as any);
          if (updatedRows.length > 0) {
            console.log(`[P2P Sync] Parlay #${row.id} auto-synced: on-chain matched → DB set to 'filled' (taker: ${takerAddr?.slice(0, 12) ?? 'unknown'}...)`);
          }
        } else if (row.status === 'expired' && row.refund_tx_hash === 'PENDING') {
          // Parlay is NOT matched on-chain but refund is stuck at PENDING
          // (server crashed mid-expiry). Reset so expireOldOffers can retry.
          await db.execute(sql`
            UPDATE p2p_parlay_offers
            SET refund_tx_hash = NULL
            WHERE id = ${row.id} AND refund_tx_hash = 'PENDING'
          `);
          console.log(`[P2P Sync] Parlay #${row.id} PENDING reset — expiry will retry on next cycle`);
        }
      } catch (e: any) {
        console.warn(`[P2P Sync] Error syncing parlay #${row.id}: ${e.message}`);
      }
    }
  }

  private async expireOldOffers() {
    const now = new Date();
    const nowIso = now.toISOString();

    // ── Atomic claim — set PENDING placeholder in the same UPDATE ────────────
    // This prevents processAllPendingRefunds / retryOfferRefund from racing and
    // double-refunding while we process the offer.  On-chain offers are routed
    // to expire_offer (permissionless); legacy offers use the admin-wallet path.
    // NOTE: on-chain offers do NOT require creator_tx_hash (contract is proof of funds).
    // Expire offers where EITHER:
    //   a) expires_at < now  — the user-chosen expiry window passed, OR
    //   b) match_date < now  — the match has already kicked off (match_date is always
    //                          capped to expiresAt at creation, but legacy offers or
    //                          edge-cases may have expiresAt > match_date).
    // Both conditions cause the offer to be unacceptable (server blocks take by matchDate),
    // so we refund the creator immediately rather than leaving the offer zombie-open.
    const claimedOffers = await db.execute(sql`
      UPDATE p2p_bet_offers
      SET status = 'expired', refund_tx_hash = 'PENDING'
      WHERE status IN ('open', 'partial')
        AND (
          expires_at < ${nowIso}::timestamptz
          OR (match_date IS NOT NULL AND match_date < ${nowIso}::timestamptz)
        )
        AND (creator_tx_hash IS NOT NULL OR onchain_offer_id IS NOT NULL)
        AND creator_stake > 0
        AND refund_tx_hash IS NULL
      RETURNING id, creator_wallet, creator_stake, currency, creator_tx_hash, onchain_offer_id
    `);
    const claimedParlays = await db.execute(sql`
      UPDATE p2p_parlay_offers
      SET status = 'expired', refund_tx_hash = 'PENDING'
      WHERE status IN ('open', 'partial')
        AND expires_at < ${nowIso}::timestamptz
        AND (creator_tx_hash IS NOT NULL OR onchain_parlay_id IS NOT NULL)
        AND creator_stake > 0
        AND refund_tx_hash IS NULL
      RETURNING id, creator_wallet, creator_stake, currency, creator_tx_hash, onchain_parlay_id
    `);

    const offerRows  = (claimedOffers  as any).rows ?? (claimedOffers  as any);
    const parlayRows = (claimedParlays as any).rows ?? (claimedParlays as any);

    // ── Process expired offers ────────────────────────────────────────────────
    for (const row of offerRows) {
      const stake    = Number(row.creator_stake);
      const currency = (row.currency ?? 'SUI').toUpperCase();
      const coinType = p2pContractService.resolveCoinType(currency);
      console.log(`[P2P Expire] Offer #${row.id} expired — returning ${stake} ${currency} to ${row.creator_wallet.slice(0, 10)}... (${row.onchain_offer_id ? 'on-chain' : 'legacy'})`);

      let refundTx: string | null = null;
      let succeeded = false;

      if (row.onchain_offer_id) {
        // ── On-chain escrow: call expire_offer on the contract ──────────────
        // The contract handles the SUI transfer directly back to the maker.
        // Admin pays gas only — no admin SUI leaves the platform wallet.
        const expireOfferTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('expire_offer timeout')), 30000));
        const result = await Promise.race([p2pContractService.expireOffer(row.onchain_offer_id, coinType), expireOfferTimeout]).catch((e: any) => ({ success: false as const, error: e.message }));
        if (result.success && result.txHash) {
          refundTx  = result.txHash;
          succeeded = true;
          console.log(`[P2P Expire] Offer #${row.id} → expire_offer TX: ${result.txHash}`);
        } else if ((result.error ?? '').startsWith('ALREADY_TERMINAL')) {
          // Offer already in terminal state on-chain (filled, cancelled, or expired before we called).
          // Funds are already handled — mark as done so we stop retrying.
          refundTx  = `ONCHAIN_TERMINAL:${(row.onchain_offer_id as string).slice(0, 16)}`;
          succeeded = true;
          console.log(`[P2P Expire] Offer #${row.id} already terminal on-chain (${result.error}) — marking settled`);
        } else {
          console.error(`[P2P Expire] Offer #${row.id} expire_offer failed: ${result.error}`);
        }
      } else {
        // ── Legacy custodial: admin wallet holds the SUI, send manually ─────
        const refund = await this._sendRefund(row.creator_wallet, stake, currency, `expired offer #${row.id}`);
        if (refund.success && refund.txHash) {
          refundTx  = refund.txHash;
          succeeded = true;
        } else {
          console.error(`[P2P Expire] Offer #${row.id} legacy refund failed: ${refund.error}`);
        }
      }

      if (succeeded && refundTx) {
        // Overwrite PENDING with real tx hash
        await db.execute(sql`
          UPDATE p2p_bet_offers SET refund_tx_hash = ${refundTx}
          WHERE id = ${row.id} AND refund_tx_hash = 'PENDING'
        `);
      } else {
        // Reset PENDING so admin retry tools can pick it up
        await db.execute(sql`
          UPDATE p2p_bet_offers SET refund_tx_hash = NULL
          WHERE id = ${row.id} AND refund_tx_hash = 'PENDING'
        `);
      }

      // Refund any active taker matches (partial fills) in the same currency
      await this._refundActiveTakerMatches(row.id, currency, `expired offer #${row.id}`);
    }

    // ── Process expired parlays ───────────────────────────────────────────────
    for (const row of parlayRows) {
      const stake    = Number(row.creator_stake);
      const currency = (row.currency ?? 'SUI').toUpperCase();
      const coinType = p2pContractService.resolveCoinType(currency);
      console.log(`[P2P Expire] Parlay #${row.id} expired — returning ${stake} ${currency} to ${row.creator_wallet.slice(0, 10)}... (${row.onchain_parlay_id ? 'on-chain' : 'legacy'})`);

      let refundTx: string | null = null;
      let succeeded = false;

      if (row.onchain_parlay_id) {
        const expireParlayTimeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('expire_parlay timeout')), 30000));
        const result = await Promise.race([p2pContractService.expireParlay(row.onchain_parlay_id, coinType), expireParlayTimeout]).catch((e: any) => ({ success: false as const, error: e.message }));
        if (result.success && result.txHash) {
          refundTx  = result.txHash;
          succeeded = true;
          console.log(`[P2P Expire] Parlay #${row.id} → expire_parlay TX: ${result.txHash}`);
        } else if ((result.error ?? '').startsWith('ALREADY_TERMINAL')) {
          // Parlay already expired/cancelled on-chain — treat as success so DB is updated
          refundTx  = 'ONCHAIN_TERMINAL';
          succeeded = true;
          console.log(`[P2P Expire] Parlay #${row.id} already terminal on-chain (${result.error}) — marking expired in DB`);
        } else {
          console.error(`[P2P Expire] Parlay #${row.id} expire_parlay failed: ${result.error}`);
        }
      } else {
        const refund = await this._sendRefund(row.creator_wallet, stake, currency, `expired parlay #${row.id}`);
        if (refund.success && refund.txHash) {
          refundTx  = refund.txHash;
          succeeded = true;
        } else {
          console.error(`[P2P Expire] Parlay #${row.id} legacy refund failed: ${refund.error}`);
        }
      }

      if (succeeded && refundTx) {
        await db.execute(sql`
          UPDATE p2p_parlay_offers SET refund_tx_hash = ${refundTx}
          WHERE id = ${row.id} AND refund_tx_hash = 'PENDING'
        `);
      } else {
        await db.execute(sql`
          UPDATE p2p_parlay_offers SET refund_tx_hash = NULL
          WHERE id = ${row.id} AND refund_tx_hash = 'PENDING'
        `);
      }
    }

    // Mark remaining open/partial+expired offers (no funds sent) as expired in bulk.
    // Two cases trigger expiry:
    //   a) expires_at < now  (user-chosen expiry window lapsed)
    //   b) match_date < now  (match has kicked off — betting window closed)
    await db.update(p2pBetOffers)
      .set({ status: 'expired' })
      .where(and(
        or(eq(p2pBetOffers.status, 'open'), eq(p2pBetOffers.status, 'partial')),
        or(
          lt(p2pBetOffers.expiresAt, now),
          and(
            sql`${p2pBetOffers.matchDate} IS NOT NULL`,
            lt(p2pBetOffers.matchDate, now),
          ),
        ),
      ));
    await db.update(p2pParlayOffers)
      .set({ status: 'expired' })
      .where(and(
        or(eq(p2pParlayOffers.status, 'open'), eq(p2pParlayOffers.status, 'partial')),
        lt(p2pParlayOffers.expiresAt, now),
      ));
  }

  /**
   * Refund all active taker matches for a given offer in the specified currency.
   * Called when an offer is cancelled or expires with partial fills so takers
   * get their stake back in SUI, SBETS, or USDSUI.
   *
   * Priority: if the match has an onchain_match_id (P2PMatchedBet), call void_bet
   * on-chain — the contract returns both sides' stakes directly without needing
   * the admin wallet to hold the currency. Falls back to custodial send.
   */
  private async _refundActiveTakerMatches(offerId: number, currency: string, label: string) {
    // ── Result-aware guard ───────────────────────────────────────────────────
    // If the event result for this offer is already known in settled_events,
    // we must NOT void/refund taker matches — the settlement service needs to
    // pay the WINNER, not refund both sides.  Voiding here while the result is
    // known is exactly what caused Offer #49 (Inter Miami) to go unpaid.
    const [offerRow] = await db.execute(sql`
      SELECT id, event_id FROM p2p_bet_offers WHERE id = ${offerId}
    `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

    if (offerRow?.event_id) {
      const [knownResult] = await db.execute(sql`
        SELECT winner FROM settled_events WHERE external_event_id = ${offerRow.event_id} LIMIT 1
      `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

      if (knownResult?.winner) {
        console.warn(
          `[P2P Refund] ⛔ Skipping taker match void for offer #${offerId} (${label}) — ` +
          `event ${offerRow.event_id} result already known ('${knownResult.winner}'). ` +
          `Settlement service will pay the winner instead.`
        );
        return;
      }
    }

    const activeMatches = await db.execute(sql`
      SELECT id, taker_wallet, stake, onchain_match_id
      FROM p2p_bet_matches
      WHERE offer_id = ${offerId}
        AND status = 'active'
        AND stake > 0
    `);
    const rows = (activeMatches as any).rows ?? (activeMatches as any);
    for (const m of rows) {
      const takerStake     = Number(m.stake);
      const takerWallet    = m.taker_wallet as string;
      const onchainMatchId = m.onchain_match_id as string | null;
      if (!takerWallet || takerStake <= 0) continue;
      console.log(`[P2P Refund] Match #${m.id} — refunding taker ${takerWallet.slice(0, 10)}... ${takerStake} ${currency} (${label} | ${onchainMatchId ? 'void_bet' : 'custodial'})`);

      let refundTx: string | null = null;
      let succeeded = false;

      if (onchainMatchId) {
        // On-chain matched bet: void_bet returns both parties' stakes from the contract
        const coinType = p2pContractService.resolveCoinType(currency);
        const voidResult = await p2pContractService.voidBet(onchainMatchId, coinType)
          .catch((e: any) => ({ success: false as const, txHash: '', error: e.message }));
        if (voidResult.success && voidResult.txHash) {
          refundTx  = voidResult.txHash;
          succeeded = true;
          console.log(`[P2P Refund] ✅ Match #${m.id} void_bet TX: ${voidResult.txHash} — both parties refunded on-chain`);
        } else if ((voidResult.error ?? '').startsWith('ALREADY_TERMINAL')) {
          // Bet already settled/voided on-chain — funds already distributed
          refundTx  = `ONCHAIN_TERMINAL:${onchainMatchId.slice(0, 16)}`;
          succeeded = true;
          console.log(`[P2P Refund] ℹ️ Match #${m.id} already finalized on-chain (${voidResult.error}) — marking settled`);
        } else {
          console.error(`[P2P Refund] ❌ Match #${m.id} void_bet failed: ${voidResult.error} — falling back to custodial`);
        }
      }

      if (!succeeded) {
        const refund = await this._sendRefund(takerWallet, takerStake, currency, `match #${m.id} (${label})`);
        if (refund.success && refund.txHash) {
          refundTx  = refund.txHash;
          succeeded = true;
        }
      }

      // Mark match as cancelled and store refund tx in settlement_tx_hash for audit trail
      await db.execute(sql`
        UPDATE p2p_bet_matches
        SET status = 'cancelled',
            settlement_tx_hash = ${refundTx ?? null},
            settled_at = NOW()
        WHERE id = ${m.id}
      `);
      if (succeeded) {
        console.log(`[P2P Refund] ✅ Taker match #${m.id} refunded — TX: ${refundTx}`);
      } else {
        console.error(`[P2P Refund] ❌ Taker match #${m.id} refund failed: all paths exhausted`);
      }
    }
  }

  /**
   * Multi-source result lookup — fallback for when settled_events is empty.
   * Tries ESPN event summary endpoints for the sport inferred from sportName,
   * falling back to all sports when unknown.
   * Results are cached into settled_events so subsequent cycles hit the DB.
   */
  private async fetchEventResultFromESPN(
    eventId: string,
    sportName?: string,
    expectedHomeTeam?: string,
    expectedAwayTeam?: string,
  ): Promise<{
    winner: 'home' | 'away' | 'draw';
    homeScore: number;
    awayScore: number;
    homeTeam: string;
    awayTeam: string;
  } | null> {
    // ── tsdb: prefix → bypass ESPN entirely, use TheSportsDB lookup by ID ───────
    // tsdb:NNNNNN IDs come from TheSportsDB and are not valid ESPN event IDs.
    // Trying them against ESPN wastes 8s × N_COMBOS and always fails.
    if (eventId.startsWith('tsdb:')) {
      const numId = eventId.slice(5);
      try {
        const url  = `https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=${numId}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (resp.ok) {
          const data: any = await resp.json();
          const ev = data?.events?.[0];
          if (ev) {
            const status   = (ev.strStatus ?? '').toLowerCase();
            const finished = status === 'ft' || status === 'aet' || status === 'pen' ||
              status.includes('finished') || status.includes('full time') || status.includes('full-time');
            if (finished) {
              const homeScore = Number(ev.intHomeScore ?? 0);
              const awayScore = Number(ev.intAwayScore ?? 0);
              const winner: 'home' | 'away' | 'draw' =
                homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
              console.log(`[P2P TSDB-ID] ${eventId}: ${ev.strHomeTeam} ${homeScore}-${awayScore} ${ev.strAwayTeam} → ${winner}`);
              return { winner, homeScore, awayScore, homeTeam: ev.strHomeTeam ?? '', awayTeam: ev.strAwayTeam ?? '' };
            }
          }
        }
      } catch (err: any) {
        console.warn(`[P2P TSDB-ID] Lookup failed for ${eventId}: ${err.message}`);
      }
      return null; // tsdb: IDs are not resolvable via ESPN — stop here
    }

    const sport = (sportName ?? '').toLowerCase();

    // Build prioritised list of [espnSport, league] combos based on the known sport.
    // IMPORTANT: null/empty sport_name → isUnknown=true → try ALL combos.
    // Previously: !sport was inside isSoccer, causing null sport_name to only try soccer
    // leagues and permanently skip WNBA/AFL/baseball/hockey matches. Fixed: null/empty
    // sport → isUnknown so every sport family is probed.
    const isSoccer   = sport === 'football' || sport === 'soccer';
    const isBasket   = sport === 'basketball' || sport === 'nba' || sport === 'wnba';
    const isBaseball = sport === 'baseball'   || sport === 'mlb';
    const isHockey   = sport === 'hockey'     || sport === 'ice-hockey' || sport === 'ice hockey' || sport === 'nhl';
    const isAmFoot   = sport === 'american-football' || sport === 'american football' || sport === 'nfl';
    const isAfl      = sport === 'afl' || sport === 'australian rules' || sport === 'australian-football' || sport === 'aussie rules';
    const isMma      = sport === 'mma' || sport === 'ufc' || sport === 'mixed martial arts';
    const isUnknown  = !sport || (!isSoccer && !isBasket && !isBaseball && !isHockey && !isAmFoot && !isAfl && !isMma);

    const combos: Array<[string, string]> = [];
    if (isSoccer || isUnknown) {
      for (const l of ['eng.1','esp.1','ita.1','ger.1','fra.1','ned.1','por.1','tur.1','mex.1','bra.1','arg.1','usa.1','chn.1','all']) {
        combos.push(['soccer', l]);
      }
    }
    if (isBasket || isUnknown)   combos.push(['basketball','nba'], ['basketball','wnba'], ['basketball','mens-college-basketball'], ['basketball','womens-college-basketball']);
    if (isBaseball || isUnknown) combos.push(['baseball','mlb']);
    if (isHockey   || isUnknown) combos.push(['hockey','nhl']);
    if (isAmFoot   || isUnknown) combos.push(['football','nfl'], ['football','college-football']);
    if (isAfl      || isUnknown) combos.push(['australian-football','afl']);
    if (isMma      || isUnknown) combos.push(['mma','ufc']);

    // Normalise team name for fuzzy comparison (remove punctuation, lowercase)
    const normTeam = (s: string) => (s ?? '').toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
    const expHome = expectedHomeTeam ? normTeam(expectedHomeTeam) : null;
    const expAway = expectedAwayTeam ? normTeam(expectedAwayTeam) : null;

    // Minimum token overlap to accept a team-name match (prevents short tokens like
    // "FC" / "AC" from triggering false positives).
    const teamsMatch = (espnHome: string, espnAway: string): boolean => {
      if (!expHome || !expAway) return true; // no expectation → accept any
      const eh = normTeam(espnHome);
      const ea = normTeam(espnAway);
      const MIN = 4;
      const homeOk = Math.min(eh.length, expHome.length) >= MIN && (eh.includes(expHome) || expHome.includes(eh));
      const awayOk = Math.min(ea.length, expAway.length) >= MIN && (ea.includes(expAway) || expAway.includes(ea));
      return homeOk && awayOk;
    };

    for (const [s, league] of combos) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${s}/${league}/summary?event=${eventId}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!resp.ok) continue;
        const data = await resp.json() as any;
        const comp = data?.header?.competitions?.[0];
        if (!comp) continue;
        const statusName: string = comp?.status?.type?.name ?? '';
        if (statusName !== 'STATUS_FINAL') continue;
        const competitors: any[] = comp?.competitors ?? [];
        const home = competitors.find((c: any) => c.homeAway === 'home');
        const away = competitors.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;
        const espnHomeName: string = home.team?.displayName ?? '';
        const espnAwayName: string = away.team?.displayName ?? '';
        // Guard: reject if the returned teams don't match what we expected.
        // ESPN numeric event IDs are NOT unique across sports/leagues — the same
        // integer can refer to a completely different completed match in another
        // competition, producing a spurious STATUS_FINAL result.
        if (!teamsMatch(espnHomeName, espnAwayName)) {
          console.warn(`[P2P ESPN] Event ${eventId} (${s}/${league}): ID collision — ESPN returned "${espnHomeName}" vs "${espnAwayName}" but expected "${expectedHomeTeam}" vs "${expectedAwayTeam}" — rejecting`);
          continue;
        }
        const homeScore = Number(home.score ?? 0);
        const awayScore = Number(away.score ?? 0);
        const winner: 'home' | 'away' | 'draw' =
          homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
        console.log(`[P2P ESPN] Event ${eventId} (${s}/${league}): ${espnHomeName} ${homeScore}-${awayScore} ${espnAwayName} → ${winner}`);
        return { winner, homeScore, awayScore, homeTeam: espnHomeName, awayTeam: espnAwayName };
      } catch {
        // try next combo
      }
    }

    return null;
  }

  /**
   * Secondary fallback: find a settled result by exact team names when the
   * event_id doesn't match anything in settled_events or external APIs.
   * sportName is used to pick the correct ESPN sport for Stage C.
   */
  private async fetchEventResultByTeamNames(homeTeam: string, awayTeam: string, sportName?: string, matchDate?: string | null, leagueName?: string | null): Promise<{
    winner: 'home' | 'away' | 'draw';
  } | null> {
    if (!homeTeam || !awayTeam) return null;

    // ── Date window: only accept results within ±2 days of expected match date ─
    // This prevents HISTORICAL results from a previous season being used when the
    // current match is still in progress or its result isn't in our DB yet.
    const matchMs = matchDate ? new Date(matchDate).getTime() : null;
    const withinMatchWindow = (dateStr: string) => {
      // No reference date at all → can't filter, accept anything.
      if (!matchMs) return true;
      // We have a reference date but the event carries no date → REJECT.
      // Accepting a date-less event when we have a known kickoff is unsafe —
      // it could be a result from any season.
      if (!dateStr) return false;
      const d = new Date(dateStr).getTime();
      // Unparseable date string → reject to be safe.
      if (isNaN(d)) return false;
      return Math.abs(d - matchMs) < 2 * 24 * 3600 * 1000;
    };

    // ── Stage A: settled_events table (exact team-name match) ────────────────
    try {
      const rows = (await db.execute(sql`
        SELECT winner, settled_at FROM settled_events
        WHERE LOWER(REGEXP_REPLACE(home_team, '[^a-zA-Z0-9 ]', '', 'g')) = LOWER(REGEXP_REPLACE(${homeTeam}, '[^a-zA-Z0-9 ]', '', 'g'))
          AND LOWER(REGEXP_REPLACE(away_team, '[^a-zA-Z0-9 ]', '', 'g')) = LOWER(REGEXP_REPLACE(${awayTeam}, '[^a-zA-Z0-9 ]', '', 'g'))
          AND winner IS NOT NULL
        ORDER BY id DESC LIMIT 5
      `)) as any;
      const allRows: any[] = rows.rows ?? rows;
      // Only use a settled_events result if it falls within the match date window
      const r = allRows.find(row => withinMatchWindow(row.settled_at ?? row.created_at ?? ''));
      if (r?.winner) {
        console.log(`[P2P TeamName] Found result for ${homeTeam} vs ${awayTeam} by team name: ${r.winner}`);
        return { winner: r.winner as 'home' | 'away' | 'draw' };
      }
      if (allRows.length > 0) {
        console.log(`[P2P TeamName] Found ${allRows.length} historical result(s) for ${homeTeam} vs ${awayTeam} but none within match date window — skipping stale cache`);
      }
    } catch (e: any) {
      console.warn(`[P2P TeamName] DB lookup failed: ${e.message}`);
    }

    // ── Stage B: TheSportsDB (free, no key) ──────────────────────────────────
    try {
      const q = encodeURIComponent(`${homeTeam} vs ${awayTeam}`);
      const url = `https://www.thesportsdb.com/api/v1/json/3/searchevents.php?e=${q}`;
      console.log(`[P2P TSDB] Querying TheSportsDB: ${url}`);
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const data = await resp.json() as any;
        const events: any[] = data?.event ?? [];
        console.log(`[P2P TSDB] TheSportsDB returned ${events.length} events for "${homeTeam} vs ${awayTeam}"`);
        // Find finished events — AND require date within match window to prevent
        // historical results from a previous season being mistakenly used.
        // IMPORTANT: do NOT use `score !== null` as a proxy for "finished" — a
        // live in-progress game also has scores. Require an explicit finished status.
        const finished = events.filter((e: any) => {
          const status = (e.strStatus ?? '').toLowerCase();
          const hasResult = status === 'ft' || status === 'match finished' ||
            status.includes('finished') || status.includes('full time') ||
            status.includes('full-time') || status === 'aet' || status === 'pen';
          return hasResult && withinMatchWindow(e.dateEvent ?? '');
        });
        if (finished.length > 0) {
          // Sort by date descending, pick the most recent
          finished.sort((a: any, b: any) => (b.dateEvent ?? '').localeCompare(a.dateEvent ?? ''));
          const ev = finished[0];
          const homeScore = Number(ev.intHomeScore ?? 0);
          const awayScore = Number(ev.intAwayScore ?? 0);
          const winner: 'home' | 'away' | 'draw' =
            homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'draw';
          console.log(`[P2P TSDB] ${homeTeam} ${homeScore}-${awayScore} ${awayTeam} → ${winner} (date: ${ev.dateEvent})`);
          return { winner };
        } else {
          const allFinished = events.filter((e: any) => {
            const status = (e.strStatus ?? '').toLowerCase();
            return status === 'ft' || status === 'match finished' ||
              status.includes('finished') || status.includes('full time') ||
              status.includes('full-time') || status === 'aet' || status === 'pen';
          });
          if (allFinished.length > 0) {
            console.warn(`[P2P TSDB] ${allFinished.length} finished result(s) for "${homeTeam} vs ${awayTeam}" found but all outside match date window — refusing stale data`);
          }
        }
      } else {
        console.warn(`[P2P TSDB] HTTP ${resp.status} for ${homeTeam} vs ${awayTeam}`);
      }
    } catch (e: any) {
      console.warn(`[P2P TSDB] TheSportsDB lookup failed: ${e.message}`);
    }

    // ── Stage C: ESPN scoreboard by team name (720h lookback) ────────────────
    // Searches the correct ESPN sport based on the sportName hint.
    // No API key required. Matches by normalised team name.
    try {
      const norm = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
      const nHome = norm(homeTeam);
      const nAway = norm(awayTeam);

      // Map sportName → ESPN sport slug used by espnSportsService.getFinishedEvents.
      // When sportName is absent, fall back to leagueName (e.g. "WNBA" → basketball).
      const s = (sportName ?? '').toLowerCase().trim();
      const l = (leagueName ?? '').toLowerCase().trim();
      // Combine: prefer sportName, fall back to leagueName for classification
      const hint = s || l;
      let espnSport: string;
      if (hint === 'basketball' || hint === 'nba' || hint === 'wnba' ||
          l === 'nba' || l === 'wnba' || l === 'ncaa basketball' || l === 'fiba') {
        espnSport = 'basketball';
      } else if (hint === 'baseball' || hint === 'mlb' || l === 'mlb') {
        espnSport = 'baseball';
      } else if (hint === 'hockey' || hint === 'ice-hockey' || hint === 'ice hockey' || hint === 'nhl' || l === 'nhl') {
        espnSport = 'hockey';
      } else if (hint === 'american-football' || hint === 'american football' || hint === 'nfl' || l === 'nfl' || l === 'ncaa football') {
        espnSport = 'american-football';
      } else if (hint === 'tennis' || l === 'atp' || l === 'wta') {
        espnSport = 'tennis';
      } else if (hint === 'rugby' || hint === 'afl' || hint === 'handball' || hint === 'volleyball' ||
               hint === 'mma' || hint === 'cricket' || hint === 'golf') {
        espnSport = hint;
      } else {
        espnSport = 'football'; // soccer / default
      }

      console.log(`[P2P ESPN-Scoreboard] Searching finished ${espnSport} for "${homeTeam}" vs "${awayTeam}" (720h lookback)`);
      const finished = await espnSportsService.getFinishedEvents(espnSport, 720);
      console.log(`[P2P ESPN-Scoreboard] ${finished.length} finished ${espnSport} events returned`);

      // Only accept events within the match date window — prevents a different
      // fixture between the same two teams (e.g. Copa del Rey vs La Liga) from
      // being mistakenly used when the correct game isn't cached yet.
      const match = finished.find(e =>
        norm(e.homeTeam) === nHome &&
        norm(e.awayTeam) === nAway &&
        withinMatchWindow((e as any).startTime ?? (e as any).date ?? ''),
      );
      if (match) {
        const hs = Number(match.homeScore ?? 0);
        const as_ = Number(match.awayScore ?? 0);
        const winner: 'home' | 'away' | 'draw' = hs > as_ ? 'home' : as_ > hs ? 'away' : 'draw';
        console.log(`[P2P ESPN-Scoreboard] FOUND: ${match.homeTeam} ${hs}-${as_} ${match.awayTeam} → ${winner} (date: ${(match as any).startTime ?? 'unknown'})`);
        return { winner };
      }
      // Fuzzy fallback: partial name matching (handles "AFC Bournemouth" vs "Bournemouth")
      // Also requires date window to avoid cross-competition contamination.
      // Minimum token length of 5 chars prevents short abbreviations (e.g. "AC", "FC")
      // from falsely matching unrelated clubs.
      const fuzzy = finished.find(e => {
        const eh = norm(e.homeTeam);
        const ea = norm(e.awayTeam);
        const dateOk = withinMatchWindow((e as any).startTime ?? (e as any).date ?? '');
        if (!dateOk) return false;
        const minLen = 5;
        const homeMatch = Math.min(eh.length, nHome.length) >= minLen &&
          (eh.includes(nHome) || nHome.includes(eh));
        const awayMatch = Math.min(ea.length, nAway.length) >= minLen &&
          (ea.includes(nAway) || nAway.includes(ea));
        return homeMatch && awayMatch;
      });
      if (fuzzy) {
        const hs = Number(fuzzy.homeScore ?? 0);
        const as_ = Number(fuzzy.awayScore ?? 0);
        const winner: 'home' | 'away' | 'draw' = hs > as_ ? 'home' : as_ > hs ? 'away' : 'draw';
        console.log(`[P2P ESPN-Scoreboard] FUZZY: ${fuzzy.homeTeam} ${hs}-${as_} ${fuzzy.awayTeam} → ${winner} (date: ${(fuzzy as any).startTime ?? 'unknown'})`);
        return { winner };
      }
      console.log(`[P2P ESPN-Scoreboard] No match found for "${homeTeam}" vs "${awayTeam}" within ±2d of match date`);
    } catch (e: any) {
      console.warn(`[P2P ESPN-Scoreboard] Failed: ${e.message}`);
    }

    return null;
  }

  // ── Fantasy H2H settlement ────────────────────────────────────────────────
  // Called for every filled p2p_bet_offer where market_type = 'fantasy_h2h'.
  // Compares total_points in fantasy_teams for creator vs taker; only runs
  // after the WC2026 final (Jul 19 2026). Ties are refunded.
  private async _settleFantasyH2HOffer(offer: any) {
    // Gameweek-aware settlement deadlines:
    //   md1        → after all MD1 group matches (Jun 27)
    //   group      → after all group stage matches (Jul 3)
    //   knockout   → after the Final (Jul 19)
    //   tournament → full tournament settled (Jul 20)
    const GAMEWEEK_DEADLINES: Record<string, string> = {
      md1:        '2026-06-27T00:00:00Z',
      group:      '2026-07-03T00:00:00Z',
      knockout:   '2026-07-19T00:00:00Z',
      tournament: '2026-07-20T00:00:00Z',
    };
    // Extract gameweek from eventId: "fantasy_wc2026_h2h_md1" → "md1"
    const eventId  = (offer.eventId ?? offer.event_id ?? '') as string;
    const gameweek = eventId.replace('fantasy_wc2026_h2h_', '') || 'tournament';
    const deadline = GAMEWEEK_DEADLINES[gameweek] ?? GAMEWEEK_DEADLINES.tournament;
    if (Date.now() < new Date(deadline).getTime()) {
      console.log(`[FantasyH2H] Offer ${offer.id} (${gameweek}) — not settled yet. Deadline: ${deadline.slice(0, 10)}.`);
      return;
    }

    // Find the taker wallet from p2p_bet_matches
    const [matchRow] = await db.execute(sql`
      SELECT id, taker_wallet, stake, taker_fee_rate, maker_rebate_rate, settlement_tx_hash, onchain_match_id
      FROM p2p_bet_matches
      WHERE offer_id = ${offer.id} AND status IN ('active','settling')
      LIMIT 1
    `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

    if (!matchRow) {
      console.log(`[FantasyH2H] Offer ${offer.id} — no active taker match. Marking settled with no payout.`);
      await db.execute(sql`
        UPDATE p2p_bet_offers SET status = 'settled', settled_at = NOW() WHERE id = ${offer.id}
      `);
      return;
    }

    // Crash-recovery: already has a payout tx — just finalise status
    if (matchRow.settlement_tx_hash) {
      await db.execute(sql`
        UPDATE p2p_bet_matches SET status = 'won', settled_at = NOW() WHERE id = ${matchRow.id}
      `);
      await db.execute(sql`
        UPDATE p2p_bet_offers SET status = 'settled', settled_at = NOW() WHERE id = ${offer.id}
      `);
      return;
    }

    const creatorWallet = offer.creatorWallet ?? offer.creator_wallet;
    const takerWallet   = matchRow.taker_wallet as string;

    // Parse market metadata from prediction field (JSON-encoded since the new flow)
    let h2hMarket = 'squad_points';
    let h2hPickId: string | undefined;
    let h2hGoalsLine: number | undefined;
    let h2hOuSide: 'over' | 'under' | undefined;
    try {
      const pred = JSON.parse(offer.prediction ?? '{}');
      if (pred.market) h2hMarket = pred.market;
      h2hPickId     = pred.pickId;
      h2hGoalsLine  = pred.goalsLine !== undefined ? Number(pred.goalsLine) : undefined;
      h2hOuSide     = pred.ouSide as 'over' | 'under' | undefined;
    } catch { /* legacy offer — prediction='home' → default squad_points */ }

    // Look up fantasy team composition for both wallets
    const [creatorTeam] = await db.execute(sql`
      SELECT total_points, starter_ids, captain_id FROM fantasy_teams WHERE wallet_address = ${creatorWallet} AND locked = true LIMIT 1
    `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

    const [takerTeam] = await db.execute(sql`
      SELECT total_points, starter_ids, captain_id FROM fantasy_teams WHERE wallet_address = ${takerWallet} AND locked = true LIMIT 1
    `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

    let creatorPts: number;
    let takerPts: number;

    if (h2hMarket === 'squad_points') {
      // Fast path: use the precomputed total_points from the scoring worker
      creatorPts = Number(creatorTeam?.total_points ?? 0);
      takerPts   = Number(takerTeam?.total_points   ?? 0);
    } else if (h2hMarket === 'over_under') {
      // over_under: compare total goals scored against the goalsLine
      // Each side's score = raw goal count. Creator wins if their prediction (over/under line) holds.
      const creatorGoals = await computeFantasyH2HMarketPoints('over_under', creatorTeam?.starter_ids ?? [], creatorTeam?.captain_id ?? '');
      const takerGoals   = await computeFantasyH2HMarketPoints('over_under', takerTeam?.starter_ids ?? [],   takerTeam?.captain_id   ?? '');
      const totalGoals   = creatorGoals + takerGoals;
      const line         = h2hGoalsLine ?? 4.5;
      const creatorPicks = h2hOuSide ?? 'over';
      // Creator wins if their over/under call is correct (totals across both squads)
      const overHit = totalGoals > line;
      creatorPts = (creatorPicks === 'over' && overHit) || (creatorPicks === 'under' && !overHit) ? 1 : 0;
      takerPts   = 1 - creatorPts;
      // Normalise: use 1/0 to drive the winner logic below (creatorPts > takerPts = creator wins)
    } else {
      // Market-specific scoring: recompute from starter_ids
      const creatorStarters = (creatorTeam?.starter_ids as string[]) ?? [];
      const takerStarters   = (takerTeam?.starter_ids   as string[]) ?? [];
      const creatorCaptain  = (creatorTeam?.captain_id  as string)   ?? '';
      const takerCaptain    = (takerTeam?.captain_id    as string)   ?? '';
      // For top_scorer, each side picks their own forward — taker's pickId is stored separately (not yet supported, fallback to same pickId)
      creatorPts = await computeFantasyH2HMarketPoints(h2hMarket, creatorStarters, creatorCaptain, h2hPickId);
      takerPts   = await computeFantasyH2HMarketPoints(h2hMarket, takerStarters,   takerCaptain);
    }

    console.log(`[FantasyH2H] Offer ${offer.id} (${h2hMarket}): ${creatorWallet.slice(0,10)}… ${creatorPts}pts vs ${takerWallet.slice(0,10)}… ${takerPts}pts`);

    // Tie → refund both sides
    const onchainBetId = (matchRow.onchain_match_id ?? matchRow.onchainMatchId) as string | null;
    if (creatorPts === takerPts) {
      console.log(`[FantasyH2H] Offer ${offer.id} — TIE (${creatorPts} pts each). Refunding both sides.`);
      const currency = offer.currency ?? 'SUI';
      if (onchainBetId) {
        const coinType   = p2pContractService.resolveCoinType(currency);
        const voidResult = await p2pContractService.instantVoidBet(onchainBetId, coinType);
        console.log(`[FantasyH2H] on-chain void (tie) ${onchainBetId.slice(0, 16)}… → ${voidResult.success ? 'OK' : voidResult.error}`);
      } else {
        const takerStake = Number(matchRow.stake);
        await this._sendRefund(takerWallet, takerStake, currency, `fantasy_h2h tie refund offer #${offer.id}`);
        await this._sendRefund(creatorWallet, offer.creatorStake ?? offer.creator_stake ?? 0, currency, `fantasy_h2h tie refund offer #${offer.id}`);
      }
      await db.execute(sql`UPDATE p2p_bet_matches SET status='cancelled', settled_at=NOW() WHERE id=${matchRow.id}`);
      await db.execute(sql`UPDATE p2p_bet_offers  SET status='settled',   settled_at=NOW(), winner='tie' WHERE id=${offer.id}`);
      return;
    }

    const creatorWon = creatorPts > takerPts;
    const winnerWallet = creatorWon ? creatorWallet : takerWallet;

    // Lock match into settling
    await db.execute(sql`
      UPDATE p2p_bet_matches SET status = 'settling'
      WHERE id = ${matchRow.id} AND status IN ('active','settling')
    `);

    // Calculate payout
    const safeOfferTakerStake = (offer.takerStake ?? (offer.taker_stake && offer.taker_stake > 0))
      ? (offer.takerStake ?? offer.taker_stake)
      : (offer.creatorStake ?? offer.creator_stake ?? 0) * Math.max((offer.odds ?? 2) - 1, 0.0001);
    const { netFee, winnerPayout } = calcSingleMatchPayout({
      takerStake:        Number(matchRow.stake),
      offerOdds:         offer.odds ?? 2,
      offerCreatorStake: offer.creatorStake ?? offer.creator_stake ?? 0,
      offerTakerStake:   safeOfferTakerStake,
      takerFeeRate:      Number(matchRow.taker_fee_rate ?? 0.02),
      makerRebateRate:   Number(matchRow.maker_rebate_rate ?? 0),
    });

    let settlementTxHash: string | undefined;
    try {
      const currency      = offer.currency ?? 'SUI';
      const onchainBetId  = (matchRow.onchain_match_id ?? matchRow.onchainMatchId) as string | null;
      let result: { success: boolean; txHash?: string; error?: string };

      if (onchainBetId) {
        // ── On-chain settlement ──────────────────────────────────────────────
        // The Move contract holds both stakes in a P2PMatchedBet<T> object.
        // instantSettleBet pays the winner directly from the contract and
        // collects the platform fee into the fee vault — no admin wallet needed.
        const coinType  = p2pContractService.resolveCoinType(currency);
        const makerWins = creatorWon; // creator posted the offer → maker
        result          = await p2pContractService.instantSettleBet(onchainBetId, makerWins, coinType);
        console.log(`[FantasyH2H] on-chain settle ${onchainBetId.slice(0, 16)}… makerWins=${makerWins}`);
      } else if (currency === 'SBETS') {
        result = await blockchainBetService.sendSbetsToUser(winnerWallet, winnerPayout);
      } else {
        result = await blockchainBetService.sendSuiToUser(winnerWallet, winnerPayout);
      }

      if (result.success && result.txHash) {
        settlementTxHash = result.txHash;
        console.log(`[FantasyH2H] ✅ Offer ${offer.id} — ${creatorWon ? 'creator' : 'taker'} wins ${winnerPayout} ${currency} | TX: ${settlementTxHash}`);
      } else if (result.error?.startsWith('ALREADY_TERMINAL')) {
        // Bet already settled on-chain from a prior attempt — proceed to update DB
        console.log(`[FantasyH2H] ✅ Offer ${offer.id} already terminal on-chain — marking settled in DB`);
      } else {
        console.error(`[FantasyH2H] ❌ Offer ${offer.id} payout failed: ${result.error}`);
        return;
      }
    } catch (e: any) {
      console.error(`[FantasyH2H] ❌ Offer ${offer.id} payout error: ${e.message}`);
      return;
    }

    const matchStatus = creatorWon ? 'lost' : 'won';
    await db.execute(sql`
      UPDATE p2p_bet_matches
      SET status = ${matchStatus}, settlement_tx_hash = ${settlementTxHash ?? null},
          settled_at = NOW(), platform_fee = ${netFee}, actual_payout = ${winnerPayout},
          winner = ${winnerWallet}
      WHERE id = ${matchRow.id}
    `);
    await db.execute(sql`
      UPDATE p2p_bet_offers
      SET status = 'settled', settled_at = NOW(),
          winner = ${creatorWon ? 'creator' : 'taker'},
          settlement_tx_hash = ${settlementTxHash ?? null},
          platform_fee = ${netFee}
      WHERE id = ${offer.id}
    `);
    console.log(`[FantasyH2H] ✅ Offer ${offer.id} fully settled.`);
  }

  // Public wrapper used by the test-settle endpoint — skips the TOURNAMENT_END
  // date gate so E2E tests can settle immediately without waiting for July 2026.
  // dryRun=true skips the blockchain payout (used in dev with no admin key).
  public async settleFantasyH2HNow(offerId: number, dryRun = false): Promise<{ winner: string; creatorPts: number; takerPts: number }> {
    const [offer] = await db.select().from(p2pBetOffers).where(eq(p2pBetOffers.id, offerId)).limit(1);
    if (!offer) throw new Error(`Offer ${offerId} not found`);
    if ((offer as any).marketType !== 'fantasy_h2h') throw new Error(`Offer ${offerId} is not a fantasy_h2h offer`);
    return this._settleFantasyH2HOffer_noDateGate(offer, dryRun);
  }

  // Identical to _settleFantasyH2HOffer but without the early-return date guard.
  // dryRun=true: skips the blockchain payout, used in dev without ADMIN_PRIVATE_KEY.
  private async _settleFantasyH2HOffer_noDateGate(offer: any, dryRun = false): Promise<{ winner: string; creatorPts: number; takerPts: number }> {
    const [matchRow] = await db.execute(sql`
      SELECT id, taker_wallet, stake, taker_fee_rate, maker_rebate_rate, settlement_tx_hash, onchain_match_id
      FROM p2p_bet_matches
      WHERE offer_id = ${offer.id} AND status IN ('active','settling')
      LIMIT 1
    `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

    if (!matchRow) {
      console.log(`[FantasyH2H] Offer ${offer.id} — no active taker match. Marking settled with no payout.`);
      await db.execute(sql`UPDATE p2p_bet_offers SET status = 'settled', settled_at = NOW() WHERE id = ${offer.id}`);
      return { winner: 'none', creatorPts: 0, takerPts: 0 };
    }
    if (matchRow.settlement_tx_hash) {
      await db.execute(sql`UPDATE p2p_bet_matches SET status = 'won', settled_at = NOW() WHERE id = ${matchRow.id}`);
      await db.execute(sql`UPDATE p2p_bet_offers  SET status = 'settled', settled_at = NOW() WHERE id = ${offer.id}`);
      return { winner: 'already-settled', creatorPts: 0, takerPts: 0 };
    }

    const creatorWallet = offer.creatorWallet ?? offer.creator_wallet;
    const takerWallet   = matchRow.taker_wallet as string;

    // Parse market metadata
    let h2hMarket = 'squad_points';
    let h2hPickId: string | undefined;
    let h2hGoalsLine: number | undefined;
    let h2hOuSide: 'over' | 'under' | undefined;
    try {
      const pred = JSON.parse(offer.prediction ?? '{}');
      if (pred.market) h2hMarket = pred.market;
      h2hPickId    = pred.pickId;
      h2hGoalsLine = pred.goalsLine !== undefined ? Number(pred.goalsLine) : undefined;
      h2hOuSide    = pred.ouSide as 'over' | 'under' | undefined;
    } catch { /* legacy offer */ }

    const [creatorTeam] = await db.execute(sql`
      SELECT total_points, starter_ids, captain_id FROM fantasy_teams WHERE wallet_address = ${creatorWallet} AND locked = true LIMIT 1
    `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);
    const [takerTeam] = await db.execute(sql`
      SELECT total_points, starter_ids, captain_id FROM fantasy_teams WHERE wallet_address = ${takerWallet} AND locked = true LIMIT 1
    `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

    let creatorPts: number;
    let takerPts: number;

    if (h2hMarket === 'squad_points') {
      creatorPts = Number(creatorTeam?.total_points ?? 0);
      takerPts   = Number(takerTeam?.total_points   ?? 0);
    } else if (h2hMarket === 'over_under') {
      const cg = await computeFantasyH2HMarketPoints('over_under', creatorTeam?.starter_ids ?? [], creatorTeam?.captain_id ?? '');
      const tg = await computeFantasyH2HMarketPoints('over_under', takerTeam?.starter_ids   ?? [], takerTeam?.captain_id   ?? '');
      const total = cg + tg;
      const line  = h2hGoalsLine ?? 4.5;
      const pick  = h2hOuSide ?? 'over';
      const hit   = total > line;
      creatorPts  = ((pick === 'over' && hit) || (pick === 'under' && !hit)) ? 1 : 0;
      takerPts    = 1 - creatorPts;
    } else {
      creatorPts = await computeFantasyH2HMarketPoints(h2hMarket, (creatorTeam?.starter_ids as string[]) ?? [], (creatorTeam?.captain_id as string) ?? '', h2hPickId);
      takerPts   = await computeFantasyH2HMarketPoints(h2hMarket, (takerTeam?.starter_ids   as string[]) ?? [], (takerTeam?.captain_id   as string) ?? '');
    }

    console.log(`[FantasyH2H/Test] Offer ${offer.id} (${h2hMarket}): creator ${creatorPts}pts vs taker ${takerPts}pts`);

    const onchainBetId = (matchRow.onchain_match_id ?? matchRow.onchainMatchId) as string | null;

    if (creatorPts === takerPts) {
      if (!dryRun) {
        const currency = offer.currency ?? 'SUI';
        if (onchainBetId) {
          // On-chain tie → void_bet refunds both parties directly from the contract
          const coinType = p2pContractService.resolveCoinType(currency);
          const voidResult = await p2pContractService.instantVoidBet(onchainBetId, coinType);
          console.log(`[FantasyH2H/Test] on-chain void (tie) ${onchainBetId.slice(0, 16)}… → ${voidResult.success ? 'OK' : voidResult.error}`);
        } else {
          const takerStake = Number(matchRow.stake);
          await this._sendRefund(takerWallet, takerStake, currency, `fantasy_h2h tie refund offer #${offer.id}`);
          await this._sendRefund(creatorWallet, offer.creatorStake ?? offer.creator_stake ?? 0, currency, `fantasy_h2h tie refund offer #${offer.id}`);
        }
      } else {
        console.log(`[FantasyH2H/Test] dryRun — skipping refund payouts for tie`);
      }
      await db.execute(sql`UPDATE p2p_bet_matches SET status='cancelled', settled_at=NOW() WHERE id=${matchRow.id}`);
      await db.execute(sql`UPDATE p2p_bet_offers  SET status='settled',   settled_at=NOW(), winner='tie' WHERE id=${offer.id}`);
      return { winner: 'tie', creatorPts, takerPts };
    }

    const creatorWon   = creatorPts > takerPts;
    const winnerWallet = creatorWon ? creatorWallet : takerWallet;

    await db.execute(sql`UPDATE p2p_bet_matches SET status = 'settling' WHERE id = ${matchRow.id} AND status IN ('active','settling')`);

    const safeOfferTakerStake = (offer.takerStake ?? (offer.taker_stake && offer.taker_stake > 0))
      ? (offer.takerStake ?? offer.taker_stake)
      : (offer.creatorStake ?? offer.creator_stake ?? 0) * Math.max((offer.odds ?? 2) - 1, 0.0001);
    const { netFee, winnerPayout } = calcSingleMatchPayout({
      takerStake:        Number(matchRow.stake),
      offerOdds:         offer.odds ?? 2,
      offerCreatorStake: offer.creatorStake ?? offer.creator_stake ?? 0,
      offerTakerStake:   safeOfferTakerStake,
      takerFeeRate:      Number(matchRow.taker_fee_rate ?? 0.02),
      makerRebateRate:   Number(matchRow.maker_rebate_rate ?? 0),
    });

    let settlementTxHash: string | undefined;
    if (!dryRun) {
      try {
        const currency = offer.currency ?? 'SUI';
        let result: { success: boolean; txHash?: string; error?: string };
        if (onchainBetId) {
          // On-chain settlement — contract pays winner, collects fee into vault
          const coinType  = p2pContractService.resolveCoinType(currency);
          const makerWins = creatorWon;
          result          = await p2pContractService.instantSettleBet(onchainBetId, makerWins, coinType);
          console.log(`[FantasyH2H/Test] on-chain settle ${onchainBetId.slice(0, 16)}… makerWins=${makerWins}`);
        } else if (currency === 'SBETS') {
          result = await blockchainBetService.sendSbetsToUser(winnerWallet, winnerPayout);
        } else {
          result = await blockchainBetService.sendSuiToUser(winnerWallet, winnerPayout);
        }
        if (result.success && result.txHash) {
          settlementTxHash = result.txHash;
          console.log(`[FantasyH2H/Test] ✅ Offer ${offer.id} — ${creatorWon ? 'creator' : 'taker'} wins ${winnerPayout} ${offer.currency ?? 'SUI'} | TX: ${settlementTxHash}`);
        } else if (result.error?.startsWith('ALREADY_TERMINAL')) {
          // Bet already settled on-chain from a prior attempt — proceed to update DB
          console.log(`[FantasyH2H/Test] ✅ Offer ${offer.id} already terminal on-chain — marking settled in DB`);
        } else {
          throw new Error(result.error ?? 'Payout failed');
        }
      } catch (e: any) {
        console.error(`[FantasyH2H/Test] ❌ Payout error: ${e.message}`);
        throw e;
      }
    } else {
      console.log(`[FantasyH2H/Test] dryRun — skipping blockchain payout of ${winnerPayout} ${offer.currency ?? 'SUI'} to ${winnerWallet.slice(0, 12)}…`);
    }

    const matchStatus = creatorWon ? 'lost' : 'won';
    await db.execute(sql`
      UPDATE p2p_bet_matches
      SET status = ${matchStatus}, settlement_tx_hash = ${settlementTxHash ?? null},
          settled_at = NOW(), platform_fee = ${netFee}, actual_payout = ${winnerPayout},
          winner = ${winnerWallet}
      WHERE id = ${matchRow.id}
    `);
    await db.execute(sql`
      UPDATE p2p_bet_offers
      SET status = 'settled', settled_at = NOW(),
          winner = ${creatorWon ? 'creator' : 'taker'},
          settlement_tx_hash = ${settlementTxHash ?? null},
          platform_fee = ${netFee}
      WHERE id = ${offer.id}
    `);
    console.log(`[FantasyH2H/Test] ✅ Offer ${offer.id} fully settled — ${creatorWon ? 'creator' : 'taker'} wins ${winnerPayout} ${offer.currency ?? 'SUI'}${dryRun ? ' (dry-run)' : ''}`);
    return { winner: creatorWon ? 'creator' : 'taker', creatorPts, takerPts };
  }

  private async settleFilledOffers() {
    // Include BOTH fully-filled offers AND open offers that have active matches
    // (partial fills — event may settle while some taker stake is still unfilled).
    const [fullyFilled, activeMatchRows] = await Promise.all([
      db.select().from(p2pBetOffers).where(eq(p2pBetOffers.status, 'filled')),
      db.selectDistinct({ offerId: p2pBetMatches.offerId })
        .from(p2pBetMatches)
        .where(eq(p2pBetMatches.status, 'active')),
    ]);

    const offersToSettle = [...fullyFilled];
    const alreadyQueued = new Set(fullyFilled.map(o => o.id));

    const extraIds = activeMatchRows
      .map(r => r.offerId)
      .filter((id): id is number => id != null && !alreadyQueued.has(id));

    if (extraIds.length > 0) {
      const extraOffers = await db.select().from(p2pBetOffers)
        .where(and(
          inArray(p2pBetOffers.id, extraIds),
          // Include 'expired' — on-chain fill detected after DB expiry ran.
          // Include 'settled' — crash recovery: offer was marked settled but
          // the match payout TX never went through (settlement_tx_hash IS NULL
          // on the match). The per-match lock in the settlement loop prevents
          // any double-payout — only 'active' or 'settling+no-txhash' matches
          // are ever re-processed.
          or(
            eq(p2pBetOffers.status, 'open'),
            eq(p2pBetOffers.status, 'partial'),
            eq(p2pBetOffers.status, 'expired'),
            eq(p2pBetOffers.status, 'settled'),
          ),
        ));
      offersToSettle.push(...extraOffers);
    }

    for (const offer of offersToSettle) {
      try {
        // ── Fantasy H2H: settle by comparing total fantasy points ────────────
        if ((offer as any).marketType === 'fantasy_h2h') {
          await this._settleFantasyH2HOffer(offer);
          continue;
        }

        // ── Kickoff guard: never settle before the match has had enough time to finish ──
        // 110 minutes covers soccer (90 + extra time), basketball (48 min),
        // hockey (60 min), and every other sport we support.
        // This must run BEFORE any external lookup — including ESPN direct — because ESPN
        // can occasionally report STATUS_FINAL during a live match (data glitch) or when
        // an unrelated completed match shares the same numeric event ID in another sport
        // or league. Without this guard, a glitch STATUS_FINAL would bypass all other
        // checks and cache a wrong result into settled_events permanently.
        // Historical root cause: offer #62 (Villarreal vs Atlético) and offers #33/52/59
        // (Crystal Palace vs Arsenal) were both settled early due to this missing guard.
        const matchKickoffMs = offer.matchDate ? new Date(offer.matchDate).getTime() : null;
        const nowMs = Date.now();
        if (matchKickoffMs && nowMs < matchKickoffMs + 110 * 60 * 1000) {
          const elapsedMin = Math.round((nowMs - matchKickoffMs) / 60000);
          const waitMin = Math.ceil((matchKickoffMs + 110 * 60 * 1000 - nowMs) / 60000);
          console.log(`[P2P] ⏳ Offer ${offer.id} — match kicked off ${elapsedMin}m ago, need 110m total. Waiting ${waitMin}m more. Skipping.`);
          continue;
        }

        let [settled] = await db.select().from(settledEvents)
          .where(eq(settledEvents.externalEventId, offer.eventId));
        if (!settled) {
          // settled_events not yet populated — try ESPN directly (sport-aware).
          // Pass expected team names so the function can reject ID collisions where
          // the same numeric eventId points to a different completed match in another
          // ESPN sport/league (the root cause of the Villarreal offer #62 mis-settlement).
          const espnResult = await this.fetchEventResultFromESPN(
            offer.eventId,
            offer.sportName ?? undefined,
            offer.homeTeam ?? undefined,
            offer.awayTeam ?? undefined,
          );
          if (!espnResult) {
            // Final fallback: search settled_events by team names (date-filtered).
            // The 110-minute kickoff guard at the top of this loop already ensures we
            // don't attempt this path for matches that haven't had enough time to finish.
            const teamResult = await this.fetchEventResultByTeamNames(offer.homeTeam ?? '', offer.awayTeam ?? '', offer.sportName ?? undefined, offer.matchDate ?? null, offer.leagueName ?? undefined);
            if (!teamResult) {
              console.log(`[P2P] Event ${offer.eventId} not yet finished — skipping offer ${offer.id}`);
              continue;
            }
            // Team-name match — synthesise a settled entry using the winner only
            settled = { winner: teamResult.winner, externalEventId: offer.eventId } as any;
            console.log(`[P2P TeamName] Using team-name result for offer ${offer.id}: ${teamResult.winner}`);
          } else {
            // Cache into settled_events so subsequent cycles are instant
            try {
              const [inserted] = await db.insert(settledEvents).values({
                externalEventId: offer.eventId,
                homeTeam: espnResult.homeTeam || offer.homeTeam || '',
                awayTeam: espnResult.awayTeam || offer.awayTeam || '',
                homeScore: espnResult.homeScore,
                awayScore: espnResult.awayScore,
                winner: espnResult.winner,
                betsSettled: 0,
              }).returning();
              settled = inserted;
            } catch {
              settled = { winner: espnResult.winner, externalEventId: offer.eventId } as any;
            }
            console.log(`[P2P ESPN] Cached result for event ${offer.eventId}: ${espnResult.winner}`);
          }
        }

        const creatorWon = predictionWon(
          offer.prediction, offer.homeTeam, offer.awayTeam, settled.winner ?? '',
          (settled as any).homeScore ?? undefined, (settled as any).awayScore ?? undefined,
        );

        // Atomically lock matches into 'settling' to prevent double-payout on crash.
        // Also picks up stuck 'settling' matches with no txHash for crash recovery (retry payout).
        const lockResult = await db.execute(sql`
          UPDATE p2p_bet_matches
          SET status = 'settling'
          WHERE offer_id = ${offer.id}
            AND (
              status = 'active'
              OR (status = 'settling' AND settlement_tx_hash IS NULL)
            )
          RETURNING *
        `);

        // ── Zero-match safety guard ──────────────────────────────────────────
        // If no active/settling matches were found, check whether this offer
        // ever had any taker matches at all (regardless of current status).
        // An offer that had matches but all are now cancelled/voided means the
        // taker was refunded BEFORE the settlement payout ran — the winner
        // never received their funds.  Rather than silently marking the offer
        // as 'settled' with no payout (settlement_tx_hash=NULL), we abort this
        // cycle and log a critical alert so it can be investigated/retried.
        const rawMatches = (lockResult as any).rows ?? (lockResult as any) as any[];
        if (rawMatches.length === 0) {
          const [anyMatch] = await db.execute(sql`
            SELECT id, status, taker_wallet, stake
            FROM p2p_bet_matches
            WHERE offer_id = ${offer.id}
            LIMIT 1
          `).then((r: any) => (r.rows ?? r) as any[]).catch(() => []);

          if (anyMatch) {
            // Offer has match records but none are active — the winner was never
            // paid.  Keep the offer in its current status so the next run picks
            // it up, and log loudly for manual review.
            console.error(
              `[P2P] 🚨 CRITICAL — Offer ${offer.id}: result known (${creatorWon ? 'creator' : 'taker'} wins) ` +
              `but all matches are non-active (match #${anyMatch.id} status='${anyMatch.status}'). ` +
              `Winner payout was never sent. Offer status kept as '${offer.status}' for manual review. ` +
              `Check p2p_bet_matches for offer ${offer.id}.`
            );
          } else {
            // Genuinely no taker matches — creator posted but no one accepted.
            // Mark settled with no winner payout (stake already refunded or never escrowed).
            console.log(`[P2P] Offer ${offer.id} has no taker matches — marking settled with no payout.`);
            await db.update(p2pBetOffers).set({
              status: 'settled',
              winner: creatorWon ? 'creator' : 'taker',
              settledAt: new Date(),
            }).where(eq(p2pBetOffers.id, offer.id));
          }
          continue;
        }
        // Normalize snake_case columns from raw SQL RETURNING * to camelCase so
        // all downstream accesses (takerWallet, takerFeeRate, etc.) are safe.
        const normalizeMatchRow = (row: any) => ({
          ...row,
          id:               row.id,
          stake:            row.stake,
          takerWallet:      row.taker_wallet       ?? row.takerWallet,
          takerFeeRate:     Number(row.taker_fee_rate   ?? row.takerFeeRate   ?? 0.02),
          makerRebateRate:  Number(row.maker_rebate_rate ?? row.makerRebateRate ?? 0),
          settlementTxHash: row.settlement_tx_hash  ?? row.settlementTxHash,
          onchainMatchId:   row.onchain_match_id   ?? row.onchainMatchId,
        });
        const matches = rawMatches.map(normalizeMatchRow);

        let totalPlatformFee = 0;
        // Track whether every match payout succeeded — only finalize the offer
        // if all payouts went through.  Failed payouts leave the match in
        // 'settling' (with no settlement_tx_hash) so the next loop iteration
        // picks them up and retries rather than losing the winner's funds.
        let allMatchesPaid = true;

        for (const match of matches) {
          // Crash recovery: match was already paid (has txHash) but DB status was never updated.
          // Just finalize the status without re-sending payment.
          const existingTxHash = match.settlementTxHash;
          if (existingTxHash) {
            const matchStatus = creatorWon ? 'lost' : 'won';
            await db.update(p2pBetMatches).set({ status: matchStatus, settledAt: new Date() })
              .where(eq(p2pBetMatches.id, match.id));
            console.log(`[P2P] ♻️ Match ${match.id} crash-recovered — payout already sent (${existingTxHash.slice(0, 10)}...)`);
            continue;
          }
          // Use stored fee rates from when the match was accepted
          const takerFeeRate = match.takerFeeRate;
          const makerRebateRate = match.makerRebateRate;
          // Guard: derive takerStake if null/zero (should never happen for new offers, but safe for legacy data)
          const safeOfferTakerStake = (offer.takerStake && offer.takerStake > 0)
            ? offer.takerStake
            : round3(offer.creatorStake * Math.max(offer.odds - 1, 0.0001));
          const { grossPot, netFee, winnerPayout } = calcSingleMatchPayout({
            takerStake: match.stake,
            offerOdds: offer.odds,
            offerCreatorStake: offer.creatorStake,
            offerTakerStake: safeOfferTakerStake,
            takerFeeRate,
            makerRebateRate,
          });

          const winnerWallet = creatorWon ? offer.creatorWallet : match.takerWallet;
          let settlementTxHash: string | undefined;
          let payoutSucceeded = false;
          try {
            // ── On-chain settlement (preferred) ──────────────────────────────
            // instant_settle_bet REQUIRES a P2PMatchedBet object (created by accept_offer on-chain).
            // We must NOT pass offer.onchainOfferId (P2POffer) — that causes TypeMismatch on arg 3.
            // Only proceed on-chain if we have a real P2PMatchedBet ID stored in onchainMatchId.
            const onchainBetId = match.onchainMatchId ?? null;
            const onchainCoinType = p2pContractService.resolveCoinType(offer.currency ?? 'SUI');
            if (onchainBetId && p2pContractService.isEnabled()) {
              const matchedAtMs = match.matchedAt instanceof Date
                ? match.matchedAt.getTime()
                : match.createdAt instanceof Date
                  ? match.createdAt.getTime()
                  : undefined;
              const result = await p2pContractService.settleOffer(
                onchainBetId,
                creatorWon,
                onchainCoinType,
                matchedAtMs,
              );
              if (result.success) {
                settlementTxHash = result.txHash;
                payoutSucceeded = true;
                console.log(`[P2P] ✅ On-chain settle (offer ${offer.id}): ${creatorWon ? 'maker' : 'taker'} wins | TX: ${settlementTxHash}`);
              } else if (result.error?.startsWith('ALREADY_TERMINAL')) {
                // Bet was already settled on-chain (previous attempt TX succeeded but
                // response was lost). Treat as success so DB is updated and retries stop.
                payoutSucceeded = true;
                console.log(`[P2P] ✅ On-chain bet already terminal for match ${match.id} (offer ${offer.id}) — marking settled in DB`);
              } else {
                console.error(`[P2P] ⚠️ On-chain settle failed (offer ${offer.id}): ${result.error}`);
              }
            } else {
              // ── Custodial fallback ────────────────────────────────────────
              // Covers: (a) offers accepted via API (no P2PMatchedBet on-chain),
              //          (b) off-chain custodial offers (no onchain_offer_id at all).
              // Admin wallet pays winner directly; maker's on-chain escrowed stake
              // (if any) will be returned when the P2POffer expires permissionlessly.
              const result = offer.currency === 'SBETS'
                ? await blockchainBetService.sendSbetsToUser(winnerWallet, winnerPayout)
                : offer.currency === 'USDSUI'
                  ? await blockchainBetService.sendUsdsuiToUser(winnerWallet, winnerPayout)
                  : offer.currency === 'USDC'
                    ? await blockchainBetService.sendUsdcToUser(winnerWallet, winnerPayout)
                    : offer.currency === 'LBTC'
                      ? await blockchainBetService.sendLbtcToUser(winnerWallet, winnerPayout)
                      : await blockchainBetService.sendSuiToUser(winnerWallet, winnerPayout);
              if (result?.success) {
                settlementTxHash = result.txHash;
                payoutSucceeded = true;
                console.log(`[P2P] ✅ Custodial payout: ${winnerPayout} ${offer.currency} → ${winnerWallet.slice(0, 10)}... | TX: ${settlementTxHash}`);
              } else {
                console.error(`[P2P] ⚠️ Custodial payout failed for match ${match.id}: ${result?.error}`);
              }
            }
          } catch (payErr: any) {
            console.error(`[P2P] Payout error for match ${match.id}:`, payErr.message);
          }

          if (!payoutSucceeded) {
            // Leave match in 'settling' (no txHash) so it is retried next loop.
            allMatchesPaid = false;
            console.warn(`[P2P] ⚠️ Match ${match.id} payout failed — retaining 'settling' status for retry`);
            continue;
          }

          totalPlatformFee += netFee;
          const matchStatus = creatorWon ? 'lost' : 'won';
          await db.update(p2pBetMatches).set({
            status: matchStatus,
            settledAt: new Date(),
            settlementTxHash,
            payoutTxHash: settlementTxHash,
            actualPayout: winnerPayout,
            netFee,
          }).where(eq(p2pBetMatches.id, match.id));

          // Fire-and-forget: Walrus immutable receipt + checkpoint proof
          archiveMatchReceipt(match.id, offer, match, winnerWallet, winnerPayout, settlementTxHash).catch(() => {});

          // Per-wallet settlement notification via WebSocket
          wsService.broadcast('p2p-settlement', {
            betType: 'single',
            offerId: offer.id,
            matchId: match.id,
            eventName: offer.eventName,
            homeTeam: offer.homeTeam,
            awayTeam: offer.awayTeam,
            currency: offer.currency,
            winnerWallet,
            loserWallet: creatorWon ? match.takerWallet : offer.creatorWallet,
            payout: winnerPayout,
            grossPot,
            txHash: settlementTxHash,
            ts: Date.now(),
          });

          // Update PnL stats
          // safeOfferTakerStake already computed above — reuse for PnL.
          const takerW = match.takerWallet;
          const creatorEquivForPnl = round3(offer.creatorStake * (match.stake / safeOfferTakerStake));
          if (creatorWon) {
            // Creator net profit = taker's stake they captured minus fee they bear
            // Taker loses their stake entirely
            await upsertVolumeStats(offer.creatorWallet, { won: 1, pnl: round3(match.stake - netFee) });
            if (takerW) await upsertVolumeStats(takerW, { lost: 1, pnl: round3(-match.stake) });
          } else {
            // Taker net profit = creator's proportional stake captured minus fee
            // Creator loses their proportional stake for this fill
            if (takerW) await upsertVolumeStats(takerW, { won: 1, pnl: round3(creatorEquivForPnl - netFee) });
            await upsertVolumeStats(offer.creatorWallet, { lost: 1, pnl: round3(-creatorEquivForPnl) });
          }
        }

        // Only mark offer as fully settled if every match payout went through.
        // If any failed, the offer stays in 'filled' so this loop retries it.
        if (!allMatchesPaid) {
          console.warn(`[P2P] ⚠️ Offer ${offer.id} has outstanding failed payouts — will retry next settlement run`);
          continue;
        }

        await db.update(p2pBetOffers).set({
          status: 'settled',
          winner: creatorWon ? 'creator' : 'taker',
          settledAt: new Date(),
          platformFee: round3(totalPlatformFee),
        }).where(eq(p2pBetOffers.id, offer.id));

        // Record fee revenue in the central revenue tracker so it flows
        // through to holder/LP/treasury/buyback distributions.
        if (totalPlatformFee > 0) {
          try {
            await revenueTrackerService.recordRevenue(
              'won_bet_fee',
              round3(totalPlatformFee),
              ((offer.currency as string) === 'SBETS' ? 'SBETS' : (offer.currency as string) === 'USDSUI' ? 'USDSUI' : (offer.currency as string) === 'USDC' ? 'USDC' : 'SUI'),
              String(offer.id),
            );
            console.log(`[P2P] 💰 Revenue recorded: ${round3(totalPlatformFee)} ${offer.currency} fee (offer ${offer.id})`);
          } catch (revErr: any) {
            console.error(`[P2P] ⚠️ Revenue tracking failed for offer ${offer.id}:`, revErr.message);
          }
        }

        // Collect all unique taker wallets from the matches (single-offer takers live in
        // p2pBetMatches, not on the offer itself, so we gather them here for the WS broadcast)
        const takerWallets = [...new Set(matches.map(m => m.takerWallet).filter(Boolean))] as string[];
        wsService.broadcast('p2p-updates', {
          action: 'settled', type: 'offer',
          data: {
            offerId: offer.id,
            winner: creatorWon ? 'creator' : 'taker',
            wallets: [offer.creatorWallet, ...takerWallets],
          },
          ts: Date.now(),
        });
        console.log(`[P2P] Settled offer ${offer.id}: ${creatorWon ? 'creator' : 'taker'} wins`);
      } catch (err: any) {
        console.error(`[P2P] Error settling offer ${offer.id}:`, err.message);
      }
    }
  }

  private async settleFilledParlays() {
    // 'settling' status means a previous run locked this parlay but crashed before
    // finishing — re-process it (idempotent: check settlementTxHash before paying).
    const filledParlays = await db.select().from(p2pParlayOffers)
      .where(or(eq(p2pParlayOffers.status, 'filled'), eq(p2pParlayOffers.status, 'settling')));

    for (const parlay of filledParlays) {
      try {
        const legs = await db.select().from(p2pParlayLegs)
          .where(eq(p2pParlayLegs.parlayOfferId, parlay.id));

        let allSettled = true;
        let anyLost = false;
        let legsWon = 0;
        let legsLostCount = 0;

        for (const leg of legs) {
          if (leg.status !== 'pending') {
            if (leg.status === 'won') legsWon++;
            if (leg.status === 'lost') { anyLost = true; legsLostCount++; }
            continue;
          }
          let [settled] = await db.select().from(settledEvents)
            .where(eq(settledEvents.externalEventId, leg.eventId));
          if (!settled) {
            // settled_events not yet populated — try ESPN directly (sport-aware)
            const espnResult = await this.fetchEventResultFromESPN(
              leg.eventId,
              leg.sportName ?? undefined,
              leg.homeTeam ?? undefined,
              leg.awayTeam ?? undefined,
            );
            if (!espnResult) {
              // Time guard: same as single-bet path — wait at least 110 minutes after
              // kickoff before falling back to team-name lookup to avoid stale data.
              const legKickoffMs = leg.matchDate ? new Date(leg.matchDate).getTime() : null;
              const nowMs = Date.now();
              if (legKickoffMs && nowMs < legKickoffMs + 110 * 60 * 1000) {
                const waitMin = Math.ceil((legKickoffMs + 110 * 60 * 1000 - nowMs) / 60000);
                console.log(`[P2P Parlay] ⏳ Leg event ${leg.eventId} match started ${Math.round((nowMs - legKickoffMs) / 60000)}m ago — waiting ${waitMin}m more. Skipping parlay ${parlay.id} leg ${leg.id}.`);
                allSettled = false;
                continue;
              }
              // Final fallback: team-name search — pass matchDate for date-window filtering
              const teamResult = await this.fetchEventResultByTeamNames(
                leg.homeTeam ?? '',
                leg.awayTeam ?? '',
                leg.sportName ?? undefined,
                leg.matchDate ? leg.matchDate.toISOString() : null,
                leg.leagueName ?? undefined,
              );
              if (!teamResult) { allSettled = false; continue; }
              settled = { winner: teamResult.winner, externalEventId: leg.eventId } as any;
              console.log(`[P2P TeamName] Parlay leg event ${leg.eventId}: ${teamResult.winner}`);
            } else {
              try {
                const [inserted] = await db.insert(settledEvents).values({
                  externalEventId: leg.eventId,
                  homeTeam: espnResult.homeTeam || leg.homeTeam || '',
                  awayTeam: espnResult.awayTeam || leg.awayTeam || '',
                  homeScore: espnResult.homeScore,
                  awayScore: espnResult.awayScore,
                  winner: espnResult.winner,
                  betsSettled: 0,
                }).returning();
                settled = inserted;
              } catch {
                settled = { winner: espnResult.winner, externalEventId: leg.eventId } as any;
              }
              console.log(`[P2P ESPN] Cached parlay leg result for event ${leg.eventId}: ${espnResult.winner}`);
            }
          }

          const won = predictionWon(
            leg.prediction, leg.homeTeam, leg.awayTeam, settled.winner ?? '',
            (settled as any).homeScore ?? undefined, (settled as any).awayScore ?? undefined,
          );
          await db.update(p2pParlayLegs).set({
            status: won ? 'won' : 'lost',
            settledAt: new Date(),
          }).where(eq(p2pParlayLegs.id, leg.id));
          if (won) legsWon++;
          else { anyLost = true; legsLostCount++; }
        }

        if (!allSettled) {
          await db.update(p2pParlayOffers).set({
            status: 'settling',
            legsWon,
            legsLost: legsLostCount,
          }).where(eq(p2pParlayOffers.id, parlay.id));
          continue;
        }

        const creatorWon = !anyLost;
        const takerFeeRate = parlay.takerFeeRate ?? 0.02;
        const makerRebateRate = parlay.makerRebateRate ?? 0;
        const { grossPot, netFee, winnerPayout } = calcParlayPayout({
          creatorStake: parlay.creatorStake,
          takerStake: parlay.takerStake,
          takerFeeRate,
          makerRebateRate,
        });

        const winnerWallet = creatorWon ? parlay.creatorWallet : (parlay.takerWallet ?? '');
        let settlementTxHash: string | undefined;
        let payoutSucceeded = false;

        // Crash recovery: if a txHash is already stored the payout was sent — skip.
        if ((parlay as any).settlementTxHash) {
          settlementTxHash = (parlay as any).settlementTxHash;
          payoutSucceeded = true;
          console.log(`[P2P] ♻️ Parlay ${parlay.id} already paid (recovery) — skipping payout`);
        } else if (winnerWallet) {
          // Mark as 'settling' before attempting payout (idempotent)
          await db.execute(sql`
            UPDATE p2p_parlay_offers
            SET status = 'settling'
            WHERE id = ${parlay.id}
              AND status IN ('filled', 'settling')
              AND settlement_tx_hash IS NULL
          `);
          try {
            // ── On-chain parlay settlement (preferred) ───────────────────────
            const onchainCoinType = p2pContractService.resolveCoinType(parlay.currency ?? 'SUI');
            if (parlay.onchainParlayId && p2pContractService.isEnabled()) {
              // Step 1: settle each leg on-chain before finalization.
              // Wrapped in try/catch per leg — if a leg was already settled
              // on-chain in a previous attempt, the call may abort (idempotent).
              for (const leg of legs) {
                if (leg.status === 'pending') continue; // not resolved yet — skip
                try {
                  const legWon = leg.status === 'won';
                  const legResult = await p2pContractService.settleParlayLeg(
                    parlay.onchainParlayId,
                    leg.legIndex ?? 0,
                    legWon,
                    onchainCoinType,
                  );
                  if (legResult.success) {
                    console.log(`[P2P] ✅ On-chain leg ${leg.legIndex} settled (parlay ${parlay.id}): ${legWon ? 'won' : 'lost'} | TX: ${legResult.txHash}`);
                  } else {
                    // Leg may already be settled on-chain — log and continue
                    console.warn(`[P2P] ⚠️ On-chain leg ${leg.legIndex} settle note (parlay ${parlay.id}): ${legResult.error}`);
                  }
                } catch (legErr: any) {
                  console.warn(`[P2P] ⚠️ On-chain leg ${leg.legIndex} settle skipped (parlay ${parlay.id}): ${legErr.message}`);
                }
              }
              // Step 2: instant finalize — pass correct winner and coin type
              const result = await p2pContractService.finalizeParlay(parlay.onchainParlayId, creatorWon, onchainCoinType);
              if (result.success) {
                settlementTxHash = result.txHash;
                payoutSucceeded = true;
                console.log(`[P2P] ✅ On-chain parlay finalized (${parlay.id}): ${creatorWon ? 'creator' : 'taker'} wins | TX: ${settlementTxHash}`);
              } else {
                console.error(`[P2P] ⚠️ On-chain parlay finalize failed (${parlay.id}): ${result.error}`);
              }
            } else {
              // ── Custodial fallback ────────────────────────────────────────
              const currency = parlay.currency ?? 'SUI';
              const result = currency === 'SBETS'
                ? await blockchainBetService.sendSbetsToUser(winnerWallet, winnerPayout)
                : currency === 'USDSUI'
                  ? await blockchainBetService.sendUsdsuiToUser(winnerWallet, winnerPayout)
                  : currency === 'USDC'
                    ? await blockchainBetService.sendUsdcToUser(winnerWallet, winnerPayout)
                    : currency === 'LBTC'
                      ? await blockchainBetService.sendLbtcToUser(winnerWallet, winnerPayout)
                      : await blockchainBetService.sendSuiToUser(winnerWallet, winnerPayout);
              if (result?.success) {
                settlementTxHash = result.txHash;
                payoutSucceeded = true;
                console.log(`[P2P] ✅ Custodial parlay payout: ${winnerPayout} ${currency} → ${winnerWallet.slice(0, 10)}... | TX: ${settlementTxHash}`);
              } else {
                console.error(`[P2P] ⚠️ Custodial parlay payout failed ${parlay.id}: ${result?.error}`);
              }
            }
          } catch (payErr: any) {
            console.error(`[P2P] Parlay payout error ${parlay.id}:`, payErr.message);
          }
        }

        // Only finalize if payout succeeded — leave in 'settling' for retry otherwise.
        if (!payoutSucceeded && winnerWallet) {
          console.warn(`[P2P] ⚠️ Parlay ${parlay.id} payout failed — retaining 'settling' status for retry`);
          continue;
        }

        await db.update(p2pParlayOffers).set({
          status: 'settled',
          winner: creatorWon ? 'creator' : 'taker',
          settledAt: new Date(),
          legsWon,
          platformFee: netFee,
          actualPayout: winnerPayout,
          settlementTxHash,
        }).where(eq(p2pParlayOffers.id, parlay.id));

        // Per-wallet settlement notification via WebSocket
        wsService.broadcast('p2p-settlement', {
          betType: 'parlay',
          parlayId: parlay.id,
          eventName: `${parlay.legCount ?? '?'}-Leg Parlay`,
          currency: parlay.currency ?? 'SUI',
          winnerWallet,
          loserWallet: creatorWon ? (parlay.takerWallet ?? '') : parlay.creatorWallet,
          payout: winnerPayout,
          grossPot,
          txHash: settlementTxHash,
          ts: Date.now(),
        });

        // Record parlay fee revenue in the central revenue tracker
        if (netFee > 0) {
          try {
            const currency = parlay.currency ?? 'SUI';
            await revenueTrackerService.recordRevenue(
              'won_bet_fee',
              round3(netFee),
              (currency === 'SBETS' ? 'SBETS' : currency === 'USDSUI' ? 'USDSUI' : currency === 'USDC' ? 'USDC' : 'SUI'),
              `parlay-${parlay.id}`,
              settlementTxHash,
            );
            console.log(`[P2P] 💰 Parlay revenue recorded: ${round3(netFee)} ${currency} fee (parlay ${parlay.id})`);
          } catch (revErr: any) {
            console.error(`[P2P] ⚠️ Parlay revenue tracking failed for ${parlay.id}:`, revErr.message);
          }
        }

        // Update PnL stats for parlay
        if (creatorWon && parlay.takerWallet) {
          await upsertVolumeStats(parlay.creatorWallet, { won: 1, pnl: round3(parlay.takerStake - netFee) });
          await upsertVolumeStats(parlay.takerWallet, { lost: 1, pnl: round3(-parlay.takerStake) });
        } else if (!creatorWon && parlay.takerWallet) {
          await upsertVolumeStats(parlay.takerWallet, { won: 1, pnl: round3(parlay.creatorStake - netFee) });
          await upsertVolumeStats(parlay.creatorWallet, { lost: 1, pnl: round3(-parlay.creatorStake) });
        }

        wsService.broadcast('p2p-updates', {
          action: 'settled', type: 'parlay',
          data: {
            parlayId: parlay.id,
            winner: creatorWon ? 'creator' : 'taker',
            wallets: [parlay.creatorWallet, ...(parlay.takerWallet ? [parlay.takerWallet] : [])],
          },
          ts: Date.now(),
        });
        console.log(`[P2P] Settled parlay ${parlay.id}: ${creatorWon ? 'creator' : 'taker'} wins (${legsWon}/${parlay.legCount} legs won)`);
      } catch (err: any) {
        console.error(`[P2P] Error settling parlay ${parlay.id}:`, err.message);
      }
    }
  }

  /**
   * One-time startup backfill: for existing p2p_bet_matches that have a taker_tx_hash
   * and are linked to an on-chain offer (onchain_offer_id IS NOT NULL) but are missing
   * onchain_match_id, try to extract the P2PMatchedBet object ID from the takerTx and
   * store it.  This fixes matches that were accepted on-chain before the fix was deployed.
   *
   * Silently skips matches where the takerTx doesn't contain a P2PMatchedBet (taker
   * sent to admin wallet instead of calling accept_offer — custodial settlement is used).
   */
  async backfillOnchainMatchIds(): Promise<void> {
    try {
      const rows = await db.execute(sql`
        SELECT m.id AS match_id, m.taker_tx_hash
        FROM p2p_bet_matches m
        JOIN p2p_bet_offers o ON o.id = m.offer_id
        WHERE m.taker_tx_hash IS NOT NULL
          AND m.onchain_match_id IS NULL
          AND o.onchain_offer_id IS NOT NULL AND o.onchain_offer_id != ''
        LIMIT 100
      `);
      const matches = (rows as any).rows ?? (rows as any);
      if (!Array.isArray(matches) || matches.length === 0) return;

      console.log(`[P2P Backfill] Checking ${matches.length} match(es) for missing onchain_match_id`);
      const suiClient = getSuiClient();
      let filled = 0;

      for (const row of matches) {
        try {
          const txBlock = await (suiClient as any).getTransactionBlock({
            digest: row.taker_tx_hash,
            options: { showObjectChanges: true },
          });
          const matchedBetChange = (txBlock?.objectChanges ?? []).find(
            (c: any) => c.type === 'created' && (c.objectType ?? '').includes('P2PMatchedBet')
          );
          if (matchedBetChange?.objectId) {
            await db.execute(sql`
              UPDATE p2p_bet_matches
              SET onchain_match_id = ${matchedBetChange.objectId}
              WHERE id = ${row.match_id} AND onchain_match_id IS NULL
            `);
            console.log(`[P2P Backfill] ✅ Match ${row.match_id}: linked P2PMatchedBet ${matchedBetChange.objectId}`);
            filled++;
          }
        } catch (_) { /* tx lookup failed or no P2PMatchedBet — skip */ }
      }

      if (filled > 0) {
        console.log(`[P2P Backfill] Linked ${filled} P2PMatchedBet ID(s). Next settlement will use on-chain settlement for these.`);
      } else {
        console.log('[P2P Backfill] No P2PMatchedBet objects found in existing takerTxHashes — all will settle custodially.');
      }
    } catch (err: any) {
      console.warn('[P2P Backfill] backfillOnchainMatchIds error (non-fatal):', err.message);
    }
  }

  startSettlementLoop(intervalMs = 5 * 60 * 1000) {
    console.log('[P2P] Settlement loop started (HIP-4 enabled)');
    // Backfill missing onchain_match_id for existing matches (one-time, non-blocking)
    this.backfillOnchainMatchIds().catch((e: any) =>
      console.warn('[P2P Backfill] Non-fatal error:', e.message)
    );
    // Schedule exact-time expiry timers for all currently open/partial offers
    // so refunds fire at the precise moment the offer expires (not up to 5 min late)
    this.scheduleAllActiveExpiries().catch((e: any) =>
      console.warn('[P2P] Non-fatal scheduleAllActiveExpiries error:', e.message)
    );
    // Run immediately on startup to process any expired offers / pending refunds right away
    this.runSettlement().catch((e: any) => console.error('[P2P] Initial settlement error:', e.message));
    setInterval(() => this.runSettlement(), intervalMs);
  }
}

export const p2pBettingService = new P2PBettingService();
export default p2pBettingService;
