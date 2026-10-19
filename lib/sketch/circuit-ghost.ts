// "Sketch → circuit": the state behind the whole-circuit preview, and the steps
// that turn it into a live circuit. Pure (no canvas, no store), so each step is
// testable on its own; components/workspace/circuit-ghost.tsx draws it and
// canvas.tsx runs it.
//
//   ink ──extractCircuit──▶ reading ──(user edits)──▶ rewire ──▶ Scene IR
//       ──compileIR──▶ SimScript ──executeSimScript──▶ the circuit
//
// Nothing replaces the ink until "Make it live". Editing a part's class or turn
// re-reads the wiring (its pins move); typing a value fills the part's main
// parameter. Every confirmed part is also kept, on this device only, as a real
// example (corrections.ts).

import { compileIR, mainParamOf, type CompileResult } from './compile'
import type { SketchIREdge, SketchIRType } from './ir'
import { makeCorrection } from './corrections'
import type { SketchSampleT } from './dataset'
import { extractCircuit, rewire, type ExtractResult, type ExtractedPart, type InkStroke, type Recogniser } from './extract'
import type { Pose } from './classes'

export interface CircuitGhost {
  pageId: string
  /** The current reading, with the user's edits applied. */
  result: ExtractResult
  /** What the network first said for each part — kept so a correction records the disagreement. */
  original: Record<string, { cls: string; conf: number }>
  /** All ink strokes the reading covers, by id → page-px points (for saving examples). */
  ink: Record<string, number[][]>
  /** Place parts where they were drawn, instead of letting the schematic layout tidy them. */
  keepLayout: boolean
  /** The person's corrections to the connections the reader found (kept across part edits, which re-read the wiring). */
  links: { removed: string[]; added: SketchIREdge[] }
}

/** Read the circuit in `strokes`. Null when no symbol was recognised. */
export function startCircuitGhost(pageId: string, strokes: InkStroke[], net: Recogniser, charNet?: Recogniser): CircuitGhost | null {
  const result = extractCircuit(strokes, net, { charNet })
  if (result.parts.length === 0) return null
  return {
    pageId,
    result,
    original: Object.fromEntries(result.parts.map((p) => [p.id, { cls: p.cls, conf: p.conf }])),
    ink: Object.fromEntries(strokes.map((s) => [s.id, s.pts])),
    keepLayout: false,
    links: { removed: [], added: [] },
  }
}

export interface PartEdit {
  cls?: string
  pose?: Pose
  /** The text of the part's main value ("10k"); empty clears it. */
  value?: string
  /** Other parameters typed in the preview, e.g. an AC source's frequency { f: "50" }; empty clears one. */
  extra?: Record<string, string>
}

/** Apply one edit. A class or turn change moves the pins, so the wiring is read again. */
export function editPart(g: CircuitGhost, id: string, edit: PartEdit): CircuitGhost {
  const parts: ExtractedPart[] = g.result.parts.map((p) => {
    if (p.id !== id) return p
    const next: ExtractedPart = { ...p }
    if (edit.cls && edit.cls !== p.cls) {
      next.cls = edit.cls
      // a corrected class is no longer a guess, and an op-amp's read polarity is gone
      next.conf = 1
      next.flip = false
      next.polarityKnown = false
      // values belong to the old class's parameters
      next.values = undefined
    }
    if (edit.pose !== undefined) next.pose = edit.pose
    if (edit.value !== undefined) {
      const key = mainParamOf(next.cls)
      const rest = { ...(next.values ?? {}) }
      if (key) {
        if (edit.value.trim()) rest[key] = edit.value.trim()
        else delete rest[key]
      }
      next.values = rest
    }
    if (edit.extra) {
      const rest = { ...(next.values ?? {}) }
      for (const [k, v] of Object.entries(edit.extra)) {
        if (v.trim()) rest[k] = v.trim()
        else delete rest[k]
      }
      next.values = rest
    }
    return next
  })
  return { ...g, result: rewire(g.result, parts) }
}

/** A part's second typed value, if it has one (an AC source's frequency). */
export const EXTRA_PARAM: Record<string, { key: string; unit: string }> = { 'ac-source': { key: 'f', unit: 'Hz' } }

// ── connections ──────────────────────────────────────────────────────────────

/** One connection, ends in a fixed order, so the same two pins always have the same key. */
export function linkKey(e: Pick<SketchIREdge, 'a' | 'b'>): string {
  const a = `${e.a.node}.${e.a.pin}`
  const b = `${e.b.node}.${e.b.pin}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export interface LinkView {
  key: string
  a: { node: string; pin: string }
  b: { node: string; pin: string }
  /** drawn by the person, not read from the ink */
  added: boolean
}

/** The circuit's connections as the person has corrected them: the reader's, less those removed, plus those added. */
export function linksOf(g: CircuitGhost): LinkView[] {
  const removed = new Set(g.links.removed)
  const read = g.result.ir.edges.filter((e) => !removed.has(linkKey(e))).map((e) => ({ key: linkKey(e), a: e.a, b: e.b, added: false }))
  const seen = new Set(read.map((l) => l.key))
  const added = g.links.added.filter((e) => !seen.has(linkKey(e))).map((e) => ({ key: linkKey(e), a: e.a, b: e.b, added: true }))
  return [...read, ...added]
}

/** The reading as an IR, with the person's connection edits applied. */
export function irOf(g: CircuitGhost): SketchIRType {
  const keep = new Set(linksOf(g).map((l) => l.key))
  const edges = [...g.result.ir.edges, ...g.links.added].filter((e, i, all) => keep.has(linkKey(e)) && all.findIndex((x) => linkKey(x) === linkKey(e)) === i)
  return { ...g.result.ir, edges }
}

export function removeLink(g: CircuitGhost, key: string): CircuitGhost {
  const wasAdded = g.links.added.some((e) => linkKey(e) === key)
  return {
    ...g,
    links: {
      removed: wasAdded ? g.links.removed : [...new Set([...g.links.removed, key])],
      added: g.links.added.filter((e) => linkKey(e) !== key),
    },
  }
}

/** Join two pins. Ignored when it joins a pin to itself, names a pin that does not exist, or is already there. */
export function addLink(g: CircuitGhost, a: { node: string; pin: string }, b: { node: string; pin: string }): CircuitGhost {
  const has = (e: { node: string; pin: string }) => g.result.parts.find((p) => p.id === e.node)?.pins.some((q) => q.name === e.pin)
  if (!has(a) || !has(b) || (a.node === b.node && a.pin === b.pin)) return g
  const edge: SketchIREdge = { a, b, kind: 'wire', conf: 1 }
  const key = linkKey(edge)
  if (linksOf(g).some((l) => l.key === key)) return g
  // adding back one that was removed just restores it
  if (g.links.removed.includes(key)) return { ...g, links: { ...g.links, removed: g.links.removed.filter((k) => k !== key) } }
  return { ...g, links: { ...g.links, added: [...g.links.added, edge] } }
}

/** Where a pin is on the page (for drawing a connection the person added). */
export function pinPoint(g: CircuitGhost, e: { node: string; pin: string }): [number, number] | null {
  const pin = g.result.parts.find((p) => p.id === e.node)?.pins.find((q) => q.name === e.pin)
  return pin ? [pin.x, pin.y] : null
}

export function setKeepLayout(g: CircuitGhost, keepLayout: boolean): CircuitGhost {
  return { ...g, keepLayout }
}

/** The compiled circuit for the current reading (never throws; see CompileResult). */
export function compileGhost(g: CircuitGhost): CompileResult {
  return compileIR(irOf(g), { layout: g.keepLayout ? 'keep' : 'auto' })
}

/** Every ink object the live circuit replaces: the parts' strokes, the wires and the dots. */
export function inkToReplace(g: CircuitGhost): string[] {
  const ids = new Set<string>([...g.result.wireIds, ...g.result.dotIds, ...(g.result.textIds ?? [])])
  for (const p of g.result.parts) for (const id of p.strokeIds) ids.add(id)
  return [...ids]
}

/**
 * Where the circuit may be laid out: the area the sketch covered (at least 480 × 340,
 * centred on it), so the circuit comes out where the drawing was — not wherever
 * the viewport happens to be.
 */
export function inkBounds(g: CircuitGhost): { left: number; top: number; right: number; bottom: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const id of inkToReplace(g)) {
    for (const p of g.ink[id] ?? []) {
      if (p[0] < x0) x0 = p[0]
      if (p[0] > x1) x1 = p[0]
      if (p[1] < y0) y0 = p[1]
      if (p[1] > y1) y1 = p[1]
    }
  }
  if (!Number.isFinite(x0)) return { left: 0, top: 0, right: 1400, bottom: 900 }
  const w = Math.max(480, x1 - x0 + 120)
  const h = Math.max(340, y1 - y0 + 120)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 }
}

/** Top-left of the ink being replaced — where the new circuit is anchored. */
export function inkOrigin(g: CircuitGhost): { x: number; y: number } {
  let x = Infinity
  let y = Infinity
  for (const id of inkToReplace(g)) {
    for (const p of g.ink[id] ?? []) {
      if (p[0] < x) x = p[0]
      if (p[1] < y) y = p[1]
    }
  }
  return Number.isFinite(x) ? { x, y } : { x: 200, y: 100 }
}

/** One real example per confirmed part: its own strokes and the class the person settled on. */
export function examplesFrom(g: CircuitGhost, writer: string): SketchSampleT[] {
  return g.result.parts.flatMap((p) => {
    const strokes = p.strokeIds.map((id) => g.ink[id]).filter((s): s is number[][] => !!s && s.length > 0)
    if (!strokes.length) return []
    const was = g.original[p.id]
    try {
      return [
        makeCorrection(
          {
            cls: p.cls,
            pose: p.pose,
            strokes,
            device: 'mouse',
            predicted: was?.cls ?? p.cls,
            confidence: was?.conf ?? p.conf,
            changed: !!was && was.cls !== p.cls,
            rotated: false,
          },
          writer
        ),
      ]
    } catch {
      return []
    }
  })
}

/** How many things a person should look at before trusting this reading. */
export function toCheck(g: CircuitGhost): number {
  return g.result.ir.doubts.length
}
