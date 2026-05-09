import { db, users } from '@ay-armory/db'
import { eq } from 'drizzle-orm'

export const userRepository = {
  async create(data: { email: string; password: string }) {
    const [user] = await db.insert(users).values(data).returning()
    return user
  },

  async findByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email))
    return user || null
  },

  async findById(id: number) {
    const [user] = await db.select().from(users).where(eq(users.id, id))
    return user || null
  },
}
