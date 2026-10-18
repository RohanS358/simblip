// Optics IR → SimScript (phase S4). Same contract as the other compilers: deterministic, never throws,
// lint-gated. An optical bench is placed by position, left to right; lenses, mirrors and the screen
// are vertical lines whose length is their aperture (the sketch's own height is kept).

import type { SketchIRNode, SketchIRType } from './ir'
import type { CompileError, CompileResult } from './compile'
import { lintSimScript } from '@/lib/ai/simscript-lint'

const OPTIC_CLASSES = new Set(['light-source', 'thin-lens', 'optical-mirror', 'optical-screen'])
const MARGIN = 40
const rad = (d: number) => (d * Math.PI) / 180
const fmt = (n: number) => String(Number(n.toFixed(2)))

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

/** Origin for executeSimScript so every part lands where it was drawn (see mechFrame). */
export function opticsFrame(ir: SketchIRType): { x: number; y: number } {
  const ext = ir.nodes.map(extent)
  if (!ext.length) return { x: 200, y: 100 }
  return { x: Math.min(...ext.map((e) => e[0])) - MARGIN - 10, y: Math.min(...ext.map((e) => e[1])) - MARGIN - 10 }
}

export function compileOpticsIR(ir: SketchIRType): CompileResult {
  const errors: CompileError[] = []
  const warnings: string[] = []
  const doubts = [...ir.doubts]
  const fail = (): CompileResult => ({ ok: false, script: '', errors, warnings, doubts })

  const seen = new Set<string>()
  for (const n of ir.nodes) {
    if (seen.has(n.id)) errors.push({ code: 'duplicate-node', message: `node id "${n.id}" appears twice`, ref: n.id })
    seen.add(n.id)
    if (!OPTIC_CLASSES.has(n.cls)) {
      errors.push({ code: 'unknown-class', message: `"${n.cls}" is not an optics part (light-source, thin-lens, optical-mirror, optical-screen)`, ref: n.id })
    }
  }
  if (ir.edges.length) errors.push({ code: 'bad-edge-kind', message: 'optics parts are placed, not wired — there should be no links' })
  if (errors.length) return fail()
  if (!ir.nodes.length) {
    errors.push({ code: 'schema', message: 'there is nothing to build: no source, lens, mirror or screen was found' })
    return fail()
  }
  if (!ir.nodes.some((n) => n.cls === 'light-source')) {
    warnings.push('no light source was found — add one (a circle) or there is nothing to trace')
    doubts.push({ ref: ir.nodes[0].id, why: 'low-confidence' })
  }

  const ext = ir.nodes.map(extent)
  const minX = Math.min(...ext.map((e) => e[0])) - MARGIN
  const minY = Math.min(...ext.map((e) => e[1])) - MARGIN
  const maxX = Math.max(...ext.map((e) => e[2])) + MARGIN
  const maxY = Math.max(...ext.map((e) => e[3])) + MARGIN
  const px = (x: number) => Math.round(x - minX) + 10
  const py = (y: number) => Math.round(y - minY) + 10

  const lines: string[] = []
  if (ir.nodes.length >= 2) {
    lines.push(`var sys = create("system", { x: 10, y: 10, domain: "optics", width: ${Math.round(maxX - minX)}, height: ${Math.round(maxY - minY)} });`)
  }
  const counters: Record<string, number> = {}
  for (const n of ir.nodes) {
    counters[n.cls] = (counters[n.cls] ?? 0) + 1
    const v = `${n.cls.replace(/-/g, '_')}${counters[n.cls]}`
    const [x, y, w, h] = n.bbox
    const props: string[] = [`x: ${px(x)}`, `y: ${py(y)}`, `width: ${Math.max(1, Math.round(w))}`, `height: ${Math.max(1, Math.round(h))}`]
    if (n.angle) props.push(`rotation: ${fmt(n.angle)}`)
    const f = Number(n.values?.f)
    if ((n.cls === 'thin-lens' || n.cls === 'optical-mirror') && n.values?.f !== undefined && Number.isFinite(f)) props.push(`f: ${fmt(f)}`)
    lines.push(`var ${v} = create("${n.cls}", { ${props.join(', ')} });`)
  }

  const script = lines.join('\n')
  const lint = lintSimScript(script)
  if (!lint.ok) {
    for (const message of lint.errors) errors.push({ code: 'lint', message: `compiler bug — emitted a script that fails lint: ${message}` })
    return fail()
  }
  return { ok: true, script, errors, warnings: [...warnings, ...lint.warnings], doubts }
}
