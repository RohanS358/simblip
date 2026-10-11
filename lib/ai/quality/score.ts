// How good is a generated scene? — as numbers, so a model can be trained on it.
//
// "Beautiful, correct, interactive" is not one thing, so it is scored as five
// separate families that the trainer, the eval and a human can each read:
//
//   valid      lints, runs, and the verifier finds nothing wrong        (gate)
//   function   the simulation is stable and its outputs mean something
//   looks      geometry: overlaps, wires through parts, crossings, bends,
//              alignment, spacing, fit — everything a person sees at a glance
//   teaches    a plot of the quantity that matters, labelled parts, an
//              explanation, a control to play with
//
// This file is PURE geometry over SceneObject[]: no stores, no React, so it runs
// in Node over thousands of scenes. Whatever needs the engines (run the
// simulation, read the plots) is gathered by scripts/ai/quality/run.mjs and
// passed in as `Runtime`.

import type { SceneObject } from '@/lib/scene/types'

export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Seg { a: [number, number]; b: [number, number]; wire: number }

/** What the engines said when the scene was actually run. */
export interface Runtime {
  /** Did execution throw? */
  threw?: string
  /** Lint errors (gate). */
  lintErrors: string[]
  /** verifyScene error messages. */
  verifyErrors: string[]
  /** Any sampled value was NaN/Infinity, or exploded past a sane bound. */
  unstable: boolean
  /** Per plotted graph: did its source produce >1 distinct finite value? */
  graphs: { channel: string; live: boolean }[]
  /** Frames run (0 = the scene has nothing to simulate). */
  frames: number
  /** Circuit only: every part carried ~0 current (a dead / open circuit). */
  deadCircuit?: boolean
}

export interface Score {
  total: number // 0..100
  valid: number // 0|1 gate
  function: number // 0..1
  looks: number // 0..1
  teaches: number // 0..1
  parts: Record<string, number>
  issues: string[]
}

// ── Geometry ────────────────────────────────────────────────────────────────

const isWire = (o: SceneObject) => o.behaviors.some((b) => b.type === 'wire') || o.name === 'wire'
const PANELS = new Set(['graph', 'note', 'text', 'chart', 'table', 'gridtable', 'slider', 'button', 'trigger', 'formula', 'truthtable', 'code', 'surface3d', 'cashflow', 'steplab', 'dsa', 'picture'])
const isPanel = (o: SceneObject) => PANELS.has(o.geometry.kind)
/** Things that BEAUTY applies to as bodies: symbols and shapes, not wires/panels/containers. */
const isBody = (o: SceneObject) => !isWire(o) && !isPanel(o) && o.geometry.kind !== 'group' && o.geometry.kind !== 'stroke'
const isContainer = (o: SceneObject) => o.name === 'system' || o.geometry.kind === 'rect' && o.metadata?.system === true

/** Axis-aligned box of an object after rotation about its centre. */
export function boxOf(o: SceneObject): Rect {
  const { x, y } = o.position
  const { w, h } = o.size
  const rot = ((o.rotation % 180) + 180) % 180
  const swap = Math.abs(rot - 90) < 1
  const cx = x + w / 2
  const cy = y + h / 2
  const W = swap ? h : w
  const H = swap ? w : h
  return { x0: cx - W / 2, y0: cy - H / 2, x1: cx + W / 2, y1: cy + H / 2 }
}

const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0)
const inter = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
const gap = (a: Rect, b: Rect) => {
  const dx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1))
  const dy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1))
  return Math.hypot(dx, dy)
}

export function wireSegments(objs: SceneObject[]): Seg[] {
  const out: Seg[] = []
  let w = 0
  for (const o of objs) {
    if (!isWire(o) || !o.geometry.points || o.geometry.points.length < 2) continue
    const pts = o.geometry.points.map(([px, py]) => [o.position.x + px, o.position.y + py] as [number, number])
    for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i], wire: w })
    w++
  }
  return out
}

const segLen = (s: Seg) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1])

/** Proper crossing of two axis-aligned-ish segments (touching at an end does not count). */
function crosses(p: Seg, q: Seg): boolean {
  const o = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const d1 = o(p.a, p.b, q.a)
  const d2 = o(p.a, p.b, q.b)
  const d3 = o(q.a, q.b, p.a)
  const d4 = o(q.a, q.b, p.b)
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6
}

/** Does a segment pass through the INTERIOR of a box (inset so pins on the edge don't count)? */
function segThroughBox(s: Seg, r: Rect, inset: number): boolean {
  const b = { x0: r.x0 + inset, y0: r.y0 + inset, x1: r.x1 - inset, y1: r.y1 - inset }
  if (b.x1 <= b.x0 || b.y1 <= b.y0) return false
  // Liang–Barsky clip
  let t0 = 0
  let t1 = 1
  const dx = s.b[0] - s.a[0]
  const dy = s.b[1] - s.a[1]
  const test = (p: number, q: number) => {
    if (p === 0) return q >= 0
    const r2 = q / p
    if (p < 0) { if (r2 > t1) return false; if (r2 > t0) t0 = r2 } else { if (r2 < t0) return false; if (r2 < t1) t1 = r2 }
    return true
  }
  return test(-dx, s.a[0] - b.x0) && test(dx, b.x1 - s.a[0]) && test(-dy, s.a[1] - b.y0) && test(dy, b.y1 - s.a[1]) && t1 - t0 > 1e-6
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// ── Looks ───────────────────────────────────────────────────────────────────

export interface Frame { left: number; top: number; right: number; bottom: number }

export function scoreLooks(objs: SceneObject[], frame?: Frame): { score: number; parts: Record<string, number>; issues: string[] } {
  const issues: string[] = []
  const bodies = objs.filter(isBody).filter((o) => !isContainer(o))
  const panels = objs.filter(isPanel)
  const solids = [...bodies, ...panels]
  const boxes = solids.map(boxOf)
  const segs = wireSegments(objs)

  // 1. Overlap among things you can see (parts, graphs, notes, controls).
  let overlapping = 0
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const small = Math.min(area(boxes[i]), area(boxes[j]))
      if (small > 0 && inter(boxes[i], boxes[j]) / small > 0.06) {
        overlapping++
        if (issues.length < 8) issues.push(`${solids[i].name || solids[i].geometry.kind} overlaps ${solids[j].name || solids[j].geometry.kind}`)
      }
    }
  }
  const overlap = clamp01(1 - overlapping / Math.max(1, solids.length / 2))

  // 2. Wires that run through the middle of a part — reads as a short or a mess.
  let through = 0
  for (const s of segs) {
    for (let i = 0; i < bodies.length; i++) {
      if (segThroughBox(s, boxOf(bodies[i]), 6)) {
        through++
        if (issues.length < 8) issues.push(`a wire runs through ${bodies[i].name || bodies[i].geometry.symbol || 'a part'}`)
        break
      }
    }
  }
  const wireThrough = clamp01(1 - through / Math.max(1, segs.length / 3))

  // 3. Crossings between different wires.
  let crossings = 0
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segs[i].wire !== segs[j].wire && crosses(segs[i], segs[j])) crossings++
  if (crossings > 0) issues.push(`${crossings} wire crossing${crossings === 1 ? '' : 's'}`)
  const wireCrossing = clamp01(1 - crossings / Math.max(1, bodies.length / 2))

  // 4. Bends per wire (a clean schematic uses 0–2) and detours.
  const wires = new Map<number, Seg[]>()
  for (const s of segs) wires.set(s.wire, [...(wires.get(s.wire) ?? []), s])
  let bendSum = 0
  let lenSum = 0
  let directSum = 0
  for (const ss of wires.values()) {
    bendSum += Math.max(0, ss.length - 1)
    lenSum += ss.reduce((a, s) => a + segLen(s), 0)
    directSum += Math.abs(ss[ss.length - 1].b[0] - ss[0].a[0]) + Math.abs(ss[ss.length - 1].b[1] - ss[0].a[1])
  }
  // Jogs: a wire that steps sideways by a few pixels and carries on. Each is a
  // small kink the eye catches at once (the staircase look of a badly laid-out
  // chain) though no single one is "wrong".
  let jogs = 0
  for (const ss of wires.values()) for (let i = 1; i < ss.length - 1; i++) if (segLen(ss[i]) > 0 && segLen(ss[i]) < 36) { jogs++; break }
  const jog = wires.size ? clamp01(1 - jogs / Math.max(1, wires.size / 2)) : 1
  if (jogs > 0) issues.push(`${jogs} wire${jogs === 1 ? '' : 's'} kink sideways`)
  // Ink: total wire per part. A tidy sheet reuses rails; a messy one runs long.
  const inkRatio = bodies.length > 0 ? lenSum / (bodies.length * 150) : 0
  const ink = clamp01(1 - (inkRatio - 1.2) / 1.5)
  const avgBends = wires.size ? bendSum / wires.size : 0
  const bends = clamp01(1 - Math.max(0, avgBends - 2) / 3)
  const detour = wires.size && directSum > 0 ? clamp01(1 - (lenSum / directSum - 1.3) / 1.5) : 1
  if (avgBends > 3) issues.push(`wires bend ${avgBends.toFixed(1)} times on average`)

  // 5. Alignment: parts that share a row or column read as designed.
  const cs = bodies.map((o) => { const b = boxOf(o); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] })
  let aligned = 0
  for (let i = 0; i < cs.length; i++) if (cs.some((c, j) => j !== i && (Math.abs(c[0] - cs[i][0]) <= 3 || Math.abs(c[1] - cs[i][1]) <= 3))) aligned++
  const alignment = cs.length > 2 ? aligned / cs.length : 1
  if (cs.length > 2 && alignment < 0.7) issues.push('parts are not lined up on shared rows/columns')

  // 5b. Lanes: how many distinct rows and columns the parts occupy. A designed
  // sheet reuses a few rails; a staircase gives every part its own row AND column.
  const lane = (vals: number[]) => { const u: number[] = []; for (const v of vals.sort((a, b) => a - b)) if (!u.length || v - u[u.length - 1] > 12) u.push(v); return u.length }
  const lanes = cs.length > 3 ? (lane(cs.map((c) => c[0])) + lane(cs.map((c) => c[1]))) / cs.length : 0
  const grid = cs.length > 3 ? clamp01((2 - lanes) / 1.2) : 1
  if (cs.length > 3 && grid < 0.6) issues.push('parts sit on a diagonal / each on its own row and column')

  // 6. Spacing: parts jammed together read as clutter.
  let tight = 0
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) { const g = gap(boxOf(bodies[i]), boxOf(bodies[j])); if (g > 0 && g < 14) tight++ }
  const spacing = clamp01(1 - tight / Math.max(1, bodies.length / 2))

  // 7. Composition: aspect ratio and how much of the box is used.
  const all = [...boxes, ...segs.flatMap((s) => [{ x0: Math.min(s.a[0], s.b[0]), y0: Math.min(s.a[1], s.b[1]), x1: Math.max(s.a[0], s.b[0]), y1: Math.max(s.a[1], s.b[1]) }])]
  let composition = 1
  if (all.length) {
    const bx = { x0: Math.min(...all.map((r) => r.x0)), y0: Math.min(...all.map((r) => r.y0)), x1: Math.max(...all.map((r) => r.x1)), y1: Math.max(...all.map((r) => r.y1)) }
    const w = bx.x1 - bx.x0
    const h = bx.y1 - bx.y0
    const aspect = w / Math.max(1, h)
    const aspectOk = aspect >= 0.45 && aspect <= 2.6 ? 1 : clamp01(1 - Math.abs(Math.log(aspect / (aspect > 1 ? 2.6 : 0.45))) / 1.2)
    composition = aspectOk
    if (aspectOk < 0.8) issues.push(`the scene is very ${aspect > 1 ? 'wide' : 'tall'} (${aspect.toFixed(1)}:1)`)
  }

  // 8. Everything is on the page.
  let fit = 1
  if (frame && solids.length) {
    const inside = boxes.filter((b) => b.x0 >= frame.left - 2 && b.y0 >= frame.top - 2 && b.x1 <= frame.right + 2 && b.y1 <= frame.bottom + 2).length
    fit = inside / boxes.length
    if (fit < 1) issues.push(`${boxes.length - inside} object(s) fall outside the page`)
  }

  const parts = { overlap, wireThrough, wireCrossing, bends, detour, jog, ink, grid, alignment, spacing, composition, fit }
  // Weighted: things that read as "broken" weigh most; polish weighs less.
  const w = { overlap: 3, wireThrough: 3, wireCrossing: 2, bends: 1.5, detour: 1, jog: 2, ink: 1.5, grid: 2, alignment: 2, spacing: 1.5, composition: 1, fit: 2 }
  let s = 0
  let t = 0
  for (const k of Object.keys(parts) as (keyof typeof parts)[]) { s += parts[k] * w[k]; t += w[k] }
  return { score: s / t, parts, issues }
}

// ── Teaches ─────────────────────────────────────────────────────────────────

export function scoreTeaches(objs: SceneObject[], rt: Runtime): { score: number; parts: Record<string, number>; issues: string[] } {
  const issues: string[] = []
  const parts = objs.filter(isBody).filter((o) => !isContainer(o))
  const physical = parts.length > 0
  const graphs = objs.filter((o) => o.geometry.kind === 'graph')
  const notes = objs.filter((o) => o.geometry.kind === 'note' || o.geometry.kind === 'text')
  const controls = objs.filter((o) => ['slider', 'button', 'trigger'].includes(o.geometry.kind))

  // A plot of something that actually moves.
  const plotted = physical ? (graphs.length === 0 ? 0 : rt.graphs.some((g) => g.live) ? 1 : 0.4) : 1
  if (physical && graphs.length === 0) issues.push('nothing is plotted')
  if (graphs.length && !rt.graphs.some((g) => g.live)) issues.push('the plot shows no change')

  // Named parts (R1, Vin, Bob) instead of anonymous ones.
  const nameable = parts.filter((o) => o.geometry.kind === 'symbol' || o.behaviors.some((b) => b.type === 'rigidBody'))
  const named = nameable.length ? nameable.filter((o) => o.name && !/^(resistor|battery|mass|block|capacitor|inductor|diode|symbol|circle|rect)\b/i.test(o.name.trim()) || /\d/.test(o.name)).length / nameable.length : 1
  if (nameable.length > 1 && named < 0.6) issues.push('parts are not named (R1, R2, Vin…)')

  // Words: one note that explains what to look at (and not a wall of text).
  const text = notes.map((n) => String((n.parameters.text as { value?: string } | undefined)?.value ?? '')).join(' ')
  const explains = notes.length === 0 ? 0 : clamp01(text.trim().length / 40) * (text.length > 700 ? 0.6 : 1)
  if (notes.length === 0) issues.push('no note says what to look at')

  // Something to play with.
  const interactive = controls.length === 0 ? 0 : 1
  if (controls.length === 0) issues.push('nothing to play with (no slider)')

  const p = { plotted, named, explains, interactive }
  const w = { plotted: 3, named: 1.5, explains: 2, interactive: 2 }
  let s = 0
  let t = 0
  for (const k of Object.keys(p) as (keyof typeof p)[]) { s += p[k] * w[k]; t += w[k] }
  return { score: s / t, parts: p, issues }
}

// ── Function ────────────────────────────────────────────────────────────────

export function scoreFunction(objs: SceneObject[], rt: Runtime): { score: number; parts: Record<string, number>; issues: string[] } {
  const issues: string[] = []
  const physical = objs.some((o) => isBody(o) && !isContainer(o))
  if (!physical) return { score: 1, parts: { stable: 1, alive: 1 }, issues }
  const stable = rt.unstable ? 0 : 1
  if (rt.unstable) issues.push('the simulation blows up (NaN / runaway values)')
  const alive = rt.deadCircuit ? 0.2 : rt.frames === 0 ? 0.5 : 1
  if (rt.deadCircuit) issues.push('no current flows — the circuit is open or unpowered')
  const s = stable * 0.65 + alive * 0.35
  return { score: s, parts: { stable, alive }, issues }
}

// ── Total ───────────────────────────────────────────────────────────────────

export function scoreScene(objs: SceneObject[], rt: Runtime, frame?: Frame): Score {
  const issues: string[] = []
  const valid = !rt.threw && rt.lintErrors.length === 0 && rt.verifyErrors.length === 0 ? 1 : 0
  if (rt.threw) issues.push(`threw: ${rt.threw}`)
  for (const e of rt.lintErrors.slice(0, 3)) issues.push(`lint: ${e}`)
  for (const e of rt.verifyErrors.slice(0, 3)) issues.push(`verify: ${e}`)
  if (!valid) return { total: 0, valid: 0, function: 0, looks: 0, teaches: 0, parts: {}, issues }

  const f = scoreFunction(objs, rt)
  const l = scoreLooks(objs, frame)
  const t = scoreTeaches(objs, rt)
  issues.push(...f.issues, ...l.issues, ...t.issues)
  // Correct first (a pretty scene that does nothing is worthless), then looks,
  // then teaching value. Function gates the rest: a broken sim caps the total.
  const raw = 100 * (0.3 * f.score + 0.4 * l.score + 0.3 * t.score)
  const total = f.score < 0.5 ? Math.min(raw, 40) : raw
  return {
    total: Math.round(total * 10) / 10,
    valid,
    function: f.score,
    looks: l.score,
    teaches: t.score,
    parts: { ...Object.fromEntries(Object.entries(f.parts).map(([k, v]) => [`f.${k}`, v])), ...Object.fromEntries(Object.entries(l.parts).map(([k, v]) => [`l.${k}`, v])), ...Object.fromEntries(Object.entries(t.parts).map(([k, v]) => [`t.${k}`, v])) },
    issues,
  }
}
