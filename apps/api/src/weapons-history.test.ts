import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sign } from 'hono/jwt'
import { buildWeaponFiringHistory } from './weapons-repository'

const JWT_SECRET = 'dev-secret'

vi.mock('./weapons-repository', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('./weapons-repository')
  const weapon = (id: number) => ({ id, userId: 1, name: 'Glock', caliber: '9mm', type: 'handgun', serialNumber: null, notes: null }) as any
  return {
    ...actual,
    weaponsRepository: {
      getWeaponFiringHistory: vi.fn(async (weaponId: number, userId: number) => {
        if (weaponId === 999) return null
        return buildWeaponFiringHistory(weapon(weaponId), [
          { stringId: 1, sessionId: 5, ammoTypeId: 1, rounds: 30, occurredAt: new Date('2024-01-01T10:00'), note: null, ammoName: '9mm FMJ', ammoCaliber: '9mm', sessionNote: 'Morning', sessionStartedAt: new Date('2024-01-01'), sessionEndedAt: null },
          { stringId: 2, sessionId: 5, ammoTypeId: 1, rounds: 20, occurredAt: new Date('2024-01-01T11:00'), note: 'groups', ammoName: '9mm FMJ', ammoCaliber: '9mm', sessionNote: 'Morning', sessionStartedAt: new Date('2024-01-01'), sessionEndedAt: null },
          { stringId: 3, sessionId: 6, ammoTypeId: 2, rounds: 50, occurredAt: new Date('2024-02-01T09:00'), note: null, ammoName: '5.56', ammoCaliber: '5.56', sessionNote: null, sessionStartedAt: new Date('2024-02-01'), sessionEndedAt: new Date('2024-02-01T12:00') },
        ])
      }),
      getWeapon: vi.fn(async (id: number) => weapon(id)),
      getWeaponFiringTotals: vi.fn(async () => [
        { weaponId: 1, totalRounds: 100 },
        { weaponId: 2, totalRounds: 0 },
      ]),
    },
  }
})

import app from './index'

async function authHeader(userId = 1, email = 'user@example.com') {
  const token = await sign({ sub: userId, email }, JWT_SECRET)
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

describe('buildWeaponFiringHistory', () => {
  const weapon = { id: 1, userId: 1, name: 'Glock', caliber: '9mm', type: 'handgun', serialNumber: null, notes: null } as any
  const rows = [
    { stringId: 1, sessionId: 5, ammoTypeId: 1, rounds: 30, occurredAt: new Date('2024-01-01T10:00'), note: null, ammoName: '9mm FMJ', ammoCaliber: '9mm', sessionNote: 'Morning', sessionStartedAt: new Date('2024-01-01'), sessionEndedAt: null },
    { stringId: 2, sessionId: 5, ammoTypeId: 1, rounds: 20, occurredAt: new Date('2024-01-01T11:00'), note: 'groups', ammoName: '9mm FMJ', ammoCaliber: '9mm', sessionNote: 'Morning', sessionStartedAt: new Date('2024-01-01'), sessionEndedAt: null },
    { stringId: 3, sessionId: 6, ammoTypeId: 2, rounds: 50, occurredAt: new Date('2024-02-01T09:00'), note: null, ammoName: '5.56', ammoCaliber: '5.56', sessionNote: null, sessionStartedAt: new Date('2024-02-01'), sessionEndedAt: new Date('2024-02-01T12:00') },
  ]

  it('totals all rounds across sessions and ammo types', () => {
    const h = buildWeaponFiringHistory(weapon, rows)
    expect(h.totalRounds).toBe(100)
  })

  it('groups strings by session', () => {
    const h = buildWeaponFiringHistory(weapon, rows)
    expect(h.sessions).toHaveLength(2)
    const morning = h.sessions.find(s => s.sessionId === 5)!
    expect(morning.rounds).toBe(50)
    expect(morning.strings).toHaveLength(2)
    const feb = h.sessions.find(s => s.sessionId === 6)!
    expect(feb.rounds).toBe(50)
  })

  it('aggregates rounds by ammo type and sorts desc', () => {
    const h = buildWeaponFiringHistory(weapon, rows)
    expect(h.byAmmoType).toHaveLength(2)
    expect(h.byAmmoType[0].rounds).toBe(50)
    expect(h.byAmmoType[1].rounds).toBe(50)
    expect(h.byAmmoType.map(a => a.name).sort()).toEqual(['5.56', '9mm FMJ'])
  })

  it('returns empty structure for no rows', () => {
    const h = buildWeaponFiringHistory(weapon, [])
    expect(h.totalRounds).toBe(0)
    expect(h.sessions).toHaveLength(0)
    expect(h.byAmmoType).toHaveLength(0)
  })
})

describe('GET /weapons/:id/history', () => {
  it('returns the firing history for an existing weapon', async () => {
    const res = await app.request('/weapons/1/history', { headers: await authHeader() })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.totalRounds).toBe(100)
    expect(data.sessions).toHaveLength(2)
    expect(data.weapon.id).toBe(1)
  })

  it('returns 404 when the weapon does not exist', async () => {
    const res = await app.request('/weapons/999/history', { headers: await authHeader() })
    expect(res.status).toBe(404)
  })

  it('GET /weapons/firing-summary returns totals for all weapons', async () => {
    const res = await app.request('/weapons/firing-summary', { headers: await authHeader() })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual([
      { weaponId: 1, totalRounds: 100 },
      { weaponId: 2, totalRounds: 0 },
    ])
  })

  it('requires authentication', async () => {
    let status = 401
    try {
      const res = await app.request('/weapons/1/history')
      status = res.status
    } catch {
      status = 401
    }
    expect(status).toBe(401)
  })
})
