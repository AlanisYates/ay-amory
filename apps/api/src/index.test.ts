import app from './index'

describe('Healthcheck endpoint', () => {
  it('GET /health returns 200 with Hello World message', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Hello, World!')
  })
})
