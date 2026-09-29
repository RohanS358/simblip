// End-to-end tests for cloud sync + the 150 MB project quota, run against a
// REAL Postgres (the quota's correctness depends on transactions and advisory
// locks, which a mock can't prove). Calls the actual route handlers.
//
//   TEST_DATABASE_URL=postgres://…/simblip_test \
//   node --experimental-strip-types --import ./scripts/test/register.mjs \
//        app/api/sync/sync.integration.test.mjs
//
// The database must be a THROWAWAY one: the test loads db/schema.sql into it
// and creates/deletes its own institution and accounts. Skips without the env.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const url = process.env.TEST_DATABASE_URL
if (!url) {
  test('sync integration (skipped: set TEST_DATABASE_URL to a throwaway Postgres)', { skip: true }, () => {})
} else {
  process.env.DATABASE_URL = url
  process.env.AUTH_SECRET = 'integration-test-secret-' + randomUUID()
  delete process.env.REDIS_URL

  const { q, getPool } = await import('../../../lib/server/pg.ts')
  const { signToken } = await import('../../../lib/server/auth.ts')
  const sync = await import('./route.ts')
  const storage = await import('../storage/[id]/route.ts')
  const usageRoute = await import('../storage/usage/route.ts')
  const gateway = await import('../pg/[table]/route.ts')
  const { PROJECT_QUOTA_BYTES } = await import('../../../lib/storage/quota.ts')

  await getPool().query(readFileSync(new URL('../../../db/schema.sql', import.meta.url), 'utf8'))

  const inst = randomUUID()
  const alice = randomUUID()
  const bob = randomUUID()
  await q(`insert into simblip_institutions (id, name, slug) values ($1, 'Test', $2)`, [inst, 'test-' + inst])
  for (const [id, name] of [[alice, 'alice'], [bob, 'bob']]) {
    await q(`insert into simblip_profiles (id, institution_id, full_name, email) values ($1, $2, $3, $4)`, [
      id,
      inst,
      name,
      `${name}-${id}@test.local`,
    ])
  }
  const tok = (sub) => signToken({ sub, role: 'student', inst, typ: 'access' }, 3600)
  const H = (sub, extra = {}) => ({ Authorization: `Bearer ${tok(sub)}`, ...extra })

  const push = async (sub, body) => {
    const res = await sync.POST(
      new Request('http://t/api/sync', { method: 'POST', headers: H(sub, { 'content-type': 'application/json' }), body: JSON.stringify(body) })
    )
    return { status: res.status, body: await res.json() }
  }
  const pull = async (sub, since = '') => {
    const res = await sync.GET(new Request(`http://t/api/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`, { headers: H(sub) }))
    return res.json()
  }
  const put = async (sub, id, bytes, sha) => {
    const qs = new URLSearchParams({ name: `${id}.bin`, mime: 'application/octet-stream', sha256: sha ?? createHash('sha256').update(bytes).digest('hex') })
    const res = await storage.PUT(
      new Request(`http://t/api/storage/${id}?${qs}`, { method: 'PUT', headers: H(sub), body: bytes }),
      { params: Promise.resolve({ id }) }
    )
    return { status: res.status, body: await res.json() }
  }
  const del = (sub, id) =>
    storage.DELETE(new Request(`http://t/api/storage/${id}`, { method: 'DELETE', headers: H(sub) }), { params: Promise.resolve({ id }) })
  const usage = async (sub) => (await usageRoute.GET(new Request('http://t/api/storage/usage', { headers: H(sub) }))).json()

  test.after(async () => {
    await q('delete from simblip_institutions where id = $1', [inst]) // cascades to everything
    await getPool().end()
  })

  test('push → rev 1, pull returns it, sizes are server-measured', async () => {
    const content = { objects: { a: { id: 'a', x: 1 } }, variables: [] }
    const r = await push(alice, { workspace: { tree: { p1: { id: 'p1', kind: 'page' } }, baseRev: null }, pages: [{ id: 'p1', content, baseRev: null }] })
    assert.equal(r.status, 200)
    assert.equal(r.body.revs.p1, 1)
    assert.equal(r.body.workspace.rev, 1)
    const p = await pull(alice)
    assert.equal(p.pages.find((x) => x.id === 'p1').rev, 1)
    const [row] = await q('select size_bytes from simblip_pages where id = $1', ['p1'])
    assert.equal(Number(row.size_bytes), Buffer.byteLength(JSON.stringify(content))) // null viewport measures 0
  })

  test('stale base rev → conflict with the server copy, nothing overwritten', async () => {
    await push(alice, { pages: [{ id: 'p1', content: { objects: {}, v: 'device A' }, baseRev: 1 }] }) // → rev 2
    const r = await push(alice, { pages: [{ id: 'p1', content: { objects: {}, v: 'device B' }, baseRev: 1 }] })
    assert.equal(r.status, 200)
    assert.equal(r.body.conflicts.length, 1)
    assert.equal(r.body.conflicts[0].content.v, 'device A')
    const [row] = await q('select content, rev from simblip_pages where id = $1', ['p1'])
    assert.equal(row.content.v, 'device A')
    assert.equal(Number(row.rev), 2)
    // resolved: push on top of the server rev
    const ok = await push(alice, { pages: [{ id: 'p1', content: { objects: {}, v: 'device B' }, baseRev: 2 }] })
    assert.equal(ok.body.revs.p1, 3)
  })

  test('identical content with no base rev is adopted, not a conflict', async () => {
    const [row] = await q('select content from simblip_pages where id = $1', ['p1'])
    const r = await push(alice, { pages: [{ id: 'p1', content: row.content, baseRev: null }] })
    assert.equal(r.body.conflicts.length, 0)
    assert.equal(r.body.revs.p1, 3)
  })

  test('tree conflict returns the server tree for a client-side merge', async () => {
    const r = await push(alice, { workspace: { tree: { stale: { id: 'stale' } }, baseRev: 0 } })
    assert.ok(r.body.workspace.conflict)
    assert.ok(r.body.workspace.conflict.tree.p1)
  })

  test("another account's page id can't be overwritten or taken over", async () => {
    const r = await push(bob, { pages: [{ id: 'p1', content: { hijack: true }, baseRev: null, force: true }] })
    assert.equal(r.status, 200)
    assert.equal(r.body.revs.p1, undefined)
    const [row] = await q('select workspace_id, content from simblip_pages where id = $1', ['p1'])
    assert.equal(row.workspace_id, alice)
    assert.notEqual(row.content.hijack, true)
    const bobPull = await pull(bob)
    assert.equal(bobPull.pages.length, 0)
  })

  test('gateway refuses direct writes to sync-only tables', async () => {
    const res = await gateway.POST(
      new Request('http://t/api/pg/simblip_pages', {
        method: 'POST',
        headers: H(alice, { 'content-type': 'application/json' }),
        body: JSON.stringify([{ id: 'x', content: {} }]),
      }),
      { params: Promise.resolve({ table: 'simblip_pages' }) }
    )
    assert.equal(res.status, 405)
  })

  test('gateway upsert cannot take over another owner’s file manifest row', async () => {
    const bytes = Buffer.from('alice secret')
    assert.equal((await put(alice, 'fileA', bytes)).status, 200)
    await gateway.POST(
      new Request('http://t/api/pg/simblip_file_manifest', {
        method: 'POST',
        headers: H(bob, { 'content-type': 'application/json' }),
        body: JSON.stringify([{ id: 'fileA', name: 'mine now', mime: 'x', size: 1, sha256: 'x' }]),
      }),
      { params: Promise.resolve({ table: 'simblip_file_manifest' }) }
    )
    const [row] = await q('select owner_id, name from simblip_file_manifest where id = $1', ['fileA'])
    assert.equal(row.owner_id, alice)
    assert.equal(row.name, 'fileA.bin')
    const res = await storage.GET(new Request('http://t/api/storage/fileA', { headers: H(bob) }), { params: Promise.resolve({ id: 'fileA' }) })
    assert.equal(res.status, 404)
  })

  test("bob can't overwrite alice's file bytes", async () => {
    const r = await put(bob, 'fileA', Buffer.from('bob bytes'))
    assert.equal(r.status, 403)
    const [row] = await q('select data from simblip_file_blobs where id = $1', ['fileA'])
    assert.equal(row.data.toString(), 'alice secret')
  })

  test('corrupted upload (hash mismatch) is rejected and stores nothing', async () => {
    const r = await put(alice, 'fileBad', Buffer.from('abc'), 'deadbeef')
    assert.equal(r.status, 422)
    const rows = await q('select 1 from simblip_file_manifest where id = $1', ['fileBad'])
    assert.equal(rows.length, 0)
  })

  test('re-uploading identical bytes is deduped (no second write, no extra quota)', async () => {
    const before = (await usage(alice)).used
    const r = await put(alice, 'fileA', Buffer.from('alice secret'))
    assert.equal(r.body.deduped, true)
    assert.equal((await usage(alice)).used, before)
  })

  test('active content types are served as downloads with nosniff + sandbox', async () => {
    await put(alice, 'fileHtml', Buffer.from('<script>alert(1)</script>'))
    await q(`update simblip_file_manifest set mime = 'text/html' where id = 'fileHtml'`)
    const res = await storage.GET(new Request('http://t/api/storage/fileHtml', { headers: H(alice) }), { params: Promise.resolve({ id: 'fileHtml' }) })
    assert.equal(res.headers.get('content-type'), 'application/octet-stream')
    assert.match(res.headers.get('content-disposition'), /^attachment/)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(res.headers.get('content-security-policy'), /sandbox/)
  })

  test('150 MB quota: concurrent uploads cannot overshoot, deletes release space', async () => {
    const base = (await usage(bob)).used
    const chunk = 45 * 1024 * 1024 // 4 × 45 MB = 180 MB > 150 MB
    const bufs = [0, 1, 2, 3].map((i) => Buffer.alloc(chunk, i + 1))
    const results = await Promise.all(bufs.map((b, i) => put(bob, `big${i}`, b)))
    const ok = results.filter((r) => r.status === 200).length
    const refused = results.filter((r) => r.status === 413)
    assert.equal(ok, 3, 'exactly three 45 MB files fit in 150 MB')
    assert.equal(refused.length, 1)
    assert.equal(refused[0].body.error, 'quota_exceeded')
    const u = await usage(bob)
    assert.equal(u.limit, PROJECT_QUOTA_BYTES)
    assert.equal(u.used, base + 3 * chunk)
    assert.ok(u.used <= PROJECT_QUOTA_BYTES)
    // A page push that would overflow is rejected atomically…
    const big = { blob: 'x'.repeat(19 * 1024 * 1024) }
    const over = await push(bob, { pages: [{ id: 'bobp', content: big, baseRev: null }] })
    assert.equal(over.status, 413)
    assert.equal((await q('select 1 from simblip_pages where id = $1', ['bobp'])).length, 0)
    // …until space is released.
    const okIdx = results.findIndex((r) => r.status === 200)
    await del(bob, `big${okIdx}`)
    assert.equal((await usage(bob)).used, base + 2 * chunk)
    const fits = await push(bob, { pages: [{ id: 'bobp', content: big, baseRev: null }] })
    assert.equal(fits.status, 200)
  })

  test('shrinking writes are always allowed, even at the limit', async () => {
    const r = await push(bob, { pages: [{ id: 'bobp', content: { small: true }, baseRev: 1 }] })
    assert.equal(r.status, 200)
  })

  test('deleting a page through sync releases its bytes', async () => {
    const before = (await usage(alice)).used
    const [row] = await q('select size_bytes from simblip_pages where id = $1', ['p1'])
    await push(alice, { deletes: ['p1'] })
    assert.equal((await usage(alice)).used, before - Number(row.size_bytes))
  })

  test('account data (calendar) syncs as kv with revisions', async () => {
    const value = { events: [{ id: 'e1', date: '2026-09-29', title: 'Lab' }], todos: [], notes: [], eventColors: [] }
    const r = await push(alice, { kv: [{ key: 'gallery', value, baseRev: null }] })
    assert.equal(r.body.kv.gallery, 1)
    const stale = await push(alice, { kv: [{ key: 'gallery', value: { ...value, events: [] }, baseRev: 0 }] })
    assert.equal(stale.body.kvConflicts[0].value.events[0].title, 'Lab')
    const p = await pull(alice)
    assert.equal(p.kv[0].value.events[0].title, 'Lab')
  })

  test('incremental pull only returns rows changed since the cursor', async () => {
    const first = await pull(alice)
    await push(alice, { pages: [{ id: 'p9', content: { n: 9 }, baseRev: null }] })
    const next = await pull(alice, first.now)
    assert.deepEqual(next.pages.map((p) => p.id), ['p9'])
  })

  test('account deletion cascades every blob and row', async () => {
    const tmp = randomUUID()
    await q(`insert into simblip_profiles (id, institution_id, full_name, email) values ($1, $2, 'tmp', $3)`, [tmp, inst, `tmp-${tmp}@t`])
    await push(tmp, { pages: [{ id: 'tmpP', content: { a: 1 }, baseRev: null }], kv: [{ key: 'gallery', value: {}, baseRev: null }] })
    await put(tmp, 'tmpF', Buffer.from('bye'))
    await q('delete from simblip_profiles where id = $1', [tmp])
    for (const [t, col] of [['simblip_pages', 'workspace_id'], ['simblip_user_kv', 'owner_id'], ['simblip_file_manifest', 'owner_id']]) {
      assert.equal((await q(`select 1 from ${t} where ${col} = $1`, [tmp])).length, 0, t)
    }
    assert.equal((await q(`select 1 from simblip_file_blobs where id = 'tmpF'`)).length, 0)
  })
}
