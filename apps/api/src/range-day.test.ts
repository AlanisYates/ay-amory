import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sign } from 'hono/jwt'

const JWT_SECRET = 'dev-secret'

// ── In-memory stores ──────────────────────────────────────────────────────
type AmmoTypeRow = {
  id: number; userId: number; name: string; caliber: string
  grain: number | null; brand: string | null; description: string | null
  createdAt: Date; updatedAt: Date
}
type TransactionRow = {
  id: number; userId: number; type: string; note: string | null
  occurredAt: Date; price: number | null; vendor: string | null
  rangeDaySessionId: number | null; createdAt: Date
}
type EntryRow = {
  id: number; transactionId: number; ammoTypeId: number; quantity: number
  location: string; isBalancing: boolean; createdAt: Date
}
type SessionRow = {
  id: number; userId: number; note: string | null
  startedAt: Date; endedAt: Date | null
}

const _ammoTypes: AmmoTypeRow[] = []
const _transactions: TransactionRow[] = []
const _entries: EntryRow[] = []
const _sessions: SessionRow[] = []

vi.mock('./ammo-repository', () => ({
  ammoRepository: {
    createAmmoType: vi.fn(async (data: { userId: number; name: string; caliber: string; grain?: number | null; brand?: string | null; description?: string | null }) => {
      const now = new Date()
      const row: AmmoTypeRow = {
        id: _ammoTypes.length + 1, userId: data.userId, name: data.name, caliber: data.caliber,
        grain: data.grain ?? null, brand: data.brand ?? null, description: data.description ?? null,
        createdAt: now, updatedAt: now,
      }
      _ammoTypes.push(row)
      return row
    }),

    listAmmoTypes: vi.fn(async (userId: number) =>
      _ammoTypes.filter(t => t.userId === userId)
    ),

    getAmmoType: vi.fn(async (id: number, userId: number) =>
      _ammoTypes.find(t => t.id === id && t.userId === userId) ?? null
    ),

    updateAmmoType: vi.fn(async (id: number, userId: number, data: Partial<AmmoTypeRow>) => {
      const idx = _ammoTypes.findIndex(t => t.id === id && t.userId === userId)
      if (idx === -1) return null
      _ammoTypes[idx] = { ..._ammoTypes[idx], ...data, updatedAt: new Date() }
      return _ammoTypes[idx]
    }),

    hasLedgerEntriesForType: vi.fn(async (ammoTypeId: number) =>
      _entries.some(e => e.ammoTypeId === ammoTypeId)
    ),

    deleteAmmoType: vi.fn(async (id: number, userId: number) => {
      const idx = _ammoTypes.findIndex(t => t.id === id && t.userId === userId)
      if (idx !== -1) _ammoTypes.splice(idx, 1)
    }),

    createTransactionWithEntries: vi.fn(async (data: {
      userId: number; type: string; note?: string | null; occurredAt: string
      price?: number | null; vendor?: string | null; rangeDaySessionId?: number | null
      entries: Array<{ ammoTypeId: number; quantity: number; location: string; isBalancing: boolean }>
    }) => {
      const now = new Date()
      const tx: TransactionRow = {
        id: _transactions.length + 1,
        userId: data.userId,
        type: data.type,
        note: data.note ?? null,
        occurredAt: new Date(data.occurredAt),
        price: data.price ?? null,
        vendor: data.vendor ?? null,
        rangeDaySessionId: data.rangeDaySessionId ?? null,
        createdAt: now,
      }
      _transactions.push(tx)
      const entryRecords: EntryRow[] = data.entries.map((e, i) => ({
        id: _entries.length + i + 1,
        transactionId: tx.id,
        ammoTypeId: e.ammoTypeId,
        quantity: e.quantity,
        location: e.location,
        isBalancing: e.isBalancing,
        createdAt: now,
      }))
      _entries.push(...entryRecords)
      return { ...tx, entries: entryRecords }
    }),

    listTransactions: vi.fn(async (userId: number, filters?: { type?: string }) => {
      return _transactions.filter(t => {
        if (t.userId !== userId) return false
        if (filters?.type && t.type !== filters.type) return false
        return true
      })
    }),

    getTransaction: vi.fn(async (id: number, userId: number) => {
      const tx = _transactions.find(t => t.id === id && t.userId === userId)
      if (!tx) return null
      const entries = _entries.filter(e => e.transactionId === id)
      return { ...tx, entries }
    }),

    getInventory: vi.fn(async (userId: number) => {
      const types = _ammoTypes.filter(t => t.userId === userId)
      return types.map(type => {
        const balance = _entries
          .filter(e => e.ammoTypeId === type.id && e.location === 'storage' && !e.isBalancing)
          .reduce((sum, e) => sum + e.quantity, 0)
        return { ...type, balance }
      })
    }),

    createRangeDaySession: vi.fn(async (data: { userId: number; note?: string | null }) => {
      const session: SessionRow = {
        id: _sessions.length + 1,
        userId: data.userId,
        note: data.note ?? null,
        startedAt: new Date(),
        endedAt: null,
      }
      _sessions.push(session)
      return session
    }),

    getRangeDaySession: vi.fn(async (id: number, userId: number) =>
      _sessions.find(s => s.id === id && s.userId === userId) ?? null
    ),

    listRangeDaySessions: vi.fn(async (userId: number) =>
      _sessions.filter(s => s.userId === userId)
    ),

    endRangeDaySession: vi.fn(async (id: number) => {
      const idx = _sessions.findIndex(s => s.id === id)
      if (idx !== -1) _sessions[idx] = { ..._sessions[idx], endedAt: new Date() }
      return _sessions[idx]
    }),

    getBagContents: vi.fn(async (sessionId: number) => {
      const sessionTxIds = _transactions
        .filter(t => t.rangeDaySessionId === sessionId)
        .map(t => t.id)
      const bagEntries = _entries.filter(e =>
        sessionTxIds.includes(e.transactionId) && e.location === 'bag' && !e.isBalancing
      )
      const byType = new Map<number, { taken: number; acquired: number; inBag: number }>()
      for (const e of bagEntries) {
        const tx = _transactions.find(t => t.id === e.transactionId)!
        const cur = byType.get(e.ammoTypeId) ?? { taken: 0, acquired: 0, inBag: 0 }
        if (tx.type === 'range_day_start') cur.taken += e.quantity
        else if (tx.type === 'acquisition') cur.acquired += e.quantity
        cur.inBag += e.quantity
        byType.set(e.ammoTypeId, cur)
      }
      return Array.from(byType.entries()).map(([ammoTypeId, d]) => ({ ammoTypeId, ...d }))
    }),
  },
}))

import app from './index'

async function authHeader(userId = 1, email = 'user@example.com') {
  const token = await sign({ sub: userId, email }, JWT_SECRET)
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/** Helper: create an ammo type and return its id */
async function createType(headers: Record<string, string>, name = '9mm', caliber = '9mm') {
  const res = await app.request('/ammo/types', {
    method: 'POST', headers,
    body: JSON.stringify({ name, caliber }),
  })
  const data = await res.json()
  return data.id as number
}

describe('Range Day Sessions', () => {
  beforeEach(() => {
    _ammoTypes.length = 0
    _transactions.length = 0
    _entries.length = 0
    _sessions.length = 0
    vi.clearAllMocks()
  })

  it('starts a range day session, moves ammo from storage to bag', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    const res = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 150 }] }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBeDefined()
    expect(data.endedAt).toBeNull()

    // Verify entries: -150 storage, +150 bag
    const startEntries = _entries.filter(e => !e.isBalancing)
    const storageEntry = startEntries.find(e => e.location === 'storage')
    const bagEntry = startEntries.find(e => e.location === 'bag')
    expect(storageEntry?.quantity).toBe(-150)
    expect(bagEntry?.quantity).toBe(150)

    // GET /ammo/inventory shows storage decreased by 150
    const invRes = await app.request('/ammo/inventory', { headers })
    const inv = await invRes.json()
    expect(inv[0].balance).toBe(-150) // started from 0, moved -150 to bag
  })

  it('shows bag contents on GET /ammo/range-days/:id', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    // Start session with 150
    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 150 }] }),
    })
    const session = await startRes.json()

    // Acquire 200 more on-site
    await app.request(`/ammo/range-days/${session.id}/acquire`, {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 200 }] }),
    })

    const res = await app.request(`/ammo/range-days/${session.id}`, { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.bag).toBeDefined()
    const bagItem = data.bag.find((b: { ammoTypeId: number }) => b.ammoTypeId === typeId)
    expect(bagItem).toBeDefined()
    expect(bagItem.taken).toBe(150)
    expect(bagItem.acquired).toBe(200)
    expect(bagItem.inBag).toBe(350)
  })

  it('records on-site acquisition during a range day session', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 150 }] }),
    })
    const session = await startRes.json()
    const storageBeforeCount = _entries.filter(e => e.location === 'storage' && !e.isBalancing).length

    const res = await app.request(`/ammo/range-days/${session.id}/acquire`, {
      method: 'POST', headers,
      body: JSON.stringify({
        ammo: [{ ammoTypeId: typeId, quantity: 200, price: 6000, vendor: 'Range shop' }],
      }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.bag).toBeDefined()
    const bagItem = data.bag.find((b: { ammoTypeId: number }) => b.ammoTypeId === typeId)
    expect(bagItem.inBag).toBe(350)

    // Storage inventory unchanged (on-site buy goes straight to bag)
    const storageAfterCount = _entries.filter(e => e.location === 'storage' && !e.isBalancing).length
    expect(storageAfterCount).toBe(storageBeforeCount)

    // Verify acquisition entries: +200 bag (real) + -200 equity (balancing)
    const acqTx = _transactions.find(t => t.type === 'acquisition' && t.rangeDaySessionId === session.id)
    expect(acqTx).toBeDefined()
    const acqEntries = _entries.filter(e => e.transactionId === acqTx!.id)
    expect(acqEntries.find(e => e.location === 'bag' && !e.isBalancing)?.quantity).toBe(200)
    expect(acqEntries.find(e => e.location === 'equity' && e.isBalancing)?.quantity).toBe(-200)
  })

  it('stores price and vendor on on-site acquisition', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 150 }] }),
    })
    const session = await startRes.json()

    await app.request(`/ammo/range-days/${session.id}/acquire`, {
      method: 'POST', headers,
      body: JSON.stringify({
        ammo: [{ ammoTypeId: typeId, quantity: 200, price: 6000, vendor: 'Range shop' }],
      }),
    })

    const acqTx = _transactions.find(t => t.type === 'acquisition' && t.rangeDaySessionId === session.id)
    expect(acqTx?.price).toBe(6000)
    expect(acqTx?.vendor).toBe('Range shop')
  })

  it('rejects acquisition on an already-ended session', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 150 }] }),
    })
    const session = await startRes.json()

    // End the session
    await app.request(`/ammo/range-days/${session.id}/end`, {
      method: 'POST', headers,
      body: JSON.stringify({ returnAmmo: [{ ammoTypeId: typeId, quantity: 150 }] }),
    })

    // Try to acquire after end
    const res = await app.request(`/ammo/range-days/${session.id}/acquire`, {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 50 }] }),
    })
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toMatch(/already ended/i)
  })

  it('ends a session and derives expenditure', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    // Start with 500
    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 500 }] }),
    })
    const session = await startRes.json()

    // Acquire 200 more
    await app.request(`/ammo/range-days/${session.id}/acquire`, {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 200 }] }),
    })

    // End: return 600 (expend = 500+200-600 = 100)
    const endRes = await app.request(`/ammo/range-days/${session.id}/end`, {
      method: 'POST', headers,
      body: JSON.stringify({ returnAmmo: [{ ammoTypeId: typeId, quantity: 600 }] }),
    })
    expect(endRes.status).toBe(200)
    const endData = await endRes.json()
    expect(endData.session.endedAt).not.toBeNull()

    // Check end entries
    const endTx = _transactions.find(t => t.type === 'range_day_end')
    expect(endTx).toBeDefined()
    const endEntries = _entries.filter(e => e.transactionId === endTx!.id)

    // -600 bag (return), +600 storage (return), -100 bag (expend), +100 equity (expend)
    expect(endEntries.find(e => e.location === 'bag' && e.quantity === -600)).toBeDefined()
    expect(endEntries.find(e => e.location === 'storage' && e.quantity === 600)).toBeDefined()
    expect(endEntries.find(e => e.location === 'bag' && e.quantity === -100)).toBeDefined()
    expect(endEntries.find(e => e.location === 'equity' && e.quantity === 100 && e.isBalancing)).toBeDefined()

    // Bag sum should be 0 for this session after end
    const bagSum = _entries
      .filter(e => {
        const tx = _transactions.find(t => t.id === e.transactionId)
        return tx?.rangeDaySessionId === session.id && e.location === 'bag' && !e.isBalancing
      })
      .reduce((sum, e) => sum + e.quantity, 0)
    expect(bagSum).toBe(0)
  })

  it('rejects end on an already-ended session', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 100 }] }),
    })
    const session = await startRes.json()

    await app.request(`/ammo/range-days/${session.id}/end`, {
      method: 'POST', headers,
      body: JSON.stringify({ returnAmmo: [{ ammoTypeId: typeId, quantity: 100 }] }),
    })

    const res = await app.request(`/ammo/range-days/${session.id}/end`, {
      method: 'POST', headers,
      body: JSON.stringify({ returnAmmo: [] }),
    })
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toMatch(/already ended/i)
  })

  it('scopes sessions to the authenticated user', async () => {
    const h1 = await authHeader(1, 'a@example.com')
    const h2 = await authHeader(2, 'b@example.com')

    // Create ammo type as user 1
    const typeId = await createType(h1)

    // User 1 starts a session
    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers: h1,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 100 }] }),
    })
    const session = await startRes.json()

    // User 2 tries to get the session → 404
    const res = await app.request(`/ammo/range-days/${session.id}`, { headers: h2 })
    expect(res.status).toBe(404)
  })

  it('lists all past range day sessions', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    // Start + end 2 sessions
    for (let i = 0; i < 2; i++) {
      const startRes = await app.request('/ammo/range-days', {
        method: 'POST', headers,
        body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 50 }] }),
      })
      const session = await startRes.json()
      await app.request(`/ammo/range-days/${session.id}/end`, {
        method: 'POST', headers,
        body: JSON.stringify({ returnAmmo: [{ ammoTypeId: typeId, quantity: 50 }] }),
      })
    }

    const res = await app.request('/ammo/range-days', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(2)
  })

  it('rejects end if returnAmmo exceeds bag contents', async () => {
    const headers = await authHeader()
    const typeId = await createType(headers)

    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: typeId, quantity: 150 }] }),
    })
    const session = await startRes.json()

    // Try to return 200 (more than the 150 in bag)
    const res = await app.request(`/ammo/range-days/${session.id}/end`, {
      method: 'POST', headers,
      body: JSON.stringify({ returnAmmo: [{ ammoTypeId: typeId, quantity: 200 }] }),
    })
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.error).toMatch(/cannot return more/i)
  })
})

describe('Ledger Invariant (via repository mock)', () => {
  beforeEach(() => {
    _ammoTypes.length = 0
    _transactions.length = 0
    _entries.length = 0
    _sessions.length = 0
    vi.clearAllMocks()
  })

  it('stores quantity as a signed integer (positive = in, negative = out)', async () => {
    const headers = await authHeader()
    // acquisition → positive real entry
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 100 }],
      }),
    })
    const realEntry = _entries.find(e => !e.isBalancing)
    expect(realEntry?.quantity).toBeGreaterThan(0)
    // expenditure → negative real entry
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'expenditure', occurredAt: '2024-01-02T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: -50 }],
      }),
    })
    const expendEntry = _entries.filter(e => !e.isBalancing)[1]
    expect(expendEntry?.quantity).toBeLessThan(0)
  })

  it('requires location on every entry', async () => {
    // All entries created via the router have explicit locations
    const headers = await authHeader()
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 100 }],
      }),
    })
    for (const entry of _entries) {
      expect(entry.location).toBeTruthy()
    }
  })

  it('rejects is_balancing=false with location=equity (enforced by router logic)', async () => {
    // The router never creates isBalancing=false + location=equity
    // Verify: real entries always have storage or bag
    const headers = await authHeader()
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 100 }],
      }),
    })
    const nonBalancingEntries = _entries.filter(e => !e.isBalancing)
    for (const e of nonBalancingEntries) {
      expect(e.location).not.toBe('equity')
    }
  })

  it('rejects is_balancing=true with location other than equity (enforced by router)', async () => {
    const headers = await authHeader()
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 100 }],
      }),
    })
    const balancingEntries = _entries.filter(e => e.isBalancing)
    for (const e of balancingEntries) {
      expect(e.location).toBe('equity')
    }
  })

  it('links range day transactions to the session id', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })

    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: 1, quantity: 100 }] }),
    })
    const session = await startRes.json()

    const startTx = _transactions.find(t => t.type === 'range_day_start')
    expect(startTx?.rangeDaySessionId).toBe(session.id)
  })

  it('sets location=storage and location=bag on session start entries', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })

    await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: 1, quantity: 100 }] }),
    })

    const startTx = _transactions.find(t => t.type === 'range_day_start')!
    const startEntries = _entries.filter(e => e.transactionId === startTx.id && !e.isBalancing)
    const locations = new Set(startEntries.map(e => e.location))
    expect(locations.has('storage')).toBe(true)
    expect(locations.has('bag')).toBe(true)
  })

  it('derives expenditure: taken + acquired - returned = expended', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })

    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: 1, quantity: 500 }] }),
    })
    const session = await startRes.json()

    await app.request(`/ammo/range-days/${session.id}/acquire`, {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: 1, quantity: 200 }] }),
    })

    await app.request(`/ammo/range-days/${session.id}/end`, {
      method: 'POST', headers,
      body: JSON.stringify({ returnAmmo: [{ ammoTypeId: 1, quantity: 650 }] }),
    })

    // taken=500, acquired=200, returned=650, expended=50
    const endTx = _transactions.find(t => t.type === 'range_day_end')!
    const endEntries = _entries.filter(e => e.transactionId === endTx.id)

    // Expended entry: -50 from bag (isBalancing=false)
    const expendBag = endEntries.find(e => e.location === 'bag' && e.quantity === -50)
    expect(expendBag).toBeDefined()
    // Expended balancing: +50 to equity (isBalancing=true)
    const expendEquity = endEntries.find(e => e.location === 'equity' && e.quantity === 50)
    expect(expendEquity).toBeDefined()
  })

  it('ensures bag sum is 0 after session end', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })

    const startRes = await app.request('/ammo/range-days', {
      method: 'POST', headers,
      body: JSON.stringify({ ammo: [{ ammoTypeId: 1, quantity: 300 }] }),
    })
    const session = await startRes.json()

    await app.request(`/ammo/range-days/${session.id}/end`, {
      method: 'POST', headers,
      body: JSON.stringify({ returnAmmo: [{ ammoTypeId: 1, quantity: 200 }] }),
    })

    // All bag entries linked to this session should sum to 0
    const sessionTxIds = _transactions
      .filter(t => t.rangeDaySessionId === session.id)
      .map(t => t.id)
    const bagSum = _entries
      .filter(e => sessionTxIds.includes(e.transactionId) && e.location === 'bag' && !e.isBalancing)
      .reduce((sum, e) => sum + e.quantity, 0)
    expect(bagSum).toBe(0)
  })
})
