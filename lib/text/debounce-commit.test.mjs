// Checks the one property the debounce must never violate: typing is
// collapsed into fewer store writes, but the last thing typed always lands.
//
// Run: node lib/text/debounce-commit.test.mjs

import assert from 'node:assert/strict'
import { createCommitter } from './debounce-commit.mjs'

/** Controllable clock, so the test never actually waits. */
function fakeTimers() {
  let now = 0
  let seq = 0
  const scheduled = new Map()
  return {
    setTimeout: (fn, ms) => {
      const id = ++seq
      scheduled.set(id, { fn, at: now + ms })
      return id
    },
    clearTimeout: (id) => scheduled.delete(id),
    advance(ms) {
      now += ms
      for (const [id, { fn, at }] of [...scheduled]) {
        if (at <= now) {
          scheduled.delete(id)
          fn()
        }
      }
    },
    get count() {
      return scheduled.size
    },
  }
}

// A burst of keystrokes collapses to ONE write carrying the final value.
{
  const writes = []
  const t = fakeTimers()
  const c = createCommitter((v) => writes.push(v), 250, t)

  for (const s of ['h', 'he', 'hel', 'hell', 'hello']) c.queue(s)
  assert.deepEqual(writes, [], 'must not write mid-burst')

  t.advance(250)
  assert.deepEqual(writes, ['hello'], 'one write, last value')
}

// Pauses longer than the window produce separate writes.
{
  const writes = []
  const t = fakeTimers()
  const c = createCommitter((v) => writes.push(v), 250, t)

  c.queue('one')
  t.advance(250)
  c.queue('two')
  t.advance(250)
  assert.deepEqual(writes, ['one', 'two'])
}

// THE REGRESSION THIS GUARDS: leaving mid-burst must not lose the tail.
// This is blur / leave-edit-mode / unmount.
{
  const writes = []
  const t = fakeTimers()
  const c = createCommitter((v) => writes.push(v), 250, t)

  c.queue('draft')
  t.advance(10) // nowhere near the window
  c.flush()
  assert.deepEqual(writes, ['draft'], 'flush commits pending text')
  assert.equal(t.count, 0, 'flush cancels the pending timer')
}

// Flush is idempotent — blur then unmount must not write twice, and the
// cancelled timer must not fire a second write afterwards.
{
  const writes = []
  const t = fakeTimers()
  const c = createCommitter((v) => writes.push(v), 250, t)

  c.queue('x')
  c.flush()
  c.flush()
  t.advance(1000)
  assert.deepEqual(writes, ['x'], 'exactly one write')
}

// Flushing with nothing outstanding is a no-op (a box entered and left
// without typing must not write, or every click would dirty the page).
{
  const writes = []
  const t = fakeTimers()
  const c = createCommitter((v) => writes.push(v), 250, t)
  c.flush()
  assert.deepEqual(writes, [])
}

// Empty string is a real value, not "nothing pending" — clearing a box and
// leaving must persist the clear.
{
  const writes = []
  const t = fakeTimers()
  const c = createCommitter((v) => writes.push(v), 250, t)
  c.queue('')
  c.flush()
  assert.deepEqual(writes, [''], 'emptying a box persists')
}

console.log('debounce-commit: all checks passed')
