// Pins the .ics → SIMBLIP event mapping behind Settings → Calendar imports.
// Run: node --experimental-strip-types lib/calendar/ics.test.mjs
//
// Timed-event expectations are computed in the TEST's local zone the same way
// the app does, so the suite passes on any machine's TZ.

import assert from 'node:assert/strict'
import test from 'node:test'
import { parseIcs, parseIcsDate } from './ics.mjs'

const cal = (...events) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Uni', ...events.flat(), 'END:VCALENDAR'].join('\r\n')
const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
const localOf = (utcMs) => {
  const d = new Date(utcMs)
  const p = (n) => String(n).padStart(2, '0')
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }
}

test('rejects non-calendar text', () => {
  assert.throws(() => parseIcs('hello'), /Not an iCalendar/)
})

test('all-day event: DTEND is exclusive', () => {
  const r = parseIcs(cal(ev('UID:a', 'SUMMARY:Exam week', 'DTSTART;VALUE=DATE:20261005', 'DTEND;VALUE=DATE:20261010')))
  assert.equal(r.calendarName, 'Uni')
  assert.equal(r.events.length, 1)
  const e = r.events[0]
  assert.equal(e.date, '2026-10-05')
  assert.equal(e.endDate, '2026-10-09')
  assert.equal(e.time, undefined)
  assert.equal(e.icsUid, 'a')
})

test('single all-day event has no endDate', () => {
  const r = parseIcs(cal(ev('UID:b', 'SUMMARY:Day', 'DTSTART;VALUE=DATE:20261005', 'DTEND;VALUE=DATE:20261006')))
  assert.equal(r.events[0].endDate, undefined)
})

test('UTC time converts to local wall clock', () => {
  const r = parseIcs(cal(ev('UID:c', 'SUMMARY:Call', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z')))
  const s = localOf(Date.UTC(2026, 9, 5, 9, 0))
  const e = localOf(Date.UTC(2026, 9, 5, 10, 0))
  assert.equal(r.events[0].date, s.date)
  assert.equal(r.events[0].time, s.time)
  assert.equal(r.events[0].endTime, e.time)
})

test('TZID is honoured (Kathmandu is UTC+5:45)', () => {
  const d = parseIcsDate('20261005T100000', { TZID: 'Asia/Kathmandu' })
  const want = localOf(Date.UTC(2026, 9, 5, 4, 15))
  assert.equal(d.date, want.date)
  assert.equal(d.time, want.time)
})

test('DST zone: New York summer offset is applied', () => {
  const d = parseIcsDate('20260701T120000', { TZID: 'America/New_York' })
  const want = localOf(Date.UTC(2026, 6, 1, 16, 0))
  assert.equal(d.time, want.time)
})

test('unknown zone falls back to floating wall time', () => {
  const d = parseIcsDate('20261005T100000', { TZID: 'Nepal Standard Time' })
  assert.equal(d.time, '10:00')
})

test('DURATION instead of DTEND', () => {
  const r = parseIcs(cal(ev('UID:d', 'SUMMARY:Lab', 'DTSTART:20261005T100000', 'DURATION:PT1H30M')))
  assert.equal(r.events[0].time, '10:00')
  assert.equal(r.events[0].endTime, '11:30')
})

test('text escapes and folded lines', () => {
  const r = parseIcs(
    cal(ev('UID:e', 'SUMMARY:Physics\\, Lab \; 2', 'DESCRIPTION:Line one\\nLine', ' two', 'DTSTART;VALUE=DATE:20261005'))
  )
  assert.equal(r.events[0].title, 'Physics, Lab ; 2')
  assert.equal(r.events[0].notes, 'Line one\nLinetwo')
})

test('simple weekly rule maps to repeat', () => {
  const r = parseIcs(cal(ev('UID:f', 'SUMMARY:Lecture', 'DTSTART:20261005T090000', 'RRULE:FREQ=WEEKLY')))
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].repeat, 'weekly')
})

test('COUNT expands to individual events', () => {
  const r = parseIcs(cal(ev('UID:g', 'SUMMARY:Tut', 'DTSTART;VALUE=DATE:20261005', 'RRULE:FREQ=DAILY;COUNT=3')))
  assert.deepEqual(r.events.map((e) => e.date), ['2026-10-05', '2026-10-06', '2026-10-07'])
  assert.equal(new Set(r.events.map((e) => e.id)).size, 3)
})

test('weekly BYDAY with several days + UNTIL + EXDATE', () => {
  const r = parseIcs(
    cal(
      ev(
        'UID:h',
        'SUMMARY:Class',
        'DTSTART;VALUE=DATE:20261005', // Monday
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261014',
        'EXDATE;VALUE=DATE:20261007'
      )
    ),
    { today: '2026-10-01' }
  )
  assert.deepEqual(r.events.map((e) => e.date), ['2026-10-05', '2026-10-12', '2026-10-14'])
})

test('monthly on the 31st clamps to short months', () => {
  const r = parseIcs(cal(ev('UID:i', 'SUMMARY:Rent', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY;COUNT=3')))
  assert.deepEqual(r.events.map((e) => e.date), ['2026-01-31', '2026-02-28', '2026-03-31'])
})

test('uncomputable rule keeps the first occurrence and reports it', () => {
  const r = parseIcs(cal(ev('UID:j', 'SUMMARY:Board', 'DTSTART;VALUE=DATE:20261013', 'RRULE:FREQ=MONTHLY;BYDAY=2TU')))
  assert.equal(r.events.length, 1)
  assert.equal(r.simplified, 1)
})

test('cancelled events are skipped; VALARM ignored', () => {
  const r = parseIcs(
    cal(
      ev('UID:k', 'SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART;VALUE=DATE:20261005'),
      ev('UID:l', 'SUMMARY:Kept', 'DTSTART;VALUE=DATE:20261005', 'BEGIN:VALARM', 'SUMMARY:Alarm', 'END:VALARM')
    )
  )
  assert.equal(r.skipped, 1)
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0].title, 'Kept')
})

test('stable ids let a re-import update instead of duplicate', () => {
  const text = cal(ev('UID:m@x', 'SUMMARY:A', 'DTSTART;VALUE=DATE:20261005'))
  assert.equal(parseIcs(text).events[0].id, parseIcs(text).events[0].id)
  assert.equal(parseIcs(text, { idPrefix: 'sub1' }).events[0].id, 'sub1:m@x')
})
