CREATE TABLE "admin_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"revoked" boolean DEFAULT false,
	CONSTRAINT "admin_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "bet_legs" (
	"id" serial PRIMARY KEY NOT NULL,
	"parlay_id" integer,
	"event_id" integer,
	"market_id" integer,
	"outcome_id" integer,
	"odds" real NOT NULL,
	"prediction" text NOT NULL,
	"status" text DEFAULT 'pending',
	"result" text,
	"created_at" timestamp DEFAULT now(),
	"wurlus_leg_id" text,
	"is_winner" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"wallet_address" text,
	"event_id" integer,
	"market_id" integer,
	"outcome_id" integer,
	"bet_amount" real NOT NULL,
	"currency" text DEFAULT 'SUI',
	"odds" real NOT NULL,
	"prediction" text NOT NULL,
	"potential_payout" real NOT NULL,
	"status" text DEFAULT 'pending',
	"result" text,
	"payout" real,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"bet_type" text DEFAULT 'single',
	"cash_out_available" boolean DEFAULT false,
	"cash_out_amount" real,
	"cash_out_at" timestamp,
	"parlay_id" integer,
	"wurlus_bet_id" text,
	"bet_object_id" text,
	"tx_hash" text,
	"settlement_tx_hash" text,
	"platform_fee" real,
	"network_fee" real,
	"fee_currency" text DEFAULT 'SUI',
	"event_name" text,
	"external_event_id" text,
	"home_team" text,
	"away_team" text,
	"winnings_withdrawn" boolean DEFAULT false,
	"walrus_blob_id" text,
	"walrus_receipt_data" text,
	"nft_mint_tx" text,
	"gifted_to" text,
	"gifted_from" text
);
--> statement-breakpoint
CREATE TABLE "betting_promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"total_bet_usd" real DEFAULT 0 NOT NULL,
	"bonuses_awarded" integer DEFAULT 0 NOT NULL,
	"bonus_balance" real DEFAULT 0 NOT NULL,
	"promotion_start" timestamp NOT NULL,
	"promotion_end" timestamp NOT NULL,
	"last_bet_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer,
	"sender_wallet" text NOT NULL,
	"encrypted_content" text NOT NULL,
	"message_type" text DEFAULT 'text',
	"reply_to_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer,
	"name" text NOT NULL,
	"room_type" text DEFAULT 'match',
	"member_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport_id" integer,
	"league_name" text NOT NULL,
	"league_slug" text NOT NULL,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"start_time" timestamp NOT NULL,
	"home_odds" real,
	"draw_odds" real,
	"away_odds" real,
	"is_live" boolean DEFAULT false,
	"score" text,
	"status" text DEFAULT 'upcoming',
	"metadata" json,
	"wurlus_event_id" text,
	"wurlus_market_ids" text[],
	"created_on_chain" boolean DEFAULT false,
	"event_hash" text,
	"provider_id" text
);
--> statement-breakpoint
CREATE TABLE "hot_potato_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_object_id" text,
	"event_id" text NOT NULL,
	"team_a" text NOT NULL,
	"team_b" text NOT NULL,
	"sport_name" text,
	"league_name" text,
	"match_time" timestamp,
	"pot_amount" real DEFAULT 0,
	"currency" text DEFAULT 'SBETS',
	"min_grab_amount" real DEFAULT 100,
	"current_holder" text,
	"holder_team" integer DEFAULT 0,
	"grab_count" integer DEFAULT 0,
	"player_count" integer DEFAULT 0,
	"status" text DEFAULT 'active',
	"timer_duration_ms" integer DEFAULT 60000,
	"explosion_time_ms" text,
	"game_deadline_ms" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"settled_at" timestamp,
	"winning_team" integer,
	"tx_hash" text,
	CONSTRAINT "hot_potato_games_game_object_id_unique" UNIQUE("game_object_id")
);
--> statement-breakpoint
CREATE TABLE "hot_potato_grabs" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"wallet" text NOT NULL,
	"amount" real NOT NULL,
	"team_chosen" integer NOT NULL,
	"grab_number" integer NOT NULL,
	"timer_at_grab" integer,
	"pot_after_grab" real,
	"tx_hash" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hot_potato_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"wallet" text NOT NULL,
	"total_contributed" real DEFAULT 0,
	"grab_count" integer DEFAULT 0,
	"last_team" integer DEFAULT 0,
	"last_grab_at" timestamp,
	"joined_at" timestamp DEFAULT now(),
	"payout_amount" real,
	"payout_tx_hash" text,
	"payout_status" text
);
--> statement-breakpoint
CREATE TABLE "market_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sport_id" integer,
	"description" text,
	"parameters" json,
	"display_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"requires_player_selection" boolean DEFAULT false,
	"requires_score_selection" boolean DEFAULT false,
	"requires_time_selection" boolean DEFAULT false,
	"requires_numeric_value" boolean DEFAULT false,
	"default_value" real,
	"value_unit" text,
	"category" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "market_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer,
	"market_type_id" integer,
	"name" text NOT NULL,
	"market_type" text NOT NULL,
	"status" text DEFAULT 'open',
	"parameters" json,
	"display_order" integer DEFAULT 0,
	"wurlus_market_id" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"settled_at" timestamp,
	"creator_address" text,
	"liquidity_pool" real DEFAULT 0,
	"transaction_hash" text,
	CONSTRAINT "markets_wurlus_market_id_unique" UNIQUE("wurlus_market_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"related_tx_hash" text,
	"notification_type" text DEFAULT 'app',
	"priority" text DEFAULT 'normal'
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer,
	"name" text NOT NULL,
	"odds" real NOT NULL,
	"probability" real,
	"status" text DEFAULT 'active',
	"wurlus_outcome_id" text NOT NULL,
	"transaction_hash" text,
	"is_winner" boolean DEFAULT false,
	CONSTRAINT "outcomes_wurlus_outcome_id_unique" UNIQUE("wurlus_outcome_id")
);
--> statement-breakpoint
CREATE TABLE "p2p_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"challenger_wallet" text NOT NULL,
	"challenged_wallet" text NOT NULL,
	"event_id" integer,
	"event_name" text,
	"prediction" text NOT NULL,
	"amount" real NOT NULL,
	"currency" text DEFAULT 'SBETS',
	"odds" real DEFAULT 2,
	"status" text DEFAULT 'pending',
	"message" text,
	"tx_hash" text,
	"accepted_at" timestamp,
	"resolved_at" timestamp,
	"winner" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "parlays" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"bet_amount" real NOT NULL,
	"total_odds" real NOT NULL,
	"potential_payout" real NOT NULL,
	"status" text DEFAULT 'pending',
	"result" text,
	"payout" real,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"cash_out_available" boolean DEFAULT false,
	"cash_out_amount" real,
	"cash_out_at" timestamp,
	"wurlus_parlay_id" text,
	"tx_hash" text,
	"platform_fee" real,
	"network_fee" real,
	"fee_currency" text DEFAULT 'SUI'
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"image_url" text,
	"type" text NOT NULL,
	"amount" real,
	"code" text,
	"min_deposit" real,
	"rollover_sports" real,
	"rollover_casino" real,
	"start_date" timestamp,
	"end_date" timestamp,
	"is_active" boolean DEFAULT true,
	"wurlus_promotion_id" text,
	"smart_contract_address" text
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_wallet" text NOT NULL,
	"referred_wallet" text NOT NULL,
	"referral_code" text NOT NULL,
	"status" text DEFAULT 'pending',
	"referred_bet_amount" real DEFAULT 0,
	"reward_amount" real DEFAULT 0,
	"reward_currency" text DEFAULT 'USD',
	"created_at" timestamp DEFAULT now(),
	"qualified_at" timestamp,
	"rewarded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "revenue_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"week_start" timestamp NOT NULL,
	"sbets_balance" real NOT NULL,
	"share_percentage" real NOT NULL,
	"claim_amount" real NOT NULL,
	"claim_amount_sbets" real DEFAULT 0,
	"tx_hash" text NOT NULL,
	"tx_hash_sbets" text,
	"claim_type" text DEFAULT 'holder',
	"claimed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settled_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_event_id" text NOT NULL,
	"home_team" text,
	"away_team" text,
	"home_score" integer,
	"away_score" integer,
	"winner" text,
	"settled_at" timestamp DEFAULT now(),
	"bets_settled" integer DEFAULT 0,
	CONSTRAINT "settled_events_external_event_id_unique" UNIQUE("external_event_id")
);
--> statement-breakpoint
CREATE TABLE "settlement_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_wallet" text NOT NULL,
	"bet_id" integer,
	"event_name" text,
	"result" text NOT NULL,
	"payout_amount" real,
	"currency" text,
	"tx_hash" text,
	"encrypted_proof" text,
	"read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "social_challenge_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"challenge_id" integer NOT NULL,
	"wallet" text NOT NULL,
	"side" text DEFAULT 'for' NOT NULL,
	"tx_hash" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "social_challenge_participants_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "social_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_wallet" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"stake_amount" real NOT NULL,
	"currency" text DEFAULT 'SUI' NOT NULL,
	"max_participants" integer DEFAULT 10,
	"current_participants" integer DEFAULT 1,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "social_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "social_follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"follower_wallet" text NOT NULL,
	"following_wallet" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "social_prediction_bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"prediction_id" integer NOT NULL,
	"wallet" text NOT NULL,
	"side" text NOT NULL,
	"amount" real NOT NULL,
	"currency" text DEFAULT 'SBETS' NOT NULL,
	"tx_id" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "social_prediction_bets_tx_id_unique" UNIQUE("tx_id")
);
--> statement-breakpoint
CREATE TABLE "social_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_wallet" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'other' NOT NULL,
	"end_date" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"total_yes_amount" real DEFAULT 0,
	"total_no_amount" real DEFAULT 0,
	"total_participants" integer DEFAULT 0,
	"resolved_outcome" text,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sports" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"icon" text,
	"wurlus_sport_id" text,
	"is_active" boolean DEFAULT true,
	"provider_id" text,
	CONSTRAINT "sports_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "used_tx_hashes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"wallet" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "used_tx_hashes_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "user_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_address" text NOT NULL,
	"daily_limit" real,
	"weekly_limit" real,
	"monthly_limit" real,
	"daily_spent" real DEFAULT 0,
	"weekly_spent" real DEFAULT 0,
	"monthly_spent" real DEFAULT 0,
	"last_reset_daily" timestamp DEFAULT now(),
	"last_reset_weekly" timestamp DEFAULT now(),
	"last_reset_monthly" timestamp DEFAULT now(),
	"self_exclusion_until" timestamp,
	"session_reminder_minutes" integer DEFAULT 60,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_limits_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text,
	"wallet_address" text,
	"wallet_fingerprint" text,
	"wallet_type" text DEFAULT 'Sui',
	"balance" real DEFAULT 0,
	"sui_balance" real DEFAULT 0,
	"sbets_balance" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"wurlus_profile_id" text,
	"wurlus_registered" boolean DEFAULT false,
	"wurlus_profile_created_at" timestamp,
	"last_login_at" timestamp,
	"free_bet_balance" real DEFAULT 0,
	"welcome_bonus_claimed" boolean DEFAULT false,
	"loyalty_points" integer DEFAULT 0,
	"total_bet_volume" real DEFAULT 0,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_wallet_address_unique" UNIQUE("wallet_address"),
	CONSTRAINT "users_wallet_fingerprint_unique" UNIQUE("wallet_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "wurlus_dividends" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"wallet_address" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"dividend_amount" real NOT NULL,
	"status" text DEFAULT 'pending',
	"claimed_at" timestamp,
	"claim_tx_hash" text,
	"platform_fee" real
);
--> statement-breakpoint
CREATE TABLE "wurlus_staking" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"wallet_address" text NOT NULL,
	"amount_staked" real NOT NULL,
	"staking_date" timestamp DEFAULT now(),
	"unstaking_date" timestamp,
	"is_active" boolean DEFAULT true,
	"tx_hash" text,
	"locked_until" timestamp,
	"reward_rate" real,
	"accumulated_rewards" real DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "wurlus_wallet_operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"wallet_address" text NOT NULL,
	"operation_type" text NOT NULL,
	"amount" real NOT NULL,
	"tx_hash" text NOT NULL,
	"status" text DEFAULT 'completed',
	"timestamp" timestamp DEFAULT now(),
	"metadata" json
);
--> statement-breakpoint
CREATE TABLE "zklogin_salts" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"salt" text NOT NULL,
	"sui_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_parlay_id_parlays_id_fk" FOREIGN KEY ("parlay_id") REFERENCES "public"."parlays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_parlay_id_parlays_id_fk" FOREIGN KEY ("parlay_id") REFERENCES "public"."parlays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hot_potato_grabs" ADD CONSTRAINT "hot_potato_grabs_game_id_hot_potato_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."hot_potato_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hot_potato_players" ADD CONSTRAINT "hot_potato_players_game_id_hot_potato_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."hot_potato_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_types" ADD CONSTRAINT "market_types_sport_id_sports_id_fk" FOREIGN KEY ("sport_id") REFERENCES "public"."sports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_market_type_id_market_types_id_fk" FOREIGN KEY ("market_type_id") REFERENCES "public"."market_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_challenges" ADD CONSTRAINT "p2p_challenges_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlays" ADD CONSTRAINT "parlays_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_messages" ADD CONSTRAINT "settlement_messages_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wurlus_dividends" ADD CONSTRAINT "wurlus_dividends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wurlus_staking" ADD CONSTRAINT "wurlus_staking_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wurlus_wallet_operations" ADD CONSTRAINT "wurlus_wallet_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;