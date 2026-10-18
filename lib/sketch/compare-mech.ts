// Did the mechanics reader recover the scene that was drawn? Parts are paired by place (a
// part is the thing near where it should be), then class, angle and links are scored.

import type { SketchIRType } from './ir'

export interface MechCompare {
  exact: boolean
  truthNodes: number
  gotNodes: number
  matched: number
  classCorrect: number
  angleOk: number
  anglesChecked: number
  extra: number
  missed: string[]
  wrongClass: string[]
  edgesTruth: number
  edgesMatched: number
  edgesExtra: number
  /** arrows read with the other kind (force/velocity): needs a label or one tap */
  arrowKindWrong: number
  notes: string[]
}

const centre = (b: number[]) => [b[0] + b[2] / 2, b[1] + b[3] / 2]
const angDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}
const turn = (cls: string, a: number) => (cls === 'force' || cls === 'velocity' ? a : ((a % 180) + 180) % 180)

export function compareMech(got: SketchIRType, truth: SketchIRType, opts: { angleTol?: number } = {}): MechCompare {
  const angleTol = opts.angleTol ?? 4
  const notes: string[] = []
  const used = new Set<string>()
  const pair = new Map<string, string>() // truth id → got id
  // closest-first pairing within a reach proportional to the part's size
  const cands: Array<{ t: string; g: string; d: number }> = []
  for (const t of truth.nodes) {
    const tc = centre(t.bbox)
    const reach = Math.max(30, 0.7 * Math.max(t.bbox[2], t.bbox[3]))
    for (const g of got.nodes) {
      const gc = centre(g.bbox)
      const d = Math.hypot(tc[0] - gc[0], tc[1] - gc[1])
      if (d <= reach) cands.push({ t: t.id, g: g.id, d })
    }
  }
  cands.sort((a, b) => a.d - b.d)
  for (const c of cands) {
    if (pair.has(c.t) || used.has(c.g)) continue
    pair.set(c.t, c.g)
    used.add(c.g)
  }
  const byG = new Map(got.nodes.map((n) => [n.id, n]))
  let classCorrect = 0
  let arrowKindWrong = 0
  let angleOk = 0
  let anglesChecked = 0
  const missed: string[] = []
  const wrongClass: string[] = []
  for (const t of truth.nodes) {
    const gid = pair.get(t.id)
    if (!gid) {
      missed.push(`${t.cls}@${Math.round(centre(t.bbox)[0])},${Math.round(centre(t.bbox)[1])}`)
      continue
    }
    const g = byG.get(gid)!
    // force vs velocity is a LABEL ("F", "v"), which this reader cannot read yet: scored as one class, counted apart
    const arrowKindOnly = g.cls !== t.cls && (g.cls === 'force' || g.cls === 'velocity') && (t.cls === 'force' || t.cls === 'velocity')
    if (arrowKindOnly) arrowKindWrong++
    if (g.cls === t.cls || arrowKindOnly) {
      classCorrect++
      if (t.cls !== 'mass' && t.cls !== 'hinge') {
        anglesChecked++
        const d = angDiff(turn(t.cls, g.angle ?? 0), turn(t.cls, t.angle ?? 0))
        if (d <= angleTol || (t.cls !== 'force' && t.cls !== 'velocity' && d >= 180 - angleTol)) angleOk++
        else notes.push(`${t.cls} angle ${Math.round(g.angle ?? 0)} vs ${Math.round(t.angle ?? 0)}`)
      }
    } else wrongClass.push(`${t.cls}→${g.cls}`)
  }
  // links: a truth edge is found when its two parts are joined, by a link of the same kind
  const key = (a: string, b: string, k: string) => (a < b ? `${a}|${b}|${k}` : `${b}|${a}|${k}`)
  const gotEdges = new Set(got.edges.map((e) => key(e.a.node, e.b.node, e.kind)))
  let edgesMatched = 0
  for (const e of truth.edges) {
    const a = pair.get(e.a.node)
    const b = pair.get(e.b.node)
    if (a && b && gotEdges.has(key(a, b, e.kind))) edgesMatched++
  }
  const edgesExtra = Math.max(0, got.edges.length - edgesMatched)
  const extra = got.nodes.filter((n) => !used.has(n.id)).length
  const exact =
    missed.length === 0 && wrongClass.length === 0 && extra === 0 && angleOk === anglesChecked && edgesMatched === truth.edges.length && edgesExtra === 0
  return {
    exact,
    truthNodes: truth.nodes.length,
    gotNodes: got.nodes.length,
    matched: pair.size,
    classCorrect,
    angleOk,
    anglesChecked,
    extra,
    missed,
    wrongClass,
    edgesTruth: truth.edges.length,
    edgesMatched,
    edgesExtra,
    arrowKindWrong,
    notes,
  }
}
