import { pgTable, text, serial, timestamp, integer, boolean } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const ammoTypes = pgTable('ammo_types', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  caliber: text('caliber').notNull(),
  grain: integer('grain'),
  brand: text('brand'),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const rangeDaySessions = pgTable('range_day_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  note: text('note'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
})

export const ammoTransactions = pgTable('ammo_transactions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  type: text('type').notNull(), // acquisition | expenditure | transfer | adjustment | range_day_start | range_day_end
  note: text('note'),
  rangeDaySessionId: integer('range_day_session_id').references(() => rangeDaySessions.id),
  occurredAt: timestamp('occurred_at').notNull(),
  price: integer('price'),
  vendor: text('vendor'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const ammoLedgerEntries = pgTable('ammo_ledger_entries', {
  id: serial('id').primaryKey(),
  transactionId: integer('transaction_id').notNull().references(() => ammoTransactions.id),
  ammoTypeId: integer('ammo_type_id').notNull().references(() => ammoTypes.id),
  weaponId: integer('weapon_id').references(() => weapons.id),
  quantity: integer('quantity').notNull(),
  location: text('location').notNull(), // storage | bag | equity | gun
  isBalancing: boolean('is_balancing').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const rangeDayWeapons = pgTable('range_day_weapons', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull().references(() => rangeDaySessions.id),
  weaponId: integer('weapon_id').notNull().references(() => weapons.id),
})

export const rangeDayStrings = pgTable('range_day_strings', {
  id: serial('id').primaryKey(),
  sessionId: integer('session_id').notNull().references(() => rangeDaySessions.id),
  transactionId: integer('transaction_id').notNull().references(() => ammoTransactions.id),
  weaponId: integer('weapon_id').notNull().references(() => weapons.id),
  ammoTypeId: integer('ammo_type_id').notNull().references(() => ammoTypes.id),
  rounds: integer('rounds').notNull(),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  note: text('note'),
})

export const weapons = pgTable('weapons', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  caliber: text('caliber').notNull(),
  type: text('type').notNull(), // handgun | rifle | shotgun
  serialNumber: text('serial_number'),
  notes: text('notes'),
  cleaningIntervalRounds: integer('cleaning_interval_rounds'),
  cleaningIntervalDays: integer('cleaning_interval_days'),
  initialRounds: integer('initial_rounds').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const weaponCleanings = pgTable('weapon_cleanings', {
  id: serial('id').primaryKey(),
  weaponId: integer('weapon_id').notNull().references(() => weapons.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id),
  cleanedAt: timestamp('cleaned_at').notNull(),
  roundCountAtCleaning: integer('round_count_at_cleaning').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
