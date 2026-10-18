// Does a recognised circuit match the one that was drawn?
//
// Two Scene IRs are compared as circuits, not as pictures: parts are paired by
// where they are, and the wiring is compared as sets of connected pins. Two
// different-looking netlists that connect the same pins pass; a wire to the
// wrong pin fails. For parts whose two ends are interchangeable (a resistor, a
// capacitor…) which end is "a" does not matter — turning one round changes
// nothing electrically — so those pins are compared as one token.
//
// (This is the "behavioural equivalence" test of the plan, done structurally:
// the same parts with the same values joined at the same pins behave the same in
// the engine by construction. compile.test.mjs proves the engine side.)

import type { SketchIRType } from './ir'
import { Dsu } from './geom'
import { mainParamOf, parseQuantity } from './compile'

/** Classes whose two terminals can be swapped without changing the circuit. */
const SYMMETRIC = new Set(['resistor', 'capacitor', 'inductor', 'switch', 'bulb', 'voltmeter', 'ammeter', 'ac-source'])

export interface Comparison {
  truthNodes: number
  predictedNodes: number
  matched: number
  missed: number
  extra: number
  classCorrect: number
  /** Nets (sets of ≥ 2 connected pins) that are in the truth but not in the prediction, and vice versa. */
  netsMissing: number
  netsExtra: number
  /** Same parts, same classes, same wiring. */
  exact: boolean
  /** A rough count of taps a person would need to fix it. */
  taps: number
}

const center = (b: number[]): [number, number] => [b[0] + b[2] / 2, b[1] + b[3] / 2]

/** Pair each true part with the nearest unclaimed predicted part (any class). */
function pair(pred: SketchIRType['nodes'], truth: SketchIRType['nodes']): Map<string, string> {
  const cands: Array<{ t: string; p: string; d: number }> = []
  for (const t of truth) {
    const tc = center(t.bbox)
    const reach = 0.75 * Math.hypot(t.bbox[2], t.bbox[3]) + 12
    for (const p of pred) {
      const pc = center(p.bbox)
      const d = Math.hypot(tc[0] - pc[0], tc[1] - pc[1])
      if (d <= reach) cands.push({ t: t.id, p: p.id, d })
    }
  }
  cands.sort((a, b) => a.d - b.d)
  const mapTP = new Map<string, string>()
  const usedP = new Set<string>()
  for (const c of cands) {
    if (mapTP.has(c.t) || usedP.has(c.p)) continue
    mapTP.set(c.t, c.p)
    usedP.add(c.p)
  }
  return mapTP
}

/** Nets as sorted strings of pin tokens, given a node-id rename and the class of each node. */
function netsOf(ir: SketchIRType, rename: (id: string) => string | null, classOf: (id: string) => string): string[] {
  const token = (node: string, pin: string) => {
    const id = rename(node)
    if (!id) return null
    return `${id}.${SYMMETRIC.has(classOf(node)) ? '*' : pin}`
  }
  // union on the real pin keys (so a symmetric part's two pins stay distinct while unioning)…
  const keys: string[] = []
  const idx = new Map<string, number>()
  const key = (n: string, p: string) => {
    const k = `${n}\u0000${p}`
    if (!idx.has(k)) { idx.set(k, keys.length); keys.push(k) }
    return idx.get(k)!
  }
  ir.edges.forEach((e) => { key(e.a.node, e.a.pin); key(e.b.node, e.b.pin) })
  const dsu = new Dsu(keys.length)
  ir.edges.forEach((e) => dsu.union(key(e.a.node, e.a.pin), key(e.b.node, e.b.pin)))
  const groups = new Map<number, string[]>()
  keys.forEach((k, i) => {
    const [n, p] = k.split('\u0000')
    const t = token(n, p)
    if (t === null) return
    const r = dsu.find(i)
    groups.set(r, [...(groups.get(r) ?? []), t])
  })
  // …then compare by token, so a↔b on a symmetric part is not an error.
  return [...groups.values()].filter((g) => g.length >= 2).map((g) => g.slice().sort().join('|')).sort()
}

function multisetDiff(a: string[], b: string[]): number {
  const m = new Map<string, number>()
  for (const x of a) m.set(x, (m.get(x) ?? 0) + 1)
  let missing = 0
  for (const x of b) {
    const c = m.get(x) ?? 0
    if (c > 0) m.set(x, c - 1)
  }
  for (const v of m.values()) missing += v
  return missing
}

export function compareIR(pred: SketchIRType, truth: SketchIRType): Comparison {
  const tp = pair(pred.nodes, truth.nodes)
  const pt = new Map([...tp].map(([t, p]) => [p, t]))
  const classOfP = (id: string) => pred.nodes.find((n) => n.id === id)?.cls ?? ''
  const classOfT = (id: string) => truth.nodes.find((n) => n.id === id)?.cls ?? ''
  const matched = tp.size
  let classCorrect = 0
  for (const [t, p] of tp) if (classOfT(t) === classOfP(p)) classCorrect++

  // Wiring is compared in the TRUTH's node ids. A node paired to a part of the
  // wrong class still pairs, so its wires are judged too.
  const truthNets = netsOf(truth, (id) => id, classOfT)
  const predNets = netsOf(pred, (id) => pt.get(id) ?? null, classOfP)
  const netsMissing = multisetDiff(truthNets, predNets)
  const netsExtra = multisetDiff(predNets, truthNets)

  const missed = truth.nodes.length - matched
  const extra = pred.nodes.length - matched
  const classWrong = matched - classCorrect
  const exact = missed === 0 && extra === 0 && classWrong === 0 && netsMissing === 0 && netsExtra === 0
  // a wrong connection shows up once as a missing net and once as an extra one: one tap fixes both
  const taps = classWrong + missed + extra + Math.max(netsMissing, netsExtra)
  return {
    truthNodes: truth.nodes.length, predictedNodes: pred.nodes.length, matched, missed, extra,
    classCorrect, netsMissing, netsExtra, exact, taps,
  }
}

export interface ValueComparison {
  /** Parts whose true circuit has a value. */
  total: number
  /** Of those, how many the reading gave any value for. */
  read: number
  /** Of those, how many it got right (same number, any spelling: 4.7k = 4700). */
  right: number
}

/** Compare the main value of each paired part. */
export function compareValues(pred: SketchIRType, truth: SketchIRType): ValueComparison {
  const tp = pair(pred.nodes, truth.nodes)
  let total = 0
  let read = 0
  let right = 0
  for (const t of truth.nodes) {
    const key = mainParamOf(t.cls)
    const want = key ? t.values?.[key] : undefined
    if (!key || !want) continue
    total++
    const p = pred.nodes.find((n) => n.id === tp.get(t.id))
    const got = p && p.cls === t.cls ? p.values?.[key] : undefined
    if (!got) continue
    read++
    const a = parseQuantity(got)
    const b = parseQuantity(want)
    if (a && b && Math.abs(a.value - b.value) <= 1e-9 * Math.max(Math.abs(b.value), 1e-12)) right++
  }
  return { total, read, right }
}
