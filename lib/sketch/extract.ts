// Ink → Scene IR: read a whole sketched circuit.
//
//   strokes ──▶ wires / dots / body strokes ──▶ group bodies into symbols
//           ──▶ SketchNet names each group ──▶ wire ends land on pins
//           ──▶ nets (wires + pins + dots) ──▶ edges ──▶ Scene IR
//
// The recogniser proposes, the compiler decides, the user corrects: nothing here
// is trusted. Anything uncertain — a weak part, a wire end that lands between
// two pins, a loose end — is recorded in `doubts`, which the ghost preview shows.
//
// Scale is taken from the drawing itself (the typical size of a symbol body), so
// the same code reads a small sketch and a big one.

import { axisStats, boxGap, boxOf, diagOf, Dsu, dist, median, pathLength, polyCrossings, polyDist, rdp, unionBox, type Box, type Pt } from './geom'
import type { SketchIRType } from './ir'
import { pinsOf, type WorldPin } from './pins'
import { bestSymbol } from './neural-pick'
import { canonicalPose, type Pose } from './classes'
import { attachValues, findText, type TextRead } from './values'
import type { SketchPrediction } from './sketchnet'

export interface InkStroke {
  id: string
  /** [x, y, …] page px. */
  pts: number[][]
}

export interface Recogniser {
  predict(strokes: number[][][]): SketchPrediction
}

export interface ExtractOptions {
  /** Typical full-symbol size, px. Estimated from the ink when omitted. */
  unit?: number
  /** Lowest best-symbol probability for a group to count as a part. */
  minPartP?: number
  /** How far (× unit) a wire end may be from a pin, and from another wire, and still count as touching. */
  tolPinK?: number
  tolJoinK?: number
  /** The character network. When given, values written beside parts ("10k") are read. */
  charNet?: Recogniser
}

export interface ExtractedPart {
  /** The IR node id. */
  id: string
  cls: string
  conf: number
  pose: Pose
  box: Box
  strokeIds: string[]
  alts: Array<{ cls: string; conf: number }>
  pins: WorldPin[]
  /** Op-amps: the two input names were swapped because the + was drawn on the first input. */
  flip?: boolean
  /** Op-amps: the +/− marks were read (otherwise the default is a guess). */
  polarityKnown?: boolean
  /** Raw text per parameter, e.g. { R: '10k' } — typed by the user or read from ink. */
  values?: Record<string, string>
  /** Text was written beside this part but could not be read as a value. */
  valueUnreadable?: boolean
}

export interface ExtractResult {
  ir: SketchIRType
  parts: ExtractedPart[]
  wireIds: string[]
  dotIds: string[]
  /** Ink that was neither part, wire nor dot (stray marks, unreadable groups). */
  ignoredIds: string[]
  unit: number
  /** The wire and dot strokes as read, so wireUp() can be run again after an edit. */
  wires?: Shape[]
  dots?: Shape[]
  /** Wire ends that landed on nothing (page px). */
  looseEnds?: Pt[]
  /** Ink read as part values; replaced along with the circuit. */
  textIds?: string[]
  /** Every line of text found, readable or not. */
  texts?: TextRead[]
}

export interface Shape {
  id: string
  pts: Pt[]
  box: Box
  len: number
  diag: number
  chord: number
  simp: Pt[]
  straight: boolean
  ortho: boolean
  /** Share of the path that runs along an axis (0–1), and how often it turns sharply. */
  axisFraction: number
  turns: number
  closed: boolean
}

export function shapeOf(s: InkStroke): Shape {
  const pts: Pt[] = s.pts.map((p) => [p[0], p[1]])
  const box = boxOf(pts)
  const len = pathLength(pts)
  const chord = dist(pts[0], pts[pts.length - 1])
  const simp = rdp(pts, Math.max(3, 0.04 * len))
  const closed = len > 20 && chord < 0.12 * len
  const straight = len > 0 && chord / len >= 0.88
  // runs along the axes, give or take a hand's wobble and slant, and turns only a few times
  // The sampling step shrinks for shorter strokes, so a small coil or zigzag is not
  // smoothed into a straight line just because it was drawn small.
  const { axisFraction, turns } = axisStats(pts, Math.min(6, Math.max(2.5, len / 45)))
  const ortho = !closed && len >= 20 && axisFraction >= 0.78 && turns <= 5
  return { id: s.id, pts, box, len, diag: diagOf(box), chord, simp, straight, ortho, axisFraction, turns, closed }
}

/**
 * A stroke that only joins things: long, and straight or running along the axes.
 * A long wire drawn on a touchpad wanders too much to run along an axis for 78 %
 * of its length, but it still goes mostly one way — which a zigzag or a coil,
 * however long, never does — so a long, mostly-straight, mostly-axis stroke counts too.
 */
function looksLikeWire(s: Shape, minLen: number, unit: number): boolean {
  if (s.closed || s.len < minLen) return false
  if (s.straight || s.ortho) return true
  return s.len >= 1.3 * unit && s.chord / s.len >= 0.7 && s.axisFraction >= 0.5
}

/**
 * A first guess at the full-symbol size, from the bodies (zigzags, circles,
 * triangles…), which no wire looks like. Only a starting point: a symbol drawn
 * in one stroke with its leads is wider than a bare body, so the real scale is
 * then searched around this (see extractCircuit).
 */
function estimateUnit(shapes: Shape[]): number {
  const bodies = shapes.filter((s) => !s.straight && !s.ortho && s.len > 25).map((s) => s.diag)
  if (bodies.length >= 1) return Math.min(500, Math.max(40, median(bodies) * 1.25))
  // only straight strokes (plates, leads, wires): the shorter ones are the plates
  const lens = shapes.map((s) => s.len).sort((a, b) => a - b)
  const short = lens.slice(0, Math.max(1, Math.ceil(lens.length * 0.4)))
  return Math.min(500, Math.max(40, median(short) * 2))
}

/** Groups of strokes whose boxes are within `pad` of each other (transitively). */
function cluster(shapes: Shape[], pad: number): Shape[][] {
  const d = new Dsu(shapes.length)
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (boxGap(shapes[i].box, shapes[j].box) <= pad) d.union(i, j)
    }
  }
  const by = new Map<number, Shape[]>()
  shapes.forEach((s, i) => {
    const r = d.find(i)
    by.set(r, [...(by.get(r) ?? []), s])
  })
  return [...by.values()]
}

/**
 * A short straight stroke that ended up on its own is almost always a lead whose
 * gap to its symbol was a little too wide to cluster (a hand leaves one). Fold it
 * into the nearest real group so the symbol is read with its lead.
 */
function absorbSatellites(groups: Shape[][], U: number): Shape[][] {
  const satellite = (g: Shape[]) => g.every((s) => s.straight || s.ortho) && g.reduce((a, s) => a + s.len, 0) < 0.45 * U
  const bodies = groups.filter((g) => !satellite(g))
  if (bodies.length === 0) return groups
  const boxes = bodies.map((g) => g.map((s) => s.box).reduce(unionBox))
  const merged = bodies.map((g) => g.slice())
  const lone: Shape[][] = []
  for (const g of groups.filter(satellite)) {
    const gb = g.map((s) => s.box).reduce(unionBox)
    let bi = -1
    let bd = 0.5 * U
    boxes.forEach((b, i) => {
      const d = boxGap(gb, b)
      if (d <= bd) { bd = d; bi = i }
    })
    if (bi >= 0) merged[bi].push(...g)
    else lone.push(g)
  }
  return [...merged, ...lone]
}

/**
 * A long line that is really a wire can sit inside a symbol's cluster — a lead
 * the hand ran long, a wire that touches the body. The network is the judge: if
 * the symbol reads as well (or better) without that line, it was a wire.
 */
function peelWires(group: Shape[], net: Recogniser, U: number): { kept: Shape[]; peeled: Shape[]; pred: SketchPrediction } {
  let kept = group
  let pred = net.predict(kept.map((s) => s.pts))
  let bestP = bestSymbol(pred)?.p ?? 0
  const peeled: Shape[] = []
  for (let round = 0; round < 3 && kept.length > 1; round++) {
    const lines = kept.filter((s) => (s.straight || s.ortho || (s.chord / s.len >= 0.7 && s.axisFraction >= 0.5)) && !s.closed && s.len >= 0.5 * U).sort((a, b) => b.len - a.len)
    let took = false
    for (const line of lines) {
      const without = kept.filter((s) => s !== line)
      const p2 = net.predict(without.map((s) => s.pts))
      const b2 = bestSymbol(p2)?.p ?? 0
      if (b2 > bestP + 0.05) {
        kept = without
        pred = p2
        bestP = Math.max(bestP, b2)
        peeled.push(line)
        took = true
        break
      }
    }
    if (!took) break
  }
  return { kept, peeled, pred }
}

/**
 * Which op-amp input is the inverting one? The drawing says so with a '+' (two
 * crossing strokes) and a '−' (one) just inside the triangle by the inputs. The
 * template assumes minus on the first input; if the plus is drawn there instead,
 * the two input names trade places. When the marks can't be told apart the
 * template stands and the part is flagged, so the user is asked.
 */
function orientOpamp(d: PartDraft): void {
  const inMinus = d.pins.find((p) => p.name === 'in-')
  const inPlus = d.pins.find((p) => p.name === 'in+')
  if (!inMinus || !inPlus) return
  const major = Math.max(d.box.x1 - d.box.x0, d.box.y1 - d.box.y0)
  const marks = d.strokes.filter((s) => s.len <= 0.22 * major)
  const count = (pin: WorldPin) =>
    marks.filter((s) => {
      const c: Pt = [(s.box.x0 + s.box.x1) / 2, (s.box.y0 + s.box.y1) / 2]
      const near = dist(c, [pin.x, pin.y])
      const other = dist(c, [pin === inMinus ? inPlus.x : inMinus.x, pin === inMinus ? inPlus.y : inMinus.y])
      return near < other && near >= 0.16 * major && near <= 0.5 * major
    }).length
  const a = count(inMinus)
  const b = count(inPlus)
  d.polarityKnown = a !== b && Math.max(a, b) >= 2 && Math.min(a, b) >= 1
  if (d.polarityKnown && a > b) {
    d.flipped = true
    // two strokes (a plus) by the first input: it is the non-inverting one
    d.pins = d.pins.map((p) => (p === inMinus ? { ...p, name: 'in+' } : p === inPlus ? { ...p, name: 'in-' } : p))
  }
}

interface PartDraft {
  cls: string
  conf: number
  pose: Pose
  box: Box
  strokes: Shape[]
  alts: Array<{ cls: string; conf: number }>
  pins: WorldPin[]
  /** Op-amps: the +/− marks were read (otherwise the default is a guess). */
  polarityKnown?: boolean
  flipped?: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Scale candidates tried around the first guess. A wrong scale merges neighbours or shreds symbols, and the network then reads nothing. */
const SCALE_STEPS = [0.55, 0.75, 1, 1.35, 1.8]

export function extractCircuit(strokes: InkStroke[], net: Recogniser, opts: ExtractOptions = {}): ExtractResult {
  const shapes = strokes.filter((s) => s.pts.length >= 2).map(shapeOf)
  if (shapes.length === 0) {
    return { ir: { domain: 'circuit', nodes: [], edges: [], labels: [], doubts: [] }, parts: [], wireIds: [], dotIds: [], ignoredIds: [], unit: opts.unit ?? 80 }
  }
  if (opts.unit) return readAt(shapes, net, opts.unit, opts).result
  const U0 = estimateUnit(shapes)
  let best: { result: ExtractResult; score: number } | null = null
  for (const k of SCALE_STEPS) {
    const r = readAt(shapes, net, U0 * k, opts)
    if (!best || r.score > best.score) best = r
  }
  return best!.result
}

/** What the wiring step needs to know about a part. */
export interface WirePart {
  id: string
  pins: WorldPin[]
}

export interface Wiring {
  edges: SketchIRType['edges']
  doubts: SketchIRType['doubts']
  /** Wire ends that landed on nothing. */
  danglingEnds: number
  /** Where they are (page px), so the preview can mark them. */
  looseEnds: Pt[]
}

/**
 * Wires land on pins; wires meet wires; dots join crossings; the connected pins
 * become edges. Separate from reading the parts so the preview can re-run it
 * when the user changes a part's class or turn (which moves its pins).
 */
export function wireUp(parts: WirePart[], wires: Shape[], dots: Shape[], U: number, opts: ExtractOptions = {}): Wiring {
  const doubts: SketchIRType['doubts'] = []
  const addDoubt = (ref: string, why: SketchIRType['doubts'][number]['why']) => {
    if (!doubts.some((d) => d.ref === ref && d.why === why)) doubts.push({ ref, why })
  }
  const tolPin = clamp((opts.tolPinK ?? 0.4) * U, 12, 60)
  const tolJoin = clamp((opts.tolJoinK ?? 0.12) * U, 6, 26)
  const pinKeys: Array<{ part: number; pin: WorldPin; key: string }> = []
  parts.forEach((p, pi) => p.pins.forEach((pin) => pinKeys.push({ part: pi, pin, key: `${p.id}.${pin.name}` })))
  // DSU items: wires first, then pins
  const dsu = new Dsu(wires.length + pinKeys.length)
  const ends = new Map<number, boolean[]>() // per wire: [startAttached, endAttached]

  wires.forEach((w, wi) => {
    const attached = [false, false]
    ;[w.pts[0], w.pts[w.pts.length - 1]].forEach((e, ei) => {
      const near = pinKeys
        .map((k, i) => ({ i, d: dist(e, [k.pin.x, k.pin.y]) }))
        .filter((c) => c.d <= tolPin)
        .sort((a, b) => a.d - b.d)
      if (near.length) {
        dsu.union(wi, wires.length + near[0].i)
        attached[ei] = true
        if (near[1] && near[1].d < near[0].d * 1.35 && pinKeys[near[1].i].part === pinKeys[near[0].i].part) {
          addDoubt(pinKeys[near[0].i].key, 'ambiguous-junction')
        }
      }
    })
    ends.set(wi, attached)
  })

  // wire end on another wire (a T or an L): join
  wires.forEach((a, ai) => {
    wires.forEach((b, bi) => {
      if (ai === bi) return
      ;[0, 1].forEach((ei) => {
        const e = ei === 0 ? a.pts[0] : a.pts[a.pts.length - 1]
        if (polyDist(e, b.simp) <= tolJoin) {
          dsu.union(ai, bi)
          ends.get(ai)![ei] = true
        }
      })
    })
  })

  // a dot on a crossing joins every wire it sits on
  for (const d of dots) {
    const c: Pt = [(d.box.x0 + d.box.x1) / 2, (d.box.y0 + d.box.y1) / 2]
    const on = wires.map((w, i) => ({ w, i })).filter(({ w }) => polyDist(c, w.simp) <= tolJoin * 0.8)
    for (let k = 1; k < on.length; k++) dsu.union(on[0].i, on[k].i)
    // …and the pin it sits next to
    pinKeys.forEach((k, i) => {
      if (on.length && dist(c, [k.pin.x, k.pin.y]) <= tolJoin) dsu.union(on[0].i, wires.length + i)
    })
  }

  // parts that touch directly (no wire between them)
  pinKeys.forEach((a, i) => {
    pinKeys.forEach((b, j) => {
      if (j <= i || a.part === b.part) return
      if (dist([a.pin.x, a.pin.y], [b.pin.x, b.pin.y]) <= 0.12 * U) dsu.union(wires.length + i, wires.length + j)
    })
  })

  // loose ends
  const looseEnds: Pt[] = []
  wires.forEach((w, wi) => {
    const att = ends.get(wi)!
    if (!att[0]) looseEnds.push([w.pts[0][0], w.pts[0][1]])
    if (!att[1]) looseEnds.push([w.pts[w.pts.length - 1][0], w.pts[w.pts.length - 1][1]])
    if (!att[0] || !att[1]) {
      // an end that touches another wire's CROSSING without a dot is a free end too
      addDoubt(`wire:${w.id}`, 'dangling-wire')
    }
  })
  // crossings without a dot are NOT connections — nothing to do, which is the point

  // nets → edges
  const nets = new Map<number, string[]>()
  pinKeys.forEach((k, i) => {
    const r = dsu.find(wires.length + i)
    // only pins that something is actually wired to belong to a net
    const touched = wires.some((_, wi) => dsu.find(wi) === r) || pinKeys.some((o, j) => j !== i && dsu.find(wires.length + j) === r)
    if (!touched) return
    nets.set(r, [...(nets.get(r) ?? []), k.key])
  })
  const edges: SketchIRType['edges'] = []
  for (const keys of nets.values()) {
    if (keys.length < 2) continue
    const sorted = keys.slice().sort()
    for (let i = 1; i < sorted.length; i++) {
      const [an, ap] = [sorted[0].slice(0, sorted[0].indexOf('.')), sorted[0].slice(sorted[0].indexOf('.') + 1)]
      const [bn, bp] = [sorted[i].slice(0, sorted[i].indexOf('.')), sorted[i].slice(sorted[i].indexOf('.') + 1)]
      edges.push({ a: { node: an, pin: ap }, b: { node: bn, pin: bp }, kind: 'wire', conf: 1 })
    }
  }


  const danglingEnds = wires.reduce((n, _w, wi) => n + (ends.get(wi)![0] ? 0 : 1) + (ends.get(wi)![1] ? 0 : 1), 0)
  return { edges, doubts, danglingEnds, looseEnds }
}

/** A part's pins at its current class and turn (op-amps keep their read orientation). */
export function partPins(p: Pick<ExtractedPart, 'cls' | 'pose' | 'box' | 'flip'>): WorldPin[] {
  const pins = pinsOf(p.cls, p.pose, p.box)
  if (p.cls !== 'opamp' || !p.flip) return pins
  const a = pins.find((q) => q.name === 'in-')
  const b = pins.find((q) => q.name === 'in+')
  return pins.map((q) => (q === a ? { ...q, name: 'in+' } : q === b ? { ...q, name: 'in-' } : q))
}

/** Parts + wiring → Scene IR, with the doubts a person should look at. */
export function irFrom(parts: ExtractedPart[], wiring: Wiring): SketchIRType {
  const doubts = wiring.doubts.map((d) => ({ ...d }))
  const add = (ref: string, why: SketchIRType['doubts'][number]['why']) => {
    if (!doubts.some((d) => d.ref === ref && d.why === why)) doubts.push({ ref, why })
  }
  for (const p of parts) {
    if (p.conf < 0.6) add(p.id, 'low-confidence')
    if (p.cls === 'opamp' && !p.polarityKnown) add(p.id, 'ambiguous-junction')
    if (p.valueUnreadable) add(p.id, 'unreadable-value')
  }
  const nodes: SketchIRType['nodes'] = parts.map((p) => ({
    id: p.id,
    cls: p.cls,
    conf: Math.round(p.conf * 1000) / 1000,
    alt: p.alts.slice(0, 3).map((a) => ({ cls: a.cls, conf: Math.round(a.conf * 1000) / 1000 })),
    bbox: [p.box.x0, p.box.y0, p.box.x1 - p.box.x0, p.box.y1 - p.box.y0] as [number, number, number, number],
    rot: canonicalPose(p.cls, p.pose),
    ...(p.values && Object.keys(p.values).length ? { values: p.values } : {}),
    source: 'ink' as const,
  }))
  return { domain: 'circuit', nodes, edges: wiring.edges, labels: [], doubts }
}

/**
 * Re-read the wiring after the user changed parts (a class, a turn, a value).
 * Pins move with the class and turn, so the nets are rebuilt from the same wire
 * strokes. Everything else about the reading is kept.
 */
export function rewire(result: ExtractResult, parts: ExtractedPart[], opts: ExtractOptions = {}): ExtractResult {
  const next = parts.map((p) => ({ ...p, pins: partPins(p) }))
  const wiring = wireUp(next, result.wires ?? [], result.dots ?? [], result.unit, opts)
  return { ...result, parts: next, ir: irFrom(next, wiring), looseEnds: wiring.looseEnds }
}

/** How well a reading explains the ink: confident parts count for, stray ink and loose wire ends against. */
function readAt(shapes: Shape[], net: Recogniser, U: number, opts: ExtractOptions): { result: ExtractResult; score: number } {
  const minPartP = opts.minPartP ?? 0.35
  // ── 1. dots, wires, and what is left (bodies, plates, leads) ─────────────
  // A junction dot is a small LOOPY scribble; a short straight stroke is a '+' or a plate.
  const isDot = (s: Shape) => s.diag <= Math.max(8, 0.12 * U) && s.len >= 2 * Math.max(s.diag, 3) && s.len <= 6 * Math.max(s.diag, 3)
  const dots = shapes.filter(isDot)
  const rest = shapes.filter((s) => !isDot(s))
  const wires: Shape[] = rest.filter((s) => looksLikeWire(s, 0.9 * U, U))
  const bodyShapes = rest.filter((s) => !looksLikeWire(s, 0.9 * U, U))

  // ── 1b. values written beside parts — found BEFORE the symbols are grouped,
  //        or a label 30 px from a resistor is swept into the resistor's strokes ──
  let textReads: TextRead[] = []
  const textUsed = new Set<string>()
  let bodiesForGroups = bodyShapes
  if (opts.charNet) {
    const near = clamp((opts.tolJoinK ?? 0.12) * U, 6, 26) * 1.5
    // a dot that is not on a wire is a decimal point, not a junction
    const free = dots.filter((d) => {
      const c: Pt = [(d.box.x0 + d.box.x1) / 2, (d.box.y0 + d.box.y1) / 2]
      return !wires.some((w) => polyDist(c, w.simp) <= near)
    })
    const candidates = [...bodyShapes.filter((s) => s.diag <= 0.45 * U), ...free]
    textReads = findText(candidates, bodyShapes, net, opts.charNet, U)
    for (const r of textReads) r.strokeIds.forEach((id) => textUsed.add(id))
    bodiesForGroups = bodyShapes.filter((s) => !textUsed.has(s.id))
  }

  // ── 2. symbols: group the body strokes, ask the network ─────────────────
  const groups = absorbSatellites(cluster(bodiesForGroups, 0.2 * U), U)
  const drafts: PartDraft[] = []
  const ignored: Shape[] = []
  for (const g0 of groups) {
    const { kept, peeled, pred } = peelWires(g0, net, U)
    wires.push(...peeled)
    const best = bestSymbol(pred)
    if (!best || best.p < minPartP) {
      ignored.push(...kept)
      continue
    }
    const box = kept.map((s) => s.box).reduce(unionBox)
    const pose = pred.pose
    drafts.push({
      cls: best.cls, conf: best.p, pose, box, strokes: kept,
      alts: pred.top.filter((t) => t.cls !== 'unknown' && t.cls !== best.cls).map((t) => ({ cls: t.cls, conf: t.conf })),
      pins: pinsOf(best.cls, pose, box),
    })
  }
  for (const d of drafts) if (d.cls === 'opamp') orientOpamp(d)
  drafts.sort((a, b) => a.box.x0 - b.box.x0 || a.box.y0 - b.box.y0)
  const parts: ExtractedPart[] = drafts.map((d, i) => ({
    id: `n${i + 1}`, cls: d.cls, conf: d.conf, pose: d.pose, box: d.box, strokeIds: d.strokes.map((s) => s.id), alts: d.alts, pins: d.pins,
    flip: d.flipped, polarityKnown: d.polarityKnown,
  }))

  // ── values: attach what was read to the nearest parts ─────────────────
  const textIds = new Set<string>()
  const att = attachValues(parts, textReads, U)
  for (const a of att.attached) {
    const part = parts.find((p) => p.id === a.partId)!
    part.values = { ...(part.values ?? {}), [a.param]: a.text }
    a.strokeIds.forEach((id) => textIds.add(id))
  }
  // written beside a part but not readable as a value: ask, don't guess
  for (const r of textReads) {
    if (r.ok) continue
    const c: Pt = [(r.box.x0 + r.box.x1) / 2, (r.box.y0 + r.box.y1) / 2]
    let best: { p: ExtractedPart; d: number } | null = null
    for (const p of parts) {
      const dx = Math.max(p.box.x0 - c[0], 0, c[0] - p.box.x1)
      const dy = Math.max(p.box.y0 - c[1], 0, c[1] - p.box.y1)
      const d = Math.hypot(dx, dy)
      if (d <= 1.1 * U && (!best || d < best.d)) best = { p, d }
    }
    if (best) best.p.valueUnreadable = true
  }
  // a decimal point that belonged to some text is not a junction dot
  const wiringDots = dots.filter((d) => !textUsed.has(d.id))
  let wiring = wireUp(parts, wires, wiringDots, U, opts)
  // Every real part in a circuit is wired to something. One nothing connects to is
  // stray ink — most often a handwritten label that read as a symbol — so it is
  // dropped (and its ink left alone) and the wiring read again without it. A
  // drawing of nothing BUT unwired parts is kept as it is.
  const wired = new Set<string>()
  wiring.edges.forEach((e) => { wired.add(e.a.node); wired.add(e.b.node) })
  const stray = parts.filter((p) => !wired.has(p.id))
  const strayIds: string[] = []
  if (stray.length > 0 && stray.length < parts.length) {
    for (const p of stray) {
      strayIds.push(...p.strokeIds)
      parts.splice(parts.indexOf(p), 1)
    }
    wiring = wireUp(parts, wires, wiringDots, U, opts)
  }
  const ir = irFrom(parts, wiring)
  const score = parts.reduce((a, p) => a + p.conf, 0) - 0.4 * ignored.length - 0.25 * wiring.danglingEnds - 0.5 * strayIds.length / 4
  return {
    result: {
      ir,
      parts,
      wireIds: wires.map((w) => w.id),
      dotIds: wiringDots.map((d) => d.id),
      ignoredIds: [...ignored.map((s) => s.id), ...strayIds],
      unit: U,
      wires,
      dots: wiringDots,
      looseEnds: wiring.looseEnds,
      textIds: [...textIds],
      texts: textReads,
    },
    score,
  }
}
