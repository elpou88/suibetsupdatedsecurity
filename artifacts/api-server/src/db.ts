import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '@shared/schema';

// Database connection string from environment variables
// RAILWAY_DATABASE_URL takes priority when set (production Railway DB with real user data)
const connectionString = process.env.RAILWAY_DATABASE_URL || process.env.DATABASE_URL;

// Declare variables that will be initialized properly
let client: any;
let db: any;

// Check if the connection string is defined
if (!connectionString) {
  console.warn('DATABASE_URL environment variable is not defined');
  console.warn('Blockchain storage will be used as a fallback');
  
  // Set placeholders for the db objects
  client = null;
  db = {
    select: () => ({ from: () => Promise.resolve([]) }),
    insert: () => ({ values: () => Promise.resolve([]) })
  };
} else {
  // Create the database connection
  // max: 25 — settlement worker startup can batch many queries; headroom needed for HTTP routes
  // idle_timeout: 30 — release idle connections after 30s
  // connect_timeout: 10 — fail fast if pool is exhausted (don't hang forever)
  client = postgres(connectionString, { max: 25, idle_timeout: 30, connect_timeout: 10, statement_timeout: 20000, onnotice: () => {} });
  
  // Create the database
  db = drizzle(client, { schema });
}

// Export the database and raw client
export { db, client as pgClient };

/**
 * Initialize the database (create tables, run migrations, etc.)
 */
export async function initDb() {
  try {
    // If no database connection, return early
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping database initialization');
      return db;
    }
    
    console.log('Connecting to database...');
    
    // Run automatic schema migrations
    await runAutoMigrations();
    
    console.log('Database connection established');
    return db;
  } catch (error) {
    console.error('Error initializing database:', error);
    // Don't throw error, just log it and continue
    console.log('Continuing with blockchain-based storage as fallback');
    return db;
  }
}

/**
 * Run automatic migrations to add missing columns
 */
async function runAutoMigrations() {
  if (!client) return;
  
  try {
    console.log('Checking for schema updates...');
    
    try {
      await client`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'bets' AND column_name = 'currency'
          ) THEN
            ALTER TABLE bets ADD COLUMN currency VARCHAR(10) DEFAULT 'SUI';
            RAISE NOTICE 'Added currency column to bets table';
          END IF;
        END $$;
      `;
      
      await client`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'bets' AND column_name = 'nft_mint_tx'
          ) THEN
            ALTER TABLE bets ADD COLUMN nft_mint_tx TEXT;
            RAISE NOTICE 'Added nft_mint_tx column to bets table';
          END IF;
        END $$;
      `;
      await client`ALTER TABLE bets ADD COLUMN IF NOT EXISTS match_date TIMESTAMP`;
      await client`ALTER TABLE bets ADD COLUMN IF NOT EXISTS home_team TEXT`;
      await client`ALTER TABLE bets ADD COLUMN IF NOT EXISTS away_team TEXT`;
      await client`ALTER TABLE bets ADD COLUMN IF NOT EXISTS market_type TEXT DEFAULT 'match_winner'`;
    } catch (betsErr) {
      console.log('Bets table migrations skipped (table may not exist)');
    }

    console.log('Schema check complete');

    try {
      await client`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'revenue_claims' AND column_name = 'claim_type'
          ) THEN
            ALTER TABLE revenue_claims ADD COLUMN claim_type TEXT DEFAULT 'holder';
            RAISE NOTICE 'Added claim_type column to revenue_claims table';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'revenue_claims' AND column_name = 'claim_amount_sbets'
          ) THEN
            ALTER TABLE revenue_claims ADD COLUMN claim_amount_sbets REAL DEFAULT 0;
            RAISE NOTICE 'Added claim_amount_sbets column to revenue_claims table';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'revenue_claims' AND column_name = 'tx_hash_sbets'
          ) THEN
            ALTER TABLE revenue_claims ADD COLUMN tx_hash_sbets TEXT;
            RAISE NOTICE 'Added tx_hash_sbets column to revenue_claims table';
          END IF;
        END $$;
      `;
      console.log('Revenue claims columns ensured');
    } catch (rcErr) {
      console.log('Revenue claims migrations skipped (table may not exist)');
    }


    try {
      await client`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_tx_hash_unique
        ON bets (tx_hash)
        WHERE tx_hash IS NOT NULL
      `;
      await client`DROP INDEX IF EXISTS idx_revenue_claims_wallet_week`;
      await client`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_claims_wallet_week_type
        ON revenue_claims (wallet_address, week_start, claim_type)
      `;
      await client`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referred_wallet
        ON referrals (referred_wallet)
      `;
      await client`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ops_tx_hash_unique
        ON wurlus_wallet_operations (tx_hash)
        WHERE tx_hash IS NOT NULL AND tx_hash NOT LIKE 'bet-%' AND tx_hash NOT LIKE 'win-%' AND tx_hash NOT LIKE 'deposit-%' AND tx_hash NOT LIKE 'wd-%'
      `;
      console.log('Unique indexes ensured (tx_hash, revenue_claims, referrals, wallet_ops)');
    } catch (idxErr) {
      console.log('Some unique indexes skipped (tables may not exist)');
    }

    await client`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        ip_address TEXT,
        revoked BOOLEAN DEFAULT FALSE
      )
    `;
    console.log('Admin sessions table ensured');

    await client`
      CREATE TABLE IF NOT EXISTS buyback_state (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        pending_pool_sui DOUBLE PRECISION NOT NULL DEFAULT 0,
        pending_pool_sbets DOUBLE PRECISION NOT NULL DEFAULT 0,
        total_buyback_sui DOUBLE PRECISION NOT NULL DEFAULT 0,
        total_sbets_bought DOUBLE PRECISION NOT NULL DEFAULT 0,
        total_sbets_burned DOUBLE PRECISION NOT NULL DEFAULT 0,
        total_swaps INTEGER NOT NULL DEFAULT 0,
        total_burns INTEGER NOT NULL DEFAULT 0,
        last_swap_time BIGINT,
        daily_buyback_sui DOUBLE PRECISION NOT NULL DEFAULT 0,
        daily_sbets_burned DOUBLE PRECISION NOT NULL DEFAULT 0,
        daily_reset_date TEXT NOT NULL DEFAULT '',
        history JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS pending_pool_sbets DOUBLE PRECISION NOT NULL DEFAULT 0`;
    await client`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS daily_sbets_burned DOUBLE PRECISION NOT NULL DEFAULT 0`;
    await client`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_sbets_burned DOUBLE PRECISION NOT NULL DEFAULT 0`;
    await client`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_sbets_bought DOUBLE PRECISION NOT NULL DEFAULT 0`;
    await client`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_buyback_sui DOUBLE PRECISION NOT NULL DEFAULT 0`;
    await client`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_swaps INTEGER NOT NULL DEFAULT 0`;
    await client`ALTER TABLE buyback_state ADD COLUMN IF NOT EXISTS total_burns INTEGER NOT NULL DEFAULT 0`;
    console.log('Buyback state table ensured');

    await client`
      CREATE TABLE IF NOT EXISTS revenue_claims (
        id SERIAL PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        week_start TIMESTAMP NOT NULL,
        sbets_balance REAL NOT NULL DEFAULT 0,
        share_percentage REAL NOT NULL DEFAULT 0,
        claim_amount REAL NOT NULL DEFAULT 0,
        claim_amount_sbets REAL DEFAULT 0,
        tx_hash TEXT NOT NULL,
        tx_hash_sbets TEXT,
        claim_type TEXT DEFAULT 'holder',
        claimed_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_claims_wallet_week_type
      ON revenue_claims (wallet_address, week_start, claim_type)
    `;
    console.log('Revenue claims table ensured');

    await client`
      CREATE TABLE IF NOT EXISTS revenue_tracker (
        id SERIAL PRIMARY KEY,
        timestamp BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
        source TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'SUI',
        gross_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        buyback_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        net_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        holders_share DOUBLE PRECISION NOT NULL DEFAULT 0,
        lp_share DOUBLE PRECISION NOT NULL DEFAULT 0,
        treasury_share DOUBLE PRECISION NOT NULL DEFAULT 0,
        profit_share DOUBLE PRECISION NOT NULL DEFAULT 0,
        bet_id TEXT,
        tx_hash TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('Revenue tracker table ensured');

    await client`
      CREATE TABLE IF NOT EXISTS social_predictions (
        id SERIAL PRIMARY KEY,
        creator_wallet TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL DEFAULT 'other',
        end_date TIMESTAMP NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        total_yes_amount REAL DEFAULT 0,
        total_no_amount REAL DEFAULT 0,
        total_participants INTEGER DEFAULT 0,
        resolved_outcome TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP,
        yes_reserve REAL DEFAULT 10000,
        no_reserve REAL DEFAULT 10000,
        initial_liquidity REAL DEFAULT 10000,
        resolution_source TEXT DEFAULT 'creator',
        total_volume REAL DEFAULT 0,
        creator_resolution TEXT
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS social_prediction_bets (
        id SERIAL PRIMARY KEY,
        prediction_id INTEGER NOT NULL,
        wallet TEXT NOT NULL,
        side TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'SBETS',
        tx_id TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT NOW(),
        share_price REAL,
        shares REAL,
        bet_type TEXT DEFAULT 'buy'
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS social_prediction_comments (
        id SERIAL PRIMARY KEY,
        prediction_id INTEGER NOT NULL,
        wallet TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS social_challenges (
        id SERIAL PRIMARY KEY,
        creator_wallet TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        stake_amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'SUI',
        max_participants INTEGER DEFAULT 10,
        current_participants INTEGER DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'open',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS social_challenge_participants (
        id SERIAL PRIMARY KEY,
        challenge_id INTEGER NOT NULL,
        wallet TEXT NOT NULL,
        side TEXT NOT NULL DEFAULT 'for',
        tx_hash TEXT UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS social_follows (
        id SERIAL PRIMARY KEY,
        follower_wallet TEXT NOT NULL,
        following_wallet TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await client`
      CREATE TABLE IF NOT EXISTS used_tx_hashes (
        id SERIAL PRIMARY KEY,
        tx_hash TEXT NOT NULL UNIQUE,
        wallet TEXT NOT NULL,
        purpose TEXT DEFAULT 'bet',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    try {
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS yes_reserve REAL DEFAULT 10000`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS no_reserve REAL DEFAULT 10000`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS initial_liquidity REAL DEFAULT 10000`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS resolution_source TEXT DEFAULT 'creator'`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS total_volume REAL DEFAULT 0`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS creator_resolution TEXT`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'SBETS'`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS onchain_market_id TEXT`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS home_logo TEXT`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS away_logo TEXT`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS league_logo TEXT`;
      await client`ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS event_id TEXT`;
      await client`ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS share_price REAL`;
      await client`ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS shares REAL`;
      await client`ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS bet_type TEXT DEFAULT 'buy'`;
      await client`ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`;
      await client`ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'SBETS'`;
    } catch (ammErr) {
      console.log('AMM column migrations note:', ammErr);
    }
    console.log('Social prediction tables and AMM columns ensured');

    // ─── HIP-4 P2P enhancements ──────────────────────────────────────────────
    try {
      // Create all core P2P tables first (safe if they already exist)
      await client`
        CREATE TABLE IF NOT EXISTS p2p_bet_offers (
          id                  SERIAL PRIMARY KEY,
          creator_wallet      TEXT NOT NULL,
          event_id            TEXT NOT NULL,
          event_name          TEXT NOT NULL DEFAULT '',
          home_team           TEXT NOT NULL DEFAULT '',
          away_team           TEXT NOT NULL DEFAULT '',
          league_name         TEXT,
          sport_name          TEXT,
          match_date          TIMESTAMP,
          prediction          TEXT NOT NULL,
          market_type         TEXT DEFAULT 'match_winner',
          odds                REAL NOT NULL,
          creator_stake       REAL NOT NULL,
          taker_stake         REAL NOT NULL,
          currency            TEXT DEFAULT 'SUI',
          filled_stake        REAL DEFAULT 0,
          status              TEXT DEFAULT 'open',
          creator_tx_hash     TEXT,
          expires_at          TIMESTAMP NOT NULL DEFAULT NOW(),
          created_at          TIMESTAMP DEFAULT NOW(),
          settled_at          TIMESTAMP,
          winner              TEXT,
          platform_fee        REAL DEFAULT 0,
          settlement_tx_hash  TEXT,
          onchain_offer_id    TEXT,
          onchain_config_id   TEXT,
          refund_tx_hash      TEXT
        )
      `;
      await client`
        CREATE TABLE IF NOT EXISTS p2p_bet_matches (
          id                  SERIAL PRIMARY KEY,
          offer_id            INTEGER NOT NULL REFERENCES p2p_bet_offers(id),
          taker_wallet        TEXT NOT NULL,
          stake               REAL NOT NULL DEFAULT 0,
          potential_payout    REAL NOT NULL DEFAULT 0,
          status              TEXT DEFAULT 'active',
          taker_tx_hash       TEXT,
          settlement_tx_hash  TEXT,
          settled_at          TIMESTAMP,
          created_at          TIMESTAMP DEFAULT NOW(),
          taker_fee_rate      REAL DEFAULT 0.02,
          maker_rebate_rate   REAL DEFAULT 0,
          net_fee             REAL,
          actual_payout       REAL,
          winner              TEXT,
          onchain_match_id    TEXT,
          creator_wallet      TEXT,
          creator_stake       REAL,
          taker_stake         REAL,
          platform_fee        REAL,
          payout_tx_hash      TEXT,
          matched_at          TIMESTAMP DEFAULT NOW()
        )
      `;
      await client`
        CREATE TABLE IF NOT EXISTS p2p_parlay_offers (
          id                  SERIAL PRIMARY KEY,
          creator_wallet      TEXT NOT NULL,
          total_odds          REAL NOT NULL DEFAULT 1,
          leg_count           INTEGER NOT NULL DEFAULT 2,
          legs_won            INTEGER DEFAULT 0,
          legs_lost           INTEGER DEFAULT 0,
          creator_stake       REAL NOT NULL DEFAULT 0,
          taker_stake         REAL NOT NULL DEFAULT 0,
          currency            TEXT DEFAULT 'SUI',
          status              TEXT DEFAULT 'open',
          creator_tx_hash     TEXT,
          taker_wallet        TEXT,
          taker_tx_hash       TEXT,
          expires_at          TIMESTAMP NOT NULL DEFAULT NOW(),
          created_at          TIMESTAMP DEFAULT NOW(),
          settled_at          TIMESTAMP,
          winner              TEXT,
          settlement_tx_hash  TEXT,
          platform_fee        REAL,
          taker_fee_rate      REAL DEFAULT 0.02,
          maker_rebate_rate   REAL DEFAULT 0,
          actual_payout       REAL,
          onchain_parlay_id   TEXT,
          onchain_config_id   TEXT,
          refund_tx_hash      TEXT
        )
      `;
      await client`
        CREATE TABLE IF NOT EXISTS p2p_parlay_legs (
          id               SERIAL PRIMARY KEY,
          parlay_offer_id  INTEGER NOT NULL REFERENCES p2p_parlay_offers(id),
          leg_index        INTEGER NOT NULL DEFAULT 0,
          event_id         TEXT NOT NULL,
          event_name       TEXT NOT NULL DEFAULT '',
          home_team        TEXT NOT NULL DEFAULT '',
          away_team        TEXT NOT NULL DEFAULT '',
          league_name      TEXT,
          sport_name       TEXT,
          match_date       TIMESTAMP,
          prediction       TEXT NOT NULL,
          odds             REAL NOT NULL DEFAULT 1,
          status           TEXT DEFAULT 'pending',
          settled_at       TIMESTAMP
        )
      `;
      await client`
        CREATE TABLE IF NOT EXISTS settled_events (
          id                SERIAL PRIMARY KEY,
          external_event_id TEXT NOT NULL UNIQUE,
          event_name        TEXT,
          home_team         TEXT,
          away_team         TEXT,
          home_score        INTEGER,
          away_score        INTEGER,
          winner            TEXT,
          sport_id          INTEGER,
          league_name       TEXT,
          settled_at        TIMESTAMP DEFAULT NOW(),
          raw_data          JSONB,
          bets_settled      INTEGER DEFAULT 0
        )
      `;
      await client`
        CREATE TABLE IF NOT EXISTS p2p_volume_stats (
          id SERIAL PRIMARY KEY,
          wallet_address TEXT NOT NULL UNIQUE,
          total_volume_maker REAL DEFAULT 0,
          total_volume_taker REAL DEFAULT 0,
          total_bets INTEGER DEFAULT 0,
          won_bets INTEGER DEFAULT 0,
          total_net_pnl REAL DEFAULT 0,
          last_updated TIMESTAMP DEFAULT NOW()
        )
      `;
      console.log('[P2P] Core tables ensured');
      // p2p_bet_matches — full column set (safe to run on any DB state)
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS stake REAL`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS potential_payout REAL`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_fee_rate REAL DEFAULT 0.02`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS maker_rebate_rate REAL DEFAULT 0`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS net_fee REAL`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS actual_payout REAL`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS winner TEXT`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS onchain_match_id TEXT`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS creator_wallet TEXT`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS creator_stake REAL`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_stake REAL`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS platform_fee REAL`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS payout_tx_hash TEXT`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS matched_at TIMESTAMP DEFAULT NOW()`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS settlement_tx_hash TEXT`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_tx_hash TEXT`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP`;
      await client`ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`;
      // p2p_parlay_offers — full column set
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_fee_rate REAL DEFAULT 0.02`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS maker_rebate_rate REAL DEFAULT 0`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS actual_payout REAL`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS leg_count INTEGER DEFAULT 2`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS legs_won INTEGER DEFAULT 0`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS legs_lost INTEGER DEFAULT 0`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS creator_stake REAL`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_stake REAL`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS creator_tx_hash TEXT`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_wallet TEXT`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_tx_hash TEXT`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS winner TEXT`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS settlement_tx_hash TEXT`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS platform_fee REAL`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_parlay_id TEXT`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_config_id TEXT`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP`;
      // p2p_bet_offers — ensure all columns present
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS league_name TEXT`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS sport_name TEXT`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS match_date TIMESTAMP`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS market_type TEXT DEFAULT 'match_winner'`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS filled_stake REAL DEFAULT 0`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS creator_tx_hash TEXT`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS winner TEXT`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS platform_fee REAL DEFAULT 0`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS settlement_tx_hash TEXT`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_offer_id TEXT`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_config_id TEXT`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS refund_tx_hash TEXT`;
      await client`ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS refund_tx_hash TEXT`;
      await client`ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS visible_stake REAL DEFAULT NULL`;
      // indexes
      await client`CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_status ON p2p_bet_offers(status)`;
      await client`CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_creator ON p2p_bet_offers(creator_wallet)`;
      await client`CREATE INDEX IF NOT EXISTS idx_p2p_bet_matches_offer ON p2p_bet_matches(offer_id)`;
      await client`CREATE INDEX IF NOT EXISTS idx_p2p_bet_matches_taker ON p2p_bet_matches(taker_wallet)`;
      await client`CREATE INDEX IF NOT EXISTS idx_p2p_parlay_offers_creator ON p2p_parlay_offers(creator_wallet)`;
      console.log('[P2P] HIP-4 schema migrations complete');
    } catch (p2pErr) {
      console.log('[P2P] HIP-4 migration note (non-fatal):', p2pErr);
    }

    // ─── Fantasy WC 2026 teams ───────────────────────────────────────────────
    try {
      await client`
        CREATE TABLE IF NOT EXISTS fantasy_teams (
          id              SERIAL PRIMARY KEY,
          wallet_address  TEXT NOT NULL UNIQUE,
          team_name       TEXT NOT NULL DEFAULT 'My World Cup XI',
          starter_ids     TEXT[] NOT NULL DEFAULT '{}',
          bench_ids       TEXT[] NOT NULL DEFAULT '{}',
          captain_id      TEXT,
          total_points    INTEGER NOT NULL DEFAULT 0,
          locked          BOOLEAN NOT NULL DEFAULT false,
          fee_paid        BOOLEAN NOT NULL DEFAULT false,
          fee_tx_hash     TEXT,
          dev_bypass      BOOLEAN NOT NULL DEFAULT false,
          created_at      TIMESTAMP DEFAULT NOW(),
          updated_at      TIMESTAMP DEFAULT NOW()
        )
      `;
      console.log('[Fantasy] fantasy_teams table ensured');
    } catch (ftErr) {
      console.log('[Fantasy] fantasy_teams table note (non-fatal):', ftErr);
    }

    // ─── Generic key-value store (used by DeepBook fill listener for cursor persistence) ──
    try {
      await client`
        CREATE TABLE IF NOT EXISTS kv_store (
          key        TEXT PRIMARY KEY,
          value      TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      console.log('[KV] kv_store table ensured — DeepBook cursor will persist across restarts');
    } catch (kvErr) {
      console.log('[KV] kv_store table note (non-fatal):', kvErr);
    }

    // ─── zkLogin salts — one persistent salt per (provider, subject) pair ────
    try {
      await client`
        CREATE TABLE IF NOT EXISTS zklogin_salts (
          id          SERIAL PRIMARY KEY,
          provider    TEXT NOT NULL,
          subject     TEXT NOT NULL,
          salt        TEXT NOT NULL,
          sui_address TEXT,
          created_at  TIMESTAMP DEFAULT NOW()
        )
      `;
      await client`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_zklogin_salts_provider_subject
        ON zklogin_salts (provider, subject)
      `;
      console.log('[zkLogin] zklogin_salts table ensured — same Google account always gets same salt → same wallet');
    } catch (zkErr) {
      console.log('[zkLogin] zklogin_salts table note (non-fatal):', zkErr);
    }

  } catch (error) {
    console.error('Auto-migration error (non-fatal):', error);
  }
}

/**
 * Seed the database with initial data
 */
export async function seedDb() {
  try {
    // If no database connection, return early
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping database seeding');
      return;
    }
    
    console.log('Seeding database...');
    
    // Seed sports data
    await seedSports();
    
    // Seed market types data
    await seedMarketTypes();
    
    // Seed promotions data
    await seedPromotions();
    
    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
    // Don't throw error, just log it
    console.log('Continuing with blockchain-based storage as fallback');
  }
}

/**
 * Seed sports data
 */
async function seedSports() {
  try {
    // Skip if no database connection
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping sports seeding');
      return;
    }
    
    // Check if sports already exist
    const existingSports = await db.select().from(schema.sports);
    
    if (existingSports.length > 0) {
      console.log(`Found ${existingSports.length} existing sports, checking for missing sports...`);
      const existingSlugs = new Set(existingSports.map((s: any) => s.slug));
      const missingSports = [
        { name: 'Horse Racing', slug: 'horse-racing', icon: '🏇', wurlusSportId: 'horse_racing_wurlus_id', isActive: true, providerId: 'sports_provider_1' },
        { name: 'Cricket', slug: 'cricket', icon: '🏏', wurlusSportId: 'cricket_wurlus_id', isActive: true, providerId: 'sports_provider_1' },
        { name: 'Boxing', slug: 'boxing', icon: '🥊', wurlusSportId: 'boxing_wurlus_id', isActive: true, providerId: 'sports_provider_1' },
        { name: 'Chess', slug: 'chess', icon: '♟️', wurlusSportId: 'chess_wurlus_id', isActive: true, providerId: 'sports_provider_1' },
        { name: 'Armwrestling', slug: 'armwrestling', icon: '💪', wurlusSportId: 'armwrestling_wurlus_id', isActive: true, providerId: 'sports_provider_1' },
      ].filter(s => !existingSlugs.has(s.slug));
      if (missingSports.length > 0) {
        await db.insert(schema.sports).values(missingSports);
        console.log(`Added ${missingSports.length} missing sports: ${missingSports.map(s => s.name).join(', ')}`);
      }
      return;
    }
    
    console.log('Seeding sports data...');
    
    // Default sports data
    const sportsData = [
      { 
        name: 'Soccer', 
        slug: 'soccer',
        icon: '⚽',
        wurlusSportId: 'soccer_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Basketball', 
        slug: 'basketball',
        icon: '🏀',
        wurlusSportId: 'basketball_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Tennis', 
        slug: 'tennis',
        icon: '🎾',
        wurlusSportId: 'tennis_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'American Football', 
        slug: 'american-football',
        icon: '🏈',
        wurlusSportId: 'football_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Baseball', 
        slug: 'baseball',
        icon: '⚾',
        wurlusSportId: 'baseball_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Ice Hockey', 
        slug: 'ice-hockey',
        icon: '🏒',
        wurlusSportId: 'hockey_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'MMA', 
        slug: 'mma',
        icon: '🥊',
        wurlusSportId: 'mma_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_2'
      },
      { 
        name: 'Boxing', 
        slug: 'boxing',
        icon: '🥊',
        wurlusSportId: 'boxing_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_2'
      },
      { 
        name: 'Esports', 
        slug: 'esports',
        icon: '🎮',
        wurlusSportId: 'esports_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_3'
      },
      // New sports from API-Sports
      { 
        name: 'AFL', 
        slug: 'afl',
        icon: '🏉',
        wurlusSportId: 'afl_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Formula 1', 
        slug: 'formula-1',
        icon: '🏎️',
        wurlusSportId: 'f1_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Handball', 
        slug: 'handball',
        icon: '🤾',
        wurlusSportId: 'handball_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'NBA', 
        slug: 'nba',
        icon: '🏀',
        wurlusSportId: 'nba_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'NFL', 
        slug: 'nfl',
        icon: '🏈',
        wurlusSportId: 'nfl_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Rugby', 
        slug: 'rugby',
        icon: '🏉',
        wurlusSportId: 'rugby_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Volleyball', 
        slug: 'volleyball',
        icon: '🏐',
        wurlusSportId: 'volleyball_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      { 
        name: 'Horse Racing', 
        slug: 'horse-racing',
        icon: '🏇',
        wurlusSportId: 'horse_racing_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      {
        name: 'Chess',
        slug: 'chess',
        icon: '♟️',
        wurlusSportId: 'chess_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      },
      {
        name: 'Armwrestling',
        slug: 'armwrestling',
        icon: '💪',
        wurlusSportId: 'armwrestling_wurlus_id',
        isActive: true,
        providerId: 'sports_provider_1'
      }
    ];
    
    // Insert sports data
    await db.insert(schema.sports).values(sportsData);
    
    console.log(`Seeded ${sportsData.length} sports`);
  } catch (error) {
    console.error('Error seeding sports data:', error);
    console.log('Continuing with blockchain-based storage as fallback');
  }
}

/**
 * Seed market types data
 */
async function seedMarketTypes() {
  try {
    // Skip if no database connection
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping market types seeding');
      return;
    }
    
    // Check if market types already exist
    const existingMarketTypes = await db.select().from(schema.marketTypes);
    
    if (existingMarketTypes.length > 0) {
      console.log(`Found ${existingMarketTypes.length} existing market types, skipping seed`);
      return;
    }
    
    console.log('Seeding market types data...');
    
    // Default market types data
    const marketTypesData = [
      {
        code: "MONEYLINE",
        name: "Money Line",
        description: "Bet on the outcome of a match - home win, draw, or away win",
        category: "main",
        isActive: true,
        displayOrder: 1,
        createdAt: new Date()
      },
      {
        code: "OVER_UNDER",
        name: "Over/Under",
        description: "Bet on whether the total score will be over or under a specified value",
        category: "main",
        isActive: true,
        requiresNumericValue: true,
        displayOrder: 2,
        createdAt: new Date()
      },
      {
        code: "CORRECT_SCORE",
        name: "Correct Score",
        description: "Bet on the exact final score of a match",
        category: "props",
        isActive: true,
        requiresScoreSelection: true,
        displayOrder: 3,
        createdAt: new Date()
      },
      {
        code: "FIRST_SCORER",
        name: "First Scorer",
        description: "Bet on which player will score the first goal/point",
        category: "props",
        isActive: true,
        requiresPlayerSelection: true,
        displayOrder: 4,
        createdAt: new Date()
      },
      {
        code: "HANDICAP",
        name: "Handicap",
        description: "Bet with a handicap applied to the favorite team",
        category: "main",
        isActive: true,
        requiresNumericValue: true,
        displayOrder: 5,
        createdAt: new Date()
      },
      {
        code: "BTTS",
        name: "Both Teams to Score",
        description: "Bet on whether both teams will score in the match",
        category: "main",
        isActive: true,
        displayOrder: 6,
        createdAt: new Date()
      },
      {
        code: "DOUBLE_CHANCE",
        name: "Double Chance",
        description: "Bet on two of three possible outcomes (1X, X2, or 12)",
        category: "main",
        isActive: true,
        displayOrder: 7,
        createdAt: new Date()
      },
      {
        code: "HALF_TIME",
        name: "Half-Time Result",
        description: "Bet on the result at half-time",
        category: "main",
        isActive: true,
        displayOrder: 8,
        createdAt: new Date()
      }
    ];
    
    // Insert market types data
    await db.insert(schema.marketTypes).values(marketTypesData);
    
    console.log(`Seeded ${marketTypesData.length} market types`);
  } catch (error) {
    console.error('Error initializing default data:', error);
    console.log('Continuing with blockchain-based storage as fallback');
  }
}

/**
 * Seed promotions data
 */
async function seedPromotions() {
  try {
    // Skip if no database connection
    if (!connectionString) {
      console.log('No DATABASE_URL provided, skipping promotions seeding');
      return;
    }
    
    // Check if promotions already exist
    const existingPromotions = await db.select().from(schema.promotions);
    
    if (existingPromotions.length > 0) {
      console.log(`Found ${existingPromotions.length} existing promotions, skipping seed`);
      return;
    }
    
    console.log('Seeding promotions data...');
    
    // Default promotions data
    const promotionsData = [
      {
        title: 'Welcome Bonus',
        description: 'Get 100% bonus on your first deposit up to 1000 SUI',
        type: 'deposit',
        code: 'WELCOME100',
        isActive: true,
        amount: 1000,
        minDeposit: 100,
        maxReward: 1000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        requirements: 'First-time deposit',
        termsAndConditions: 'Must wager bonus amount 10x before withdrawal',
        imageUrl: '/images/welcome-bonus.jpg',
        smartContractAddress: null
      },
      {
        title: 'Refer a Friend',
        description: 'Get 50 SUI for each friend you refer to our platform',
        type: 'referral',
        code: 'REFER50',
        isActive: true,
        amount: 50,
        minDeposit: 0,
        maxReward: 500,
        startDate: new Date(),
        endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
        requirements: 'Referred friend must deposit at least 100 SUI',
        termsAndConditions: 'Bonus paid once friend completes first bet',
        imageUrl: '/images/refer-friend.jpg',
        smartContractAddress: null
      },
      {
        title: 'Enhanced Odds',
        description: 'Get enhanced odds on selected Esports matches',
        type: 'odds',
        code: 'ESPORTS',
        isActive: true,
        amount: null,
        minDeposit: 10,
        maxReward: 500,
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
        requirements: 'Valid for Esports bets only',
        termsAndConditions: 'Maximum bet amount of 100 SUI per match',
        imageUrl: '/images/enhanced-odds.jpg',
        smartContractAddress: null
      },
      {
        title: 'Loyalty Program',
        description: 'Earn loyalty points for every bet you place',
        type: 'loyalty',
        code: 'LOYALTY',
        isActive: true,
        amount: null,
        minDeposit: 0,
        maxReward: null,
        startDate: new Date(),
        endDate: null, // No end date
        requirements: 'Must have an active account',
        termsAndConditions: 'Points can be redeemed for free bets or merchandise',
        imageUrl: '/images/loyalty.jpg',
        smartContractAddress: null
      },
      {
        title: 'Staking Rewards',
        description: 'Stake SUI tokens and earn weekly rewards',
        type: 'staking',
        code: 'STAKE',
        isActive: true,
        amount: null,
        minDeposit: 500,
        maxReward: null,
        startDate: new Date(),
        endDate: null, // No end date
        requirements: 'Minimum staking period of 30 days',
        termsAndConditions: 'Rewards paid weekly based on staking amount',
        imageUrl: '/images/staking.jpg',
        smartContractAddress: '0xabc123def456sui'
      }
    ];
    
    // Insert promotions data
    await db.insert(schema.promotions).values(promotionsData);
    
    console.log(`Seeded ${promotionsData.length} promotions`);
  } catch (error) {
    console.error('Error seeding promotions data:', error);
    console.log('Continuing with blockchain-based storage as fallback');
  }
}