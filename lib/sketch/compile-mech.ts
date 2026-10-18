// Mechanics IR → SimScript (phase S4). Same contract as the circuit compiler: no model, no
// randomness, never throws, and the emitted script goes through the same lint gate as AI output.
//
// In mechanics POSITION IS THE INFORMATION and there is no auto-layout, so every part is emitted
// with the x/y/width/height/rotation it was drawn with. Connectors are emitted centre-to-centre
// with a typed connect(); the physics binds each end to whatever body sits under it. Force
// arrows become a `force` behavior on the body they act on; velocity arrows become its initial
// velocity.
//
//   ground  → create("ground")  a static bar (a ramp is a ground bar that is not level)
//   block   → create("block")   mass 5 kg      mass → create("mass")  a ball, 2 kg
//   hinge   → create("hinge")   a pin (or, with nothing under it, a world anchor)
//   force / velocity → behaviors on values.on, direction from `angle`

import type { SketchIRNode, SketchIRType } from './ir'
import type { CompileError, CompileResult } from './compile'
import { lintSimScript } from '@/lib/ai/simscript-lint'

const MECH_CLASSES = new Set(['ground', 'block', 'mass', 'hinge', 'force', 'velocity'])
/** Masses when none was typed in the preview. */
export const DEFAULT_BLOCK_KG = 2
export const DEFAULT_BALL_KG = 1
/**
 * Arrow strength when none was typed: a push of 4 N per kg (0.4 g), or 1.5 m/s. The canvas is
 * 1 px = 1 mm, so a stronger push or faster launch leaves a sketch-sized scene in a blink.
 */
export const DEFAULT_PUSH_N_PER_KG = 4
export const DEFAULT_SPEED_MS = 1.5

const rad = (d: number) => (d * Math.PI) / 180
const fmt = (n: number) => String(Number(n.toFixed(2)))

/** The axis-aligned extent of a (rotated) box — what the system boundary has to enclose. */
function extent(n: SketchIRNode): [number, number, number, number] {
  const [x, y, w, h] = n.bbox
  const a = rad(n.angle ?? 0)
  const c = Math.abs(Math.cos(a))
  const s = Math.abs(Math.sin(a))
  const ew = w * c + h * s
  const eh = w * s + h * c
  const cx = x + w / 2
  const cy = y + h / 2
  return [cx - ew / 2, cy - eh / 2, cx + ew / 2, cy + eh / 2]
}

const numberOf = (v: string | undefined): number | null => {
  if (v === undefined) return null
  const n = Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}

export function compileMechanicsIR(ir: SketchIRType): CompileResult {
  const errors: CompileError[] = []
  const warnings: string[] = []
  const doubts = [...ir.doubts]
  const fail = (): CompileResult => ({ ok: false, script: '', errors, warnings, doubts })

  const byId = new Map<string, SketchIRNode>()
  for (const n of ir.nodes) {
    if (byId.has(n.id)) {
      errors.push({ code: 'duplicate-node', message: `node id "${n.id}" appears twice`, ref: n.id })
      continue
    }
    byId.set(n.id, n)
    if (!MECH_CLASSES.has(n.cls)) {
      errors.push({ code: 'unknown-class', message: `"${n.cls}" is not a mechanics part (ground, block, mass, hinge, force, velocity)`, ref: n.id })
    }
  }
  for (const e of ir.edges) {
    for (const end of [e.a, e.b]) {
      if (!byId.has(end.node)) errors.push({ code: 'unknown-node', message: `link refers to unknown part "${end.node}"`, ref: end.node })
    }
    if (e.a.node === e.b.node) errors.push({ code: 'self-loop', message: `a ${e.kind} cannot join ${e.a.node} to itself`, ref: e.a.node })
    if (e.kind === 'wire') errors.push({ code: 'bad-edge-kind', message: 'a wire is electrical; mechanics links are spring, rope, rod or damper', ref: e.a.node })
  }
  if (errors.length) return fail()

  const bodies = ir.nodes.filter((n) => n.cls !== 'force' && n.cls !== 'velocity')
  if (bodies.length === 0) {
    errors.push({ code: 'schema', message: 'there is nothing to build: no ground, block, ball or hinge was found' })
    return fail()
  }

  // frame: everything is emitted relative to the sketch's top-left, with a margin for the system
  const ext = bodies.map(extent)
  const MARGIN = 40
  const minX = Math.min(...ext.map((e) => e[0])) - MARGIN
  const minY = Math.min(...ext.map((e) => e[1])) - MARGIN
  const maxX = Math.max(...ext.map((e) => e[2])) + MARGIN
  const maxY = Math.max(...ext.map((e) => e[3])) + MARGIN
  // +10 keeps every coordinate non-zero: only a non-zero x/y counts as placed
  const px = (x: number) => Math.round(x - minX) + 10
  const py = (y: number) => Math.round(y - minY) + 10

  const lines: string[] = []
  if (bodies.length >= 2) {
    lines.push(`var sys = create("system", { x: 10, y: 10, domain: "mechanics", width: ${Math.round(maxX - minX)}, height: ${Math.round(maxY - minY)} });`)
  }

  const name = new Map<string, string>()
  const counters: Record<string, number> = {}
  const nameFor = (n: SketchIRNode) => {
    counters[n.cls] = (counters[n.cls] ?? 0) + 1
    const v = `${n.cls}${counters[n.cls]}`
    name.set(n.id, v)
    return v
  }

  for (const n of bodies) {
    const v = nameFor(n)
    const [x, y, w, h] = n.bbox
    const props: string[] = []
    const mass = numberOf(n.values?.mass)
    const friction = numberOf(n.values?.friction)
    if (n.cls === 'hinge') {
      props.push(`x: ${px(x + w / 2 - 11)}`, `y: ${py(y + h / 2 - 11)}`)
    } else {
      props.push(`x: ${px(x)}`, `y: ${py(y)}`, `width: ${Math.max(1, Math.round(w))}`, `height: ${Math.max(1, Math.round(h))}`)
      if (n.angle) props.push(`rotation: ${fmt(n.angle)}`)
      if (n.cls === 'block' || n.cls === 'mass') props.push(`mass: ${fmt(mass ?? (n.cls === 'block' ? DEFAULT_BLOCK_KG : DEFAULT_BALL_KG))}`)
      if (n.cls !== 'hinge' && friction !== null) props.push(`friction: ${fmt(friction)}`)
    }
    lines.push(`var ${v} = create("${n.cls}", { ${props.join(', ')} });`)
  }

  for (const e of ir.edges) {
    lines.push(`connect(${name.get(e.a.node)}.centre, ${name.get(e.b.node)}.centre, "${e.kind}");`)
  }

  for (const n of ir.nodes.filter((q) => q.cls === 'force' || q.cls === 'velocity')) {
    const on = n.values?.on ? byId.get(n.values.on) : undefined
    if (!on || (on.cls !== 'block' && on.cls !== 'mass')) {
      warnings.push(`${n.id}: ${n.cls} arrow is not on a block or ball — left out`)
      doubts.push({ ref: n.id, why: 'dangling-wire' })
      continue
    }
    const target = name.get(on.id)!
    const theta = rad(n.angle ?? 0)
    const dx = Math.cos(theta)
    const dy = -Math.sin(theta) // the screen's y runs down; the engine's runs up
    if (n.cls === 'force') {
      const kg = numberOf(on.values?.mass) ?? (on.cls === 'block' ? DEFAULT_BLOCK_KG : DEFAULT_BALL_KG)
      const F = numberOf(n.values?.F) ?? DEFAULT_PUSH_N_PER_KG * kg
      lines.push(`addproperty(${target}, "force", { fx: ${fmt(F * dx)}, fy: ${fmt(F * dy)} });`)
    } else {
      const V = numberOf(n.values?.v) ?? DEFAULT_SPEED_MS
      lines.push(`${target}.set({ vx: ${fmt(V * dx)}, vy: ${fmt(V * dy)} });`)
    }
  }

  const script = lines.join('\n')
  const lint = lintSimScript(script)
  if (!lint.ok) {
    for (const message of lint.errors) errors.push({ code: 'lint', message: `compiler bug — emitted a script that fails lint: ${message}` })
    return fail()
  }
  return { ok: true, script, errors, warnings: [...warnings, ...lint.warnings], doubts }
}
