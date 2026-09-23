// Calendar event layout — which events land on which days, and where they
// sit. Pure, so the month grid, the week grid and the gallery's mini month
// all agree on the same answer.
//
// Run: node lib/calendar/dates.test.mjs

import { addDays, adMonthLength, dayKey, dayNum, fromAD, fromBS, partsIn } from './dates.mjs'

/**
 * @typedef {'daily' | 'weekly' | 'monthly' | 'yearly' | 'monthly-bs' | 'yearly-bs'} Repeat
 *
 * @typedef {Object} CalEvent
 * @property {string} id
 * @property {string} date      first day, 'YYYY-MM-DD'
 * @property {string} [endDate] last day, inclusive; absent = same day
 * @property {string} [time]    'HH:mm'; absent = all-day
 * @property {string} [endTime] 'HH:mm'
 * @property {Repeat} [repeat]
 *
 * @typedef {{ ev: any, start: string, end: string }} Occurrence
 *   One concrete appearance of an event. `ev` is the stored event (typed any
 *   so callers keep their richer type); start/end are that occurrence's days.
 */

/** Days an event covers beyond its first. @param {CalEvent} ev */
export const extraDays = (ev) => (ev.endDate ? Math.max(0, dayNum(ev.endDate) - dayNum(ev.date)) : 0)

/** @param {string | undefined} t 'HH:mm' → minutes after midnight */
export const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : 0)

/** @param {number} min → 'HH:mm', clamped into the day */
export function fromMin(min) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** A timed event's end minute (an hour by default, never before its start).
 *  @param {CalEvent} ev */
export function endMin(ev) {
  const s = toMin(ev.time)
  const e = ev.endTime ? toMin(ev.endTime) : s + 60
  return extraDays(ev) > 0 ? e : Math.max(e, s + 15)
}

/** Timed and within one day → lives in the week view's hour grid; anything
 *  else rides the all-day lanes. @param {CalEvent} ev */
export const isTimedSingle = (ev) => !!ev.time && extraDays(ev) === 0

/**
 * Start days of `ev` whose occurrence overlaps [from, to].
 * @param {CalEvent} ev @param {string} from @param {string} to
 * @returns {string[]}
 */
function occurrenceStarts(ev, from, to) {
  const lo = addDays(from, -extraDays(ev))
  const out = []
  const r = ev.repeat
  if (!r) {
    if (ev.date >= lo && ev.date <= to) out.push(ev.date)
    return out
  }
  if (r === 'daily' || r === 'weekly') {
    const step = r === 'daily' ? 1 : 7
    const n0 = dayNum(ev.date)
    const k = Math.max(0, Math.ceil((dayNum(lo) - n0) / step))
    for (let n = n0 + k * step; n <= dayNum(to); n += step) out.push(dayKey(n))
    return out
  }
  // Month-based: same day-of-month every N months, in AD or in BS. A day the
  // month doesn't have (31st, 29 Feb, 32 Asar) is skipped, not clamped —
  // that's what every mainstream calendar does.
  const system = r.endsWith('-bs') ? 'bs' : 'ad'
  const step = r.startsWith('yearly') ? 12 : 1
  const { y, m, d } = partsIn(system, ev.date)
  const pl = partsIn(system, lo)
  const kStart = Math.max(0, Math.floor(((pl.y - y) * 12 + pl.m - m) / step) - 1)
  for (let k = kStart; ; k++) {
    const mm = m + k * step
    const first = system === 'bs' ? fromBS(y, mm, 1) : fromAD(y, mm, 1)
    if (!first || first > to) break
    const yy = y + Math.floor(mm / 12)
    const m12 = ((mm % 12) + 12) % 12
    const key =
      system === 'bs' ? fromBS(y, mm, d) : d <= adMonthLength(yy, m12) ? fromAD(yy, m12, d) : null
    if (key && key >= lo && key <= to && key >= ev.date) out.push(key)
  }
  return out
}

/**
 * Every occurrence overlapping [from, to], in display order: earlier first,
 * then all-day before timed, longer before shorter, then by time.
 * @param {CalEvent[]} events @param {string} from @param {string} to
 * @returns {Occurrence[]}
 */
export function expand(events, from, to) {
  /** @type {Occurrence[]} */
  const out = []
  for (const ev of events) {
    const len = extraDays(ev)
    for (const start of occurrenceStarts(ev, from, to)) out.push({ ev, start, end: addDays(start, len) })
  }
  return out.sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      Number(!!a.ev.time) - Number(!!b.ev.time) ||
      b.end.localeCompare(a.end) ||
      (a.ev.time ?? '').localeCompare(b.ev.time ?? '')
  )
}

/**
 * Lay a row of `days` consecutive days (a week) out as horizontal bars:
 * each occurrence gets a column span and the lowest lane free across it.
 * @param {Occurrence[]} occs  already in expand() order
 * @param {string} rowStart @param {number} [days]
 */
export function layoutRow(occs, rowStart, days = 7) {
  const rowEnd = addDays(rowStart, days - 1)
  /** @type {number[][]} lanes[i] = columns occupied in lane i */
  const lanes = []
  const bars = []
  for (const occ of occs) {
    if (occ.end < rowStart || occ.start > rowEnd) continue
    const s = occ.start < rowStart ? rowStart : occ.start
    const e = occ.end > rowEnd ? rowEnd : occ.end
    const col = dayNum(s) - dayNum(rowStart)
    const span = dayNum(e) - dayNum(s) + 1
    let lane = 0
    while (lanes[lane]?.some((c) => c >= col && c < col + span)) lane++
    ;(lanes[lane] ??= []).push(...Array.from({ length: span }, (_, i) => col + i))
    bars.push({ occ, col, span, lane, clipStart: occ.start < rowStart, clipEnd: occ.end > rowEnd })
  }
  return bars
}

/**
 * Side-by-side columns for one day's timed events: overlapping events split
 * the width, a non-overlapping one gets it all.
 * @param {Occurrence[]} occs  timed, single-day, same day
 * @returns {{occ: Occurrence, top: number, bottom: number, col: number, cols: number}[]}
 */
export function layoutDay(occs) {
  const items = occs
    .map((occ) => ({ occ, top: toMin(occ.ev.time), bottom: endMin(occ.ev), col: 0, cols: 1 }))
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom)
  /** @type {typeof items} */
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((i) => i.col + 1))
    for (const i of cluster) i.cols = cols
    cluster = []
  }
  for (const it of items) {
    if (it.top >= clusterEnd) {
      flush()
      clusterEnd = -1
    }
    const used = new Set(cluster.filter((c) => c.bottom > it.top).map((c) => c.col))
    while (used.has(it.col)) it.col++
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.bottom)
  }
  flush()
  return items
}
