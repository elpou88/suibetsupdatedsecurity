/**
 * oracleSecurity.ts
 *
 * Shared security helpers for oracle engine route files (WARP, FLUX, PULSE, P2P).
 *
 * Exports:
 *  - validateObjectId(id)   — Sui object IDs are always exactly 64 hex chars
 *  - validateCoinType(ct)   — Move coin type format check; rejects injection strings
 *  - sanitizeError(err)     — strips secret names / file paths before HTTP response
 *  - oracleRateLimit        — per-IP rate limiter for oracle POST endpoints
 */

import { Request, Response, NextFunction } from 'express';

// ── Object ID ─────────────────────────────────────────────────────────────────
// Valid Sui object IDs are ALWAYS exactly 64 hex characters after the 0x prefix.
// Accepting 1-63 chars ({1,64}) allows probing error paths with malformed input.
const OBJ_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export function validateObjectId(id: string): boolean {
  return OBJ_ID_RE.test(id);
}

// ── Coin type ─────────────────────────────────────────────────────────────────
// Sui Move coin types follow the pattern: 0x{address}::{module}::{TypeName}
// Address may be shortened (< 64 hex chars) or normalized (64 chars).
// We validate format only; contract-layer allowlisting is enforced on-chain.
// Undefined/null → caller uses a safe internal default.
const COIN_TYPE_RE = /^0x[0-9a-fA-F]{1,64}::[a-zA-Z_]\w*::[a-zA-Z_]\w*$/;

export function validateCoinType(ct: string | undefined | null): boolean {
  if (!ct) return true;
  return COIN_TYPE_RE.test(ct);
}

// ── Error sanitizer ───────────────────────────────────────────────────────────
// Strips environment variable names (ADMIN_PRIVATE_KEY), filesystem paths, and
// SDK stack-trace fragments from error messages before they reach HTTP responses.
const SENSITIVE_RE = /ADMIN_PRIVATE_KEY|private.?key|privateKey|node_modules|\/home\/|\/usr\/local|at\s+\S+\s+\(/i;
const WIN_PATH_RE  = /[A-Za-z]:[\\\/]/;

export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (SENSITIVE_RE.test(msg) || WIN_PATH_RE.test(msg)) {
    return 'Settlement failed — check server logs';
  }
  return msg;
}

// ── Oracle rate limiter ───────────────────────────────────────────────────────
// Applied to all oracle-mutating POST endpoints across WARP, FLUX, and PULSE.
// 60 calls/IP/minute is generous for legitimate batch oracle operations while
// blocking automated floods that the auth middleware alone cannot prevent.
const _oracleHits = new Map<string, { count: number; resetAt: number }>();
const ORACLE_MAX    = 60;
const ORACLE_WINDOW = 60_000;

export function oracleRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip  = ((req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress || 'unknown')
                .split(',')[0].trim();
  const now = Date.now();
  const rec = _oracleHits.get(ip);

  if (!rec || now > rec.resetAt) {
    _oracleHits.set(ip, { count: 1, resetAt: now + ORACLE_WINDOW });
    next();
    return;
  }

  if (rec.count >= ORACLE_MAX) {
    res.status(429).json({
      ok:           false,
      error:        `Rate limit exceeded — max ${ORACLE_MAX} oracle calls per minute per IP`,
      retryAfterMs: rec.resetAt - now,
    });
    return;
  }

  rec.count += 1;
  next();
}
