// Block-diagram simulation: the same idea as Simulink, in a few hundred lines.
//
// A diagram of blocks and wires is not only a picture here — it RUNS. Sources,
// gains, sums, integrators, transfer functions, PID controllers, delays and
// saturation are wired together (feedback included), the whole system is
// integrated in time with RK4, and the reader watches the signal on every wire
// while the scopes draw their traces. The drawing is laid out by the same
// engine that draws text diagrams (lib/scene/diagram.ts), so a block diagram
// in a lesson looks like every other diagram in the app.
//
// Syntax, one statement per line:
//   r:  step(1)              a source
//   e:  sum(+-)              signs of the incoming wires, in the order they are wired
//   k:  gain(2)
//   g:  tf(1 ; 1 1)          numerator ; denominator, descending powers of s
//   y:  scope                records its input
//   r -> e -> k -> g -> y    wires (chains allowed)
//   g -> e                   a second wire into e (the feedback path)
//
// Blocks: const step ramp sine pulse | gain sum mult | integrator tf pid delay sat | scope

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, fmt, pnum, pstr } from '../types'
import { heading, makePlot, poly, toneAt, trace, txt, line } from '../draw'
import { layoutDiagram, type DiagramAst, type PlacedEdge, type PlacedNode } from '../../scene/diagram'

const G = 'Systems & control'

interface Block { id: string; type: string; args: number[]; extra: string; label: string }
interface Wire { from: string; to: string }

const DEFAULT = `# unity-feedback loop around a first-order plant: G(s) = 1/(s+1)
r: step(1)
e: sum(+-)
k: gain(2)
g: tf(1 ; 1 1)
y: scope
r -> e -> k -> g -> y
g -> e`

export function parseBlocks(src: string): { blocks: Block[]; wires: Wire[] } {
  const blocks = new Map<string, Block>(), wires: Wire[] = []
  src.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.replace(/(?:#|\/\/).*$/, '').trim()
    if (!l) return
    const decl = /^([A-Za-z_]\w*)\s*:\s*([a-z]+)\s*(?:\((.*)\))?\s*$/.exec(l)
    if (decl) {
      const [, id, type, rawArgs = ''] = decl
      if (!['const', 'step', 'ramp', 'sine', 'pulse', 'gain', 'sum', 'mult', 'integrator', 'tf', 'pid', 'delay', 'sat', 'scope'].includes(type)) throw new LabError(`line ${i + 1}: unknown block "${type}" — const step ramp sine pulse gain sum mult integrator tf pid delay sat scope`)
      const extra = type === 'sum' ? rawArgs.replace(/[^+-]/g, '') : rawArgs
      const args = type === 'sum' || type === 'tf' ? [] : rawArgs.split(/[,\s]+/).filter(Boolean).map(Number)
      if (args.some((v) => !Number.isFinite(v))) throw new LabError(`line ${i + 1}: the arguments of ${type} must be numbers`)
      blocks.set(id, { id, type, args, extra, label: '' })
      return
    }
    if (l.includes('->')) {
      const chain = l.split('->').map((s) => s.trim())
      if (chain.some((c) => !c)) throw new LabError(`line ${i + 1}: a wire is missing one of its ends`)
      for (let k = 0; k < chain.length - 1; k++) wires.push({ from: chain[k], to: chain[k + 1] })
      return
    }
    throw new LabError(`line ${i + 1}: "${l}" — write  name: type(args)  or  a -> b`)
  })
  for (const w of wires) for (const id of [w.from, w.to]) if (!blocks.has(id)) throw new LabError(`wire uses "${id}", which is not declared (declare it as  ${id}: gain(1)  etc.)`)
  return { blocks: [...blocks.values()], wires }
}

const nums = (s: string) => s.split(/[\s,]+/).filter(Boolean).map(Number)

interface Sim { t: number[]; out: Map<string, number[]> }

export function simulate(blocks: Block[], wires: Wire[], T: number, dt: number): Sim & { order: string[] } {
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const inputs = new Map<string, string[]>(blocks.map((b) => [b.id, []]))
  for (const w of wires) inputs.get(w.to)!.push(w.from)
  // States per block and the shape of each stateful block.
  interface TF { A: number[]; B: number[]; C: number[]; D: number; n: number }
  const tfs = new Map<string, TF>()
  for (const b of blocks) if (b.type === 'tf') {
    const [nu, de] = b.extra.split(';').map((s) => s.trim())
    if (!de) throw new LabError(`${b.id}: tf needs  tf(numerator ; denominator), e.g. tf(1 ; 1 1)`)
    let num = nums(nu), den = nums(de)
    if (num.some((v) => !Number.isFinite(v)) || den.some((v) => !Number.isFinite(v)) || den.length < 2 || den[0] === 0) throw new LabError(`${b.id}: the denominator needs at least two coefficients, leading one non-zero`)
    if (num.length > den.length) throw new LabError(`${b.id}: the transfer function is improper (numerator degree exceeds denominator)`)
    const a0 = den[0]; den = den.map((v) => v / a0); num = num.map((v) => v / a0)
    const n = den.length - 1
    num = [...Array(den.length - num.length).fill(0), ...num]
    const D = num[0]
    // controllable canonical form
    const A = Array(n * n).fill(0); for (let i = 0; i < n - 1; i++) A[i * n + i + 1] = 1
    for (let j = 0; j < n; j++) A[(n - 1) * n + j] = -den[n - j]
    const B = Array(n).fill(0); B[n - 1] = 1
    const C = Array.from({ length: n }, (_, j) => num[n - j] - D * den[n - j])
    tfs.set(b.id, { A, B, C, D, n })
  }
  const stateSize = (b: Block) => (b.type === 'integrator' ? 1 : b.type === 'tf' ? tfs.get(b.id)!.n : b.type === 'pid' ? 2 : 0)
  const offset = new Map<string, number>(); let N = 0
  for (const b of blocks) { offset.set(b.id, N); N += stateSize(b) }
  const x0 = Array(N).fill(0)
  for (const b of blocks) if (b.type === 'integrator') x0[offset.get(b.id)!] = b.args[0] ?? 0
  const delayLen = new Map(blocks.filter((b) => b.type === 'delay').map((b) => [b.id, Math.max(1, Math.round((b.args[0] ?? 1) / dt))]))
  const bufs = new Map([...delayLen].map(([id, n]) => [id, Array(n).fill(0)]))

  // Evaluation order: a block's inputs first, except that a block with NO direct
  // feedthrough (integrator, strictly proper tf, pid's integral part isn't — pid has
  // proportional feedthrough) breaks the dependency, which is what lets feedback loops work.
  const feedthrough = (b: Block) => !(b.type === 'integrator' || b.type === 'delay' || (b.type === 'tf' && tfs.get(b.id)!.D === 0))
  const order: string[] = []; const state = new Map<string, 0 | 1 | 2>()
  const visit = (id: string, path: string[]) => {
    const s = state.get(id) ?? 0
    if (s === 2) return
    if (s === 1) throw new LabError(`algebraic loop through ${[...path.slice(path.indexOf(id)), id].join(' → ')}: a feedback loop needs an integrator, transfer function or delay in it`)
    state.set(id, 1)
    const b = byId.get(id)!
    if (feedthrough(b)) for (const src of inputs.get(id)!) visit(src, [...path, id])
    state.set(id, 2); order.push(id)
  }
  for (const b of blocks) visit(b.id, [])

  const source = (b: Block, t: number): number => {
    const [a = 1, p1 = 0, p2 = 0] = b.args
    switch (b.type) {
      case 'const': return a
      case 'step': return t >= p1 ? a : 0
      case 'ramp': return a * Math.max(0, t - p1)
      case 'sine': return a * Math.sin(2 * Math.PI * (p1 || 1) * t + p2)
      case 'pulse': { const per = p1 || 1, duty = p2 || 0.5; return (t % per) < per * duty ? a : 0 }
    }
    return 0
  }
  const outputs = (x: number[], t: number, bufOut: Map<string, number>) => {
    const y = new Map<string, number>()
    const u = (b: Block, k = 0) => y.get(inputs.get(b.id)![k]) ?? 0
    for (const id of order) {
      const b = byId.get(id)!
      let v = 0
      switch (b.type) {
        case 'const': case 'step': case 'ramp': case 'sine': case 'pulse': v = source(b, t); break
        case 'gain': v = (b.args[0] ?? 1) * u(b); break
        case 'sum': v = inputs.get(id)!.reduce((s, _, k) => s + (b.extra[k] === '-' ? -1 : 1) * u(b, k), 0); break
        case 'mult': v = inputs.get(id)!.reduce((p, _, k) => p * u(b, k), 1); break
        case 'integrator': v = x[offset.get(id)!]; break
        case 'tf': { const m = tfs.get(id)!; const o = offset.get(id)!; v = m.C.reduce((s, c, j) => s + c * x[o + j], 0) + m.D * u(b); break }
        case 'pid': { const [kp = 1, ki = 0, kd = 0] = b.args; const o = offset.get(id)!; const e = u(b); const N = 20; const dv = kd ? N * (e - x[o + 1]) : 0; v = kp * e + ki * x[o] + kd * dv; break }
        case 'delay': v = bufOut.get(id) ?? 0; break
        case 'sat': { const [lo = -1, hi = 1] = b.args; v = Math.min(hi, Math.max(lo, u(b))); break }
        case 'scope': v = u(b); break
      }
      y.set(id, v)
    }
    return y
  }
  const deriv = (x: number[], t: number, bufOut: Map<string, number>) => {
    const y = outputs(x, t, bufOut), d = Array(N).fill(0)
    for (const b of blocks) {
      const o = offset.get(b.id)!, inp = y.get(inputs.get(b.id)![0]) ?? 0
      if (b.type === 'integrator') d[o] = inp
      else if (b.type === 'tf') { const m = tfs.get(b.id)!; for (let i = 0; i < m.n; i++) d[o + i] = m.A.slice(i * m.n, (i + 1) * m.n).reduce((s, a, j) => s + a * x[o + j], 0) + m.B[i] * inp }
      else if (b.type === 'pid') { d[o] = inp; d[o + 1] = 20 * (inp - x[o + 1]) }
    }
    return d
  }
  const steps = Math.round(T / dt)
  const t: number[] = [], rec = new Map<string, number[]>(blocks.map((b) => [b.id, []]))
  let x = [...x0]
  for (let k = 0; k <= steps; k++) {
    const tt = k * dt
    const bufOut = new Map([...bufs].map(([id, b]) => [id, b[0]]))
    const y = outputs(x, tt, bufOut)
    t.push(tt); for (const [id, v] of y) rec.get(id)!.push(v)
    if (k === steps) break
    const f1 = deriv(x, tt, bufOut)
    const x2 = x.map((v, i) => v + (dt / 2) * f1[i]), f2 = deriv(x2, tt + dt / 2, bufOut)
    const x3 = x.map((v, i) => v + (dt / 2) * f2[i]), f3 = deriv(x3, tt + dt / 2, bufOut)
    const x4 = x.map((v, i) => v + dt * f3[i]), f4 = deriv(x4, tt + dt, bufOut)
    x = x.map((v, i) => v + (dt / 6) * (f1[i] + 2 * f2[i] + 2 * f3[i] + f4[i]))
    for (const [id, b] of bufs) { b.shift(); b.push(y.get(inputs.get(id)![0]) ?? 0) }
  }
  if (!x.every(Number.isFinite)) throw new LabError('the simulation blew up (values became infinite) — the loop is unstable or the gains are too large')
  return { t, out: rec, order }
}

/** Step-response figures of merit for a signal that starts at 0 and settles. */
export function stepMetrics(t: number[], y: number[]) {
  const fin = y[y.length - 1], peak = Math.max(...y)
  const overshoot = fin > 1e-9 ? Math.max(0, ((peak - fin) / fin) * 100) : 0
  const at = (frac: number) => { const i = y.findIndex((v) => v >= frac * fin); return i < 0 ? NaN : t[i] }
  const rise = fin > 1e-9 ? at(0.9) - at(0.1) : NaN
  let settle = 0; for (let i = y.length - 1; i >= 0; i--) if (Math.abs(y[i] - fin) > 0.02 * Math.abs(fin || 1)) { settle = t[Math.min(i + 1, t.length - 1)]; break }
  return { final: fin, overshoot, rise, settle }
}

/** [1, 0.4, 1] → "s²+0.4s+1" */
const polyText = (c: number[]): string => {
  const n = c.length - 1
  const sup = ['', '', '²', '³', '⁴', '⁵', '⁶']
  const terms = c.map((v, i) => ({ v, p: n - i })).filter((t) => t.v !== 0).map((t, i) => {
    const mag = Math.abs(t.v), sign = t.v < 0 ? '−' : i === 0 ? '' : '+'
    const body = t.p === 0 ? fmt(mag, 3) : `${mag === 1 ? '' : fmt(mag, 3)}s${t.p === 1 ? '' : sup[t.p] ?? `^${t.p}`}`
    return sign + body
  })
  return terms.join('') || '0'
}

const LABEL = (b: Block): string => {
  switch (b.type) {
    case 'sum': return 'Σ'
    case 'gain': return `${fmt(b.args[0] ?? 1, 3)}`
    case 'mult': return '×'
    case 'integrator': return '1/s'
    case 'step': return `step ${fmt(b.args[0] ?? 1, 3)}`
    case 'const': return `${fmt(b.args[0] ?? 1, 3)}`
    case 'ramp': return `ramp ${fmt(b.args[0] ?? 1, 3)}`
    case 'sine': return `sin ${fmt(b.args[0] ?? 1, 2)}`
    case 'pulse': return 'pulse'
    case 'tf': { const [nu, de] = b.extra.split(';'); const d = polyText(nums(de ?? '')); return `${polyText(nums(nu ?? ''))}/${/[+−]/.test(d) ? `(${d})` : d}` }
    case 'pid': return `PID ${b.args.map((v) => fmt(v, 2)).join(',')}`
    case 'delay': return `delay ${fmt(b.args[0] ?? 1, 2)}s`
    case 'sat': return `sat ${b.args.join('…') || '±1'}`
    default: return b.id
  }
}

function blocksRun(p: Params) {
  const { blocks, wires } = parseBlocks(pstr(p, 'blocks', DEFAULT))
  if (blocks.length === 0) throw new LabError('declare at least one block')
  const T = pnum(p, 'time', 8), dt = pnum(p, 'dt', 0.01), nFrames = Math.max(4, Math.min(60, pnum(p, 'frames', 24)))
  if (T <= 0 || dt <= 0 || T / dt > 200000) throw new LabError('time and dt must be positive, and time/dt at most 200000')
  const sim = simulate(blocks, wires, T, dt)
  const plotIds = pstr(p, 'plot', '').split(/[\s,]+/).filter(Boolean)
  const traced = (plotIds.length ? plotIds : blocks.filter((b) => b.type === 'scope').map((b) => b.id))
  if (!traced.length) throw new LabError('add a scope block (y: scope) and wire a signal into it, or name blocks in "plot"')
  for (const id of traced) if (!sim.out.has(id)) throw new LabError(`plot names "${id}", which is not a block`)

  // The diagram, laid out left→right by the same engine that draws text diagrams.
  const ast: DiagramAst = {
    direction: 'right',
    nodes: blocks.map((b) => ({ id: b.id, label: LABEL(b), shape: b.type === 'sum' || b.type === 'mult' ? 'circle' : b.type === 'scope' ? 'round' : 'box', accent: b.type === 'scope' ? 'violet' : ['step', 'const', 'ramp', 'sine', 'pulse'].includes(b.type) ? 'mint' : b.type === 'sum' || b.type === 'mult' ? 'amber' : undefined })),
    edges: wires.map((w) => ({ from: w.from, to: w.to, style: 'arrow' as const })), groups: [], errors: [], mode: 'flow', anims: [], loop: 0,
  }
  const lay = layoutDiagram(ast)
  const maxW = 600, sc = Math.min(1, maxW / Math.max(lay.width, 1), 0.85)
  const dh = lay.height * sc + 20
  const plotY = dh + 44, plotH = 150
  const W = Math.max(640, lay.width * sc + 60), H = plotY + plotH + 60
  const ox = 20, oy = 34
  const X = (v: number) => ox + v * sc, Yy = (v: number) => oy + v * sc
  const all = traced.flatMap((id) => sim.out.get(id)!)
  const lo = Math.min(0, ...all), hi = Math.max(...all, 1e-6) * 1.15
  const pl = makePlot(50, plotY, W - 110, plotH, 0, T, lo, hi, { yticks: 4 })
  const idx = (f: number) => Math.min(sim.t.length - 1, Math.round(f * (sim.t.length - 1)))
  const frames: Frame[] = []
  for (let f = 0; f <= nFrames; f++) {
    const k = idx(f / nFrames), tk = sim.t[k]
    const d: Prim[] = [heading(20, 14, `Block diagram simulation · t = ${fmt(tk, 2)} s`)]
    for (const e of lay.edges) {
      const pts = [e.a, ...e.bends, e.b].map((q) => [X(q.x), Yy(q.y)])
      const v = sim.out.get(e.from)![k], mag = Math.min(1, Math.abs(v) / (Math.max(...sim.out.get(e.from)!.map(Math.abs)) || 1))
      d.push(poly(pts, mag > 0.02 ? 'mint' : 'dim', { arrow: true, w: 1.4 + mag * 1.6 }))
      const m = pts[Math.floor(pts.length / 2)], m2 = pts[Math.max(0, Math.floor(pts.length / 2) - 1)]
      d.push(txt((m[0] + m2[0]) / 2, (m[1] + m2[1]) / 2 - 5, fmt(v, 3), { size: 10, mono: true, anchor: 'middle', tone: 'amber', bold: true }))
    }
    for (const n of lay.nodes) {
      const b = blocks.find((q) => q.id === n.id)!
      const tone: Tone = b.type === 'scope' ? 'violet' : b.type === 'sum' || b.type === 'mult' ? 'amber' : ['step', 'const', 'ramp', 'sine', 'pulse'].includes(b.type) ? 'mint' : 'blue'
      if (n.shape === 'circle') d.push({ k: 'circle', x: X(n.x + n.w / 2), y: Yy(n.y + n.h / 2), r: (n.w * sc) / 2, text: LABEL(b), tone })
      else d.push({ k: 'rect', x: X(n.x), y: Yy(n.y), w: n.w * sc, h: n.h * sc, text: LABEL(b), tone, r: n.shape === 'round' ? 999 : 8 })
      d.push(txt(X(n.x + n.w / 2), Yy(n.y) - 4, b.id, { size: 9, anchor: 'middle', tone: 'dim', mono: true }))
    }
    d.push(...pl.axes)
    traced.forEach((id, i) => { const y = sim.out.get(id)!; const pts: number[][] = []; for (let q = 0; q <= k; q += Math.max(1, Math.floor(sim.t.length / 400))) pts.push([pl.X(sim.t[q]), pl.Y(y[q])]); pts.push([pl.X(tk), pl.Y(y[k])]); d.push(poly(pts, toneAt(i), { w: 2 })); d.push(txt(pl.x0 + pl.w + 8, pl.Y(y[k]) + 4, `${id} ${fmt(y[k], 3)}`, { size: 10.5, mono: true, tone: toneAt(i) })) })
    d.push(line(pl.X(tk), pl.y0, pl.X(tk), pl.y0 + pl.h, 'dim', { dash: true, w: 0.8 }))
    frames.push({ draw: d, note: f === 0 ? 'Every wire carries a signal. Press ▶: the simulator integrates the whole loop; each wire shows its current value and the scope draws the history.' : `t = ${fmt(tk, 2)} s: ${traced.map((id) => `${id} = ${fmt(sim.out.get(id)![k], 3)}`).join(', ')}.` })
  }
  const first = sim.out.get(traced[0])!
  const m = stepMetrics(sim.t, first)
  const summary: Record<string, string> = { final: fmt(m.final, 4), overshoot: fmt(m.overshoot, 1), rise: fmt(m.rise, 3), settling: fmt(m.settle, 2), order: sim.order.join(' ') }
  for (const id of traced) summary[`${id}_final`] = fmt(sim.out.get(id)![sim.t.length - 1], 4)
  return trace(W, H, frames, summary)
}

export const BLOCK_ENGINES: EngineDef[] = [
  { id: 'blocks', label: 'Block diagram simulator', group: G, blurb: 'Wire sources, gains, sums, integrators, transfer functions and PID controllers — feedback included — and watch the signals run.',
    params: [
      { name: 'blocks', label: 'Diagram', hint: 'name: type(args) … and  a -> b -> c', def: DEFAULT, long: true },
      { name: 'time', label: 'Duration (s)', hint: '', def: '8' },
      { name: 'dt', label: 'Step (s)', hint: 'integration step', def: '0.01' },
      { name: 'plot', label: 'Trace', hint: 'block names to plot (default: the scopes)', def: '', optional: true },
      { name: 'frames', label: 'Frames', hint: '4–60', def: '24' },
    ],
    run: blocksRun },
]

void ((_: PlacedNode | PlacedEdge) => 0)
