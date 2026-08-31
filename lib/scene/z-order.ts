// Stacking order, kept in a range CSS can actually represent.
//
// The bug this exists to fix: several creation paths stamped `z: Date.now()`
// (~1.7e12) while lib/scene/factory.ts's nextZ() produces a 6-digit counter.
// CSS z-index is a 32-BIT SIGNED INT — anything above 2147483647 clamps to
// 2147483647. So every Date.now()-stamped object landed on the SAME top
// layer, and no amount of "put it above everything" arithmetic could lift a
// later stroke over them: topZ() computed a bigger number, CSS threw the
// difference away, and DOM order silently decided the winner. That is why
// freshly drawn ink rendered UNDER an already-placed picture.
//
// The fix is to stop treating z as an ever-growing timestamp and treat it as
// what it actually is: a dense ordinal. Objects are renumbered 1..N in their
// existing relative order, so the numbers stay small forever, ordering is
// exact, and "move this above that" is a list splice rather than arithmetic.

import type { SceneObject, PageDoc } from './types'

/** CSS z-index is a 32-bit signed int; past this the browser clamps and all
 *  ordering information above the ceiling is lost. */
export const CSS_Z_MAX = 2147483647

/** Ordinals stay far below CSS_Z_MAX, so a page would need this many objects
 *  before normalization could overflow. Used only to sanity-check input. */
const SANE_Z_LIMIT = 1_000_000

/** Backdrops (a system boundary) sit at z 0, deliberately below the 1..N
 *  ordinal range, so they stay beneath the parts drawn inside them instead
 *  of being shuffled into the stack by normalization. */
const isBackdrop = (o: SceneObject): boolean => o.z === 0 && o.metadata?.render === 'system'

/** True if a page's stacking order is not already a dense 1..N run.
 *
 *  Range alone is not enough to check: {5, 9} is perfectly representable in
 *  CSS but leaves gaps, and gaps are how the old system rotted — every
 *  restack widened them until the numbers drifted somewhere CSS could no
 *  longer tell two layers apart. Density is the invariant worth holding, and
 *  it subsumes the range check (a timestamp is never a small ordinal). */
export function needsNormalize(objects: Record<string, SceneObject>): boolean {
  const seen = new Set<number>()
  let count = 0
  for (const o of Object.values(objects)) {
    if (isBackdrop(o)) continue
    count++
    const z = o.z
    if (!Number.isFinite(z) || !Number.isInteger(z) || z < 1 || z > SANE_Z_LIMIT) return true
    if (seen.has(z)) return true // a duplicate has no defined order
    seen.add(z)
  }
  // Dense means the values are exactly 1..count, so the max settles it.
  for (const z of seen) if (z > count) return true
  return false
}

/** Every object on the page, bottom-first. Ties break on id so the order is
 *  stable across reloads instead of depending on object-key iteration. */
export function stackOrder(objects: Record<string, SceneObject>): SceneObject[] {
  return Object.values(objects).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Renumber the page 1..N in its current relative order. Returns a NEW
 *  objects map, or the original when nothing needed changing (so callers can
 *  use identity to skip a store write). Backdrops keep their z 0. */
export function normalizeZ(objects: Record<string, SceneObject>): Record<string, SceneObject> {
  let changed = false
  const next: Record<string, SceneObject> = {}
  let i = 0
  for (const o of stackOrder(objects)) {
    if (isBackdrop(o)) {
      next[o.id] = o
      continue
    }
    const z = ++i
    if (o.z === z) {
      next[o.id] = o
    } else {
      next[o.id] = { ...o, z }
      changed = true
    }
  }
  return changed ? next : objects
}

/** Page-level wrapper: normalize in place, preserving identity when clean. */
export function normalizePageZ(page: PageDoc): PageDoc {
  const objects = normalizeZ(page.objects)
  return objects === page.objects ? page : { ...page, objects }
}

/** The z a brand-new object should get: one above the current top.
 *
 *  Unlike the old topZ(), this never consults a session counter — the page's
 *  own maximum is the only thing that matters, and because the page is kept
 *  normalized that maximum is a small integer. */
export function nextTopZ(objects: Record<string, SceneObject>): number {
  let max = 0
  for (const o of Object.values(objects)) if (Number.isFinite(o.z) && o.z > max) max = o.z
  return Math.min(max, SANE_Z_LIMIT) + 1
}

/**
 * Reorder by splice: take `movingIds` out of the stack and re-insert them so
 * they sit directly above `afterId` (or at the very bottom when afterId is
 * null). Returns the new z for every object whose z changed.
 *
 * This is what a Layers-list drag actually means, and doing it as a splice —
 * rather than picking a number "between" two neighbours — is why the z space
 * can never run out of room or collide.
 */
export function reorderZ(
  objects: Record<string, SceneObject>,
  movingIds: string[],
  afterId: string | null
): Record<string, number> {
  const moving = new Set(movingIds)
  const ordered = stackOrder(objects)
  // Keep the dragged objects in their own relative order, not in the order
  // the caller happened to list them.
  const picked = ordered.filter((o) => moving.has(o.id))
  if (picked.length === 0) return {}
  const rest = ordered.filter((o) => !moving.has(o.id))

  // Dropping onto one of the dragged objects is a no-op, not an error.
  const anchorIdx = afterId === null ? -1 : rest.findIndex((o) => o.id === afterId)
  if (afterId !== null && anchorIdx === -1) return {}

  const merged = [...rest.slice(0, anchorIdx + 1), ...picked, ...rest.slice(anchorIdx + 1)]

  const patch: Record<string, number> = {}
  merged.forEach((o, i) => {
    const z = i + 1
    if (o.z !== z) patch[o.id] = z
  })
  return patch
}

/** Send the given objects to the very front or very back, keeping their
 *  relative order. Returns the changed z values, same shape as reorderZ. */
export function restackZ(
  objects: Record<string, SceneObject>,
  ids: string[],
  where: 'front' | 'back'
): Record<string, number> {
  if (where === 'back') return reorderZ(objects, ids, null)
  const ordered = stackOrder(objects)
  const moving = new Set(ids)
  const last = [...ordered].reverse().find((o) => !moving.has(o.id))
  // Everything is selected — already "at the front" by definition.
  return last ? reorderZ(objects, ids, last.id) : {}
}
