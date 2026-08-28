import { db, weapons, rangeDayStrings, rangeDaySessions, ammoTypes } from '@ay-armory/db'
import { eq, and, asc, sql } from 'drizzle-orm'

export type Weapon = typeof weapons.$inferSelect

export type WeaponFiringString = {
  id: number
  ammoTypeId: number
  ammoName: string
  ammoCaliber: string
  rounds: number
  occurredAt: Date
  note: string | null
}

export type WeaponFiringSession = {
  sessionId: number
  note: string | null
  startedAt: Date
  endedAt: Date | null
  rounds: number
  strings: WeaponFiringString[]
}

export type WeaponFiringHistory = {
  weapon: Weapon
  totalRounds: number
  byAmmoType: { ammoTypeId: number; name: string; caliber: string; rounds: number }[]
  sessions: WeaponFiringSession[]
}

export type WeaponFiringRow = {
  stringId: number
  sessionId: number
  ammoTypeId: number
  rounds: number
  occurredAt: Date
  note: string | null
  ammoName: string
  ammoCaliber: string
  sessionNote: string | null
  sessionStartedAt: Date
  sessionEndedAt: Date | null
}

// Pure aggregation of joined range-day-string rows into a weapon firing history.
// Kept separate from the DB query so it can be unit-tested without a database.
export function buildWeaponFiringHistory(weapon: Weapon, rows: WeaponFiringRow[]): WeaponFiringHistory {
  const byAmmoTypeMap = new Map<number, { ammoTypeId: number; name: string; caliber: string; rounds: number }>()
  const sessionMap = new Map<number, WeaponFiringSession>()
  let totalRounds = 0

  for (const r of rows) {
    totalRounds += r.rounds

    const at = byAmmoTypeMap.get(r.ammoTypeId)
    if (at) at.rounds += r.rounds
    else byAmmoTypeMap.set(r.ammoTypeId, {
      ammoTypeId: r.ammoTypeId,
      name: r.ammoName,
      caliber: r.ammoCaliber,
      rounds: r.rounds,
    })

    let sess = sessionMap.get(r.sessionId)
    if (!sess) {
      sess = {
        sessionId: r.sessionId,
        note: r.sessionNote,
        startedAt: r.sessionStartedAt,
        endedAt: r.sessionEndedAt,
        rounds: 0,
        strings: [],
      }
      sessionMap.set(r.sessionId, sess)
    }
    sess.rounds += r.rounds
    sess.strings.push({
      id: r.stringId,
      ammoTypeId: r.ammoTypeId,
      ammoName: r.ammoName,
      ammoCaliber: r.ammoCaliber,
      rounds: r.rounds,
      occurredAt: r.occurredAt,
      note: r.note,
    })
  }

  return {
    weapon,
    totalRounds,
    byAmmoType: Array.from(byAmmoTypeMap.values()).sort((a, b) => b.rounds - a.rounds),
    sessions: Array.from(sessionMap.values()),
  }
}

export type CreateWeaponData = {
  userId: number
  name: string
  caliber: string
  type: string
  serialNumber?: string | null
  notes?: string | null
}

export type UpdateWeaponData = {
  name?: string
  caliber?: string
  type?: string
  serialNumber?: string | null
  notes?: string | null
}

export const weaponsRepository = {
  async createWeapon(data: CreateWeaponData): Promise<Weapon> {
    const now = new Date()
    const [weapon] = await db
      .insert(weapons)
      .values({
        userId: data.userId,
        name: data.name,
        caliber: data.caliber,
        type: data.type,
        serialNumber: data.serialNumber ?? null,
        notes: data.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return weapon
  },

  async listWeapons(userId: number): Promise<Weapon[]> {
    return db.select().from(weapons).where(eq(weapons.userId, userId))
  },

  async getWeapon(id: number, userId: number): Promise<Weapon | null> {
    const [weapon] = await db
      .select()
      .from(weapons)
      .where(and(eq(weapons.id, id), eq(weapons.userId, userId)))
    return weapon ?? null
  },

  async updateWeapon(id: number, userId: number, data: UpdateWeaponData): Promise<Weapon | null> {
    const [updated] = await db
      .update(weapons)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(weapons.id, id), eq(weapons.userId, userId)))
      .returning()
    return updated ?? null
  },

  async deleteWeapon(id: number, userId: number): Promise<void> {
    await db.delete(weapons).where(and(eq(weapons.id, id), eq(weapons.userId, userId)))
  },

  async getWeaponFiringHistory(weaponId: number, userId: number): Promise<WeaponFiringHistory | null> {
    const weapon = await this.getWeapon(weaponId, userId)
    if (!weapon) return null

    const rows = await db
      .select({
        stringId: rangeDayStrings.id,
        sessionId: rangeDayStrings.sessionId,
        ammoTypeId: rangeDayStrings.ammoTypeId,
        rounds: rangeDayStrings.rounds,
        occurredAt: rangeDayStrings.occurredAt,
        note: rangeDayStrings.note,
        ammoName: ammoTypes.name,
        ammoCaliber: ammoTypes.caliber,
        sessionNote: rangeDaySessions.note,
        sessionStartedAt: rangeDaySessions.startedAt,
        sessionEndedAt: rangeDaySessions.endedAt,
      })
      .from(rangeDayStrings)
      .innerJoin(rangeDaySessions, eq(rangeDayStrings.sessionId, rangeDaySessions.id))
      .innerJoin(ammoTypes, eq(rangeDayStrings.ammoTypeId, ammoTypes.id))
      .where(and(eq(rangeDayStrings.weaponId, weaponId), eq(rangeDaySessions.userId, userId)))
      .orderBy(asc(rangeDaySessions.startedAt), asc(rangeDayStrings.occurredAt))

    return buildWeaponFiringHistory(weapon, rows)
  },

  async getWeaponFiringTotals(userId: number): Promise<{ weaponId: number; totalRounds: number }[]> {
    const rows = await db
      .select({
        weaponId: rangeDayStrings.weaponId,
        total: sql<number>`SUM(${rangeDayStrings.rounds})`,
      })
      .from(rangeDayStrings)
      .innerJoin(rangeDaySessions, eq(rangeDayStrings.sessionId, rangeDaySessions.id))
      .where(eq(rangeDaySessions.userId, userId))
      .groupBy(rangeDayStrings.weaponId)
    return rows.map(r => ({ weaponId: r.weaponId, totalRounds: Number(r.total) }))
  },
}
