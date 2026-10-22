import test from 'node:test'
import assert from 'node:assert/strict'
import { pickObjects, fallbackExplain, adapt, START_PACE, shouldCheckIn, explainPrompts, speakable, simplerFromNarration, wantsDemo } from './tutor-core.ts'

const o = (id, kind, x, y, w = 100, h = 60, params) => ({ id, name: id, kind, position: { x, y }, size: { w, h }, params })
const objs = [o('bat', 'battery', 0, 0, 100, 60, { V: 6 }), o('lamp', 'bulb', 300, 0), o('sw', 'switch', 600, 0, 100, 60, { closed: 0 })]

test('a circle picks what it covers, most covered first', () => {
  assert.deepEqual(pickObjects(objs, { left: -10, top: -10, right: 120, bottom: 70 }).map((x) => x.id), ['bat'])
  assert.deepEqual(pickObjects(objs, { left: -10, top: -10, right: 720, bottom: 70 }).map((x) => x.id).sort(), ['bat', 'lamp', 'sw'])
})

test('a tap near a thing picks it; a tap in empty space picks nothing', () => {
  assert.deepEqual(pickObjects(objs, { left: 335, top: 95, right: 345, bottom: 105 }).map((x) => x.id), ['lamp'])
  assert.deepEqual(pickObjects(objs, { left: 2000, top: 2000, right: 2010, bottom: 2010 }), [])
})

test('with no model the teacher still says what it is and what it is set to', () => {
  assert.match(fallbackExplain([objs[0]]), /battery.*pump.*voltage is 6/)
  assert.match(fallbackExplain([objs[2]]), /switch.*open/)
  assert.match(fallbackExplain([]), /can't see anything/)
  assert.match(fallbackExplain([objs[0], objs[1]]), /1 other part/)
})

test('"tough" slows down, simplifies and re-explains; "easy" speeds up and deepens; limits hold', () => {
  const t = adapt(START_PACE, 'tough')
  assert.deepEqual([t.pace.depth, t.pace.speed, t.reexplain], ['simple', 0.8, true])
  assert.equal(adapt({ depth: 'simple', speed: 0.6 }, 'tough').pace.speed, 0.6)
  const e = adapt(START_PACE, 'easy')
  assert.deepEqual([e.pace.depth, e.pace.speed, e.reexplain], ['deep', 1.2, false])
  assert.equal(adapt({ depth: 'normal', speed: 1.5 }, 'easy').pace.speed, 1.5)
  assert.equal(adapt({ depth: 'simple', speed: 1 }, 'easy').pace.depth, 'normal')
  assert.deepEqual(adapt(START_PACE, 'got-it').pace, START_PACE)
})

test('check in at a new chapter after enough beats, or straight away after two misses', () => {
  assert.equal(shouldCheckIn({ beatIsChapter: true, sinceLast: 12, missesInRow: 0 }), true)
  assert.equal(shouldCheckIn({ beatIsChapter: true, sinceLast: 3, missesInRow: 0 }), false)
  assert.equal(shouldCheckIn({ beatIsChapter: false, sinceLast: 30, missesInRow: 0 }), false)
  assert.equal(shouldCheckIn({ beatIsChapter: false, sinceLast: 1, missesInRow: 2 }), true)
})

test('the prompt carries the lesson, the circled thing and the student\'s level; answers are kept speakable', () => {
  const { system, user } = explainPrompts({ depth: 'simple', lesson: 'Bulb', section: 'Series', saying: 'Two bulbs share the push.', thing: 'bulb "b1" R=12', mode: 'simpler' })
  assert.match(system, /simplest everyday words/)
  assert.match(user, /Bulb.*Series/s)
  assert.match(user, /b1/)
  assert.match(user, /found this hard/)
  assert.equal(speakable('**One.** Two. Three. Four. Five.', 3), 'One. Two. Three.')
  assert.match(simplerFromNarration(['A is B. And more.', 'C is D. Extra.']), /A is B\. C is D\./)
})

test('a request to draw or show something is a demo; a "what is" question is not', () => {
  assert.equal(wantsDemo('can you show me by drawing three parallel resistor and teach me what happens then?'), true)
  assert.equal(wantsDemo('Simulate a pendulum with a longer string'), true)
  assert.equal(wantsDemo('what happens when I double the resistance?'), true)
  assert.equal(wantsDemo('What is a resistor?'), false)
  assert.equal(wantsDemo('why is the current the same everywhere in series'), false)
  assert.equal(wantsDemo('show me the answer'), false)
})
