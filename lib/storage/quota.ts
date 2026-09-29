// The cloud storage budget — shared by the server (which enforces it) and the
// client (which only DISPLAYS it; the server never trusts a client number).
//
// A "project" is one account's cloud workspace: the notebook tree, every
// synced page's content, account-level data (calendar, to-dos, sticky notes)
// and the bytes of every file the user opted into cloud sync. All of it
// shares one strict 150 MB allowance.
//
// Pure module (no imports) so node tests can load it directly.

export const PROJECT_QUOTA_BYTES = 150 * 1024 * 1024

/** Start warning in the UI at this fraction of the quota. */
export const QUOTA_WARN_RATIO = 0.8

/** One page row may not exceed this. A page this big almost always means an
 *  image was inlined into the JSON instead of stored as a file. */
export const MAX_ROW_BYTES = 20 * 1024 * 1024

export type QuotaCategory = 'tree' | 'pages' | 'account' | 'files'

export interface QuotaUsage {
  limit: number
  used: number
}

/**
 * Decide whether a write fits. `used` already includes the rows being
 * replaced, so a replacement is charged only its growth: new - old. A write
 * that shrinks usage (delta <= 0) is ALWAYS allowed, even over quota — a
 * user who is over must be able to trim a page or delete things to get back
 * under, never be locked out of their own work.
 */
export function quotaDecision(used: number, delta: number, limit = PROJECT_QUOTA_BYTES) {
  const after = used + delta
  return { ok: delta <= 0 || after <= limit, after, remaining: Math.max(0, limit - used) }
}

/** UTF-8 byte length of a JSON value as the server stores it. */
export function jsonBytes(value: unknown): number {
  if (value === undefined || value === null) return 0
  return new TextEncoder().encode(JSON.stringify(value)).length
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}
