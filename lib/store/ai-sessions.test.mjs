// Named, resumable AI conversations.
//
// There was only ever ONE thread: clearing it was the only way to start a new
// topic, and it was then gone for good. Sessions make a thread a thing you
// can name, list, leave and come back to with its memory intact.
//
// Stored in IndexedDB rather than the synced database: a thread is working
// context, not a document, and turns hold whole generated scripts and
// derivations. localStorage was not an option either — the chat already
// competes with page content for the same 5MB quota, and page content wins.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import 'fake-indexeddb/auto'

const root = resolve(import.meta.dirname, '../..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-sessions-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')
// The auth store pulls React in for its hook; only ACTIVE_USER_KEY is needed
// here, so stub that module rather than bundling a UI tree into the test.
const authStub = join(dir, 'auth-stub.ts')
writeFileSync(authStub, `export const ACTIVE_USER_KEY = 'simblip-active-user'\n`)
writeFileSync(entry, `
export {
  listSessions, loadSession, saveSession, deleteSession, renameSession, deriveTitle,
} from '@/lib/store/ai-sessions'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, `--alias:@/lib/auth/store=${authStub}`], { cwd: root, stdio: 'pipe' })
const { listSessions, loadSession, saveSession, deleteSession, renameSession, deriveTitle } =
  await import(bundle)

const turn = (prompt) => ({ id: prompt, prompt, script: '', status: 'ok' })
const mk = (id, title, turns, at = Date.now()) =>
  ({ id, title, createdAt: at, updatedAt: at, turns })

test('a saved session round-trips with its turns intact', async () => {
  await saveSession(mk('s1', 'EM waves', [turn('explain gauss law'), turn('now simulate it')]))
  const got = await loadSession('s1')
  assert.equal(got.title, 'EM waves')
  assert.equal(got.turns.length, 2)
  // The turns ARE the memory — resuming with an empty thread would defeat
  // the entire feature.
  assert.equal(got.turns[1].prompt, 'now simulate it')
})

test('the list shows metadata without loading every turn', async () => {
  const list = await listSessions()
  const row = list.find((s) => s.id === 's1')
  assert.equal(row.turnCount, 2)
  assert.equal(row.turns, undefined, 'turns must not be carried in the list payload')
})

test('sessions list most-recently-used first', async () => {
  const t = Date.now()
  await saveSession(mk('old', 'Older', [turn('a')], t - 100_000))
  await saveSession(mk('new', 'Newer', [turn('b')], t))
  const ids = (await listSessions()).map((s) => s.id)
  assert.ok(ids.indexOf('new') < ids.indexOf('old'), 'the thread being resumed is the recent one')
})

test('saving again updates in place rather than duplicating', async () => {
  const before = (await listSessions()).filter((s) => s.id === 's1').length
  await saveSession(mk('s1', 'EM waves', [turn('a'), turn('b'), turn('c')]))
  const rows = (await listSessions()).filter((s) => s.id === 's1')
  assert.equal(rows.length, before, 'one row per session id')
  assert.equal(rows[0].turnCount, 3)
})

test('a deleted session is gone from disk and from the list', async () => {
  await saveSession(mk('doomed', 'Temp', [turn('x')]))
  await deleteSession('doomed')
  assert.equal(await loadSession('doomed'), null)
  assert.ok(!(await listSessions()).some((s) => s.id === 'doomed'))
})

test('renaming keeps the turns', async () => {
  await renameSession('s1', 'Electromagnetics revision')
  const got = await loadSession('s1')
  assert.equal(got.title, 'Electromagnetics revision')
  assert.equal(got.turns.length, 3, 'a rename must never drop history')
})

test('loading a session that does not exist is null, not a throw', async () => {
  assert.equal(await loadSession('nope'), null)
})

test('a title is derived from the opening prompt', () => {
  assert.equal(deriveTitle('explain gauss law'), 'explain gauss law')
  assert.equal(deriveTitle('   '), 'New session')
  const long = deriveTitle('derive the expression for the electric field due to an infinite line charge')
  assert.ok(long.length <= 41, `too long: ${long}`)
  // Truncated on a word boundary: the kept text must be whole words of the
  // original, never a word sliced in half.
  assert.ok(long.endsWith('…'), 'a truncated title should say so')
  const kept = long.slice(0, -1).trimEnd()
  const source = 'derive the expression for the electric field due to an infinite line charge'
  assert.ok(source.startsWith(kept), 'kept text must be a prefix of the prompt')
  assert.ok(
    source[kept.length] === ' ' || source.length === kept.length,
    `cut mid-word: "${kept}"`
  )
})
