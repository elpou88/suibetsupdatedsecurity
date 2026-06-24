-- SuiBets P2P: Safety Migration Script for Railway DB
-- Run this in Railway's PostgreSQL console (Data tab → Query).
-- All ALTER TABLE statements use ADD COLUMN IF NOT EXISTS — safe to re-run.
-- Generated: 2026-05-20

-- ── p2p_bet_offers ───────────────────────────────────────────────────────────
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS taker_stake real;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS market_type text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS league_name text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS sport_name text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS home_team text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS away_team text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS match_date timestamp;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS winner text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS platform_fee real;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS settlement_tx_hash text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS settled_at timestamp;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_offer_id text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_config_id text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS refund_tx_hash text;

-- ── p2p_bet_matches ──────────────────────────────────────────────────────────
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_tx_hash text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_fee_rate real DEFAULT 0.02;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS maker_rebate_rate real DEFAULT 0;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS net_fee real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS actual_payout real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS winner text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS onchain_match_id text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS creator_wallet text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS creator_stake real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_stake real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS platform_fee real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS payout_tx_hash text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS matched_at timestamp DEFAULT now();

-- ── p2p_parlay_offers ────────────────────────────────────────────────────────
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS currency text DEFAULT 'SUI';
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS status text DEFAULT 'open';
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_wallet text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_tx_hash text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS expires_at timestamp;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS winner text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS settlement_tx_hash text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS platform_fee real;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_fee_rate real DEFAULT 0.02;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS maker_rebate_rate real DEFAULT 0;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS actual_payout real;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_parlay_id text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_config_id text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS refund_tx_hash text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS settled_at timestamp;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS legs_won integer DEFAULT 0;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS legs_lost integer DEFAULT 0;

-- ── p2p_parlay_legs ──────────────────────────────────────────────────────────
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS league_name text;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS sport_name text;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS market_type text;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS match_date timestamp;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS settled_at timestamp;

-- ── Verify column counts ──────────────────────────────────────────────────────
SELECT table_name, COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_name IN ('p2p_bet_offers','p2p_bet_matches','p2p_parlay_offers','p2p_parlay_legs')
GROUP BY table_name
ORDER BY table_name;
