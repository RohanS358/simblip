// Run: node lib/calendar/dates.test.mjs
import assert from 'node:assert'
import { addDays, fromBS, monthOf, rangeLabel, toBS, weekday } from './dates.mjs'
import { expand, layoutDay, layoutRow } from './events.mjs'

// Anchors against Nepal's published calendar.
assert.deepStrictEqual(toBS('1943-04-14'), { y: 2000, m: 0, d: 1 })
assert.deepStrictEqual(toBS('2026-04-14'), { y: 2083, m: 0, d: 1 }) // New Year 2083
assert.deepStrictEqual(toBS('2025-04-14'), { y: 2082, m: 0, d: 1 }) // New Year 2082
assert.deepStrictEqual(toBS('2024-04-13'), { y: 2081, m: 0, d: 1 }) // New Year 2081
assert.strictEqual(toBS('1900-01-01'), null)

// Round trip across the whole table.
for (let k = '1943-04-14'; k < '2033-04-01'; k = addDays(k, 17)) {
  const b = toBS(k)
  assert.strictEqual(fromBS(b.y, b.m, b.d), k, k)
}
assert.strictEqual(fromBS(2083, 12, 1), fromBS(2084, 0, 1)) // month overflow
assert.strictEqual(fromBS(2083, 0, 40), null)

assert.strictEqual(weekday('2026-09-23'), 3) // a Wednesday

const asoj = monthOf('bs', '2026-09-23')
assert.deepStrictEqual([asoj.y, asoj.m], [2083, 5])
assert.strictEqual(toBS(asoj.first).d, 1)
assert.strictEqual(addDays(asoj.last, 1), monthOf('bs', '2026-09-23', 1).first)
assert.strictEqual(monthOf('ad', '2026-01-15', -1).first, '2025-12-01')
assert.strictEqual(rangeLabel('ad', '2026-09-20', '2026-10-03'), 'September–October 2026')

// Expansion.
const evs = [
  { id: 'a', date: '2026-09-20', endDate: '2026-10-06' },
  { id: 'w', date: '2026-09-02', time: '10:00', repeat: 'weekly' },
  { id: 'm', date: '2026-01-30', repeat: 'monthly' },
  { id: 'b', date: '2026-04-14', repeat: 'yearly-bs' },
]
const week = expand(evs, '2026-09-27', '2026-10-03')
assert.deepStrictEqual(week.map((o) => o.ev.id + o.start), ['a2026-09-20', 'm2026-09-30', 'w2026-09-30'])
assert.ok(!expand(evs, '2026-02-01', '2026-02-28').some((o) => o.ev.id === 'm')) // no 30 Feb
assert.deepStrictEqual(
  expand(evs, '2027-04-01', '2027-04-30').filter((o) => o.ev.id === 'b').map((o) => o.start),
  [fromBS(2084, 0, 1)]
)
assert.strictEqual(expand(evs, '2026-01-01', '2026-01-29').length, 0) // nothing before a series starts

// Lanes: the long bar takes lane 0, the others stack under it.
const bars = layoutRow(week, '2026-09-27')
assert.deepStrictEqual(bars.map((b) => [b.occ.ev.id, b.col, b.span, b.lane]), [
  ['a', 0, 7, 0],
  ['m', 3, 1, 1],
  ['w', 3, 1, 2],
])
assert.ok(bars[0].clipStart && bars[0].clipEnd)

// Overlapping timed events split the column; a later free one gets it all.
const day = layoutDay([
  { ev: { time: '09:00', endTime: '10:30' } },
  { ev: { time: '10:00', endTime: '11:00' } },
  { ev: { time: '12:00' } },
])
assert.deepStrictEqual(day.map((i) => [i.col, i.cols]), [[0, 2], [1, 2], [0, 1]])

console.log('calendar dates ok')
