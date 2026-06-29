#!/usr/bin/env node
/**
 * SuiBets — database migration runner
 * Applies migrate-all.sql against the DATABASE_URL (local or Railway).
 *
 * Usage:
 *   cd artifacts/api-server && node scripts/migrate.js
 *
 * The script reads DATABASE_URL from the environment (same variable used by
 * the API server).  It is safe to run multiple times — every statement is
 * idempotent (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath   = join(__dirname, 'migrate-all.sql');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set — cannot run migration.');
  process.exit(1);
}

const sql = readFileSync(sqlPath, 'utf8');

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  console.log('✅  Connected to database');

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅  Migration completed successfully');

    // Print a quick summary of table column counts
    const result = await client.query(`
      SELECT table_name, COUNT(*) AS col_count
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (
          'users','sports','events','markets','market_types','outcomes',
          'bets','parlays','bet_legs',
          'settled_events','revenue_claims','p2p_bet_offers','p2p_bet_matches',
          'p2p_parlay_offers','p2p_parlay_legs','p2p_volume_stats',
          'fantasy_teams','event_cursors'
        )
      GROUP BY table_name
      ORDER BY table_name
    `);
    console.log('\nTable column counts after migration:');
    for (const row of result.rows) {
      console.log(`  ${row.table_name.padEnd(28)} ${row.col_count} cols`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
