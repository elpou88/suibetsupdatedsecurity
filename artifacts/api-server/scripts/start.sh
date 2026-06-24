#!/bin/sh
set -e

echo "[start] ============================================"
echo "[start] SuiBets — Railway startup"
echo "[start] ============================================"

echo "[start] Running FULL schema migration (migrate-all.sql)..."
echo "[start] This is idempotent — safe to re-run on every deploy."

psql "$DATABASE_URL" -f /app/artifacts/api-server/scripts/migrate-all.sql \
  && echo "[start] Full schema migration complete." \
  || echo "[start] migrate-all.sql warning (non-fatal) — continuing."

echo "[start] Running P2P table migration patch..."
psql "$DATABASE_URL" -f /app/artifacts/api-server/scripts/migrate-p2p-tables.sql \
  && echo "[start] P2P migration patch complete." \
  || echo "[start] P2P migration warning (non-fatal) — continuing."

echo "[start] Running Railway missing-columns patch..."
psql "$DATABASE_URL" -f /app/artifacts/api-server/scripts/railway-migrate-missing-columns.sql \
  && echo "[start] Missing columns patch complete." \
  || echo "[start] Missing columns patch warning (non-fatal) — continuing."

echo "[start] Running Fantasy/World Cup table migration..."
psql "$DATABASE_URL" -f /app/artifacts/api-server/scripts/railway-migrate-fantasy-wc.sql \
  && echo "[start] Fantasy/WC migration complete." \
  || echo "[start] Fantasy/WC migration warning (non-fatal) — continuing."

echo "[start] Running new tables migration (hot_potato, walrus_archives, extra columns)..."
psql "$DATABASE_URL" -f /app/artifacts/api-server/scripts/railway-migrate-new-tables.sql \
  && echo "[start] New tables migration complete." \
  || echo "[start] New tables migration warning (non-fatal) — continuing."

echo "[start] ============================================"
echo "[start] Starting API server on port ${PORT:-8080}..."
echo "[start] ============================================"
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
