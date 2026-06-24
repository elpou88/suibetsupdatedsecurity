/**
 * routes-flux.ts
 *
 * FLUX Engine REST API routes — /api/flux/…
 *
 * Endpoints:
 *   GET  /api/flux/health              — FluxStats on-chain health check (public)
 *   GET  /api/flux/stats               — FluxStats object fields (public)
 *   POST /api/flux/batch/settle        — batch settle N shards atomically  [ORACLE AUTH]
 *   POST /api/flux/batch/void          — batch void N shards atomically    [ORACLE AUTH]
 *   POST /api/flux/batch/simulate      — dry-run gas estimate              [ORACLE AUTH]
 *
 * Auth: same x-admin-key / Authorization: Bearer pattern as routes-warp.ts.
 * Rate limiting: oracle POST endpoints share 60-calls/IP/minute via oracleRateLimit.
 */

import express, { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import {
  fluxEngineService,
  ShardSettleSpec,
  ShardVoidSpec,
} from './services/fluxEngineService';
import { sanitizeError, oracleRateLimit, validateObjectId } from './utils/oracleSecurity';

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

// ── GET /api/flux/health ──────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const check = await fluxEngineService.healthCheck();
    res.json({
      ok:          check.ok,
      message:     check.message,
      configured:  fluxEngineService.isConfigured(),
      packageId:   fluxEngineService.getPackageId(),
      fluxStatsId: fluxEngineService.getStatsId() || null,
    });
  } catch (_err: unknown) {
    res.status(500).json({ ok: false, error: 'Health check failed' });
  }
});

// ── GET /api/flux/stats ───────────────────────────────────────────────────────

router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  const statsId = fluxEngineService.getStatsId();
  if (!statsId) {
    res.json({ ok: true, stats: null, message: 'FLUX_STATS_ID not configured' });
    return;
  }
  try {
    const check = await fluxEngineService.healthCheck();
    res.json({ ok: check.ok, statsId, message: check.message });
  } catch (_err: unknown) {
    res.status(500).json({ ok: false, error: 'Stats fetch failed' });
  }
});

// ── POST /api/flux/batch/settle ───────────────────────────────────────────────
// Body: { shards: [{ shardObjectId, takerWon, coinType? }] }

router.post('/batch/settle', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { shards } = req.body as { shards: ShardSettleSpec[] };

    if (!Array.isArray(shards) || shards.length === 0) {
      res.status(400).json({ ok: false, error: 'shards array required (non-empty)' });
      return;
    }
    if (shards.length > 512) {
      res.status(400).json({ ok: false, error: 'Maximum batch size is 512' });
      return;
    }
    for (const s of shards) {
      if (!s.shardObjectId || typeof s.takerWon !== 'boolean') {
        res.status(400).json({ ok: false, error: 'Each shard must have shardObjectId (string) and takerWon (boolean)' });
        return;
      }
      if (!validateObjectId(s.shardObjectId)) {
        res.status(400).json({ ok: false, error: `Invalid shardObjectId format: ${s.shardObjectId}` });
        return;
      }
    }

    if (!fluxEngineService.isConfigured()) {
      res.status(503).json({ ok: false, error: 'FLUX Engine not available — check server configuration' });
      return;
    }

    const result = await fluxEngineService.executeFluxBatch(shards);
    res.json({ ok: result.success, result, error: result.error });
  } catch (err: unknown) {
    console.error('[FLUX] batch/settle error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/flux/batch/void ─────────────────────────────────────────────────
// Body: { shards: [{ shardObjectId, coinType? }] }

router.post('/batch/void', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { shards } = req.body as { shards: ShardVoidSpec[] };

    if (!Array.isArray(shards) || shards.length === 0) {
      res.status(400).json({ ok: false, error: 'shards array required (non-empty)' });
      return;
    }
    if (shards.length > 512) {
      res.status(400).json({ ok: false, error: 'Maximum batch size is 512' });
      return;
    }
    for (const s of shards) {
      if (!s.shardObjectId) {
        res.status(400).json({ ok: false, error: 'Each shard must have shardObjectId (string)' });
        return;
      }
      if (!validateObjectId(s.shardObjectId)) {
        res.status(400).json({ ok: false, error: `Invalid shardObjectId format: ${s.shardObjectId}` });
        return;
      }
    }

    if (!fluxEngineService.isConfigured()) {
      res.status(503).json({ ok: false, error: 'FLUX Engine not available — check server configuration' });
      return;
    }

    const result = await fluxEngineService.executeFluxBatch(shards as any, true);
    res.json({ ok: result.success, result, error: result.error });
  } catch (err: unknown) {
    console.error('[FLUX] batch/void error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

// ── POST /api/flux/batch/simulate ─────────────────────────────────────────────
// Body: { shards: [{ shardObjectId, takerWon }] }

router.post('/batch/simulate', requireOracleAuth, oracleRateLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const { shards } = req.body as { shards: ShardSettleSpec[] };

    if (!Array.isArray(shards) || shards.length === 0) {
      res.status(400).json({ ok: false, error: 'shards array required' });
      return;
    }
    if (shards.length > 512) {
      res.status(400).json({ ok: false, error: 'Maximum batch size is 512' });
      return;
    }

    const sim = await fluxEngineService.simulateFluxBatch(shards);
    res.json({
      ok:  true,
      sim,
      meta: {
        batchSize:        shards.length,
        maxBatchSize:     512,
        estimatedSuiCost: (sim.estimatedGasMist / 1e9).toFixed(6),
      },
    });
  } catch (err: unknown) {
    console.error('[FLUX] batch/simulate error:', err);
    res.status(500).json({ ok: false, error: sanitizeError(err) });
  }
});

export default router;
