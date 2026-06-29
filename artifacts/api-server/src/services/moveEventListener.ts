/**
 * Move Event Listener
 * Polls BetPlaced / BetSettled / MarketResolved events from all SuiBets
 * smart contracts via the project's SuiHybridClient (JSON-RPC → GraphQL cascade).
 * Runs every 30 s; on-chain latency is typically < 1 minute from commit.
 *
 * Also polls OfferFilled events from the P2P package so that on-chain fills
 * that bypass the API (direct contract calls) are automatically recorded in the
 * DB, preventing orphaned P2PMatchedBet objects like offer #9.
 *
 * P2P Fast Settlement (10 s poll):
 * Watches BetSettled, BetVoided, ParlaySettled, ParlayVoided, OfferExpired,
 * OfferCancelled events from the P2P contract.  When detected, the DB record is
 * immediately synced — reducing settlement latency from the 5-minute loop to ~10 s
 * for any on-chain action (direct contract calls or server-side settlements whose
 * DB writes need a second confirmation).
 */

import { getSuiClient, getJsonRpcUrl } from '../lib/suiRpcConfig';
import { db } from '../db';
import { bets, p2pBetOffers, p2pBetMatches, p2pParlayOffers, eventCursors } from '@shared/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { p2pContractService } from './p2pContractService';
import { wsService } from './websocketService';

// ── Chain-event broadcast (rate-limited per type to prevent flooding) ─────────
const _chainBroadcastLastMs: Record<string, number> = {};
function broadcastChainEvent(eventType: string, data: Record<string, any>): void {
  const now  = Date.now();
  const last = _chainBroadcastLastMs[eventType] ?? 0;
  if (now - last < 300) return; // max 1 broadcast per 300 ms per event type
  _chainBroadcastLastMs[eventType] = now;
  try { wsService.broadcast('p2p-chain-event', { eventType, ts: now, ...data }); } catch (_e) {}
}

const BETTING_PACKAGE_ID =
  (process.env.BETTING_PACKAGE_ID || '').trim();
const PREDICTION_PACKAGE_ID =
  '0xbeca02b587c7bdc696c84141f7f28649e3b810c83325a6113deb93a9fd403924';
const P2P_PACKAGE_ID =
  (process.env.P2P_PACKAGE_ID || '0xd51fe151bec66a15b086a67c1cfce9b05759ddac1d73fcd3e14324ad202b2e59').trim();

const POLL_INTERVAL_MS = 30_000;

interface EventStats {
  running: boolean;
  polls: number;
  eventsProcessed: number;
  lastPollAt: number | null;
  errors: number;
  startedAt: number;
}

const stats: EventStats = {
  running: false,
  polls: 0,
  eventsProcessed: 0,
  lastPollAt: null,
  errors: 0,
  startedAt: Date.now(),
};

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

// Track cursor per event type so we don't re-process events
const cursors: Record<string, string | null> = {};

// ── Cursor persistence — survives server restarts ──────────────────────────────
async function loadCursors(): Promise<void> {
  try {
    const rows = await db.select().from(eventCursors);
    for (const row of rows) {
      if (row.cursor) {
        cursors[row.eventType] = row.cursor;
        p2pCursors[row.eventType] = row.cursor;
      }
    }
    if (rows.length > 0) {
      console.log(`[MoveEvents] 📂 Loaded ${rows.length} persisted cursors from DB`);
    }
  } catch (err: any) {
    console.warn('[MoveEvents] Could not load cursors from DB:', err.message);
  }
}

async function saveCursor(eventType: string, cursor: string): Promise<void> {
  try {
    await db
      .insert(eventCursors)
      .values({ eventType, cursor, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: eventCursors.eventType,
        set: { cursor, updatedAt: new Date() },
      });
  } catch (_err) {
    // Non-critical — polling still works with in-memory cursors
  }
}

// ── Native WebSocket subscriptions (suix_subscribeEvent) ──────────────────────
// Falls back to polling gracefully if the node doesn't support WS subscriptions.

let wsSubSocket: any = null;
let wsSubActive = false;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const WS_RECONNECT_DELAY = 15_000;

function getWsUrl(): string {
  const http = getJsonRpcUrl();
  // Convert https://... → wss://... ; http://... → ws://...
  return http.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
}

function startWsSubscriptions(): void {
  if (stopped) return;

  const wsUrl = getWsUrl();

  // Node 18+ has native WebSocket; fall back to a no-op if unavailable
  const WS: typeof WebSocket | null = (globalThis as any).WebSocket ?? null;
  if (!WS) {
    console.log('[P2P⚡] Native WebSocket not available — polling only');
    return;
  }

  try {
    const ws = new WS(wsUrl);
    wsSubSocket = ws;

    ws.onopen = () => {
      wsSubActive = true;
      console.log(`[P2P⚡] WS connected → ${wsUrl.slice(0, 40)}…`);
      // Subscribe to each P2P settlement event type
      P2P_SETTLEMENT_EVENT_TYPES.forEach((et, i) => {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: i + 100,
          method: 'suix_subscribeEvent',
          params: [{ MoveEventType: et }],
        }));
      });
    };

    ws.onmessage = async (msg: MessageEvent) => {
      try {
        const data = JSON.parse(typeof msg.data === 'string' ? msg.data : msg.data.toString());
        // Subscription confirmations have an id — skip them
        if (data.id != null || !data.params?.result) return;
        const event = data.params.result;
        const parsed   = event.parsedJson || {};
        const txDigest = event.id?.txDigest as string | undefined;
        const et: string = event.type || '';

        if      (et.endsWith('BetSettled'))     await handleP2PBetSettled(parsed, txDigest);
        else if (et.endsWith('BetVoided'))      await handleP2PBetVoided(parsed, txDigest);
        else if (et.endsWith('ParlaySettled'))  await handleP2PParlaySettled(parsed, txDigest);
        else if (et.endsWith('ParlayVoided'))   await handleP2PParlayVoided(parsed, txDigest);
        else if (et.endsWith('OfferExpired'))   await handleP2POfferExpired(parsed, txDigest);
        else if (et.endsWith('OfferCancelled')) await handleP2POfferCancelled(parsed, txDigest);

        stats.eventsProcessed++;
        if (txDigest && event.id?.eventSeq != null) {
          const cursor = JSON.stringify({ txDigest, eventSeq: String(event.id.eventSeq) });
          p2pCursors[et] = cursor;
          await saveCursor(et, cursor);
        }
      } catch (_err) { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      wsSubActive = false;
    };

    ws.onclose = () => {
      wsSubActive = false;
      wsSubSocket = null;
      if (!stopped) {
        console.log(`[P2P⚡] WS disconnected — reconnecting in ${WS_RECONNECT_DELAY / 1000}s (polling continues)`);
        wsReconnectTimer = setTimeout(startWsSubscriptions, WS_RECONNECT_DELAY);
      }
    };
  } catch (err: any) {
    console.log('[P2P⚡] WS subscription unavailable:', err.message, '— polling only');
  }
}

function stopWsSubscriptions(): void {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (wsSubSocket) {
    try { wsSubSocket.close(); } catch {}
    wsSubSocket = null;
  }
  wsSubActive = false;
}

async function pollEventType(eventType: string): Promise<void> {
  try {
    const rpcUrl = getJsonRpcUrl();
    const cursor = cursors[eventType] ?? null;

    const params: any[] = [
      { MoveEventType: eventType },
      cursor,
      10,
      false,
    ];

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_queryEvents',
        params,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return;

    const json: any = await response.json();
    const data = json?.result;
    if (!data?.data?.length) return;

    for (const event of data.data) {
      const parsed = event.parsedJson || {};

      if (eventType.endsWith('BetSettled')) {
        await handleBetSettled(parsed);
      } else if (eventType.endsWith('BetPlaced')) {
        handleBetPlaced(parsed, eventType);
      } else if (eventType.includes('prediction_market')) {
        handleMarketResolved(parsed);
      } else if (eventType.endsWith('OfferFilled')) {
        await handleOfferFilled(parsed, event.id?.txDigest);
      }

      stats.eventsProcessed++;
    }

    if (data.nextCursor) {
      cursors[eventType] = data.nextCursor;
      saveCursor(eventType, JSON.stringify(data.nextCursor)).catch(() => {});
    }
  } catch (err: any) {
    stats.errors++;
  }
}

async function handleBetSettled(parsed: any): Promise<void> {
  try {
    const betObjectId: string = parsed?.bet_id || parsed?.bet_object_id;
    const won: boolean = parsed?.outcome === 'won' || parsed?.won === true;
    if (!betObjectId) return;

    const existing = await db.select().from(bets).where(eq(bets.betObjectId, betObjectId)).limit(1);
    if (!existing.length) return;

    await db
      .update(bets)
      .set({ status: won ? 'won' : 'lost', settledAt: new Date() } as any)
      .where(eq(bets.betObjectId, betObjectId));

    console.log(`[MoveEvents] ✅ BetSettled → ${betObjectId} → ${won ? 'WON' : 'LOST'}`);
  } catch (err: any) {
    console.warn('[MoveEvents] handleBetSettled error:', err.message);
  }
}

function handleBetPlaced(parsed: any, _eventType: string): void {
  const betObjectId: string = parsed?.bet_id || parsed?.bet_object_id || '?';
  console.log(`[MoveEvents] 🎲 BetPlaced → ${betObjectId}`);
}

function handleMarketResolved(parsed: any): void {
  const marketId: string = parsed?.market_id || '?';
  const outcome: string = parsed?.outcome || '?';
  console.log(`[MoveEvents] 🏁 MarketResolved → market=${marketId} outcome=${outcome}`);
}

/**
 * Handle OfferFilled events from the P2P contract.
 *
 * When a user calls accept_offer / accept_parlay directly on-chain (bypassing
 * the API's POST /api/p2p/offers/:id/accept), no DB record is created for the
 * P2PMatchedBet. This handler detects those orphaned fills and writes the
 * missing p2p_bet_matches row so the settlement worker can resolve them.
 *
 * Event fields (from Move): offer_id, bet_id, taker, fill_amount, remaining, timestamp
 */
async function handleOfferFilled(parsed: any, txDigest?: string): Promise<void> {
  try {
    const onchainOfferId: string  = parsed?.offer_id;
    const betId: string           = parsed?.bet_id;          // P2PMatchedBet object ID
    const takerWallet: string     = parsed?.taker;
    const fillAmountBase: string  = parsed?.fill_amount;     // base units (mist / SBETS units)

    if (!onchainOfferId || !betId || !takerWallet) return;

    // 1. Find the parent offer in our DB by its on-chain object ID
    const [offer] = await db
      .select()
      .from(p2pBetOffers)
      .where(eq(p2pBetOffers.onchainOfferId, onchainOfferId))
      .limit(1);

    if (!offer) {
      // Offer not in our DB — created entirely on-chain without going through the API.
      // The P2PMatchedBet object has both parties' stakes locked and can never be settled
      // by our settlement worker (no parent offer record).  Void it so stakes are returned.
      console.warn(`[MoveEvents] OfferFilled for unknown offer ${onchainOfferId.slice(0, 20)}... — no DB record; attempting void_bet to unblock stakes`);
      if (betId) {
        try {
          const voidResult = await p2pContractService.voidBet(betId)
            .catch((e: any) => ({ success: false as const, txHash: '', error: e.message }));
          if (voidResult.success) {
            console.log(`[MoveEvents] ✅ void_bet for unknown-offer P2PMatchedBet ${betId.slice(0, 16)}... TX: ${voidResult.txHash}`);
          } else {
            console.warn(`[MoveEvents] ⚠️ void_bet failed for ${betId.slice(0, 16)}...: ${voidResult.error}`);
          }
        } catch (e: any) {
          console.warn(`[MoveEvents] void_bet error for ${betId.slice(0, 16)}...: ${e.message}`);
        }
      }
      return;
    }

    // 2. Check if we already have a match record for this specific P2PMatchedBet object
    const [existingMatchByOnchain] = await db
      .select({ id: p2pBetMatches.id })
      .from(p2pBetMatches)
      .where(eq(p2pBetMatches.onchainMatchId, betId))
      .limit(1);

    if (existingMatchByOnchain) return; // already recorded — nothing to do

    // Also check by (offerId, takerWallet) in case the record exists without onchainMatchId
    // and backfill it if found.
    const [existingMatchByWallet] = await db
      .select({ id: p2pBetMatches.id, onchainMatchId: p2pBetMatches.onchainMatchId })
      .from(p2pBetMatches)
      .where(
        and(
          eq(p2pBetMatches.offerId, offer.id),
          eq(p2pBetMatches.takerWallet, takerWallet),
        ),
      )
      .limit(1);

    if (existingMatchByWallet) {
      // Match exists but is missing the onchainMatchId — backfill it so settlement
      // can call instant_settle_bet instead of falling back to custodial payout.
      if (!existingMatchByWallet.onchainMatchId) {
        await db
          .update(p2pBetMatches)
          .set({ onchainMatchId: betId })
          .where(eq(p2pBetMatches.id, existingMatchByWallet.id));
        console.log(`[MoveEvents] 🔧 Backfilled onchainMatchId ${betId.slice(0, 16)}... → match #${existingMatchByWallet.id}`);
      }
      return;
    }

    // 3. Insert the missing match record — including onchainMatchId so the settlement
    // worker can call instant_settle_bet (on-chain escrow release) instead of using
    // the custodial admin-wallet fallback.
    const decimals = ['USDSUI', 'USDC'].includes((offer.currency ?? '').toUpperCase()) ? 6 : 9;
    const fillAmount = Number(fillAmountBase) / Math.pow(10, decimals);
    const odds       = offer.odds ?? 2;
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
      onchainMatchId:  betId,   // ← CRITICAL: enables instant_settle_bet on settlement
      takerFeeRate:    0.02,
      makerRebateRate: 0,
      netFee,
      platformFee:     netFee,
    });

    // 4. Update parent offer's filled stake.
    // If the offer was already marked expired/cancelled in DB (e.g. match_date expiry ran
    // before we ingested this OfferFilled event), revive it to 'filled' so the settlement
    // worker picks it up.  Stakes are locked in the P2PMatchedBet on-chain regardless of
    // what our DB says.
    const terminalButFillable = ['expired', 'cancelled'];
    if (terminalButFillable.includes(offer.status ?? '')) {
      await db
        .update(p2pBetOffers)
        .set({
          status:      'filled' as any,
          filledStake: Math.min((offer.filledStake ?? 0) + fillAmount, offer.takerStake ?? fillAmount),
          refundTxHash: null,  // clear any pending refund — there's a live match now
        })
        .where(eq(p2pBetOffers.id, offer.id));
      console.log(`[MoveEvents] ♻️  Offer #${offer.id} revived '${offer.status}' → 'filled' (on-chain fill detected post-expiry)`);
    } else {
      const newFilled = Math.min((offer.filledStake ?? 0) + fillAmount, offer.takerStake ?? fillAmount);
      const newStatus = newFilled >= (offer.takerStake ?? fillAmount) - 0.0001 ? 'filled' : 'partial';
      await db
        .update(p2pBetOffers)
        .set({ filledStake: newFilled, status: newStatus as any })
        .where(eq(p2pBetOffers.id, offer.id));
    }

    console.log(`[MoveEvents] 🔗 Orphaned OfferFilled synced → offer #${offer.id} | taker ${takerWallet.slice(0, 12)}... | betId ${betId.slice(0, 16)}... | ${fillAmount} ${offer.currency} | onchainMatchId stored ✓`);
    broadcastChainEvent('OfferFilled', {
      offerId:    (offer.onchainOfferId ?? String(offer.id)).slice(0, 20),
      eventName:  offer.eventName ?? null,
      fillAmount,
      currency:   offer.currency,
      txDigest:   txDigest?.slice(0, 20),
    });
    // Per-offer notification — sent on its own channel so it always reaches the creator
    try {
      wsService.broadcast('p2p-match-notification', {
        dbOfferId:     offer.id,
        creatorWallet: offer.creatorWallet,
        takerWallet,
        eventName:     offer.eventName ?? '',
        homeTeam:      offer.homeTeam  ?? '',
        awayTeam:      offer.awayTeam  ?? '',
        prediction:    offer.prediction ?? '',
        odds:          offer.odds ?? 2,
        fillAmount,
        currency:      offer.currency ?? 'SUI',
        txDigest:      txDigest ?? '',
        ts:            Date.now(),
      });
    } catch (_) {}
  } catch (err: any) {
    console.warn('[MoveEvents] handleOfferFilled error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P2P fast-settlement event handlers
// These sync the DB from on-chain events so settlement is visible within ~10 s
// of a contract interaction, rather than waiting for the 5-minute poll loop.
//
// Status mapping (from Move contract u8):
//   4 = MAKER_WON   5 = TAKER_WON   6 = VOID
// ─────────────────────────────────────────────────────────────────────────────

/** Called for P2P::BetSettled — updates the matched-bet row from on-chain state. */
async function handleP2PBetSettled(parsed: any, txDigest?: string): Promise<void> {
  try {
    const betId: string  = parsed?.bet_id;
    const status: number = Number(parsed?.status ?? 0);
    const winner: string = parsed?.winner;
    if (!betId) return;

    // 4 = MAKER_WON, 5 = TAKER_WON — anything else is unexpected
    if (status !== 4 && status !== 5) return;
    const newStatus = status === 4 ? 'maker_won' : 'taker_won';

    // Look up by onchain_match_id
    const [match] = await db.select({
      id:            p2pBetMatches.id,
      status:        p2pBetMatches.status,
      offerId:       p2pBetMatches.offerId,
      creatorStake:  p2pBetMatches.creatorStake,
      takerStake:    p2pBetMatches.takerStake,
    }).from(p2pBetMatches)
      .where(eq(p2pBetMatches.onchainMatchId, betId))
      .limit(1);

    if (!match) return;
    if (match.status === newStatus || match.status === 'voided') return; // already synced

    // Derive payout in human units (payout field in event is base units)
    const payoutBase: number = Number(parsed?.payout ?? 0);
    // Look up currency from parent offer for correct decimals
    const [offer] = await db.select({ currency: p2pBetOffers.currency })
      .from(p2pBetOffers).where(eq(p2pBetOffers.id, match.offerId)).limit(1);
    const currency = (offer?.currency ?? 'SUI').toUpperCase();
    const decimals = (currency === 'USDSUI' || currency === 'USDC') ? 6 : 9;
    const actualPayout = payoutBase / Math.pow(10, decimals);

    await db.update(p2pBetMatches).set({
      status:           newStatus as any,
      winner:           winner ?? null,
      actualPayout:     actualPayout || null,
      settlementTxHash: txDigest ?? null,
      settledAt:        new Date(),
    }).where(eq(p2pBetMatches.id, match.id));

    console.log(`[P2P⚡] BetSettled → match #${match.id} (${betId.slice(0, 16)}...) → ${newStatus} | winner: ${(winner ?? '?').slice(0, 12)}... | TX: ${(txDigest ?? '').slice(0, 20)}...`);
    broadcastChainEvent('BetSettled', {
      matchId:       match.id,
      winner:        winner?.slice(0, 20) ?? null,
      actualPayout,
      currency,
      txDigest:      txDigest?.slice(0, 20),
    });
  } catch (err: any) {
    console.warn('[P2P⚡] handleP2PBetSettled error:', err.message);
  }
}

/** Called for P2P::BetVoided — marks matched-bet as voided so settlement loop skips it. */
async function handleP2PBetVoided(parsed: any, txDigest?: string): Promise<void> {
  try {
    const betId: string = parsed?.bet_id;
    if (!betId) return;

    const [match] = await db.select({ id: p2pBetMatches.id, status: p2pBetMatches.status })
      .from(p2pBetMatches).where(eq(p2pBetMatches.onchainMatchId, betId)).limit(1);

    if (!match) return;
    if (match.status === 'voided') return; // already done

    await db.update(p2pBetMatches).set({
      status:           'voided' as any,
      settlementTxHash: txDigest ?? null,
      settledAt:        new Date(),
    }).where(eq(p2pBetMatches.id, match.id));

    console.log(`[P2P⚡] BetVoided → match #${match.id} (${betId.slice(0, 16)}...) | TX: ${(txDigest ?? '').slice(0, 20)}...`);
    broadcastChainEvent('BetVoided', { matchId: match.id, txDigest: txDigest?.slice(0, 20) });
  } catch (err: any) {
    console.warn('[P2P⚡] handleP2PBetVoided error:', err.message);
  }
}

/** Called for P2P::ParlaySettled — marks parlay offer row settled from on-chain state. */
async function handleP2PParlaySettled(parsed: any, txDigest?: string): Promise<void> {
  try {
    const parlayId: string = parsed?.parlay_id;
    const status: number   = Number(parsed?.status ?? 0);
    const winner: string   = parsed?.winner;
    if (!parlayId) return;
    if (status !== 4 && status !== 5) return;
    const newStatus = status === 4 ? 'maker_won' : 'taker_won';

    const [parlay] = await db.select({
      id:       p2pParlayOffers.id,
      status:   p2pParlayOffers.status,
      currency: p2pParlayOffers.currency,
    }).from(p2pParlayOffers)
      .where(eq(p2pParlayOffers.onchainParlayId, parlayId))
      .limit(1);

    if (!parlay) return;
    if (parlay.status === newStatus || parlay.status === 'voided') return;

    const payoutBase: number = Number(parsed?.payout ?? 0);
    const currency = (parlay.currency ?? 'SUI').toUpperCase();
    const decimals = (currency === 'USDSUI' || currency === 'USDC') ? 6 : 9;
    const actualPayout = payoutBase / Math.pow(10, decimals);

    await db.update(p2pParlayOffers).set({
      status:           newStatus as any,
      winner:           winner ?? null,
      actualPayout:     actualPayout || null,
      settlementTxHash: txDigest ?? null,
      settledAt:        new Date(),
    }).where(eq(p2pParlayOffers.id, parlay.id));

    console.log(`[P2P⚡] ParlaySettled → parlay #${parlay.id} (${parlayId.slice(0, 16)}...) → ${newStatus} | TX: ${(txDigest ?? '').slice(0, 20)}...`);
  } catch (err: any) {
    console.warn('[P2P⚡] handleP2PParlaySettled error:', err.message);
  }
}

/** Called for P2P::ParlayVoided — marks parlay voided so loop skips it. */
async function handleP2PParlayVoided(parsed: any, txDigest?: string): Promise<void> {
  try {
    const parlayId: string = parsed?.parlay_id;
    if (!parlayId) return;

    const [parlay] = await db.select({ id: p2pParlayOffers.id, status: p2pParlayOffers.status })
      .from(p2pParlayOffers).where(eq(p2pParlayOffers.onchainParlayId, parlayId)).limit(1);

    if (!parlay) return;
    if (parlay.status === 'voided') return;

    await db.update(p2pParlayOffers).set({
      status:           'voided' as any,
      settlementTxHash: txDigest ?? null,
      settledAt:        new Date(),
    }).where(eq(p2pParlayOffers.id, parlay.id));

    console.log(`[P2P⚡] ParlayVoided → parlay #${parlay.id} (${parlayId.slice(0, 16)}...) | TX: ${(txDigest ?? '').slice(0, 20)}...`);
  } catch (err: any) {
    console.warn('[P2P⚡] handleP2PParlayVoided error:', err.message);
  }
}

/**
 * Called for P2P::OfferPosted — auto-syncs on-chain offers that were created
 * directly via the contract (bypassing the API) into the DB so they appear in
 * the UI and can be settled by the settlement worker.
 */
async function handleP2POfferPosted(parsed: any, txDigest?: string): Promise<void> {
  try {
    const offerId: string = parsed?.offer_id;
    if (!offerId) return;

    // Skip if already in DB
    const [existing] = await db.select({ id: p2pBetOffers.id })
      .from(p2pBetOffers).where(eq(p2pBetOffers.onchainOfferId, offerId)).limit(1);
    if (existing) return;

    // Decode byte arrays to UTF-8 strings
    const decodeBytes = (arr: number[] | string): string =>
      Array.isArray(arr) ? Buffer.from(arr).toString('utf8') : String(arr ?? '');

    const eventId    = decodeBytes(parsed.event_id);
    const eventName  = decodeBytes(parsed.event_name);
    const marketType = decodeBytes(parsed.market_type) || 'match_winner';
    const prediction = decodeBytes(parsed.prediction);
    const makerWallet: string = parsed.maker;
    const oddsBps    = Number(parsed.odds_bps || 10000);
    const odds       = oddsBps / 10000;
    const expiresAt  = parsed.expires_at ? new Date(Number(parsed.expires_at)) : new Date(Date.now() + 86400000 * 7);
    const createdAt  = parsed.timestamp   ? new Date(Number(parsed.timestamp))  : new Date();

    // Determine currency by querying the on-chain object type
    let currency = 'SBETS';
    try {
      const rpcUrl = getJsonRpcUrl();
      const objRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'sui_getObject',
          params: [offerId, { showType: true }],
        }),
        signal: AbortSignal.timeout(5_000),
      });
      const objJson: any = await objRes.json();
      const objType: string = objJson?.result?.data?.type ?? '';
      if      (objType.includes('0x2::sui::SUI'))    currency = 'SUI';
      else if (objType.includes('::sbets::SBETS'))   currency = 'SBETS';
      else if (objType.includes('::usdsui::USDSUI')) currency = 'USDSUI';
      else if (objType.includes('::usdc::USDC'))     currency = 'USDC';
    } catch { /* keep SBETS default */ }

    const decimals   = (currency === 'USDSUI' || currency === 'USDC') ? 6 : 9;
    const makerStake = Number(parsed.maker_stake || 0) / Math.pow(10, decimals);
    const takerStake = Math.round(makerStake * (odds - 1) * 1_000_000) / 1_000_000;

    if (makerStake <= 0) return;

    const isFantasy = marketType.startsWith('fantasy');

    await db.insert(p2pBetOffers).values({
      creatorWallet:   makerWallet,
      eventId,
      eventName,
      homeTeam:        isFantasy ? 'My World Cup XI' : eventName,
      awayTeam:        isFantasy ? 'Open Challenge'  : 'Opponent',
      leagueName:      isFantasy ? 'Fantasy World Cup 2026' : undefined,
      sportName:       isFantasy ? 'fantasy' : undefined,
      prediction,
      marketType:      marketType as any,
      odds,
      creatorStake:    makerStake,
      takerStake,
      currency:        currency as any,
      filledStake:     0,
      status:          'open' as any,
      creatorTxHash:   txDigest ?? null,
      expiresAt,
      createdAt,
      onchainOfferId:  offerId,
      onchainConfigId: parsed.config_id ?? null,
    } as any);

    console.log(`[P2P⚡] OfferPosted synced → ${offerId.slice(0, 16)}... | ${makerStake} ${currency} @ ${odds}x | "${eventName}"`);
    broadcastChainEvent('OfferPosted', {
      offerId:    offerId.slice(0, 20),
      eventName,
      currency,
      makerStake,
      odds,
      prediction,
      txDigest:   txDigest?.slice(0, 20),
    });
  } catch (err: any) {
    console.warn('[P2P⚡] handleP2POfferPosted error:', err.message);
  }
}

/**
 * Called for P2P::OfferExpired — records the on-chain refund TX so the
 * 5-minute loop stops retrying expire_offer for this offer.
 */
async function handleP2POfferExpired(parsed: any, txDigest?: string): Promise<void> {
  try {
    const offerId: string = parsed?.offer_id;
    if (!offerId) return;

    const [offer] = await db.select({ id: p2pBetOffers.id, status: p2pBetOffers.status, refundTxHash: p2pBetOffers.refundTxHash })
      .from(p2pBetOffers).where(eq(p2pBetOffers.onchainOfferId, offerId)).limit(1);

    if (!offer) return;
    // Skip if already has a real refund TX (not PENDING)
    if (offer.refundTxHash && offer.refundTxHash !== 'PENDING' && offer.refundTxHash !== 'ON_CHAIN_SETTLED') return;

    await db.update(p2pBetOffers).set({
      status:      'expired' as any,
      refundTxHash: txDigest ?? 'ON_CHAIN_SETTLED',
    }).where(eq(p2pBetOffers.id, offer.id));

    console.log(`[P2P⚡] OfferExpired synced → offer #${offer.id} (${offerId.slice(0, 16)}...) | refundTx: ${(txDigest ?? 'ON_CHAIN_SETTLED').slice(0, 20)}...`);
    broadcastChainEvent('OfferExpired', { offerId: offerId.slice(0, 20), txDigest: txDigest?.slice(0, 20) });
  } catch (err: any) {
    console.warn('[P2P⚡] handleP2POfferExpired error:', err.message);
  }
}

/**
 * Called for P2P::OfferCancelled — records the on-chain cancel TX so the
 * backend does not attempt a double-refund for this offer.
 */
async function handleP2POfferCancelled(parsed: any, txDigest?: string): Promise<void> {
  try {
    const offerId: string = parsed?.offer_id;
    if (!offerId) return;

    const [offer] = await db.select({ id: p2pBetOffers.id, status: p2pBetOffers.status, refundTxHash: p2pBetOffers.refundTxHash })
      .from(p2pBetOffers).where(eq(p2pBetOffers.onchainOfferId, offerId)).limit(1);

    if (!offer) return;
    if (offer.status === 'cancelled' && offer.refundTxHash && offer.refundTxHash !== 'PENDING') return;

    await db.update(p2pBetOffers).set({
      status:      'cancelled' as any,
      refundTxHash: txDigest ?? 'ON_CHAIN_SETTLED',
    }).where(eq(p2pBetOffers.id, offer.id));

    console.log(`[P2P⚡] OfferCancelled synced → offer #${offer.id} (${offerId.slice(0, 16)}...) | cancelTx: ${(txDigest ?? 'ON_CHAIN_SETTLED').slice(0, 20)}...`);
    broadcastChainEvent('OfferCancelled', { offerId: offerId.slice(0, 20), txDigest: txDigest?.slice(0, 20) });
  } catch (err: any) {
    console.warn('[P2P⚡] handleP2POfferCancelled error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P2P fast-poll — dedicated 10-second poller for settlement events only.
// Separate cursors from the main 30-second poller so each works independently.
// ─────────────────────────────────────────────────────────────────────────────
const P2P_FAST_POLL_MS = 10_000;
const p2pCursors: Record<string, string | null> = {};
let p2pFastTimer: ReturnType<typeof setTimeout> | null = null;

const P2P_SETTLEMENT_EVENT_TYPES = [
  `${P2P_PACKAGE_ID}::p2p_betting::BetSettled`,
  `${P2P_PACKAGE_ID}::p2p_betting::BetVoided`,
  `${P2P_PACKAGE_ID}::p2p_betting::ParlaySettled`,
  `${P2P_PACKAGE_ID}::p2p_betting::ParlayVoided`,
  `${P2P_PACKAGE_ID}::p2p_betting::OfferExpired`,
  `${P2P_PACKAGE_ID}::p2p_betting::OfferCancelled`,
  // Auto-sync on-chain-only offers (posted directly via contract, not API)
  `${P2P_PACKAGE_ID}::p2p_betting::OfferPosted`,
];

async function pollP2PSettlementEventType(eventType: string): Promise<void> {
  try {
    const rpcUrl = getJsonRpcUrl();
    const cursor = p2pCursors[eventType] ?? null;

    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'suix_queryEvents',
        params: [{ MoveEventType: eventType }, cursor, 20, false],
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) return;
    const json: any = await response.json();
    const data = json?.result;
    if (!data?.data?.length) return;

    for (const event of data.data) {
      const parsed   = event.parsedJson || {};
      const txDigest = event.id?.txDigest as string | undefined;

      if      (eventType.endsWith('BetSettled'))     await handleP2PBetSettled(parsed, txDigest);
      else if (eventType.endsWith('BetVoided'))      await handleP2PBetVoided(parsed, txDigest);
      else if (eventType.endsWith('ParlaySettled'))  await handleP2PParlaySettled(parsed, txDigest);
      else if (eventType.endsWith('ParlayVoided'))   await handleP2PParlayVoided(parsed, txDigest);
      else if (eventType.endsWith('OfferExpired'))   await handleP2POfferExpired(parsed, txDigest);
      else if (eventType.endsWith('OfferCancelled')) await handleP2POfferCancelled(parsed, txDigest);
      else if (eventType.endsWith('OfferPosted'))    await handleP2POfferPosted(parsed, txDigest);

      stats.eventsProcessed++;
    }

    if (data.nextCursor) {
      p2pCursors[eventType] = data.nextCursor;
      saveCursor(eventType, JSON.stringify(data.nextCursor)).catch(() => {});
    }
  } catch (_err: any) {
    // Silently skip — fast-poll errors are transient (rate limits, network blips)
  }
}

async function p2pFastPoll(): Promise<void> {
  if (stopped) return;
  for (const et of P2P_SETTLEMENT_EVENT_TYPES) {
    await pollP2PSettlementEventType(et);
  }
  if (!stopped) {
    p2pFastTimer = setTimeout(p2pFastPoll, P2P_FAST_POLL_MS);
  }
}

async function poll(): Promise<void> {
  if (stopped) return;
  stats.polls++;
  stats.lastPollAt = Date.now();

  const eventTypes = [
    `${BETTING_PACKAGE_ID}::betting::BetPlaced`,
    `${BETTING_PACKAGE_ID}::betting::BetSettled`,
    `${PREDICTION_PACKAGE_ID}::prediction_market::MarketResolved`,
    // P2P: detect on-chain fills that bypass the API (creates DB match records for orphaned bets)
    `${P2P_PACKAGE_ID}::p2p_betting::OfferFilled`,
  ];

  for (const et of eventTypes) {
    await pollEventType(et);
  }

  if (!stopped) {
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  }
}

export async function startMoveEventListener(): Promise<void> {
  if (stopped === false && stats.running) return; // already running
  stopped = false;
  stats.running = true;
  console.log('[MoveEvents] 🚀 Starting Move event poller (30 s interval)…');
  console.log('[P2P⚡] Starting P2P fast-settlement poller (10 s interval)…');

  // Restore persisted cursors before first poll — no events missed across restarts
  await loadCursors();

  // Attempt native WS subscriptions (1 s latency vs 10 s polling)
  // Polling continues regardless as a safety net
  startWsSubscriptions();

  // First poll after a short delay so server is fully up
  pollTimer = setTimeout(poll, 5_000);
  // P2P fast-poll starts 8 s after server up (staggered from main poll)
  p2pFastTimer = setTimeout(p2pFastPoll, 8_000);
}

export function stopMoveEventListener(): void {
  stopped = true;
  stats.running = false;
  stopWsSubscriptions();
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  if (p2pFastTimer) {
    clearTimeout(p2pFastTimer);
    p2pFastTimer = null;
  }
  console.log('[MoveEvents] 🛑 Stopped');
}

export function getMoveEventListenerStats(): EventStats {
  return { ...stats };
}
