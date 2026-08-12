// Per-file sync is opt-in (manifest-types.ts `syncEnabled`). These pin the
// selection rule in device-file-sync.ts's pushFilesToDevice, because getting
// it wrong is silent in both directions: too strict and files never arrive on
// the second device, too loose and we upload private files nobody offered.
//
// Run directly:  node --experimental-strip-types lib/sync/file-sync-gate.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'

/** Mirrors pushFilesToDevice's two filters. */
const selectForUpload = (entries) =>
  entries
    .filter((e) => e.syncEnabled === true)
    .filter((e) => e.syncStatus === 'local-only' || e.syncStatus === 'sync-failed')
    .map((e) => e.id)

/** Mirrors the pending_pull id list built after uploading. */
const selectForPull = (entries) =>
  entries.filter((e) => e.syncEnabled === true && e.cloudBackedUp).map((e) => e.id)

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
