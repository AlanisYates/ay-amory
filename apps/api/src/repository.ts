import { db, users } from '@ay-armory/db'
import { eq } from 'drizzle-orm'

type CreateUser = { email: string; password: string; firstName?: string; lastName?: string }
type UpdateUser = { firstName?: string; lastName?: string }

export const userRepository = {
  async create(data: CreateUser) {
    const now = new Date()
    const [user] = await db
      .insert(users)
      .values({ ...data, createdAt: now, updatedAt: now })
      .returning()
    return user
  },

  async update(id: number, data: UpdateUser) {
    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning()
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
