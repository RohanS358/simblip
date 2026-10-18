// SYNTHETIC mechanics sketches with their ground truth — the S4 gold situations.
//
// Each situation is a small scene description ("a block on a 30° ramp"). `drawMechScene`
// turns it into hand-drawn strokes (a writer model: wobble, rounded corners, device timing)
// and the truth IR the reader should recover. Nothing here is real handwriting: results
// measured on it are SYNTHETIC and must be reported as such.

import { makeRng, type Rng } from './rng'
import { drawPolylines, makeWriter, type Stroke3, type WriterStyle } from './synth'
import type { Pt } from './geom'
import type { SketchIRType, SketchIRNode, SketchIREdge } from './ir'

export interface MechTruth {
  ir: SketchIRType
}

/** What the built scene should DO when Play is pressed (checked in the motion tests). */
export type Expect =
  | { kind: 'rests'; body: string }
  | { kind: 'slides-down-ramp'; body: string; angle: number }
  | { kind: 'oscillates'; body: string; period?: number }
  | { kind: 'swings'; body: string }
  | { kind: 'falls-to-ground'; body: string }
  | { kind: 'moves'; body: string; dir: 'left' | 'right' | 'up' | 'down' }
  | { kind: 'gap'; what: 'pulley' }
  | { kind: 'ray'; note: string }

export interface MechSituation {
  id: string
  title: string
  build: (rng: Rng) => SceneBuilder
}

export interface MechScene {
  id: string
  title: string
  strokes: Stroke3[]
  /** which part each stroke belongs to (for debugging) */
  owners: string[]
  truth: MechTruth
  expect: Expect
  device: string
}

const rad = (d: number) => (d * Math.PI) / 180

interface Drawn {
  poly: Pt[]
  owner: string
  closed?: boolean
}

export class SceneBuilder {
  nodes: SketchIRNode[] = []
  edges: SketchIREdge[] = []
  drawn: Drawn[] = []
  expect: Expect = { kind: 'rests', body: 'n1' }
  private n = 0
  private rng: Rng
  constructor(rng: Rng) {
    this.rng = rng
  }

  private id() {
    return `n${++this.n}`
  }

  private node(cls: string, cx: number, cy: number, w: number, h: number, angle: number, extra: Partial<SketchIRNode> = {}) {
    const id = this.id()
    this.nodes.push({
      id,
      cls,
      conf: 1,
      bbox: [cx - w / 2, cy - h / 2, w, h],
      rot: 0,
      angle,
      source: 'ink',
      ...extra,
    })
    return id
  }

  /** A hatched (or bare) surface from (x0,y0) to (x1,y1). Ticks go to the side away from `up`. */
  ground(x0: number, y0: number, x1: number, y1: number, hatch = true, away: Pt | null = null): string {
    const len = Math.hypot(x1 - x0, y1 - y0)
    let ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI
    if (ang > 90) ang -= 180
    if (ang <= -90) ang += 180
    const id = this.node('ground', (x0 + x1) / 2, (y0 + y1) / 2, len, 14, Math.abs(ang) < 2.5 ? 0 : ang)
    this.drawn.push({ poly: [[x0, y0], [x1, y1]], owner: id })
    if (hatch) {
      const ux = (x1 - x0) / len
      const uy = (y1 - y0) / len
      // under-side = the side pointing down the page
      let nx = -uy
      let ny = ux
      if (away ? nx * away[0] + ny * away[1] < 0 : ny < 0) { nx = -nx; ny = -ny }
      const gap = this.rng.range(14, 20)
      for (let t = 8; t < len - 4; t += gap) {
        const px = x0 + ux * t
        const py = y0 + uy * t
        const L = this.rng.range(11, 16)
        this.drawn.push({ poly: [[px, py], [px - ux * L * 0.7 + nx * L, py - uy * L * 0.7 + ny * L]], owner: id })
      }
    }
    return id
  }

  /** A right-triangle wedge; its slanted edge is the ramp. `riseRight` puts the tall side on the right. */
  wedge(xl: number, yb: number, w: number, h: number, riseRight: boolean): string {
    const A: Pt = [xl, yb]
    const B: Pt = [xl + w, yb]
    const C: Pt = riseRight ? [xl + w, yb - h] : [xl, yb - h]
    const hyp: [Pt, Pt] = riseRight ? [A, C] : [B, C]
    const len = Math.hypot(hyp[1][0] - hyp[0][0], hyp[1][1] - hyp[0][1])
    let ang = (Math.atan2(hyp[1][1] - hyp[0][1], hyp[1][0] - hyp[0][0]) * 180) / Math.PI
    if (ang > 90) ang -= 180
    if (ang <= -90) ang += 180
    const id = this.node('ground', (hyp[0][0] + hyp[1][0]) / 2, (hyp[0][1] + hyp[1][1]) / 2, len, 12, ang)
    this.drawn.push({ poly: [A, B, C, A], owner: id, closed: true })
    return id
  }

  block(cx: number, cy: number, w: number, h: number, angle = 0): string {
    const id = this.node('block', cx, cy, w, h, angle)
    const c = Math.cos(rad(angle))
    const s = Math.sin(rad(angle))
    const corners = ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Pt[]).map(([x, y]): Pt => [cx + x * c - y * s, cy + x * s + y * c])
    this.drawn.push({ poly: [...corners, corners[0]], owner: id, closed: true })
    return id
  }

  ball(cx: number, cy: number, r: number, cls: 'mass' | 'hinge' = 'mass'): string {
    const id = this.node(cls, cx, cy, 2 * r, 2 * r, 0)
    const pts: Pt[] = []
    const a0 = this.rng.range(0, 6.28)
    for (let i = 0; i <= 28; i++) {
      const a = a0 + (i / 28) * 2 * Math.PI * 1.02
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
    this.drawn.push({ poly: pts, owner: id, closed: true })
    return id
  }

  hinge(cx: number, cy: number): string {
    return this.ball(cx, cy, 7, 'hinge')
  }

  /** A zigzag spring between two points (the first and last stretch are straight leads). */
  spring(a: string, b: string, p0: Pt, p1: Pt, coils = 6, amp = 11): void {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const ux = (p1[0] - p0[0]) / len
    const uy = (p1[1] - p0[1]) / len
    const lead = Math.min(0.16 * len, 24)
    const pts: Pt[] = [p0, [p0[0] + ux * lead, p0[1] + uy * lead]]
    const span = len - 2 * lead
    for (let i = 0; i < coils * 2; i++) {
      const t = lead + (span * (i + 0.5)) / (coils * 2)
      const side = i % 2 ? 1 : -1
      pts.push([p0[0] + ux * t - uy * amp * side, p0[1] + uy * t + ux * amp * side])
    }
    pts.push([p1[0] - ux * lead, p1[1] - uy * lead], p1)
    this.drawn.push({ poly: pts, owner: `${a}-${b}` })
    this.edges.push({ a: { node: a, pin: 'centre' }, b: { node: b, pin: 'centre' }, kind: 'spring', conf: 1 })
  }

  rope(a: string, b: string, p0: Pt, p1: Pt, kind: 'rope' | 'rod' = 'rope'): void {
    this.drawn.push({ poly: [p0, p1], owner: `${a}-${b}` })
    this.edges.push({ a: { node: a, pin: 'centre' }, b: { node: b, pin: 'centre' }, kind, conf: 1 })
  }

  /** A force (or velocity) arrow: shaft plus two head strokes. */
  arrow(on: string, tail: Pt, tip: Pt, cls: 'force' | 'velocity' = 'force'): string {
    const len = Math.hypot(tip[0] - tail[0], tip[1] - tail[1])
    const ang = (Math.atan2(tip[1] - tail[1], tip[0] - tail[0]) * 180) / Math.PI
    const id = this.node(cls, (tail[0] + tip[0]) / 2, (tail[1] + tip[1]) / 2, len, 8, ang, { values: { on } })
    this.drawn.push({ poly: [tail, tip], owner: id })
    const hl = Math.min(18, 0.32 * len)
    const a = Math.atan2(tail[1] - tip[1], tail[0] - tip[0])
    const spread = rad(this.rng.range(24, 38))
    for (const s of [-1, 1]) {
      this.drawn.push({ poly: [tip, [tip[0] + hl * Math.cos(a + s * spread), tip[1] + hl * Math.sin(a + s * spread)]], owner: id })
    }
    return id
  }

  /** Something the engine cannot build (drawn anyway, so the reader has to say so). */
  strokeOnly(poly: Pt[], owner = 'extra', closed = false): void {
    this.drawn.push({ poly, owner, closed })
  }

  truth(): MechTruth {
    return { ir: { domain: 'mechanics', nodes: this.nodes, edges: this.edges, labels: [], doubts: [] } }
  }
}

/** Draw a built scene as a writer would, at an offset on the page. */
export function drawMechScene(sit: MechSituation, rng: Rng, w: WriterStyle, offset: Pt = [0, 0]): MechScene {
  const b = sit.build(rng.fork('build'))
  const shift = (p: Pt): Pt => [p[0] + offset[0], p[1] + offset[1]]
  const strokes: Stroke3[] = []
  const owners: string[] = []
  let t = 0
  // closed shapes are drawn in one go here (a baseline; a hand sometimes lifts mid-way)
  const whole: WriterStyle = { ...w, splitProb: 0 }
  const order = b.drawn.slice()
  for (const d of order) {
    const made = drawPolylines(rng.fork(`d${owners.length}`), d.closed ? whole : w, [d.poly.map(shift)], t, 110)
    for (const s of made.strokes) {
      strokes.push(s)
      owners.push(d.owner)
    }
    t = made.tEnd
  }
  const truth = b.truth()
  truth.ir.nodes = truth.ir.nodes.map((n) => ({ ...n, bbox: [n.bbox[0] + offset[0], n.bbox[1] + offset[1], n.bbox[2], n.bbox[3]] as [number, number, number, number] }))
  return { id: sit.id, title: sit.title, strokes, owners, truth, expect: b.expect, device: w.device }
}

// ── the gold situations ─────────────────────────────────────────────────────────

const G = (rng: Rng) => rng.range(0, 1)

/** Block on the level ground. */
const blockOnGround: MechSituation = {
  id: 'block-on-ground',
  title: 'A block resting on the ground',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const w = rng.range(90, 130)
    const h = rng.range(60, 90)
    const gy = 300
    const g = b.ground(100, gy, 100 + rng.range(320, 440), gy)
    const x = rng.range(180, 300)
    const k = b.block(x, gy - h / 2 - 7, w, h)
    b.expect = { kind: 'rests', body: k }
    void g
    return b
  },
}

const ballOnGround: MechSituation = {
  id: 'ball-on-ground',
  title: 'A ball resting on the ground',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const r = rng.range(32, 48)
    const gy = 300
    b.ground(100, gy, 480, gy)
    const m = b.ball(rng.range(200, 380), gy - r - 7, r)
    b.expect = { kind: 'rests', body: m }
    return b
  },
}

const ballFalls: MechSituation = {
  id: 'ball-falls',
  title: 'A ball released above the ground',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const r = rng.range(28, 40)
    b.ground(100, 360, 480, 360)
    const m = b.ball(rng.range(220, 360), rng.range(120, 180), r)
    b.expect = { kind: 'falls-to-ground', body: m }
    return b
  },
}

const wedgeRamp = (angle: number, riseRight: boolean, title: string): MechSituation => ({
  id: `block-on-${angle}-ramp${riseRight ? '' : '-left'}`,
  title,
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const a = angle + rng.range(-2, 2)
    const w = rng.range(240, 320)
    const h = Math.tan(rad(a)) * w
    const yb = 330
    const xl = 120
    b.ground(60, yb, 60 + w + 140, yb)
    b.wedge(xl, yb, w, h, riseRight)
    // the block sits on the slope, a third of the way down from the top
    const t = rng.range(0.55, 0.7)
    const top: Pt = riseRight ? [xl + w, yb - h] : [xl, yb - h]
    const foot: Pt = riseRight ? [xl, yb] : [xl + w, yb]
    const px = foot[0] + (top[0] - foot[0]) * t
    const py = foot[1] + (top[1] - foot[1]) * t
    const bw = rng.range(60, 80)
    const bh = rng.range(40, 54)
    const ang = riseRight ? -a : a
    const nx = Math.sin(rad(Math.abs(a))) * (riseRight ? -1 : 1)
    const ny = -Math.cos(rad(Math.abs(a)))
    const k = b.block(px + nx * (bh / 2 + 6), py + ny * (bh / 2 + 6), bw, bh, ang)
    b.expect = { kind: 'slides-down-ramp', body: k, angle: a }
    return b
  },
})

const springHoriz: MechSituation = {
  id: 'spring-mass-horizontal',
  title: 'A block on a spring against a wall',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const gy = 320
    b.ground(120, gy, 560, gy)
    const wall = b.ground(150, 180, 150, gy, true, [-1, 0])
    void G
    const bw = rng.range(80, 110)
    const bh = rng.range(60, 80)
    const bx = rng.range(380, 440)
    const k = b.block(bx, gy - bh / 2 - 7, bw, bh)
    b.spring(wall, k, [152, gy - bh / 2 - 7], [bx - bw / 2, gy - bh / 2 - 7], 6, rng.range(10, 14))
    b.expect = { kind: 'oscillates', body: k }
    return b
  },
}

const springVertical: MechSituation = {
  id: 'spring-mass-vertical',
  title: 'A mass hanging from a spring on the ceiling',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const cx = rng.range(220, 320)
    const c = b.ground(cx - 130, 110, cx + 130, 110, true)
    const r = rng.range(30, 40)
    const m = b.ball(cx, 270, r)
    b.spring(c, m, [cx, 110], [cx, 270 - r], 6, rng.range(10, 14))
    b.ground(cx - 130, 400, cx + 130, 400)
    b.expect = { kind: 'oscillates', body: m }
    return b
  },
}

const pendulumRod: MechSituation = {
  id: 'pendulum-rod',
  title: 'A pendulum: hinge, rod and bob',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const hx = rng.range(240, 320)
    const hy = 130
    const len = rng.range(150, 210)
    const swing = rng.range(25, 45) * (rng.chance(0.5) ? 1 : -1)
    const bx = hx + len * Math.sin(rad(swing))
    const by = hy + len * Math.cos(rad(swing))
    const r = rng.range(24, 32)
    const h = b.hinge(hx, hy)
    const m = b.ball(bx, by, r)
    const ux = (bx - hx) / len
    const uy = (by - hy) / len
    b.rope(h, m, [hx + ux * 7, hy + uy * 7], [bx - ux * r, by - uy * r], 'rod')
    b.expect = { kind: 'swings', body: m }
    return b
  },
}

const pendulumRope: MechSituation = {
  id: 'pendulum-rope-ceiling',
  title: 'A ball on a rope from the ceiling',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const hx = rng.range(240, 320)
    const ceil = b.ground(hx - 110, 110, hx + 110, 110, true)
    const len = rng.range(150, 200)
    const swing = rng.range(20, 40) * (rng.chance(0.5) ? 1 : -1)
    const bx = hx + len * Math.sin(rad(swing))
    const by = 110 + len * Math.cos(rad(swing))
    const r = rng.range(24, 32)
    const m = b.ball(bx, by, r)
    const ux = (bx - hx) / len
    const uy = (by - 110) / len
    b.rope(ceil, m, [hx, 110], [bx - ux * r, by - uy * r])
    b.expect = { kind: 'swings', body: m }
    return b
  },
}

const twoBlocksRope: MechSituation = {
  id: 'two-blocks-rope',
  title: 'Two blocks joined by a rope on the ground',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const gy = 320
    b.ground(100, gy, 560, gy)
    const bw = rng.range(70, 90)
    const bh = rng.range(55, 70)
    const x1 = rng.range(170, 210)
    const x2 = x1 + bw + rng.range(100, 150)
    const a = b.block(x1, gy - bh / 2 - 7, bw, bh)
    const c = b.block(x2, gy - bh / 2 - 7, bw, bh)
    b.rope(a, c, [x1 + bw / 2, gy - bh / 2 - 7], [x2 - bw / 2, gy - bh / 2 - 7])
    b.expect = { kind: 'rests', body: a }
    return b
  },
}

const twoBlocksSpring: MechSituation = {
  id: 'two-blocks-spring',
  title: 'Two blocks joined by a spring',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const gy = 320
    b.ground(100, gy, 580, gy)
    const bw = rng.range(70, 90)
    const bh = rng.range(55, 70)
    const x1 = rng.range(170, 210)
    const x2 = x1 + bw + rng.range(130, 170)
    const a = b.block(x1, gy - bh / 2 - 7, bw, bh)
    const c = b.block(x2, gy - bh / 2 - 7, bw, bh)
    b.spring(a, c, [x1 + bw / 2, gy - bh / 2 - 7], [x2 - bw / 2, gy - bh / 2 - 7], 6, rng.range(10, 14))
    b.expect = { kind: 'oscillates', body: a }
    return b
  },
}

const pushedBlock = (dir: 'right' | 'left'): MechSituation => ({
  id: `block-pushed-${dir}`,
  title: `A block pushed ${dir}`,
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const gy = 320
    b.ground(100, gy, 560, gy)
    const bw = rng.range(90, 120)
    const bh = rng.range(60, 80)
    const x = rng.range(260, 340)
    const k = b.block(x, gy - bh / 2 - 7, bw, bh)
    const L = rng.range(80, 120)
    const y = gy - bh / 2 - 7
    if (dir === 'right') b.arrow(k, [x - bw / 2 - L, y], [x - bw / 2 + 4, y])
    else b.arrow(k, [x + bw / 2 + L, y], [x + bw / 2 - 4, y])
    b.expect = { kind: 'moves', body: k, dir }
    return b
  },
})

const projectile: MechSituation = {
  id: 'ball-velocity',
  title: 'A ball launched with a velocity',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    b.ground(100, 380, 600, 380)
    const r = rng.range(24, 32)
    const cx = rng.range(170, 230)
    const cy = 300
    const m = b.ball(cx, cy, r)
    const L = rng.range(90, 130)
    const ang = rad(rng.range(25, 50))
    b.arrow(m, [cx + r * 0.7, cy - r * 0.7], [cx + r * 0.7 + L * Math.cos(ang), cy - r * 0.7 - L * Math.sin(ang)], 'velocity')
    b.expect = { kind: 'moves', body: m, dir: 'right' }
    return b
  },
}

const rampForce: MechSituation = {
  id: 'ramp-block-pushed',
  title: 'A block on a ramp pushed up the slope',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const a = 30 + rng.range(-3, 3)
    const w = rng.range(260, 320)
    const h = Math.tan(rad(a)) * w
    const yb = 340
    const xl = 130
    b.ground(60, yb, 60 + w + 140, yb)
    b.wedge(xl, yb, w, h, true)
    const t = rng.range(0.4, 0.5)
    const px = xl + w * t
    const py = yb - h * t
    const bw = 72
    const bh = 46
    const nx = -Math.sin(rad(a))
    const ny = -Math.cos(rad(a))
    const cx = px + nx * (bh / 2 + 6)
    const cy = py + ny * (bh / 2 + 6)
    const k = b.block(cx, cy, bw, bh, -a)
    const ux = Math.cos(rad(a))
    const uy = -Math.sin(rad(a))
    const L = rng.range(70, 100)
    const tail: Pt = [cx - ux * (bw / 2 + L), cy - uy * (bw / 2 + L)]
    b.arrow(k, tail, [cx - ux * (bw / 2 - 2), cy - uy * (bw / 2 - 2)])
    b.expect = { kind: 'moves', body: k, dir: 'up' }
    return b
  },
}

const betweenWalls: MechSituation = {
  id: 'block-between-springs',
  title: 'A block between two springs and two walls',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const gy = 320
    b.ground(80, gy, 620, gy)
    const w1 = b.ground(110, 190, 110, gy, true, [-1, 0])
    const w2 = b.ground(590, 190, 590, gy, true, [1, 0])
    const bw = rng.range(80, 100)
    const bh = rng.range(60, 74)
    const x = rng.range(320, 380)
    const k = b.block(x, gy - bh / 2 - 7, bw, bh)
    const y = gy - bh / 2 - 7
    b.spring(w1, k, [112, y], [x - bw / 2, y])
    b.spring(k, w2, [x + bw / 2, y], [588, y])
    b.expect = { kind: 'oscillates', body: k }
    return b
  },
}

const hangingFromSpringWithGround: MechSituation = {
  id: 'spring-hang-block',
  title: 'A block hanging from a ceiling spring',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const cx = rng.range(240, 320)
    const c = b.ground(cx - 120, 100, cx + 120, 100, true)
    const bw = rng.range(80, 100)
    const bh = rng.range(60, 74)
    const k = b.block(cx, 290, bw, bh)
    b.spring(c, k, [cx, 100], [cx, 290 - bh / 2], 7, rng.range(10, 14))
    b.expect = { kind: 'oscillates', body: k }
    return b
  },
}

const ballOnRamp: MechSituation = {
  id: 'ball-on-ramp',
  title: 'A ball on a ramp',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const a = 25 + rng.range(-3, 3)
    const w = rng.range(260, 320)
    const h = Math.tan(rad(a)) * w
    const yb = 330
    const xl = 130
    b.ground(60, yb, 60 + w + 140, yb)
    b.wedge(xl, yb, w, h, true)
    const t = rng.range(0.55, 0.7)
    const px = xl + w * t
    const py = yb - h * t
    const r = rng.range(22, 30)
    const m = b.ball(px - Math.sin(rad(a)) * (r + 5), py - Math.cos(rad(a)) * (r + 5), r)
    b.expect = { kind: 'slides-down-ramp', body: m, angle: a }
    return b
  },
}

const doublePendulum: MechSituation = {
  id: 'double-pendulum',
  title: 'Two bobs on rods from a hinge',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const hx = rng.range(240, 300)
    const hy = 110
    const h = b.hinge(hx, hy)
    const l1 = rng.range(100, 130)
    const a1 = rad(rng.range(15, 30))
    const x1 = hx + l1 * Math.sin(a1)
    const y1 = hy + l1 * Math.cos(a1)
    const r = rng.range(20, 26)
    const m1 = b.ball(x1, y1, r)
    const ux = Math.sin(a1)
    const uy = Math.cos(a1)
    b.rope(h, m1, [hx + ux * 7, hy + uy * 7], [x1 - ux * r, y1 - uy * r], 'rod')
    const l2 = rng.range(100, 130)
    const a2 = rad(rng.range(-30, -10))
    const x2 = x1 + l2 * Math.sin(a2)
    const y2 = y1 + l2 * Math.cos(a2)
    const m2 = b.ball(x2, y2, r)
    const vx = Math.sin(a2)
    const vy = Math.cos(a2)
    b.rope(m1, m2, [x1 + vx * r, y1 + vy * r], [x2 - vx * r, y2 - vy * r], 'rod')
    b.expect = { kind: 'swings', body: m2 }
    return b
  },
}

const ropeToWallRamp: MechSituation = {
  id: 'ramp-block-roped',
  title: 'A block on a ramp held by a rope',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const a = 28 + rng.range(-3, 3)
    const w = rng.range(280, 330)
    const h = Math.tan(rad(a)) * w
    const yb = 340
    const xl = 130
    b.ground(60, yb, 60 + w + 140, yb)
    const ramp = b.wedge(xl, yb, w, h, true)
    const t = 0.5
    const px = xl + w * t
    const py = yb - h * t
    const bw = 70
    const bh = 44
    const nx = -Math.sin(rad(a))
    const ny = -Math.cos(rad(a))
    const cx = px + nx * (bh / 2 + 6)
    const cy = py + ny * (bh / 2 + 6)
    const k = b.block(cx, cy, bw, bh, -a)
    // a rope from the block's upper end to the top of the ramp
    const ux = Math.cos(rad(a))
    const uy = -Math.sin(rad(a))
    const p0: Pt = [cx + ux * (bw / 2), cy + uy * (bw / 2)]
    const p1: Pt = [xl + w - 10 + nx * 6, yb - h + 10 + ny * 6]
    b.rope(k, ramp, p0, p1)
    b.expect = { kind: 'rests', body: k }
    return b
  },
}

/** Two masses over a pulley: the engine has no pulley, so the reader must say so. */
const atwood: MechSituation = {
  id: 'atwood-pulley',
  title: 'Two masses over a pulley (not buildable: no pulley component)',
  build: (rng) => {
    const b = new SceneBuilder(rng)
    const cx = rng.range(260, 320)
    const py = 130
    const R = 28
    b.strokeOnly([[cx - 90, py - 36], [cx + 90, py - 36]], 'support')
    b.ball(cx, py, R)
    const l = rng.range(70, 110)
    const r2 = rng.range(110, 160)
    const m1 = b.block(cx - R, py + l + 30, 70, 60)
    const m2 = b.block(cx + R, py + r2 + 30, 70, 60)
    b.rope(m1, m1, [cx - R, py + 4], [cx - R, py + l])
    b.rope(m2, m2, [cx + R, py + 4], [cx + R, py + r2])
    b.edges.length = 0
    b.expect = { kind: 'gap', what: 'pulley' }
    return b
  },
}

export const MECH_SITUATIONS: MechSituation[] = [
  blockOnGround,
  ballOnGround,
  ballFalls,
  wedgeRamp(30, true, 'A block on a 30° ramp'),
  wedgeRamp(45, false, 'A block on a 45° ramp (rising to the left)'),
  wedgeRamp(20, true, 'A block on a 20° ramp'),
  springHoriz,
  springVertical,
  pendulumRod,
  pendulumRope,
  twoBlocksRope,
  twoBlocksSpring,
  pushedBlock('right'),
  pushedBlock('left'),
  projectile,
  rampForce,
  betweenWalls,
  hangingFromSpringWithGround,
  ballOnRamp,
  doublePendulum,
  ropeToWallRamp,
  atwood,
]

export function makeMechScene(i: number, seed: number, device: 'mouse' | 'touchpad' | 'finger' | 'pen' = 'mouse', offset: Pt = [0, 0]): MechScene {
  const sit = MECH_SITUATIONS[i % MECH_SITUATIONS.length]
  const rng = makeRng(seed * 1000 + i)
  const w = makeWriter(rng.fork('w'), `mech-${seed}-${i}`, device)
  return drawMechScene(sit, rng.fork('s'), w, offset)
}
