// node --test components/workspace/expr-scope.test.mjs
//
// The caret math behind expression autocomplete. Getting `activeToken` wrong
// means the popover opens when it shouldn't (or never closes); getting
// `spliceItem` wrong corrupts the user's formula on every pick.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeToken, spliceItem, filterScope } from './expr-token.mjs'

const item = { insert: '[Mass 1(vx)]', label: 'Mass 1 · vx', hint: '', kind: 'channel', search: '' }

test('activeToken finds an unclosed bracket before the caret', () => {
  assert.deepEqual(activeToken('2*[vol', 6), { start: 2, query: 'vol' })
  assert.deepEqual(activeToken('[', 1), { start: 0, query: '' })
})

test('activeToken ignores a token that already closed', () => {
  assert.equal(activeToken('2*[A(V)] + ', 11), null)
  assert.equal(activeToken('g + 1', 5), null)
})

test('activeToken only looks behind the caret', () => {
  // Caret sits before the bracket — the user is not typing that token.
  assert.equal(activeToken('x + [vol', 2), null)
})

test('activeToken treats a bare word as a query', () => {
  assert.deepEqual(activeToken('vol', 3), { start: 0, query: 'vol' })
  assert.deepEqual(activeToken('2*vol', 5), { start: 2, query: 'vol' })
  assert.deepEqual(activeToken('x9', 2), { start: 0, query: 'x9' })
})

test('activeToken never treats a number as a query', () => {
  // The whole point: a numeric field must stay a plain numeric field.
  assert.equal(activeToken('9.81', 4), null)
  assert.equal(activeToken('2*', 2), null)
  assert.equal(activeToken('1e3 ', 4), null)
})

test('spliceItem replaces a bare word', () => {
  const r = spliceItem('2*vol', 5, item)
  assert.equal(r.text, '2*[Mass 1(vx)]')
  assert.equal(r.caret, r.text.length)
})

test('filterScope puts the best name match first', () => {
  const items = [
    { label: 'velocity scale', search: 'velocity scale' },
    { label: 'v', search: 'v' },
    { label: 'Mass 1 · vx', search: 'mass 1 vx' },
  ]
  assert.deepEqual(filterScope(items, 'v').map((i) => i.label), [
    'v',              // exact name
    'velocity scale', // name prefix
    'Mass 1 · vx',    // substring only
  ])
})

test('spliceItem replaces the partial token being typed', () => {
  const r = spliceItem('2*[vol', 6, item)
  assert.equal(r.text, '2*[Mass 1(vx)]')
  assert.equal(r.caret, r.text.length)
})

test('spliceItem keeps text that follows the caret', () => {
  const r = spliceItem('2*[vol + 1', 6, item)
  assert.equal(r.text, '2*[Mass 1(vx)] + 1')
  assert.equal(r.caret, '2*[Mass 1(vx)]'.length)
})

test('spliceItem replaces an empty or placeholder-zero field', () => {
  assert.equal(spliceItem('', 0, item).text, '[Mass 1(vx)]')
  assert.equal(spliceItem('0', 1, item).text, '[Mass 1(vx)]')
})

test('spliceItem inserts at the caret in a real expression', () => {
  const r = spliceItem('9.8 * ', 6, item)
  assert.equal(r.text, '9.8 * [Mass 1(vx)]')
  assert.equal(r.caret, r.text.length)
})

test('filterScope matches label and hint, case-insensitively', () => {
  const items = [
    { search: 'mass 1 vx x velocity (cm/s)', label: 'a' },
    { search: 'voltmeter 1 v voltage (v)', label: 'b' },
  ]
  assert.equal(filterScope(items, 'VELOCITY').length, 1)
  assert.equal(filterScope(items, 'volt').length, 1)
  assert.equal(filterScope(items, '').length, 2)
})
