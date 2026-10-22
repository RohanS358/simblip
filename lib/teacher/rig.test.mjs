import test from 'node:test'
import assert from 'node:assert/strict'
import { arm, pointTarget, visemeOf, gestureFor, POSES, MOODS, SHOULDER_R, UPPER, FORE } from './rig.ts'

const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

test('an arm keeps its bone lengths whatever it reaches for', () => {
  for (const t of [{ x: 300, y: 240 }, { x: 392, y: 276 }, { x: 236, y: 178 }, { x: 900, y: -400 }]) {
    const { elbow, hand } = arm(SHOULDER_R, t)
    assert.ok(Math.abs(len(SHOULDER_R, elbow) - UPPER) < 1e-6)
    assert.ok(Math.abs(len(elbow, hand) - FORE) < 1e-6)
  }
})

test('the elbow bows downwards and an out-of-reach target straightens the arm towards it', () => {
  const near = arm(SHOULDER_R, { x: 300, y: 240 })
  assert.ok(near.elbow.y > SHOULDER_R.y)
  const far = arm(SHOULDER_R, { x: 1000, y: SHOULDER_R.y })
  assert.ok(Math.abs(far.hand.y - SHOULDER_R.y) < 1e-6 && far.hand.x > SHOULDER_R.x + UPPER)
})

test('pointing lands the hand on the line to the target', () => {
  const t = pointTarget(SHOULDER_R, { x: 600, y: 36 })
  const ang = (p) => Math.atan2(p.y - SHOULDER_R.y, p.x - SHOULDER_R.x)
  assert.ok(Math.abs(ang(t) - ang({ x: 600, y: 36 })) < 1e-9)
})

test('vowels open the mouth wide, lip sounds close it, punctuation pauses', () => {
  assert.ok(visemeOf('a') > visemeOf('e') && visemeOf('e') > visemeOf('t'))
  assert.equal(visemeOf('m'), 0)
  assert.ok(visemeOf('.') < 0.1)
})

test('every pose can be reached by the arm, and every mood has a complete face', () => {
  for (const [name, p] of Object.entries(POSES)) {
    if (!p.hand) continue
    const { hand } = arm(SHOULDER_R, p.hand)
    assert.ok(Math.hypot(hand.x - p.hand.x, hand.y - p.hand.y) < 1, `${name} is within reach`)
  }
  for (const [name, f] of Object.entries(MOODS)) for (const k of ['browL', 'browR', 'inner', 'smile', 'tilt', 'eye', 'squint', 'blush', 'mouthMin']) assert.equal(typeof f[k], 'number', `${name}.${k}`)
})

test('a question gets an open palm, an exclamation an open hand, the rest vary', () => {
  assert.equal(gestureFor('Is that clear?', 0), 'palm')
  assert.equal(gestureFor('Great!', 1), 'open')
  assert.deepEqual([0, 1, 2, 3].map((n) => gestureFor('So.', n)), ['open', 'open', 'palm', 'open'])
})
