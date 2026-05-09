import { Hono } from 'hono'
import { jwt, sign } from 'hono/jwt'
import bcrypt from 'bcryptjs'
import { userRepository } from './repository'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'

function stripPassword(user: { password: string; [key: string]: unknown }) {
  const { password: _, ...rest } = user
  return rest
}

const auth = new Hono()

auth.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

auth.post('/signup', async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const existing = await userRepository.findByEmail(email)
  if (existing) {
    return c.json({ error: 'Email already in use' }, 409)
  }

  const hashedPassword = await bcrypt.hash(password, 10)
  const user = await userRepository.create({ email, password: hashedPassword })

  const token = await sign({ sub: user.id, email: user.email }, JWT_SECRET)

  return c.json({ user: stripPassword(user), token }, 201)
})

auth.post('/login', async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const user = await userRepository.findByEmail(email)
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const token = await sign({ sub: user.id, email: user.email }, JWT_SECRET)

  return c.json({ user: stripPassword(user), token })
})

auth.get('/me', jwt({ secret: JWT_SECRET, alg: 'HS256' }), async (c) => {
  const payload = c.get('jwtPayload')
  const user = await userRepository.findById(payload.sub)
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  return c.json({ user: stripPassword(user) })
})

export default auth
