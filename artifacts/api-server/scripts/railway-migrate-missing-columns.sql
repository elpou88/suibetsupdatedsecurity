SET client_min_messages = WARNING;
-- SuiBets: Missing Columns Migration — Railway Production
-- Adds columns that exist in the current schema but are absent from the
-- Railway database because they were added after the initial migration.
--
-- SAFE TO RUN MULTIPLE TIMES — every statement uses ADD COLUMN IF NOT EXISTS.
-- Run this in Railway → your database → Data tab → Query console.
-- Generated: 2026-06-06

-- ── p2p_bet_offers: newer feature columns ────────────────────────────────────
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS refund_tx_hash          text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_client_order_id text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_order_id        text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_order_digest    text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS share_token              text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS suins_gated              boolean DEFAULT false;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS live_odds                boolean DEFAULT false;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS score_snapshot           text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS match_minute             integer;

-- ── p2p_bet_matches: Walrus + checkpoint proof columns ───────────────────────
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS walrus_blob_id      text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS walrus_receipt_json text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS checkpoint_seq      text;

-- ── Unique index on share_token (nullable — only index non-null values) ──────
CREATE UNIQUE INDEX IF NOT EXISTS idx_p2p_bet_offers_share_token
  ON p2p_bet_offers(share_token)
  WHERE share_token IS NOT NULL;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('p2p_bet_offers', 'p2p_bet_matches')
  AND column_name IN (
    'refund_tx_hash','deepbook_client_order_id','deepbook_order_id',
    'deepbook_order_digest','share_token','suins_gated','live_odds',
    'score_snapshot','match_minute',
    'walrus_blob_id','walrus_receipt_json','checkpoint_seq'
  )
ORDER BY table_name, column_name;
