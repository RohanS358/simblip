// Rail layout — draw a circuit the way a textbook does.
//
//        ┌──[R1]──[R2]──┬────────┬──┐         source on the left, series parts
//        │              │        │  │         along the TOP rail, parallel
//      ( + )          [R3]     [R4][VM]       branches as vertical RUNGS between the
//        │              │        │  │         rails, the return along the BOTTOM.
//        └──────────────┴────────┴──┘
//
// The annealer in circuit-layout.ts minimises wire length, crossings and
// perimeter. That is the right objective for a tangle of gates and transistors,
// and the wrong one for a loop of resistors: it has no notion of a rectangle, of
// a row, of "parts that are in series sit on the same line". Its own header says
// so — "the real fix for a cyclic analog circuit is a rail-aware placer that
// assigns nets to horizontal rails first". This is that placer, for the circuits
// it can recognise; everything else falls back to the annealer unchanged.
//
// What it recognises: ONE source and any number of two-terminal parts whose
// network reduces by series/parallel steps (series chains, dividers, ladders,
// banks, meters across a part). A bridge, a transistor, an op-amp, a gate or a
// second source returns null and the annealer takes over.
//
// Pure: ids, edges, parts in → positions out. Routing is still the A* tier.

import { terminalsOf } from '@/lib/circuit/engine'
import type { SceneObject } from './types'
import type { Edge, Placement, Pt } from './circuit-layout'

const GRID = 20
/** Centre-to-centre pitch of parts along a horizontal rail (96px part + wire). */
const PITCH = 140
/** Centre-to-centre pitch of rungs (a rotated part is only 48px wide). */
const RUNG_PITCH = 120
const PART_LEN = 96
const PART_GAP = 44

const SOURCES = new Set(['battery', 'ac-source', 'current-source'])

// ── Series–parallel reduction ───────────────────────────────────────────────

type Tree =
  | { kind: 'part'; id: string; a: number; b: number; aIdx: number }
  | { kind: 'series'; items: Tree[]; a: number; b: number }
  | { kind: 'par'; items: Tree[]; a: number; b: number }

/** The same network drawn the other way round (its two ends swapped). */
function flip(t: Tree): Tree {
  if (t.kind === 'part') return { ...t, a: t.b, b: t.a, aIdx: 1 - t.aIdx }
  if (t.kind === 'series') return { kind: 'series', items: [...t.items].reverse().map(flip), a: t.b, b: t.a }
  return { kind: 'par', items: t.items.map(flip), a: t.b, b: t.a }
}
const startingAt = (t: Tree, net: number): Tree => (t.a === net ? t : flip(t))

/** Reduce a two-terminal network between nets T and B. Null if it is not
 *  series–parallel (a bridge) or has a dangling branch. */
function reduce(parts: Tree[], T: number, B: number): Tree | null {
  let edges = parts
  for (let guard = 0; guard < 500; guard++) {
    let changed = false

    // Parallel: edges between the same pair of nets.
    const byPair = new Map<string, Tree[]>()
    for (const e of edges) {
      const k = e.a < e.b ? `${e.a}:${e.b}` : `${e.b}:${e.a}`
      byPair.set(k, [...(byPair.get(k) ?? []), e])
    }
    const next: Tree[] = []
    for (const group of byPair.values()) {
      if (group.length === 1) { next.push(group[0]); continue }
      const u = group[0].a
      const items = group.flatMap((g) => { const o = startingAt(g, u); return o.kind === 'par' ? o.items : [o] })
      next.push({ kind: 'par', items, a: u, b: group[0].b })
      changed = true
    }
    edges = next

    // Series: an inner net touched by exactly two edges.
    const incident = new Map<number, Tree[]>()
    for (const e of edges) for (const n of [e.a, e.b]) incident.set(n, [...(incident.get(n) ?? []), e])
    for (const [net, es] of incident) {
      if (net === T || net === B || es.length !== 2 || es[0] === es[1]) continue
      const e1 = es[0].b === net ? es[0] : flip(es[0]) // ends at net
      const e2 = startingAt(es[1], net) // starts at net
      const items = [...(e1.kind === 'series' ? e1.items : [e1]), ...(e2.kind === 'series' ? e2.items : [e2])]
      const merged: Tree = { kind: 'series', items, a: e1.a, b: e2.b }
      edges = [...edges.filter((e) => e !== es[0] && e !== es[1]), merged]
      changed = true
      break // incident map is stale: restart the pass
    }
    if (!changed) break
  }
  if (edges.length !== 1) return null
  const root = edges[0]
  if (!((root.a === T && root.b === B) || (root.a === B && root.b === T))) return null
  return startingAt(root, T)
}

/** A series run flattened to parts, in flow order. Null if it hides a parallel group. */
function flatParts(t: Tree): { id: string; startIdx: number }[] | null {
  if (t.kind === 'part') return [{ id: t.id, startIdx: t.aIdx }]
  if (t.kind === 'par') return null
  const out: { id: string; startIdx: number }[] = []
  for (const it of t.items) {
    const f = flatParts(it)
    if (!f) return null
    out.push(...f)
  }
  return out
}

// ── Geometry ────────────────────────────────────────────────────────────────

const rotOffset = (o: SceneObject, t: Pt, rot: number): Pt => {
  const dx = (t.x - 0.5) * o.size.w
  const dy = (t.y - 0.5) * o.size.h
  const r = (rot * Math.PI) / 180
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) }
}

/** The rotation that puts terminal `idx` on the `entry` side of the part. */
function rotationFor(o: SceneObject, idx: number, entry: 'l' | 'r' | 't' | 'b'): number {
  const t = terminalsOf(o)[idx]
  let best = 0
  let bestScore = -Infinity
  for (const rot of [0, 90, 180, 270]) {
    const p = rotOffset(o, t, rot)
    const score = entry === 'l' ? -p.x : entry === 'r' ? p.x : entry === 't' ? -p.y : p.y
    if (score > bestScore + 1e-6) { bestScore = score; best = rot }
  }
  return best
}

const up = (n: number) => Math.ceil(n / GRID) * GRID

/** Stack heights: k vertical parts joined by short wires, plus room for stubs. */
const stackH = (k: number) => k * PART_LEN + Math.max(0, k - 1) * PART_GAP + 64

/** Spread k vertical parts evenly about `mid`. */
const stackCentres = (k: number, mid: number): number[] => {
  const total = k * PART_LEN + (k - 1) * PART_GAP
  return Array.from({ length: k }, (_, i) => mid - total / 2 + PART_LEN / 2 + i * (PART_LEN + PART_GAP))
}

// ── The placer ──────────────────────────────────────────────────────────────

export function placeRails(
  ids: string[],
  edges: Edge[],
  getObj: (id: string) => SceneObject | undefined,
  origin: Pt,
): Placement | null {
  if (ids.length < 2 || edges.length === 0) return null
  const objs = new Map<string, SceneObject>()
  for (const id of ids) {
    const o = getObj(id)
    if (!o) return null
    objs.set(id, o)
  }
  // An edge to a part outside the set (explicitly positioned by the script):
  // mixing drawn and placed parts is the annealer's job.
  for (const e of edges) if (!objs.has(e.fromId) || !objs.has(e.toId)) return null

  const sym = (o: SceneObject) => o.geometry.symbol ?? ''
  const sources = ids.filter((id) => SOURCES.has(sym(objs.get(id)!)))
  const grounds = ids.filter((id) => sym(objs.get(id)!) === 'gnd')
  const twoPin = ids.filter((id) => !SOURCES.has(sym(objs.get(id)!)) && sym(objs.get(id)!) !== 'gnd')
  if (sources.length !== 1 || twoPin.length === 0) return null
  if (grounds.length > 1) return null
  for (const id of twoPin) {
    const ts = terminalsOf(objs.get(id)!)
    if (ts.length !== 2 || !ts.some((t) => t.x <= 0.05) || !ts.some((t) => t.x >= 0.95)) return null
  }
  const src = objs.get(sources[0])!
  if (terminalsOf(src).length !== 2) return null

  // Nets: union-find over (part, terminal) pins.
  const parent = new Map<string, string>()
  const find = (k: string): string => { let r = k; while ((parent.get(r) ?? r) !== r) r = parent.get(r)!; parent.set(k, r); return r }
  const key = (id: string, i: number) => `${id}:${i}`
  for (const id of ids) for (let i = 0; i < terminalsOf(objs.get(id)!).length; i++) parent.set(key(id, i), key(id, i))
  for (const e of edges) parent.set(find(key(e.fromId, e.fromIdx)), find(key(e.toId, e.toIdx)))
  const netIds = new Map<string, number>()
  const net = (id: string, i: number) => {
    const r = find(key(id, i))
    if (!netIds.has(r)) netIds.set(r, netIds.size)
    return netIds.get(r)!
  }

  // The source's + terminal is index 0 (positive/anode/a) throughout the registry.
  const T = net(sources[0], 0)
  const B = net(sources[0], 1)
  if (T === B) return null
  const trees: Tree[] = []
  for (const id of twoPin) {
    const a = net(id, 0)
    const b = net(id, 1)
    if (a === b) return null
    trees.push({ kind: 'part', id, a, b, aIdx: 0 })
  }
  const root = reduce(trees, T, B)
  if (!root) return null
  if (grounds.length === 1 && net(grounds[0], 0) !== B) return null

  let items = root.kind === 'series' ? root.items : [root]

  // A voltmeter across ONE part is an annotation, not a branch: drawing it as a
  // rung turns "measure R2" into a second column and doubles the width of the
  // sheet. Keep the measured part in its place on the rail and hang the meter
  // beside it instead — what a person drawing this by hand does.
  const meters: { id: string; host: string; startIdx: number }[] = []
  const isMeter = (t: Tree) => t.kind === 'part' && objs.get(t.id)?.geometry.symbol === 'voltmeter'
  items = items.map((it) => {
    if (it.kind !== 'par') return it
    const hosts = it.items.filter((b) => !isMeter(b))
    const ms = it.items.filter(isMeter)
    if (hosts.length !== 1 || hosts[0].kind !== 'part' || ms.length === 0) return it
    for (const m of ms) if (m.kind === 'part') meters.push({ id: m.id, host: hosts[0].id, startIdx: m.aIdx })
    return hosts[0]
  })
  const groups = items.filter((i) => i.kind === 'par')
  if (groups.length > 1) return null
  const groupIdx = items.findIndex((i) => i.kind === 'par')

  // Branches of the one parallel group: a part or a series of parts (no nesting).
  let branches: { id: string; startIdx: number }[][] = []
  if (groupIdx >= 0) {
    for (const br of (items[groupIdx] as Extract<Tree, { kind: 'par' }>).items) {
      const f = flatParts(br)
      if (!f) return null
      branches.push(f)
    }
    // Longest branch last so the common single-part rungs read first.
    branches = branches.sort((a, b) => a.length - b.length)
  }
  const seq = (list: Tree[]) => {
    const out: { id: string; startIdx: number }[] = []
    for (const t of list) { const f = flatParts(t); if (!f) return null; out.push(...f) }
    return out
  }
  const before = groupIdx >= 0 ? seq(items.slice(0, groupIdx)) : null
  const after = groupIdx >= 0 ? seq(items.slice(groupIdx + 1)) : null
  if (groupIdx >= 0 && (!before || !after)) return null
  const loop = groupIdx < 0 ? seq(items) : null
  if (groupIdx < 0 && !loop) return null

  const out: Placement = new Map()
  const put = (id: string, cx: number, cy: number, startIdx: number, entry: 'l' | 'r' | 't' | 'b') => {
    const o = objs.get(id)!
    out.set(id, { x: cx - o.size.w / 2, y: cy - o.size.h / 2, rotation: rotationFor(o, startIdx, entry) })
  }

  const xL = origin.x
  const yT = origin.y
  let yB: number
  const srcPlus = net(sources[0], 0) === T ? 0 : 1

  if (groupIdx < 0) {
    // Series loop: choose how many parts go down the right-hand side so the
    // drawing is a pleasant rectangle (about 1.7 : 1) rather than a strip.
    const n = loop!.length
    let best = { right: 0, top: n, bottom: 0, cost: Infinity }
    for (let right = 0; right <= Math.min(3, n); right++) {
      const rest = n - right
      const top = Math.max(1, Math.ceil(rest / 2))
      const bottom = Math.max(0, rest - top)
      if (n >= 2 && bottom === 0 && right === 0) continue
      const cols = Math.max(top, bottom, 1)
      const w = PITCH * (cols + 1)
      const h = up(Math.max(160, right > 0 ? stackH(right) : 160))
      const cost = Math.abs(Math.log(w / h / 1.7)) + (Math.abs(top - bottom) > 1 ? 0.3 : 0)
      if (cost < best.cost) best = { right, top, bottom, cost }
    }
    const { right, top, bottom } = best
    const cols = Math.max(top, bottom, 1)
    const H = up(Math.max(160, right > 0 ? stackH(right) : 160))
    yB = yT + H
    const ymid = yT + H / 2
    const xR = xL + PITCH * (cols + 1)
    put(sources[0], xL, ymid, srcPlus, 't')
    let k = 0
    for (let i = 0; i < top; i++, k++) put(loop![k].id, xL + PITCH * (i + 1), yT, loop![k].startIdx, 'l')
    if (right > 0) {
      const cs = stackCentres(right, ymid)
      for (let i = 0; i < right; i++, k++) put(loop![k].id, xR, cs[i], loop![k].startIdx, 't')
    }
    for (let j = 0; j < bottom; j++, k++) put(loop![k].id, xR - PITCH * (j + 1), yB, loop![k].startIdx, 'r')
  } else {
    const mMax = Math.max(...branches.map((b) => b.length))
    const H = up(Math.max(160, stackH(mMax)))
    yB = yT + H
    const ymid = yT + H / 2
    const cols = Math.max(before!.length, after!.length)
    const xRung0 = xL + PITCH * (cols + 1)
    put(sources[0], xL, ymid, srcPlus, 't')
    before!.forEach((p, i) => put(p.id, xRung0 - PITCH * (before!.length - i), yT, p.startIdx, 'l'))
    after!.forEach((p, j) => put(p.id, xRung0 - PITCH * (j + 1), yB, p.startIdx, 'r'))
    branches.forEach((br, j) => {
      const cs = stackCentres(br.length, ymid)
      br.forEach((p, i) => put(p.id, xRung0 + RUNG_PITCH * j, cs[i], p.startIdx, 't'))
    })
  }

  // Meters: on the OUTSIDE of the loop, beside the part they measure. Outside is
  // up for the top rail, down for the bottom, right for the right-hand edge.
  const stackedAbove = new Map<string, number>()
  for (const m of meters) {
    const host = out.get(m.host)
    const ho = objs.get(m.host)
    if (!host || !ho) return null
    const cx = host.x + ho.size.w / 2
    const cy = host.y + ho.size.h / 2
    const nth = stackedAbove.get(m.host) ?? 0
    stackedAbove.set(m.host, nth + 1)
    const off = 110 + nth * 80
    const vertical = host.rotation === 90 || host.rotation === 270
    const onTop = !vertical && Math.abs(cy - yT) < 1
    // Pin A of the meter sits on the host's `a` net. Which side that net is on
    // depends on how the host was rotated; the router handles the exact wiring,
    // so only the meter's own orientation needs to agree with the host's.
    if (vertical) {
      const xr = Math.max(...[...out.values()].map((p) => p.x)) // the loop's right edge, roughly
      const onRight = cx >= xr - 200
      put(m.id, cx + (onRight ? off : -off), cy, m.startIdx, 't')
    } else {
      // Same flow direction as the host: left→right on the top rail, right→left on the bottom.
      put(m.id, cx, cy + (onTop ? -off : off), m.startIdx, onTop ? 'l' : 'r')
    }
  }

  if (grounds.length === 1) {
    const g = objs.get(grounds[0])!
    out.set(grounds[0], { x: xL - g.size.w / 2, y: yB + 100 - g.size.h / 2, rotation: 0 })
  }
  return out.size === ids.length ? out : null
}
