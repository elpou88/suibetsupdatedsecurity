/**
 * deepbookFillListener.ts
 *
 * Polls the Sui network for DeepBook V3 OrderFilled events on the SBETS/SUI pool.
 *
 * ⚠️  IMPORTANT — SETTLEMENT SAFETY RULE:
 *
 *   A DeepBook order fill is a TOKEN SWAP (tokens exchanged immediately on-chain).
 *   It is NOT the same as accepting a P2P bet.
 *
 *   P2P bet stakes are held in the P2P smart contract escrow.
 *   DeepBook holds funds in the user's Balance Manager (separate system).
 *
 *   If we auto-matched based on a DeepBook fill, settlement would break:
 *     • P2P contract only holds creator's stake (taker never locked anything there)
 *     • Creator wins → creator gets P2P stake back PLUS got taker's tokens in swap = double pay ❌
 *     • Taker wins  → settlement tries to pay from P2P contract that only has creator's stake ❌
 *
 *   CORRECT flow:
 *     Creator lists on DeepBook  → DISCOVERY / advertising only
 *     Taker sees the offer       → visits dApp → calls accept_offer on P2P contract
 *     accept_offer               → locks taker's stake in contract ✅
 *     Sports result              → contract pays winner from BOTH locked stakes ✅
 *
 *   This listener only RECORDS fills and emits notifications. It does NOT
 *   change offer status to "matched". Only accept_offer on the P2P contract can do that.
 */

import { getSuiClient } from '../lib/suiRpcConfig';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { mainnetPackageIds } from '@mysten/deepbook-v3';

// ── Config ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS   = 30_000;    // poll every 30 s
const PAGE_LIMIT         = 50;
const CURSOR_KEY         = 'deepbook_fill_cursor';

// DeepBook V3 mainnet package — OrderFilled event type
const DEEPBOOK_PKG       = (mainnetPackageIds as any).DEEPBOOK_PACKAGE_ID
  ?? '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809';

const ORDER_FILLED_TYPE  = `${DEEPBOOK_PKG}::clob::OrderFilled`;

let _running = false;

// ── In-memory notification queue (latest 200 fills) ──────────────────────────

export type DeepBookFillRecord = {
  offerId:         number;
  creatorWallet:   string;
  takerAddress:    string;
  txDigest:        string;
  filledAt:        number;
  clientOrderId:   string;
};

const _recentFills: DeepBookFillRecord[] = [];

export function getRecentFills(): DeepBookFillRecord[] {
  return [..._recentFills];
}

// ── Persistent cursor ─────────────────────────────────────────────────────────

async function loadCursor(): Promise<string | null> {
  try {
    const rows = await db.execute(
      sql`SELECT value FROM kv_store WHERE key = ${CURSOR_KEY} LIMIT 1`
    );
    return (rows.rows[0]?.value as string) ?? null;
  } catch {
    return null;
  }
}

async function saveCursor(cursor: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO kv_store (key, value) VALUES (${CURSOR_KEY}, ${cursor})
      ON CONFLICT (key) DO UPDATE SET value = ${cursor}
    `);
  } catch {
    // kv_store may not exist — silently skip persistence
  }
}

// ── Core poll logic ───────────────────────────────────────────────────────────

async function pollFills(): Promise<void> {
  const suiClient = getSuiClient() as any;
  const poolId    = process.env.DEEPBOOK_SBETS_SUI_POOL_ID;

  if (!poolId) return;

  let cursor: any = await loadCursor() ?? null;
  let hasMore     = true;

  while (hasMore) {
    const result = await suiClient.queryEvents({
      query:  { MoveEventType: ORDER_FILLED_TYPE },
      cursor,
      limit:  PAGE_LIMIT,
      order:  'ascending',
    });

    const events: any[] = result?.data ?? [];
    hasMore = result?.hasNextPage ?? false;

    for (const event of events) {
      try {
        await handleFillEvent(event, poolId);
      } catch (err: any) {
        console.warn(`[DeepBookFill] Error handling event ${event.id?.txDigest}: ${err.message}`);
      }
    }

    if (result?.nextCursor) {
      cursor = result.nextCursor;
      await saveCursor(JSON.stringify(cursor));
    }
  }
}

async function handleFillEvent(event: any, sbetsSuiPoolId: string): Promise<void> {
  const parsed = event?.parsedJson ?? {};

  // Only care about fills on our SBETS/SUI pool
  const eventPoolId = parsed.pool_id ?? parsed.poolId ?? '';
  if (!eventPoolId || !eventPoolId.includes(sbetsSuiPoolId.replace('0x', ''))) return;

  const makerClientOrderId: string = String(
    parsed.maker_client_order_id ??
    parsed.makerClientOrderId    ??
    parsed.client_order_id       ??
    ''
  );
  const takerAddress: string =
    parsed.taker         ??
    parsed.taker_address ??
    parsed.takerAddress  ??
    '';
  const makerAddress: string =
    parsed.maker         ??
    parsed.maker_address ??
    parsed.makerAddress  ??
    '';
  const txDigest: string = event.id?.txDigest ?? '';

  if (!makerClientOrderId || !takerAddress) return;

  // Look up the offer whose listing matches this fill
  const rows = await db.execute(sql`
    SELECT id, creator_wallet, status, currency, creator_stake, odds, event_id, event_name
    FROM p2p_bet_offers
    WHERE deepbook_client_order_id = ${makerClientOrderId}
    LIMIT 1
  `);

  if (!rows.rows.length) return;
  const offer = rows.rows[0] as {
    id: number;
    creator_wallet: string;
    status: string;
    currency: string;
    creator_stake: number;
    odds: number;
    event_id: string;
    event_name: string;
  };

  // Sanity: maker should be the offer creator
  if (makerAddress && makerAddress !== offer.creator_wallet) {
    console.warn(
      `[DeepBookFill] fill for offer #${offer.id}: maker ${makerAddress} ≠ creator ${offer.creator_wallet} — ignoring`
    );
    return;
  }

  // ── RECORD FILL FOR NOTIFICATION ONLY — do NOT change offer status ───────────
  //
  // A DeepBook fill is a token swap. The bet is NOT matched yet.
  // To match the bet, the taker must call accept_offer on the P2P contract,
  // which locks their actual stake. Only then does settlement become valid.
  //
  // We record the filler's address so the creator can be notified:
  //   "Your DeepBook listing was filled by 0x... — if they haven't accepted the bet
  //    in the dApp, share the offer link with them."

  const record: DeepBookFillRecord = {
    offerId:       offer.id,
    creatorWallet: offer.creator_wallet,
    takerAddress,
    txDigest,
    filledAt:      Date.now(),
    clientOrderId: makerClientOrderId,
  };

  // Keep the in-memory queue bounded
  _recentFills.unshift(record);
  if (_recentFills.length > 200) _recentFills.length = 200;

  // Store fill in DB for audit (best-effort — does not affect offer status)
  try {
    await db.execute(sql`
      UPDATE p2p_bet_offers
      SET deepbook_order_digest = ${txDigest}
      WHERE id = ${offer.id}
    `);
  } catch { /* non-fatal */ }

  console.log(
    `[DeepBookFill] 📋 Offer #${offer.id} listing filled on DeepBook` +
    ` — taker=${takerAddress.slice(0, 10)}...` +
    ` tx=${txDigest}` +
    ` (NOTIFICATION ONLY — offer status unchanged; taker must accept_offer on P2P contract to lock stake)`
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startDeepBookFillListener(): Promise<void> {
  if (_running) return;
  if (!process.env.DEEPBOOK_SBETS_SUI_POOL_ID) {
    console.log('[DeepBookFill] DEEPBOOK_SBETS_SUI_POOL_ID not set — fill listener disabled');
    return;
  }

  _running = true;
  console.log('[DeepBookFill] Fill listener started — polls every 30 s, NOTIFICATION ONLY (no auto-match)');

  const tick = async () => {
    try {
      await pollFills();
    } catch (err: any) {
      console.warn('[DeepBookFill] Poll error:', err.message);
    } finally {
      if (_running) setTimeout(tick, POLL_INTERVAL_MS);
    }
  };

  setTimeout(tick, 5_000);
}

export function stopDeepBookFillListener(): void {
  _running = false;
}
