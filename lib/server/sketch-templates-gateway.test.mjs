// /api/pg/sketch_templates: the shared library of saved sketch examples was open to anonymous GET and POST.
// This drives the REAL route handlers (no database needed: anonymous requests are refused before any query).
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test --test-force-exit lib/server/sketch-templates-gateway.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from '../../scripts/test/exec.mjs'

// the gateway decides "is a database configured" when it loads
process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/none'
process.env.AUTH_SECRET = 'test-secret-for-gateway'

const root = resolve(import.meta.dirname, '../..')
const dir = join(root, 'node_modules/.cache/simblip-tests')
mkdirSync(dir, { recursive: true })
const entry = join(dir, 'sketch-templates-gateway.entry.ts')
const out = join(dir, 'sketch-templates-gateway.mjs')
writeFileSync(entry, `export * from '@/app/api/pg/[table]/route'\nexport { signToken } from '@/lib/server/auth'\n`)
const shim = 'import{createRequire as __cr}from"module";import{fileURLToPath as __f}from"url";import{dirname as __d}from"path";const require=__cr(import.meta.url);const __filename=__f(import.meta.url);const __dirname=__d(__filename);'
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, `--alias:@=${root}`, `--banner:js=${shim}`, '--log-level=error'], { cwd: root, stdio: 'pipe' })
const m = await import(`${pathToFileURL(out).href}?t=${Date.now()}`)

const ctx = { params: Promise.resolve({ table: 'simblip_sketch_templates' }) }
const call = (method, headers = {}, body) =>
  m[method](new Request('https://app.example.com/api/pg/simblip_sketch_templates', { method, headers: { 'content-type': 'application/json', ...headers }, body }), ctx)

test('anonymous callers are refused on EVERY method, including the two that used to be open', async () => {
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    const res = await call(method, {}, method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify([{ id: 'x', name: 'spam', component_id: 'resistor', cloud: [[0, 0]] }]))
    assert.equal(res.status, 401, `${method} without a token must be 401, got ${res.status}`)
  }
})

test('a garbage or refresh token is not a session', async () => {
  assert.equal((await call('GET', { authorization: 'Bearer nope' })).status, 401)
  const refresh = m.signToken({ sub: 'u1', role: 'student', inst: 'i1', typ: 'refresh' }, 3600)
  assert.equal((await call('POST', { authorization: `Bearer ${refresh}` }, '[]')).status, 401)
})

test('a signed-in student may not PATCH (edit anyone\'s example): refused by policy before any query', async () => {
  const token = m.signToken({ sub: 'u1', role: 'student', inst: 'i1', typ: 'access' }, 3600)
  const res = await call('PATCH', { authorization: `Bearer ${token}` }, JSON.stringify({ name: 'renamed' }))
  assert.equal(res.status, 403)
})

test('a signed-in student POSTing an oversized or malformed example is refused (400-level), nothing stored', async () => {
  const token = m.signToken({ sub: 'u1', role: 'student', inst: 'i1', typ: 'access' }, 3600)
  const big = [{ id: 'a', name: 'R', component_id: 'resistor', cloud: [[0, 0], [1, 1]], strokes: [Array.from({ length: 20000 }, (_, i) => [i, i])] }]
  const res = await call('POST', { authorization: `Bearer ${token}` }, JSON.stringify(big))
  assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`)
})
