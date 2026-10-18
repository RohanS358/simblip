// "10k", "4.7 µF", "1 0 k Ω", "9V" → a number. Restricted alphabet on purpose
// (plan 4.4): digits, one decimal point, an SI prefix, then a unit we ignore.
const PREFIX: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3,
  k: 1e3, K: 1e3, M: 1e6, G: 1e9,
}

/** Returns null when the text is not a plain quantity. */
export function parseQuantity(text: string): number | null {
  // Drop one trailing unit symbol (case-sensitive: 'M' is mega, 'm' milli).
  const s = text.replace(/\s+/g, '').replace(/(?:ohms?|Hz|[ΩVAFH])$/, '')
  const m = s.match(/^([+-]?\d*\.?\d+)([pnuµμmkKMG]?)$/)
  if (!m) return null
  const n = Number((parseFloat(m[1]) * (m[2] ? PREFIX[m[2]] : 1)).toPrecision(12))
  return Number.isFinite(n) ? n : null
}
