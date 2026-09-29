// Pins the three-way merge that reconciles the notebook tree and the calendar
// across devices. Wrong here means either lost work (an edit or a new page
// silently dropped) or zombies (a deleted page resurrected by a stale device).
//
// Run directly:  node --experimental-strip-types lib/sync/merge.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalJSON, fingerprint, mergeById, threeWayMerge } from './merge.ts'

const n = (id, name = id) => ({ id, name })

test('both sides add different nodes → union', () => {
  const base = { a: n('a') }
  const out = threeWayMerge(base, { a: n('a'), b: n('b') }, { a: n('a'), c: n('c') })
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c'])
})

test('remote deleted, local untouched → stays deleted (no zombie)', () => {
  const base = { a: n('a'), b: n('b') }
  const out = threeWayMerge(base, { a: n('a'), b: n('b') }, { a: n('a') })
  assert.deepEqual(Object.keys(out), ['a'])
})

test('local deleted, remote untouched → stays deleted', () => {
  const base = { a: n('a'), b: n('b') }
  const out = threeWayMerge(base, { a: n('a') }, { a: n('a'), b: n('b') })
  assert.deepEqual(Object.keys(out), ['a'])
})

test('remote deleted but local EDITED → edit survives', () => {
  const base = { a: n('a') }
  const out = threeWayMerge(base, { a: n('a', 'renamed') }, {})
  assert.equal(out.a.name, 'renamed')
})

test('local deleted but remote EDITED → edit survives', () => {
  const base = { a: n('a') }
  const out = threeWayMerge(base, {}, { a: n('a', 'renamed elsewhere') })
  assert.equal(out.a.name, 'renamed elsewhere')
})

test('only remote edited → remote wins', () => {
  const base = { a: n('a') }
  const out = threeWayMerge(base, { a: n('a') }, { a: n('a', 'R') })
  assert.equal(out.a.name, 'R')
})

test('only local edited → local wins', () => {
  const base = { a: n('a') }
  const out = threeWayMerge(base, { a: n('a', 'L') }, { a: n('a') })
  assert.equal(out.a.name, 'L')
})

test('both edited → local wins (the copy on screen)', () => {
  const base = { a: n('a') }
  const out = threeWayMerge(base, { a: n('a', 'L') }, { a: n('a', 'R') })
  assert.equal(out.a.name, 'L')
})

test('no base (first sync) → additive union, local wins collisions', () => {
  const out = threeWayMerge(null, { a: n('a', 'L'), b: n('b') }, { a: n('a', 'R'), c: n('c') })
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c'])
  assert.equal(out.a.name, 'L')
})

test('custom eq ignores wire-only fields', () => {
  const base = { a: { id: 'a', name: 'a' } }
  const remote = { a: { id: 'a', name: 'a', syncedContent: true } }
  const eq = (x, y) => x.name === y.name
  const out = threeWayMerge(base, { a: { id: 'a', name: 'L' } }, remote, eq)
  assert.equal(out.a.name, 'L')
})

test('mergeById keeps local order and appends remote-only items', () => {
  const base = [n('1'), n('2')]
  const local = [n('2'), n('1'), n('3')]
  const remote = [n('1'), n('4')] // remote deleted 2 (untouched locally)
  const out = mergeById(base, local, remote)
  assert.deepEqual(
    out.map((x) => x.id),
    ['1', '3', '4']
  )
})

test('fingerprint is stable and change-sensitive', () => {
  assert.equal(fingerprint({ a: 1 }), fingerprint({ a: 1 }))
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }))
})

test('key order never counts as a change (jsonb round trip)', () => {
  assert.equal(fingerprint({ a: 1, b: { c: 2, d: 3 } }), fingerprint({ b: { d: 3, c: 2 }, a: 1 }))
  assert.equal(canonicalJSON({ a: undefined, b: 1 }), '{"b":1}')
  const base = { x: { id: 'x', name: 'n', order: 1 } }
  const remote = { x: { order: 1, name: 'n', id: 'x' } } // same node, jsonb key order
  const out = threeWayMerge(base, { x: { id: 'x', name: 'L', order: 1 } }, remote)
  assert.equal(out.x.name, 'L') // local edit wins; remote was NOT treated as edited
})
