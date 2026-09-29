// iCalendar (.ics, RFC 5545) → SIMBLIP calendar events.
//
// Used by both calendar imports in Settings → Calendar: a one-time .ics file
// import (events become the user's own, editable, synced) and link
// subscriptions (events stay read-only and are re-fetched). Pure — no DOM, no
// store — so it runs in node tests (ics.test.mjs).
//
// What maps and what doesn't:
//   • SUMMARY/LOCATION/DESCRIPTION/UID, all-day and timed events, multi-day
//     events, DTEND or DURATION, UTC ("Z"), TZID zones (via Intl) and floating
//     times → local wall-clock days and times.
//   • A simple repeat (FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, no interval, no end,
//     no exceptions) → SIMBLIP's own `repeat`, so it repeats forever.
//   • Anything richer (INTERVAL, COUNT, UNTIL, several BYDAY days, EXDATE) is
//     EXPANDED into individual events — up to two years ahead / 500 events per
//     series — because SIMBLIP's repeat model can't express it.
//   • Rules it can't compute (BYSETPOS, "2nd Tuesday" ordinals, BYHOUR…) keep
//     just the first occurrence and are counted in `simplified`.
//   • STATUS:CANCELLED events are skipped.

import { addDays, dayNum, keyOf, weekday } from './dates.mjs'

const MAX_PER_SERIES = 500
const HORIZON_DAYS = 731

/** @param {string} text */
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')
}

/** 'NAME;P=V;Q="a:b":value' → { name, params, value } */
function parseLine(line) {
  let inQuote = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const head = line.slice(0, colon).split(';')
  /** @type {Record<string, string>} */
  const params = {}
  for (const p of head.slice(1)) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(colon + 1) }
}

/** @param {string} v */
const unescapeText = (v) =>
  v.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c)).trim()

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0')

/** Offset (ms) of `tz` from UTC at instant `utcMs`, via Intl. null if unknown zone. */
function zoneOffset(tz, utcMs) {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    /** @type {Record<string, number>} */
    const p = {}
    for (const part of f.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value)
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs
  } catch {
    return null
  }
}

/**
 * A DATE / DATE-TIME property → { allDay, date: 'YYYY-MM-DD', time?: 'HH:mm' }
 * in THIS device's local time zone.
 * @param {string} value @param {Record<string,string>} params
 */
export function parseIcsDate(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, hh, mi, ss, z] = m
  if (params.VALUE === 'DATE' || hh === undefined) return { allDay: true, date: `${y}-${mo}-${d}` }
  const wall = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss ?? 0))
  let utcMs
  if (z) utcMs = wall
  else if (params.TZID) {
    // Two passes handle a DST switch between the guess and the real instant.
    const o1 = zoneOffset(params.TZID, wall)
    if (o1 === null) utcMs = null
    else {
      const o2 = zoneOffset(params.TZID, wall - o1)
      utcMs = wall - (o2 ?? o1)
    }
  } else utcMs = null
  // Floating time (or a zone Intl doesn't know, e.g. a Windows zone name):
  // take the wall clock as-is.
  const local = utcMs === null ? new Date(+y, +mo - 1, +d, +hh, +mi, +(ss ?? 0)) : new Date(utcMs)
  return { allDay: false, date: keyOf(local), time: `${pad(local.getHours())}:${pad(local.getMinutes())}`, ms: local.getTime() }
}

/** 'P1DT2H30M' / 'P2W' → ms */
function durationMs(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return null
  const [, sign, w, d, h, mi, s] = m
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 24 * 3600 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000
  return sign === '-' ? -ms : ms
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** @param {string} v */
function parseRRule(v) {
  /** @type {Record<string, string>} */
  const r = {}
  for (const part of v.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) r[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase()
  }
  return r
}

/** Advance a 'YYYY-MM-DD' by n months, clamping the day (Jan 31 → Feb 28). */
function addMonths(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`
}

/**
 * Start days of a recurring series, or null when the rule is beyond what we
 * compute (the caller then keeps only the first occurrence).
 */
function expandSeries(start, rule, exdates, today) {
  const freq = rule.FREQ
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1) || 1)
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity
  const until = rule.UNTIL ? parseIcsDate(rule.UNTIL)?.date ?? null : null
  if (rule.BYSETPOS || rule.BYHOUR || rule.BYMINUTE || rule.BYWEEKNO || rule.BYYEARDAY) return null
  if (rule.BYMONTHDAY || rule.BYMONTH) return null
  let byDays = null
  if (rule.BYDAY) {
    if (freq !== 'WEEKLY' || /\d/.test(rule.BYDAY)) return null
    byDays = rule.BYDAY.split(',').map((d) => WEEKDAYS.indexOf(d)).filter((i) => i >= 0)
  }
  const horizon = addDays(today > start ? today : start, HORIZON_DAYS)
  const out = []
  let n = 0
  const push = (k) => {
    n++
    if (!exdates.has(k)) out.push(k)
  }
  if (freq === 'WEEKLY' && byDays) {
    // Walk week by week (every `interval` weeks), emitting the listed days.
    const weekStart = addDays(start, -weekday(start))
    for (let w = 0; n < count && out.length < MAX_PER_SERIES; w += interval) {
      const base = addDays(weekStart, w * 7)
      if (base > horizon || (until && base > until)) break
      for (const wd of [...byDays].sort((a, b) => a - b)) {
        const k = addDays(base, wd)
        if (k < start) continue
        if ((until && k > until) || k > horizon || n >= count) break
        push(k)
      }
    }
    return out
  }
  const step =
    freq === 'DAILY'
      ? (k) => addDays(k, interval)
      : freq === 'WEEKLY'
        ? (k) => addDays(k, 7 * interval)
        : freq === 'MONTHLY'
          ? (k, i) => addMonths(start, i * interval)
          : freq === 'YEARLY'
            ? (k, i) => addMonths(start, i * 12 * interval)
            : null
  if (!step) return null
  let k = start
  for (let i = 1; n < count && out.length < MAX_PER_SERIES; i++) {
    if ((until && k > until) || k > horizon) break
    push(k)
    k = step(k, i)
  }
  return out
}

const SIMPLE_REPEAT = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }

/**
 * @param {string} text the .ics file
 * @param {{ idPrefix?: string, today?: string }} [opts]
 * @returns {{ events: any[], skipped: number, simplified: number, calendarName: string | null }}
 */
export function parseIcs(text, opts = {}) {
  const idPrefix = opts.idPrefix ?? 'ics'
  const today = opts.today ?? keyOf(new Date())
  const lines = unfold(text)
  if (!lines.some((l) => l.trim().toUpperCase() === 'BEGIN:VCALENDAR')) {
    throw new Error('Not an iCalendar file')
  }
  const events = []
  let skipped = 0
  let simplified = 0
  let calendarName = null
  /** @type {Record<string, {params: Record<string,string>, value: string}[]> | null} */
  let cur = null
  let depth = 0 // nested components inside a VEVENT (VALARM) are ignored

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line) continue
    const upper = line.toUpperCase()
    if (upper === 'BEGIN:VEVENT') {
      cur = {}
      depth = 0
      continue
    }
    if (cur && upper.startsWith('BEGIN:')) {
      depth++
      continue
    }
    if (cur && upper.startsWith('END:') && upper !== 'END:VEVENT') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (upper === 'END:VEVENT') {
      if (cur) {
        const r = buildEvents(cur, idPrefix, today)
        events.push(...r.events)
        skipped += r.skipped
        simplified += r.simplified
      }
      cur = null
      continue
    }
    const p = parseLine(line)
    if (!p) continue
    if (!cur) {
      if (p.name === 'X-WR-CALNAME' && !calendarName) calendarName = unescapeText(p.value)
      continue
    }
    if (depth > 0) continue
    ;(cur[p.name] ??= []).push({ params: p.params, value: p.value })
  }
  return { events, skipped, simplified, calendarName }
}

function buildEvents(props, idPrefix, today) {
  const one = (name) => props[name]?.[0]
  const status = one('STATUS')?.value.toUpperCase()
  const startP = one('DTSTART')
  if (!startP || status === 'CANCELLED') return { events: [], skipped: 1, simplified: 0 }
  const start = parseIcsDate(startP.value, startP.params)
  if (!start) return { events: [], skipped: 1, simplified: 0 }

  // End: DTEND, else DURATION, else same day / one hour.
  let endDate = start.date
  let endTime
  const endP = one('DTEND')
  const durP = one('DURATION')
  if (endP) {
    const end = parseIcsDate(endP.value, endP.params)
    if (end) {
      if (start.allDay) endDate = end.date > start.date ? addDays(end.date, -1) : start.date // DTEND is exclusive
      else {
        endDate = end.date
        endTime = end.time
      }
    }
  } else if (durP && !start.allDay) {
    const ms = durationMs(durP.value)
    if (ms !== null) {
      const e = new Date(start.ms + ms)
      endDate = keyOf(e)
      endTime = `${pad(e.getHours())}:${pad(e.getMinutes())}`
    }
  } else if (durP && start.allDay) {
    const ms = durationMs(durP.value)
    if (ms !== null && ms > 0) endDate = addDays(start.date, Math.max(0, Math.round(ms / 86400000) - 1))
  }
  if (endDate < start.date) endDate = start.date

  const uid = (one('UID')?.value ?? `${start.date}-${one('SUMMARY')?.value ?? ''}`).trim()
  const base = {
    title: unescapeText(one('SUMMARY')?.value ?? '') || '(No title)',
    ...(one('LOCATION') ? { location: unescapeText(one('LOCATION').value) } : {}),
    ...(one('DESCRIPTION') ? { notes: unescapeText(one('DESCRIPTION').value).slice(0, 4000) } : {}),
    ...(start.allDay ? {} : { time: start.time, ...(endTime ? { endTime } : {}) }),
    icsUid: uid,
  }
  const spanDays = dayNum(endDate) - dayNum(start.date)
  const make = (date, suffix) => ({
    ...base,
    id: `${idPrefix}:${uid}${suffix}`,
    date,
    ...(spanDays > 0 ? { endDate: addDays(date, spanDays) } : {}),
  })

  // A RECURRENCE-ID row is one edited occurrence of a series: keep it as its
  // own event (the series' own copy of that day is not removed).
  const recId = one('RECURRENCE-ID')
  if (recId) return { events: [make(start.date, `@${recId.value}`)], skipped: 0, simplified: 0 }

  const rruleP = one('RRULE')
  if (!rruleP) return { events: [make(start.date, '')], skipped: 0, simplified: 0 }
  const rule = parseRRule(rruleP.value)
  const exdates = new Set(
    (props.EXDATE ?? []).flatMap((x) => x.value.split(',').map((v) => parseIcsDate(v, x.params)?.date).filter(Boolean))
  )
  const simpleByDay = !rule.BYDAY || (rule.FREQ === 'WEEKLY' && rule.BYDAY === WEEKDAYS[weekday(start.date)])
  if (
    SIMPLE_REPEAT[rule.FREQ] &&
    (!rule.INTERVAL || rule.INTERVAL === '1') &&
    !rule.COUNT &&
    !rule.UNTIL &&
    simpleByDay &&
    !rule.BYMONTHDAY &&
    !rule.BYMONTH &&
    !rule.BYSETPOS &&
    exdates.size === 0
  ) {
    return { events: [{ ...make(start.date, ''), repeat: SIMPLE_REPEAT[rule.FREQ] }], skipped: 0, simplified: 0 }
  }
  const days = expandSeries(start.date, rule, exdates, today)
  if (!days) return { events: [make(start.date, '')], skipped: 0, simplified: 1 }
  return { events: days.map((d, i) => make(d, i === 0 ? '' : `#${d}`)), skipped: 0, simplified: 0 }
}
