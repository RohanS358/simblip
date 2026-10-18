// Run: node --test ai-server/server.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createServer, makeGate, makeLimiter } from './server.mjs'

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)))
const seen = []
const up = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c)
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }))
  const b = JSON.parse(Buffer.concat(chunks)); seen.push(b)
  res.write(JSON.stringify({ message: { content: 'hi' }, done: false }) + '\n')
  res.end(JSON.stringify({ done: true, eval_count: 7, prompt_eval_count: 3 }) + '\n')
})
const upPort = await listen(up)
const cfg = { port: 0, host: '127.0.0.1', key: 'k'.repeat(24), upstream: `http://127.0.0.1:${upPort}`, concurrency: 1, maxQueue: 1, ratePerMin: 1000, keepAlive: '30m', aliases: { 'simblip-script': { model: 'ft', system: 'SHORT' }, 'simblip-explain': { model: 'qwen3:8b', think: false, options: { temperature: 0.3 } } } }
const srv = createServer(cfg); const port = await listen(srv)
const call = (path, opt = {}, key = cfg.key) => fetch(`http://127.0.0.1:${port}${path}`, { ...opt, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' } })
test.after(() => { srv.close(); up.close() })

test('rejects missing and wrong keys, allows healthz', async () => {
  assert.equal((await call('/api/tags', {}, '')).status, 401)
  assert.equal((await call('/api/tags', {}, 'wrong')).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200)
})
test('alias maps to the real model, injects keep_alive and think, and streams through', async () => {
  const r = await call('/api/chat', { method: 'POST', body: JSON.stringify({ model: 'simblip-explain', messages: [], options: { num_ctx: 2048 } }) })
  assert.equal(r.status, 200)
  assert.match(await r.text(), /"eval_count":7/)
  const b = seen.at(-1)
  assert.equal(b.model, 'qwen3:8b'); assert.equal(b.think, false); assert.equal(b.keep_alive, '30m')
  assert.deepEqual(b.options, { temperature: 0.3, num_ctx: 2048 })
})
test('tags lists the lane aliases first', async () => {
  const j = await (await call('/api/tags')).json()
  assert.deepEqual(j.models.slice(0, 2).map((m) => m.name), ['simblip-script', 'simblip-explain'])
})
test('gate: bounded queue rejects overflow; release hands the slot on', async () => {
  const g = makeGate(1, 1)
  const r1 = await g.acquire()
  const p2 = g.acquire()
  await assert.rejects(g.acquire(), { code: 'full' })
  r1(); const r2 = await p2; r2()
})
test('rate limiter allows N per minute then refuses', () => {
  const t = 1_000_000; const l = makeLimiter(2, () => t)
  assert.deepEqual([l('a'), l('a'), l('a'), l('b')], [true, true, false, true])
})

test('fine-tuned lane swaps the long prompt and few-shots for its short system prompt', async () => {
  const messages = [{ role: 'system', content: 'LONG'.repeat(500) }, { role: 'user', content: 'shot q' }, { role: 'assistant', content: 'shot a' }, { role: 'user', content: 'real request' }]
  await (await call('/api/chat', { method: 'POST', body: JSON.stringify({ model: 'simblip-script', messages }) })).text()
  assert.deepEqual(seen.at(-1).messages, [{ role: 'system', content: 'SHORT' }, { role: 'user', content: 'real request' }])
  assert.equal(seen.at(-1).model, 'ft')
})
