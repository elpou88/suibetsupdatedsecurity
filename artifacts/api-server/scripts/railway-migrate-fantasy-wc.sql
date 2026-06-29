SET client_min_messages = WARNING;
-- ================================================================
-- SuiBets: Fantasy WC + Feature-Complete P2P Migration
-- Run this in Railway's PostgreSQL console (Data → Query).
-- ALL statements are idempotent — safe to re-run on any DB.
-- Generated: 2026-06-06
-- ================================================================

-- ── 1. fantasy_teams (World Cup XI) ──────────────────────────────
CREATE TABLE IF NOT EXISTS fantasy_teams (
  id              serial PRIMARY KEY,
  wallet_address  text NOT NULL UNIQUE,
  team_name       text NOT NULL DEFAULT 'My World Cup XI',
  starter_ids     text[] NOT NULL DEFAULT '{}',
  bench_ids       text[] NOT NULL DEFAULT '{}',
  captain_id      text NOT NULL DEFAULT '',
  total_points    integer NOT NULL DEFAULT 0,
  locked          boolean NOT NULL DEFAULT false,
  fee_paid        boolean NOT NULL DEFAULT false,
  fee_tx_hash     text,
  dev_bypass      boolean NOT NULL DEFAULT false,
  created_at      timestamp DEFAULT now(),
  updated_at      timestamp DEFAULT now()
);

-- Ensure all columns exist in case table was created in an older form
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS team_name    text NOT NULL DEFAULT 'My World Cup XI';
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS starter_ids  text[] NOT NULL DEFAULT '{}';
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS bench_ids    text[] NOT NULL DEFAULT '{}';
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS captain_id   text NOT NULL DEFAULT '';
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS total_points integer NOT NULL DEFAULT 0;
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS locked       boolean NOT NULL DEFAULT false;
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS fee_paid     boolean NOT NULL DEFAULT false;
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS fee_tx_hash  text;
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS dev_bypass   boolean NOT NULL DEFAULT false;
ALTER TABLE fantasy_teams ADD COLUMN IF NOT EXISTS updated_at   timestamp DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_fantasy_teams_wallet ON fantasy_teams(wallet_address);

-- ── 2. settled_events (needed for Fantasy H2H settlement scoring) ─
CREATE TABLE IF NOT EXISTS settled_events (
  id                serial PRIMARY KEY,
  external_event_id text NOT NULL,
  event_name        text,
  home_team         text,
  away_team         text,
  home_score        integer,
  away_score        integer,
  winner            text,
  sport_id          integer,
  league_name       text,
  settled_at        timestamp DEFAULT now(),
  raw_data          jsonb
);

ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS external_event_id text;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS event_name        text;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS home_team         text;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS away_team         text;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS home_score        integer;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS away_score        integer;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS winner            text;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS sport_id          integer;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS league_name       text;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS raw_data          jsonb;

CREATE INDEX IF NOT EXISTS idx_settled_events_ext_id ON settled_events(external_event_id);

-- ── 3. event_cursors (Sui event subscription resume) ─────────────
CREATE TABLE IF NOT EXISTS event_cursors (
  id          serial PRIMARY KEY,
  event_type  text NOT NULL UNIQUE,
  cursor      text,
  updated_at  timestamp DEFAULT now()
);

-- ── 4. p2p_bet_offers — new columns (2026-06) ────────────────────
-- DeepBook mirror order tracking
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_client_order_id text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_order_id        text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_order_digest    text;

-- Sui-native feature extensions
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS share_token    text UNIQUE;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS suins_gated    boolean DEFAULT false;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS live_odds      boolean DEFAULT false;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS score_snapshot text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS match_minute   integer;

-- Needed for partial-fill & onchain refund flow (sometimes missing)
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS refund_tx_hash text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS filled_stake   real DEFAULT 0;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS currency       text DEFAULT 'SUI';
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS market_type    text DEFAULT 'match_winner';

-- ── 5. p2p_bet_matches — new columns (2026-06) ───────────────────
-- Walrus immutable receipt archiving
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS walrus_blob_id      text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS walrus_receipt_json  text;
-- Sui checkpoint proof
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS checkpoint_seq      text;

-- ── 6. p2p_parlay_offers — refund_tx_hash (needed for reclaim) ───
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS refund_tx_hash text;

-- ── 7. p2p_challenges — ensure correct types ─────────────────────
-- p2p_challenges.event_id was integer but Fantasy H2H uses text IDs;
-- add a text alias column if not already present
ALTER TABLE p2p_challenges ADD COLUMN IF NOT EXISTS event_id_text text;

-- ── 8. settlement_messages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlement_messages (
  id               serial PRIMARY KEY,
  recipient_wallet text NOT NULL,
  bet_id           integer,
  event_name       text,
  result           text NOT NULL,
  payout_amount    real,
  currency         text,
  tx_hash          text,
  encrypted_proof  text,
  read             boolean DEFAULT false,
  created_at       timestamp DEFAULT now()
);

ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS bet_id          integer;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS event_name      text;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS payout_amount   real;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS currency        text;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS tx_hash         text;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS encrypted_proof text;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS read            boolean DEFAULT false;

-- ── 9. chat_rooms / chat_messages (encrypted match chat) ─────────
CREATE TABLE IF NOT EXISTS chat_rooms (
  id         serial PRIMARY KEY,
  event_id   text NOT NULL UNIQUE,
  event_name text,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          serial PRIMARY KEY,
  room_id     integer NOT NULL REFERENCES chat_rooms(id),
  sender      text NOT NULL,
  ciphertext  text NOT NULL,
  created_at  timestamp DEFAULT now()
);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS ciphertext text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender     text;

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id);

-- ── 10. p2p_volume_stats ─────────────────────────────────────────
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

-- ── 11. Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_status      ON p2p_bet_offers(status);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_creator     ON p2p_bet_offers(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_event       ON p2p_bet_offers(event_id);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_market_type ON p2p_bet_offers(market_type);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_matches_offer      ON p2p_bet_matches(offer_id);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_matches_taker      ON p2p_bet_matches(taker_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_offers_status   ON p2p_parlay_offers(status);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_offers_creator  ON p2p_parlay_offers(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_legs_parlay     ON p2p_parlay_legs(parlay_offer_id);

-- ── Verification query (check column counts) ──────────────────────
SELECT table_name, COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_name IN (
  'fantasy_teams',
  'settled_events',
  'event_cursors',
  'p2p_bet_offers',
  'p2p_bet_matches',
  'p2p_parlay_offers',
  'p2p_parlay_legs',
  'p2p_volume_stats',
  'settlement_messages',
  'chat_rooms',
  'chat_messages'
)
  AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;
