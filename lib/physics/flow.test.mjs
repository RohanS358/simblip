// Diagram animation is a pure function of the run clock.
// Run: node --test lib/physics/flow.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const out = join(mkdtempSync(join(tmpdir(), 'flow-test-')), 'flow.mjs')
execFileSync('npx', ['esbuild', join(root, 'lib/physics/flow.ts'), '--bundle', '--format=esm', `--outfile=${out}`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { timelineTime, activeToken, isLit, pointAlong } = await import(out)

test('a token is only in flight during its own window', () => {
  const tk = [{ at: 1, dur: 2, label: 'SYN' }, { at: 4, dur: 1 }]
  assert.equal(activeToken(tk, 0.5), null)
  assert.equal(activeToken(tk, 2).u, 0.5)
  assert.equal(activeToken(tk, 3), null)          // gap between messages
  assert.equal(activeToken(tk, 4.5).token.at, 4)
})

test('the timeline loops and speeds up', () => {
  assert.equal(timelineTime(7, 1, 5), 2)
  assert.equal(timelineTime(7, 1, 0), 7)          // no loop: keeps going, tokens are simply done
  assert.equal(timelineTime(3, 2, 0), 6)
  assert.equal(timelineTime(-1, 1, 5), 0)
})

test('position along a bent arrow is by distance, not by segment', () => {
  const p = [[0, 0], [100, 0], [100, 100]]
  assert.deepEqual(pointAlong(p, 0), { x: 0, y: 0 })
  assert.deepEqual(pointAlong(p, 0.5), { x: 100, y: 0 })   // half the LENGTH is the corner
  assert.deepEqual(pointAlong(p, 0.75), { x: 100, y: 50 })
  assert.deepEqual(pointAlong(p, 1), { x: 100, y: 100 })
})

test('lit windows are half-open', () => {
  assert.equal(isLit([[1, 2]], 1), true)
  assert.equal(isLit([[1, 2]], 2), false)
})
