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
  }
}

export interface PartEdit {
  cls?: string
  pose?: Pose
  /** The text of the part's main value ("10k"); empty clears it. */
  value?: string
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
    return next
  })
  return { ...g, result: rewire(g.result, parts) }
}

export function setKeepLayout(g: CircuitGhost, keepLayout: boolean): CircuitGhost {
  return { ...g, keepLayout }
}

/** The compiled circuit for the current reading (never throws; see CompileResult). */
export function compileGhost(g: CircuitGhost): CompileResult {
  return compileIR(g.result.ir, { layout: g.keepLayout ? 'keep' : 'auto' })
}

/** Every ink object the live circuit replaces: the parts' strokes, the wires and the dots. */
export function inkToReplace(g: CircuitGhost): string[] {
  const ids = new Set<string>([...g.result.wireIds, ...g.result.dotIds, ...(g.result.textIds ?? [])])
  for (const p of g.result.parts) for (const id of p.strokeIds) ids.add(id)
  return [...ids]
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
