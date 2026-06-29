SET client_min_messages = WARNING;
-- ============================================================================
-- railway-migrate-new-tables.sql
-- Idempotent — safe to run multiple times on any environment.
-- Adds tables and columns present in Railway production that were missing
-- from the local dev schema and migrate-all.sql.
-- ============================================================================

-- ── hot_potato_games ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hot_potato_games (
  id                SERIAL PRIMARY KEY,
  game_object_id    text,
  event_id          text NOT NULL DEFAULT '',
  team_a            text NOT NULL DEFAULT '',
  team_b            text NOT NULL DEFAULT '',
  sport_name        text,
  league_name       text,
  match_time        timestamp,
  pot_amount        real DEFAULT 0,
  currency          text DEFAULT 'SBETS',
  min_grab_amount   real DEFAULT 100,
  current_holder    text,
  holder_team       integer DEFAULT 0,
  grab_count        integer DEFAULT 0,
  player_count      integer DEFAULT 0,
  status            text DEFAULT 'active',
  timer_duration_ms integer DEFAULT 60000,
  explosion_time_ms text,
  game_deadline_ms  text,
  created_by        text,
  created_at        timestamp DEFAULT now(),
  settled_at        timestamp,
  winning_team      integer,
  tx_hash           text
);

-- ── hot_potato_grabs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hot_potato_grabs (
  id             SERIAL PRIMARY KEY,
  game_id        integer,
  wallet         text NOT NULL,
  amount         real NOT NULL,
  team_chosen    integer NOT NULL,
  grab_number    integer NOT NULL,
  timer_at_grab  integer,
  pot_after_grab real,
  tx_hash        text,
  created_at     timestamp DEFAULT now()
);

-- ── hot_potato_players ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hot_potato_players (
  id                SERIAL PRIMARY KEY,
  game_id           integer,
  wallet            text NOT NULL,
  total_contributed real DEFAULT 0,
  grab_count        integer DEFAULT 0,
  last_team         integer DEFAULT 0,
  last_grab_at      timestamp,
  joined_at         timestamp DEFAULT now(),
  payout_amount     real,
  payout_tx_hash    text,
  payout_status     text
);

-- ── walrus_archives ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS walrus_archives (
  id           SERIAL PRIMARY KEY,
  archive_type text NOT NULL,
  reference_id text NOT NULL,
  blob_id      text,
  data_hash    text,
  metadata     json,
  status       text DEFAULT 'pending',
  created_at   timestamp DEFAULT now()
);

-- ── p2p_bet_offers — extra columns ───────────────────────────────────────────
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_package_id text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS lucky_boost        boolean DEFAULT false;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS lucky_multiplier   real;

-- ── p2p_parlay_offers — extra columns ────────────────────────────────────────
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_package_id text;

-- ── revenue_tracker — extra columns ─────────────────────────────────────────
ALTER TABLE revenue_tracker ADD COLUMN IF NOT EXISTS p2p_fee_sui   double precision DEFAULT 0;
ALTER TABLE revenue_tracker ADD COLUMN IF NOT EXISTS p2p_fee_sbets double precision DEFAULT 0;
ALTER TABLE revenue_tracker ADD COLUMN IF NOT EXISTS p2p_volume    double precision DEFAULT 0;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_hot_potato_games_status   ON hot_potato_games(status);
CREATE INDEX IF NOT EXISTS idx_hot_potato_games_event    ON hot_potato_games(event_id);
CREATE INDEX IF NOT EXISTS idx_hot_potato_grabs_game     ON hot_potato_grabs(game_id);
CREATE INDEX IF NOT EXISTS idx_hot_potato_players_game   ON hot_potato_players(game_id);
CREATE INDEX IF NOT EXISTS idx_hot_potato_players_wallet ON hot_potato_players(wallet);
CREATE INDEX IF NOT EXISTS idx_walrus_archives_ref       ON walrus_archives(reference_id);
CREATE INDEX IF NOT EXISTS idx_walrus_archives_type      ON walrus_archives(archive_type);

SELECT 'railway-migrate-new-tables complete' AS status;
