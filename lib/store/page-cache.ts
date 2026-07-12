'use client'

// Page residency policy.
//
// Keeping every page in memory makes a big notebook slower the longer you use
// it. Evicting a page the instant you leave it makes flipping between two
// pages feel awful. So closed pages linger:
//
//   1. GRACE — a page you closed stays in memory for 3 minutes. Switch back
//      within that window and it's instant, with its undo history intact.
//      After it, a sweeper flushes it to the archive and releases it.
//
//   2. PRESSURE — if the tab is actually straining (JS heap near its ceiling,
//      or the main thread is choking on long tasks), waiting 3 minutes is the
//      wrong answer. Everything but the open page is released immediately.
//
//   3. CAP — a hard limit on cached pages, so rapid page-hopping can't
//      accumulate an unbounded cache before the grace period ever expires.
//
// Evicting is never deleting: unloadPages() flushes to the local archive on
// the way out, the cloud sync reads evicted pages back from there, and only an
// explicit delete removes content (lib/store/deleted-pages.ts).

import { useDocStore } from '@/lib/store/document'

export const GRACE_MS = 3 * 60 * 1000 // how long a closed page may linger
const SWEEP_MS = 15_000 // how often we check
const MAX_CACHED = 4 // closed pages kept at most, newest first

/** Heap in use vs. the engine's ceiling. Above this we stop being generous. */
const HEAP_PRESSURE = 0.75
/** Main-thread time lost to long tasks per sweep window before we call it CPU pressure. */
const LONGTASK_BUDGET_MS = 2_500

/** pageId → when it stopped being the open page. */
const closedAt = new Map<string, number>()
let activeId: string | null = null

// ── Pressure sensing ────────────────────────────────────────────────────────

interface HeapInfo {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
}

/** Chrome-only, and that's fine — it's an optimisation, not a correctness
 *  requirement. Elsewhere we fall back to the grace period and the cap. */
function heapPressure(): boolean {
  const mem = (performance as Performance & { memory?: HeapInfo }).memory
  if (!mem?.jsHeapSizeLimit) return false
  return mem.usedJSHeapSize / mem.jsHeapSizeLimit > HEAP_PRESSURE
}

let longTaskMs = 0
let observer: PerformanceObserver | null = null

function startPressureSensor() {
  if (observer || typeof PerformanceObserver === 'undefined') return
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTaskMs += entry.duration
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    observer = null // unsupported browser — grace period and cap still apply
  }
}

/** True when the tab is straining right now. Resets the long-task tally. */
function underPressure(): boolean {
  const cpu = longTaskMs > LONGTASK_BUDGET_MS
  longTaskMs = 0
  return cpu || heapPressure()
}

// ── Policy ──────────────────────────────────────────────────────────────────

const cachedPages = (): string[] =>
  Object.keys(useDocStore.getState().pages).filter((id) => id !== activeId)

function evict(ids: string[]) {
  if (ids.length === 0) return
  useDocStore.getState().unloadPages(ids)
  ids.forEach((id) => closedAt.delete(id))
}

/** Release everything but the open page — the pressure response. */
export function evictAllCached(): void {
  evict(cachedPages())
}

function sweep() {
  const cached = cachedPages()
  if (cached.length === 0) return

  // (2) Straining → don't wait out the grace period.
  if (underPressure()) {
    evict(cached)
    return
  }

  const now = Date.now()
  const expired = cached.filter((id) => now - (closedAt.get(id) ?? now) >= GRACE_MS)

  // (3) Over the cap → drop the ones closed longest ago, even if still young.
  const survivors = cached
    .filter((id) => !expired.includes(id))
    .sort((a, b) => (closedAt.get(b) ?? 0) - (closedAt.get(a) ?? 0)) // newest first
  const overflow = survivors.slice(MAX_CACHED)

  evict([...expired, ...overflow])
}

let timer: ReturnType<typeof setInterval> | null = null

/** Tell the cache which page is open. Everything else becomes a candidate. */
export function setActivePage(pageId: string): void {
  if (activeId === pageId) return
  const now = Date.now()
  if (activeId) closedAt.set(activeId, now) // starts its 3-minute clock
  activeId = pageId
  closedAt.delete(pageId) // reopened — it's live again

  startPressureSensor()
  // A page opening is exactly when memory grows, so check right away rather
  // than waiting up to a full sweep interval.
  if (underPressure()) evictAllCached()
  else sweep()

  timer ??= setInterval(sweep, SWEEP_MS)
}

/** Stop the sweeper (route teardown). Cached pages stay archived regardless. */
export function stopPageCache(): void {
  if (timer) clearInterval(timer)
  timer = null
  observer?.disconnect()
  observer = null
}

/** For diagnostics: which pages are lingering, and for how long. */
export function cacheState(): { active: string | null; cached: { id: string; ageMs: number }[] } {
  const now = Date.now()
  return {
    active: activeId,
    cached: cachedPages().map((id) => ({ id, ageMs: now - (closedAt.get(id) ?? now) })),
  }
}
