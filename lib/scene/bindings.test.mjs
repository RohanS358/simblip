// Self-check for the binding encoding + rename rewriting.
// No test framework in this project — run it directly:
//   node lib/scene/bindings.test.mjs
//
// The logic under test is pure string work, so it's duplicated here rather
// than imported (bindings.ts is a 'use client' TS module that pulls in the
// physics bus). Keep these in sync with lib/scene/bindings.ts if that changes.

import assert from 'node:assert/strict'

const parseBindings = (raw) =>
  raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf(':')
      if (i <= 0) return null
      const channel = entry.slice(i + 1).trim()
      return channel ? { objectId: entry.slice(0, i).trim(), channel } : null
    })
    .filter((b) => b !== null)

const serializeBindings = (list) => list.map((b) => `${b.objectId}:${b.channel}`).join('; ')

const TOKEN_RE = /\[\s*([^\[\]()]+?)\s*\(\s*([^()]+?)\s*\)\s*\]/g
const renameInExpr = (expr, old, next) => {
  if (!expr.includes('[')) return expr
  return expr.replace(TOKEN_RE, (m, name, channel) =>
    name.trim() === old ? `[${next}(${channel.trim()})]` : m
  )
}

// ── encoding round-trips ────────────────────────────────────────────────────
const list = [
  { objectId: 'obj1', channel: 'V' },
  { objectId: 'obj2', channel: 'speed' },
]
assert.deepEqual(parseBindings(serializeBindings(list)), list, 'round-trip')
assert.deepEqual(parseBindings(' a:x ;  b:vy '), [
  { objectId: 'a', channel: 'x' },
  { objectId: 'b', channel: 'vy' },
], 'whitespace tolerated')

// Malformed entries are dropped, never thrown on — a corrupt param must not
// take down the whole graph.
assert.deepEqual(parseBindings('good:V; garbage; :novalue; trailing:'), [
  { objectId: 'good', channel: 'V' },
], 'malformed entries dropped')
assert.deepEqual(parseBindings(''), [], 'empty string')

// A channel containing ':' survives — only the FIRST colon splits.
assert.deepEqual(parseBindings('id:a:b'), [{ objectId: 'id', channel: 'a:b' }], 'first colon splits')

// ── rename rewriting ────────────────────────────────────────────────────────
assert.equal(
  renameInExpr('2*[Voltmeter 1(V)] + [Mass 1(x)]', 'Voltmeter 1', 'Vm'),
  '2*[Vm(V)] + [Mass 1(x)]',
  'renames only the matching object'
)
assert.equal(renameInExpr('g*9.81', 'Mass 1', 'M'), 'g*9.81', 'no tokens → unchanged')
assert.equal(
  renameInExpr('[ Mass 1 ( vx ) ]', 'Mass 1', 'M'),
  '[M(vx)]',
  'padded tokens match and normalize'
)
// A name that only PREFIXES another must not be rewritten.
assert.equal(
  renameInExpr('[Mass 10(x)]', 'Mass 1', 'M'),
  '[Mass 10(x)]',
  'prefix is not a match'
)
// Repeated references all move.
assert.equal(
  renameInExpr('[A(x)]+[A(vy)]', 'A', 'B'),
  '[B(x)]+[B(vy)]',
  'every reference rewritten'
)

console.log('bindings: all checks passed')
