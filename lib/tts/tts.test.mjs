// Speech helpers: what gets said, how fast, and how a caption tracks the voice. Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { bundle } from '../../scripts/test/bundle.mjs'

const m = await bundle(`
export { speakable } from '@/lib/tts/speakable'
export { charsAt, rateFor } from '@/lib/tts/neural'
export { upcomingLines } from '@/lib/lesson/lines'
`, 'tts')
const { speakable, charsAt, rateFor, upcomingLines } = m

test('units and symbols are spelled out the way a teacher says them', () => {
  assert.equal(speakable('With these values, the am\'s current settles at 27.3 mA.'), "With these values, the am's current settles at 27.3 milliamps.")
  assert.equal(speakable('A 330 Ω resistor across 9 V'), 'A 330 ohms resistor across 9 volts')
  assert.equal(speakable('1.5 kΩ'), '1.5 kilo-ohms')
  assert.equal(speakable('I = V / R'), 'I equals V over R')
  assert.equal(speakable('range ≈ 45° and 5 m/s²'), 'range is approximately 45 degrees and 5 metres per second squared')
  assert.equal(speakable('area is $\\pi r^2$'), 'area is pi r 2')
})

test('the caption keeps pace with the audio clock and is complete when the clip ends', () => {
  assert.equal(charsAt(100, 0, 5), 1)
  assert.ok(charsAt(100, 2.5, 5) > 50 && charsAt(100, 2.5, 5) < 60)
  assert.equal(charsAt(100, 5, 5), 100)
  assert.equal(charsAt(100, 1, 0), 0, 'unknown duration: wait, do not guess')
})

test('the speed control maps onto a natural playback rate range', () => {
  assert.equal(rateFor(0.75), 0.95)
  assert.ok(rateFor(0.1) >= 0.8 && rateFor(9) <= 1.7)
  assert.ok(rateFor(1.5) > rateFor(1) && rateFor(1) > rateFor(0.75))
})

test('prefetch targets exactly the lines that will be spoken next, including answers to a prediction', () => {
  const sb = { title: 't', beats: [
    { t: 'say', text: 'one' }, { t: 'scene', script: 's', clear: true }, { t: 'say', text: 'two' },
    { t: 'predict', id: 'p', prompt: 'ask', choices: ['a', 'b'], correct: 0, responses: ['ra', 'rb'] }, { t: 'say', text: 'three' },
  ] }
  assert.deepEqual(upcomingLines(sb, 0, 3), ['one', 'two', 'ask', 'ra', 'rb'].slice(0, 3 + 4))
  assert.deepEqual(upcomingLines(sb, 4, 3), ['three'])
})
