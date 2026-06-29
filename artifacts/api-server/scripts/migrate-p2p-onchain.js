/**
 * migrate-p2p-onchain.js
 *
 * Adds `onchain_offer_id` to p2p_bet_offers and
 * `onchain_parlay_id` to p2p_parlay_offers.
 *
 * Safe to run multiple times (uses IF NOT EXISTS).
 *
 * Run:
 *   node artifacts/api-server/scripts/migrate-p2p-onchain.js
 */

const { Client } = require('pg');

async function run() {
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
        ADD COLUMN IF NOT EXISTS onchain_parlay_id  TEXT,
        ADD COLUMN IF NOT EXISTS onchain_config_id  TEXT;
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
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
