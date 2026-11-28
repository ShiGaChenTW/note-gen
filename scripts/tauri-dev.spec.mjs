import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, test } from 'node:test'
import { warmPages, startupPages } from './tauri-dev.mjs'

const servers = []
after(() => servers.forEach(server => server.close()))

test('waits for both startup pages to become ready', async () => {
  const attempts = new Map()
  const server = createServer((request, response) => {
    const path = request.url
    const count = (attempts.get(path) ?? 0) + 1
    attempts.set(path, count)
    response.statusCode = path === '/core/main' && count === 1 ? 503 : 200
    response.end(path)
  })
  servers.push(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  await warmPages(baseUrl, ['/', '/core/main'], { retryDelayMs: 10, timeoutMs: 2000 })

  assert.equal(attempts.get('/'), 1)
  assert.equal(attempts.get('/core/main'), 2)
})

test('warms the saved local page after the default desktop page', () => {
  assert.deepEqual(startupPages('/core/setting/general'), ['/', '/core/main', '/core/setting/general'])
  assert.deepEqual(startupPages('/core/article'), ['/', '/core/main'])
  assert.deepEqual(startupPages('/mobile/chat'), ['/', '/core/main'])
  assert.deepEqual(startupPages('https://example.com'), ['/', '/core/main'])
})
