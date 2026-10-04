CREATE TABLE IF NOT EXISTS "ammo_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"ammo_type_id" integer NOT NULL,
	"weapon_id" integer,
	"quantity" integer NOT NULL,
	"location" text NOT NULL,
	"is_balancing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ammo_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"note" text,
	"range_day_session_id" integer,
	"occurred_at" timestamp NOT NULL,
	"price" integer,
	"vendor" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ammo_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"caliber" text NOT NULL,
	"grain" integer,
	"brand" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "range_day_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"note" text,
	"status" text DEFAULT 'staged' NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"staged_bag" json
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "range_day_strings" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"weapon_id" integer NOT NULL,
	"ammo_type_id" integer NOT NULL,
	"rounds" integer NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "range_day_weapons" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"weapon_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weapon_cleanings" (
	"id" serial PRIMARY KEY NOT NULL,
	"weapon_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"cleaned_at" timestamp NOT NULL,
	"round_count_at_cleaning" integer NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weapons" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"caliber" text NOT NULL,
	"type" text NOT NULL,
	"serial_number" text,
	"notes" text,
	"cleaning_interval_rounds" integer,
	"cleaning_interval_days" integer,
	"initial_rounds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
