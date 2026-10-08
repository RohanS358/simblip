// Circuit part renderer — one source of truth for a part's drawing AND pins.
//
// The old glyphs were hand-drawn paths in a fixed 96×48 viewBox while pins
// were bbox fractions in engine.ts; any resize that wasn't 2:1 letterboxed the
// drawing away from its pins. Here the SVG is in REAL pixels (viewBox = w×h),
// pins come from terminalsOf() (the same list the solver wires to), and every
// pin gets a lead drawn from the pin to the body — so the pin, its lead and
// the wire that lands on it are the same point at any size.
//
// Each body is a function of the body box (the part minus lead room), so a
// resistor lengthens, a circle stays round, a gate gains inputs — none of it
// stretches. Add a part = one entry in ARTS (+ its terminals in engine.ts).

import type { ReactNode } from 'react'
import type { SceneObject } from '@/lib/scene/types'
import { terminalsOf } from '@/lib/circuit/engine'

type Side = 'l' | 'r' | 't' | 'b'

export interface PartPin {
  i: number
  x: number
  y: number
  side: Side
  name?: string
}

export interface PartCtx {
  w: number
  h: number
  /** Body box: the part minus lead room on every side that has a pin. */
  x0: number
  y0: number
  x1: number
  y1: number
  bw: number
  bh: number
  cx: number
  cy: number
  pins: PartPin[]
  /** Input count / model of variable parts (gates, mux, register…). */
  n: number
  num: (name: string, fallback: number) => number
}

interface Art {
  body: (c: PartCtx) => ReactNode
  /** Where a pin's lead ends: x for l/r pins, y for t/b pins. Default = body box edge. */
  contact?: (c: PartCtx, p: PartPin) => number
  /** Body draws its own leads (ground, probes, transistors…). */
  noLeads?: boolean
}

// ── pin geometry ────────────────────────────────────────────────────────────

/** Which side a pin leaves from. Interior pins leave by their NEAREST edge. */
function sideOf(fx: number, fy: number): Side {
  if (fx <= 0.05) return 'l'
  if (fx >= 0.95) return 'r'
  if (fy <= 0.05) return 't'
  if (fy >= 0.95) return 'b'
  const d: [number, Side][] = [[fx, 'l'], [1 - fx, 'r'], [fy, 't'], [1 - fy, 'b']]
  return d.reduce((a, b) => (b[0] < a[0] ? b : a))[1]
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const PAD = 2

// Pin names for the labelled (IC-style) parts, in terminal order.
function pinNames(sym: string, n: number): string[] {
  switch (sym) {
    case 'd-ff': return ['D', 'CLK', 'Q']
    case 't-ff': return ['T', 'CLK', 'Q']
    case 'jk-ff': return ['J', 'CLK', 'K', 'Q']
    case 'sr-latch': return ['S', 'R', 'Q']
    case 'half-adder': return ['A', 'B', 'S', 'C']
    case 'full-adder': return ['A', 'B', 'Cin', 'S', 'Cout']
    case 'comparator': return ['A', 'B', '<', '=', '>']
    case 'tristate': return ['A', 'EN', 'Y']
    case 'mux': return n === 4 ? ['0', '1', '2', '3', 'S0', 'S1', 'Y'] : ['0', '1', 'S', 'Y']
    case 'demux': return n === 4 ? ['in', 'S0', 'S1', '0', '1', '2', '3'] : ['in', 'S', '0', '1']
    case 'decoder':
      return n === 3
        ? ['A', 'B', 'C', ...Array.from({ length: 8 }, (_, i) => `Y${i}`)]
        : ['A', 'B', 'Y0', 'Y1', 'Y2', 'Y3']
    case 'encoder':
      return n === 8
        ? [...Array.from({ length: 8 }, (_, i) => `${i}`), 'Y0', 'Y1', 'Y2']
        : ['0', '1', '2', '3', 'Y0', 'Y1']
    case 'register4':
      return n === 1 ? ['SIN', 'CLK', 'Q0', 'Q1', 'Q2', 'Q3']
        : n === 2 ? ['D0', 'D1', 'D2', 'D3', 'LD', 'CLK', 'SOUT']
        : n === 3 ? ['D0', 'D1', 'D2', 'D3', 'CLK', 'Q0', 'Q1', 'Q2', 'Q3']
        : ['SIN', 'CLK', 'SOUT']
    case 'counter4': return ['CLK', 'Q0', 'Q1', 'Q2', 'Q3']
    case 'bcd-7seg': return ['A', 'B', 'C', 'D', 'a', 'b', 'c', 'd', 'e', 'f', 'g']
    case 'seven-seg': return ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    case 'dc-machine': case 'battery': case 'ac-source': case 'current-source': return ['+', '−']
    case 'diode': case 'led': case 'zener': return ['A', 'K']
    case 'bjt': case 'bjt-pnp': return ['B', 'C', 'E']
    case 'mosfet': case 'mosfet-pmos': return ['G', 'D', 'S']
    case 'opamp': return ['+', '−', 'out']
    default: return []
  }
}

// ── tiny drawing helpers ────────────────────────────────────────────────────

const FONT = 'var(--font-jakarta)'
function T(x: number, y: number, size: number, s: string, anchor: 'start' | 'middle' | 'end' = 'middle') {
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" fontSize={size} stroke="none" fill="var(--foreground)" fontFamily={FONT}>
      {s}
    </text>
  )
}

const rad = (c: PartCtx) => Math.max(6, Math.min(c.bw, c.bh) / 2 - 1)

/** Lead ends where the circle's edge is at the pin's height / column. */
function circleContact(c: PartCtx, p: PartPin): number {
  const r = rad(c)
  if (p.side === 'l' || p.side === 'r') {
    const dy = p.y - c.cy
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy))
    return p.side === 'l' ? c.cx - dx : c.cx + dx
  }
  const dx = p.x - c.cx
  const dy = Math.sqrt(Math.max(0, r * r - dx * dx))
  return p.side === 't' ? c.cy - dy : c.cy + dy
}

const circle = (c: PartCtx, extra?: ReactNode) => (
  <>
    <circle cx={c.cx} cy={c.cy} r={rad(c)} />
    {extra}
  </>
)

/** Two-sided contact for series parts whose pins touch a centred feature. */
const at = (l: (c: PartCtx) => number, r: (c: PartCtx) => number) => (c: PartCtx, p: PartPin) =>
  p.side === 'l' ? l(c) : r(c)

// Rectangular IC body with pin names inside the leads.
function icBody(label: string, opts: { clock?: boolean } = {}) {
  return (c: PartCtx) => {
    const lbl = (p: PartPin) => {
      if (!p.name) return null
      const clk = p.name === 'CLK'
      const sp = c.pins.filter((q) => q.side === p.side).length
      const gap = p.side === 'l' || p.side === 'r' ? c.bh / Math.max(1, sp) : c.bw / Math.max(1, sp)
      if (gap < 9) return null
      if (clk && p.side === 'l')
        return <path key={p.i} d={`M${c.x0} ${p.y - 4} L${c.x0 + 7} ${p.y} L${c.x0} ${p.y + 4}`} />
      if (p.side === 'l') return <g key={p.i}>{T(c.x0 + 5, p.y, 8.5, p.name, 'start')}</g>
      if (p.side === 'r') return <g key={p.i}>{T(c.x1 - 5, p.y, 8.5, p.name, 'end')}</g>
      if (p.side === 't') return <g key={p.i}>{T(p.x, c.y0 + 8, 8.5, p.name)}</g>
      return <g key={p.i}>{T(p.x, c.y1 - 8, 8.5, p.name)}</g>
    }
    void opts
    return (
      <>
        <rect x={c.x0} y={c.y0} width={c.bw} height={c.bh} rx={4} />
        {c.pins.map(lbl)}
        {(c.bw >= 78 || !c.pins.some((p) => p.name)) && T(c.cx, c.cy, clamp(c.bh * 0.28, 9, 13), label)}
      </>
    )
  }
}

// Gate shapes. `back` = how far the concave back of OR/XOR bites in.
function andPath(c: PartCtx, x1 = c.x1) {
  const r = Math.min(c.bh / 2, (x1 - c.x0) * 0.6)
  return `M${c.x0} ${c.y0} H${x1 - r} A${r} ${c.bh / 2} 0 0 1 ${x1 - r} ${c.y1} H${c.x0} Z`
}
const orDepth = (c: PartCtx) => c.bw * 0.14
function orPath(c: PartCtx, xs = c.x0, x1 = c.x1) {
  const d = orDepth(c)
  const mid = xs + (x1 - xs) * 0.5
  return `M${xs} ${c.y0} Q${mid} ${c.y0} ${x1} ${c.cy} Q${mid} ${c.y1} ${xs} ${c.y1} Q${xs + 2 * d} ${c.cy} ${xs} ${c.y0} Z`
}
/** x of the OR back curve at a pin's height. */
function orBack(c: PartCtx, p: PartPin, xs: number) {
  const t = (p.y - c.y0) / c.bh
  return xs + 4 * orDepth(c) * t * (1 - t)
}
const BUB = 4
const bubble = (x: number, y: number) => <circle cx={x} cy={y} r={BUB} />

function sevenSeg(c: PartCtx) {
  const gx0 = c.x0 + c.bw * 0.34
  const gx1 = c.x1 - c.bw * 0.1
  const gy0 = c.y0 + c.bh * 0.07
  const gy1 = c.y1 - c.bh * 0.07
  const gm = (gy0 + gy1) / 2
  const i = Math.min((gx1 - gx0) * 0.12, 4)
  const segs = [
    `M${gx0 + i} ${gy0}H${gx1 - i}`,
    `M${gx1} ${gy0 + i}V${gm - i / 2}`,
    `M${gx1} ${gm + i / 2}V${gy1 - i}`,
    `M${gx0 + i} ${gy1}H${gx1 - i}`,
    `M${gx0} ${gm + i / 2}V${gy1 - i}`,
    `M${gx0} ${gy0 + i}V${gm - i / 2}`,
    `M${gx0 + i} ${gm}H${gx1 - i}`,
  ]
  return (
    <>
      <rect x={c.x0} y={c.y0} width={c.bw} height={c.bh} rx={4} />
      {c.pins.map((p) => (p.name && c.bh / 7 >= 9 ? <g key={p.i}>{T(c.x0 + 5, p.y, 8.5, p.name, 'start')}</g> : null))}
      {segs.map((d, k) => (
        <path
          key={k}
          data-pin={k}
          d={d}
          strokeWidth={Math.max(3, Math.min(6, c.bh / 14))}
          className="opacity-15 transition-opacity duration-100 data-[state='1']:opacity-100"
          stroke="var(--accent-mint)"
        />
      ))}
    </>
  )
}

function zigzag(x0: number, x1: number, cy: number, amp: number, teeth = 6) {
  const s = Math.min((x1 - x0) * 0.1, 8)
  const a = x0 + s
  const seg = (x1 - x0 - 2 * s) / teeth
  let d = `M${x0} ${cy}H${a}`
  for (let k = 0; k < teeth; k++) d += `L${a + (k + 0.5) * seg} ${cy + (k % 2 ? amp : -amp)}`
  return d + `L${a + teeth * seg} ${cy}H${x1}`
}

function coil(x: number, y0: number, y1: number, dir: 1 | -1, n = 4) {
  const r = (y1 - y0) / (2 * n)
  let d = `M${x} ${y0}`
  for (let k = 0; k < n; k++) d += `a${r} ${r} 0 0 ${dir === 1 ? 1 : 0} 0 ${2 * r}`
  return <path d={d} />
}

function diodeBody(kind: 'diode' | 'led' | 'zener') {
  return (c: PartCtx) => {
    const s = Math.min(c.bh * 0.38, c.bw * 0.26, 16)
    return (
      <>
        {kind === 'led' && (
          <circle data-glow="" cx={c.cx} cy={c.cy} r={s * 1.8} fill="var(--accent-amber)" stroke="none" style={{ opacity: 0, transition: 'opacity 120ms linear' }} />
        )}
        <path d={`M${c.cx - s} ${c.cy - s}V${c.cy + s}L${c.cx + s} ${c.cy}Z`} />
        <path
          d={
            kind === 'zener'
              ? `M${c.cx + s + 4} ${c.cy - s - 3}L${c.cx + s} ${c.cy - s}V${c.cy + s}L${c.cx + s - 4} ${c.cy + s + 3}`
              : `M${c.cx + s} ${c.cy - s}V${c.cy + s}`
          }
        />
        {kind === 'led' && (
          <g strokeWidth={1.4}>
            <path d={`M${c.cx - 2} ${c.cy - s - 3}l7 -6M${c.cx + 4} ${c.cy - s}l7 -6`} />
          </g>
        )}
      </>
    )
  }
}
const diodeContact = at((c) => c.cx - Math.min(c.bh * 0.38, c.bw * 0.26, 16), (c) => c.cx + Math.min(c.bh * 0.38, c.bw * 0.26, 16))

function depSource(letter: string): Art {
  return {
    body: (c) => (
      <>
        <path d={`M${c.x0} ${c.cy}L${c.cx} ${c.y0}L${c.x1} ${c.cy}L${c.cx} ${c.y1}Z`} />
        <path d={`M${c.x0} ${c.pins[0].y}V${c.pins[1].y}M${c.x1} ${c.pins[2].y}V${c.pins[3].y}`} />
        {T(c.cx, c.cy + 1, clamp(c.bh * 0.3, 10, 16), letter)}
      </>
    ),
  }
}

// MOSFET / BJT lay out from the real pin positions: gate on the left, D/S
// pins on top/bottom at p.x — so their leads drop straight onto the channel.
function mosfet(pmos: boolean): Art {
  return {
    noLeads: true,
    body: (c) => {
      const [g, d, s] = c.pins
      const chx = Math.min(d.x - 14, c.cx - 2) // channel column
      const gx = chx - 6 // gate plate
      const q = c.bh * 0.3
      const yd = c.cy - q
      const ys = c.cy + q
      const bub = pmos ? 4 : 0
      return (
        <>
          <path d={`M${g.x} ${g.y}H${gx - bub * 2}`} />
          {pmos && bubble(gx - bub, g.y)}
          <path d={`M${gx} ${c.cy - q - 6}V${c.cy + q + 6}`} />
          <path d={`M${chx} ${yd - 5}V${yd + 5}M${chx} ${c.cy - 5}V${c.cy + 5}M${chx} ${ys - 5}V${ys + 5}`} />
          <path d={`M${d.x} ${d.y}V${yd}H${chx}M${s.x} ${s.y}V${ys}H${chx}`} />
          <path d={`M${chx} ${c.cy}H${s.x}`} opacity={0.0} />
          {/* body arrow on the source arm */}
          <path d={pmos ? `M${chx + 8} ${ys - 4}l-6 4 6 4` : `M${chx + 2} ${ys - 4}l6 4 -6 4`} />
        </>
      )
    },
  }
}

/** Arrowhead with its tip at (x, y), pointing along (dx, dy). */
function head(x: number, y: number, dx: number, dy: number, size = 7) {
  const l = Math.hypot(dx, dy) || 1
  const ux = dx / l
  const uy = dy / l
  const a = 0.45
  const p = (t: number) => [x - size * (ux * Math.cos(t) - uy * Math.sin(t)), y - size * (uy * Math.cos(t) + ux * Math.sin(t))]
  const [x1, y1] = p(a)
  const [x2, y2] = p(-a)
  return `M${x1} ${y1}L${x} ${y}L${x2} ${y2}`
}

function bjt(pnp: boolean): Art {
  return {
    noLeads: true,
    body: (c) => {
      const [b, co, e] = c.pins
      const barX = co.x - 10
      const q = c.h * 0.2
      const yc = c.cy - c.h * 0.17 // where the collector/emitter arms meet the pin columns
      const ye = c.cy + c.h * 0.17
      const R = Math.min(Math.min(c.h, c.w) * 0.38, c.w - barX - 2)
      const arm = (y: number) => `L${co.x} ${y}`
      // emitter arm runs bar → (e.x, ye); arrow on it
      const ex0 = barX
      const ey0 = c.cy + q * 0.45
      const dx = e.x - ex0
      const dy = ye - ey0
      return (
        <>
          <circle cx={barX + 6} cy={c.cy} r={R} />
          <path d={`M${b.x} ${b.y}H${barX}`} />
          <path d={`M${barX} ${c.cy - q}V${c.cy + q}`} strokeWidth={3.5} />
          <path d={`M${barX} ${c.cy - q * 0.45}${arm(yc)}V${co.y}`} />
          <path d={`M${ex0} ${ey0}L${e.x} ${ye}V${e.y}`} />
          <path d={pnp ? head(ex0 + dx * 0.3, ey0 + dy * 0.3, -dx, -dy) : head(ex0 + dx * 0.8, ey0 + dy * 0.8, dx, dy)} />
        </>
      )
    },
  }
}

const ARTS: Record<string, Art> = {
  resistor: { body: (c) => <path d={zigzag(c.x0, c.x1, c.cy, Math.min(c.bh * 0.28, 12))} /> },
  capacitor: {
    body: (c) => {
      const H = Math.min(c.bh * 0.7, 34)
      return <path d={`M${c.cx - 4} ${c.cy - H / 2}v${H}M${c.cx + 4} ${c.cy - H / 2}v${H}`} strokeWidth={2.5} />
    },
    contact: at((c) => c.cx - 4, (c) => c.cx + 4),
  },
  inductor: {
    body: (c) => {
      const n = 4
      const r = Math.min(c.bw / (2 * n + 1), c.bh * 0.4)
      const xs = c.cx - n * r
      let d = `M${c.x0} ${c.cy}H${xs}`
      for (let k = 0; k < n; k++) d += `a${r} ${r} 0 0 1 ${2 * r} 0`
      return <path d={d + `H${c.x1}`} />
    },
  },
  battery: {
    body: (c) => {
      const H = Math.min(c.bh * 0.7, 34)
      return (
        <>
          <path d={`M${c.cx - 5} ${c.cy - H / 2}v${H}`} strokeWidth={2.5} />
          <path d={`M${c.cx + 5} ${c.cy - H * 0.3}v${H * 0.6}`} strokeWidth={3.5} />
          {T(c.cx - 12, c.cy - H / 2 - 3, 10, '+')}
        </>
      )
    },
    contact: at((c) => c.cx - 5, (c) => c.cx + 5),
  },
  'ac-source': {
    body: (c) => {
      const r = rad(c)
      return circle(c, <path d={`M${c.cx - r * 0.6} ${c.cy}q${r * 0.3} ${-r * 0.7} ${r * 0.6} 0t${r * 0.6} 0`} />)
    },
    contact: circleContact,
  },
  'current-source': {
    body: (c) => {
      const r = rad(c)
      return circle(c, <path d={`M${c.cx + r * 0.5} ${c.cy}H${c.cx - r * 0.5}M${c.cx - r * 0.5 + 6} ${c.cy - 6}l-6 6 6 6`} />)
    },
    contact: circleContact,
  },
  gnd: {
    noLeads: true,
    body: (c) => {
      const p = c.pins[0]
      const top = p.y
      const span = Math.max(12, c.h - top - 2)
      const y1 = top + span * 0.42
      const w1 = Math.min(c.w * 0.4, 34)
      return (
        <path
          d={`M${p.x} ${top}V${y1}M${p.x - w1 / 2} ${y1}h${w1}M${p.x - w1 * 0.32} ${y1 + span * 0.26}h${w1 * 0.64}M${p.x - w1 * 0.14} ${y1 + span * 0.52}h${w1 * 0.28}`}
        />
      )
    },
  },
  switch: {
    body: (c) => {
      const closed = c.num('closed', 1) >= 0.5
      const px = c.x0 + 4
      const qx = c.x1 - 4
      const tip = closed ? [qx - 3, c.cy] : [qx - c.bw * 0.1, c.cy - c.bh * 0.38]
      return (
        <>
          <path d={`M${c.x0} ${c.cy}H${px - 3}`} />
          <circle cx={px} cy={c.cy} r={3} />
          <circle cx={qx} cy={c.cy} r={3} />
          <path d={`M${qx + 3} ${c.cy}H${c.x1}`} />
          <path d={`M${px + 3} ${c.cy}L${tip[0]} ${tip[1]}`} />
        </>
      )
    },
  },
  'pressure-plate': {
    body: (c) => (
      <>
        <path d={`M${c.x0} ${c.cy}H${c.x0 + 6}M${c.x1 - 6} ${c.cy}H${c.x1}`} />
        <path d={`M${c.x0 + 6} ${c.cy}L${c.x1 - 10} ${c.cy - c.bh * 0.3}`} />
        <circle cx={c.x1 - 9} cy={c.cy} r={3} />
        <path d={`M${c.x0 + 6} ${c.y1}H${c.x1 - 6}`} />
      </>
    ),
  },
  diode: { body: diodeBody('diode'), contact: diodeContact },
  led: { body: diodeBody('led'), contact: diodeContact },
  zener: { body: diodeBody('zener'), contact: diodeContact },
  fuse: {
    body: (c) => {
      const h = Math.min(c.bh * 0.34, 12)
      return (
        <>
          <rect x={c.x0 + c.bw * 0.1} y={c.cy - h} width={c.bw * 0.8} height={h * 2} rx={2} />
          <path d={`M${c.x0} ${c.cy}H${c.x1}`} />
        </>
      )
    },
    contact: at((c) => c.x0 + c.bw * 0.1, (c) => c.x1 - c.bw * 0.1),
  },
  bulb: {
    body: (c) => {
      const r = rad(c) * 0.8
      const k = r * 0.7
      return (
        <>
          <circle data-glow="" cx={c.cx} cy={c.cy} r={r + 2} fill="var(--accent-amber)" stroke="none" style={{ opacity: 0, transition: 'opacity 120ms linear' }} />
          <circle cx={c.cx} cy={c.cy} r={r} />
          <path d={`M${c.cx - k} ${c.cy - k}L${c.cx + k} ${c.cy + k}M${c.cx + k} ${c.cy - k}L${c.cx - k} ${c.cy + k}`} />
        </>
      )
    },
    contact: (c, p) => (p.side === 'l' ? c.cx - rad(c) * 0.8 : c.cx + rad(c) * 0.8),
  },
  voltmeter: { body: (c) => circle(c, T(c.cx, c.cy + 1, clamp(rad(c) * 0.9, 10, 20), 'V')), contact: circleContact },
  ammeter: { body: (c) => circle(c, T(c.cx, c.cy + 1, clamp(rad(c) * 0.9, 10, 20), 'A')), contact: circleContact },
  wattmeter: { body: (c) => circle(c, T(c.cx, c.cy + 1, clamp(rad(c) * 0.9, 10, 20), 'W')), contact: circleContact },
  potentiometer: {
    noLeads: true,
    body: (c) => {
      const [a, w, b] = c.pins
      const lead = Math.min(16, c.w * 0.17)
      const yR = a.y + Math.max(10, c.h * 0.26)
      return (
        <>
          <path d={`M${a.x} ${a.y}V${yR}H${a.x + lead}M${b.x} ${b.y}V${yR}H${b.x - lead}`} />
          <path d={zigzag(a.x + lead, b.x - lead, yR, Math.min(c.h * 0.12, 8), 6)} />
          <path d={`M${w.x} ${w.y}V${yR + 3}M${w.x - 5} ${yR + 10}l5 -8 5 8`} />
        </>
      )
    },
  },
  vcvs: depSource('E'),
  vccs: depSource('G'),
  ccvs: depSource('H'),
  cccs: depSource('F'),
  transformer: {
    body: (c) => {
      const [p1, p2, s1, s2] = c.pins
      const lx = c.cx - 8
      const rx = c.cx + 8
      return (
        <>
          {coil(lx, p1.y, p2.y, -1)}
          {coil(rx, s1.y, s2.y, 1)}
          <path d={`M${c.cx - 2.5} ${c.y0}V${c.y1}M${c.cx + 2.5} ${c.y0}V${c.y1}`} />
        </>
      )
    },
    contact: at((c) => c.cx - 8, (c) => c.cx + 8),
  },
  'transformer-ct': {
    body: (c) => {
      const [p1, p2, s1] = c.pins
      const s3 = c.pins[4]
      const lx = c.cx - 8
      const rx = c.cx + 8
      return (
        <>
          {coil(lx, p1.y, p2.y, -1)}
          {coil(rx, s1.y, s3.y, 1)}
          <path d={`M${c.cx - 2.5} ${c.y0}V${c.y1}M${c.cx + 2.5} ${c.y0}V${c.y1}`} />
        </>
      )
    },
    contact: at((c) => c.cx - 8, (c) => c.cx + 8),
  },
  'three-phase-source': {
    body: (c) => circle(c, T(c.cx, c.cy + 1, clamp(rad(c) * 0.7, 10, 18), '3~')),
    contact: circleContact,
  },
  'dc-machine': {
    body: (c) => {
      const r = rad(c)
      return circle(
        c,
        <>
          <g data-spin="" style={{ transformOrigin: `${c.cx}px ${c.cy}px` }}>
            <line x1={c.cx} y1={c.cy} x2={c.cx} y2={c.cy - r * 0.8} />
          </g>
          {T(c.cx, c.cy + 1, clamp(r * 0.8, 10, 18), 'M')}
        </>
      )
    },
    contact: circleContact,
  },
  'induction-motor': {
    body: (c) => {
      const r = rad(c)
      return circle(
        c,
        <>
          <g data-spin="" style={{ transformOrigin: `${c.cx}px ${c.cy}px` }}>
            <line x1={c.cx} y1={c.cy} x2={c.cx} y2={c.cy - r * 0.75} />
          </g>
          {T(c.cx, c.cy + 1, clamp(r * 0.55, 8, 13), '3~M')}
        </>
      )
    },
    contact: circleContact,
  },
  bjt: bjt(false),
  'bjt-pnp': bjt(true),
  mosfet: mosfet(false),
  'mosfet-pmos': mosfet(true),
  opamp: {
    body: (c) => {
      const [pp, pm] = c.pins
      const k = Math.min(6, c.bw * 0.08)
      return (
        <>
          <path d={`M${c.x0} ${c.y0}V${c.y1}L${c.x1} ${c.cy}Z`} />
          <path d={`M${c.x0 + 5} ${pp.y}h${k}M${c.x0 + 5 + k / 2} ${pp.y - k / 2}v${k}M${c.x0 + 5} ${pm.y}h${k}`} strokeWidth={1.5} />
        </>
      )
    },
    contact: (c, p) => (p.side === 'r' ? c.x1 : c.x0),
  },
  probe: {
    noLeads: true,
    body: (c) => {
      const p = c.pins[0]
      const r = clamp(c.h * 0.17, 5, 9)
      return (
        <>
          <circle cx={p.x} cy={PAD + r} r={r} />
          <path d={`M${p.x} ${PAD + 2 * r}V${p.y}`} />
        </>
      )
    },
  },
  'logic-probe': {
    noLeads: true,
    body: (c) => {
      const p = c.pins[0]
      const bw = clamp(c.w * 0.22, 14, 26)
      const bh = clamp(c.h * 0.3, 10, 16)
      const x = p.x - bw / 2
      return (
        <>
          <rect x={x} y={PAD} width={bw} height={bh} />
          <path d={`M${x + 3} ${PAD + bh - 3}h${bw / 4}v${-bh + 6}h${bw / 4}v${bh - 6}h${bw / 4}`} />
          <path d={`M${p.x} ${PAD + bh}V${p.y}`} />
        </>
      )
    },
  },
  // ── digital ──
  'and-gate': { body: (c) => <path d={andPath(c)} /> },
  'nand-gate': {
    body: (c) => (
      <>
        <path d={andPath(c, c.x1 - 2 * BUB)} />
        {bubble(c.x1 - BUB, c.cy)}
      </>
    ),
  },
  'or-gate': { body: (c) => <path d={orPath(c)} />, contact: (c, p) => (p.side === 'l' ? orBack(c, p, c.x0) : c.x1) },
  'nor-gate': {
    body: (c) => (
      <>
        <path d={orPath(c, c.x0, c.x1 - 2 * BUB)} />
        {bubble(c.x1 - BUB, c.cy)}
      </>
    ),
    contact: (c, p) => (p.side === 'l' ? orBack(c, p, c.x0) : c.x1),
  },
  'xor-gate': {
    body: (c) => {
      const xs = c.x0 + 6
      return (
        <>
          <path d={orPath(c, xs, c.x1)} />
          <path d={`M${c.x0} ${c.y0}Q${c.x0 + 2 * orDepth(c)} ${c.cy} ${c.x0} ${c.y1}`} />
        </>
      )
    },
    contact: (c, p) => (p.side === 'l' ? orBack(c, p, c.x0) : c.x1),
  },
  'not-gate': {
    body: (c) => (
      <>
        <path d={`M${c.x0} ${c.y0}V${c.y1}L${c.x1 - 2 * BUB} ${c.cy}Z`} />
        {bubble(c.x1 - BUB, c.cy)}
      </>
    ),
  },
  input: {
    body: (c) => {
      const on = c.num('value', 0) >= 0.5
      return (
        <>
          <rect x={c.x0} y={c.y0 + c.bh * 0.12} width={c.bw} height={c.bh * 0.76} rx={6} />
          {T(c.cx, c.cy, clamp(c.bh * 0.3, 9, 13), on ? '1' : '0')}
        </>
      )
    },
  },
  clock: {
    body: (c) => {
      const y0 = c.y0 + c.bh * 0.12
      const y1 = c.y1 - c.bh * 0.12
      const q = c.bw / 5
      const ya = y0 + (y1 - y0) * 0.25
      const yb = y1 - (y1 - y0) * 0.25
      return (
        <>
          <rect x={c.x0} y={y0} width={c.bw} height={y1 - y0} rx={6} />
          <path d={`M${c.x0 + q * 0.6} ${yb}H${c.x0 + q * 1.4}V${ya}H${c.x0 + q * 2.4}V${yb}H${c.x0 + q * 3.4}V${ya}H${c.x0 + q * 4.2}`} />
        </>
      )
    },
  },
  output: {
    body: (c) => {
      const r = rad(c) * 0.8
      return (
        <>
          <circle data-glow="" cx={c.cx} cy={c.cy} r={r + 2} fill="var(--accent-amber)" stroke="none" style={{ opacity: 0, transition: 'opacity 120ms linear' }} />
          <circle cx={c.cx} cy={c.cy} r={r} />
        </>
      )
    },
    contact: (c, p) => (p.side === 'l' ? c.cx - rad(c) * 0.8 : c.cx + rad(c) * 0.8),
  },
  'd-ff': { body: icBody('D-FF') },
  't-ff': { body: icBody('T-FF') },
  'jk-ff': { body: icBody('JK') },
  'sr-latch': { body: icBody('SR') },
  'half-adder': { body: icBody('HA') },
  'full-adder': { body: icBody('FA') },
  comparator: { body: icBody('CMP') },
  decoder: { body: icBody('DEC') },
  encoder: { body: icBody('ENC') },
  register4: { body: icBody('SHIFT') },
  counter4: { body: icBody('CTR4') },
  'bcd-7seg': { body: icBody('BCD→7') },
  'seven-seg': { body: sevenSeg },
  tristate: {
    body: (c) => (
      <>
        <path d={`M${c.x0} ${c.y0}V${c.y1}L${c.x1} ${c.cy}Z`} />
        {c.pins.slice(0, 2).map((p) => (p.name ? <g key={p.i}>{T(c.x0 + 4, p.y, 8, p.name, 'start')}</g> : null))}
      </>
    ),
    contact: (c, p) => (p.side === 'r' ? c.x1 : c.x0),
  },
  mux: {
    body: (c) => {
      const k = c.bh * 0.16
      return (
        <>
          <path d={`M${c.x0} ${c.y0}L${c.x1} ${c.y0 + k}V${c.y1 - k}L${c.x0} ${c.y1}Z`} />
          {c.pins.map((p) => (p.name && p.side === 'l' ? <g key={p.i}>{T(c.x0 + 4, p.y, 8, p.name, 'start')}</g> : null))}
          {T(c.cx + 4, c.cy, 9, 'MUX')}
        </>
      )
    },
    contact: (c, p) => {
      if (p.side !== 'b') return p.side === 'r' ? c.x1 : c.x0
      return c.y1 - ((p.x - c.x0) / c.bw) * c.bh * 0.16
    },
  },
  demux: {
    body: (c) => {
      const k = c.bh * 0.16
      return (
        <>
          <path d={`M${c.x0} ${c.y0 + k}L${c.x1} ${c.y0}V${c.y1}L${c.x0} ${c.y1 - k}Z`} />
          {T(c.cx - 2, c.cy, 9, 'DMX')}
        </>
      )
    },
    contact: (c, p) => {
      if (p.side !== 't') return p.side === 'r' ? c.x1 : c.x0
      return c.y0 + (1 - (p.x - c.x0) / c.bw) * c.bh * 0.16
    },
  },
}

// ── renderer ────────────────────────────────────────────────────────────────

export function hasArt(sym: string) {
  return sym in ARTS
}

export function PartSvg({ obj, className, pins: showPins = true }: { obj: SceneObject; className?: string; pins?: boolean }) {
  const sym = obj.geometry.symbol ?? ''
  const w = Math.max(24, obj.size.w)
  const h = Math.max(24, obj.size.h)
  const defs = terminalsOf(obj)
  const nAttr = obj.parameters.inputs
  const n = nAttr?.kind === 'number' ? Math.round(nAttr.value) : 0
  const names = pinNames(sym, n || (sym === 'register4' ? 0 : 2))
  const pins: PartPin[] = defs.map((t, i) => ({
    i,
    x: t.x * w,
    y: t.y * h,
    side: sideOf(t.x, t.y),
    name: names[i],
  }))
  const has = (s: Side) => pins.some((p) => p.side === s)
  const leadX = clamp(w * 0.17, 8, 16)
  const leadY = clamp(h * 0.18, 6, 16)
  const x0 = has('l') ? leadX : PAD
  const x1 = w - (has('r') ? leadX : PAD)
  const y0 = has('t') ? leadY : PAD
  const y1 = h - (has('b') ? leadY : PAD)
  const ctx: PartCtx = {
    w, h, x0, y0, x1, y1,
    bw: x1 - x0, bh: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
    pins, n,
    num: (name, fb) => {
      const p = obj.parameters[name]
      return p?.kind === 'number' ? p.value : fb
    },
  }
  const art = ARTS[sym]
  const leads = art?.noLeads
    ? ''
    : pins
        .map((p) => {
          const c = art?.contact?.(ctx, p)
          if (p.side === 'l') return `M${p.x} ${p.y}H${c ?? x0}`
          if (p.side === 'r') return `M${p.x} ${p.y}H${c ?? x1}`
          if (p.side === 't') return `M${p.x} ${p.y}V${c ?? y0}`
          return `M${p.x} ${p.y}V${c ?? y1}`
        })
        .join('')
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      stroke="var(--foreground)"
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={obj.name}
      className={className}
      style={{ overflow: 'visible' }}
    >
      {leads && <path d={leads} />}
      {art ? (
        art.body(ctx)
      ) : (
        <>
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={6} />
          {T(ctx.cx, ctx.cy, 11, obj.name.split(' ')[0])}
        </>
      )}
      {showPins &&
        pins.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r={2.5} fill="var(--accent-mint)" stroke="none" opacity={0.75} />
        ))}
    </svg>
  )
}
