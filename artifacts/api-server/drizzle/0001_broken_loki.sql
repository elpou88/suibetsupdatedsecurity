CREATE TABLE "social_prediction_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"prediction_id" integer NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "social_prediction_bets" ADD COLUMN "share_price" real;--> statement-breakpoint
ALTER TABLE "social_prediction_bets" ADD COLUMN "shares" real;--> statement-breakpoint
ALTER TABLE "social_prediction_bets" ADD COLUMN "bet_type" text DEFAULT 'buy';--> statement-breakpoint
ALTER TABLE "social_prediction_bets" ADD COLUMN "status" text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "yes_reserve" real DEFAULT 10000;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "no_reserve" real DEFAULT 10000;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "initial_liquidity" real DEFAULT 10000;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "resolution_source" text DEFAULT 'creator';--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "total_volume" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "creator_resolution" text;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "currency" text DEFAULT 'SBETS' NOT NULL;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "onchain_market_id" text;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "home_logo" text;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "away_logo" text;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "league_logo" text;--> statement-breakpoint
ALTER TABLE "social_predictions" ADD COLUMN "event_id" text;