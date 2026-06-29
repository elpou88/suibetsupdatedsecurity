/**
 * migrate-p2p-onchain.mjs
 * Adds onchain_offer_id / onchain_parlay_id columns.
 * Run: node artifacts/api-server/scripts/migrate-p2p-onchain.mjs
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  console.log('Running P2P on-chain migration…');

  await client.query(`
    ALTER TABLE p2p_bet_offers
      ADD COLUMN IF NOT EXISTS onchain_offer_id  TEXT,
      ADD COLUMN IF NOT EXISTS onchain_config_id TEXT;
  `);
  console.log('✅ p2p_bet_offers — onchain_offer_id, onchain_config_id added');

  await client.query(`
    ALTER TABLE p2p_parlay_offers
      ADD COLUMN IF NOT EXISTS onchain_parlay_id TEXT,
      ADD COLUMN IF NOT EXISTS onchain_config_id TEXT;
  `);
  console.log('✅ p2p_parlay_offers — onchain_parlay_id, onchain_config_id added');

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_p2p_offers_onchain
      ON p2p_bet_offers (onchain_offer_id)
      WHERE onchain_offer_id IS NOT NULL;
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_p2p_parlays_onchain
      ON p2p_parlay_offers (onchain_parlay_id)
      WHERE onchain_parlay_id IS NOT NULL;
  `);
  console.log('✅ indexes created');
  console.log('Migration complete.');
} catch (err) {
  console.error('Migration error:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
