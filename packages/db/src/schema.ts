import { pgTable, text, serial, timestamp } from 'drizzle-orm/pg-core'

// Temporary remove Users
// export const users = pgTable('users', {
//   id: serial('id').primaryKey(),
//   username: text('username').notNull().unique(),
//   createdAt: timestamp('created_at').defaultNow().notNull(),
// })
