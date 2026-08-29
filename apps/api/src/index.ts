import { Hono } from 'hono'
import { cors } from 'hono/cors'
import auth from './auth'
import ammo from './ammo'
import weapons from './weapons'

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

export default app

if (process.env.NODE_ENV !== 'test') {
  const port = 3000
  console.log(`[DEV] API is running on port ${port}`)

  import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port })
  })
}
