import { db, runMigrations } from '@ay-armory/db'
import { sql } from 'drizzle-orm'

/**
 * Boot-time migration: versioned drizzle migrations first, then idempotent
 * healing for pre-migration databases (e.g. volumes created before the
 * staged-range-days columns existed). Each half logs and continues on error
 * so boot never crashes — the next restart retries.
 */
export async function runStartupMigrations(): Promise<void> {
  try {
    await runMigrations()
  } catch (err) {
    console.error('[migrate] versioned migrations failed (will retry on next boot):', err)
  }
  try {
    await ensureSchema()
  } catch (err) {
    console.error('[migrate] ensureSchema failed (will retry on next boot):', err)
  }
}

/**
 * Idempotent schema healing for hosts (e.g. OMV docker deploy) whose
 * postgres volume was created before the staged-range-days columns existed.
 * Local dev DBs got these via `drizzle-kit push`, but prod never ran it —
 * so POST /ammo/range-days with { staged: true } (startedAt=null, status,
 * staged_bag) 500s and GET /ammo/range-days can fail the same way.
 *
 * Safe to run on every boot: every statement is IF NOT EXISTS / guarded, and
 * the backfill only touches rows still carrying the fresh-column default.
 */
export async function ensureSchema(): Promise<void> {
  // New columns for the staged lifecycle. Existing rows (all started under the
  // old NOT NULL started_at) get the fresh default first, then backfilled below.
  await db.execute(sql.raw(`ALTER TABLE range_day_sessions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'staged'`))
  await db.execute(sql.raw(`ALTER TABLE range_day_sessions ADD COLUMN IF NOT EXISTS staged_bag JSONB`))
  await db.execute(sql.raw(`ALTER TABLE range_day_sessions ALTER COLUMN started_at DROP NOT NULL`))

  // Backfill old rows that inherited status='staged' from the column default:
  // finished stays finished, everything else that clocked in is live.
  // Legit staged packs (started_at IS NULL, ended_at IS NULL) match neither.
  await db.execute(
    sql.raw(
      `UPDATE range_day_sessions SET status = 'ended' WHERE ended_at IS NOT NULL AND status = 'staged'`,
    ),
  )
  await db.execute(
    sql.raw(
      `UPDATE range_day_sessions SET status = 'active' WHERE ended_at IS NULL AND started_at IS NOT NULL AND status = 'staged'`,
    ),
  )

  await db.execute(sql.raw(`ALTER TABLE range_day_sessions ALTER COLUMN status SET NOT NULL`))
  await db.execute(sql.raw(`ALTER TABLE range_day_sessions ALTER COLUMN status SET DEFAULT 'staged'`))

  // Gun-location flow (load/shoot/return) needs this; harmless if present.
  await db.execute(sql.raw(`ALTER TABLE ammo_ledger_entries ADD COLUMN IF NOT EXISTS weapon_id INTEGER`))

  // Foreign keys (kept out of the baseline migration file because the
  // migrator splits statements on semicolons; these run as single statements).
  for (const ddl of FK_CONSTRAINTS) {
    await db.execute(
      sql.raw(`DO $migrate$ BEGIN ${ddl}; EXCEPTION WHEN duplicate_object THEN NULL; END $migrate$;`),
    )
  }
}

const FK_CONSTRAINTS = [
  `ALTER TABLE "ammo_ledger_entries" ADD CONSTRAINT "ammo_ledger_entries_transaction_id_ammo_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ammo_transactions"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "ammo_ledger_entries" ADD CONSTRAINT "ammo_ledger_entries_ammo_type_id_ammo_types_id_fk" FOREIGN KEY ("ammo_type_id") REFERENCES "public"."ammo_types"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "ammo_ledger_entries" ADD CONSTRAINT "ammo_ledger_entries_weapon_id_weapons_id_fk" FOREIGN KEY ("weapon_id") REFERENCES "public"."weapons"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "ammo_transactions" ADD CONSTRAINT "ammo_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "ammo_transactions" ADD CONSTRAINT "ammo_transactions_range_day_session_id_range_day_sessions_id_fk" FOREIGN KEY ("range_day_session_id") REFERENCES "public"."range_day_sessions"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "ammo_types" ADD CONSTRAINT "ammo_types_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "range_day_sessions" ADD CONSTRAINT "range_day_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "range_day_strings" ADD CONSTRAINT "range_day_strings_session_id_range_day_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."range_day_sessions"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "range_day_strings" ADD CONSTRAINT "range_day_strings_transaction_id_ammo_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ammo_transactions"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "range_day_strings" ADD CONSTRAINT "range_day_strings_weapon_id_weapons_id_fk" FOREIGN KEY ("weapon_id") REFERENCES "public"."weapons"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "range_day_strings" ADD CONSTRAINT "range_day_strings_ammo_type_id_ammo_types_id_fk" FOREIGN KEY ("ammo_type_id") REFERENCES "public"."ammo_types"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "range_day_weapons" ADD CONSTRAINT "range_day_weapons_session_id_range_day_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."range_day_sessions"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "range_day_weapons" ADD CONSTRAINT "range_day_weapons_weapon_id_weapons_id_fk" FOREIGN KEY ("weapon_id") REFERENCES "public"."weapons"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "weapon_cleanings" ADD CONSTRAINT "weapon_cleanings_weapon_id_weapons_id_fk" FOREIGN KEY ("weapon_id") REFERENCES "public"."weapons"("id") ON DELETE cascade ON UPDATE no action`,
  `ALTER TABLE "weapon_cleanings" ADD CONSTRAINT "weapon_cleanings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`,
  `ALTER TABLE "weapons" ADD CONSTRAINT "weapons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`,
]
