import { Hono } from 'hono'
import { cors } from 'hono/cors'
import auth from './auth'
import ammo from './ammo'
import weapons from './weapons'
import exportApp from './export'
import { runStartupMigrations } from './migrate'

const app = new Hono()

app.use('/*', cors())

app.get('/health', (c) => {
  return c.json({ message: 'Hello, World!' })
})

app.get('/test', (c) => {
  return c.json({ message: 'hello from the api' })
})

app.route('/auth', auth)
app.route('/ammo', ammo)
app.route('/weapons', weapons)
app.route('/', exportApp)

export default app

if (process.env.NODE_ENV !== 'test') {
  const port = 3000
  console.log(`[DEV] API is running on port ${port}`)

  // Self-heal hosts whose postgres volume predates the staged columns,
  // and apply any new versioned migrations. Best-effort: never crash boot
  // (db may still be starting); failures retry on the next restart.
  runStartupMigrations().catch((err) => console.error('[migrate] startup migrations failed:', err))

  import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port })
  })
}
