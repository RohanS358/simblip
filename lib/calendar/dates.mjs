// Calendar date math for the AD/BS calendar — pure, DOM-free, testable.
//
// Every day is a 'YYYY-MM-DD' key in the LOCAL (Gregorian) calendar. Keys are
// what the event store persists, so they are the one currency here; the
// Bikram Sambat date is always derived from a key, never stored. Arithmetic
// runs on UTC day numbers so a DST shift can never turn "+1 day" into 23h.
//
// ── Bikram Sambat ────────────────────────────────────────────────────────
// BS month lengths are not computable — they come from the published
// panchanga, so they're a table. One 12-digit string per year from 2000 BS,
// each digit is (days − 29). Source: nepali-date-converter@3.4.0 (MIT,
// Subesh Bhandari), which cross-checks against Nepal's official calendar.
// Anchor: 1 Baisakh 2000 BS = 14 April 1943 AD.
// ponytail: table ends at 2090 BS (2034 AD); append rows as the government
// publishes them — nothing else changes.
//
// Run: node lib/calendar/dates.test.mjs

const BS_DATA = (
  '132321110102 223222101011 223321101011 232321110012 132321110102 223222101011 ' +
  '223321101011 232321110012 222322011002 223222101011 223321101011 232321110012 ' +
  '222322011011 223222101011 223321101011 232321110012 222322011011 223222101011 ' +
  '232321101011 232321110102 222322101011 223222101011 232321110011 232321110102 ' +
  '222322101011 223222101011 232321110012 132321110102 223222101011 223231101011 ' +
  '232321110012 132321110102 223222101011 223321101011 232321110012 132322011002 ' +
  '223222101011 223321101011 232321110012 222322011011 223222101011 223321101011 ' +
  '232321110012 222322011011 223222101011 232321101011 232321110012 222322101011 ' +
  '223222101011 232321110011 232321110102 222322101011 223222101011 232321110011 ' +
  '232321110102 223222101011 223231101011 232321110012 132321110102 223222101011 ' +
  '223321101011 232321110012 132322010102 223222101011 223321101011 232321110012 ' +
  '222322011002 223222101011 223321101011 232321110012 222322011011 223222101011 ' +
  '232321101011 232321110012 222322101011 223222101011 232321110011 232321110102 ' +
  '222322101011 223222101011 232321110011 232321110102 223222101011 223222101011 ' +
  '232321110012 132321110102 223222101011 223222110111 123312110111 132321110111 ' +
  '132321110111'
)
  .split(' ')
  .map((row) => Array.from(row, (c) => 29 + Number(c)))

export const BS_MIN_YEAR = 2000
export const BS_MAX_YEAR = BS_MIN_YEAR + BS_DATA.length - 1

export const BS_MONTHS = [
  'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
]
export const BS_MONTHS_NE = [
  'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
  'कार्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत',
]

const DAY_MS = 86_400_000

/** @param {string} key 'YYYY-MM-DD' → UTC day number. */
export function dayNum(key) {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

/** @param {number} n UTC day number → 'YYYY-MM-DD'. */
export function dayKey(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

/** @param {Date} date a local Date → its local 'YYYY-MM-DD'. */
export function keyOf(date) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** @param {string} key @param {number} n */
export const addDays = (key, n) => dayKey(dayNum(key) + n)

/** 0 = Sunday. @param {string} key */
export const weekday = (key) => (((dayNum(key) + 4) % 7) + 7) % 7

/** @param {string} key */
export function adParts(key) {
  const [y, m, d] = key.split('-').map(Number)
  return { y, m: m - 1, d }
}

/** Gregorian y / 0-based m / d → key; month and day may overflow.
 *  @param {number} y @param {number} m @param {number} d */
export const fromAD = (y, m, d) => dayKey(Date.UTC(y, m, d) / DAY_MS)

/** @param {number} y @param {number} m 0-based */
export const adMonthLength = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

// Day number of 1 Baisakh for every table year, plus one past the end.
const EPOCH = Date.UTC(1943, 3, 14) / DAY_MS
const YEAR_START = [EPOCH]
for (const months of BS_DATA) {
  YEAR_START.push(YEAR_START[YEAR_START.length - 1] + months.reduce((a, b) => a + b, 0))
}

/** Days in a BS month, or 0 outside the table.
 *  @param {number} y @param {number} m 0-based */
export function bsMonthLength(y, m) {
  return BS_DATA[y - BS_MIN_YEAR]?.[m] ?? 0
}

/**
 * @param {string} key
 * @returns {{y: number, m: number, d: number} | null} m is 0-based; null
 *   outside the table's range.
 */
export function toBS(key) {
  const n = dayNum(key)
  if (n < EPOCH || n >= YEAR_START[YEAR_START.length - 1]) return null
  let i = 0
  while (YEAR_START[i + 1] <= n) i++
  let rest = n - YEAR_START[i]
  let m = 0
  while (rest >= BS_DATA[i][m]) rest -= BS_DATA[i][m++]
  return { y: BS_MIN_YEAR + i, m, d: rest + 1 }
}

/**
 * BS y / 0-based m / d → AD key. The month may overflow either way (m = 12 is
 * next year's Baisakh), which is what month navigation wants. The day may not
 * exceed the month — returns null for that and for out-of-table dates.
 * @param {number} y @param {number} m @param {number} d
 */
export function fromBS(y, m, d) {
  y += Math.floor(m / 12)
  m = ((m % 12) + 12) % 12
  const i = y - BS_MIN_YEAR
  if (i < 0 || i >= BS_DATA.length || d < 1 || d > BS_DATA[i][m]) return null
  let n = YEAR_START[i] + d - 1
  for (let k = 0; k < m; k++) n += BS_DATA[i][k]
  return dayKey(n)
}

const NE_DIGITS = '०१२३४५६७८९'
/** @param {number | string} n */
export const nepaliDigits = (n) => String(n).replace(/\d/g, (c) => NE_DIGITS[Number(c)])

// ── Calendar systems ─────────────────────────────────────────────────────
// Everything that differs between "AD first" and "BS first" — where a month
// starts, how long it is, what it's called — lives behind this one pair of
// functions, so every view is written once and swaps systems by argument.

/** @typedef {'ad' | 'bs'} CalSystem */

/**
 * The month containing `key` in `system`, shifted by `offset` months.
 * @param {CalSystem} system @param {string} key @param {number} [offset]
 * @returns {{first: string, last: string, y: number, m: number}}
 */
export function monthOf(system, key, offset = 0) {
  if (system === 'bs') {
    const bs = toBS(key)
    if (bs) {
      const y = bs.y + Math.floor((bs.m + offset) / 12)
      const m = (((bs.m + offset) % 12) + 12) % 12
      const first = fromBS(y, m, 1)
      if (first) return { first, last: /** @type {string} */ (fromBS(y, m, bsMonthLength(y, m))), y, m }
    }
    // Outside the table: fall through to AD rather than render nothing.
  }
  const { y: ay, m: am } = adParts(key)
  const y = ay + Math.floor((am + offset) / 12)
  const m = (((am + offset) % 12) + 12) % 12
  return { first: fromAD(y, m, 1), last: fromAD(y, m, adMonthLength(y, m)), y, m }
}

/**
 * The date parts of `key` in `system`.
 * @param {CalSystem} system @param {string} key
 */
export function partsIn(system, key) {
  return (system === 'bs' && toBS(key)) || adParts(key)
}

const AD_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** BS names stay whole when short — "Asoj", not "Aso"; they're short already.
 *  @param {CalSystem} system @param {number} m @param {boolean} [short] */
export function monthName(system, m, short = false) {
  if (system === 'bs') return BS_MONTHS[m]
  return short ? AD_MONTHS[m].slice(0, 3) : AD_MONTHS[m]
}

/**
 * Human label for the months a key range touches in `system`:
 * "September–October 2026", "Asoj–Kartik 2083", "Dec 2025 – Jan 2026".
 * @param {CalSystem} system @param {string} from @param {string} to
 */
export function rangeLabel(system, from, to) {
  const a = partsIn(system, from)
  const b = partsIn(system, to)
  if (a.y === b.y && a.m === b.m) return `${monthName(system, a.m)} ${a.y}`
  if (a.y === b.y) return `${monthName(system, a.m)}–${monthName(system, b.m)} ${a.y}`
  return `${monthName(system, a.m, true)} ${a.y} – ${monthName(system, b.m, true)} ${b.y}`
}
