// The mechanics / optics preview: what the reader found in a sketch, editable before anything is
// replaced. (The circuit preview's twin — lib/sketch/circuit-ghost.ts.) Pure state and transitions,
// no DOM. One shape serves both domains; `domain` says which classes, values and compiler apply.

import { extractMechanics, type MechResult, type MechStroke } from './mech'
import { extractOptics, type OpticsResult } from './optics'
import type { SketchIRType, SketchIRNode } from './ir'
import type { CompileResult } from './compile'
import { compileIR } from './compile'
import { mechFrame } from './compile-mech'
import { opticsFrame } from './compile-optics'

export type SpatialDomain = 'mechanics' | 'optics'

export interface MechGhost {
  pageId: string
  domain: SpatialDomain
  /** Mechanics only: the full reading (links, gaps, snapped blocks…). */
  result: MechResult | null
  optics: OpticsResult | null
  /** The reading as the person has corrected it. */
  ir: SketchIRType
  /** What the reader first said, per part — to tell a correction from a confirmation. */
  original: Record<string, { cls: string; conf: number }>
  /** Page-coordinate strokes by id, for the overlay. */
  ink: Record<string, number[][]>
  /** Every stroke the live scene replaces. */
  replaceIds: string[]
}

export const MECH_CLASSES = ['ground', 'block', 'mass', 'hinge', 'force', 'velocity'] as const
export const OPTICS_CLASSES = ['light-source', 'thin-lens', 'optical-mirror', 'optical-screen'] as const

export const classesOf = (g: MechGhost): readonly string[] => (g.domain === 'optics' ? OPTICS_CLASSES : MECH_CLASSES)

function base(pageId: string, strokes: MechStroke[], domain: SpatialDomain, ir: SketchIRType) {
  return {
    pageId,
    domain,
    ir,
    original: Object.fromEntries(ir.nodes.map((n) => [n.id, { cls: n.cls, conf: n.conf }])),
    ink: Object.fromEntries(strokes.map((s) => [s.id, s.pts])),
  }
}

export function startMechGhost(pageId: string, strokes: MechStroke[]): MechGhost | null {
  const result = extractMechanics(strokes)
  if (result.ir.nodes.length === 0) return null
  const ids = new Set<string>()
  for (const p of result.parts) for (const id of p.strokeIds) ids.add(id)
  for (const e of result.edges) for (const id of e.strokeIds) ids.add(id)
  return { ...base(pageId, strokes, 'mechanics', result.ir), result, optics: null, replaceIds: [...ids] }
}

export function startOpticsGhost(pageId: string, strokes: MechStroke[]): MechGhost | null {
  const optics = extractOptics(strokes)
  if (optics.ir.nodes.length === 0) return null
  const ids = new Set<string>([...optics.furnitureIds])
  for (const p of optics.parts) for (const id of p.strokeIds) ids.add(id)
  return { ...base(pageId, strokes, 'optics', optics.ir), result: null, optics, replaceIds: [...ids] }
}

export interface MechEdit {
  cls?: string
  /** Set (or, with an empty string, clear) typed values: mass, friction, F, v (mechanics); f (optics). */
  values?: Record<string, string>
}

export function editMechPart(g: MechGhost, id: string, edit: MechEdit): MechGhost {
  const nodes = g.ir.nodes.map((n): SketchIRNode => {
    if (n.id !== id) return n
    const next = { ...n }
    if (edit.cls && edit.cls !== n.cls) {
      next.cls = edit.cls
      next.conf = 1
      if (edit.cls === 'mass' || edit.cls === 'hinge') {
        // a ball is round: keep its centre, make its box square
        const side = Math.sqrt(n.bbox[2] * n.bbox[3])
        const cx = n.bbox[0] + n.bbox[2] / 2
        const cy = n.bbox[1] + n.bbox[3] / 2
        next.bbox = [cx - side / 2, cy - side / 2, side, side]
        next.angle = 0
      }
      // values that belonged to the old class no longer mean anything
      const keep: Record<string, string> = {}
      for (const [k, v] of Object.entries(n.values ?? {})) if (k === 'on') keep[k] = v
      next.values = Object.keys(keep).length ? keep : undefined
    }
    if (edit.values) {
      const merged = { ...(next.values ?? {}) }
      for (const [k, v] of Object.entries(edit.values)) {
        if (v === '') delete merged[k]
        else merged[k] = v
      }
      next.values = Object.keys(merged).length ? merged : undefined
    }
    return next
  })
  return { ...g, ir: { ...g.ir, nodes } }
}

export function editMechLink(g: MechGhost, index: number, kind: 'spring' | 'rope' | 'rod'): MechGhost {
  const edges = g.ir.edges.map((e, i) => (i === index ? { ...e, kind, conf: 1 } : e))
  return { ...g, ir: { ...g.ir, edges } }
}

export function compileMechGhost(g: MechGhost): CompileResult {
  return compileIR(g.ir)
}

/** Every stroke the live scene replaces. */
export function mechInkToReplace(g: MechGhost): string[] {
  return g.replaceIds
}

/** Where the compiled scene's frame must start so it lands exactly on the drawing. */
export function mechOrigin(g: MechGhost): { x: number; y: number } {
  return g.domain === 'optics' ? opticsFrame(g.ir) : mechFrame(g.ir)
}

/** How many things a person should look at before trusting this reading. */
export function mechToCheck(g: MechGhost): number {
  return new Set([...g.ir.doubts.map((d) => d.ref), ...g.ir.nodes.filter((n) => n.conf < 0.7).map((n) => n.id)]).size
}
