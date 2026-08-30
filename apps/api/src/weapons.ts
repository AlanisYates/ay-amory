import { Hono, Context } from 'hono'
import { jwt } from 'hono/jwt'
import { HTTPException } from 'hono/http-exception'
import { weaponsRepository } from './weapons-repository'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

const VALID_WEAPON_TYPES = new Set(['handgun', 'rifle', 'shotgun'])

const weapons = new Hono()

weapons.use('/*', jwt({ secret: JWT_SECRET, alg: 'HS256' }))

weapons.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

function getUserId(c: Context): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (c as any).get('jwtPayload').sub as number
}

weapons.get('/', async (c) => {
  const userId = getUserId(c)
  return c.json(await weaponsRepository.listWeapons(userId))
})

weapons.post('/', async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json()
  const { name, caliber, type, serialNumber, notes, initialRounds } = body

  if (!name || !caliber || !type) {
    return c.json({ error: 'name, caliber, and type are required' }, 400)
  }
  if (!VALID_WEAPON_TYPES.has(type)) {
    return c.json({ error: `type must be one of: ${[...VALID_WEAPON_TYPES].join(', ')}` }, 400)
  }
  if (initialRounds != null && (!Number.isFinite(Number(initialRounds)) || Number(initialRounds) < 0)) {
    return c.json({ error: 'initialRounds must be a non-negative number' }, 400)
  }

  const weapon = await weaponsRepository.createWeapon({
    userId,
    name,
    caliber,
    type,
    serialNumber: serialNumber ?? null,
    notes: notes ?? null,
    initialRounds: initialRounds != null ? Math.floor(Number(initialRounds)) : 0,
  })
  return c.json(weapon, 201)
})

weapons.get('/firing-summary', async (c) => {
  const userId = getUserId(c)
  return c.json(await weaponsRepository.getWeaponFiringTotals(userId))
})

weapons.get('/:id/history', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const history = await weaponsRepository.getWeaponFiringHistory(id, userId)
  if (!history) return c.json({ error: 'Not found' }, 404)
  return c.json(history)
})

weapons.get('/:id/cleanings', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const weapon = await weaponsRepository.getWeapon(id, userId)
  if (!weapon) return c.json({ error: 'Not found' }, 404)
  return c.json(await weaponsRepository.listCleanings(id, userId))
})

weapons.post('/:id/cleanings', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const weapon = await weaponsRepository.getWeapon(id, userId)
  if (!weapon) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json()
  const history = await weaponsRepository.getWeaponFiringHistory(id, userId)
  const totalRounds = history?.totalRounds ?? 0
  const roundCount = body.roundCountAtCleaning != null ? Number(body.roundCountAtCleaning) : totalRounds
  if (!Number.isFinite(roundCount) || roundCount < 0) return c.json({ error: 'roundCountAtCleaning must be a non-negative number' }, 400)
  const cleanedAt = body.cleanedAt ? new Date(body.cleanedAt) : new Date()
  if (isNaN(cleanedAt.getTime())) return c.json({ error: 'Invalid cleanedAt' }, 400)
  const row = await weaponsRepository.createCleaning({
    weaponId: id,
    userId,
    cleanedAt,
    roundCountAtCleaning: roundCount,
    note: body.note ?? null,
  })
  return c.json(row, 201)
})

weapons.delete('/:id/cleanings/:cleaningId', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const cleaningId = Number(c.req.param('cleaningId'))
  const weapon = await weaponsRepository.getWeapon(id, userId)
  if (!weapon) return c.json({ error: 'Not found' }, 404)
  await weaponsRepository.deleteCleaning(cleaningId, id, userId)
  return new Response(null, { status: 204 })
})

weapons.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const weapon = await weaponsRepository.getWeapon(id, userId)
  if (!weapon) return c.json({ error: 'Not found' }, 404)
  return c.json(weapon)
})

weapons.patch('/:id', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  if (body.initialRounds !== undefined && body.initialRounds !== null && (!Number.isFinite(Number(body.initialRounds)) || Number(body.initialRounds) < 0)) {
    return c.json({ error: 'initialRounds must be a non-negative number' }, 400)
  }
  if (body.initialRounds !== undefined && body.initialRounds !== null) body.initialRounds = Math.floor(Number(body.initialRounds))
  const updated = await weaponsRepository.updateWeapon(id, userId, body)
  if (!updated) return c.json({ error: 'Not found' }, 404)
  return c.json(updated)
})

weapons.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const id = Number(c.req.param('id'))
  const weapon = await weaponsRepository.getWeapon(id, userId)
  if (!weapon) return c.json({ error: 'Not found' }, 404)
  await weaponsRepository.deleteWeapon(id, userId)
  return new Response(null, { status: 204 })
})

export default weapons
