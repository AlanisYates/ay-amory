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
    // Ammo Types
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

    // Transactions
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
      const entryRecords: EntryRow[] = data.entries.map((e, i) => {
        const row: EntryRow = {
          id: _entries.length + i + 1,
          transactionId: tx.id,
          ammoTypeId: e.ammoTypeId,
          quantity: e.quantity,
          location: e.location,
          isBalancing: e.isBalancing,
          createdAt: now,
        }
        return row
      })
      _entries.push(...entryRecords)
      return { ...tx, entries: entryRecords }
    }),

    listTransactions: vi.fn(async (userId: number, filters?: { type?: string; ammoTypeId?: number; occurredAfter?: string; occurredBefore?: string }) => {
      return _transactions.filter(t => {
        if (t.userId !== userId) return false
        if (filters?.type && t.type !== filters.type) return false
        if (filters?.occurredAfter && t.occurredAt < new Date(filters.occurredAfter)) return false
        if (filters?.occurredBefore && t.occurredAt > new Date(filters.occurredBefore)) return false
        return true
      })
    }),

    getTransaction: vi.fn(async (id: number, userId: number) => {
      const tx = _transactions.find(t => t.id === id && t.userId === userId)
      if (!tx) return null
      const entries = _entries
        .filter(e => e.transactionId === id)
        .map(e => ({ ...e, ammoType: _ammoTypes.find(t => t.id === e.ammoTypeId) ?? null }))
      return { ...tx, entries }
    }),

    // Inventory
    getInventory: vi.fn(async (userId: number) => {
      const types = _ammoTypes.filter(t => t.userId === userId)
      return types.map(type => {
        const balance = _entries
          .filter(e => e.ammoTypeId === type.id && e.location === 'storage' && !e.isBalancing)
          .reduce((sum, e) => sum + e.quantity, 0)
        return { ...type, balance }
      })
    }),

    // Range Day Sessions
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

describe('Ammo Types', () => {
  beforeEach(() => {
    _ammoTypes.length = 0
    _transactions.length = 0
    _entries.length = 0
    _sessions.length = 0
    vi.clearAllMocks()
  })

  it('creates an ammo type', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '9mm 115gr FMJ', caliber: '9mm', grain: 115 }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.name).toBe('9mm 115gr FMJ')
    expect(data.caliber).toBe('9mm')
    expect(data.grain).toBe(115)
  })

  it('rejects ammo type with missing required fields', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects ammo type with missing caliber', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/types', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '9mm' }),
    })
    expect(res.status).toBe(400)
  })

  it('lists all ammo types for the authenticated user', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '.223 Rem', caliber: '.223' }),
    })
    const res = await app.request('/ammo/types', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(2)
  })

  it('filters ammo types by user isolation', async () => {
    // User 1 creates a type
    const h1 = await authHeader(1, 'a@example.com')
    await app.request('/ammo/types', {
      method: 'POST', headers: h1,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    // User 2 lists types → empty
    const h2 = await authHeader(2, 'b@example.com')
    const res = await app.request('/ammo/types', { headers: h2 })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(0)
  })

  it('gets a single ammo type by id', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    const res = await app.request('/ammo/types/1', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.name).toBe('9mm')
  })

  it('returns 404 for non-existent ammo type', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/types/999', { headers })
    expect(res.status).toBe(404)
  })

  it('updates an ammo type', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    const res = await app.request('/ammo/types/1', {
      method: 'PATCH', headers,
      body: JSON.stringify({ grain: 124 }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.grain).toBe(124)
  })

  it('rejects update of non-existent ammo type', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/types/999', {
      method: 'PATCH', headers,
      body: JSON.stringify({ grain: 124 }),
    })
    expect(res.status).toBe(404)
  })

  it('deletes an ammo type with no ledger entries', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    const res = await app.request('/ammo/types/1', { method: 'DELETE', headers })
    expect(res.status).toBe(204)
  })

  it('refuses to delete ammo type that has ledger entries', async () => {
    const headers = await authHeader()
    // Create type
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    // Create a transaction referencing it (adds entries to _entries)
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition',
        occurredAt: '2024-01-15T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 500 }],
      }),
    })
    const res = await app.request('/ammo/types/1', { method: 'DELETE', headers })
    expect(res.status).toBe(409)
  })
})

describe('Transactions', () => {
  beforeEach(() => {
    _ammoTypes.length = 0
    _transactions.length = 0
    _entries.length = 0
    _sessions.length = 0
    vi.clearAllMocks()
  })

  it('creates a transaction with balanced entries and storage location', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition',
        occurredAt: '2024-01-15T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 500 }],
      }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.entries).toHaveLength(2)
    const sum = data.entries.reduce((acc: number, e: { quantity: number }) => acc + e.quantity, 0)
    expect(sum).toBe(0)
    const real = data.entries.find((e: { isBalancing: boolean }) => !e.isBalancing)
    expect(real.quantity).toBe(500)
    expect(real.location).toBe('storage')
    const equity = data.entries.find((e: { isBalancing: boolean }) => e.isBalancing)
    expect(equity.quantity).toBe(-500)
    expect(equity.location).toBe('equity')
  })

  it('rejects transaction where entries do not sum to zero', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'transfer',
        occurredAt: '2024-01-15T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 500 }, { ammoTypeId: 2, quantity: -200 }],
      }),
    })
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.error).toMatch(/sum to zero/i)
  })

  it('rejects transaction with no entries', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition',
        occurredAt: '2024-01-15T00:00:00.000Z',
        entries: [],
      }),
    })
    expect(res.status).toBe(422)
  })

  it('creates an expenditure transaction with storage location', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'expenditure',
        occurredAt: '2024-01-20T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: -100 }],
      }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.entries).toHaveLength(2)
    const real = data.entries.find((e: { isBalancing: boolean }) => !e.isBalancing)
    expect(real.quantity).toBe(-100)
    expect(real.location).toBe('storage')
    const equity = data.entries.find((e: { isBalancing: boolean }) => e.isBalancing)
    expect(equity.quantity).toBe(100)
    expect(equity.location).toBe('equity')
  })

  it('creates a transfer transaction between two ammo types', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'transfer',
        occurredAt: '2024-01-15T00:00:00.000Z',
        entries: [
          { ammoTypeId: 1, quantity: -50 },
          { ammoTypeId: 2, quantity: 50 },
        ],
      }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    const sum = data.entries.reduce((acc: number, e: { quantity: number }) => acc + e.quantity, 0)
    expect(sum).toBe(0)
  })

  it('lists transactions for the user', async () => {
    const headers = await authHeader()
    for (let i = 0; i < 3; i++) {
      await app.request('/ammo/transactions', {
        method: 'POST', headers,
        body: JSON.stringify({
          type: 'acquisition',
          occurredAt: '2024-01-15T00:00:00.000Z',
          entries: [{ ammoTypeId: 1, quantity: 100 }],
        }),
      })
    }
    const res = await app.request('/ammo/transactions', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(3)
  })

  it('filters transactions by type', async () => {
    const headers = await authHeader()
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-15T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 100 }],
      }),
    })
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'expenditure', occurredAt: '2024-01-20T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: -50 }],
      }),
    })
    const res = await app.request('/ammo/transactions?type=expenditure', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].type).toBe('expenditure')
  })

  it('filters transactions by date range', async () => {
    const headers = await authHeader()
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-03-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 100 }],
      }),
    })
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-08-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 100 }],
      }),
    })
    const res = await app.request(
      '/ammo/transactions?occurredAfter=2024-01-01&occurredBefore=2024-06-01',
      { headers },
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(1)
  })

  it('returns transaction with full entry detail', async () => {
    const headers = await authHeader()
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-15T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 500 }],
      }),
    })
    const res = await app.request('/ammo/transactions/1', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.entries).toBeDefined()
    expect(Array.isArray(data.entries)).toBe(true)
  })

  it('returns 404 for non-existent transaction', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/transactions/999', { headers })
    expect(res.status).toBe(404)
  })

  it('scopes transactions to authenticated user', async () => {
    const h1 = await authHeader(1, 'a@example.com')
    await app.request('/ammo/transactions', {
      method: 'POST', headers: h1,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-15T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 500 }],
      }),
    })
    const h2 = await authHeader(2, 'b@example.com')
    const res = await app.request('/ammo/transactions/1', { headers: h2 })
    expect(res.status).toBe(404)
  })
})

describe('Inventory', () => {
  beforeEach(() => {
    _ammoTypes.length = 0
    _transactions.length = 0
    _entries.length = 0
    _sessions.length = 0
    vi.clearAllMocks()
  })

  it('returns current inventory from storage-location entries only', async () => {
    const headers = await authHeader()
    // Create ammo type
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    // +500 acquisition
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 500 }],
      }),
    })
    // +200 acquisition
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-02T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 200 }],
      }),
    })
    // -100 expenditure
    await app.request('/ammo/transactions', {
      method: 'POST', headers,
      body: JSON.stringify({
        type: 'expenditure', occurredAt: '2024-01-10T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: -100 }],
      }),
    })

    const res = await app.request('/ammo/inventory', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].balance).toBe(600)
  })

  it('returns zero balance for ammo type with no storage entries', async () => {
    const headers = await authHeader()
    await app.request('/ammo/types', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    const res = await app.request('/ammo/inventory', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].balance).toBe(0)
  })

  it('returns empty array when user has no ammo types', async () => {
    const headers = await authHeader()
    const res = await app.request('/ammo/inventory', { headers })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual([])
  })

  it('isolates storage inventory between users', async () => {
    const h1 = await authHeader(1, 'a@example.com')
    const h2 = await authHeader(2, 'b@example.com')

    // User 1 creates type with id=1
    await app.request('/ammo/types', {
      method: 'POST', headers: h1,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })
    // User 2 creates type with id=2
    await app.request('/ammo/types', {
      method: 'POST', headers: h2,
      body: JSON.stringify({ name: '9mm', caliber: '9mm' }),
    })

    // User 1 adds 500
    await app.request('/ammo/transactions', {
      method: 'POST', headers: h1,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 1, quantity: 500 }],
      }),
    })
    // User 2 adds 200
    await app.request('/ammo/transactions', {
      method: 'POST', headers: h2,
      body: JSON.stringify({
        type: 'acquisition', occurredAt: '2024-01-01T00:00:00.000Z',
        entries: [{ ammoTypeId: 2, quantity: 200 }],
      }),
    })

    const res = await app.request('/ammo/inventory', { headers: h1 })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].balance).toBe(500)
  })
})
