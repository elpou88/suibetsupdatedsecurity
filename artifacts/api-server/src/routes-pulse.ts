/**
 * routes-pulse.ts
 *
 * PULSE Engine REST API routes — /api/pulse/…
 *
 * Endpoints:
 *   GET  /api/pulse/health             — PulseStats on-chain health check (public)
 *   GET  /api/pulse/stats              — PulseStats object fields (public)
 *   POST /api/pulse/pool/lock          — lock one pool (match starting)    [ORACLE AUTH]
 *   POST /api/pulse/pool/settle        — settle one pool (announce winner) [ORACLE AUTH]
 *   POST /api/pulse/pool/void          — void one pool (event cancelled)   [ORACLE AUTH]
 *   POST /api/pulse/batch/settle       — batch settle N pools atomically   [ORACLE AUTH]
 *   POST /api/pulse/batch/void         — batch void N pools atomically     [ORACLE AUTH]
 *   POST /api/pulse/batch/simulate     — dry-run gas estimate              [ORACLE AUTH]
 *
 * Auth: same x-admin-key / Authorization: Bearer pattern as routes-warp.ts.
 * Rate limiting: oracle POST endpoints share 60-calls/IP/minute via oracleRateLimit.
 */

import express, { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import {
  pulseEngineService,
  PoolLockSpec,
  PoolSettleSpec,
  PoolVoidSpec,
  buildLockPoolPTB,
  buildSettlePoolPTB,
  buildVoidPoolPTB,
  buildBatchVoidPoolsPTB,
  executePoolAction,
} from './services/pulseEngineService';
import { sanitizeError, oracleRateLimit, validateObjectId } from './utils/oracleSecurity';
import { suiJsonRpc } from './lib/suiRpcConfig';

const router = express.Router();

// ── Auth ──────────────────────────────────────────────────────────────────────

const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

function requireOracleAuth(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_PASSWORD) {
    res.status(503).json({ ok: false, error: 'Oracle endpoints disabled — ADMIN_PASSWORD not configured on server' });
    return;
  }

  const headerKey = req.headers['x-admin-key'] as string | undefined;
  const bearerKey = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');
  const provided  = headerKey || bearerKey || '';

  const ok = provided.length === ADMIN_PASSWORD.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(ADMIN_PASSWORD));

  if (!provided || !ok) {
    res.status(401).json({ ok: false, error: 'Unauthorized — invalid or missing oracle key' });
    return;
  }

  next();
}

// ── GET /api/pulse/health ─────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const check = await pulseEngineService.healthCheck();
    res.json({
      ok:           check.ok,
      message:      check.message,
      configured:   pulseEngineService.isConfigured(),
      packageId:    pulseEngineService.getPackageId(),
      pulseStatsId: pulseEngineService.getStatsId() || null,
    });
  } catch (_err: unknown) {
    res.status(500).json({ ok: false, error: 'Health check failed' });
  }
});

// ── GET /api/pulse/stats ──────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  const statsId = pulseEngineService.getStatsId();
  if (!statsId) {
    res.json({ ok: true, stats: null, message: 'PULSE_STATS_ID not configured' });
    return;
  }
  try {
    const check = await pulseEngineService.healthCheck();
    res.json({ ok: check.ok, statsId, message: check.message });
  } catch (_err: unknown) {
    res.status(500).json({ ok: false, error: 'Stats fetch failed' });
  }
});

// ── POST /api/pulse/pool/lock ─────────────────────────────────────────────────
// Body: { poolObjectId, coinType? }

router.post('/pool/lock', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const spec = req.body as PoolLockSpec;

    if (!spec.poolObjectId) {
      res.status(400).json({ ok: false, error: 'poolObjectId required' });
      return;
    }
    if (!validateObjectId(spec.poolObjectId)) {
      res.status(400).json({ ok: false, error: `Invalid poolObjectId format: ${spec.poolObjectId}` });
      return;
    }
    if (!pulseEngineService.isConfigured()) {
      res.status(503).json({ ok: false, error: 'PULSE Engine not available — check server configuration' });
      return;
    }

    const tx     = buildLockPoolPTB(spec);
    const result = await executePoolAction(tx, `lock pool ${spec.poolObjectId}`);
    res.json({ ok: result.success, result, error: result.error });
  } catch (err: unknown) {
    console.error('[PULSE] pool/lock error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/pulse/pool/settle ───────────────────────────────────────────────
// Body: { poolObjectId, winner: 0|1, coinType? }
// winner: 0 = side A wins, 1 = side B wins

router.post('/pool/settle', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const spec = req.body as PoolSettleSpec;

    if (!spec.poolObjectId) {
      res.status(400).json({ ok: false, error: 'poolObjectId required' });
      return;
    }
    if (!validateObjectId(spec.poolObjectId)) {
      res.status(400).json({ ok: false, error: `Invalid poolObjectId format: ${spec.poolObjectId}` });
      return;
    }
    if (spec.winner !== 0 && spec.winner !== 1) {
      res.status(400).json({ ok: false, error: 'winner must be 0 (side A) or 1 (side B)' });
      return;
    }
    if (!pulseEngineService.isConfigured()) {
      res.status(503).json({ ok: false, error: 'PULSE Engine not available — check server configuration' });
      return;
    }

    const tx     = buildSettlePoolPTB(spec);
    const result = await executePoolAction(tx, `settle pool ${spec.poolObjectId} winner=${spec.winner}`);
    res.json({ ok: result.success, result, error: result.error });
  } catch (err: unknown) {
    console.error('[PULSE] pool/settle error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/pulse/pool/void ─────────────────────────────────────────────────
// Body: { poolObjectId, coinType? }

router.post('/pool/void', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const spec = req.body as PoolVoidSpec;

    if (!spec.poolObjectId) {
      res.status(400).json({ ok: false, error: 'poolObjectId required' });
      return;
    }
    if (!validateObjectId(spec.poolObjectId)) {
      res.status(400).json({ ok: false, error: `Invalid poolObjectId format: ${spec.poolObjectId}` });
      return;
    }
    if (!pulseEngineService.isConfigured()) {
      res.status(503).json({ ok: false, error: 'PULSE Engine not available — check server configuration' });
      return;
    }

    const tx     = buildVoidPoolPTB(spec);
    const result = await executePoolAction(tx, `void pool ${spec.poolObjectId}`);
    res.json({ ok: result.success, result, error: result.error });
  } catch (err: unknown) {
    console.error('[PULSE] pool/void error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/pulse/batch/settle ──────────────────────────────────────────────
// Body: { pools: [{ poolObjectId, winner: 0|1, coinType? }] }

router.post('/batch/settle', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { pools } = req.body as { pools: PoolSettleSpec[] };

    if (!Array.isArray(pools) || pools.length === 0) {
      res.status(400).json({ ok: false, error: 'pools array required (non-empty)' });
      return;
    }
    if (pools.length > 512) {
      res.status(400).json({ ok: false, error: 'Maximum batch size is 512' });
      return;
    }
    for (const p of pools) {
      if (!p.poolObjectId) {
        res.status(400).json({ ok: false, error: 'Each pool must have poolObjectId (string)' });
        return;
      }
      if (!validateObjectId(p.poolObjectId)) {
        res.status(400).json({ ok: false, error: `Invalid poolObjectId format: ${p.poolObjectId}` });
        return;
      }
      if (p.winner !== 0 && p.winner !== 1) {
        res.status(400).json({ ok: false, error: `winner must be 0 or 1 for pool ${p.poolObjectId}` });
        return;
      }
    }

    if (!pulseEngineService.isConfigured()) {
      res.status(503).json({ ok: false, error: 'PULSE Engine not available — check server configuration' });
      return;
    }

    const result = await pulseEngineService.executePulseBatch(pools);
    res.json({ ok: result.success, result, error: result.error });
  } catch (err: unknown) {
    console.error('[PULSE] batch/settle error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/pulse/batch/void ────────────────────────────────────────────────
// Body: { pools: [{ poolObjectId, coinType? }] }

router.post('/batch/void', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { pools } = req.body as { pools: PoolVoidSpec[] };

    if (!Array.isArray(pools) || pools.length === 0) {
      res.status(400).json({ ok: false, error: 'pools array required (non-empty)' });
      return;
    }
    if (pools.length > 512) {
      res.status(400).json({ ok: false, error: 'Maximum batch size is 512' });
      return;
    }
    for (const p of pools) {
      if (!p.poolObjectId || !validateObjectId(p.poolObjectId)) {
        res.status(400).json({ ok: false, error: `Invalid poolObjectId: ${p.poolObjectId}` });
        return;
      }
    }

    if (!pulseEngineService.isConfigured()) {
      res.status(503).json({ ok: false, error: 'PULSE Engine not available — check server configuration' });
      return;
    }

    const result = await pulseEngineService.executePulseBatch(pools as any, true);
    res.json({ ok: result.success, result, error: result.error });
  } catch (err: unknown) {
    console.error('[PULSE] batch/void error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/pulse/batch/simulate ────────────────────────────────────────────
// Body: { pools: [{ poolObjectId, winner: 0|1 }] }

router.post('/batch/simulate', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { pools } = req.body as { pools: PoolSettleSpec[] };

    if (!Array.isArray(pools) || pools.length === 0) {
      res.status(400).json({ ok: false, error: 'pools array required' });
      return;
    }
    if (pools.length > 512) {
      res.status(400).json({ ok: false, error: 'Maximum batch size is 512' });
      return;
    }

    const sim = await pulseEngineService.simulatePulseBatch(pools);
    res.json({
      ok:  true,
      sim,
      meta: {
        batchSize:        pools.length,
        maxBatchSize:     512,
        estimatedSuiCost: (sim.estimatedGasMist / 1e9).toFixed(6),
      },
    });
  } catch (err: unknown) {
    console.error('[PULSE] batch/simulate error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── GET /api/pulse/pools ──────────────────────────────────────────────────────
// Discovers all PULSE pools via PulsePoolCreated events and returns live on-chain state.

router.get('/pools', async (_req: Request, res: Response): Promise<void> => {
  try {
    const PULSE_PKG = (process.env.PULSE_PACKAGE_ID || '0x6ac71a607632fdc4dda3bb51b0e3a36fd8a7c4a4ac1ccb6cf9c722c8f34ee238').trim();

    const decodeBytes = (v: unknown): string => {
      if (!v) return '';
      const arr = Array.isArray(v) ? (v as number[]) : [];
      try { return Buffer.from(arr).toString('utf8'); } catch { return ''; }
    };

    const evtsResult = await suiJsonRpc('suix_queryEvents', [
      { MoveEventType: `${PULSE_PKG}::pulse_engine::PulsePoolCreated` },
      null, 50, false,
    ]);

    const pools: any[] = [];
    for (const evt of (evtsResult?.data ?? [])) {
      const p   = evt.parsedJson ?? {};
      const poolId = (p.pool_id?.id ?? p.pool_id ?? '') as string;
      if (!poolId) continue;

      let poolData: any = { poolId, status: -1, statusName: 'NOT_FOUND',
        eventId: '', sideA: '', sideB: '', sideAStaked: 0, sideBStaked: 0, positionCount: 0,
        createdAt: evt.timestampMs ?? null };

      try {
        const obj = await suiJsonRpc('sui_getObject', [poolId, { showContent: true }]);
        const fields = obj?.data?.content?.fields ?? null;
        if (fields) {
          const status     = Number(fields.status ?? 99);
          const statusName = (['OPEN', 'LOCKED', 'SETTLED', 'VOIDED'] as const)[status] ?? `UNKNOWN(${status})`;
          poolData = {
            ...poolData,
            status,
            statusName,
            eventId:       decodeBytes(fields.event_id),
            sideA:         decodeBytes(fields.side_a_name),
            sideB:         decodeBytes(fields.side_b_name),
            sideAStaked:   Number(fields.side_a_pool ?? 0) / 1e9,
            sideBStaked:   Number(fields.side_b_pool ?? 0) / 1e9,
            positionCount: Number(fields.position_count ?? 0),
          };
        }
      } catch { /* pool not found / RPC error — leave defaults */ }

      pools.push(poolData);
    }

    pools.sort((a, b) => (a.status ?? 99) - (b.status ?? 99));

    res.json({ ok: true, pools, total: pools.length });
  } catch (err: unknown) {
    console.error('[PULSE] pools list error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

export default router;
