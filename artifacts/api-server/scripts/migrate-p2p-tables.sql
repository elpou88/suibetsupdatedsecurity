SET client_min_messages = WARNING;
-- =============================================================
-- P2P Tables Migration — Safe, Idempotent
-- Run this against your Railway (or any) PostgreSQL database.
-- Uses CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
-- so it is completely safe to run on an existing database.
-- =============================================================

-- 1. p2p_challenges
CREATE TABLE IF NOT EXISTS p2p_challenges (
  id                serial PRIMARY KEY,
  challenger_wallet text NOT NULL,
  challenged_wallet text NOT NULL,
  event_id          integer,
  event_name        text,
  prediction        text NOT NULL,
  amount            real NOT NULL,
  currency          text DEFAULT 'SBETS',
  odds              real DEFAULT 2.0,
  status            text DEFAULT 'pending',
  message           text,
  tx_hash           text,
  accepted_at       timestamp,
  resolved_at       timestamp,
  winner            text,
  created_at        timestamp DEFAULT now()
);

-- 2. settlement_messages
CREATE TABLE IF NOT EXISTS settlement_messages (
  id                serial PRIMARY KEY,
  recipient_wallet  text NOT NULL,
  bet_id            integer,
  event_name        text,
  result            text NOT NULL,
  payout_amount     real,
  currency          text,
  tx_hash           text,
  encrypted_proof   text,
  read              boolean DEFAULT false,
  created_at        timestamp DEFAULT now()
);

-- 3. p2p_bet_offers  (must come before p2p_bet_matches)
CREATE TABLE IF NOT EXISTS p2p_bet_offers (
  id                  serial PRIMARY KEY,
  creator_wallet      text NOT NULL,
  event_id            text NOT NULL,
  event_name          text NOT NULL,
  home_team           text NOT NULL,
  away_team           text NOT NULL,
  league_name         text,
  sport_name          text,
  match_date          timestamp,
  prediction          text NOT NULL,
  market_type         text DEFAULT 'match_winner',
  odds                real NOT NULL,
  creator_stake       real NOT NULL,
  taker_stake         real NOT NULL,
  currency            text DEFAULT 'SUI',
  filled_stake        real DEFAULT 0,
  status              text DEFAULT 'open',
  creator_tx_hash     text,
  expires_at          timestamp NOT NULL,
  created_at          timestamp DEFAULT now(),
  settled_at          timestamp,
  winner              text,
  platform_fee        real,
  settlement_tx_hash  text,
  onchain_offer_id    text,
  onchain_config_id   text
);

-- Ensure all columns exist (safe to run even if table already existed)
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS league_name       text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS sport_name        text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS match_date        timestamp;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS market_type       text DEFAULT 'match_winner';
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS filled_stake      real DEFAULT 0;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS creator_tx_hash   text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS winner            text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS platform_fee      real;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS settlement_tx_hash text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_offer_id  text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_config_id text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS settled_at        timestamp;

-- 4. p2p_bet_matches  (depends on p2p_bet_offers)
CREATE TABLE IF NOT EXISTS p2p_bet_matches (
  id                  serial PRIMARY KEY,
  offer_id            integer NOT NULL REFERENCES p2p_bet_offers(id),
  taker_wallet        text NOT NULL,
  stake               real NOT NULL,
  potential_payout    real NOT NULL,
  status              text DEFAULT 'active',
  taker_tx_hash       text,
  settlement_tx_hash  text,
  settled_at          timestamp,
  created_at          timestamp DEFAULT now(),
  taker_fee_rate      real DEFAULT 0.02,
  maker_rebate_rate   real DEFAULT 0,
  net_fee             real,
  actual_payout       real
);

ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS stake             real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS potential_payout  real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_fee_rate    real DEFAULT 0.02;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS maker_rebate_rate real DEFAULT 0;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS net_fee           real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS actual_payout     real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS winner            text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS onchain_match_id  text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS creator_wallet    text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS creator_stake     real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_stake       real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS platform_fee      real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS payout_tx_hash    text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS matched_at        timestamp DEFAULT now();
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_tx_hash     text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS settlement_tx_hash text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS settled_at        timestamp;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS created_at        timestamp DEFAULT now();

-- 5. p2p_parlay_offers  (must come before p2p_parlay_legs)
CREATE TABLE IF NOT EXISTS p2p_parlay_offers (
  id                  serial PRIMARY KEY,
  creator_wallet      text NOT NULL,
  total_odds          real NOT NULL,
  leg_count           integer NOT NULL DEFAULT 2,
  legs_won            integer DEFAULT 0,
  legs_lost           integer DEFAULT 0,
  creator_stake       real NOT NULL,
  taker_stake         real NOT NULL,
  currency            text DEFAULT 'SUI',
  status              text DEFAULT 'open',
  creator_tx_hash     text,
  taker_wallet        text,
  taker_tx_hash       text,
  expires_at          timestamp NOT NULL,
  created_at          timestamp DEFAULT now(),
  settled_at          timestamp,
  winner              text,
  settlement_tx_hash  text,
  platform_fee        real,
  taker_fee_rate      real DEFAULT 0.02,
  maker_rebate_rate   real DEFAULT 0,
  actual_payout       real,
  onchain_parlay_id   text,
  onchain_config_id   text
);

ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS leg_count         integer DEFAULT 2;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS legs_won          integer DEFAULT 0;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS legs_lost         integer DEFAULT 0;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS creator_stake     real;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_stake       real;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS creator_tx_hash   text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_wallet      text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_tx_hash     text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS winner            text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS settlement_tx_hash text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS platform_fee      real;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_fee_rate    real DEFAULT 0.02;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS maker_rebate_rate real DEFAULT 0;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS actual_payout     real;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_parlay_id text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_config_id text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS settled_at        timestamp;

-- 6. p2p_parlay_legs  (depends on p2p_parlay_offers)
CREATE TABLE IF NOT EXISTS p2p_parlay_legs (
  id               serial PRIMARY KEY,
  parlay_offer_id  integer NOT NULL REFERENCES p2p_parlay_offers(id),
  leg_index        integer NOT NULL DEFAULT 0,
  event_id         text NOT NULL,
  event_name       text NOT NULL,
  home_team        text NOT NULL,
  away_team        text NOT NULL,
  league_name      text,
  sport_name       text,
  match_date       timestamp,
  prediction       text NOT NULL,
  odds             real NOT NULL,
  status           text DEFAULT 'pending',
  settled_at       timestamp
);

ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS leg_index   integer DEFAULT 0;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS league_name text;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS sport_name  text;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS match_date  timestamp;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS settled_at  timestamp;

-- 7. p2p_volume_stats
CREATE TABLE IF NOT EXISTS p2p_volume_stats (
  id                  serial PRIMARY KEY,
  wallet_address      text NOT NULL UNIQUE,
  total_volume_maker  real DEFAULT 0,
  total_volume_taker  real DEFAULT 0,
  total_bets          integer DEFAULT 0,
  won_bets            integer DEFAULT 0,
  total_net_pnl       real DEFAULT 0,
  last_updated        timestamp DEFAULT now()
);

ALTER TABLE p2p_volume_stats ADD COLUMN IF NOT EXISTS total_volume_maker real DEFAULT 0;
ALTER TABLE p2p_volume_stats ADD COLUMN IF NOT EXISTS total_volume_taker real DEFAULT 0;
ALTER TABLE p2p_volume_stats ADD COLUMN IF NOT EXISTS total_bets         integer DEFAULT 0;
ALTER TABLE p2p_volume_stats ADD COLUMN IF NOT EXISTS won_bets           integer DEFAULT 0;
ALTER TABLE p2p_volume_stats ADD COLUMN IF NOT EXISTS total_net_pnl      real DEFAULT 0;
ALTER TABLE p2p_volume_stats ADD COLUMN IF NOT EXISTS last_updated       timestamp DEFAULT now();

-- Useful indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_status         ON p2p_bet_offers(status);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_creator        ON p2p_bet_offers(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_event          ON p2p_bet_offers(event_id);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_matches_offer         ON p2p_bet_matches(offer_id);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_matches_taker         ON p2p_bet_matches(taker_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_offers_status      ON p2p_parlay_offers(status);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_offers_creator     ON p2p_parlay_offers(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_legs_parlay        ON p2p_parlay_legs(parlay_offer_id);
CREATE INDEX IF NOT EXISTS idx_p2p_volume_stats_wallet       ON p2p_volume_stats(wallet_address);
CREATE INDEX IF NOT EXISTS idx_p2p_challenges_challenger     ON p2p_challenges(challenger_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_challenges_challenged     ON p2p_challenges(challenged_wallet);
CREATE INDEX IF NOT EXISTS idx_settlement_messages_recipient ON settlement_messages(recipient_wallet);

-- Done
SELECT 'P2P migration complete' AS status;
