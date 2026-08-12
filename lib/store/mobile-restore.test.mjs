// Regression tests for "reopen where I left off" on the touch shell.
//
// The mobile shell used to always mount at Home: its `view` was plain
// useState and the mobile-tab store had no persist middleware, so the
// workspace store's already-persisted activePageId had nothing to render it.
// Both are persisted now, and the shell restores on mount — but only to a
// screen that still EXISTS, which is the part with branches worth pinning.
//
// The validity rule is ported verbatim from mobile-shell.tsx's restore
// effect. Keep the two in step.
//
// Run directly:  node --experimental-strip-types lib/store/mobile-restore.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'

/** Mirrors the restore effect's guard in components/workspace/mobile-shell.tsx. */
const canRestore = (saved, ws) => {
  const valid =
    saved.kind === 'editor'
      ? !!ws.activePageId && !!ws.nodes[ws.activePageId]
      : saved.kind === 'folder' || saved.kind === 'notebook'
        ? !!ws.nodes[saved.id]
        : true
  return valid && saved.kind !== 'home'
}

const wsWith = (nodes, activePageId = null) => ({ nodes, activePageId })

test('restore: editor view returns when its page still exists', () => {
  const ws = wsWith({ p1: { kind: 'page', name: 'Slide deck' } }, 'p1')
  assert.equal(canRestore({ kind: 'editor' }, ws), true)
})

test('restore: editor view is dropped when the page is gone', () => {
  // Deleted on another device and synced away — restoring would show an
  // editor with nothing in it.
  const ws = wsWith({}, 'p1')
  assert.equal(canRestore({ kind: 'editor' }, ws), false)
})

test('restore: editor view is dropped when no page was active', () => {
  assert.equal(canRestore({ kind: 'editor' }, wsWith({ p1: { kind: 'page' } }, null)), false)
})

test('restore: folder view returns when the folder still exists', () => {
  const ws = wsWith({ f1: { kind: 'folder', name: 'Physics' } })
  assert.equal(canRestore({ kind: 'folder', id: 'f1' }, ws), true)
})

test('restore: folder view is dropped when the folder was deleted', () => {
  assert.equal(canRestore({ kind: 'folder', id: 'f1' }, wsWith({})), false)
})

test('restore: home needs no restore (it is already the mount default)', () => {
  // Guards against a redundant setState on every cold start.
  assert.equal(canRestore({ kind: 'home' }, wsWith({})), false)
})

test('restore: assignments has no id to validate and always returns', () => {
  assert.equal(canRestore({ kind: 'assignments' }, wsWith({})), true)
})
