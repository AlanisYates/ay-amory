import { useState } from 'react'

function App() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState<{ email: string } | null>(null)
  const [error, setError] = useState('')

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

      let data: { error?: string; user?: { email: string } }
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

      setUser(data.user!)
    } catch (err) {
      setError(err instanceof TypeError ? 'Failed to connect to server — is the API running on port 3000?' : 'Failed to connect to server')
    }
  }

  const handleLogout = () => {
    setUser(null)
    setEmail('')
    setPassword('')
    setError('')
  }

  if (user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-2xl mb-4">Logged in as: {user.email}</p>
          <button
            onClick={handleLogout}
            className="text-2xl px-8 py-4 rounded-lg bg-black text-white cursor-pointer hover:opacity-80 transition-opacity"
          >
            Logout
          </button>
        </div>
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
