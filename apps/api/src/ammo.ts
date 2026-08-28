import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import { ammoRepository } from './ammo-repository'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

const VALID_TX_TYPES = new Set(['acquisition', 'expenditure', 'transfer', 'adjustment'])

const ammo = new Hono()

// Apply JWT middleware to all ammo routes
ammo.use('/*', jwt({ secret: JWT_SECRET, alg: 'HS256' }))

ammo.onError((err, c) => {
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

  // Create the session first
  const session = await ammoRepository.createRangeDaySession({ userId, note })

  // Build entries: for each ammo type, -qty from storage, +qty into bag
  const occurredAt = new Date().toISOString()
  const entries = ammoItems.flatMap((item: { ammoTypeId: number; quantity: number }) => [
    { ammoTypeId: item.ammoTypeId, quantity: -item.quantity, location: 'storage', isBalancing: false },
    { ammoTypeId: item.ammoTypeId, quantity: item.quantity, location: 'bag', isBalancing: false },
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

  return c.json({ ...session, bag, transactions: [tx] }, 201)
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
  return c.json({ ...session, bag })
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

// POST /ammo/range-days/:id/end  — end session
ammo.post('/range-days/:id/end', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const session = await ammoRepository.getRangeDaySession(id, userId)
  if (!session) return c.json({ error: 'Not found' }, 404)
  if (session.endedAt != null) return c.json({ error: 'Session already ended' }, 409)

  const body = await c.req.json()
  const { returnAmmo = [] } = body

  // Get current bag contents
  const bagContents = await ammoRepository.getBagContents(id)

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
  if (entries.length > 0) {
    tx = await ammoRepository.createTransactionWithEntries({
      userId,
      type: 'range_day_end',
      occurredAt,
      rangeDaySessionId: id,
      entries,
    })
  }

  const endedSession = await ammoRepository.endRangeDaySession(id)

  return c.json({ session: endedSession, transaction: tx })
})

export default ammo
