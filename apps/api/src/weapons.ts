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
  const { name, caliber, type, serialNumber, notes } = body

  if (!name || !caliber || !type) {
    return c.json({ error: 'name, caliber, and type are required' }, 400)
  }
  if (!VALID_WEAPON_TYPES.has(type)) {
    return c.json({ error: `type must be one of: ${[...VALID_WEAPON_TYPES].join(', ')}` }, 400)
  }

  const weapon = await weaponsRepository.createWeapon({
    userId,
    name,
    caliber,
    type,
    serialNumber: serialNumber ?? null,
    notes: notes ?? null,
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
