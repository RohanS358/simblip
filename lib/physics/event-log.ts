// Accessible simulation event log (UX masterplan §16 ADD): a screen-reader
// user has no way to know "the mass collided with the ground at t=1.4s" —
// that currently exists only as a visual flash on the canvas. This is a new
// READER of notable physics events (collisions today; the same shape covers
// circuit-loop-closed / threshold-crossed later), not a new instrumentation
// system — same per-page ring-buffer/subscribe shape as bus.ts.

export interface LogEvent {
  t: number // sim time, seconds
  text: string
}

const CAPACITY = 200
// A stable empty-array reference — useSyncExternalStore compares snapshots
// with Object.is, so getEvents must NEVER hand back a fresh `[]` for "no
// events yet" (that looks like a change on every call and loops forever).
const EMPTY: LogEvent[] = []
const logs = new Map<string, LogEvent[]>()
const listeners = new Map<string, Set<() => void>>()
// Per-pair cooldown so a single sustained contact (multiple resolver
// iterations firing collisionStart in the same instant) logs one line, not
// a burst — keyed page:a:b, not just a:b, so two pages never cross-suppress.
const lastLoggedAt = new Map<string, number>()
const COOLDOWN_MS = 300

export function pushEvent(pageId: string, t: number, text: string, dedupeKey?: string) {
  if (dedupeKey) {
    const key = `${pageId}:${dedupeKey}`
    const now = performance.now()
    if (now - (lastLoggedAt.get(key) ?? -Infinity) < COOLDOWN_MS) return
    lastLoggedAt.set(key, now)
  }
  // A NEW array each time (never mutate in place) — the snapshot reference
  // has to change for useSyncExternalStore to notice a real update too.
  const next = [...(logs.get(pageId) ?? []), { t, text }]
  if (next.length > CAPACITY) next.splice(0, next.length - CAPACITY)
  logs.set(pageId, next)
  listeners.get(pageId)?.forEach((fn) => fn())
}

export function clearEvents(pageId: string) {
  logs.set(pageId, EMPTY)
  listeners.get(pageId)?.forEach((fn) => fn())
}

export function getEvents(pageId: string): LogEvent[] {
  return logs.get(pageId) ?? EMPTY
}

export function subscribe(pageId: string, fn: () => void): () => void {
  let set = listeners.get(pageId)
  if (!set) {
    set = new Set()
    listeners.set(pageId, set)
  }
  set.add(fn)
  return () => set!.delete(fn)
}
