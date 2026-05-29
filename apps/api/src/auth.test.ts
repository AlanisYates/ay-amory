import { describe, it, expect, vi, beforeEach } from 'vitest'

const _store: Array<{
  id: number
  email: string
  password: string
  firstName: string | null
  lastName: string | null
  createdAt: Date
  updatedAt: Date
}> = []

vi.mock('./repository', () => ({
  userRepository: {
    create: vi.fn(async (data: { email: string; password: string; firstName?: string; lastName?: string }) => {
      const now = new Date()
      const user = { id: _store.length + 1, ...data, firstName: data.firstName ?? null, lastName: data.lastName ?? null, createdAt: now, updatedAt: now }
      _store.push(user)
      return user
    }),
    findByEmail: vi.fn(async (email: string) => {
      return _store.find((u) => u.email === email) || null
    }),
    findById: vi.fn(async (id: number) => {
      return _store.find((u) => u.id === id) || null
    }),
  },
}))

import app from './index'

describe('Auth Flow', () => {
  beforeEach(() => {
    _store.length = 0
    vi.clearAllMocks()
  })

  it('signup, login, and /me with hashed password', async () => {
    const email = 'test@example.com'
    const password = 'securePass123'

    // Step 1: Sign up
    const signupRes = await app.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(signupRes.status).toBe(201)
    const signupData = await signupRes.json()
    expect(signupData.token).toBeTruthy()
    expect(signupData.user.email).toBe(email)
    expect(signupData.user.password).toBeUndefined()

    // Step 2: Fail if password in the DB is not hashed
    const storedUser = _store.find((u) => u.email === email)
    expect(storedUser).toBeDefined()
    expect(storedUser!.password).not.toBe(password)
    expect(storedUser!.password).toMatch(/^\$2[abxy]\$\d+\$/)

    // Step 3: Log in
    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(loginRes.status).toBe(200)
    const loginData = await loginRes.json()
    expect(loginData.token).toBeTruthy()
    expect(loginData.user.email).toBe(email)

    // Step 4: Call /me with token
    const meRes = await app.request('/auth/me', {
      headers: { Authorization: `Bearer ${loginData.token}` },
    })
    expect(meRes.status).toBe(200)
    const meData = await meRes.json()
    expect(meData.user.email).toBe(email)
    expect(meData.user.password).toBeUndefined()
  })
})
