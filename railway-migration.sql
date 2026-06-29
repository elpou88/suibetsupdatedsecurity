-- SuiBets Railway Migration — safe to run multiple times (IF NOT EXISTS)
-- Run this in your Railway PostgreSQL console to create all missing tables.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  email TEXT,
  wallet_address TEXT UNIQUE,
  wallet_fingerprint TEXT UNIQUE,
  wallet_type TEXT DEFAULT 'Sui',
  balance REAL DEFAULT 0,
  sui_balance REAL DEFAULT 0,
  sbets_balance REAL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  wurlus_profile_id TEXT,
  wurlus_registered BOOLEAN DEFAULT FALSE,
  wurlus_profile_created_at TIMESTAMP,
  last_login_at TIMESTAMP,
  free_bet_balance REAL DEFAULT 0,
  welcome_bonus_claimed BOOLEAN DEFAULT FALSE,
  loyalty_points INTEGER DEFAULT 0,
  total_bet_volume REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sports (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT,
  wurlus_sport_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  provider_id TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  sport_id INTEGER REFERENCES sports(id),
  league_name TEXT NOT NULL,
  league_slug TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  home_odds REAL,
  draw_odds REAL,
  away_odds REAL,
  is_live BOOLEAN DEFAULT FALSE,
  score TEXT,
  status TEXT DEFAULT 'upcoming',
  metadata JSON,
  wurlus_event_id TEXT,
  wurlus_market_ids TEXT[],
  created_on_chain BOOLEAN DEFAULT FALSE,
  event_hash TEXT,
  provider_id TEXT
);

CREATE TABLE IF NOT EXISTS market_types (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sport_id INTEGER REFERENCES sports(id),
  description TEXT,
  parameters JSON,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  requires_player_selection BOOLEAN DEFAULT FALSE,
  requires_score_selection BOOLEAN DEFAULT FALSE,
  requires_time_selection BOOLEAN DEFAULT FALSE,
  requires_numeric_value BOOLEAN DEFAULT FALSE,
  default_value REAL,
  value_unit TEXT,
  category TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS markets (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id),
  market_type_id INTEGER REFERENCES market_types(id),
  name TEXT NOT NULL,
  market_type TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  parameters JSON,
  display_order INTEGER DEFAULT 0,
  wurlus_market_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  settled_at TIMESTAMP,
  creator_address TEXT,
  liquidity_pool REAL DEFAULT 0,
  transaction_hash TEXT
);

CREATE TABLE IF NOT EXISTS outcomes (
  id SERIAL PRIMARY KEY,
  market_id INTEGER REFERENCES markets(id),
  name TEXT NOT NULL,
  odds REAL NOT NULL,
  probability REAL,
  status TEXT DEFAULT 'active',
  wurlus_outcome_id TEXT UNIQUE,
  transaction_hash TEXT,
  is_winner BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS parlays (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  bet_amount REAL NOT NULL,
  total_odds REAL NOT NULL,
  potential_payout REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  result TEXT,
  payout REAL,
  settled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  bet_type TEXT DEFAULT 'parlay',
  wurlus_bet_id TEXT,
  bet_object_id TEXT,
  tx_hash TEXT,
  settlement_tx_hash TEXT,
  platform_fee REAL,
  network_fee REAL,
  fee_currency TEXT DEFAULT 'SUI'
);

CREATE TABLE IF NOT EXISTS bets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  wallet_address TEXT,
  event_id INTEGER REFERENCES events(id),
  market_id INTEGER REFERENCES markets(id),
  outcome_id INTEGER REFERENCES outcomes(id),
  bet_amount REAL NOT NULL,
  currency TEXT DEFAULT 'SUI',
  odds REAL NOT NULL,
  prediction TEXT NOT NULL,
  potential_payout REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  result TEXT,
  payout REAL,
  settled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  bet_type TEXT DEFAULT 'single',
  cash_out_available BOOLEAN DEFAULT FALSE,
  cash_out_amount REAL,
  cash_out_at TIMESTAMP,
  parlay_id INTEGER REFERENCES parlays(id),
  wurlus_bet_id TEXT,
  bet_object_id TEXT,
  tx_hash TEXT,
  settlement_tx_hash TEXT,
  platform_fee REAL,
  network_fee REAL,
  fee_currency TEXT DEFAULT 'SUI',
  event_name TEXT,
  external_event_id TEXT,
  home_team TEXT,
  away_team TEXT,
  league_name TEXT,
  sport_name TEXT,
  match_date TIMESTAMP,
  winnings_withdrawn BOOLEAN DEFAULT FALSE,
  walrus_blob_id TEXT,
  walrus_receipt_data TEXT,
  nft_mint_tx TEXT,
  gifted_to TEXT,
  gifted_from TEXT
);

CREATE TABLE IF NOT EXISTS bet_legs (
  id SERIAL PRIMARY KEY,
  parlay_id INTEGER REFERENCES parlays(id),
  event_id INTEGER REFERENCES events(id),
  market_id INTEGER REFERENCES markets(id),
  outcome_id INTEGER REFERENCES outcomes(id),
  odds REAL NOT NULL,
  prediction TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  result TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  wurlus_leg_id TEXT,
  is_winner BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS wurlus_staking (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  wallet_address TEXT NOT NULL,
  amount_staked REAL NOT NULL,
  staking_date TIMESTAMP DEFAULT NOW(),
  unstaking_date TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  tx_hash TEXT,
  locked_until TIMESTAMP,
  reward_rate REAL,
  accumulated_rewards REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wurlus_dividends (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  wallet_address TEXT NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  dividend_amount REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  claimed_at TIMESTAMP,
  claim_tx_hash TEXT,
  platform_fee REAL
);

CREATE TABLE IF NOT EXISTS wurlus_wallet_operations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  wallet_address TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  amount REAL NOT NULL,
  tx_hash TEXT NOT NULL,
  status TEXT DEFAULT 'completed',
  timestamp TIMESTAMP DEFAULT NOW(),
  metadata JSON
);

CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  type TEXT NOT NULL,
  amount REAL,
  code TEXT,
  min_deposit REAL,
  rollover_sports REAL,
  rollover_casino REAL,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  wurlus_promotion_id TEXT,
  smart_contract_address TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  related_tx_hash TEXT,
  notification_type TEXT DEFAULT 'app',
  priority TEXT DEFAULT 'normal'
);

CREATE TABLE IF NOT EXISTS settled_events (
  id SERIAL PRIMARY KEY,
  external_event_id TEXT NOT NULL UNIQUE,
  home_team TEXT,
  away_team TEXT,
  home_score INTEGER,
  away_score INTEGER,
  winner TEXT,
  settled_at TIMESTAMP DEFAULT NOW(),
  bets_settled INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS revenue_claims (
  id SERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  week_start TIMESTAMP NOT NULL,
  sbets_balance REAL NOT NULL,
  share_percentage REAL NOT NULL,
  claim_amount REAL NOT NULL,
  claim_amount_sbets REAL DEFAULT 0,
  tx_hash TEXT NOT NULL,
  tx_hash_sbets TEXT,
  claim_type TEXT DEFAULT 'holder',
  claimed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS betting_promotions (
  id SERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  total_bet_usd REAL NOT NULL DEFAULT 0,
  bonuses_awarded INTEGER NOT NULL DEFAULT 0,
  bonus_balance REAL NOT NULL DEFAULT 0,
  promotion_start TIMESTAMP NOT NULL,
  promotion_end TIMESTAMP NOT NULL,
  last_bet_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_wallet TEXT NOT NULL,
  referred_wallet TEXT NOT NULL,
  referral_code TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  referred_bet_amount REAL DEFAULT 0,
  reward_amount REAL DEFAULT 0,
  reward_currency TEXT DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT NOW(),
  qualified_at TIMESTAMP,
  rewarded_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_limits (
  id SERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  daily_limit REAL,
  weekly_limit REAL,
  monthly_limit REAL,
  daily_spent REAL DEFAULT 0,
  weekly_spent REAL DEFAULT 0,
  monthly_spent REAL DEFAULT 0,
  last_reset_daily TIMESTAMP DEFAULT NOW(),
  last_reset_weekly TIMESTAMP DEFAULT NOW(),
  last_reset_monthly TIMESTAMP DEFAULT NOW(),
  self_exclusion_until TIMESTAMP,
  session_reminder_minutes INTEGER DEFAULT 60,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zklogin_salts (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  salt TEXT NOT NULL,
  sui_address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_chat_messages (
  id SERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tables that may already exist on Railway (safe due to IF NOT EXISTS):
CREATE TABLE IF NOT EXISTS used_tx_hashes (
  id SERIAL PRIMARY KEY,
  tx_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL,
  wallet TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  session_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS buyback_state (
  id SERIAL PRIMARY KEY,
  total_sui_spent REAL DEFAULT 0,
  total_sbets_bought REAL DEFAULT 0,
  total_swaps INTEGER DEFAULT 0,
  total_burns INTEGER DEFAULT 0,
  total_buyback_sui REAL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS revenue_tracker (
  id SERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  sui_amount REAL DEFAULT 0,
  sbets_amount REAL DEFAULT 0,
  source TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS treasury_audit_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  amount REAL,
  currency TEXT,
  tx_hash TEXT,
  wallet TEXT,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

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
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS social_prediction_bets (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  side TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SBETS',
  tx_id TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_prediction_comments (
  id SERIAL PRIMARY KEY,
  prediction_id INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

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
);

CREATE TABLE IF NOT EXISTS social_challenge_participants (
  id SERIAL PRIMARY KEY,
  challenge_id INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'for',
  tx_hash TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_follows (
  id SERIAL PRIMARY KEY,
  follower_wallet TEXT NOT NULL,
  following_wallet TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hot_potato_games (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'waiting',
  pot_amount REAL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hot_potato_players (
  id SERIAL PRIMARY KEY,
  game_id INTEGER,
  wallet TEXT NOT NULL,
  joined_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hot_potato_grabs (
  id SERIAL PRIMARY KEY,
  game_id INTEGER,
  wallet TEXT NOT NULL,
  grabbed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS p2p_challenges (
  id SERIAL PRIMARY KEY,
  creator_wallet TEXT NOT NULL,
  opponent_wallet TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_rooms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  room_id INTEGER,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_messages (
  id SERIAL PRIMARY KEY,
  bet_id TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
