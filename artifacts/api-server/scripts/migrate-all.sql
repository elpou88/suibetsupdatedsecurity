SET client_min_messages = WARNING;
-- ================================================================
-- SuiBets: COMPLETE schema migration — Railway / any PostgreSQL
-- SAFE TO RE-RUN — every statement uses CREATE TABLE IF NOT EXISTS
-- or ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- Generated: 2026-06-11
-- ================================================================

-- ── 1. users ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                       serial PRIMARY KEY,
  username                 text NOT NULL UNIQUE,
  password                 text NOT NULL,
  email                    text,
  wallet_address           text UNIQUE,
  wallet_fingerprint       text UNIQUE,
  wallet_type              text DEFAULT 'Sui',
  balance                  real DEFAULT 0,
  sui_balance              real DEFAULT 0,
  sbets_balance            real DEFAULT 0,
  created_at               timestamp DEFAULT now(),
  wurlus_profile_id        text,
  wurlus_registered        boolean DEFAULT false,
  wurlus_profile_created_at timestamp,
  last_login_at            timestamp,
  free_bet_balance         real DEFAULT 0,
  welcome_bonus_claimed    boolean DEFAULT false,
  loyalty_points           integer DEFAULT 0,
  total_bet_volume         real DEFAULT 0
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address         text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_fingerprint     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_type            text DEFAULT 'Sui';
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance                real DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sui_balance            real DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sbets_balance          real DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wurlus_profile_id      text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wurlus_registered      boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wurlus_profile_created_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at          timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_bet_balance       real DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_bonus_claimed  boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_points         integer DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_bet_volume       real DEFAULT 0;

-- ── 2. sports ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sports (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  icon        text,
  wurlus_sport_id text,
  is_active   boolean DEFAULT true,
  provider_id text
);

ALTER TABLE sports ADD COLUMN IF NOT EXISTS wurlus_sport_id text;
ALTER TABLE sports ADD COLUMN IF NOT EXISTS is_active       boolean DEFAULT true;
ALTER TABLE sports ADD COLUMN IF NOT EXISTS provider_id     text;

-- ── 3. market_types ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_types (
  id                         serial PRIMARY KEY,
  code                       text NOT NULL UNIQUE,
  name                       text NOT NULL,
  sport_id                   integer REFERENCES sports(id),
  description                text,
  parameters                 jsonb,
  display_order              integer DEFAULT 0,
  is_active                  boolean DEFAULT true,
  requires_player_selection  boolean DEFAULT false,
  requires_score_selection   boolean DEFAULT false,
  requires_time_selection    boolean DEFAULT false,
  requires_numeric_value     boolean DEFAULT false,
  default_value              real,
  value_unit                 text,
  category                   text,
  created_at                 timestamp DEFAULT now()
);

ALTER TABLE market_types ADD COLUMN IF NOT EXISTS sport_id                  integer;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS description               text;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS parameters                jsonb;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS display_order             integer DEFAULT 0;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS is_active                 boolean DEFAULT true;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS requires_player_selection boolean DEFAULT false;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS requires_score_selection  boolean DEFAULT false;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS requires_time_selection   boolean DEFAULT false;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS requires_numeric_value    boolean DEFAULT false;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS default_value             real;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS value_unit                text;
ALTER TABLE market_types ADD COLUMN IF NOT EXISTS category                  text;

-- ── 4. events ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id               serial PRIMARY KEY,
  sport_id         integer REFERENCES sports(id),
  league_name      text NOT NULL,
  league_slug      text NOT NULL,
  home_team        text NOT NULL,
  away_team        text NOT NULL,
  start_time       timestamp NOT NULL,
  home_odds        real,
  draw_odds        real,
  away_odds        real,
  is_live          boolean DEFAULT false,
  score            text,
  status           text DEFAULT 'upcoming',
  metadata         jsonb,
  wurlus_event_id  text,
  wurlus_market_ids text[],
  created_on_chain boolean DEFAULT false,
  event_hash       text,
  provider_id      text
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS sport_id          integer;
ALTER TABLE events ADD COLUMN IF NOT EXISTS home_odds         real;
ALTER TABLE events ADD COLUMN IF NOT EXISTS draw_odds         real;
ALTER TABLE events ADD COLUMN IF NOT EXISTS away_odds         real;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_live           boolean DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS score             text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS status            text DEFAULT 'upcoming';
ALTER TABLE events ADD COLUMN IF NOT EXISTS metadata          jsonb;
ALTER TABLE events ADD COLUMN IF NOT EXISTS wurlus_event_id   text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS wurlus_market_ids text[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS created_on_chain  boolean DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_hash        text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS provider_id       text;

-- ── 5. markets ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS markets (
  id               serial PRIMARY KEY,
  event_id         integer REFERENCES events(id),
  market_type_id   integer REFERENCES market_types(id),
  name             text NOT NULL,
  market_type      text NOT NULL,
  status           text DEFAULT 'open',
  parameters       jsonb,
  display_order    integer DEFAULT 0,
  wurlus_market_id text NOT NULL,
  created_at       timestamp DEFAULT now(),
  settled_at       timestamp,
  creator_address  text,
  liquidity_pool   real DEFAULT 0,
  transaction_hash text
);

-- Unique constraint on wurlus_market_id — add only if not already there
DO $$ BEGIN
  ALTER TABLE markets ADD CONSTRAINT markets_wurlus_market_id_unique UNIQUE (wurlus_market_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

ALTER TABLE markets ADD COLUMN IF NOT EXISTS event_id        integer;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS market_type_id  integer;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS parameters      jsonb;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS display_order   integer DEFAULT 0;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS settled_at      timestamp;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS creator_address text;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS liquidity_pool  real DEFAULT 0;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS transaction_hash text;

-- ── 6. outcomes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outcomes (
  id                  serial PRIMARY KEY,
  market_id           integer REFERENCES markets(id),
  name                text NOT NULL,
  odds                real NOT NULL,
  probability         real,
  status              text DEFAULT 'active',
  wurlus_outcome_id   text NOT NULL,
  transaction_hash    text,
  is_winner           boolean DEFAULT false
);

DO $$ BEGIN
  ALTER TABLE outcomes ADD CONSTRAINT outcomes_wurlus_outcome_id_unique UNIQUE (wurlus_outcome_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS market_id        integer;
ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS probability      real;
ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS transaction_hash text;
ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS is_winner        boolean DEFAULT false;

-- ── 7. parlays ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parlays (
  id                serial PRIMARY KEY,
  user_id           integer REFERENCES users(id),
  bet_amount        real NOT NULL,
  total_odds        real NOT NULL,
  potential_payout  real NOT NULL,
  status            text DEFAULT 'pending',
  result            text,
  payout            real,
  settled_at        timestamp,
  created_at        timestamp DEFAULT now(),
  cash_out_available boolean DEFAULT false,
  cash_out_amount   real,
  cash_out_at       timestamp,
  wurlus_parlay_id  text,
  tx_hash           text,
  platform_fee      real,
  network_fee       real,
  fee_currency      text DEFAULT 'SUI'
);

ALTER TABLE parlays ADD COLUMN IF NOT EXISTS cash_out_available boolean DEFAULT false;
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS cash_out_amount   real;
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS cash_out_at       timestamp;
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS wurlus_parlay_id  text;
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS tx_hash           text;
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS platform_fee      real;
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS network_fee       real;
ALTER TABLE parlays ADD COLUMN IF NOT EXISTS fee_currency      text DEFAULT 'SUI';

-- ── 8. bets ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bets (
  id                  serial PRIMARY KEY,
  user_id             integer REFERENCES users(id),
  wallet_address      text,
  event_id            integer REFERENCES events(id),
  market_id           integer REFERENCES markets(id),
  outcome_id          integer REFERENCES outcomes(id),
  bet_amount          real NOT NULL,
  currency            text DEFAULT 'SUI',
  odds                real NOT NULL,
  prediction          text NOT NULL,
  potential_payout    real NOT NULL,
  status              text DEFAULT 'pending',
  result              text,
  payout              real,
  settled_at          timestamp,
  created_at          timestamp DEFAULT now(),
  bet_type            text DEFAULT 'single',
  cash_out_available  boolean DEFAULT false,
  cash_out_amount     real,
  cash_out_at         timestamp,
  parlay_id           integer REFERENCES parlays(id),
  wurlus_bet_id       text,
  bet_object_id       text,
  tx_hash             text,
  settlement_tx_hash  text,
  platform_fee        real,
  network_fee         real,
  fee_currency        text DEFAULT 'SUI',
  event_name          text,
  external_event_id   text,
  home_team           text,
  away_team           text,
  winnings_withdrawn  boolean DEFAULT false,
  walrus_blob_id      text,
  walrus_receipt_data text,
  nft_mint_tx         text,
  gifted_to           text,
  gifted_from         text
);

ALTER TABLE bets ADD COLUMN IF NOT EXISTS wallet_address      text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS currency            text DEFAULT 'SUI';
ALTER TABLE bets ADD COLUMN IF NOT EXISTS bet_type            text DEFAULT 'single';
ALTER TABLE bets ADD COLUMN IF NOT EXISTS cash_out_available  boolean DEFAULT false;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS cash_out_amount     real;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS cash_out_at         timestamp;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS parlay_id           integer;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS wurlus_bet_id       text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS bet_object_id       text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS tx_hash             text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS settlement_tx_hash  text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS platform_fee        real;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS network_fee         real;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS fee_currency        text DEFAULT 'SUI';
ALTER TABLE bets ADD COLUMN IF NOT EXISTS event_name          text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS external_event_id   text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS home_team           text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS away_team           text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS winnings_withdrawn  boolean DEFAULT false;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS walrus_blob_id      text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS walrus_receipt_data text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS nft_mint_tx         text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS gifted_to           text;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS gifted_from         text;

-- ── 9. bet_legs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bet_legs (
  id           serial PRIMARY KEY,
  parlay_id    integer REFERENCES parlays(id),
  event_id     integer REFERENCES events(id),
  market_id    integer REFERENCES markets(id),
  outcome_id   integer REFERENCES outcomes(id),
  odds         real NOT NULL,
  prediction   text NOT NULL,
  status       text DEFAULT 'pending',
  result       text,
  created_at   timestamp DEFAULT now(),
  wurlus_leg_id text,
  is_winner    boolean DEFAULT false
);

ALTER TABLE bet_legs ADD COLUMN IF NOT EXISTS result       text;
ALTER TABLE bet_legs ADD COLUMN IF NOT EXISTS wurlus_leg_id text;
ALTER TABLE bet_legs ADD COLUMN IF NOT EXISTS is_winner    boolean DEFAULT false;

-- ── 10. wurlus_staking ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wurlus_staking (
  id                    serial PRIMARY KEY,
  user_id               integer REFERENCES users(id),
  wallet_address        text NOT NULL,
  amount_staked         real NOT NULL,
  staking_date          timestamp DEFAULT now(),
  unstaking_date        timestamp,
  is_active             boolean DEFAULT true,
  tx_hash               text,
  locked_until          timestamp,
  reward_rate           real,
  accumulated_rewards   real DEFAULT 0
);

ALTER TABLE wurlus_staking ADD COLUMN IF NOT EXISTS locked_until        timestamp;
ALTER TABLE wurlus_staking ADD COLUMN IF NOT EXISTS reward_rate         real;
ALTER TABLE wurlus_staking ADD COLUMN IF NOT EXISTS accumulated_rewards real DEFAULT 0;

-- ── 11. wurlus_dividends ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wurlus_dividends (
  id              serial PRIMARY KEY,
  user_id         integer REFERENCES users(id),
  wallet_address  text NOT NULL,
  period_start    timestamp NOT NULL,
  period_end      timestamp NOT NULL,
  dividend_amount real NOT NULL,
  status          text DEFAULT 'pending',
  claimed_at      timestamp,
  claim_tx_hash   text,
  platform_fee    real
);

ALTER TABLE wurlus_dividends ADD COLUMN IF NOT EXISTS claimed_at    timestamp;
ALTER TABLE wurlus_dividends ADD COLUMN IF NOT EXISTS claim_tx_hash text;
ALTER TABLE wurlus_dividends ADD COLUMN IF NOT EXISTS platform_fee  real;

-- ── 12. wurlus_wallet_operations ──────────────────────────────────
CREATE TABLE IF NOT EXISTS wurlus_wallet_operations (
  id             serial PRIMARY KEY,
  user_id        integer REFERENCES users(id),
  wallet_address text NOT NULL,
  operation_type text NOT NULL,
  amount         real NOT NULL,
  tx_hash        text NOT NULL,
  status         text DEFAULT 'completed',
  timestamp      timestamp DEFAULT now(),
  metadata       jsonb
);

ALTER TABLE wurlus_wallet_operations ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ── 13. promotions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
  id                      serial PRIMARY KEY,
  title                   text NOT NULL,
  description             text NOT NULL,
  image_url               text,
  type                    text NOT NULL,
  amount                  real,
  code                    text,
  min_deposit             real,
  rollover_sports         real,
  rollover_casino         real,
  start_date              timestamp,
  end_date                timestamp,
  is_active               boolean DEFAULT true,
  wurlus_promotion_id     text,
  smart_contract_address  text
);

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS wurlus_promotion_id    text;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS smart_contract_address text;

-- ── 14. notifications ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id                serial PRIMARY KEY,
  user_id           integer REFERENCES users(id),
  title             text NOT NULL,
  message           text NOT NULL,
  is_read           boolean DEFAULT false,
  created_at        timestamp DEFAULT now(),
  related_tx_hash   text,
  notification_type text DEFAULT 'app',
  priority          text DEFAULT 'normal'
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS related_tx_hash   text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type text DEFAULT 'app';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS priority          text DEFAULT 'normal';

-- ── 15. settled_events ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settled_events (
  id                serial PRIMARY KEY,
  external_event_id text NOT NULL,
  home_team         text,
  away_team         text,
  home_score        integer,
  away_score        integer,
  winner            text,
  settled_at        timestamp DEFAULT now(),
  bets_settled      integer DEFAULT 0,
  -- extended columns (from fantasy-wc migration)
  event_name        text,
  sport_id          integer,
  league_name       text,
  raw_data          jsonb
);

DO $$ BEGIN
  ALTER TABLE settled_events ADD CONSTRAINT settled_events_external_event_id_unique UNIQUE (external_event_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS bets_settled integer DEFAULT 0;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS event_name   text;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS sport_id     integer;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS league_name  text;
ALTER TABLE settled_events ADD COLUMN IF NOT EXISTS raw_data     jsonb;

CREATE INDEX IF NOT EXISTS idx_settled_events_ext_id ON settled_events(external_event_id);

-- ── 16. revenue_claims ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_claims (
  id                  serial PRIMARY KEY,
  wallet_address      text NOT NULL,
  week_start          timestamp NOT NULL,
  sbets_balance       real NOT NULL,
  share_percentage    real NOT NULL,
  claim_amount        real NOT NULL,
  claim_amount_sbets  real DEFAULT 0,
  tx_hash             text NOT NULL,
  tx_hash_sbets       text,
  claim_type          text DEFAULT 'holder',
  claimed_at          timestamp DEFAULT now()
);

ALTER TABLE revenue_claims ADD COLUMN IF NOT EXISTS claim_amount_sbets real DEFAULT 0;
ALTER TABLE revenue_claims ADD COLUMN IF NOT EXISTS tx_hash_sbets      text;
ALTER TABLE revenue_claims ADD COLUMN IF NOT EXISTS claim_type         text DEFAULT 'holder';

-- ── 17. betting_promotions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS betting_promotions (
  id               serial PRIMARY KEY,
  wallet_address   text NOT NULL,
  total_bet_usd    real NOT NULL DEFAULT 0,
  bonuses_awarded  integer NOT NULL DEFAULT 0,
  bonus_balance    real NOT NULL DEFAULT 0,
  promotion_start  timestamp NOT NULL,
  promotion_end    timestamp NOT NULL,
  last_bet_at      timestamp,
  created_at       timestamp DEFAULT now()
);

ALTER TABLE betting_promotions ADD COLUMN IF NOT EXISTS last_bet_at timestamp;

-- ── 18. referrals ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                  serial PRIMARY KEY,
  referrer_wallet     text NOT NULL,
  referred_wallet     text NOT NULL,
  referral_code       text NOT NULL,
  status              text DEFAULT 'pending',
  referred_bet_amount real DEFAULT 0,
  reward_amount       real DEFAULT 0,
  reward_currency     text DEFAULT 'USD',
  created_at          timestamp DEFAULT now(),
  qualified_at        timestamp,
  rewarded_at         timestamp
);

ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualified_at timestamp;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS rewarded_at  timestamp;

-- ── 19. user_limits ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_limits (
  id                      serial PRIMARY KEY,
  wallet_address          text NOT NULL UNIQUE,
  daily_limit             real,
  weekly_limit            real,
  monthly_limit           real,
  daily_spent             real DEFAULT 0,
  weekly_spent            real DEFAULT 0,
  monthly_spent           real DEFAULT 0,
  last_reset_daily        timestamp DEFAULT now(),
  last_reset_weekly       timestamp DEFAULT now(),
  last_reset_monthly      timestamp DEFAULT now(),
  self_exclusion_until    timestamp,
  session_reminder_minutes integer DEFAULT 60,
  created_at              timestamp DEFAULT now(),
  updated_at              timestamp DEFAULT now()
);

ALTER TABLE user_limits ADD COLUMN IF NOT EXISTS daily_spent             real DEFAULT 0;
ALTER TABLE user_limits ADD COLUMN IF NOT EXISTS weekly_spent            real DEFAULT 0;
ALTER TABLE user_limits ADD COLUMN IF NOT EXISTS monthly_spent           real DEFAULT 0;
ALTER TABLE user_limits ADD COLUMN IF NOT EXISTS self_exclusion_until    timestamp;
ALTER TABLE user_limits ADD COLUMN IF NOT EXISTS session_reminder_minutes integer DEFAULT 60;
ALTER TABLE user_limits ADD COLUMN IF NOT EXISTS updated_at              timestamp DEFAULT now();

-- ── 20. social_predictions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_predictions (
  id                  serial PRIMARY KEY,
  creator_wallet      text NOT NULL,
  title               text NOT NULL,
  description         text,
  category            text NOT NULL DEFAULT 'other',
  end_date            timestamp NOT NULL,
  status              text NOT NULL DEFAULT 'active',
  total_yes_amount    real DEFAULT 0,
  total_no_amount     real DEFAULT 0,
  total_participants  integer DEFAULT 0,
  resolved_outcome    text,
  created_at          timestamp DEFAULT now(),
  resolved_at         timestamp,
  yes_reserve         real DEFAULT 10000,
  no_reserve          real DEFAULT 10000,
  initial_liquidity   real DEFAULT 10000,
  resolution_source   text DEFAULT 'creator',
  total_volume        real DEFAULT 0,
  creator_resolution  text,
  currency            text NOT NULL DEFAULT 'SBETS',
  onchain_market_id   text,
  home_logo           text,
  away_logo           text,
  league_logo         text,
  event_id            text
);

ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS yes_reserve        real DEFAULT 10000;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS no_reserve         real DEFAULT 10000;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS initial_liquidity  real DEFAULT 10000;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS resolution_source  text DEFAULT 'creator';
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS total_volume       real DEFAULT 0;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS creator_resolution text;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS currency           text DEFAULT 'SBETS';
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS onchain_market_id  text;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS home_logo          text;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS away_logo          text;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS league_logo        text;
ALTER TABLE social_predictions ADD COLUMN IF NOT EXISTS event_id           text;

-- ── 21. social_prediction_bets ────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_prediction_bets (
  id            serial PRIMARY KEY,
  prediction_id integer NOT NULL,
  wallet        text NOT NULL,
  side          text NOT NULL,
  amount        real NOT NULL,
  currency      text NOT NULL DEFAULT 'SBETS',
  tx_id         text UNIQUE,
  created_at    timestamp DEFAULT now(),
  share_price   real,
  shares        real,
  bet_type      text DEFAULT 'buy',
  status        text DEFAULT 'active'
);

ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS share_price real;
ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS shares      real;
ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS bet_type    text DEFAULT 'buy';
ALTER TABLE social_prediction_bets ADD COLUMN IF NOT EXISTS status      text DEFAULT 'active';

-- ── 22. social_challenges ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_challenges (
  id                  serial PRIMARY KEY,
  creator_wallet      text NOT NULL,
  title               text NOT NULL,
  description         text,
  stake_amount        real NOT NULL,
  currency            text NOT NULL DEFAULT 'SUI',
  max_participants    integer DEFAULT 10,
  current_participants integer DEFAULT 1,
  status              text NOT NULL DEFAULT 'open',
  expires_at          timestamp NOT NULL,
  created_at          timestamp DEFAULT now()
);

-- ── 23. social_challenge_participants ─────────────────────────────
CREATE TABLE IF NOT EXISTS social_challenge_participants (
  id           serial PRIMARY KEY,
  challenge_id integer NOT NULL,
  wallet       text NOT NULL,
  side         text NOT NULL DEFAULT 'for',
  tx_hash      text UNIQUE,
  created_at   timestamp DEFAULT now()
);

-- ── 24. social_follows ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_follows (
  id               serial PRIMARY KEY,
  follower_wallet  text NOT NULL,
  following_wallet text NOT NULL,
  created_at       timestamp DEFAULT now()
);

-- ── 25. social_prediction_comments ───────────────────────────────
CREATE TABLE IF NOT EXISTS social_prediction_comments (
  id            serial PRIMARY KEY,
  prediction_id integer NOT NULL,
  wallet        text NOT NULL,
  message       text NOT NULL,
  created_at    timestamp DEFAULT now()
);

-- ── 26. social_chat_messages ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_chat_messages (
  id         serial PRIMARY KEY,
  wallet     text NOT NULL,
  message    text NOT NULL,
  created_at timestamp DEFAULT now()
);

-- ── 27. zklogin_salts ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zklogin_salts (
  id         serial PRIMARY KEY,
  provider   text NOT NULL,
  subject    text NOT NULL,
  salt       text NOT NULL,
  sui_address text,
  created_at timestamp DEFAULT now()
);

ALTER TABLE zklogin_salts ADD COLUMN IF NOT EXISTS sui_address text;

-- ── 28. used_tx_hashes ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS used_tx_hashes (
  id         serial PRIMARY KEY,
  tx_hash    text NOT NULL UNIQUE,
  purpose    text NOT NULL,
  wallet     text,
  created_at timestamp DEFAULT now()
);

ALTER TABLE used_tx_hashes ADD COLUMN IF NOT EXISTS wallet text;

-- ── 29. admin_sessions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  id         serial PRIMARY KEY,
  token      text NOT NULL UNIQUE,
  created_at timestamp DEFAULT now(),
  expires_at timestamp NOT NULL,
  ip_address text,
  revoked    boolean DEFAULT false
);

ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS revoked    boolean DEFAULT false;

-- ── 30. chat_rooms ────────────────────────────────────────────────
-- Note: two versions exist — the ORM schema has integer event_id + room_type,
-- while the fantasy migration used text event_id. We create the richer version
-- and patch with both text and integer variants.
CREATE TABLE IF NOT EXISTS chat_rooms (
  id           serial PRIMARY KEY,
  event_id     text,
  event_id_int integer,
  name         text,
  event_name   text,
  room_type    text DEFAULT 'match',
  member_count integer DEFAULT 0,
  created_at   timestamp DEFAULT now()
);

ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS event_id_int integer;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS event_name   text;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS name         text;
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS room_type    text DEFAULT 'match';
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS member_count integer DEFAULT 0;

-- ── 31. chat_messages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id                serial PRIMARY KEY,
  room_id           integer NOT NULL,
  sender_wallet     text,
  sender            text,
  encrypted_content text,
  ciphertext        text,
  message_type      text DEFAULT 'text',
  reply_to_id       integer,
  created_at        timestamp DEFAULT now()
);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender_wallet     text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS sender            text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS encrypted_content text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS ciphertext        text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message_type      text DEFAULT 'text';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id       integer;

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id);

-- ── 32. p2p_challenges ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS p2p_challenges (
  id                serial PRIMARY KEY,
  challenger_wallet text NOT NULL,
  challenged_wallet text NOT NULL,
  event_id          integer,
  event_id_text     text,
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

ALTER TABLE p2p_challenges ADD COLUMN IF NOT EXISTS event_id_text text;
ALTER TABLE p2p_challenges ADD COLUMN IF NOT EXISTS event_name    text;

-- ── 33. settlement_messages ───────────────────────────────────────
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

ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS bet_id         integer;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS event_name     text;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS payout_amount  real;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS currency       text;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS tx_hash        text;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS encrypted_proof text;
ALTER TABLE settlement_messages ADD COLUMN IF NOT EXISTS read           boolean DEFAULT false;

-- ── 34. p2p_bet_offers ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS p2p_bet_offers (
  id                        serial PRIMARY KEY,
  creator_wallet            text NOT NULL,
  event_id                  text NOT NULL,
  event_name                text NOT NULL,
  home_team                 text NOT NULL,
  away_team                 text NOT NULL,
  league_name               text,
  sport_name                text,
  match_date                timestamp,
  prediction                text NOT NULL,
  market_type               text DEFAULT 'match_winner',
  odds                      real NOT NULL,
  creator_stake             real NOT NULL,
  taker_stake               real NOT NULL,
  currency                  text DEFAULT 'SUI',
  filled_stake              real DEFAULT 0,
  status                    text DEFAULT 'open',
  creator_tx_hash           text,
  expires_at                timestamp NOT NULL,
  created_at                timestamp DEFAULT now(),
  settled_at                timestamp,
  winner                    text,
  platform_fee              real,
  settlement_tx_hash        text,
  onchain_offer_id          text,
  onchain_config_id         text,
  refund_tx_hash            text,
  deepbook_client_order_id  text,
  deepbook_order_id         text,
  deepbook_order_digest     text,
  share_token               text,
  suins_gated               boolean DEFAULT false,
  live_odds                 boolean DEFAULT false,
  score_snapshot            text,
  match_minute              integer
);

-- All columns as ALTER TABLE to patch older versions of the table
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS taker_stake              real;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS market_type              text DEFAULT 'match_winner';
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS league_name              text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS sport_name               text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS home_team                text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS away_team                text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS match_date               timestamp;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS winner                   text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS platform_fee             real;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS settlement_tx_hash       text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS settled_at               timestamp;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_offer_id         text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS onchain_config_id        text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS refund_tx_hash           text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_client_order_id text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_order_id        text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS deepbook_order_digest    text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS share_token              text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS suins_gated              boolean DEFAULT false;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS live_odds                boolean DEFAULT false;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS score_snapshot           text;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS match_minute             integer;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS filled_stake             real DEFAULT 0;
ALTER TABLE p2p_bet_offers ADD COLUMN IF NOT EXISTS currency                 text DEFAULT 'SUI';

-- Partial unique index on share_token (only non-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_p2p_bet_offers_share_token
  ON p2p_bet_offers(share_token)
  WHERE share_token IS NOT NULL;

-- ── 35. p2p_bet_matches ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS p2p_bet_matches (
  id                  serial PRIMARY KEY,
  offer_id            integer NOT NULL REFERENCES p2p_bet_offers(id),
  taker_wallet        text NOT NULL,
  stake               real,
  potential_payout    real,
  status              text DEFAULT 'active',
  taker_tx_hash       text,
  settlement_tx_hash  text,
  settled_at          timestamp,
  created_at          timestamp DEFAULT now(),
  matched_at          timestamp DEFAULT now(),
  taker_fee_rate      real DEFAULT 0.02,
  maker_rebate_rate   real DEFAULT 0,
  net_fee             real,
  actual_payout       real,
  winner              text,
  onchain_match_id    text,
  creator_wallet      text,
  creator_stake       real,
  taker_stake         real,
  platform_fee        real,
  payout_tx_hash      text,
  walrus_blob_id      text,
  walrus_receipt_json text,
  checkpoint_seq      text
);

ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_tx_hash      text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_fee_rate     real DEFAULT 0.02;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS maker_rebate_rate  real DEFAULT 0;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS net_fee            real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS actual_payout      real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS winner             text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS onchain_match_id   text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS creator_wallet     text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS creator_stake      real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS taker_stake        real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS platform_fee       real;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS payout_tx_hash     text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS matched_at         timestamp DEFAULT now();
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS walrus_blob_id     text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS walrus_receipt_json text;
ALTER TABLE p2p_bet_matches ADD COLUMN IF NOT EXISTS checkpoint_seq     text;

-- ── 36. p2p_parlay_offers ─────────────────────────────────────────
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
  onchain_config_id   text,
  refund_tx_hash      text
);

ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS currency          text DEFAULT 'SUI';
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS status            text DEFAULT 'open';
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_wallet      text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_tx_hash     text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS expires_at        timestamp;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS winner            text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS settlement_tx_hash text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS platform_fee      real;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS taker_fee_rate    real DEFAULT 0.02;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS maker_rebate_rate real DEFAULT 0;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS actual_payout     real;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_parlay_id text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS onchain_config_id text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS refund_tx_hash    text;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS settled_at        timestamp;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS legs_won          integer DEFAULT 0;
ALTER TABLE p2p_parlay_offers ADD COLUMN IF NOT EXISTS legs_lost         integer DEFAULT 0;

-- ── 37. p2p_parlay_legs ───────────────────────────────────────────
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

ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS league_name text;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS sport_name  text;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS match_date  timestamp;
ALTER TABLE p2p_parlay_legs ADD COLUMN IF NOT EXISTS settled_at  timestamp;

-- ── 38. event_cursors ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_cursors (
  id         serial PRIMARY KEY,
  event_type text NOT NULL UNIQUE,
  cursor     text,
  updated_at timestamp DEFAULT now()
);

-- ── 39. p2p_volume_stats ──────────────────────────────────────────
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

-- ── 40. fantasy_teams ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fantasy_teams (
  id             serial PRIMARY KEY,
  wallet_address text NOT NULL UNIQUE,
  team_name      text NOT NULL DEFAULT 'My World Cup XI',
  starter_ids    text[] NOT NULL DEFAULT '{}',
  bench_ids      text[] NOT NULL DEFAULT '{}',
  captain_id     text NOT NULL DEFAULT '',
  total_points   integer NOT NULL DEFAULT 0,
  locked         boolean NOT NULL DEFAULT false,
  fee_paid       boolean NOT NULL DEFAULT false,
  fee_tx_hash    text,
  dev_bypass     boolean NOT NULL DEFAULT false,
  created_at     timestamp DEFAULT now(),
  updated_at     timestamp DEFAULT now()
);

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

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_wallet           ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_events_sport           ON events(sport_id);
CREATE INDEX IF NOT EXISTS idx_events_start_time      ON events(start_time);
CREATE INDEX IF NOT EXISTS idx_events_status          ON events(status);
CREATE INDEX IF NOT EXISTS idx_bets_wallet            ON bets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_bets_status            ON bets(status);
CREATE INDEX IF NOT EXISTS idx_bets_ext_event         ON bets(external_event_id);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_status  ON p2p_bet_offers(status);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_creator ON p2p_bet_offers(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_event   ON p2p_bet_offers(event_id);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_offers_mtype   ON p2p_bet_offers(market_type);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_matches_offer  ON p2p_bet_matches(offer_id);
CREATE INDEX IF NOT EXISTS idx_p2p_bet_matches_taker  ON p2p_bet_matches(taker_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_status      ON p2p_parlay_offers(status);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_creator     ON p2p_parlay_offers(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_p2p_parlay_legs_parlay ON p2p_parlay_legs(parlay_offer_id);
CREATE INDEX IF NOT EXISTS idx_fantasy_teams_wallet   ON fantasy_teams(wallet_address);
CREATE INDEX IF NOT EXISTS idx_revenue_claims_wallet  ON revenue_claims(wallet_address);
CREATE INDEX IF NOT EXISTS idx_social_preds_creator   ON social_predictions(creator_wallet);
CREATE INDEX IF NOT EXISTS idx_social_pred_bets_pred  ON social_prediction_bets(prediction_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer     ON referrals(referrer_wallet);
CREATE INDEX IF NOT EXISTS idx_referrals_referred     ON referrals(referred_wallet);

-- ── Verification ──────────────────────────────────────────────────
SELECT table_name, COUNT(*) AS col_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'users','sports','events','markets','market_types','outcomes',
    'bets','parlays','bet_legs',
    'wurlus_staking','wurlus_dividends','wurlus_wallet_operations',
    'promotions','notifications',
    'settled_events','revenue_claims','betting_promotions','referrals','user_limits',
    'social_predictions','social_prediction_bets','social_challenges',
    'social_challenge_participants','social_follows','social_prediction_comments',
    'social_chat_messages','zklogin_salts','used_tx_hashes','admin_sessions',
    'chat_rooms','chat_messages','p2p_challenges','settlement_messages',
    'p2p_bet_offers','p2p_bet_matches','p2p_parlay_offers','p2p_parlay_legs',
    'event_cursors','p2p_volume_stats','fantasy_teams'
  )
GROUP BY table_name
ORDER BY table_name;
