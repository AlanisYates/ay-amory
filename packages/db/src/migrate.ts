import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { db } from './index'

/**
 * Apply the committed versioned migrations in packages/db/drizzle/.
 * Each migration runs once (tracked in __drizzle_migrations); safe on every boot.
 * Fresh databases are built by 0000_baseline; pre-existing databases adopt it
 * as a no-op (IF NOT EXISTS) and get column-level healing from ensureSchema().
 */
export async function runMigrations(): Promise<void> {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle')
  await migrate(db, { migrationsFolder })
}
