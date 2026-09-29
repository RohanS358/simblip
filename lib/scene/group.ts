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
export function makeGroup(
  members: SceneObject[],
  name?: string,
  objects: Record<string, SceneObject> = Object.fromEntries(members.map((o) => [o.id, o]))
): SceneObject | null {
  // Tightest box over the members' real outlines — rotated to match them
  // when they are rotated — not the union of their unrotated boxes.
  const f = members.length < 2 ? null : orientedBox(members, objects)
  if (!f) return null
  return {
    id: uid(),
    name: name ?? 'Group',
    geometry: {
      kind: 'group',
      // Bottom-first, so the Layers list and the stacking order agree.
      children: [...members].sort((a, b) => a.z - b.z).map((o) => o.id),
    },
    position: { x: f.cx - f.w / 2, y: f.cy - f.h / 2 },
    size: { w: f.w, h: f.h },
    rotation: f.angle,
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

/** Scale an object's own geometry points (ink, polygons, lines) with its
 *  box. They are object-local px, not normalised, so without this a scaled
 *  box keeps its old drawing pasted inside it. Extra per-point values (ink
 *  pressure) ride along untouched. */
export function scalePoints(points: number[][] | undefined, sx: number, sy: number): number[][] | undefined {
  return points?.map(([x, y, ...rest]) => [x * sx, y * sy, ...rest])
}

/** A stroke's pen width scales with it (geometric mean of the axes), or a
 *  handwritten word blown up 3× comes out as hairlines. */
export function scaleInkMeta(o: SceneObject, sx: number, sy: number): SceneObject['metadata'] {
  const size = typeof o.metadata.inkSize === 'number' ? o.metadata.inkSize : 5
  return { ...o.metadata, inkSize: Math.max(0.5, size * Math.sqrt(sx * sy)) }
}

export type ScalePatch = {
  position: Vec2
  size: { w: number; h: number }
  rotation?: number
  geometry?: SceneObject['geometry']
  metadata?: SceneObject['metadata']
}

/** A box in page space: centre, size, and the angle its sides run at. */
export type Frame = { cx: number; cy: number; w: number; h: number; angle: number }

/** Object-local point → page coords, honouring rotation about the box centre. */
export function toWorld(o: SceneObject, x: number, y: number): Vec2 {
  if (!o.rotation) return { x: o.position.x + x, y: o.position.y + y }
  const rad = (o.rotation * Math.PI) / 180
  const dx = x - o.size.w / 2
  const dy = y - o.size.h / 2
  return {
    x: o.position.x + o.size.w / 2 + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: o.position.y + o.size.h / 2 + dx * Math.sin(rad) + dy * Math.cos(rad),
  }
}

/** Page-space points outlining an object: its ink/vertex points when it has
 *  them (so a box hugs handwriting, not its padded box), else its rotated
 *  corners. A group is outlined by its descendants. */
export function outlinePoints(o: SceneObject, objects: Record<string, SceneObject>): Vec2[] {
  if (o.geometry.kind === 'group')
    return descendantIds(o, objects).flatMap((id) => {
      const c = objects[id]
      return c && c.geometry.kind !== 'group' ? outlinePoints(c, objects) : []
    })
  const pts = o.geometry.points?.length
    ? o.geometry.points
    : [[0, 0], [o.size.w, 0], [o.size.w, o.size.h], [0, o.size.h]]
  return pts.map(([x, y]) => toWorld(o, x, y))
}

/**
 * The smallest box around `objs`, trying each orientation the objects
 * themselves use (plus upright). Rotate a handwritten word by 30° and its
 * selection turns 30° with it and hugs it; a mixed selection with nothing
 * rotated stays upright. Candidate angles only — not an arbitrary minimum-
 * area search — so the box never tilts to some angle nothing is drawn at.
 */
export function orientedBox(objs: SceneObject[], objects: Record<string, SceneObject>): Frame | null {
  const pts = objs.flatMap((o) => outlinePoints(o, objects))
  if (pts.length === 0) return null
  const angles = new Set<number>([0])
  for (const o of objs) {
    for (const id of [o.id, ...(o.geometry.kind === 'group' ? descendantIds(o, objects) : [])]) {
      const r = objects[id]?.rotation ?? o.rotation
      if (r) angles.add(Math.round((((r % 90) + 90) % 90) * 10) / 10)
    }
  }
  let best: (Frame & { area: number }) | null = null
  for (const angle of angles) {
    const rad = (angle * Math.PI) / 180
    const c = Math.cos(rad)
    const s = Math.sin(rad)
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
    for (const p of pts) {
      const u = p.x * c + p.y * s
      const v = -p.x * s + p.y * c
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const w = Math.max(1, maxU - minU)
    const h = Math.max(1, maxV - minV)
    // Strictly smaller (with slack) — ties keep the upright box.
    if (best && w * h >= best.area * 0.999) continue
    const mu = (minU + maxU) / 2
    const mv = (minV + maxV) / 2
    best = { cx: mu * c - mv * s, cy: mu * s + mv * c, w, h, angle, area: w * h }
  }
  if (!best) return null
  const { area: _area, ...frame } = best
  return frame
}

/**
 * Stretch objects from frame `f0` to `f1` (same angle, new centre/size):
 * everything scales by w1/w0 along the frame's width axis and h1/h0 along
 * its height axis. Uniform when those match, a true side-stretch when not.
 *
 * - Ink/vertex objects are re-expressed exactly: their points go through the
 *   stretch and they adopt the frame's angle, so a stroke at any rotation
 *   stretches correctly instead of shearing out of its box.
 * - Box objects keep their own rotation; their centre goes through the
 *   stretch, and their size takes the matching axis factors when they are
 *   aligned with the frame (0°/90°), else the uniform mean.
 * - Pen width and (uniform only) type size scale along.
 */
export function transformInFrame(
  ids: string[],
  objects: Record<string, SceneObject>,
  f0: Frame,
  f1: Frame
): Record<string, ScalePatch> {
  const sx = f1.w / (f0.w || 1)
  const sy = f1.h / (f0.h || 1)
  const uniform = Math.abs(sx - sy) < 1e-6
  const rad = (f0.angle * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const map = (p: Vec2): Vec2 => {
    const dx = p.x - f0.cx
    const dy = p.y - f0.cy
    const u = (dx * c + dy * s) * sx
    const v = (-dx * s + dy * c) * sy
    return { x: f1.cx + u * c - v * s, y: f1.cy + u * s + v * c }
  }
  const out: Record<string, ScalePatch> = {}
  for (const id of ids) {
    const o = objects[id]
    if (!o) continue
    const pts = o.geometry.kind !== 'group' ? o.geometry.points : undefined
    if (pts?.length) {
      // Box corners ride along so any padding around the ink is kept.
      const local = [[0, 0], [o.size.w, 0], [o.size.w, o.size.h], [0, o.size.h], ...pts]
      const q = local.map(([x, y]) => {
        const p = map(toWorld(o, x, y))
        return { u: p.x * c + p.y * s, v: -p.x * s + p.y * c }
      })
      let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
      for (const { u, v } of q) {
        minU = Math.min(minU, u); maxU = Math.max(maxU, u)
        minV = Math.min(minV, v); maxV = Math.max(maxV, v)
      }
      const w = Math.max(1, maxU - minU)
      const h = Math.max(1, maxV - minV)
      const mu = (minU + maxU) / 2
      const mv = (minV + maxV) / 2
      const cx = mu * c - mv * s
      const cy = mu * s + mv * c
      out[id] = {
        position: { x: cx - w / 2, y: cy - h / 2 },
        size: { w, h },
        rotation: f0.angle,
        geometry: { ...o.geometry, points: pts.map((p, i) => [q[4 + i].u - minU, q[4 + i].v - minV, ...p.slice(2)]) },
        ...(o.geometry.kind === 'stroke' ? { metadata: scaleInkMeta(o, sx, sy) } : {}),
      }
      continue
    }
    const ctr = map(toWorld(o, o.size.w / 2, o.size.h / 2))
    const phi = ((((o.rotation - f0.angle) % 180) + 180) % 180)
    const k = Math.sqrt(sx * sy)
    const [kw, kh] = phi < 0.5 || phi > 179.5 ? [sx, sy] : Math.abs(phi - 90) < 0.5 ? [sy, sx] : [k, k]
    const w = Math.max(1, o.size.w * kw)
    const h = Math.max(1, o.size.h * kh)
    const patch: ScalePatch = { position: { x: ctr.x - w / 2, y: ctr.y - h / 2 }, size: { w, h } }
    if (o.geometry.kind === 'text' && uniform)
      patch.metadata = { ...o.metadata, textScale: ((o.metadata.textScale as number | undefined) ?? 1) * sx }
    out[id] = patch
  }
  return out
}

/** A group's own frame: its box, at its rotation. */
export function frameOf(o: SceneObject): Frame {
  return { cx: o.position.x + o.size.w / 2, cy: o.position.y + o.size.h / 2, w: o.size.w, h: o.size.h, angle: o.rotation }
}

/**
 * Scale a group to a new box (same rotation), carrying everything it owns —
 * positions, sizes, ink points, pen width, type size — via transformInFrame.
 * Non-uniform `next` stretches along the group's own axes.
 */
export function scaleGroupTo(
  group: SceneObject,
  objects: Record<string, SceneObject>,
  next: { x: number; y: number; w: number; h: number }
): Record<string, ScalePatch> {
  const f1: Frame = { cx: next.x + next.w / 2, cy: next.y + next.h / 2, w: next.w, h: next.h, angle: group.rotation }
  return {
    ...transformInFrame(descendantIds(group, objects), objects, frameOf(group), f1),
    [group.id]: { position: { x: next.x, y: next.y }, size: { w: next.w, h: next.h } },
  }
}

const wrapDeg = (d: number) => Math.round((((d % 360) + 360) % 360) * 10) / 10

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
    [group.id]: { position: group.position, rotation: wrapDeg(group.rotation + deltaDeg) },
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
      rotation: wrapDeg(o.rotation + deltaDeg),
    }
  }
  return out
}
