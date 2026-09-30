// Drawing helpers for engines. Every one returns plain Prim[] so an engine
// composes a frame with `[...title(..), ...cells(..), ...arrow(..)]` and never
// thinks about SVG. Coordinates are the engine's own; the renderer scales.

import type { Frame, Prim, Tone, Trace } from './types'

export const box = (x: number, y: number, w: number, h: number, text?: string, tone: Tone = 'idle', sub?: string): Prim =>
  ({ k: 'rect', x, y, w, h, tone, ...(text !== undefined ? { text } : {}), ...(sub !== undefined ? { sub } : {}) })

export const txt = (x: number, y: number, text: string, o: Partial<Extract<Prim, { k: 'text' }>> = {}): Prim =>
  ({ k: 'text', x, y, text, ...o })

export const line = (x1: number, y1: number, x2: number, y2: number, tone: Tone = 'dim', o: Partial<Extract<Prim, { k: 'line' }>> = {}): Prim =>
  ({ k: 'line', x1, y1, x2, y2, tone, ...o })

export const arrow = (x1: number, y1: number, x2: number, y2: number, tone: Tone = 'dim', o: Partial<Extract<Prim, { k: 'line' }>> = {}): Prim =>
  ({ k: 'line', x1, y1, x2, y2, tone, arrow: true, ...o })

export const dot = (x: number, y: number, r: number, text?: string, tone: Tone = 'idle', o: Partial<Extract<Prim, { k: 'circle' }>> = {}): Prim =>
  ({ k: 'circle', x, y, r, tone, ...(text !== undefined ? { text } : {}), ...o })

export const poly = (pts: number[][], tone: Tone = 'blue', o: Partial<Extract<Prim, { k: 'poly' }>> = {}): Prim =>
  ({ k: 'poly', pts, tone, ...o })

/** A row of equal cells; `tones[i]` colours cell i. Returns the prims and the
 *  x of each cell's centre so callers can hang arrows and labels off them. */
export function cells(
  x: number, y: number, values: (string | number)[], cw: number, ch: number,
  tones: (Tone | undefined)[] = [], opts: { subs?: (string | undefined)[]; r?: number } = {}
): Prim[] {
  return values.map((v, i) => ({
    k: 'rect' as const, x: x + i * cw, y, w: cw, h: ch, text: String(v),
    tone: tones[i] ?? 'idle', r: opts.r ?? 4,
    ...(opts.subs?.[i] ? { sub: opts.subs[i] } : {}),
  }))
}

/** A small caption above a region. */
export const heading = (x: number, y: number, text: string): Prim =>
  txt(x, y, text.toUpperCase(), { size: 10, tone: 'dim', bold: true })

/** Bit string as cells: bits('1011', x, y, 22) */
export function bits(s: string, x: number, y: number, cw: number, tones: (Tone | undefined)[] = [], ch = cw + 6): Prim[] {
  return cells(x, y, s.split(''), cw, ch, tones, { r: 3 })
}

/** Curved self-loop above a node centre (for automata). */
export function selfLoop(cx: number, cy: number, r: number, tone: Tone = 'dim'): Prim {
  const a = cx - r * 0.55, b = cx + r * 0.55, top = cy - r * 2.1
  return poly([[a, cy - r * 0.83], [cx - r * 0.9, top], [cx + r * 0.9, top], [b, cy - r * 0.83]], tone, { arrow: true })
}

/** Turn "states" into frames: render(state) gives the drawing, note(state)
 *  the caption. Keeps engines to `compute states, then say how to draw one`. */
export function framesFrom<S>(states: S[], render: (s: S, i: number) => Prim[], note: (s: S, i: number) => string): Frame[] {
  return states.map((s, i) => ({ draw: render(s, i), note: note(s, i) }))
}

/** Every engine's final safety net: a Trace must always have a frame. */
export function trace(w: number, h: number, frames: Frame[], summary: Record<string, string> = {}): Trace {
  return { w, h, frames: frames.length ? frames : [{ draw: [], note: '' }], summary }
}

export const TONE_ORDER: Tone[] = ['blue', 'mint', 'amber', 'violet', 'rose']
/** A stable colour per index — for processes, pages, packets. */
export const toneAt = (i: number): Tone => TONE_ORDER[((i % TONE_ORDER.length) + TONE_ORDER.length) % TONE_ORDER.length]

// ── Binary-tree layout ──────────────────────────────────────────────────────
// In-order index gives x (no two nodes share a column, so nothing overlaps),
// depth gives y. Simple, readable, and stable while a tree is edited.

export interface BNode { id?: string; label: string; left?: BNode | null; right?: BNode | null; tone?: Tone; sub?: string; edgeL?: string; edgeR?: string }

export interface PlacedB { node: BNode; x: number; y: number; parent?: PlacedB; side?: 'l' | 'r' }

export function layoutBinary(root: BNode | null | undefined, dx: number, dy: number, x0 = 0, y0 = 0): { placed: PlacedB[]; width: number; height: number } {
  const placed: PlacedB[] = []
  let col = 0
  let maxDepth = 0
  const walk = (n: BNode | null | undefined, depth: number, parent?: PlacedB, side?: 'l' | 'r'): void => {
    if (!n) return
    // Place the left subtree first so the in-order column counter advances left→right.
    const stub: PlacedB = { node: n, x: 0, y: y0 + depth * dy, parent, side }
    walk(n.left, depth + 1, stub, 'l')
    stub.x = x0 + col * dx
    col++
    placed.push(stub)
    maxDepth = Math.max(maxDepth, depth)
    walk(n.right, depth + 1, stub, 'r')
  }
  walk(root, 0)
  return { placed, width: Math.max(1, col) * dx, height: (maxDepth + 1) * dy }
}

/** Draw a binary tree: edges first (so nodes sit on top), then nodes. */
export function drawBinary(root: BNode | null | undefined, dx: number, dy: number, x0: number, y0: number, r = 16): { prims: Prim[]; width: number; height: number } {
  const { placed, width, height } = layoutBinary(root, dx, dy, x0, y0)
  const prims: Prim[] = []
  for (const p of placed) if (p.parent) prims.push(line(p.parent.x, p.parent.y, p.x, p.y, 'dim', { w: 1.4 }))
  for (const p of placed) {
    if (p.parent) {
      const label = p.side === 'l' ? p.parent.node.edgeL : p.parent.node.edgeR
      if (label) prims.push(txt((p.x + p.parent.x) / 2 + (p.side === 'l' ? -7 : 7), (p.y + p.parent.y) / 2, label, { size: 10, mono: true, anchor: 'middle', tone: 'amber' }))
    }
  }
  for (const p of placed) {
    prims.push(dot(p.x, p.y, r, p.node.label, p.node.tone ?? 'idle'))
    if (p.node.sub) prims.push(txt(p.x, p.y + r + 11, p.node.sub, { size: 9.5, mono: true, anchor: 'middle', tone: 'dim' }))
  }
  return { prims, width, height }
}

// ── General (n-ary) tree layout: leaves take consecutive columns, a parent is
// centred over its children. Used for parse trees.

export interface NNode { label: string; kids: NNode[]; tone?: Tone }

export function drawTree(root: NNode, dx: number, dy: number, x0: number, y0: number, r = 15): { prims: Prim[]; width: number; height: number } {
  let col = 0
  let depthMax = 0
  const pos = new Map<NNode, { x: number; y: number }>()
  const walk = (n: NNode, depth: number): number => {
    depthMax = Math.max(depthMax, depth)
    let x: number
    if (n.kids.length === 0) { x = x0 + col * dx; col++ }
    else { const xs = n.kids.map((k) => walk(k, depth + 1)); x = (xs[0] + xs[xs.length - 1]) / 2 }
    pos.set(n, { x, y: y0 + depth * dy })
    return x
  }
  walk(root, 0)
  const prims: Prim[] = []
  const edges = (n: NNode) => n.kids.forEach((k) => { const a = pos.get(n)!, b = pos.get(k)!; prims.push(line(a.x, a.y, b.x, b.y, 'dim', { w: 1.3 })); edges(k) })
  edges(root)
  for (const [n, p] of pos) prims.push(dot(p.x, p.y, r, n.label, n.tone ?? 'idle'))
  return { prims, width: Math.max(1, col) * dx, height: (depthMax + 1) * dy }
}

// ── Plot helper ─────────────────────────────────────────────────────────────

export interface Plot {
  X: (x: number) => number
  Y: (y: number) => number
  axes: Prim[]
  curve: (f: (x: number) => number, tone?: Tone, w?: number, n?: number) => Prim
  x0: number; y0: number; w: number; h: number
}

/** A framed plot area with tick labels. `X`/`Y` map data → drawing coordinates. */
export function makePlot(x0: number, y0: number, w: number, h: number, xmin: number, xmax: number, ymin: number, ymax: number, opts: { xticks?: number; yticks?: number; grid?: boolean } = {}): Plot {
  const X = (x: number) => x0 + ((x - xmin) / (xmax - xmin || 1)) * w
  const Y = (y: number) => y0 + h - ((y - ymin) / (ymax - ymin || 1)) * h
  const axes: Prim[] = []
  const nice = (lo: number, hi: number, n: number) => { const step = (hi - lo) / n; const mag = Math.pow(10, Math.floor(Math.log10(step || 1))); const f = step / mag; const s = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag; return { s, first: Math.ceil(lo / s) * s } }
  const xt = nice(xmin, xmax, opts.xticks ?? 6), yt = nice(ymin, ymax, opts.yticks ?? 5)
  for (let v = xt.first; v <= xmax + 1e-9; v += xt.s) { if (opts.grid !== false) axes.push(line(X(v), y0, X(v), y0 + h, 'dim', { w: 0.35, dash: true })); axes.push(txt(X(v), y0 + h + 13, fmtTick(v), { size: 9.5, anchor: 'middle', mono: true, tone: 'dim' })) }
  for (let v = yt.first; v <= ymax + 1e-9; v += yt.s) { if (opts.grid !== false) axes.push(line(x0, Y(v), x0 + w, Y(v), 'dim', { w: 0.35, dash: true })); axes.push(txt(x0 - 6, Y(v) + 3.5, fmtTick(v), { size: 9.5, anchor: 'end', mono: true, tone: 'dim' })) }
  if (xmin < 0 && xmax > 0) axes.push(line(X(0), y0, X(0), y0 + h, 'dim', { w: 1 }))
  if (ymin < 0 && ymax > 0) axes.push(line(x0, Y(0), x0 + w, Y(0), 'dim', { w: 1 }))
  axes.push({ k: 'rect', x: x0, y: y0, w, h, tone: 'dim', r: 0 } as Prim)
  const curve = (f: (x: number) => number, tone: Tone = 'blue', wd = 2, n = 160): Prim => {
    const pts: number[][] = []
    for (let i = 0; i <= n; i++) { const x = xmin + ((xmax - xmin) * i) / n; const y = f(x); if (Number.isFinite(y)) pts.push([X(x), Math.max(y0 - 4, Math.min(y0 + h + 4, Y(y)))]) }
    return poly(pts, tone, { w: wd })
  }
  return { X, Y, axes, curve, x0, y0, w, h }
}
const fmtTick = (v: number) => { const a = Math.abs(v); return a >= 1e4 || (a > 0 && a < 1e-3) ? v.toExponential(0) : String(Math.round(v * 1e6) / 1e6) }
