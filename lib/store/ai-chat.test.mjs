// The assistant's turn store — what makes Manual vs Auto safe and bounded.
// Run: node lib/store/ai-chat.test.mjs
//
// Mirrors the reducers in ai-chat.ts (the module is Zustand + scoped
// localStorage and can't load in Node). The rules under test are the ones
// with real consequences: an unbounded chat log competes with page content
// for the same 5MB localStorage quota, and a turn left mid-stream would
// rehydrate as a spinner that never stops.

import test from 'node:test'
import assert from 'node:assert/strict'

const MAX_TURNS = 30
let seq = 0
const uid = () => `id${++seq}`

const addTurn = (turns, turn) => [...turns, { ...turn, id: uid() }].slice(-MAX_TURNS)
const patchTurn = (turns, id, patch) => turns.map((t) => (t.id === id ? { ...t, ...patch } : t))
const rehydrate = (turns) =>
  turns.map((t) => (t.status === 'streaming' ? { ...t, status: 'error', message: 'Interrupted.' } : t))

test('the log is capped so it cannot crowd out page archives', () => {
  // Page content and this log share one 5MB localStorage budget, and page
  // content must always win — see lib/store/page-archive.ts.
  let turns = []
  for (let i = 0; i < MAX_TURNS + 15; i++) turns = addTurn(turns, { prompt: `p${i}`, script: '', status: 'ok' })
  assert.equal(turns.length, MAX_TURNS)
  assert.equal(turns.at(-1).prompt, `p${MAX_TURNS + 14}`, 'the newest turn is kept')
  assert.equal(turns[0].prompt, 'p15', 'the oldest are dropped')
})

test('a streamed turn accumulates into the same turn, not new ones', () => {
  let turns = addTurn([], { prompt: 'x', script: '', status: 'streaming' })
  const id = turns[0].id
  for (const chunk of ['var a', ' = create', '("mass");']) {
    turns = patchTurn(turns, id, { script: (turns.find((t) => t.id === id).script ?? '') + chunk })
  }
  assert.equal(turns.length, 1)
  assert.equal(turns[0].script, 'var a = create("mass");')
})

test('an interrupted turn rehydrates as an error, never a stuck spinner', () => {
  const turns = rehydrate([
    { id: 'a', prompt: 'x', script: 'partial', status: 'streaming' },
    { id: 'b', prompt: 'y', script: 'done', status: 'ok' },
  ])
  assert.equal(turns[0].status, 'error', 'a stream that can never resume must not stay pending')
  assert.match(turns[0].message, /Interrupted/)
  assert.equal(turns[1].status, 'ok', 'completed turns are untouched')
})

test('added is per-turn, so the same scene is not double-added', () => {
  let turns = addTurn([], { prompt: 'x', script: 'var a = create("mass");', status: 'ok' })
  let other = addTurn(turns, { prompt: 'y', script: 'var b = create("block");', status: 'ok' })
  other = patchTurn(other, other[0].id, { added: true })
  assert.equal(other[0].added, true)
  assert.equal(other[1].added, undefined, 'marking one turn added leaves the other alone')
})
