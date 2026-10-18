// SYNTHETIC optics sketches with their ground truth — the optics half of the S4 gold situations.
// (Same contract as mech-synth.ts: generated hands, so every rate measured on it is SYNTHETIC.)

import { makeRng, type Rng } from './rng'
import { drawPolylines, makeWriter, type Stroke3, type WriterStyle } from './synth'
import type { Pt } from './geom'
import type { SketchIRType, SketchIRNode } from './ir'

export type OpticsExpect =
  /** a parallel beam from the source meets at distance f behind the lens */
  | { kind: 'focuses'; f: number }
  | { kind: 'diverges'; f: number }
  | { kind: 'reflects'; mirrorTilt: number }
  | { kind: 'passes' }

export interface OpticsScene {
  id: string
  title: string
  strokes: Stroke3[]
  owners: string[]
  truth: { ir: SketchIRType }
  expect: OpticsExpect
  device: string
}

const rad = (d: number) => (d * Math.PI) / 180

interface Drawn {
  poly: Pt[]
  owner: string
  closed?: boolean
}

export class OpticsBuilder {
  nodes: SketchIRNode[] = []
  drawn: Drawn[] = []
  expect: OpticsExpect = { kind: 'passes' }
  private n = 0
  private rng: Rng
  constructor(rng: Rng) {
    this.rng = rng
  }

  private add(cls: string, box: [number, number, number, number], angle: number, extra: Partial<SketchIRNode> = {}) {
    const id = `n${++this.n}`
    this.nodes.push({ id, cls, conf: 1, bbox: box, rot: 0, angle, source: 'ink', ...extra })
    return id
  }

  axis(x0: number, x1: number, y: number) {
    this.drawn.push({ poly: [[x0, y], [x1, y]], owner: 'axis' })
  }

  /** A light source: a circle, with a beam arrow leaving it at `beam` degrees. */
  source(cx: number, cy: number, r: number, beam = 0): string {
    const id = this.add('light-source', [cx - r, cy - r, 2 * r, 2 * r], beam)
    const pts: Pt[] = []
    const a0 = this.rng.range(0, 6.28)
    for (let i = 0; i <= 26; i++) {
      const a = a0 + (i / 26) * 2 * Math.PI * 1.02
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
    this.drawn.push({ poly: pts, owner: id, closed: true })
    const b = rad(beam)
    const tail: Pt = [cx + (r + 3) * Math.cos(b), cy + (r + 3) * Math.sin(b)]
    const L = this.rng.range(46, 64)
    const tip: Pt = [tail[0] + L * Math.cos(b), tail[1] + L * Math.sin(b)]
    this.drawn.push({ poly: [tail, tip], owner: id })
    const spread = rad(this.rng.range(24, 36))
    const back = Math.atan2(tail[1] - tip[1], tail[0] - tip[0])
    for (const s of [-1, 1]) this.drawn.push({ poly: [tip, [tip[0] + 14 * Math.cos(back + s * spread), tip[1] + 14 * Math.sin(back + s * spread)]], owner: id })
    return id
  }

  /** A lens drawn as a pointed outline. */
  lensOutline(cx: number, cy: number, h: number, f: number): string {
    const id = this.add('thin-lens', [cx - 1, cy - h / 2, 2, h], 0, { values: { f: String(f) } })
    const w = this.rng.range(14, 22)
    const pts: Pt[] = []
    for (let i = 0; i <= 14; i++) pts.push([cx + (w / 2) * Math.sin((i / 14) * Math.PI), cy - h / 2 + (h * i) / 14])
    for (let i = 14; i >= 0; i--) pts.push([cx - (w / 2) * Math.sin((i / 14) * Math.PI), cy - h / 2 + (h * i) / 14])
    this.drawn.push({ poly: pts, owner: id, closed: true })
    return id
  }

  /** A lens drawn as a vertical double-headed arrow: heads fold back (converging) or out (diverging). */
  lensArrow(cx: number, cy: number, h: number, f: number): string {
    const id = this.add('thin-lens', [cx - 1, cy - h / 2, 2, h], 0, { values: { f: String(f) } })
    const top: Pt = [cx, cy - h / 2]
    const bot: Pt = [cx, cy + h / 2]
    this.drawn.push({ poly: [top, bot], owner: id })
    const hl = 15
    const spread = rad(this.rng.range(26, 36))
    const conv = f > 0
    for (const [end, dir] of [[top, 1], [bot, -1]] as Array<[Pt, number]>) {
      // direction from the end back along the shaft is `dir` (down for the top end); converging heads fold back
      const base = conv ? Math.atan2(dir, 0) : Math.atan2(-dir, 0)
      for (const s of [-1, 1]) this.drawn.push({ poly: [end, [end[0] + hl * Math.cos(base + s * spread), end[1] + hl * Math.sin(base + s * spread)]], owner: id })
    }
    return id
  }

  /** A plane mirror from (x0,y0) to (x1,y1), hatched on its back (the side away from the source, to the right). */
  mirror(x0: number, y0: number, x1: number, y1: number): string {
    const len = Math.hypot(x1 - x0, y1 - y0)
    let theta = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI
    while (theta <= -90) theta += 180
    while (theta > 90) theta -= 180
    let tilt = theta - 90
    while (tilt <= -90) tilt += 180
    while (tilt > 90) tilt -= 180
    const id = this.add('optical-mirror', [(x0 + x1) / 2 - 1, (y0 + y1) / 2 - len / 2, 2, len], Math.abs(tilt) < 2.5 ? 0 : tilt)
    this.drawn.push({ poly: [[x0, y0], [x1, y1]], owner: id })
    const ux = (x1 - x0) / len
    const uy = (y1 - y0) / len
    let nx = -uy
    let ny = ux
    if (nx < 0) { nx = -nx; ny = -ny } // back = toward +x
    const gap = this.rng.range(14, 20)
    for (let t = 8; t < len - 4; t += gap) {
      const px = x0 + ux * t
      const py = y0 + uy * t
      const L = this.rng.range(11, 15)
      this.drawn.push({ poly: [[px, py], [px - ux * L * 0.7 + nx * L, py - uy * L * 0.7 + ny * L]], owner: id })
    }
    return id
  }

  screen(cx: number, cy: number, h: number): string {
    const id = this.add('optical-screen', [cx - 1, cy - h / 2, 2, h], 0)
    this.drawn.push({ poly: [[cx, cy - h / 2], [cx, cy + h / 2]], owner: id })
    return id
  }

  /** Short upright ticks on the axis at the given x positions (focal marks). */
  marks(xs: number[], y: number) {
    for (const x of xs) this.drawn.push({ poly: [[x, y - 6], [x, y + 6]], owner: 'mark' })
  }

  truth(): { ir: SketchIRType } {
    return { ir: { domain: 'optics', nodes: this.nodes, edges: [], labels: [], doubts: [] } }
  }
}

export interface OpticsSituation {
  id: string
  title: string
  build: (rng: Rng) => OpticsBuilder
}

const AXIS_Y = 240

const convex: OpticsSituation = {
  id: 'convex-lens-focus',
  title: 'A convex lens focuses a beam onto a screen at f',
  build: (rng) => {
    const b = new OpticsBuilder(rng)
    const f = Math.round(rng.range(120, 170))
    const lx = rng.range(300, 340)
    b.axis(100, lx + f + 120, AXIS_Y)
    b.source(140, AXIS_Y, 13)
    b.lensOutline(lx, AXIS_Y, rng.range(130, 170), f)
    b.screen(lx + f, AXIS_Y, 120)
    b.marks([lx - f, lx + f], AXIS_Y)
    b.expect = { kind: 'focuses', f }
    return b
  },
}

const convexArrow: OpticsSituation = {
  id: 'convex-lens-arrow',
  title: 'A convex lens drawn as a double arrow',
  build: (rng) => {
    const b = new OpticsBuilder(rng)
    const f = Math.round(rng.range(120, 170))
    const lx = rng.range(300, 340)
    b.axis(100, lx + f + 120, AXIS_Y)
    b.source(140, AXIS_Y, 13)
    b.lensArrow(lx, AXIS_Y, rng.range(130, 170), f)
    b.screen(lx + f, AXIS_Y, 110)
    b.marks([lx - f, lx + f], AXIS_Y)
    b.expect = { kind: 'focuses', f }
    return b
  },
}

const concave: OpticsSituation = {
  id: 'concave-lens-diverges',
  title: 'A concave (diverging) lens spreads a beam',
  build: (rng) => {
    const b = new OpticsBuilder(rng)
    const f = Math.round(rng.range(110, 160))
    const lx = rng.range(300, 340)
    b.axis(100, lx + 260, AXIS_Y)
    b.source(140, AXIS_Y, 13)
    b.lensArrow(lx, AXIS_Y, rng.range(130, 170), -f)
    b.marks([lx - f, lx + f], AXIS_Y)
    b.expect = { kind: 'diverges', f }
    return b
  },
}

const planeMirror = (tilt: number): OpticsSituation => ({
  id: `plane-mirror-${tilt}`,
  title: `A beam meets a plane mirror turned ${tilt}°`,
  build: (rng) => {
    const b = new OpticsBuilder(rng)
    const mx = rng.range(330, 380)
    const h = rng.range(130, 170)
    const dy = (h / 2) * Math.cos(rad(tilt))
    const dx = (h / 2) * Math.sin(rad(tilt))
    b.source(140, AXIS_Y, 13)
    b.mirror(mx - dx, AXIS_Y - dy, mx + dx, AXIS_Y + dy)
    b.expect = { kind: 'reflects', mirrorTilt: tilt }
    return b
  },
})

const lensNoMarks: OpticsSituation = {
  id: 'lens-no-marks',
  title: 'A lens and a screen with no focal marks (f is left to be typed)',
  build: (rng) => {
    const b = new OpticsBuilder(rng)
    const lx = rng.range(290, 330)
    b.source(130, AXIS_Y, 13)
    b.lensOutline(lx, AXIS_Y, rng.range(130, 170), 150)
    b.screen(lx + 190, AXIS_Y, 120)
    b.expect = { kind: 'passes' }
    return b
  },
}

const offAxis: OpticsSituation = {
  id: 'lens-off-axis-source',
  title: 'A source above the axis, a lens and a screen',
  build: (rng) => {
    const b = new OpticsBuilder(rng)
    const f = Math.round(rng.range(120, 160))
    const lx = rng.range(300, 330)
    b.axis(100, lx + f + 110, AXIS_Y)
    b.source(140, AXIS_Y - rng.range(30, 50), 13)
    b.lensOutline(lx, AXIS_Y, 170, f)
    b.screen(lx + f + 40, AXIS_Y, 130)
    b.marks([lx - f, lx + f], AXIS_Y)
    b.expect = { kind: 'passes' }
    return b
  },
}

const twoLenses: OpticsSituation = {
  id: 'two-lenses',
  title: 'Two convex lenses in a row',
  build: (rng) => {
    const b = new OpticsBuilder(rng)
    const l1 = rng.range(260, 290)
    const l2 = l1 + rng.range(200, 240)
    b.axis(100, l2 + 160, AXIS_Y)
    b.source(130, AXIS_Y, 13)
    b.lensOutline(l1, AXIS_Y, 150, 120)
    b.lensOutline(l2, AXIS_Y, 150, 120)
    b.screen(l2 + 120, AXIS_Y, 110)
    b.expect = { kind: 'passes' }
    return b
  },
}

const tiltedBeam: OpticsSituation = {
  id: 'angled-beam-lens',
  title: 'A beam aimed slightly downward through a lens',
  build: (rng) => {
    const b = new OpticsBuilder(rng)
    const f = Math.round(rng.range(120, 160))
    const lx = rng.range(300, 330)
    b.source(140, AXIS_Y - 40, 13, rng.range(8, 14))
    b.lensArrow(lx, AXIS_Y, 170, f)
    b.screen(lx + f, AXIS_Y, 120)
    b.expect = { kind: 'passes' }
    return b
  },
}

export const OPTICS_SITUATIONS: OpticsSituation[] = [
  convex,
  convexArrow,
  concave,
  planeMirror(0),
  planeMirror(45),
  planeMirror(30),
  lensNoMarks,
  offAxis,
  twoLenses,
  tiltedBeam,
]

export function drawOpticsScene(sit: OpticsSituation, rng: Rng, w: WriterStyle): OpticsScene {
  const b = sit.build(rng.fork('build'))
  const strokes: Stroke3[] = []
  const owners: string[] = []
  let t = 0
  const whole: WriterStyle = { ...w, splitProb: 0 }
  for (const d of b.drawn) {
    const made = drawPolylines(rng.fork(`d${owners.length}`), d.closed ? whole : w, [d.poly], t, 110)
    for (const s of made.strokes) {
      strokes.push(s)
      owners.push(d.owner)
    }
    t = made.tEnd
  }
  return { id: sit.id, title: sit.title, strokes, owners, truth: b.truth(), expect: b.expect, device: w.device }
}

export function makeOpticsScene(i: number, seed: number, device: 'mouse' | 'touchpad' | 'finger' | 'pen' = 'mouse'): OpticsScene {
  const sit = OPTICS_SITUATIONS[i % OPTICS_SITUATIONS.length]
  const rng = makeRng(seed * 1000 + 500 + i)
  const w = makeWriter(rng.fork('w'), `optics-${seed}-${i}`, device)
  return drawOpticsScene(sit, rng.fork('s'), w)
}
