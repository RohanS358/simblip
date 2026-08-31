// Groups: a container object that owns other objects and transforms them as
// a unit.
//
// The deliberate design decision here is that children keep ABSOLUTE page
// positions. A group is a container in every way the user can observe — one
// row in the Layers list, one selection, one bounding box, move/resize/rotate/
// delete as a unit — but it does NOT nest its children's coordinate space.
//
// Why: 202 call sites across 22 files (the physics world, the circuit and
// optics engines, snapping, terminal binding, PPTX/DOCX export, thumbnails,
// AI edit-ops, sync) read `obj.position` as page coordinates. Relative child
// coordinates would mean resolving a parent transform at every one of them,
// including inside two simulation engines. Keeping children absolute and
// having the group write deltas gets identical observable behaviour while
// leaving all of that untouched.
//
// The cost of the choice, stated plainly: a group is one level of ownership
// bookkeeping, not a true transform hierarchy. Rotating a group rotates each
// child about the GROUP's centre (handled here), which matches what users
// expect; but a child's own `rotation` stays its own.

import type { SceneObject, Vec2 } from './types'
import { uid } from './types'

/** Objects a group owns, in stack order, skipping ids that no longer resolve
 *  (a child deleted directly, or a bundle that arrived partially). */
export function childrenOf(
  group: SceneObject,
  objects: Record<string, SceneObject>
): SceneObject[] {
  const ids = group.geometry.children ?? []
  return ids.map((id) => objects[id]).filter((o): o is SceneObject => Boolean(o))
}

/** The group that directly owns `id`, or undefined when it is top-level.
 *
 *  Membership is stored on the PARENT (geometry.children) rather than as a
 *  parentId on the child, so this is a scan. Pages are small enough that a
 *  scan is the right trade against keeping two references in sync. */
export function groupOf(
  id: string,
  objects: Record<string, SceneObject>
): SceneObject | undefined {
  for (const o of Object.values(objects)) {
    if (o.geometry.kind === 'group' && o.geometry.children?.includes(id)) return o
  }
  return undefined
}

/** Walk up to the outermost group containing `id` — clicking a child of a
 *  nested group selects the whole outer group, the way Figma and Canva do.
 *  Returns the id itself when it belongs to no group. */
export function rootGroupOf(id: string, objects: Record<string, SceneObject>): string {
  const seen = new Set<string>([id])
  let current = id
  for (;;) {
    const parent = groupOf(current, objects)
    // A cycle would hang the editor. Corrupt data shouldn't be fatal, so
    // stop at the first repeat instead of trusting the structure.
    if (!parent || seen.has(parent.id)) return current
    seen.add(parent.id)
    current = parent.id
  }
}

/** Every descendant id of a group, depth-first (children, their children, …).
 *  Excludes the group itself. */
export function descendantIds(
  group: SceneObject,
  objects: Record<string, SceneObject>
): string[] {
  const out: string[] = []
  const seen = new Set<string>([group.id])
  const walk = (g: SceneObject) => {
    for (const id of g.geometry.children ?? []) {
      if (seen.has(id)) continue // cycle guard, as above
      seen.add(id)
      out.push(id)
      const child = objects[id]
      if (child?.geometry.kind === 'group') walk(child)
    }
  }
  walk(group)
  return out
}

/** The union bbox of the given objects, or null when there are none. */
export function unionBox(
  objs: SceneObject[]
): { x: number; y: number; w: number; h: number } | null {
  if (objs.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const o of objs) {
    minX = Math.min(minX, o.position.x)
    minY = Math.min(minY, o.position.y)
    maxX = Math.max(maxX, o.position.x + o.size.w)
    maxY = Math.max(maxY, o.position.y + o.size.h)
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

/** Build the container for `members`. The caller adds it to the page and is
 *  responsible for giving it a z (normally topZ of the page). */
export function makeGroup(members: SceneObject[], name?: string): SceneObject | null {
  const box = unionBox(members)
  if (!box || members.length < 2) return null
  return {
    id: uid(),
    name: name ?? 'Group',
    geometry: {
      kind: 'group',
      // Bottom-first, so the Layers list and the stacking order agree.
      children: [...members].sort((a, b) => a.z - b.z).map((o) => o.id),
    },
    position: { x: box.x, y: box.y },
    size: { w: box.w, h: box.h },
    rotation: 0,
    z: Math.max(...members.map((o) => o.z)),
    behaviors: [],
    parameters: {},
    metadata: {},
  }
}

/** Re-fit a group's box to its current children. Call after a child moves,
 *  resizes, or leaves — otherwise the container's bbox drifts away from what
 *  it actually contains and its selection outline lies. */
export function refitGroup(
  group: SceneObject,
  objects: Record<string, SceneObject>
): SceneObject | null {
  const box = unionBox(childrenOf(group, objects))
  if (!box) return null
  if (
    group.position.x === box.x &&
    group.position.y === box.y &&
    group.size.w === box.w &&
    group.size.h === box.h
  ) {
    return group
  }
  return { ...group, position: { x: box.x, y: box.y }, size: { w: box.w, h: box.h } }
}

/** Translate a group and everything it owns by the same delta.
 *  Returns { id -> new position } for the group and every descendant. */
export function moveGroupBy(
  group: SceneObject,
  objects: Record<string, SceneObject>,
  d: Vec2
): Record<string, Vec2> {
  const out: Record<string, Vec2> = {
    [group.id]: { x: group.position.x + d.x, y: group.position.y + d.y },
  }
  for (const id of descendantIds(group, objects)) {
    const o = objects[id]
    if (o) out[id] = { x: o.position.x + d.x, y: o.position.y + d.y }
  }
  return out
}

/**
 * Scale a group to a new size, carrying its children proportionally.
 *
 * Each child's offset from the group origin and its own size scale by the
 * same factors, so relative layout inside the group is preserved. Children
 * are NOT allowed to collapse to zero — a group dragged to nothing and back
 * would otherwise leave every child permanently at 0×0.
 */
export function scaleGroupTo(
  group: SceneObject,
  objects: Record<string, SceneObject>,
  next: { x: number; y: number; w: number; h: number }
): Record<string, { position: Vec2; size: { w: number; h: number } }> {
  const sx = group.size.w > 0 ? next.w / group.size.w : 1
  const sy = group.size.h > 0 ? next.h / group.size.h : 1
  const out: Record<string, { position: Vec2; size: { w: number; h: number } }> = {
    [group.id]: { position: { x: next.x, y: next.y }, size: { w: next.w, h: next.h } },
  }
  for (const id of descendantIds(group, objects)) {
    const o = objects[id]
    if (!o) continue
    out[id] = {
      position: {
        x: next.x + (o.position.x - group.position.x) * sx,
        y: next.y + (o.position.y - group.position.y) * sy,
      },
      size: { w: Math.max(1, o.size.w * sx), h: Math.max(1, o.size.h * sy) },
    }
  }
  return out
}

/**
 * Rotate a group by `deltaDeg`: each child orbits the group's centre AND
 * spins by the same amount, which is what makes a rotated group look like
 * one rigid object rather than a scatter of independently tilted parts.
 */
export function rotateGroupBy(
  group: SceneObject,
  objects: Record<string, SceneObject>,
  deltaDeg: number
): Record<string, { position: Vec2; rotation: number }> {
  const rad = (deltaDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = group.position.x + group.size.w / 2
  const cy = group.position.y + group.size.h / 2

  const out: Record<string, { position: Vec2; rotation: number }> = {
    [group.id]: { position: group.position, rotation: group.rotation + deltaDeg },
  }
  for (const id of descendantIds(group, objects)) {
    const o = objects[id]
    if (!o) continue
    // Orbit the child's CENTRE, then convert back to a top-left position —
    // rotating the top-left corner directly would also translate the child
    // by half its own size.
    const ox = o.position.x + o.size.w / 2 - cx
    const oy = o.position.y + o.size.h / 2 - cy
    const rx = ox * cos - oy * sin
    const ry = ox * sin + oy * cos
    out[id] = {
      position: { x: cx + rx - o.size.w / 2, y: cy + ry - o.size.h / 2 },
      rotation: o.rotation + deltaDeg,
    }
  }
  return out
}
