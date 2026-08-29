import { db, ammoTypes, ammoTransactions, ammoLedgerEntries, rangeDaySessions, rangeDayWeapons, rangeDayStrings, weapons } from '@ay-armory/db'
import { eq, and, gte, lte, sql, inArray } from 'drizzle-orm'

export type AmmoType = typeof ammoTypes.$inferSelect
export type AmmoTransaction = typeof ammoTransactions.$inferSelect
export type AmmoLedgerEntry = typeof ammoLedgerEntries.$inferSelect
export type RangeDaySession = typeof rangeDaySessions.$inferSelect
export type Weapon = typeof weapons.$inferSelect
export type RangeDayString = typeof rangeDayStrings.$inferSelect

export type GunLoadedRow = { weaponId: number | null; ammoTypeId: number; qty: number }

// Pure summation of gun-location ledger rows. Ledger quantities are already
// signed (load=+, shoot/return=−), so we sum them directly. Do NOT re-flip the
// sign by transaction type here — that double-counts fired/returned rounds.
export function sumGunLoaded(rows: GunLoadedRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.weaponId == null) continue
    const key = `${r.weaponId}:${r.ammoTypeId}`
    map.set(key, (map.get(key) ?? 0) + Number(r.qty))
  }
  return map
}

export type CreateAmmoTypeData = {
  userId: number
  name: string
  caliber: string
  grain?: number | null
  brand?: string | null
  description?: string | null
}

export type UpdateAmmoTypeData = {
  name?: string
  caliber?: string
  grain?: number | null
  brand?: string | null
  description?: string | null
}

export type TxEntryInput = {
  ammoTypeId: number
  quantity: number
  location: string
  isBalancing: boolean
}

export type CreateTransactionData = {
  userId: number
  type: string
  note?: string | null
  occurredAt: string
  price?: number | null
  vendor?: string | null
  rangeDaySessionId?: number | null
  entries: TxEntryInput[]
}

export type TransactionWithEntries = AmmoTransaction & { entries: AmmoLedgerEntry[] }

export type InventoryItem = AmmoType & { balance: number }

export type BagContentItem = {
  ammoTypeId: number
  taken: number
  acquired: number
  inBag: number
}

export type TxFilters = {
  type?: string
  ammoTypeId?: number
  occurredAfter?: string
  occurredBefore?: string
}

export const ammoRepository = {
  // ── Ammo Types ───────────────────────────────────────────────────────────

  async createAmmoType(data: CreateAmmoTypeData): Promise<AmmoType> {
    const now = new Date()
    const [type] = await db
      .insert(ammoTypes)
      .values({
        userId: data.userId,
        name: data.name,
        caliber: data.caliber,
        grain: data.grain ?? null,
        brand: data.brand ?? null,
        description: data.description ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return type
  },

  async listAmmoTypes(userId: number): Promise<AmmoType[]> {
    return db.select().from(ammoTypes).where(eq(ammoTypes.userId, userId))
  },

  async getAmmoType(id: number, userId: number): Promise<AmmoType | null> {
    const [type] = await db
      .select()
      .from(ammoTypes)
      .where(and(eq(ammoTypes.id, id), eq(ammoTypes.userId, userId)))
    return type ?? null
  },

  async updateAmmoType(id: number, userId: number, data: UpdateAmmoTypeData): Promise<AmmoType | null> {
    const [updated] = await db
      .update(ammoTypes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(ammoTypes.id, id), eq(ammoTypes.userId, userId)))
      .returning()
    return updated ?? null
  },

  async hasLedgerEntriesForType(ammoTypeId: number): Promise<boolean> {
    const [entry] = await db
      .select()
      .from(ammoLedgerEntries)
      .where(eq(ammoLedgerEntries.ammoTypeId, ammoTypeId))
      .limit(1)
    return entry != null
  },

  async deleteAmmoType(id: number, userId: number): Promise<void> {
    await db.delete(ammoTypes).where(and(eq(ammoTypes.id, id), eq(ammoTypes.userId, userId)))
  },

  // ── Transactions ─────────────────────────────────────────────────────────

  async createTransactionWithEntries(data: CreateTransactionData): Promise<TransactionWithEntries> {
    return db.transaction(async (tx) => {
      const [transaction] = await tx
        .insert(ammoTransactions)
        .values({
          userId: data.userId,
          type: data.type,
          note: data.note ?? null,
          occurredAt: new Date(data.occurredAt),
          price: data.price ?? null,
          vendor: data.vendor ?? null,
          rangeDaySessionId: data.rangeDaySessionId ?? null,
          createdAt: new Date(),
        })
        .returning()

      const entryRecords: AmmoLedgerEntry[] = []
      for (const e of data.entries) {
        const [entry] = await tx
          .insert(ammoLedgerEntries)
          .values({
            transactionId: transaction.id,
            ammoTypeId: e.ammoTypeId,
            quantity: e.quantity,
            location: e.location,
            isBalancing: e.isBalancing,
            createdAt: new Date(),
          })
          .returning()
        entryRecords.push(entry)
      }

      return { ...transaction, entries: entryRecords }
    })
  },

  async listTransactions(userId: number, filters?: TxFilters): Promise<AmmoTransaction[]> {
    const conditions = [eq(ammoTransactions.userId, userId)]
    if (filters?.type) conditions.push(eq(ammoTransactions.type, filters.type))
    if (filters?.occurredAfter) conditions.push(gte(ammoTransactions.occurredAt, new Date(filters.occurredAfter)))
    if (filters?.occurredBefore) conditions.push(lte(ammoTransactions.occurredAt, new Date(filters.occurredBefore)))
    return db.select().from(ammoTransactions).where(and(...conditions))
  },

  async getTransaction(id: number, userId: number): Promise<TransactionWithEntries | null> {
    const [transaction] = await db
      .select()
      .from(ammoTransactions)
      .where(and(eq(ammoTransactions.id, id), eq(ammoTransactions.userId, userId)))
    if (!transaction) return null

    const entries = await db
      .select()
      .from(ammoLedgerEntries)
      .where(eq(ammoLedgerEntries.transactionId, id))

    return { ...transaction, entries }
  },

  // ── Inventory ─────────────────────────────────────────────────────────────

  async getInventory(userId: number): Promise<InventoryItem[]> {
    const types = await db.select().from(ammoTypes).where(eq(ammoTypes.userId, userId))
    if (types.length === 0) return []

    const results: InventoryItem[] = []
    for (const type of types) {
      const [row] = await db
        .select({ balance: sql<number>`COALESCE(SUM(${ammoLedgerEntries.quantity}), 0)` })
        .from(ammoLedgerEntries)
        .where(
          and(
            eq(ammoLedgerEntries.ammoTypeId, type.id),
            eq(ammoLedgerEntries.location, 'storage'),
            eq(ammoLedgerEntries.isBalancing, false),
          ),
        )
      results.push({ ...type, balance: Number(row.balance) })
    }
    return results
  },

  // ── Range Day Sessions ────────────────────────────────────────────────────

  async createRangeDaySession(data: { userId: number; note?: string | null }): Promise<RangeDaySession> {
    const [session] = await db
      .insert(rangeDaySessions)
      .values({ userId: data.userId, note: data.note ?? null, startedAt: new Date(), endedAt: null })
      .returning()
    return session
  },

  async getRangeDaySession(id: number, userId: number): Promise<RangeDaySession | null> {
    const [session] = await db
      .select()
      .from(rangeDaySessions)
      .where(and(eq(rangeDaySessions.id, id), eq(rangeDaySessions.userId, userId)))
    return session ?? null
  },

  async listRangeDaySessions(userId: number): Promise<RangeDaySession[]> {
    return db.select().from(rangeDaySessions).where(eq(rangeDaySessions.userId, userId))
  },

  async endRangeDaySession(id: number): Promise<RangeDaySession> {
    const [session] = await db
      .update(rangeDaySessions)
      .set({ endedAt: new Date() })
      .where(eq(rangeDaySessions.id, id))
      .returning()
    return session
  },

  async getBagContents(sessionId: number): Promise<BagContentItem[]> {
    // Sum entries per ammo type, splitting by transaction type
    const rows = await db
      .select({
        ammoTypeId: ammoLedgerEntries.ammoTypeId,
        txType: ammoTransactions.type,
        qty: sql<number>`SUM(${ammoLedgerEntries.quantity})`,
      })
      .from(ammoLedgerEntries)
      .innerJoin(ammoTransactions, eq(ammoLedgerEntries.transactionId, ammoTransactions.id))
      .where(
        and(
          eq(ammoTransactions.rangeDaySessionId, sessionId),
          eq(ammoLedgerEntries.location, 'bag'),
          eq(ammoLedgerEntries.isBalancing, false),
        ),
      )
      .groupBy(ammoLedgerEntries.ammoTypeId, ammoTransactions.type)

    const byType = new Map<number, BagContentItem>()
    for (const row of rows) {
      const cur = byType.get(row.ammoTypeId) ?? { ammoTypeId: row.ammoTypeId, taken: 0, acquired: 0, inBag: 0 }
      const qty = Number(row.qty)
      if (row.txType === 'range_day_start') cur.taken += qty
      else if (row.txType === 'acquisition') cur.acquired += qty
      cur.inBag += qty
      byType.set(row.ammoTypeId, cur)
    }
    return Array.from(byType.values())
  },

  // ── Ammo Type Detail ──────────────────────────────────────────────────────

  /** All transactions that touch a given ammo type, with their full entry list. */
  async listTransactionsForAmmoType(userId: number, ammoTypeId: number): Promise<TransactionWithEntries[]> {
    // Find every transaction that has at least one entry for this ammo type
    const rows = await db
      .selectDistinct({ id: ammoTransactions.id })
      .from(ammoTransactions)
      .innerJoin(ammoLedgerEntries, eq(ammoLedgerEntries.transactionId, ammoTransactions.id))
      .where(
        and(
          eq(ammoTransactions.userId, userId),
          eq(ammoLedgerEntries.ammoTypeId, ammoTypeId),
        ),
      )

    if (rows.length === 0) return []

    const txIds = rows.map(r => r.id)

    // Fetch all matching transactions + all their entries in two batched queries
    const [txs, entries] = await Promise.all([
      db
        .select()
        .from(ammoTransactions)
        .where(inArray(ammoTransactions.id, txIds))
        .orderBy(ammoTransactions.occurredAt),
      db
        .select()
        .from(ammoLedgerEntries)
        .where(inArray(ammoLedgerEntries.transactionId, txIds)),
    ])

    return txs.map(tx => ({
      ...tx,
      entries: entries.filter(e => e.transactionId === tx.id),
    }))
  },

  async listTransactionsForRangeDay(sessionId: number, userId: number): Promise<TransactionWithEntries[]> {
    const txs = await db
      .select()
      .from(ammoTransactions)
      .where(and(eq(ammoTransactions.userId, userId), eq(ammoTransactions.rangeDaySessionId, sessionId)))
      .orderBy(ammoTransactions.occurredAt)
    if (txs.length === 0) return []
    const txIds = txs.map(t => t.id)
    const entries = await db.select().from(ammoLedgerEntries).where(inArray(ammoLedgerEntries.transactionId, txIds))
    return txs.map(tx => ({ ...tx, entries: entries.filter(e => e.transactionId === tx.id) }))
  },

  // ── Range Day Weapons (brought guns) ─────────────────────────────────────

  async createRangeDayWeapons(sessionId: number, weaponIds: number[]): Promise<void> {
    if (weaponIds.length === 0) return
    await db.insert(rangeDayWeapons).values(weaponIds.map(w => ({ sessionId, weaponId: w })))
  },

  async listRangeDayWeapons(sessionId: number): Promise<Weapon[]> {
    return db
      .select({
        id: weapons.id,
        userId: weapons.userId,
        name: weapons.name,
        caliber: weapons.caliber,
        type: weapons.type,
        serialNumber: weapons.serialNumber,
        notes: weapons.notes,
        cleaningIntervalRounds: weapons.cleaningIntervalRounds,
        cleaningIntervalDays: weapons.cleaningIntervalDays,
        createdAt: weapons.createdAt,
        updatedAt: weapons.updatedAt,
      })
      .from(rangeDayWeapons)
      .innerJoin(weapons, eq(rangeDayWeapons.weaponId, weapons.id))
      .where(eq(rangeDayWeapons.sessionId, sessionId))
  },

  // ── Shooting flow: Load / Shoot / Return ──────────────────────────────────

  async getGunLoaded(sessionId: number): Promise<Map<string, number>> {
    const rows = await db
      .select({
        weaponId: ammoLedgerEntries.weaponId,
        ammoTypeId: ammoLedgerEntries.ammoTypeId,
        qty: sql<number>`SUM(${ammoLedgerEntries.quantity})`,
      })
      .from(ammoLedgerEntries)
      .innerJoin(ammoTransactions, eq(ammoLedgerEntries.transactionId, ammoTransactions.id))
      .where(
        and(
          eq(ammoTransactions.rangeDaySessionId, sessionId),
          eq(ammoLedgerEntries.location, 'gun'),
          eq(ammoLedgerEntries.isBalancing, false),
        ),
      )
      .groupBy(ammoLedgerEntries.weaponId, ammoLedgerEntries.ammoTypeId)

    return sumGunLoaded(rows)
  },

  async createLoad(data: { userId: number; sessionId: number; weaponId: number; ammoTypeId: number; rounds: number }): Promise<void> {
    const bag = await this.getBagContents(data.sessionId)
    const inBag = bag.find(b => b.ammoTypeId === data.ammoTypeId)?.inBag ?? 0
    if (data.rounds > inBag) throw new Error('overload')

    await db.transaction(async (tx) => {
      const [txRow] = await tx.insert(ammoTransactions).values({
        userId: data.userId,
        type: 'range_day_load',
        occurredAt: new Date(),
        rangeDaySessionId: data.sessionId,
        createdAt: new Date(),
      }).returning()
      await tx.insert(ammoLedgerEntries).values([
        { transactionId: txRow.id, ammoTypeId: data.ammoTypeId, quantity: -data.rounds, location: 'bag', isBalancing: false, createdAt: new Date() },
        { transactionId: txRow.id, ammoTypeId: data.ammoTypeId, weaponId: data.weaponId, quantity: data.rounds, location: 'gun', isBalancing: false, createdAt: new Date() },
      ])
    })
  },

  async createShoot(data: { userId: number; sessionId: number; weaponId: number; ammoTypeId: number; rounds: number; note?: string | null; occurredAt?: string }): Promise<RangeDayString> {
    const loaded = await this.getGunLoaded(data.sessionId)
    const have = loaded.get(`${data.weaponId}:${data.ammoTypeId}`) ?? 0
    if (data.rounds > have) throw new Error('overload')

    const occurredAt = new Date(data.occurredAt ?? new Date().toISOString())
    return db.transaction(async (tx) => {
      const [txRow] = await tx.insert(ammoTransactions).values({
        userId: data.userId,
        type: 'range_day_shot',
        note: data.note ?? null,
        occurredAt,
        rangeDaySessionId: data.sessionId,
        createdAt: new Date(),
      }).returning()
      await tx.insert(ammoLedgerEntries).values([
        { transactionId: txRow.id, ammoTypeId: data.ammoTypeId, weaponId: data.weaponId, quantity: -data.rounds, location: 'gun', isBalancing: false, createdAt: new Date() },
        { transactionId: txRow.id, ammoTypeId: data.ammoTypeId, weaponId: data.weaponId, quantity: data.rounds, location: 'equity', isBalancing: true, createdAt: new Date() },
      ])
      const [str] = await tx.insert(rangeDayStrings).values({
        sessionId: data.sessionId,
        transactionId: txRow.id,
        weaponId: data.weaponId,
        ammoTypeId: data.ammoTypeId,
        rounds: data.rounds,
        occurredAt,
        note: data.note ?? null,
      }).returning()
      return str
    })
  },

  async createReturn(data: { userId: number; sessionId: number; weaponId: number; ammoTypeId: number; rounds: number }): Promise<void> {
    const loaded = await this.getGunLoaded(data.sessionId)
    const have = loaded.get(`${data.weaponId}:${data.ammoTypeId}`) ?? 0
    if (data.rounds > have) throw new Error('overload')

    await db.transaction(async (tx) => {
      const [txRow] = await tx.insert(ammoTransactions).values({
        userId: data.userId,
        type: 'range_day_return',
        occurredAt: new Date(),
        rangeDaySessionId: data.sessionId,
        createdAt: new Date(),
      }).returning()
      await tx.insert(ammoLedgerEntries).values([
        { transactionId: txRow.id, ammoTypeId: data.ammoTypeId, weaponId: data.weaponId, quantity: -data.rounds, location: 'gun', isBalancing: false, createdAt: new Date() },
        { transactionId: txRow.id, ammoTypeId: data.ammoTypeId, quantity: data.rounds, location: 'bag', isBalancing: false, createdAt: new Date() },
      ])
    })
  },

  async listRangeDayStrings(sessionId: number): Promise<RangeDayString[]> {
    return db
      .select()
      .from(rangeDayStrings)
      .where(eq(rangeDayStrings.sessionId, sessionId))
      .orderBy(rangeDayStrings.occurredAt)
  },

  async deleteRangeDayString(id: number, userId: number): Promise<void> {
    const [str] = await db
      .select({ id: rangeDayStrings.id, transactionId: rangeDayStrings.transactionId })
      .from(rangeDayStrings)
      .innerJoin(ammoTransactions, eq(rangeDayStrings.transactionId, ammoTransactions.id))
      .where(and(eq(rangeDayStrings.id, id), eq(ammoTransactions.userId, userId)))
    if (!str) return
    await db.transaction(async (tx) => {
      await tx.delete(ammoLedgerEntries).where(eq(ammoLedgerEntries.transactionId, str.transactionId))
      await tx.delete(ammoTransactions).where(eq(ammoTransactions.id, str.transactionId))
      await tx.delete(rangeDayStrings).where(eq(rangeDayStrings.id, id))
    })
  },
}
