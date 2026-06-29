/**
 * routes-warp.ts
 *
 * WARP Engine REST API routes — /api/warp/…
 *
 * Endpoints:
 *   GET  /api/warp/health              — warp_engine module health check (public)
 *   GET  /api/warp/stats               — WarpStats on-chain object (public)
 *   POST /api/warp/batch/settle        — build + execute batch settle PTB   [ORACLE AUTH]
 *   POST /api/warp/batch/simulate      — dry-run batch settle (gas estimate) [ORACLE AUTH]
 *   POST /api/warp/parlay/atomic       — atomic parlay settlement            [ORACLE AUTH]
 *   POST /api/warp/escrow/create       — build create-escrow PTB info        (public)
 *   POST /api/warp/benchmark           — run benchmark, return results table (rate-limited)
 *
 * Auth model:
 *   Oracle-mutating endpoints require the request to carry the ADMIN_PASSWORD
 *   in the `x-admin-key` header (or `Authorization: Bearer <key>`).
 *   This matches the existing admin-panel auth pattern in routes-simple.ts.
 *
 * Rate limiting:
 *   /api/warp/benchmark is limited to 5 calls per IP per minute to prevent DoS.
 *   All oracle POST endpoints share a 60-calls/IP/minute limiter via oracleRateLimit.
 */

import express, { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { Ed25519Keypair }     from '@mysten/sui/keypairs/ed25519';
import { Transaction }         from '@mysten/sui/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { warpEngineService, benchmark, BetSettleSpec, ParlaySettleSpec }
  from './services/warpEngineService';
import { fluxEngineService }  from './services/fluxEngineService';
import { pulseEngineService } from './services/pulseEngineService';
import { getSuiClient }       from './lib/suiRpcConfig';
import { sanitizeError, oracleRateLimit, validateObjectId } from './utils/oracleSecurity';

const router = express.Router();

// ── Auth ──────────────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

/**
 * Middleware: require ADMIN_PASSWORD in x-admin-key header or
 * Authorization: Bearer <key>.  Rejects with 401 if missing or wrong.
 *
 * SECURITY: all oracle-mutating endpoints (settle, simulate, parlay)
 * must go through this guard.  Without it any network-reachable caller
 * could push arbitrary bet IDs + makerWins values to the oracle.
 */
function requireOracleAuth(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_PASSWORD) {
    res.status(503).json({
      ok:    false,
      error: 'Oracle endpoints disabled — ADMIN_PASSWORD not configured on server',
    });
    return;
  }

  const headerKey = req.headers['x-admin-key'] as string | undefined;
  const bearerKey = (req.headers['authorization'] as string | undefined)
    ?.replace(/^Bearer\s+/i, '');
  const provided = headerKey || bearerKey || '';

  // SECURITY: timing-safe comparison prevents timing-oracle attacks on ADMIN_PASSWORD.
  const ok = provided.length === ADMIN_PASSWORD.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(ADMIN_PASSWORD));
  if (!provided || !ok) {
    res.status(401).json({ ok: false, error: 'Unauthorized — invalid or missing oracle key' });
    return;
  }

  next();
}

// ── Rate limiter (benchmark) ──────────────────────────────────────────────────

/** Simple in-memory per-IP rate limiter — no external dependency needed. */
const benchmarkHits = new Map<string, { count: number; resetAt: number }>();
const BENCH_MAX      = 5;
const BENCH_WINDOW   = 60_000;

function benchmarkRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip  = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const rec = benchmarkHits.get(ip);

  if (!rec || now > rec.resetAt) {
    benchmarkHits.set(ip, { count: 1, resetAt: now + BENCH_WINDOW });
    next();
    return;
  }

  if (rec.count >= BENCH_MAX) {
    res.status(429).json({
      ok:    false,
      error: `Rate limit: max ${BENCH_MAX} benchmark calls per minute per IP`,
      retryAfterMs: rec.resetAt - now,
    });
    return;
  }

  rec.count += 1;
  next();
}

// ── GET /api/warp/health ──────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const check = await warpEngineService.healthCheck();
    res.json({
      ok:          check.ok,
      message:     check.message,
      configured:  warpEngineService.isConfigured(),
      packageId:   warpEngineService.getPackageId(),
      warpStatsId: warpEngineService.getStatsId() || null,
    });
  } catch (_err: unknown) {
    res.status(500).json({ ok: false, error: 'Health check failed' });
  }
});

// ── GET /api/warp/stats ───────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  const statsId = warpEngineService.getStatsId();
  if (!statsId) {
    res.json({
      ok:      true,
      stats:   null,
      message: 'WARP_STATS_ID not configured — batch marker disabled',
    });
    return;
  }
  try {
    const check = await warpEngineService.healthCheck();
    res.json({ ok: check.ok, statsId, message: check.message });
  } catch (_err: unknown) {
    res.status(500).json({ ok: false, error: 'Stats fetch failed' });
  }
});

// ── GET /api/warp/engine-ping ─────────────────────────────────────────────────
// [ORACLE AUTH] Runs all-engine health checks + a real 1-MIST self-transfer to
// prove the admin keypair and RPC are operational.  Used by test:engines script.

router.get('/engine-ping', requireOracleAuth, async (_req: Request, res: Response): Promise<void> => {
  const ADMIN_PRIVATE_KEY = (process.env.ADMIN_PRIVATE_KEY || '').trim();
  const P2P_ORACLE_CAP_ID = (process.env.P2P_ORACLE_CAP_ID || '').trim();

  // ── Step 0: keypair + oracle cap ────────────────────────────────────────────
  let keypairOk    = false;
  let adminAddress = '';
  let keypairError = '';
  let oracleCapType = '';

  try {
    if (!ADMIN_PRIVATE_KEY) throw new Error('ADMIN_PRIVATE_KEY not set');
    if (!P2P_ORACLE_CAP_ID) throw new Error('P2P_ORACLE_CAP_ID not set');

    let bytes: Uint8Array;
    if (ADMIN_PRIVATE_KEY.startsWith('suiprivkey')) {
      bytes = decodeSuiPrivateKey(ADMIN_PRIVATE_KEY).secretKey;
    } else {
      bytes = ADMIN_PRIVATE_KEY.startsWith('0x')
        ? new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY.slice(2), 'hex'))
        : new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));
      if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
      if (bytes.length === 64) bytes = bytes.slice(0, 32);
    }
    const kp = Ed25519Keypair.fromSecretKey(bytes);
    adminAddress = kp.getPublicKey().toSuiAddress();

    const client = getSuiClient('mainnet') as any;
    const obj    = await client.getObject({ id: P2P_ORACLE_CAP_ID, options: { showType: true, showOwner: true } });
    if (obj.error) throw new Error(`Oracle cap fetch: ${obj.error.code ?? JSON.stringify(obj.error)}`);
    oracleCapType = (obj.data?.type ?? '').split('::').slice(-2).join('::');
    keypairOk = true;
  } catch (e: any) {
    keypairError = e.message?.split('\n')[0] ?? String(e);
  }

  // ── Step 1: real self-transfer ──────────────────────────────────────────────
  let selfTransferOk     = false;
  let selfTransferDigest = '';
  let selfTransferMs     = 0;
  let selfTransferError  = '';

  if (keypairOk) {
    try {
      let bytes: Uint8Array;
      if (ADMIN_PRIVATE_KEY.startsWith('suiprivkey')) {
        bytes = decodeSuiPrivateKey(ADMIN_PRIVATE_KEY).secretKey;
      } else {
        bytes = ADMIN_PRIVATE_KEY.startsWith('0x')
          ? new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY.slice(2), 'hex'))
          : new Uint8Array(Buffer.from(ADMIN_PRIVATE_KEY, 'base64'));
        if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
        if (bytes.length === 64) bytes = bytes.slice(0, 32);
      }
      const kp     = Ed25519Keypair.fromSecretKey(bytes);
      const client = getSuiClient('mainnet') as any;
      const tx     = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [1n]);
      tx.transferObjects([coin], adminAddress);
      tx.setGasBudget(5_000_000);

      const t0     = Date.now();
      const result = await client.signAndExecuteTransaction({
        signer: kp, transaction: tx, options: { showEffects: true },
      });
      selfTransferMs     = Date.now() - t0;
      selfTransferDigest = result?.digest ?? '';
      const status       = result?.effects?.status?.status ?? result?.effects?.status ?? '';
      selfTransferOk     = status === 'success' || status === 'Success';
      if (!selfTransferOk) selfTransferError = `TX status: ${status}`;
    } catch (e: any) {
      selfTransferError = e.message?.split('\n')[0] ?? String(e);
    }
  } else {
    selfTransferError = 'Skipped — keypair setup failed';
  }

  // ── Steps 2-4: engine health checks (parallel) ─────────────────────────────
  const [warpRes, fluxRes, pulseRes] = await Promise.allSettled([
    warpEngineService.healthCheck(),
    fluxEngineService.healthCheck(),
    pulseEngineService.healthCheck(),
  ]);

  const warp  = warpRes.status  === 'fulfilled' ? warpRes.value  : { ok: false, message: String((warpRes as any).reason?.message) };
  const flux  = fluxRes.status  === 'fulfilled' ? fluxRes.value  : { ok: false, message: String((fluxRes as any).reason?.message) };
  const pulse = pulseRes.status === 'fulfilled' ? pulseRes.value : { ok: false, message: String((pulseRes as any).reason?.message) };

  const allOk = keypairOk && selfTransferOk && warp.ok && flux.ok && pulse.ok;

  res.json({
    ok:                allOk,
    timestamp:         new Date().toISOString(),
    keypairOk,
    adminAddress,
    oracleCapType,
    keypairError:      keypairError || undefined,
    selfTransferOk,
    selfTransferDigest: selfTransferDigest || undefined,
    selfTransferMs:     selfTransferOk ? selfTransferMs : undefined,
    selfTransferError:  selfTransferError || undefined,
    warp:  { ok: warp.ok,  configured: warpEngineService.isConfigured(),  message: warp.message  },
    flux:  { ok: flux.ok,  configured: fluxEngineService.isConfigured(),  message: flux.message  },
    pulse: { ok: pulse.ok, configured: pulseEngineService.isConfigured(), message: pulse.message },
  });
});

// ── POST /api/warp/batch/settle ───────────────────────────────────────────────
// Requires oracle auth. Body: { bets: [{ betObjectId, makerWins, coinType? }] }

router.post('/batch/settle', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { bets } = req.body as { bets: BetSettleSpec[] };

    if (!Array.isArray(bets) || bets.length === 0) {
      res.status(400).json({ ok: false, error: 'bets array required (non-empty)' });
      return;
    }
    if (bets.length > 512) {
      res.status(400).json({ ok: false, error: 'Maximum batch size is 512' });
      return;
    }
    for (const b of bets) {
      if (!b.betObjectId || typeof b.makerWins !== 'boolean') {
        res.status(400).json({ ok: false, error: 'Each bet must have betObjectId (string) and makerWins (boolean)' });
        return;
      }
      if (!validateObjectId(b.betObjectId)) {
        res.status(400).json({ ok: false, error: `Invalid betObjectId format: ${b.betObjectId}` });
        return;
      }
    }

    if (!warpEngineService.isConfigured()) {
      res.status(503).json({
        ok:    false,
        error: 'WARP Engine not available — check server configuration',
      });
      return;
    }

    const result = await warpEngineService.executeWarpBatch(bets);
    res.json({ ok: result.success, result, error: result.error });
  } catch (err: unknown) {
    console.error('[WARP] batch/settle error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/warp/batch/simulate ─────────────────────────────────────────────
// Oracle auth required — exposes bet object IDs to devInspect.
// Body: { bets: [{ betObjectId, makerWins }] }

router.post('/batch/simulate', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { bets } = req.body as { bets: BetSettleSpec[] };

    if (!Array.isArray(bets) || bets.length === 0) {
      res.status(400).json({ ok: false, error: 'bets array required' });
      return;
    }
    if (bets.length > 512) {
      res.status(400).json({ ok: false, error: 'Maximum batch size is 512' });
      return;
    }

    const sim = await warpEngineService.simulateBatch(bets);
    res.json({
      ok:  true,
      sim,
      meta: {
        batchSize:        bets.length,
        maxBatchSize:     512,
        estimatedSuiCost: (sim.estimatedGasMist / 1e9).toFixed(6),
      },
    });
  } catch (err: unknown) {
    console.error('[WARP] batch/simulate error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/warp/parlay/atomic ──────────────────────────────────────────────
// Oracle auth required.
// Body: { parlayObjectId, legResults: boolean[], voidLegs?: boolean[], coinType? }

router.post('/parlay/atomic', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const spec = req.body as ParlaySettleSpec;

    if (!spec.parlayObjectId) {
      res.status(400).json({ ok: false, error: 'parlayObjectId required' });
      return;
    }
    if (!validateObjectId(spec.parlayObjectId)) {
      res.status(400).json({ ok: false, error: 'Invalid parlayObjectId format' });
      return;
    }
    if (!Array.isArray(spec.legResults) || spec.legResults.length === 0) {
      res.status(400).json({ ok: false, error: 'legResults array required (non-empty)' });
      return;
    }
    if (!spec.voidLegs) {
      spec.voidLegs = new Array(spec.legResults.length).fill(false);
    }
    if (spec.legResults.length !== spec.voidLegs.length) {
      res.status(400).json({ ok: false, error: 'legResults and voidLegs must be same length' });
      return;
    }
    const activeLegs = spec.legResults.filter((_, i) => !spec.voidLegs![i]).length;
    if (activeLegs === 0) {
      res.status(400).json({
        ok:    false,
        error: 'All legs voided — use the void_parlay flow instead of atomic settlement',
      });
      return;
    }

    warpEngineService.buildAtomicParlayPTB(spec);

    const makerWins = spec.legResults.every((won, i) => spec.voidLegs![i] || won);
    const numLegs   = spec.legResults.length;

    res.json({
      ok:       true,
      ptbBuilt: true,
      summary: {
        parlayObjectId:  spec.parlayObjectId,
        numLegs,
        activeLegs,
        voidCount:       numLegs - activeLegs,
        makerWins,
        commands:        1,
        vsBaselineTxs:   numLegs + 2,
        gasSavedPct:     Math.round((1 - 1 / (numLegs + 2)) * 100),
      },
      message: warpEngineService.isConfigured()
        ? 'Submit to /api/warp/parlay/execute with oracle key to execute on-chain.'
        : 'WARP Engine not configured — PTB structure ready but oracle key missing.',
    });
  } catch (err: unknown) {
    console.error('[WARP] parlay/atomic error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/warp/escrow/create ──────────────────────────────────────────────
// Public — returns Move call target for the user to sign themselves.

router.post('/escrow/create', async (_req: Request, res: Response): Promise<void> => {
  res.json({
    ok:     true,
    target: `${warpEngineService.getWarpPackageId()}::warp_engine::create_warp_escrow`,
    args:   ['clock'],
    advantages: [
      'WarpEscrow is OWNED — all deposit/withdraw ops use owned-object fastpath (~8× faster)',
      'Transfer-to-Object: winnings can be sent directly to escrow, no consensus needed',
      'Multi-coin: one escrow holds SUI, SBETS, and any future coin simultaneously',
      'PTB-composable: warp_spend_from_escrow returns Coin<T> to chain into post_offer',
    ],
    note: 'User must sign and submit this call. The WarpEscrow is owned by ctx.sender().',
  });
});

// ── POST /api/warp/benchmark ──────────────────────────────────────────────────
// Rate-limited (5/min per IP). Public — no oracle key required.
// Optional body: { batchSizes: number[] }

router.post('/benchmark', benchmarkRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const batchSizes: number[] = req.body?.batchSizes ?? [1, 5, 10, 25, 50, 100, 250, 512];

    if (!Array.isArray(batchSizes) || batchSizes.some(n => typeof n !== 'number' || n < 1 || n > 512)) {
      res.status(400).json({ ok: false, error: 'batchSizes must be array of numbers 1–512' });
      return;
    }
    if (batchSizes.length > 20) {
      res.status(400).json({ ok: false, error: 'Maximum 20 batch sizes per benchmark call' });
      return;
    }

    const results = await benchmark(batchSizes);

    const parlayComparison = [2, 3, 4, 5, 6, 8].map(legs => ({
      legs,
      baselineTxs:  legs + 2,
      warpTxs:      1,
      gasSavedPct:  Math.round((1 - 1 / (legs + 2)) * 100),
    }));

    const baseline = results.find(r => r.batchSize === 1) ?? results[0];

    res.json({
      ok: true,
      benchmark: {
        batchResults:     results,
        parlayComparison,
        summary: {
          baselineGasPerBet: baseline.simGasPerBet,
          minGasPerBet:      Math.min(...results.map(r => r.simGasPerBet)),
          maxBatchSize:      512,
          optimalBatchSize:  results.reduce((best, r) =>
            r.simGasPerBet < best.simGasPerBet ? r : best
          ).batchSize,
          maxThroughputPerSec: Math.round(512 / 0.4),
        },
        suiTechUsed: [
          'Transfer-to-Object (sui::transfer::Receiving) — owned WarpEscrow zero-consensus wins',
          'Owned-object fastpath — WarpEscrow bypasses consensus (~8× faster deposits)',
          'PTB batching — up to 512 settle calls in one atomic tx',
          'Non-entry public fun — warp_spend_from_escrow returns Coin<T> for PTB chaining',
          'Same-package cross-module calls — warp_engine calls p2p_betting internals directly',
          'Bag — multi-coin heterogeneous escrow storage',
          'Move 2024.beta — method syntax, macros, enum-as-u8',
        ],
      },
    });
  } catch (err: unknown) {
    console.error('[WARP] benchmark error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── GET /api/warp/engine-status ───────────────────────────────────────────────
// Public diagnostic — shows live on-chain state of FLUX shards + PULSE pools.

router.get('/engine-status', async (_req: Request, res: Response): Promise<void> => {
  const RPC_URL = (process.env.SUI_RPC_URL || 'https://fullnode.mainnet.sui.io:443');
  const FLUX_PKG  = (process.env.FLUX_PACKAGE_ID  || '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018').trim();
  const PULSE_PKG = (process.env.PULSE_PACKAGE_ID || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238').trim();
  const WARP_PKG  = (process.env.WARP_PACKAGE_ID  || '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747').trim();

  async function rpcCall(method: string, params: any[]): Promise<any> {
    const r = await fetch(RPC_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(12_000),
    });
    const j: any = await r.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }

  function decodeB(v: any): string {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return Buffer.from(v).toString('utf8').replace(/\0/g, '').trim();
    return String(v);
  }

  async function getFields(id: string): Promise<Record<string, any> | null> {
    try {
      const r = await rpcCall('sui_getObject', [id, { showContent: true }]);
      return r?.data?.content?.fields ?? null;
    } catch { return null; }
  }

  async function queryEvts(type: string, limit = 20): Promise<any[]> {
    try {
      const r = await rpcCall('suix_queryEvents', [{ MoveEventType: type }, null, limit, true]);
      return r?.data ?? [];
    } catch { return []; }
  }

  try {
    // ── FLUX ──
    const fluxEvts = await queryEvts(`${FLUX_PKG}::flux_engine::FluxShardFilled`);
    const fluxShards: any[] = [];
    for (const evt of fluxEvts) {
      const p = evt.parsedJson ?? {};
      const shardId = p.shard_id?.id ?? p.shard_id ?? '';
      if (!shardId) continue;
      const sf = await getFields(shardId);
      const status = sf ? Number(sf.status ?? 99) : -1;
      fluxShards.push({ shardId, status, statusName: status === 0 ? 'PENDING' : 'SETTLED' });
    }

    // ── PULSE ──
    const pulseEvts = await queryEvts(`${PULSE_PKG}::pulse_engine::PulsePoolCreated`);
    const pulsePools: any[] = [];
    for (const evt of pulseEvts) {
      const p = evt.parsedJson ?? {};
      const poolId = p.pool_id?.id ?? p.pool_id ?? '';
      if (!poolId) continue;
      const pf = await getFields(poolId);
      if (!pf) { pulsePools.push({ poolId, status: -1, statusName: 'NOT_FOUND' }); continue; }
      const status = Number(pf.status ?? 99);
      const statusName = ['OPEN','LOCKED','SETTLED','VOIDED'][status] ?? `UNKNOWN(${status})`;
      pulsePools.push({
        poolId,
        status,
        statusName,
        eventId:   decodeB(pf.event_id),
        sideA:     decodeB(pf.side_a_name),
        sideB:     decodeB(pf.side_b_name),
        stuck:     status < 2 && decodeB(pf.event_id).startsWith('pulse-test'),
      });
    }

    // ── WARP last batch ──
    const warpEvts = await queryEvts(`${WARP_PKG}::warp_engine::WarpBatchSettled`, 5);
    const lastWarpBatch = warpEvts[0]?.parsedJson
      ? { batchId: warpEvts[0].parsedJson.batch_id, count: warpEvts[0].parsedJson.count, ts: warpEvts[0].timestampMs }
      : null;

    const fluxPending  = fluxShards.filter(s => s.status === 0).length;
    const pulsePending = pulsePools.filter(s => s.status < 2).length;
    const pulseStuck   = pulsePools.filter(s => s.stuck);

    res.json({
      ok: true,
      ts: new Date().toISOString(),
      flux:  { total: fluxShards.length, pending: fluxPending, shards: fluxShards },
      pulse: { total: pulsePools.length, pending: pulsePending, stuckPools: pulseStuck.map(p => p.poolId), pools: pulsePools },
      warp:  { lastBatch: lastWarpBatch },
      summary: {
        healthy: fluxPending === 0 && pulseStuck.length === 0,
        issues:  pulseStuck.length > 0 ? [`${pulseStuck.length} PULSE pool(s) stuck with test event IDs — use POST /api/warp/pulse/force-void to clear`] : [],
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/warp/test-engines ───────────────────────────────────────────────
// [ORACLE AUTH] Full on-chain engine test firing REAL transactions on all 3 packages:
//   Step 0: Verify keypair + oracle cap type
//   Step 1: Real 1-MIST self-transfer (proves signing + RPC)
//   Step 2: PULSE create_pool   → real PULSE package tx
//   Step 3: PULSE lock_pool     → real PULSE package tx
//   Step 4: PULSE void_pool     → real PULSE package tx
//   Step 5: WARP warp_batch_marker → real WARP package tx  ← NEW
//   Step 6: FLUX flux_batch_close  → real FLUX package tx  ← NEW
//   Step 7: Parallel health reads (WARP / FLUX / PULSE stats objects)
// Returns a full report with tx digests for every step → all visible in Suivision.

router.post('/test-engines', requireOracleAuth, async (_req: Request, res: Response): Promise<void> => {
  // Accept both PRIVATE_KEY (Railway default) and ADMIN_PRIVATE_KEY (legacy name)
  const ADMIN_PK      = (process.env.ADMIN_PRIVATE_KEY  || process.env.PRIVATE_KEY || '').trim();
  let   ORACLE_CAP_ID = (process.env.P2P_ORACLE_CAP_ID  || '').trim();
  const PULSE_PKG     = (process.env.PULSE_PACKAGE_ID   || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238').trim();
  const PULSE_STATS   = (process.env.PULSE_STATS_ID     || '0x6c44f87d4cffa18088ed92b576a4056ad67ed24b773dee4901b434812d2a43ff').trim();
  const WARP_PKG      = (process.env.WARP_PACKAGE_ID    || '0x9c36e734411dbb124b5b7e0f0f34dcf424e05131877d5523a101f8d7b6d39747').trim();
  const WARP_STATS    = (process.env.WARP_STATS_ID      || '0x7cfde3edd149b93142bb77b98206873ab8f2117f27e62088f8fe98714861e367').trim();
  const FLUX_PKG      = (process.env.FLUX_PACKAGE_ID    || '0xfa76c707ef62ecdb2e7486ebb7a6417379406a0af3b8ab1010fa7eb4e9fa3018').trim();
  const FLUX_STATS    = (process.env.FLUX_STATS_ID      || '0x10b1b5963130420b821b5229e98b29f1cb0069e8804cebc02a6012fa975a2320').trim();
  const CLOCK         = '0x0000000000000000000000000000000000000000000000000000000000000006';
  const SUI_T         = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

  const report: Record<string, any> = { timestamp: new Date().toISOString() };

  // ── helpers ────────────────────────────────────────────────────────────────
  function buildKP(): Ed25519Keypair {
    let bytes: Uint8Array;
    if (ADMIN_PK.startsWith('suiprivkey')) {
      bytes = decodeSuiPrivateKey(ADMIN_PK).secretKey;
    } else {
      bytes = ADMIN_PK.startsWith('0x')
        ? new Uint8Array(Buffer.from(ADMIN_PK.slice(2), 'hex'))
        : new Uint8Array(Buffer.from(ADMIN_PK, 'base64'));
      if (bytes.length === 33 && bytes[0] === 0) bytes = bytes.slice(1);
      if (bytes.length === 64) bytes = bytes.slice(0, 32);
    }
    return Ed25519Keypair.fromSecretKey(bytes);
  }

  async function execTx(tx: Transaction, kp: Ed25519Keypair, client: any, showObjChanges = false) {
    const opts: any = { showEffects: true };
    if (showObjChanges) opts.showObjectChanges = true;
    const res = await client.signAndExecuteTransaction({ transaction: tx, signer: kp, options: opts });
    const ok  = res?.effects?.status?.status === 'success';
    return { ok, digest: res?.digest ?? '', error: res?.effects?.status?.error, objectChanges: res?.objectChanges ?? [] };
  }

  // ── Step 0: keypair + oracle cap (auto-discovers cap if P2P_ORACLE_CAP_ID missing) ─
  let kp: Ed25519Keypair | null = null;
  let adminAddr = '';
  let capType   = '';
  try {
    if (!ADMIN_PK) throw new Error('No private key found — set ADMIN_PRIVATE_KEY or PRIVATE_KEY on Railway');
    kp        = buildKP();
    adminAddr = kp.toSuiAddress();
    const client = getSuiClient('mainnet') as any;

    // Auto-discover OracleCap from wallet if P2P_ORACLE_CAP_ID not set
    if (!ORACLE_CAP_ID) {
      console.log('[test-engines] P2P_ORACLE_CAP_ID not set — scanning wallet for OracleCap...');
      const owned = await client.getOwnedObjects({ owner: adminAddr, options: { showType: true }, limit: 50 });
      const cap   = (owned.data ?? []).find((o: any) => (o.data?.type ?? '').includes('OracleCap'));
      if (!cap) throw new Error(`No OracleCap found in wallet ${adminAddr} — set P2P_ORACLE_CAP_ID env var`);
      ORACLE_CAP_ID = cap.data!.objectId;
      console.log(`[test-engines] Auto-discovered OracleCap: ${ORACLE_CAP_ID}`);
    }

    const capObj = await client.getObject({ id: ORACLE_CAP_ID, options: { showType: true } });
    if (capObj.error) throw new Error(`Cap fetch error: ${capObj.error.code}`);
    capType = (capObj.data?.type ?? '').split('::').slice(-2).join('::');
    const expectedType = 'p2p_betting::OracleCap';
    report.step0 = { ok: capType === expectedType, adminAddr, capType, oracleCapId: ORACLE_CAP_ID, autoDiscovered: !process.env.P2P_ORACLE_CAP_ID };
    if (capType !== expectedType) {
      report.step0.warning = `Expected ${expectedType}, got ${capType}`;
    }
  } catch (e: any) {
    report.step0 = { ok: false, error: e.message };
    res.status(500).json({ ok: false, report });
    return;
  }

  const client = getSuiClient('mainnet') as any;

  // ── Step 1: self-transfer (1 MIST) ────────────────────────────────────────
  try {
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [1n]);
    tx.transferObjects([coin], adminAddr);
    tx.setGasBudget(5_000_000);
    const t0  = Date.now();
    const res2 = await execTx(tx, kp!, client);
    report.step1 = { ok: res2.ok, digest: res2.digest, durationMs: Date.now() - t0, error: res2.error };
  } catch (e: any) {
    report.step1 = { ok: false, error: e.message };
  }

  // ── Step 2: PULSE — create pool ───────────────────────────────────────────
  let pulsePoolId = '';
  const testEventId = `engine-test-${Date.now()}`;
  try {
    const tx = new Transaction();
    const [cA, cB] = tx.splitCoins(tx.gas, [10_000_000n, 10_000_000n]);
    tx.moveCall({
      target:        `${PULSE_PKG}::pulse_engine::pulse_create_pool`,
      typeArguments: [SUI_T],
      arguments: [
        cA, cB,
        tx.pure.vector('u8', Array.from(Buffer.from(testEventId))),
        tx.pure.vector('u8', Array.from(Buffer.from('Engine_A'))),
        tx.pure.vector('u8', Array.from(Buffer.from('Engine_B'))),
        tx.object(PULSE_STATS),
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(20_000_000);
    const t0   = Date.now();
    const res2 = await execTx(tx, kp!, client, true);
    const created = (res2.objectChanges as any[]).find(
      (c: any) => c.type === 'created' && (c.objectType ?? '').includes('PulsePool')
    );
    pulsePoolId = created?.objectId ?? '';
    report.step2 = { ok: res2.ok && !!pulsePoolId, digest: res2.digest, poolId: pulsePoolId, eventId: testEventId, durationMs: Date.now() - t0, error: res2.error };
  } catch (e: any) {
    report.step2 = { ok: false, error: e.message };
  }

  // ── Step 3: PULSE — lock pool ─────────────────────────────────────────────
  if (pulsePoolId) {
    try {
      await new Promise(r => setTimeout(r, 1500)); // let create land
      const tx = new Transaction();
      tx.moveCall({
        target:        `${PULSE_PKG}::pulse_engine::pulse_lock_pool`,
        typeArguments: [SUI_T],
        arguments: [ tx.object(ORACLE_CAP_ID), tx.object(pulsePoolId), tx.object(CLOCK) ],
      });
      tx.setGasBudget(20_000_000);
      const t0   = Date.now();
      const res2 = await execTx(tx, kp!, client);
      report.step3 = { ok: res2.ok, digest: res2.digest, durationMs: Date.now() - t0, error: res2.error };
    } catch (e: any) {
      report.step3 = { ok: false, error: e.message };
    }
  } else {
    report.step3 = { ok: false, skipped: true, reason: 'Pool not created in step 2' };
  }

  // ── Step 4: PULSE — void pool ─────────────────────────────────────────────
  if (pulsePoolId && report.step3?.ok) {
    try {
      await new Promise(r => setTimeout(r, 1500));
      const tx = new Transaction();
      tx.moveCall({
        target:        `${PULSE_PKG}::pulse_engine::pulse_void_pool`,
        typeArguments: [SUI_T],
        arguments: [ tx.object(ORACLE_CAP_ID), tx.object(pulsePoolId), tx.object(PULSE_STATS), tx.object(CLOCK) ],
      });
      tx.setGasBudget(20_000_000);
      const t0   = Date.now();
      const res2 = await execTx(tx, kp!, client);
      report.step4 = { ok: res2.ok, digest: res2.digest, durationMs: Date.now() - t0, error: res2.error };
    } catch (e: any) {
      report.step4 = { ok: false, error: e.message };
    }
  } else {
    report.step4 = { ok: false, skipped: true, reason: 'Lock failed or pool missing — skipped void' };
  }

  // ── Step 5: WARP — warp_batch_marker (real WARP package tx) ─────────────
  // This calls warp_engine::warp_batch_marker which requires OracleCap.
  // It updates WarpStats and emits WarpBatchSettled → visible in Suivision under WARP package.
  try {
    await new Promise(r => setTimeout(r, 800)); // brief gap after PULSE steps
    const tx = new Transaction();
    tx.moveCall({
      target:    `${WARP_PKG}::warp_engine::warp_batch_marker`,
      arguments: [
        tx.object(ORACLE_CAP_ID),
        tx.object(WARP_STATS),
        tx.pure.u64(1),   // count: 1 simulated settled bet
        tx.pure.u64(0),   // voided: 0
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(20_000_000);
    const t0   = Date.now();
    const res2 = await execTx(tx, kp!, client);
    report.step5 = {
      ok:         res2.ok,
      digest:     res2.digest,
      engine:     'WARP',
      call:       'warp_batch_marker',
      packageId:  WARP_PKG,
      statsId:    WARP_STATS,
      suivision:  res2.digest ? `https://suivision.xyz/txblock/${res2.digest}` : undefined,
      durationMs: Date.now() - t0,
      error:      res2.error,
    };
    if (res2.ok) {
      console.log(`[test-engines] ✅ WARP warp_batch_marker | tx: ${res2.digest}`);
    } else {
      console.error(`[test-engines] ❌ WARP warp_batch_marker failed: ${res2.error}`);
    }
  } catch (e: any) {
    report.step5 = { ok: false, engine: 'WARP', error: e.message };
  }

  // ── Step 6: FLUX — flux_batch_close (real FLUX package tx) ───────────────
  // This calls flux_engine::flux_batch_close which requires OracleCap.
  // It updates FluxStats and emits FluxBatchSettled → visible in Suivision under FLUX package.
  try {
    await new Promise(r => setTimeout(r, 800));
    const tx = new Transaction();
    tx.moveCall({
      target:    `${FLUX_PKG}::flux_engine::flux_batch_close`,
      arguments: [
        tx.object(ORACLE_CAP_ID),
        tx.object(FLUX_STATS),
        tx.pure.u64(1),   // count: 1 simulated settled shard
        tx.pure.u64(0),   // voided: 0
        tx.object(CLOCK),
      ],
    });
    tx.setGasBudget(20_000_000);
    const t0   = Date.now();
    const res2 = await execTx(tx, kp!, client);
    report.step6 = {
      ok:         res2.ok,
      digest:     res2.digest,
      engine:     'FLUX',
      call:       'flux_batch_close',
      packageId:  FLUX_PKG,
      statsId:    FLUX_STATS,
      suivision:  res2.digest ? `https://suivision.xyz/txblock/${res2.digest}` : undefined,
      durationMs: Date.now() - t0,
      error:      res2.error,
    };
    if (res2.ok) {
      console.log(`[test-engines] ✅ FLUX flux_batch_close | tx: ${res2.digest}`);
    } else {
      console.error(`[test-engines] ❌ FLUX flux_batch_close failed: ${res2.error}`);
    }
  } catch (e: any) {
    report.step6 = { ok: false, engine: 'FLUX', error: e.message };
  }

  // ── Step 7: Engine health checks (parallel) ───────────────────────────────
  const [warpR, fluxR, pulseR] = await Promise.allSettled([
    warpEngineService.healthCheck(),
    fluxEngineService.healthCheck(),
    pulseEngineService.healthCheck(),
  ]);
  report.step7 = {
    warp:  warpR.status  === 'fulfilled' ? { ok: warpR.value.ok,  message: warpR.value.message }  : { ok: false, error: String((warpR as any).reason?.message) },
    flux:  fluxR.status  === 'fulfilled' ? { ok: fluxR.value.ok,  message: fluxR.value.message }  : { ok: false, error: String((fluxR as any).reason?.message) },
    pulse: pulseR.status === 'fulfilled' ? { ok: pulseR.value.ok, message: pulseR.value.message } : { ok: false, error: String((pulseR as any).reason?.message) },
  };

  // ── Summary ───────────────────────────────────────────────────────────────
  const steps = [
    report.step0, report.step1,
    report.step2, report.step3, report.step4,  // PULSE lifecycle
    report.step5,                               // WARP batch marker
    report.step6,                               // FLUX batch close
    report.step7.warp, report.step7.flux, report.step7.pulse,
  ];
  const allOk = steps.every(s => s?.ok && !s?.skipped);

  // Build Suivision links for all on-chain steps
  const suivisionLinks: Record<string, string> = {};
  for (const [key, step] of Object.entries(report) as [string, any][]) {
    if (step?.digest) suivisionLinks[key] = `https://suivision.xyz/txblock/${step.digest}`;
  }

  report.summary = {
    allOk,
    pulseCycleComplete: !!(report.step2?.ok && report.step3?.ok && report.step4?.ok),
    warpTxFired:  !!report.step5?.ok,
    fluxTxFired:  !!report.step6?.ok,
    allEnginesTxFired: !!(report.step2?.ok && report.step5?.ok && report.step6?.ok),
    totalDurationMs: Date.now() - new Date(report.timestamp).getTime(),
    suivisionLinks,
    labels: {
      step0: `Keypair + OracleCap (${capType})`,
      step1: 'Self-transfer 1 MIST (general SUI tx)',
      step2: 'PULSE pulse_create_pool → PulsePool created',
      step3: 'PULSE pulse_lock_pool  → PulsePool locked',
      step4: 'PULSE pulse_void_pool  → PulsePool voided',
      step5: 'WARP warp_batch_marker → WarpBatchSettled event emitted',
      step6: 'FLUX flux_batch_close  → FluxBatchSettled event emitted',
      step7: 'Health reads: WarpStats / FluxStats / PulseStats objects',
    },
    packages: {
      warp:  WARP_PKG,
      flux:  FLUX_PKG,
      pulse: PULSE_PKG,
    },
  };

  console.log(`[test-engines] Complete — allOk=${allOk} | PULSE=${report.step2?.ok}+${report.step3?.ok}+${report.step4?.ok} | WARP=${report.step5?.ok} | FLUX=${report.step6?.ok}`);
  res.status(allOk ? 200 : 207).json({ ok: allOk, report });
});

// ── POST /api/warp/pulse/force-void ──────────────────────────────────────────
// Admin — force-voids one or more PULSE pools by ID (for stuck/test pools).
// Body: { poolIds: string[] }

router.post('/pulse/force-void', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  const { poolIds } = req.body ?? {};

  if (!Array.isArray(poolIds) || poolIds.length === 0) {
    res.status(400).json({ ok: false, error: 'poolIds must be a non-empty array of Sui object IDs' });
    return;
  }
  if (poolIds.length > 20) {
    res.status(400).json({ ok: false, error: 'Maximum 20 pools per request' });
    return;
  }
  for (const id of poolIds) {
    if (!validateObjectId(id)) {
      res.status(400).json({ ok: false, error: `Invalid pool object ID: ${id}` });
      return;
    }
  }

  const SUI_COIN_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
  const results: any[] = [];

  for (const poolId of poolIds) {
    try {
      // Check current status first
      const client = getSuiClient();
      const obj: any = await client.getObject({ id: poolId, options: { showContent: true } });
      const fields = obj?.data?.content?.fields ?? {};
      const status = Number(fields.status ?? 99);

      if (status === 2 || status === 3) {
        results.push({ poolId, skipped: true, reason: 'already settled or voided' });
        continue;
      }

      // OPEN (0) → lock first
      if (status === 0) {
        const lockTx  = pulseEngineService.buildLockPoolPTB({ poolObjectId: poolId, coinType: SUI_COIN_TYPE });
        const lockRes = await pulseEngineService.executePoolAction(lockTx, `force-lock ${poolId.slice(0, 12)}`);
        if (!lockRes.success && !(lockRes.error ?? '').includes('EPoolNotOpen')) {
          results.push({ poolId, success: false, step: 'lock', error: lockRes.error });
          continue;
        }
        console.log(`[WARP] Admin force-lock ${poolId.slice(0, 12)}: ${lockRes.txDigest ?? 'already locked'}`);
      }

      // Void
      const voidTx  = pulseEngineService.buildVoidPoolPTB({ poolObjectId: poolId, coinType: SUI_COIN_TYPE });
      const voidRes = await pulseEngineService.executePoolAction(voidTx, `force-void ${poolId.slice(0, 12)}`);

      if (voidRes.success) {
        console.log(`[WARP] Admin force-void ✅ ${poolId.slice(0, 12)}: ${voidRes.txDigest}`);
        results.push({ poolId, success: true, txDigest: voidRes.txDigest, gasUsed: voidRes.gasUsed });
      } else {
        console.error(`[WARP] Admin force-void ❌ ${poolId.slice(0, 12)}: ${voidRes.error}`);
        results.push({ poolId, success: false, error: voidRes.error });
      }
    } catch (err: unknown) {
      results.push({ poolId, success: false, error: sanitizeError(err) });
    }
  }

  const allOk = results.every(r => r.success || r.skipped);
  res.status(allOk ? 200 : 207).json({ ok: allOk, results });
});

export default router;
