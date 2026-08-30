import { Hono, Context } from 'hono'
import { jwt } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'
import { db, weapons, weaponCleanings, ammoTypes, ammoTransactions, ammoLedgerEntries, rangeDaySessions, rangeDayWeapons, rangeDayStrings } from '@ay-armory/db'
import { eq, inArray } from 'drizzle-orm'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const app = new Hono()
app.use('/*', jwt({ secret: JWT_SECRET, alg: 'HS256' }))
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})
function getUserId(c: Context): number {
  return (c as any).get('jwtPayload').sub as number
}

app.get('/export', async (c) => {
  const userId = getUserId(c)
  const [weaponsRows, cleaningsRows, ammoTypesRows, txRows, sessionsRows] = await Promise.all([
    db.select().from(weapons).where(eq(weapons.userId, userId)),
    db.select().from(weaponCleanings).where(eq(weaponCleanings.userId, userId)),
    db.select().from(ammoTypes).where(eq(ammoTypes.userId, userId)),
    db.select().from(ammoTransactions).where(eq(ammoTransactions.userId, userId)),
    db.select().from(rangeDaySessions).where(eq(rangeDaySessions.userId, userId)),
  ])
  const txIds = txRows.map(t => t.id)
  const [ledgerRows, rdWeaponsRows, rdStringsRows] = await Promise.all([
    txIds.length ? db.select().from(ammoLedgerEntries).where(inArray(ammoLedgerEntries.transactionId, txIds)) : Promise.resolve([] as any[]),
    sessionsRows.length ? db.select().from(rangeDayWeapons).where(inArray(rangeDayWeapons.sessionId, sessionsRows.map(s => s.id))) : Promise.resolve([] as any[]),
    sessionsRows.length ? db.select().from(rangeDayStrings).where(inArray(rangeDayStrings.sessionId, sessionsRows.map(s => s.id))) : Promise.resolve([] as any[]),
  ])
  return c.json({
    version: '1',
    exportedAt: new Date().toISOString(),
    weapons: weaponsRows,
    weaponCleanings: cleaningsRows,
    ammoTypes: ammoTypesRows,
    ammoTransactions: txRows,
    ammoLedgerEntries: ledgerRows,
    rangeDaySessions: sessionsRows,
    rangeDayWeapons: rdWeaponsRows,
    rangeDayStrings: rdStringsRows,
  })
})

app.post('/import', async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json()
  const mode = body.mode === 'replace' ? 'replace' : 'merge'
  const data = body.data ?? body
  if (!data || data.version !== '1') return c.json({ error: 'Invalid backup: expected version 1' }, 400)

  const weaponsIn: any[] = Array.isArray(data.weapons) ? data.weapons : []
  const cleaningsIn: any[] = Array.isArray(data.weaponCleanings) ? data.weaponCleanings : []
  const ammoTypesIn: any[] = Array.isArray(data.ammoTypes) ? data.ammoTypes : []
  const txIn: any[] = Array.isArray(data.ammoTransactions) ? data.ammoTransactions : []
  const ledgerIn: any[] = Array.isArray(data.ammoLedgerEntries) ? data.ammoLedgerEntries : []
  const sessionsIn: any[] = Array.isArray(data.rangeDaySessions) ? data.rangeDaySessions : []
  const rdWeaponsIn: any[] = Array.isArray(data.rangeDayWeapons) ? data.rangeDayWeapons : []
  const rdStringsIn: any[] = Array.isArray(data.rangeDayStrings) ? data.rangeDayStrings : []

  if (mode === 'replace') {
    const userSessionIds = (await db.select({ id: rangeDaySessions.id }).from(rangeDaySessions).where(eq(rangeDaySessions.userId, userId))).map(r => r.id)
    if (userSessionIds.length) {
      await db.delete(rangeDayStrings).where(inArray(rangeDayStrings.sessionId, userSessionIds))
      await db.delete(rangeDayWeapons).where(inArray(rangeDayWeapons.sessionId, userSessionIds))
    }
    await db.delete(weaponCleanings).where(eq(weaponCleanings.userId, userId))
    const userTxIds = (await db.select({ id: ammoTransactions.id }).from(ammoTransactions).where(eq(ammoTransactions.userId, userId))).map(r => r.id)
    if (userTxIds.length) await db.delete(ammoLedgerEntries).where(inArray(ammoLedgerEntries.transactionId, userTxIds))
    await db.delete(ammoTransactions).where(eq(ammoTransactions.userId, userId))
    await db.delete(rangeDaySessions).where(eq(rangeDaySessions.userId, userId))
    await db.delete(weapons).where(eq(weapons.userId, userId))
    await db.delete(ammoTypes).where(eq(ammoTypes.userId, userId))
  }

  const weaponIdMap = new Map<number, number>()
  const ammoTypeIdMap = new Map<number, number>()
  const sessionIdMap = new Map<number, number>()
  const txIdMap = new Map<number, number>()

  const existingWeapons = await db.select().from(weapons).where(eq(weapons.userId, userId))
  const weaponKey = (w: any) => `${w.name}::${w.serialNumber ?? ''}::${w.caliber}`
  const existingWeaponMap = new Map(existingWeapons.map(w => [weaponKey(w), w.id]))
  for (const w of weaponsIn) {
    const key = weaponKey(w)
    if (mode === 'merge' && existingWeaponMap.has(key)) {
      weaponIdMap.set(w.id, existingWeaponMap.get(key)!)
      continue
    }
    const [created] = await db.insert(weapons).values({
      userId,
      name: w.name,
      caliber: w.caliber,
      type: w.type,
      serialNumber: w.serialNumber ?? null,
      notes: w.notes ?? null,
      cleaningIntervalRounds: w.cleaningIntervalRounds ?? null,
      cleaningIntervalDays: w.cleaningIntervalDays ?? null,
      createdAt: w.createdAt ? new Date(w.createdAt) : new Date(),
      updatedAt: new Date(),
    }).returning()
    weaponIdMap.set(w.id, created.id)
  }

  const existingAmmoTypes = await db.select().from(ammoTypes).where(eq(ammoTypes.userId, userId))
  const ammoKey = (a: any) => `${a.name}::${a.caliber}::${a.brand ?? ''}::${a.grain ?? ''}`
  const existingAmmoMap = new Map(existingAmmoTypes.map(a => [ammoKey(a), a.id]))
  for (const a of ammoTypesIn) {
    const key = ammoKey(a)
    if (mode === 'merge' && existingAmmoMap.has(key)) {
      ammoTypeIdMap.set(a.id, existingAmmoMap.get(key)!)
      continue
    }
    const [created] = await db.insert(ammoTypes).values({
      userId,
      name: a.name,
      caliber: a.caliber,
      grain: a.grain ?? null,
      brand: a.brand ?? null,
      description: a.description ?? null,
      createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
      updatedAt: new Date(),
    }).returning()
    ammoTypeIdMap.set(a.id, created.id)
  }

  for (const s of sessionsIn) {
    const [created] = await db.insert(rangeDaySessions).values({
      userId,
      note: s.note ?? null,
      startedAt: s.startedAt ? new Date(s.startedAt) : new Date(),
      endedAt: s.endedAt ? new Date(s.endedAt) : null,
    }).returning()
    sessionIdMap.set(s.id, created.id)
  }

  for (const tx of txIn) {
    const newSessionId = tx.rangeDaySessionId != null ? sessionIdMap.get(tx.rangeDaySessionId) ?? null : null
    const [created] = await db.insert(ammoTransactions).values({
      userId,
      type: tx.type,
      note: tx.note ?? null,
      rangeDaySessionId: newSessionId,
      occurredAt: tx.occurredAt ? new Date(tx.occurredAt) : new Date(),
      price: tx.price ?? null,
      vendor: tx.vendor ?? null,
      createdAt: tx.createdAt ? new Date(tx.createdAt) : new Date(),
    }).returning()
    txIdMap.set(tx.id, created.id)
  }

  for (const e of ledgerIn) {
    const newTxId = txIdMap.get(e.transactionId)
    const newAmmoTypeId = ammoTypeIdMap.get(e.ammoTypeId)
    if (!newTxId || !newAmmoTypeId) continue
    const newWeaponId = e.weaponId != null ? weaponIdMap.get(e.weaponId) ?? null : null
    await db.insert(ammoLedgerEntries).values({
      transactionId: newTxId,
      ammoTypeId: newAmmoTypeId,
      weaponId: newWeaponId,
      quantity: e.quantity,
      location: e.location,
      isBalancing: e.isBalancing ?? false,
      createdAt: e.createdAt ? new Date(e.createdAt) : new Date(),
    })
  }

  for (const rw of rdWeaponsIn) {
    const newSessionId = sessionIdMap.get(rw.sessionId)
    const newWeaponId = weaponIdMap.get(rw.weaponId)
    if (!newSessionId || !newWeaponId) continue
    await db.insert(rangeDayWeapons).values({ sessionId: newSessionId, weaponId: newWeaponId })
  }

  for (const cl of cleaningsIn) {
    const newWeaponId = weaponIdMap.get(cl.weaponId)
    if (!newWeaponId) continue
    await db.insert(weaponCleanings).values({
      weaponId: newWeaponId,
      userId,
      cleanedAt: cl.cleanedAt ? new Date(cl.cleanedAt) : new Date(),
      roundCountAtCleaning: cl.roundCountAtCleaning ?? 0,
      note: cl.note ?? null,
      createdAt: cl.createdAt ? new Date(cl.createdAt) : new Date(),
    })
  }

  for (const rs of rdStringsIn) {
    const newSessionId = sessionIdMap.get(rs.sessionId)
    const newTxId = txIdMap.get(rs.transactionId)
    const newWeaponId = weaponIdMap.get(rs.weaponId)
    const newAmmoTypeId = ammoTypeIdMap.get(rs.ammoTypeId)
    if (!newSessionId || !newTxId || !newWeaponId || !newAmmoTypeId) continue
    await db.insert(rangeDayStrings).values({
      sessionId: newSessionId,
      transactionId: newTxId,
      weaponId: newWeaponId,
      ammoTypeId: newAmmoTypeId,
      rounds: rs.rounds,
      occurredAt: rs.occurredAt ? new Date(rs.occurredAt) : new Date(),
      note: rs.note ?? null,
    })
  }

  return c.json({
    imported: {
      weapons: weaponIdMap.size,
      weaponCleanings: cleaningsIn.length,
      ammoTypes: ammoTypeIdMap.size,
      rangeDaySessions: sessionIdMap.size,
      transactions: txIdMap.size,
    },
    mode,
  })
})

export default app
