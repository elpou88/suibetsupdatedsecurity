/**
 * engineAutoSettleService.ts
 *
 * Auto-settlement scheduler for FLUX (FluxShard) and PULSE (PulsePool) engines.
 * Runs every 5 minutes. Each cycle:
 *   1. Queries the last N FluxShardFilled events → discovers pending shards
 *   2. Queries the last N PulsePoolCreated events → discovers pools
 *   3. Fetches parent FluxOffer / PulsePool object for event_id + prediction
 *   4. Resolves match result via ESPN
 *   5. Auto-settles shards/pools whose events have finished
 *
 * Requires: P2P_ORACLE_CAP_ID + ADMIN_PRIVATE_KEY (same keys as WARP engine)
 */

import { getJsonRpcUrl } from '../lib/suiRpcConfig';
import { executeFluxBatch, type ShardSettleSpec } from './fluxEngineService';
import {
  executePoolAction,
  buildLockPoolPTB,
  buildSettlePoolPTB,
  buildVoidPoolPTB,
} from './pulseEngineService';

const FLUX_PACKAGE_ID  = (process.env.FLUX_PACKAGE_ID  || '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018').trim();
const PULSE_PACKAGE_ID = (process.env.PULSE_PACKAGE_ID || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238').trim();
const SUI_COIN_TYPE    = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

const AUTO_SETTLE_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const MAX_EVENTS_PER_CYCLE    = 50;              // events queried per cycle
const MAX_CYCLE_MS            = 10 * 60 * 1000; // watchdog: force-reset after 10 min

// In-memory cache of already-settled IDs — prevents re-querying on every cycle
const settledShardIds = new Set<string>();
const settledPoolIds  = new Set<string>();

let autoSettleRunning   = false;
let autoSettleStartedAt: number | null = null;
let autoSettleTimer:     ReturnType<typeof setInterval> | null = null;

// ── Utility helpers ───────────────────────────────────────────────────────────

function decodeBytes(value: any): string {
  try {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return Buffer.from(value).toString('utf8').replace(/\0/g, '').trim();
    return String(value);
  } catch {
    return '';
  }
}

async function rpcPost(method: string, params: any[]): Promise<any> {
  const rpcUrl = getJsonRpcUrl();
  const resp = await fetch(rpcUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal:  AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`RPC ${method} HTTP ${resp.status}`);
  const json: any = await resp.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

async function getObjectFields(objectId: string): Promise<Record<string, any> | null> {
  try {
    const result = await rpcPost('sui_getObject', [objectId, { showContent: true }]);
    return result?.data?.content?.fields ?? null;
  } catch {
    return null;
  }
}

function extractId(raw: any): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.id) return raw.id;
  return String(raw);
}

// ── ESPN match result lookup ──────────────────────────────────────────────────

// Explicit sport/league combos — ensures WNBA, NHL, NFL are probed with the
// correct league path that ESPN requires (bare sport root returns 404 for WNBA).
const ESPN_SPORT_COMBOS: Array<[string, string]> = [
  ['soccer',   'all'],
  ['football', 'nfl'],
  ['basketball', 'nba'],
  ['basketball', 'wnba'],
  ['basketball', 'mens-college-basketball'],
  ['baseball',   'mlb'],
  ['hockey',     'nhl'],
  ['mma',        'ufc'],
];

async function fetchMatchResult(eventId: string): Promise<{
  winner:    string;
  homeTeam:  string;
  awayTeam:  string;
  homeScore: number;
  awayScore: number;
} | null> {
  if (!eventId || eventId.length < 2) return null;

  // ── tsdb: prefix → use TheSportsDB lookup by numeric event ID ───────────────
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
            const homeTeam  = ev.strHomeTeam ?? '';
            const awayTeam  = ev.strAwayTeam ?? '';
            const winner    = homeScore > awayScore ? homeTeam
                            : awayScore > homeScore ? awayTeam
                            : 'draw';
            console.log(`[EngineAutoSettle] TSDB ${numId}: ${homeTeam} ${homeScore}-${awayScore} ${awayTeam} → ${winner}`);
            return { winner, homeTeam, awayTeam, homeScore, awayScore };
          }
        }
      }
    } catch (err: any) {
      console.warn(`[EngineAutoSettle] TSDB lookup failed for ${eventId}: ${err.message}`);
    }
    return null; // tsdb: IDs are not on ESPN; stop here
  }

  // ── Standard ESPN event IDs ──────────────────────────────────────────────────
  for (const [sport, league] of ESPN_SPORT_COMBOS) {
    try {
      const url  = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${eventId}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!resp.ok) continue;
      const data: any = await resp.json();
      const comp = data?.header?.competitions?.[0];
      if (!comp?.status?.type?.completed) continue;

      const competitors = comp.competitors ?? [];
      if (competitors.length < 2) continue;

      const home      = competitors.find((c: any) => c.homeAway === 'home');
      const away      = competitors.find((c: any) => c.homeAway === 'away');
      const homeTeam  = home?.team?.displayName ?? '';
      const awayTeam  = away?.team?.displayName ?? '';
      const homeScore = Number(home?.score ?? 0);
      const awayScore = Number(away?.score ?? 0);
      const winner    = homeScore > awayScore ? homeTeam
                      : awayScore > homeScore ? awayTeam
                      : 'draw';
      console.log(`[EngineAutoSettle] ESPN ${sport}/${league} event ${eventId}: ${homeTeam} ${homeScore}-${awayScore} ${awayTeam} → ${winner}`);
      return { winner, homeTeam, awayTeam, homeScore, awayScore };
    } catch {
      // try next combo
    }
  }
  return null;
}

function predictionWon(
  prediction: string,
  homeTeam:   string,
  awayTeam:   string,
  winner:     string,
): boolean {
  const pred = prediction.trim().toLowerCase();
  const win  = winner.trim().toLowerCase();
  const home = homeTeam.trim().toLowerCase();
  const away = awayTeam.trim().toLowerCase();

  if (pred === 'draw')   return win === 'draw';
  if (pred === 'home')   return win === home;
  if (pred === 'away')   return win === away;
  if (win  === 'draw')   return false;
  if (pred.includes(home) || home.includes(pred)) return win === home;
  if (pred.includes(away) || away.includes(pred)) return win === away;
  return false;
}

// ── FLUX auto-settlement ──────────────────────────────────────────────────────

async function autoSettleFluxShards(): Promise<void> {
  if (!FLUX_PACKAGE_ID) return;

  const eventType = `${FLUX_PACKAGE_ID}::flux_engine::FluxShardFilled`;
  let events: any[] = [];
  try {
    const result = await rpcPost('suix_queryEvents', [{ MoveEventType: eventType }, null, MAX_EVENTS_PER_CYCLE, true]);
    events = result?.data ?? [];
  } catch (err: any) {
    console.warn('[EngineAutoSettle] FLUX event query failed:', err.message);
    return;
  }

  // Collect pending shards grouped by event_id
  const byEvent = new Map<string, { prediction: string; shardIds: string[] }>();

  for (const evt of events) {
    const parsed  = evt.parsedJson ?? {};
    const shardId = extractId(parsed.shard_id);
    const offerId = extractId(parsed.offer_id);
    if (!shardId || settledShardIds.has(shardId)) continue;

    // Check on-chain shard status — SHARD_PENDING = 0
    const shardFields = await getObjectFields(shardId);
    if (!shardFields) { settledShardIds.add(shardId); continue; }
    const shardStatus = Number(shardFields.status ?? 99);
    if (shardStatus !== 0) { settledShardIds.add(shardId); continue; }

    // Get event_id + prediction from parent FluxOffer
    if (!offerId) continue;
    const offerFields = await getObjectFields(offerId);
    if (!offerFields) continue;
    const eventId  = decodeBytes(offerFields.event_id);
    const pred     = decodeBytes(offerFields.prediction);
    if (!eventId)  continue;

    if (!byEvent.has(eventId)) byEvent.set(eventId, { prediction: pred, shardIds: [] });
    byEvent.get(eventId)!.shardIds.push(shardId);
  }

  if (!byEvent.size) return;
  console.log(`[EngineAutoSettle] FLUX: checking ${byEvent.size} event(s) with pending shards`);

  for (const [eventId, { prediction, shardIds }] of byEvent) {
    const matchResult = await fetchMatchResult(eventId);
    if (!matchResult) continue; // not finished yet

    const makerWon = predictionWon(prediction, matchResult.homeTeam, matchResult.awayTeam, matchResult.winner);
    const takerWon = !makerWon;

    const specs: ShardSettleSpec[] = shardIds.map(shardObjectId => ({
      shardObjectId,
      takerWon,
      coinType: SUI_COIN_TYPE,
    }));

    console.log(`[EngineAutoSettle] FLUX: settling ${specs.length} shard(s) for event "${eventId}" (takerWon=${takerWon}, winner="${matchResult.winner}")`);
    try {
      const res = await executeFluxBatch(specs, false);
      if (res.success) {
        shardIds.forEach(id => settledShardIds.add(id));
        console.log(`[EngineAutoSettle] ✅ FLUX batch settled | tx: ${res.txDigest} | gas: ${res.gasUsed}`);
      } else {
        console.error(`[EngineAutoSettle] ❌ FLUX batch failed: ${res.error}`);
      }
    } catch (err: any) {
      console.error('[EngineAutoSettle] FLUX executeFluxBatch threw:', err.message);
    }
  }
}

// ── PULSE auto-settlement ─────────────────────────────────────────────────────

async function autoSettlePulsePools(): Promise<void> {
  if (!PULSE_PACKAGE_ID) return;

  const eventType = `${PULSE_PACKAGE_ID}::pulse_engine::PulsePoolCreated`;
  let events: any[] = [];
  try {
    const result = await rpcPost('suix_queryEvents', [{ MoveEventType: eventType }, null, MAX_EVENTS_PER_CYCLE, true]);
    events = result?.data ?? [];
  } catch (err: any) {
    console.warn('[EngineAutoSettle] PULSE event query failed:', err.message);
    return;
  }

  const poolIds: string[] = [];
  for (const evt of events) {
    const parsed = evt.parsedJson ?? {};
    const poolId = extractId(parsed.pool_id);
    if (poolId && !settledPoolIds.has(poolId)) poolIds.push(poolId);
  }

  if (!poolIds.length) return;
  console.log(`[EngineAutoSettle] PULSE: checking ${poolIds.length} pool(s)`);

  for (const poolId of poolIds) {
    const fields = await getObjectFields(poolId);
    if (!fields) { settledPoolIds.add(poolId); continue; }

    const status   = Number(fields.status ?? 99);
    // POOL_SETTLED=2 or POOL_VOIDED=3 → already done
    if (status === 2 || status === 3) { settledPoolIds.add(poolId); continue; }

    const eventId   = decodeBytes(fields.event_id);
    const sideAName = decodeBytes(fields.side_a_name);
    const sideBName = decodeBytes(fields.side_b_name);
    if (!eventId) continue;

    const matchResult = await fetchMatchResult(eventId);
    if (!matchResult) continue; // event not finished

    const winStr = matchResult.winner.trim().toLowerCase();
    const sideA  = sideAName.trim().toLowerCase();
    const sideB  = sideBName.trim().toLowerCase();

    // Detect draw → void pool
    if (winStr === 'draw') {
      try {
        // POOL_OPEN (0) → lock first
        if (status === 0) {
          const lockTx  = buildLockPoolPTB({ poolObjectId: poolId, coinType: SUI_COIN_TYPE });
          const lockRes  = await executePoolAction(lockTx, `lock pool ${poolId.slice(0, 12)} (pre-void)`);
          if (!lockRes.success) { console.error(`[EngineAutoSettle] PULSE pre-lock failed: ${lockRes.error}`); continue; }
          console.log(`[EngineAutoSettle] ✅ PULSE pre-lock: ${lockRes.txDigest}`);
        }
        const voidTx  = buildVoidPoolPTB({ poolObjectId: poolId, coinType: SUI_COIN_TYPE });
        const voidRes = await executePoolAction(voidTx, `void pool ${poolId.slice(0, 12)} (draw)`);
        if (voidRes.success) {
          settledPoolIds.add(poolId);
          console.log(`[EngineAutoSettle] ✅ PULSE void (draw): ${voidRes.txDigest}`);
        } else {
          console.error(`[EngineAutoSettle] ❌ PULSE void failed: ${voidRes.error}`);
        }
      } catch (err: any) {
        console.error('[EngineAutoSettle] PULSE void error:', err.message);
      }
      continue;
    }

    // Determine winning side
    let winnerSide: 0 | 1 | null = null;
    if (sideA && (winStr.includes(sideA) || sideA.includes(winStr))) winnerSide = 0;
    else if (sideB && (winStr.includes(sideB) || sideB.includes(winStr))) winnerSide = 1;

    if (winnerSide === null) {
      console.warn(`[EngineAutoSettle] PULSE: cannot match winner "${matchResult.winner}" to sides "${sideAName}"/"${sideBName}" for pool ${poolId.slice(0, 12)}`);
      continue;
    }

    // POOL_OPEN (0) → lock first, then settle
    if (status === 0) {
      try {
        const lockTx  = buildLockPoolPTB({ poolObjectId: poolId, coinType: SUI_COIN_TYPE });
        const lockRes  = await executePoolAction(lockTx, `lock pool ${poolId.slice(0, 12)}`);
        if (!lockRes.success) {
          // If already locked (race condition), continue to settle
          if (!(lockRes.error ?? '').includes('EPoolNotOpen')) {
            console.error(`[EngineAutoSettle] PULSE lock failed: ${lockRes.error}`);
            continue;
          }
        } else {
          console.log(`[EngineAutoSettle] ✅ PULSE lock: ${lockRes.txDigest}`);
        }
      } catch (err: any) {
        console.error('[EngineAutoSettle] PULSE lock error:', err.message);
        continue;
      }
    }

    // POOL_LOCKED (1) → settle
    try {
      const settleTx  = buildSettlePoolPTB({ poolObjectId: poolId, winner: winnerSide, coinType: SUI_COIN_TYPE });
      const settleRes = await executePoolAction(settleTx, `settle pool ${poolId.slice(0, 12)} winner=${winnerSide === 0 ? sideAName : sideBName}`);
      if (settleRes.success) {
        settledPoolIds.add(poolId);
        console.log(`[EngineAutoSettle] ✅ PULSE settle: ${settleRes.txDigest}`);
      } else {
        console.error(`[EngineAutoSettle] ❌ PULSE settle failed: ${settleRes.error}`);
      }
    } catch (err: any) {
      console.error('[EngineAutoSettle] PULSE settle error:', err.message);
    }
  }
}

// ── Main cycle ────────────────────────────────────────────────────────────────

async function runAutoSettleCycle(): Promise<void> {
  // Watchdog: if running for > MAX_CYCLE_MS, force-reset
  if (autoSettleRunning) {
    if (autoSettleStartedAt && Date.now() - autoSettleStartedAt > MAX_CYCLE_MS) {
      console.warn('[EngineAutoSettle] ⚠️ Cycle stuck >10min — force-resetting');
      autoSettleRunning   = false;
      autoSettleStartedAt = null;
    } else {
      return;
    }
  }

  autoSettleRunning   = true;
  autoSettleStartedAt = Date.now();

  try {
    await autoSettleFluxShards();
    await autoSettlePulsePools();
  } catch (err: any) {
    console.error('[EngineAutoSettle] Cycle error:', err.message);
  } finally {
    autoSettleRunning   = false;
    autoSettleStartedAt = null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startEngineAutoSettle(intervalMs = AUTO_SETTLE_INTERVAL_MS): void {
  if (!process.env.P2P_ORACLE_CAP_ID || !process.env.ADMIN_PRIVATE_KEY) {
    console.warn('[EngineAutoSettle] ⚠️ P2P_ORACLE_CAP_ID or ADMIN_PRIVATE_KEY not set — FLUX/PULSE auto-settle disabled');
    return;
  }

  console.log(`[EngineAutoSettle] 🚀 FLUX+PULSE auto-settlement started (interval: ${intervalMs / 60_000}min)`);

  // Run immediately on startup to catch anything that piled up
  runAutoSettleCycle().catch((e: any) =>
    console.error('[EngineAutoSettle] Startup cycle error:', e.message)
  );

  autoSettleTimer = setInterval(() => {
    runAutoSettleCycle().catch((e: any) =>
      console.error('[EngineAutoSettle] Interval cycle error:', e.message)
    );
  }, intervalMs);
}

export function stopEngineAutoSettle(): void {
  if (autoSettleTimer) {
    clearInterval(autoSettleTimer);
    autoSettleTimer = null;
  }
  console.log('[EngineAutoSettle] Auto-settle stopped');
}
