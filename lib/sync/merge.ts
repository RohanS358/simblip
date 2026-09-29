// Three-way merge for id-keyed collections — the notebook tree and the
// account's calendar events, to-dos and sticky notes.
//
// `base` is the copy both sides last agreed on (what this device last pulled
// or pushed successfully). Comparing each side against it tells an edit from
// a stale copy, and a deletion from "never had it":
//
//   in local & remote   → whichever side changed vs base wins; both changed →
//                         local wins (it's the edit the user is looking at)
//   only in local       → new here (keep), or deleted remotely (drop) — unless
//                         local ALSO edited it since base, then keep: an edit
//                         beats a concurrent delete, so no work is lost
//   only in remote      → mirror image of the above
//
// Without a base (first sync on this device) it degrades to a union where
// local wins collisions — additive, never lossy.
//
// Pure, no imports: node tests load it directly (merge.test.mjs).

export type Keyed<T> = Record<string, T>

/** JSON text with object keys sorted. Postgres jsonb hands objects back in
 *  its own key order, so plain JSON.stringify would call identical data
 *  "changed" after every round trip — spurious conflicts and push/pull
 *  ping-pong. Undefined-valued keys are dropped, as JSON would. */
export function canonicalJSON(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJSON(x))).join(',')}]`
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined && typeof o[k] !== 'function')
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

const same = (a: unknown, b: unknown) => a === b || canonicalJSON(a) === canonicalJSON(b)

export function threeWayMerge<T>(
  base: Keyed<T> | null,
  local: Keyed<T>,
  remote: Keyed<T>,
  eq: (a: T, b: T) => boolean = same
): Keyed<T> {
  const out: Keyed<T> = {}
  const ids = new Set([...Object.keys(local), ...Object.keys(remote)])
  for (const id of ids) {
    const l = local[id]
    const r = remote[id]
    const b = base?.[id]
    if (l !== undefined && r !== undefined) {
      out[id] = b !== undefined && eq(l, b) ? r : l
    } else if (l !== undefined) {
      // Missing remotely: deleted there, or created here.
      if (base && b !== undefined && eq(l, b)) continue // deleted remotely, untouched here
      out[id] = l
    } else if (r !== undefined) {
      if (base && b !== undefined && eq(r, b)) continue // deleted here, untouched remotely
      out[id] = r
    }
  }
  return out
}

/** Arrays of `{ id }` items (calendar events, to-dos) through the same merge,
 *  keeping local order first and appending remote-only items. */
export function mergeById<T extends { id: string }>(
  base: T[] | null,
  local: T[],
  remote: T[],
  eq?: (a: T, b: T) => boolean
): T[] {
  const toMap = (xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]))
  const merged = threeWayMerge(base ? toMap(base) : null, toMap(local), toMap(remote), eq)
  const order = [...local.map((x) => x.id), ...remote.map((x) => x.id)]
  const seen = new Set<string>()
  const out: T[] = []
  for (const id of order) {
    if (seen.has(id) || !merged[id]) continue
    seen.add(id)
    out.push(merged[id])
  }
  return out
}

/** Stable content fingerprint (FNV-1a over the canonical JSON text) — lets
 *  the pusher skip a page whose content hasn't changed since its last
 *  successful push, independent of key order. */
export function fingerprint(value: unknown): string {
  const s = canonicalJSON(value)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}.${s.length.toString(36)}`
}
