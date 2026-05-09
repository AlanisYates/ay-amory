import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => {
  return c.json({ message: 'Hello, World!' })
})

app.get('/test', (c) => {
  return c.json({ message: 'hello from the api' })
})

export default app

if (process.env.NODE_ENV !== 'test') {
  const port = 3000
  console.log(`[DEV] API is running on port ${port}`)

  import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port })
  })
}
