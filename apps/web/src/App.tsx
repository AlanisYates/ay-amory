import { useState, useEffect } from 'react'

const TOKEN_KEY = 'ay-armory-token'

function App() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState<{ email: string; firstName?: string | null } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setLoading(false)
      return
    }

    fetch('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const endpoint = mode === 'signin' ? '/auth/login' : '/auth/signup'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      let data: { error?: string; user?: { email: string }; token?: string }
      try {
        data = await res.json()
      } catch {
        const text = await res.text()
        setError(text || `Server error (${res.status})`)
        return
      }

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }

      localStorage.setItem(TOKEN_KEY, data.token!)
      setUser(data.user!)
    } catch (err) {
      setError(err instanceof TypeError ? 'Failed to connect to server — is the API running on port 3000?' : 'Failed to connect to server')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    setEmail('')
    setPassword('')
    setError('')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-neutral-500">
        Loading...
      </div>
    )
  }

  if (user) {
    return (
      <div className="min-h-screen bg-neutral-50">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto max-w-6xl flex items-center justify-between px-6 h-16">
            <h1 className="text-xl font-bold tracking-tight">ay-armory</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-neutral-500">{user.email}</span>
              <button
                onClick={handleLogout}
                className="text-sm px-4 py-2 rounded-lg bg-black text-white cursor-pointer hover:opacity-80 transition-opacity"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">
          <h2 className="text-3xl font-semibold text-neutral-900 mb-8">Welcome{user.firstName ? `, ${user.firstName}` : ''}</h2>

          <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-neutral-900 mb-4">Armory Status</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-neutral-50 p-5">
                <p className="text-sm text-neutral-500 mb-1">9mm</p>
                <p className="text-3xl font-bold text-neutral-900">500</p>
              </div>
              <div className="rounded-lg bg-neutral-50 p-5">
                <p className="text-sm text-neutral-500 mb-1">.223</p>
                <p className="text-3xl font-bold text-neutral-900">1,000</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-80">
        <h1 className="text-2xl font-bold text-center">ay-armory</h1>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="px-4 py-2 border rounded-lg"
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="px-4 py-2 border rounded-lg"
          required
        />

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          type="submit"
          className="text-lg px-8 py-3 rounded-lg bg-black text-white cursor-pointer hover:opacity-80 transition-opacity"
        >
          {mode === 'signin' ? 'Sign In' : 'Sign Up'}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
        >
          {mode === 'signin'
            ? "Don't have an account? Sign Up"
            : 'Already have an account? Sign In'}
        </button>
      </form>
    </div>
  )
}

export default App
