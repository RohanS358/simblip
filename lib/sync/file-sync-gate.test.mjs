// Per-file sync is opt-in (manifest-types.ts `syncEnabled`). These pin the
// selection rule in device-file-sync.ts's pushFilesToDevice, because getting
// it wrong is silent in both directions: too strict and files never arrive on
// the second device, too loose and we upload private files nobody offered.
//
// Run directly:  node --experimental-strip-types lib/sync/file-sync-gate.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'

/** Mirrors pushFilesToDevice's two filters. `viaPage` is the page-derived set
 *  (page-sync.ts's syncedFileIds) that's OR'd with each file's own flag. */
const selectForUpload = (entries, viaPage = new Set()) =>
  entries
    .filter((e) => e.syncEnabled === true || viaPage.has(e.id))
    .filter((e) => e.syncStatus === 'local-only' || e.syncStatus === 'sync-failed')
    .map((e) => e.id)

/** Mirrors the pending_pull id list built after uploading. */
const selectForPull = (entries, viaPage = new Set()) =>
  entries.filter((e) => (e.syncEnabled === true || viaPage.has(e.id)) && e.cloudBackedUp).map((e) => e.id)

const entry = (id, over = {}) => ({
  id,
  syncStatus: 'local-only',
  cloudBackedUp: false,
  ...over,
})

test('gate: a file with sync off is never uploaded', () => {
  assert.deepEqual(selectForUpload([entry('a', { syncEnabled: false })]), [])
})

test('gate: a file predating the toggle (undefined) is never uploaded', () => {
  // Every file created before syncEnabled existed must default to OFF, not
  // be treated as opted in.
  assert.deepEqual(selectForUpload([entry('a')]), [])
})

test('gate: an opted-in local-only file uploads', () => {
  assert.deepEqual(selectForUpload([entry('a', { syncEnabled: true })]), ['a'])
})

test('gate: an opted-in file that failed before retries', () => {
  assert.deepEqual(
    selectForUpload([entry('a', { syncEnabled: true, syncStatus: 'sync-failed' })]),
    ['a']
  )
})

test('gate: an already-synced file is not re-uploaded', () => {
  assert.deepEqual(
    selectForUpload([entry('a', { syncEnabled: true, syncStatus: 'synced', cloudBackedUp: true })]),
    []
  )
})

test('gate: only opted-in files are queued for the other device to pull', () => {
  const entries = [
    entry('yes', { syncEnabled: true, cloudBackedUp: true }),
    // Uploaded under an older build, then switched off — must not be offered.
    entry('no', { syncEnabled: false, cloudBackedUp: true }),
    entry('legacy', { cloudBackedUp: true }),
  ]
  assert.deepEqual(selectForPull(entries), ['yes'])
})

test('gate: mixed set picks exactly the opted-in, not-yet-uploaded files', () => {
  const entries = [
    entry('a', { syncEnabled: true }),
    entry('b', { syncEnabled: false }),
    entry('c', { syncEnabled: true, syncStatus: 'synced', cloudBackedUp: true }),
    entry('d', { syncEnabled: true, syncStatus: 'sync-failed' }),
    entry('e'),
  ]
  assert.deepEqual(selectForUpload(entries), ['a', 'd'])
})

// ── Per-PAGE gate (lib/sync/page-sync.ts) ──────────────────────────────────
// Same stakes as the file gate above, one level up: a page whose sync is off
// must contribute neither its content rows nor its images' bytes.

/** Mirrors page-sync.ts's contentIdsOf — every content canvas a page owns. */
const contentIdsOf = (p) =>
  [
    p.id,
    ...(p.docPages ?? []),
    ...(p.notesPages ?? []),
    ...(p.annotPages ?? []),
    ...(p.notesDocId ? [p.notesDocId] : []),
    ...(p.imageAnnotPageId ? [p.imageAnnotPageId] : []),
    ...(p.webAnnotPageId ? [p.webAnnotPageId] : []),
  ].filter(Boolean)

/** Mirrors syncedContentIds + cloud.ts's pushPages filter. */
const selectPagesToPush = (pages, dirty) => {
  const allowed = new Set(
    pages.filter((p) => p.syncEnabled === true).flatMap(contentIdsOf)
  )
  return dirty.filter((id) => allowed.has(id))
}

const page = (id, over = {}) => ({ id, kind: 'page', ...over })

test('page gate: content of a page with sync off is never pushed', () => {
  assert.deepEqual(selectPagesToPush([page('p1')], ['p1']), [])
  assert.deepEqual(selectPagesToPush([page('p1', { syncEnabled: false })], ['p1']), [])
})

test('page gate: pages predating the flag default to OFF, not on', () => {
  // undefined must read as false — the whole point of the opt-in.
  assert.deepEqual(selectPagesToPush([page('p1', { syncEnabled: undefined })], ['p1']), [])
})

test('page gate: enabling a page carries every canvas it owns', () => {
  const p = page('pdf1', {
    syncEnabled: true,
    notesPages: ['n0', 'n1'],
    annotPages: ['a0', 'a1'],
    notesDocId: 'nd',
  })
  assert.deepEqual(
    selectPagesToPush([p], ['pdf1', 'n0', 'n1', 'a0', 'a1', 'nd']),
    ['pdf1', 'n0', 'n1', 'a0', 'a1', 'nd']
  )
})

test('page gate: a synced page does not leak its neighbours', () => {
  const on = page('p1', { syncEnabled: true, docPages: ['s1'] })
  const off = page('p2', { docPages: ['s2'] })
  assert.deepEqual(selectPagesToPush([on, off], ['p1', 's1', 'p2', 's2']), ['p1', 's1'])
})

test('page gate: images of a synced page upload without their own flag', () => {
  // syncedFileIds(p1) — the page is on, so its pictures ride along.
  const viaPage = new Set(['img1'])
  assert.deepEqual(selectForUpload([entry('img1')], viaPage), ['img1'])
  assert.deepEqual(selectForPull([entry('img1', { cloudBackedUp: true })], viaPage), ['img1'])
})

test('page gate: images of an unsynced page stay local even when reachable', () => {
  // Empty derived set = no page opted in; the file flag is the only way through.
  assert.deepEqual(selectForUpload([entry('img1')], new Set()), [])
})
