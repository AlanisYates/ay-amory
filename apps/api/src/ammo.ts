import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'
import { ammoRepository } from './ammo-repository'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

const VALID_TX_TYPES = new Set(['acquisition', 'expenditure', 'transfer', 'adjustment'])

const ammo = new Hono()

// Apply JWT middleware to all ammo routes
ammo.use('/*', jwt({ secret: JWT_SECRET, alg: 'HS256' }))

ammo.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

// Helper: get authenticated user id from JWT payload
function getUserId(c: Parameters<typeof ammo.get>[1]): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (c as any).get('jwtPayload').sub as number
}

// ── Ammo Types ──────────────────────────────────────────────────────────────

// GET /ammo/types
ammo.get('/types', async (c) => {
  const userId = getUserId(c)
  const types = await ammoRepository.listAmmoTypes(userId)
  return c.json(types)
})

// POST /ammo/types
ammo.post('/types', async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json()
  const { name, caliber, grain, brand, description } = body

  if (!name || !caliber) {
    return c.json({ error: 'name and caliber are required' }, 400)
  }

  const type = await ammoRepository.createAmmoType({ userId, name, caliber, grain, brand, description })
  return c.json(type, 201)
})

// GET /ammo/types/:id/transactions  — full transaction history for one ammo type
ammo.get('/types/:id/transactions', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const type = await ammoRepository.getAmmoType(id, userId)
  if (!type) return c.json({ error: 'Not found' }, 404)
  const transactions = await ammoRepository.listTransactionsForAmmoType(userId, id)
  return c.json(transactions)
})

// GET /ammo/types/:id
ammo.get('/types/:id', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const type = await ammoRepository.getAmmoType(id, userId)
  if (!type) return c.json({ error: 'Not found' }, 404)
  return c.json(type)
})

// PATCH /ammo/types/:id
ammo.patch('/types/:id', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updated = await ammoRepository.updateAmmoType(id, userId, body)
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
})

// DELETE /ammo/types/:id
ammo.delete('/types/:id', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))

  const type = await ammoRepository.getAmmoType(id, userId)
  if (!type) return c.json({ error: 'Not found' }, 404)

  const hasEntries = await ammoRepository.hasLedgerEntriesForType(id)
  if (hasEntries) {
    return c.json({ error: 'Cannot delete — ledger entries exist for this ammo type' }, 409)
  }

  await ammoRepository.deleteAmmoType(id, userId)
  return new Response(null, { status: 204 })
})

// ── Transactions ────────────────────────────────────────────────────────────

// POST /ammo/transactions
ammo.post('/transactions', async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json()
  const { type, note, occurredAt, price, vendor, entries: userEntries } = body

  if (!type || !VALID_TX_TYPES.has(type)) {
    return c.json({ error: `type must be one of: ${[...VALID_TX_TYPES].join(', ')}` }, 400)
  }
  if (!occurredAt) {
    return c.json({ error: 'occurredAt is required' }, 400)
  }
  if (!Array.isArray(userEntries) || userEntries.length === 0) {
    return c.json({ error: 'Ledger entries must sum to zero' }, 422)
  }

  let dbEntries: { ammoTypeId: number; quantity: number; location: string; isBalancing: boolean }[]

  if (userEntries.length === 1) {
    // Single entry: auto-add equity balancing entry
    const { ammoTypeId, quantity } = userEntries[0]
    dbEntries = [
      { ammoTypeId, quantity, location: 'storage', isBalancing: false },
      { ammoTypeId, quantity: -quantity, location: 'equity', isBalancing: true },
    ]
  } else {
    // Multiple entries: must sum to 0 (user-provided)
    const sum = userEntries.reduce((acc: number, e: { quantity: number }) => acc + e.quantity, 0)
    if (sum !== 0) {
      return c.json({ error: 'Ledger entries must sum to zero' }, 422)
    }
    dbEntries = userEntries.map((e: { ammoTypeId: number; quantity: number }) => ({
      ammoTypeId: e.ammoTypeId,
      quantity: e.quantity,
      location: 'storage',
      isBalancing: false,
    }))
  }

  const tx = await ammoRepository.createTransactionWithEntries({
    userId,
    type,
    note,
    occurredAt,
    price,
    vendor,
    entries: dbEntries,
  })

  return c.json(tx, 201)
})

// GET /ammo/transactions
ammo.get('/transactions', async (c) => {
  const userId = getUserId(c)
  const { type, ammoTypeId, occurredAfter, occurredBefore } = c.req.query()
  const txs = await ammoRepository.listTransactions(userId, {
    type: type || undefined,
    ammoTypeId: ammoTypeId ? Number(ammoTypeId) : undefined,
    occurredAfter: occurredAfter || undefined,
    occurredBefore: occurredBefore || undefined,
  })
  return c.json(txs)
})

// GET /ammo/transactions/:id
ammo.get('/transactions/:id', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const tx = await ammoRepository.getTransaction(id, userId)
  if (!tx) return c.json({ error: 'Not found' }, 404)
  return c.json(tx)
})

// ── Inventory ───────────────────────────────────────────────────────────────

// GET /ammo/inventory
ammo.get('/inventory', async (c) => {
  const userId = getUserId(c)
  const inventory = await ammoRepository.getInventory(userId)
  return c.json(inventory)
})

// ── Range Day Sessions ───────────────────────────────────────────────────────

// POST /ammo/range-days  — start a session
ammo.post('/range-days', async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json()
  const { ammo: ammoItems, note } = body

  if (!Array.isArray(ammoItems) || ammoItems.length === 0) {
    return c.json({ error: 'ammo is required and must be a non-empty array' }, 400)
  }

  // Aggregate requested quantities per ammo type (guard against duplicates / bad input)
  const totalsByType = new Map<number, number>()
  for (const item of ammoItems) {
    if (!item?.ammoTypeId || !(item.quantity > 0)) {
      return c.json({ error: 'Each ammo item requires a positive ammoTypeId and quantity' }, 400)
    }
    totalsByType.set(item.ammoTypeId, (totalsByType.get(item.ammoTypeId) ?? 0) + item.quantity)
  }

  // Reject if any type requests more than is in storage (no negative storage)
  const inventory = await ammoRepository.getInventory(userId)
  const balanceByType = new Map(inventory.map(i => [i.id, i.balance]))
  for (const [ammoTypeId, qty] of totalsByType) {
    const available = balanceByType.get(ammoTypeId) ?? 0
    if (qty > available) {
      return c.json(
        { error: `Not enough ammo (type ${ammoTypeId}) in storage: have ${available}, requested ${qty}` },
        422,
      )
    }
  }

  // Create the session first
  const session = await ammoRepository.createRangeDaySession({ userId, note })

  // Record the guns brought to this session (optional)
  const weapons = Array.isArray(body.weapons) ? body.weapons.map((w: number) => Number(w)) : []
  await ammoRepository.createRangeDayWeapons(session.id, weapons)

  // Build entries: for each ammo type, -qty from storage, +qty into bag
  const occurredAt = new Date().toISOString()
  const entries = [...totalsByType.entries()].flatMap(([ammoTypeId, qty]) => [
    { ammoTypeId, quantity: -qty, location: 'storage', isBalancing: false },
    { ammoTypeId, quantity: qty, location: 'bag', isBalancing: false },
  ])

  const tx = await ammoRepository.createTransactionWithEntries({
    userId,
    type: 'range_day_start',
    note: note ?? null,
    occurredAt,
    rangeDaySessionId: session.id,
    entries,
  })

  const bag = await ammoRepository.getBagContents(session.id)
  const broughtWeapons = await ammoRepository.listRangeDayWeapons(session.id)

  return c.json({ ...session, bag, weapons: broughtWeapons, transactions: [tx] }, 201)
})

// GET /ammo/range-days
ammo.get('/range-days', async (c) => {
  const userId = getUserId(c)
  const sessions = await ammoRepository.listRangeDaySessions(userId)
  return c.json(sessions)
})

// GET /ammo/range-days/:id
ammo.get('/range-days/:id', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const session = await ammoRepository.getRangeDaySession(id, userId)
  if (!session) return c.json({ error: 'Not found' }, 404)

  const bag = await ammoRepository.getBagContents(id)
  const weapons = await ammoRepository.listRangeDayWeapons(id)
  const strings = await ammoRepository.listRangeDayStrings(id)
  const gunLoadedMap = await ammoRepository.getGunLoaded(id)
  const gunLoaded = Array.from(gunLoadedMap.entries()).map(([key, rounds]) => {
    const [weaponId, ammoTypeId] = key.split(':').map(Number)
    return { weaponId, ammoTypeId, rounds }
  })

  return c.json({ ...session, bag, weapons, strings, gunLoaded })
})

// POST /ammo/range-days/:id/acquire  — on-site purchase
ammo.post('/range-days/:id/acquire', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const session = await ammoRepository.getRangeDaySession(id, userId)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.endedAt != null) return c.json({ error: 'Session already ended' }, 409)

  const body = await c.req.json()
  const { ammo: ammoItems, note, price, vendor } = body

  if (!Array.isArray(ammoItems) || ammoItems.length === 0) {
    return c.json({ error: 'ammo is required and must be a non-empty array' }, 400)
  }

  // On-site purchase: goes straight to bag, balanced by equity
  const occurredAt = new Date().toISOString()
  const entries = ammoItems.flatMap((item: { ammoTypeId: number; quantity: number }) => [
    { ammoTypeId: item.ammoTypeId, quantity: item.quantity, location: 'bag', isBalancing: false },
    { ammoTypeId: item.ammoTypeId, quantity: -item.quantity, location: 'equity', isBalancing: true },
  ])

  // Use first item's price/vendor if provided at item level, else use body-level
  const txPrice = ammoItems[0]?.price ?? price ?? null
  const txVendor = ammoItems[0]?.vendor ?? vendor ?? null

  const tx = await ammoRepository.createTransactionWithEntries({
    userId,
    type: 'acquisition',
    note: note ?? null,
    occurredAt,
    price: txPrice,
    vendor: txVendor,
    rangeDaySessionId: id,
    entries,
  })

  const bag = await ammoRepository.getBagContents(id)
  return c.json({ transaction: tx, bag })
})

// ── Load / Shoot / Return (live shooting flow) ────────────────────────────

function gunLoadedToArr(map: Map<string, number>) {
  return Array.from(map.entries()).map(([key, rounds]) => {
    const [weaponId, ammoTypeId] = key.split(':').map(Number)
    return { weaponId, ammoTypeId, rounds }
  })
}

ammo.post('/range-days/:id/load', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const session = await ammoRepository.getRangeDaySession(id, userId)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.endedAt != null) return c.json({ error: 'Session already ended' }, 409)
  const body = await c.req.json()
  const { weaponId, ammoTypeId, rounds } = body
  if (!weaponId || !ammoTypeId || !rounds || rounds <= 0) {
    return c.json({ error: 'weaponId, ammoTypeId, and positive rounds are required' }, 400)
  }
  try {
    await ammoRepository.createLoad({ userId, sessionId: id, weaponId: Number(weaponId), ammoTypeId: Number(ammoTypeId), rounds: Number(rounds) })
  } catch {
    return c.json({ error: 'Not enough ammo in bag' }, 422)
  }
  const bag = await ammoRepository.getBagContents(id)
  const gunLoaded = gunLoadedToArr(await ammoRepository.getGunLoaded(id))
  return c.json({ bag, gunLoaded })
})

ammo.post('/range-days/:id/shoot', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const session = await ammoRepository.getRangeDaySession(id, userId)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.endedAt != null) return c.json({ error: 'Session already ended' }, 409)
  const body = await c.req.json()
  const { weaponId, ammoTypeId, rounds, note, occurredAt } = body
  if (!weaponId || !ammoTypeId || !rounds || rounds <= 0) {
    return c.json({ error: 'weaponId, ammoTypeId, and positive rounds are required' }, 400)
  }
  let str
  try {
    str = await ammoRepository.createShoot({ userId, sessionId: id, weaponId: Number(weaponId), ammoTypeId: Number(ammoTypeId), rounds: Number(rounds), note: note ?? null, occurredAt })
  } catch {
    return c.json({ error: 'Not enough loaded ammo for this weapon/ammo' }, 422)
  }
  const bag = await ammoRepository.getBagContents(id)
  const gunLoaded = gunLoadedToArr(await ammoRepository.getGunLoaded(id))
  return c.json({ string: str, bag, gunLoaded })
})

ammo.post('/range-days/:id/return', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const session = await ammoRepository.getRangeDaySession(id, userId)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.endedAt != null) return c.json({ error: 'Session already ended' }, 409)
  const body = await c.req.json()
  const { weaponId, ammoTypeId, rounds } = body
  if (!weaponId || !ammoTypeId || !rounds || rounds <= 0) {
    return c.json({ error: 'weaponId, ammoTypeId, and positive rounds are required' }, 400)
  }
  try {
    await ammoRepository.createReturn({ userId, sessionId: id, weaponId: Number(weaponId), ammoTypeId: Number(ammoTypeId), rounds: Number(rounds) })
  } catch {
    return c.json({ error: 'Not enough loaded ammo to return' }, 422)
  }
  const bag = await ammoRepository.getBagContents(id)
  const gunLoaded = gunLoadedToArr(await ammoRepository.getGunLoaded(id))
  return c.json({ bag, gunLoaded })
})

ammo.delete('/range-days/:id/strings/:stringId', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const stringId = Number(c.req.param('stringId'))
  const session = await ammoRepository.getRangeDaySession(id, userId)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.endedAt != null) return c.json({ error: 'Session already ended' }, 409)
  try {
    await ammoRepository.deleteRangeDayString(stringId, userId)
  } catch {
    return c.json({ error: 'String not found' }, 404)
  }
  const bag = await ammoRepository.getBagContents(id)
  const gunLoaded = gunLoadedToArr(await ammoRepository.getGunLoaded(id))
  const strings = await ammoRepository.listRangeDayStrings(id)
  return c.json({ bag, gunLoaded, strings })
})

// POST /ammo/range-days/:id/end  — end session
ammo.post('/range-days/:id/end', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const session = await ammoRepository.getRangeDaySession(id, userId)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.endedAt != null) return c.json({ error: 'Session already ended' }, 409)

  const body = await c.req.json()
  const { returnAmmo: providedReturn } = body

  // Get current bag contents
  const bagContents = await ammoRepository.getBagContents(id)

  // New shoot-tracked flow omits returnAmmo → return everything still in the bag.
  // Legacy flow supplies it → keeps the derived-expenditure behavior (and tests).
  const returnAmmo = providedReturn ?? bagContents.map(b => ({ ammoTypeId: b.ammoTypeId, quantity: b.inBag }))

  // Any ammo still loaded in a gun (not shot, not returned) must go back to
  // storage at end-of-day, otherwise it vanishes from the ledger. Unload it first.
  const gunLoaded = await ammoRepository.getGunLoaded(id)
  const unloadEntries: { ammoTypeId: number; weaponId: number; quantity: number; location: string; isBalancing: boolean }[] = []
  for (const [key, rounds] of gunLoaded.entries()) {
    if (rounds <= 0) continue
    const [weaponId, ammoTypeId] = key.split(':').map(Number)
    unloadEntries.push({ ammoTypeId, weaponId, quantity: -rounds, location: 'gun', isBalancing: false })
    unloadEntries.push({ ammoTypeId, quantity: rounds, location: 'storage', isBalancing: false })
  }

  // Build a map of inBag quantities
  const inBagMap = new Map<number, number>()
  for (const item of bagContents) {
    inBagMap.set(item.ammoTypeId, item.inBag)
  }

  // Validate: cannot return more than in bag
  for (const ret of returnAmmo as { ammoTypeId: number; quantity: number }[]) {
    const available = inBagMap.get(ret.ammoTypeId) ?? 0
    if (ret.quantity > available) {
      return c.json({ error: 'Cannot return more than in the bag' }, 422)
    }
  }

  // Build return map
  const returnMap = new Map<number, number>()
  for (const ret of returnAmmo as { ammoTypeId: number; quantity: number }[]) {
    returnMap.set(ret.ammoTypeId, ret.quantity)
  }

  // Build entries for range_day_end transaction
  const entries: { ammoTypeId: number; quantity: number; location: string; isBalancing: boolean }[] = []

  for (const { ammoTypeId, inBag } of bagContents) {
    const returnQty = returnMap.get(ammoTypeId) ?? 0
    const expendQty = inBag - returnQty

    if (returnQty > 0) {
      // Return from bag to storage
      entries.push({ ammoTypeId, quantity: -returnQty, location: 'bag', isBalancing: false })
      entries.push({ ammoTypeId, quantity: returnQty, location: 'storage', isBalancing: false })
    }

    if (expendQty > 0) {
      // Derived expenditure: remove from bag, balance with equity
      entries.push({ ammoTypeId, quantity: -expendQty, location: 'bag', isBalancing: false })
      entries.push({ ammoTypeId, quantity: expendQty, location: 'equity', isBalancing: true })
    }
  }

  const occurredAt = new Date().toISOString()

  // Create the range_day_end transaction (only if there are entries)
  let tx = null
  const allEntries = [...unloadEntries, ...entries]
  if (allEntries.length > 0) {
    tx = await ammoRepository.createTransactionWithEntries({
      userId,
      type: 'range_day_end',
      occurredAt,
      rangeDaySessionId: id,
      entries: allEntries,
    })
  }

  const endedSession = await ammoRepository.endRangeDaySession(id)

  return c.json({ session: endedSession, transaction: tx })
})

export default ammo
