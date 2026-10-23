// /api/ai authentication, rate limiting and model allow-list (audit finding: the route answered anyone,
// without limit, with a client-chosen model, using the server's OpenRouter key).
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test --test-force-exit lib/server/ai-guard.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from '../../scripts/test/exec.mjs'

process.env.AUTH_SECRET = 'test-secret-for-ai-guard'

// The routes pull in server libraries (Redis, Postgres, the model backends) that use __dirname, so they are
// bundled with a CommonJS shim rather than imported as raw TypeScript.
const root = resolve(import.meta.dirname, '../..')
const dir = join(root, 'node_modules/.cache/simblip-tests')
mkdirSync(dir, { recursive: true })
const entry = join(dir, 'ai-guard.entry.ts')
const out = join(dir, 'ai-guard.mjs')
writeFileSync(entry, `
export { authorizeAi, takeAiSlot, allowedModel, visibleModels, isLoopbackRequest, aiLimits, resetAiGuardForTests, MAX_AI_BODY_BYTES } from '@/lib/server/ai-guard'
export { signToken } from '@/lib/server/auth'
export { POST } from '@/app/api/ai/route'
export { GET as GET_MODELS } from '@/app/api/ai/models/route'
`)
const shim = 'import{createRequire as __cr}from"module";import{fileURLToPath as __f}from"url";import{dirname as __d}from"path";const require=__cr(import.meta.url);const __filename=__f(import.meta.url);const __dirname=__d(__filename);'
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, `--alias:@=${root}`, `--banner:js=${shim}`, '--log-level=error'], { cwd: root, stdio: 'pipe' })
const m = await import(`${pathToFileURL(out).href}?t=${Date.now()}`)
const { authorizeAi, takeAiSlot, allowedModel, visibleModels, isLoopbackRequest, aiLimits, resetAiGuardForTests, MAX_AI_BODY_BYTES, signToken, POST, GET_MODELS } = m

const CLOUD = { DATABASE_URL: 'postgres://x' }
const req = (headers = {}, url = 'https://app.example.com/api/ai', init = {}) => new Request(url, { method: 'POST', headers, ...init })
const bearer = (sub, role = 'student', typ = 'access') => ({ authorization: `Bearer ${signToken({ sub, role, inst: 'i1', typ }, 3600)}` })

test.beforeEach(() => resetAiGuardForTests())

// ── who ──────────────────────────────────────────────────────────────────────

test('cloud: no token, a garbage token and a REFRESH token are all refused; an access token passes', () => {
  assert.equal(authorizeAi(req(), CLOUD).ok, false)
  assert.equal(authorizeAi(req(), CLOUD).status, 401)
  assert.equal(authorizeAi(req({ authorization: 'Bearer not.a.token' }), CLOUD).ok, false)
  assert.equal(authorizeAi(req({ authorization: 'Basic abc' }), CLOUD).ok, false)
  assert.equal(authorizeAi(req(bearer('u1', 'student', 'refresh')), CLOUD).ok, false, 'a refresh token is not a session')
  const ok = authorizeAi(req(bearer('u1')), CLOUD)
  assert.equal(ok.ok, true)
  assert.equal(ok.caller.id, 'u1')
})

test('cloud: a token signed with another secret is refused', () => {
  const forged = 'Bearer ' + signToken({ sub: 'u1', role: 'super_admin', inst: null, typ: 'access' }, 3600).replace(/\.[^.]+$/, '.AAAA')
  assert.equal(authorizeAi(req({ authorization: forged }), CLOUD).ok, false)
})

test('local install (no database): only localhost is served, and a forwarded request is not localhost', () => {
  const local = (url, headers = {}) => req({ host: new URL(url).host, ...headers }, url)
  assert.equal(authorizeAi(local('http://localhost:3000/api/ai'), {}).ok, true)
  assert.equal(authorizeAi(local('http://127.0.0.1:3000/api/ai'), {}).ok, true)
  assert.equal(authorizeAi(local('http://[::1]:3000/api/ai'), {}).ok, true)
  const remote = authorizeAi(local('https://app.example.com/api/ai'), {})
  assert.equal(remote.ok, false)
  assert.equal(remote.status, 403)
  assert.equal(authorizeAi(local('http://localhost:3000/api/ai', { 'x-forwarded-for': '203.0.113.9' }), {}).ok, false, 'behind a proxy: not local')
  assert.equal(authorizeAi(local('https://app.example.com/api/ai'), { AI_ALLOW_ANONYMOUS: '1' }).ok, true, 'opened up on purpose')
  assert.equal(isLoopbackRequest(req({ host: 'localhost.evil.com' })), false)
})

// ── how often ────────────────────────────────────────────────────────────────

test('per-minute limit: the request over the limit gets a 429 with a wait; another user is unaffected', async () => {
  const env = { AI_RATE_PER_MIN: '3', AI_MAX_CONCURRENT: '50' }
  for (let i = 0; i < 3; i++) { const s = await takeAiSlot('u1', env); assert.equal(s.ok, true); s.release() }
  const over = await takeAiSlot('u1', env)
  assert.equal(over.ok, false)
  assert.equal(over.status, 429)
  assert.ok(over.retryAfterSec >= 1 && over.retryAfterSec <= 60)
  const other = await takeAiSlot('u2', env)
  assert.equal(other.ok, true, 'the limit is per caller')
  other.release()
})

test('the window resets: a request a minute later is served again', async () => {
  const env = { AI_RATE_PER_MIN: '1', AI_MAX_CONCURRENT: '50' }
  const t0 = 1_000_000
  const first = await takeAiSlot('u1', env, t0)
  first.release()
  assert.equal((await takeAiSlot('u1', env, t0 + 1000)).ok, false)
  const later = await takeAiSlot('u1', env, t0 + 61_000)
  assert.equal(later.ok, true)
  later.release()
})

test('concurrency: slots are released, a stuck caller cannot hold more than the limit, release is idempotent', async () => {
  const env = { AI_MAX_CONCURRENT: '2', AI_RATE_PER_MIN: '1000', AI_RATE_PER_HOUR: '1000' }
  const a = await takeAiSlot('u1', env)
  const b = await takeAiSlot('u1', env)
  assert.equal((await takeAiSlot('u1', env)).ok, false, 'a third at once is refused')
  a.release()
  a.release() // twice must not free a second slot
  const c = await takeAiSlot('u1', env)
  assert.equal(c.ok, true)
  assert.equal((await takeAiSlot('u1', env)).ok, false, 'still two in flight (b and c)')
  b.release()
  c.release()
  assert.equal((await takeAiSlot('u1', env)).ok, true)
})

test('limits come from the environment, with safe defaults', () => {
  assert.deepEqual(aiLimits({}), { perMinute: 20, perHour: 300, maxConcurrent: 2 })
  assert.deepEqual(aiLimits({ AI_RATE_PER_MIN: '5', AI_RATE_PER_HOUR: 'junk', AI_MAX_CONCURRENT: '-1' }), { perMinute: 5, perHour: 300, maxConcurrent: 2 })
})

// ── which model ──────────────────────────────────────────────────────────────

test('cloud: a student cannot pick an arbitrary (expensive) model; the allow-list and admins can', () => {
  const student = { id: 'u1', role: 'student' }
  const env = { ...CLOUD, AI_MODEL_ALLOWLIST: 'cheap/model, other/ok', OPENROUTER_MODEL: 'openrouter/free' }
  assert.equal(allowedModel('anthropic/claude-opus-expensive', student, env), undefined)
  assert.equal(allowedModel('cheap/model', student, env), 'cheap/model')
  assert.equal(allowedModel('openrouter/free', student, env), 'openrouter/free')
  assert.equal(allowedModel('anthropic/claude-opus-expensive', { id: 'a', role: 'admin' }, env), 'anthropic/claude-opus-expensive')
  assert.equal(allowedModel('bad name; drop table', { id: 'a', role: 'admin' }, env), undefined, 'malformed names never pass')
  assert.equal(allowedModel('x'.repeat(200), { id: 'a', role: 'admin' }, env), undefined)
  assert.equal(allowedModel('qwen3:1.7b', { id: 'local', role: 'local' }, {}), 'qwen3:1.7b', 'a local install chooses among its own Ollama models')
})

test('the model picker only lists what the server will accept', () => {
  const list = { backend: 'openrouter', models: ['a/x', 'cheap/model', 'b/y'], default: 'openrouter/free' }
  const env = { ...CLOUD, AI_MODEL_ALLOWLIST: 'cheap/model' }
  assert.deepEqual(visibleModels(list, { id: 'u', role: 'student' }, env).models, ['cheap/model'])
  assert.deepEqual(visibleModels(list, { id: 'a', role: 'admin' }, env).models, list.models)
})

// ── the route itself ─────────────────────────────────────────────────────────
// (bodies are deliberately invalid, so nothing reaches a model: the guard answers first or the schema does)

test('POST /api/ai with no token on a cloud deployment: 401, nothing run', async () => {
  const saved = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgres://x'
  try {
    const res = await POST(new Request('https://app.example.com/api/ai', { method: 'POST', body: JSON.stringify({ prompt: 'hi' }) }))
    assert.equal(res.status, 401)
    assert.match((await res.json()).error, /Sign in/)
  } finally {
    saved === undefined ? delete process.env.DATABASE_URL : (process.env.DATABASE_URL = saved)
  }
})

test('POST /api/ai: a signed-in user passes the guard, an oversized body is refused, and the rate limit answers 429 + Retry-After', async () => {
  const saved = { db: process.env.DATABASE_URL, rate: process.env.AI_RATE_PER_MIN }
  process.env.DATABASE_URL = 'postgres://x'
  process.env.AI_RATE_PER_MIN = '3'
  try {
    const headers = { ...bearer('u-route'), 'content-type': 'application/json' }
    const bad = () => POST(new Request('https://app.example.com/api/ai', { method: 'POST', headers, body: '{"nope":true}' }))
    for (let i = 0; i < 3; i++) assert.equal((await bad()).status, 400, 'past the guard; the schema refuses the body')
    const limited = await bad()
    assert.equal(limited.status, 429)
    assert.ok(Number(limited.headers.get('retry-after')) >= 1)
    resetAiGuardForTests()
    const big = await POST(new Request('https://app.example.com/api/ai', { method: 'POST', headers: { ...headers, 'content-length': String(MAX_AI_BODY_BYTES + 1) }, body: '{}' }))
    assert.equal(big.status, 413)
    // a model the user may not pick is dropped, not an error: here we only prove the slot was released afterwards
    for (let i = 0; i < 3; i++) assert.equal((await bad()).status, 400)
  } finally {
    saved.db === undefined ? delete process.env.DATABASE_URL : (process.env.DATABASE_URL = saved.db)
    saved.rate === undefined ? delete process.env.AI_RATE_PER_MIN : (process.env.AI_RATE_PER_MIN = saved.rate)
  }
})

test('GET /api/ai/models needs the same sign-in', async () => {
  const saved = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgres://x'
  try {
    const res = await GET_MODELS(new Request('https://app.example.com/api/ai/models'))
    assert.equal(res.status, 401)
  } finally {
    saved === undefined ? delete process.env.DATABASE_URL : (process.env.DATABASE_URL = saved)
  }
})
