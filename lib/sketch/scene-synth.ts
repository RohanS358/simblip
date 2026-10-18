// A whole circuit, drawn the way a person sketches one: every part as pen
// strokes, every wire a hand-drawn polyline, junction dots where wires meet.
//
// The layout (part positions, routed wires) comes from the app's own schematic
// engine (scripts/ai/sketch/make-layouts.mjs); the Scene IR that produced it is
// the ground truth. Symbols and wires go through the same hand model as the
// single-symbol generator, so a "scene" is as messy as one person's drawing.
//
// SYNTHETIC. Scenes test the extractor's plumbing (grouping, wire matching,
// nets) on generated hands; they say nothing about real handwriting.

import { ANCHOR_INDEX } from '@/lib/scene/simscript-props'
import { POSE_SYMMETRY, canonicalPose, type Pose, type Wave1Class } from './classes'
import type { SketchIRType } from './ir'
import { PIN_TEMPLATE, pinsOf, type WorldPin } from './pins'
import { drawDot, drawPolylines, drawSymbolPlaced, type WriterStyle } from './synth'
import { drawChar } from './char-synth'
import { CHAR_LABELS } from './char-glyphs'
import { mainParamOf } from './compile'
import type { Rng } from './rng'

type Pt = [number, number]
type Stroke3 = Array<[number, number, number]>

export interface Layout {
  id: string
  ir: SketchIRType
  parts: Array<{
    id: string
    cls: string
    x: number
    y: number
    w: number
    h: number
    rot: number
    terminals: Array<{ x: number; y: number }>
  }>
  wires: Array<{ pts: number[][]; a: { part: number; term: number }; b: { part: number; term: number } }>
}

export interface Scene {
  id: string
  layoutId: string
  writer: string
  device: WriterStyle['device']
  /** Every stroke, in the order the person drew them. [x, y, t] page px / ms. */
  strokes: Stroke3[]
  /** What each stroke is — for debugging and per-stage metrics only; the extractor never sees it. */
  roles: Array<{ role: 'symbol' | 'wire' | 'dot' | 'text'; owner: string }>
  /** Ground truth: the circuit that was drawn, with each node's bbox taken from its ink. */
  truth: SketchIRType
}

const nearly = (a: number, b: number) => Math.abs(a - b) < 1.5

/** Keep every segment axis-aligned after the end points were moved onto the drawn pins. */
function orthogonalize(points: Pt[], firstHorizontal: boolean): Pt[] {
  const out: Pt[] = [points[0]]
  let horizontal = firstHorizontal
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1]
    const b = points[i]
    if (nearly(a[0], b[0]) || nearly(a[1], b[1])) {
      horizontal = nearly(a[1], b[1])
    } else {
      // turn: if we were travelling horizontally, go vertical next
      const elbow: Pt = horizontal ? [a[0], b[1]] : [b[0], a[1]]
      out.push(elbow)
      horizontal = !horizontal
    }
    out.push(b)
  }
  // drop repeated points and collinear middles
  const clean: Pt[] = []
  for (const p of out) {
    const last = clean[clean.length - 1]
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1) continue
    clean.push(p)
  }
  return clean.filter((p, i) => {
    if (i === 0 || i === clean.length - 1) return true
    const a = clean[i - 1]
    const b = clean[i + 1]
    return !((nearly(a[0], p[0]) && nearly(p[0], b[0])) || (nearly(a[1], p[1]) && nearly(p[1], b[1])))
  })
}

/** Which of a class's pin names the app's terminal `index` is. */
function pinNameAt(cls: string, index: number): string | null {
  const tpl = PIN_TEMPLATE[cls as Wave1Class]
  const map = ANCHOR_INDEX[cls]
  if (!tpl || !map) return null
  return tpl.find((p) => map[p.name] === index)?.name ?? null
}

/**
 * Draw one layout as a hand-sketched scene.
 *
 * `scale` is page px per layout px: the app's schematic is small (a 96 px part),
 * a sketch is usually bigger.
 */
export interface SceneOptions {
  /** Write each part's value beside it ("4.7k", "9V"), as a student would. Default off. */
  text?: boolean
}

const UNIT_LETTER: Record<string, string> = { R: 'Ω', V: 'V', C: 'F', L: 'H' }

export function drawScene(layout: Layout, rng: Rng, w: WriterStyle, id = layout.id, scale = rng.range(1.15, 2.2), opts: SceneOptions = {}): Scene {
  const ox = rng.range(50, 300)
  const oy = rng.range(50, 300)
  const at = (x: number, y: number): Pt => [x * scale + ox, y * scale + oy]

  const strokes: Stroke3[] = []
  const roles: Scene['roles'] = []
  let t = 0
  const push = (list: Stroke3[], role: 'symbol' | 'wire' | 'dot' | 'text', owner: string) => {
    for (const s of list) { strokes.push(s); roles.push({ role, owner }) }
  }

  // 1. the parts
  const pins: WorldPin[][] = []
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  const poses: Pose[] = []
  layout.parts.forEach((p) => {
    const [cx, cy] = at(p.x + p.w / 2, p.y + p.h / 2)
    const rot = ((((Math.round(p.rot / 90) * 90) % 360) + 360) % 360) as Pose
    // A part that looks the same turned half-way round (a resistor, a meter…) is
    // not DRAWN upside down: nobody writes the V of a voltmeter inverted or
    // flips their inductor's humps. It is drawn at 0/90, and which end is "a"
    // is whichever end the wire routed to terminal a reaches.
    const symmetric = POSE_SYMMETRY[p.cls as Wave1Class] === 'rot180'
    const pose = (symmetric ? rot % 180 : rot) as Pose
    const drawn = drawSymbolPlaced(rng, w, p.cls as Wave1Class, { cx, cy, width: p.w * scale * rng.range(0.9, 1.1), pose }, t)
    push(drawn.strokes, 'symbol', p.id)
    t = Math.max(...drawn.strokes.flat().map((q) => q[2])) + rng.range(150, 700)
    let ps = pinsOf(p.cls, pose, drawn.box)
    if (symmetric && rot >= 180 && ps.length === 2) ps = [{ ...ps[0], x: ps[1].x, y: ps[1].y }, { ...ps[1], x: ps[0].x, y: ps[0].y }]
    // an op-amp drawn with + on top has its inputs the other way round
    if (p.cls === 'opamp' && drawn.variant === 'plus-top') {
      const a = ps.find((q) => q.name === 'in-')
      const b = ps.find((q) => q.name === 'in+')
      if (a && b) ps = ps.map((q) => (q === a ? { ...q, y: b.y, x: b.x } : q === b ? { ...q, y: a.y, x: a.x } : q))
    }
    pins.push(ps)
    boxes.push(drawn.box)
    poses.push(pose)
  })

  // 2. the wires, end to end on the drawn pins
  const endCount = new Map<string, { n: number; at: Pt }>()
  layout.wires.forEach((wire) => {
    const ends = [wire.a, wire.b].map((e) => {
      const name = pinNameAt(layout.parts[e.part].cls, e.term)
      const pin = name ? pins[e.part].find((q) => q.name === name) : undefined
      return { pin, fallback: at(layout.parts[e.part].terminals[e.term].x, layout.parts[e.part].terminals[e.term].y), key: `${e.part}.${name ?? e.term}` }
    })
    const orig = wire.pts.map(([x, y]) => at(x, y))
    const startP: Pt = ends[0].pin ? [ends[0].pin.x, ends[0].pin.y] : ends[0].fallback
    const endP: Pt = ends[1].pin ? [ends[1].pin.x, ends[1].pin.y] : ends[1].fallback
    const firstHorizontal = orig.length > 1 ? Math.abs(orig[1][0] - orig[0][0]) >= Math.abs(orig[1][1] - orig[0][1]) : true
    const route = orthogonalize([startP, ...orig.slice(1, -1), endP], firstHorizontal)
    const drawn = drawPolylines(rng, w, [route], t, 110 * scale / 1.5)
    push(drawn.strokes, 'wire', `${wire.a.part}-${wire.b.part}`)
    t = drawn.tEnd
    for (const [i, e] of ends.entries()) {
      const rec = endCount.get(e.key) ?? { n: 0, at: i === 0 ? startP : endP }
      rec.n++
      endCount.set(e.key, rec)
    }
  })

  // 3. a dot where three or more things meet
  for (const [, rec] of endCount) {
    if (rec.n >= 2 && rng.chance(0.65)) {
      const d = drawDot(rng, w, rec.at[0], rec.at[1], t)
      push(d.strokes, 'dot', 'junction')
      t = d.tEnd
    }
  }

  // 4. values written beside the parts
  if (opts.text) {
    layout.ir.nodes.forEach((n, i) => {
      const key = mainParamOf(n.cls)
      const raw = key ? n.values?.[key] : undefined
      if (!raw) return
      // a unit letter after the number about half the time ("4.7kΩ", "9V")
      let text = raw
      const unit = key ? UNIT_LETTER[key] : undefined
      if (unit && rng.chance(0.45)) text += unit
      const box = boxes[i]
      const pw = Math.max(box.x1 - box.x0, box.y1 - box.y0)
      const H = pw * rng.range(0.16, 0.24)
      const advance = H * rng.range(0.72, 0.95)
      const width = text.length * advance
      const horizontal = box.x1 - box.x0 >= box.y1 - box.y0
      // above a horizontal part, beside a vertical one
      let x = horizontal ? (box.x0 + box.x1) / 2 - width / 2 : box.x1 + H * 0.9
      const y = horizontal ? box.y0 - H * rng.range(0.9, 1.4) : (box.y0 + box.y1) / 2
      for (const ch of text) {
        if (ch === '.') {
          const d = drawDot(rng, w, x + advance * 0.25, y + H * 0.45, t)
          push(d.strokes, 'text', n.id)
          t = d.tEnd
        } else if ((CHAR_LABELS as readonly string[]).includes(ch)) {
          const strokesC = drawChar(rng, w, ch as (typeof CHAR_LABELS)[number], H, { cx: x + advance * 0.5, cy: y })
          const shifted = strokesC.map((s) => s.map(([px, py, tt]): [number, number, number] => [px, py, tt + t]))
          push(shifted, 'text', n.id)
          t = Math.max(...shifted.flat().map((q) => q[2])) + rng.range(60, 220)
        }
        x += advance
      }
      t += rng.range(100, 400)
    })
  }

  const t0 = strokes[0][0][2]
  const timed = strokes.map((s) => s.map(([x, y, tt]): [number, number, number] => [x, y, tt - t0]))

  const truth: SketchIRType = {
    domain: layout.ir.domain,
    nodes: layout.ir.nodes.map((n, i) => ({
      ...n,
      bbox: [boxes[i].x0, boxes[i].y0, boxes[i].x1 - boxes[i].x0, boxes[i].y1 - boxes[i].y0] as [number, number, number, number],
      rot: canonicalPose(n.cls, poses[i]),
    })),
    edges: layout.ir.edges,
    labels: [],
    doubts: [],
  }
  return { id, layoutId: layout.id, writer: w.id, device: w.device, strokes: timed, roles, truth }
}
