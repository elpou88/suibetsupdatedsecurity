/**
 * engineActivityService.ts
 *
 * Keeps WARP, FLUX, and PULSE engines visibly active on-chain on Railway.
 *
 * Every 10 minutes it:
 *   1. WARP  — calls warp_batch_marker with count of P2P bets settled this cycle
 *   2. FLUX  — calls flux_batch_close (1 shard, keeps FLUX visible on SuiVision)
 *   3. PULSE — picks a real recently-settled match from settled_events,
 *              creates a PulsePool, locks it, then settles or voids it.
 *
 * This ensures all three engines emit on-chain events continuously in production,
 * independent of whether any user has placed a FLUX/PULSE bet.
 *
 * Requires: ADMIN_PRIVATE_KEY (or PRIVATE_KEY) + P2P_ORACLE_CAP_ID
 */

import { Ed25519Keypair }       from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey }  from '@mysten/sui/cryptography';
import { Transaction }          from '@mysten/sui/transactions';
import { getJsonRpcUrl, getSuiClient } from '../lib/suiRpcConfig';
import {
  executePoolAction,
  buildLockPoolPTB,
  buildSettlePoolPTB,
  buildVoidPoolPTB,
  SIDE_A,
  SIDE_B,
} from './pulseEngineService';
import { db } from '../db';
import { sql } from 'drizzle-orm';

// ── Package / object constants (env vars with mainnet fallbacks) ───────────────
const PULSE_PKG   = (process.env.PULSE_PACKAGE_ID || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238').trim();
const PULSE_STATS = (process.env.PULSE_STATS_ID   || '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff').trim();
const WARP_PKG    = (process.env.WARP_PACKAGE_ID  || '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747').trim();
const WARP_STATS  = (process.env.WARP_STATS_ID    || '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367').trim();
const FLUX_PKG    = (process.env.FLUX_PACKAGE_ID  || '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018').trim();
const FLUX_STATS  = (process.env.FLUX_STATS_ID    || '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320').trim();
const CLOCK       = '0x0000000000000000000000000000000000000000000000000000000000000006';
const SUI_T       = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

const ACTIVITY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Track PULSE pools created this session to avoid duplicates
const usedPulseEventIds = new Set<string>();
// Track last time each engine ran successfully
let lastWarpMs  = 0;
let lastFluxMs  = 0;
let lastPulseMs = 0;
let activityTimer: ReturnType<typeof setInterval> | null = null;

// ── Keypair builder (mirrors routes-warp.ts) ───────────────────────────────────
function buildKP(): Ed25519Keypair {
  const raw = (process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  if (!raw) throw new Error('No private key (ADMIN_PRIVATE_KEY / PRIVATE_KEY)');
  let bytes: Uint8Array;
  if (raw.startsWith('suiprivkey')) {
    bytes = decodeSuiPrivateKey(raw).secretKey;
  } else {
    bytes = raw.startsWith('0x')
      ? new Uint8Array(Buffer.from(raw.slice(2), 'hex'))
      : new Uint8Array(Buffer.from(raw, 'base64'));
    if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
    if (bytes.length === 64) bytes = bytes.slice(0, 32);
  }
  return Ed25519Keypair.fromSecretKey(bytes);
}

// ── Execute a signed transaction, return digest + ok flag ─────────────────────
async function execTx(
  tx: Transaction,
  kp: Ed25519Keypair,
  client: any,
  showObjChanges = false,
): Promise<{ ok: boolean; digest: string; error?: string; objectChanges?: any[] }> {
  const opts: any = { showEffects: true };
  if (showObjChanges) opts.showObjectChanges = true;
  try {
    const res = await client.signAndExecuteTransaction({
      transaction: tx, signer: kp, options: opts,
    });
    const ok = res?.effects?.status?.status === 'success';
    return { ok, digest: res?.digest ?? '', error: res?.effects?.status?.error, objectChanges: res?.objectChanges ?? [] };
  } catch (e: any) {
    return { ok: false, digest: '', error: e.message };
  }
}

// ── RPC helper ────────────────────────────────────────────────────────────────
async function rpcPost(method: string, params: any[]): Promise<any> {
  const rpcUrl = getJsonRpcUrl();
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  const json: any = await resp.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

// ── Auto-discover the OracleCap object ID from wallet ─────────────────────────
async function discoverOracleCap(adminAddr: string, client: any): Promise<string | null> {
  try {
    const expectedType = `${PULSE_PKG}::pulse_engine::OracleCap`;
    const objs = await client.getOwnedObjects({
      owner: adminAddr,
      filter: { StructType: expectedType },
      options: { showType: true },
    });
    return objs?.data?.[0]?.data?.objectId ?? null;
  } catch {
    return null;
  }
}

// ── Get count of P2P bets settled since a given timestamp ─────────────────────
async function countRecentP2PSettled(sinceMs: number): Promise<{ settled: number; voided: number }> {
  try {
    const since = new Date(sinceMs).toISOString();
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('won','lost'))   AS settled,
        COUNT(*) FILTER (WHERE status = 'cancelled')       AS voided
      FROM p2p_bet_matches
      WHERE settled_at >= ${since}::timestamptz
        OR  updated_at >= ${since}::timestamptz
    `);
    const row = ((rows as any).rows ?? rows)?.[0] ?? {};
    return {
      settled: Number(row.settled ?? 0),
      voided:  Number(row.voided ?? 0),
    };
  } catch {
    return { settled: 0, voided: 0 };
  }
}

// ── Pick a real settled event not already used for a PULSE pool this session ──
async function pickSettledEvent(): Promise<{
  eventId: string; homeTeam: string; awayTeam: string; winner: string;
} | null> {
  try {
    // settled_events rows have externalEventId, homeTeam, awayTeam, winner
    const rows = await db.execute(sql`
      SELECT external_event_id, home_team, away_team, winner
      FROM settled_events
      WHERE winner IS NOT NULL
        AND winner != ''
        AND home_team IS NOT NULL
        AND away_team IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 50
    `);
    const list = ((rows as any).rows ?? rows) as any[];
    for (const row of list) {
      const eid = String(row.external_event_id ?? row.externalEventId ?? '');
      if (!eid || usedPulseEventIds.has(eid)) continue;
      return {
        eventId:  eid,
        homeTeam: String(row.home_team ?? row.homeTeam ?? 'Home'),
        awayTeam: String(row.away_team ?? row.awayTeam ?? 'Away'),
        winner:   String(row.winner ?? ''),
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Step 1: WARP batch marker ─────────────────────────────────────────────────
async function runWarpMarker(kp: Ed25519Keypair, oracleCapId: string, client: any): Promise<void> {
  const { settled, voided } = await countRecentP2PSettled(lastWarpMs || Date.now() - ACTIVITY_INTERVAL_MS);
  // Always call with at least 1 to show WARP is active
  const count  = Math.max(settled, 1);
  const vcount = Math.max(voided,  0);

  const tx = new Transaction();
  tx.moveCall({
    target: `${WARP_PKG}::warp_engine::warp_batch_marker`,
    arguments: [
      tx.object(oracleCapId),
      tx.object(WARP_STATS),
      tx.pure.u64(count),
      tx.pure.u64(vcount),
      tx.object(CLOCK),
    ],
  });
  tx.setGasBudget(20_000_000);
  const res = await execTx(tx, kp, client);
  if (res.ok) {
    lastWarpMs = Date.now();
    console.log(`[EngineActivity] ✅ WARP warp_batch_marker (settled=${count}, voided=${vcount}) | ${res.digest}`);
  } else {
    console.warn(`[EngineActivity] ⚠️ WARP batch marker failed: ${res.error}`);
  }
}

// ── Step 2: FLUX batch close ──────────────────────────────────────────────────
async function runFluxBatchClose(kp: Ed25519Keypair, oracleCapId: string, client: any): Promise<void> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${FLUX_PKG}::flux_engine::flux_batch_close`,
    arguments: [
      tx.object(oracleCapId),
      tx.object(FLUX_STATS),
      tx.pure.u64(1),
      tx.pure.u64(0),
      tx.object(CLOCK),
    ],
  });
  tx.setGasBudget(20_000_000);
  const res = await execTx(tx, kp, client);
  if (res.ok) {
    lastFluxMs = Date.now();
    console.log(`[EngineActivity] ✅ FLUX flux_batch_close | ${res.digest}`);
  } else {
    console.warn(`[EngineActivity] ⚠️ FLUX batch close failed: ${res.error}`);
  }
}

// ── Step 3: PULSE full lifecycle ──────────────────────────────────────────────
async function runPulseLifecycle(kp: Ed25519Keypair, oracleCapId: string, client: any): Promise<void> {
  // Pick a real settled event, or fall back to a timestamped test event
  const event = await pickSettledEvent();
  const eventId = event?.eventId ?? `suibets-live-${Date.now()}`;
  const teamA   = event?.homeTeam ?? 'SuiBets';
  const teamB   = event?.awayTeam ?? 'Oracle';
  const winner  = event?.winner ?? '';

  // Mark as used immediately to prevent duplicates
  if (event?.eventId) usedPulseEventIds.add(event.eventId);

  // ── Create pool ────────────────────────────────────────────────────────────
  let poolId = '';
  try {
    const tx = new Transaction();
    const [cA, cB] = tx.splitCoins(tx.gas, [10_000_000n, 10_000_000n]); // 0.01 SUI each side
    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_create_pool`,
      typeArguments: [SUI_T],
      arguments: [
        cA, cB,
        tx.pure.vector('u8', Array.from(Buffer.from(eventId))),
        tx.pure.vector('u8', Array.from(Buffer.from(teamA.slice(0, 32)))),
        tx.pure.vector('u8', Array.from(Buffer.from(teamB.slice(0, 32)))),
        tx.object(PULSE_STATS),
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(20_000_000);
    const res = await execTx(tx, kp, client, true);
    if (!res.ok) {
      console.warn(`[EngineActivity] ⚠️ PULSE create pool failed: ${res.error}`);
      return;
    }
    const created = (res.objectChanges ?? []).find(
      (c: any) => c.type === 'created' && (c.objectType ?? '').includes('PulsePool'),
    );
    poolId = created?.objectId ?? '';
    console.log(`[EngineActivity] ✅ PULSE pool created: ${poolId} | event=${eventId} | ${res.digest}`);
  } catch (e: any) {
    console.warn(`[EngineActivity] ⚠️ PULSE create pool exception: ${e.message}`);
    return;
  }

  if (!poolId) {
    console.warn('[EngineActivity] ⚠️ PULSE pool ID not found in object changes');
    return;
  }

  // Brief pause for the create TX to land
  await new Promise(r => setTimeout(r, 2000));

  // ── Lock pool ──────────────────────────────────────────────────────────────
  try {
    const lockRes = await executePoolAction(buildLockPoolPTB({ poolId }), 'lock');
    if (!lockRes.ok) {
      console.warn(`[EngineActivity] ⚠️ PULSE lock failed: ${lockRes.error}`);
      return;
    }
    console.log(`[EngineActivity] ✅ PULSE pool locked: ${poolId} | ${lockRes.digest}`);
  } catch (e: any) {
    console.warn(`[EngineActivity] ⚠️ PULSE lock exception: ${e.message}`);
    return;
  }

  await new Promise(r => setTimeout(r, 1500));

  // ── Settle or void based on real winner ────────────────────────────────────
  try {
    if (winner && (winner === teamA || winner === teamB)) {
      const side = winner === teamA ? SIDE_A : SIDE_B;
      const settleRes = await executePoolAction(buildSettlePoolPTB({ poolId, winner: side }), 'settle');
      if (settleRes.ok) {
        lastPulseMs = Date.now();
        console.log(`[EngineActivity] ✅ PULSE pool settled (winner=${winner}) | ${settleRes.digest}`);
      } else {
        console.warn(`[EngineActivity] ⚠️ PULSE settle failed: ${settleRes.error} — voiding`);
        await executePoolAction(buildVoidPoolPTB({ poolId }), 'void');
      }
    } else {
      // No clear winner (draw or no event found) — void the pool
      const voidRes = await executePoolAction(buildVoidPoolPTB({ poolId }), 'void');
      if (voidRes.ok) {
        lastPulseMs = Date.now();
        console.log(`[EngineActivity] ✅ PULSE pool voided (draw/unknown) | ${voidRes.digest}`);
      } else {
        console.warn(`[EngineActivity] ⚠️ PULSE void failed: ${voidRes.error}`);
      }
    }
  } catch (e: any) {
    console.warn(`[EngineActivity] ⚠️ PULSE settle/void exception: ${e.message}`);
  }
}

// ── Main activity cycle ───────────────────────────────────────────────────────
async function runActivityCycle(): Promise<void> {
  const rawKey = (process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY || '').trim();
  if (!rawKey) return;

  let kp: Ed25519Keypair;
  try { kp = buildKP(); } catch (e: any) {
    console.warn('[EngineActivity] ⚠️ Failed to build keypair:', e.message);
    return;
  }

  const client = getSuiClient('mainnet') as any;
  const adminAddr = kp.getPublicKey().toSuiAddress();

  // Resolve OracleCap ID
  let oracleCapId = (process.env.P2P_ORACLE_CAP_ID || '').trim();
  if (!oracleCapId) {
    const discovered = await discoverOracleCap(adminAddr, client);
    if (!discovered) {
      console.warn('[EngineActivity] ⚠️ OracleCap not found — skipping cycle');
      return;
    }
    oracleCapId = discovered;
  }

  console.log(`[EngineActivity] 🔄 Running engine activity cycle (wallet: ${adminAddr.slice(0, 10)}...)`);

  // Run WARP and FLUX in sequence (same oracle cap, avoid nonce conflicts)
  await runWarpMarker(kp, oracleCapId, client).catch((e: any) =>
    console.warn('[EngineActivity] WARP error:', e.message)
  );

  await new Promise(r => setTimeout(r, 1000));

  await runFluxBatchClose(kp, oracleCapId, client).catch((e: any) =>
    console.warn('[EngineActivity] FLUX error:', e.message)
  );

  await new Promise(r => setTimeout(r, 1000));

  // PULSE creates a real on-chain pool lifecycle
  await runPulseLifecycle(kp, oracleCapId, client).catch((e: any) =>
    console.warn('[EngineActivity] PULSE error:', e.message)
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startEngineActivity(intervalMs = ACTIVITY_INTERVAL_MS): void {
  const hasKey = !!(process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY);
  if (!hasKey) {
    console.warn('[EngineActivity] ⚠️ No private key — engine activity disabled');
    return;
  }

  console.log(`[EngineActivity] 🚀 WARP+FLUX+PULSE activity service started (interval: ${intervalMs / 60_000}min)`);

  // Run after 30s on startup (give server time to fully boot)
  setTimeout(() => {
    runActivityCycle().catch((e: any) =>
      console.error('[EngineActivity] Startup cycle error:', e.message)
    );
  }, 30_000);

  activityTimer = setInterval(() => {
    runActivityCycle().catch((e: any) =>
      console.error('[EngineActivity] Interval cycle error:', e.message)
    );
  }, intervalMs);
}

export function stopEngineActivity(): void {
  if (activityTimer) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
  console.log('[EngineActivity] Activity service stopped');
}
