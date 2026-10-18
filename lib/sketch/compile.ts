// Scene IR → SimScript. No model, no randomness: a bad IR yields a list of
// plain errors (never a throw, never a broken scene), and a good one goes
// through lintSimScript in the tests before it can ever reach the canvas.
//
//  circuit / digital → create() + connect() with NO x/y: the auto-layout
//                      engine draws the schematic (the sketch only has to be
//                      topologically right).
//  mechanics / optics → create() with x/y/size from the IR bboxes; the physics
//                      runtime resolves constraints by touching.
import { KNOWN_KINDS } from '@/lib/ai/simscript-corpus'
import { anchorValid, anchorNames } from '@/lib/ai/simscript-lint'
import { SketchIR, type SketchIRType, type IRNode, type IRDoubt } from './ir'
import { parseQuantity } from './units'

export interface CompileResult {
  ok: boolean
  script: string
  errors: string[]
  /** Input doubts plus any the compiler adds (defaulted values). */
  doubts: IRDoubt[]
}

const BODY_KINDS = new Set(['mass', 'block', 'beam', 'wheel', 'ground', 'motor', 'charge', 'reference-point', 'hinge', 'efield', 'bfield'])
const OPTICS_KINDS = new Set(['light-source', 'thin-lens', 'mirror', 'optical-mirror', 'screen', 'optical-screen', 'slit'])
const LINE_EDGES = new Set(['rope', 'rod', 'spring', 'damper'])
const RESERVED = new Set(['var', 'let', 'const', 'switch', 'function', 'class', 'new', 'delete', 'in', 'if', 'for', 'while', 'do', 'default', 'case', 'return', 'this', 'true', 'false', 'null', 'create', 'connect', 'graph'])

/** Quantities that carry a unit and must parse; everything else is passed through as text-or-number. */
const TEXT_VALUES = new Set(['wave'])
/** A sketch that never wrote a value gets this and a doubt, so the ghost asks. */
const DEFAULT_PROMPT: Record<string, string> = { battery: 'V' }

const varName = (id: string): string => {
  const v = id.replace(/\W/g, '_')
  return /^[A-Za-z_$]/.test(v) && !RESERVED.has(v) ? v : `n_${v}`
}

/** Pins whose canonical name is not a valid JS member (`a.in+`): the
 *  identifier aliases the anchor table also accepts. */
const PIN_ALIAS: Record<string, string> = {
  'in+': 'inp', 'in-': 'inn', 'v+': 'vplus', 'v-': 'vminus',
  'ctrl+': 'ctrlp', 'ctrl-': 'ctrln', 'primary+': 'p1', 'primary-': 'p2',
  'secondary+': 's1', 'secondary-': 's2', 'current+': 'ip', 'voltage+': 'vp',
}
const pinName = (p: string) => PIN_ALIAS[p] ?? p

const num = (n: number) => String(Number(n.toPrecision(12)))

function propsOf(n: IRNode, domain: SketchIRType['domain'], doubts: IRDoubt[]): string {
  const parts: string[] = []
  for (const [k, raw] of Object.entries(n.values ?? {})) {
    if (TEXT_VALUES.has(k)) { parts.push(`${k}: ${JSON.stringify(raw)}`); continue }
    const q = parseQuantity(raw)
    if (q === null) { doubts.push({ ref: n.id, why: 'unreadable-value' }); continue }
    parts.push(`${k}: ${num(q)}`)
  }
  const placed = domain === 'mechanics' || domain === 'optics'
  if (placed) {
    const [x, y, w, h] = n.bbox
    parts.unshift(`x: ${Math.round(x)}`, `y: ${Math.round(y)}`)
    if (BODY_KINDS.has(n.cls) && n.cls !== 'hinge') parts.push(`width: ${Math.round(w)}`, `height: ${Math.round(h)}`)
  }
  const prompt = DEFAULT_PROMPT[n.cls]
  if (prompt && !(n.values && prompt in n.values)) doubts.push({ ref: n.id, why: 'unreadable-value' })
  return parts.length ? `{ ${parts.join(', ')} }` : '{}'
}

export function compileIR(input: unknown): CompileResult {
  const parsed = SketchIR.safeParse(input)
  if (!parsed.success) {
    return { ok: false, script: '', doubts: [], errors: parsed.error.issues.map((i) => `IR invalid at ${i.path.join('.') || '(root)'}: ${i.message}`) }
  }
  const ir = parsed.data
  const errors: string[] = []
  const doubts: IRDoubt[] = [...ir.doubts]
  const kindOf = new Map<string, string>()
  const names = new Map<string, string>()
  const lines: string[] = []
  const placed = ir.domain === 'mechanics' || ir.domain === 'optics'

  if (placed && ir.nodes.length) {
    // Play/Step scope to a system boundary (the linter insists on one): fit it
    // around the sketch with a margin.
    const pad = 40
    const x0 = Math.min(...ir.nodes.map((n) => n.bbox[0])) - pad
    const y0 = Math.min(...ir.nodes.map((n) => n.bbox[1])) - pad
    const x1 = Math.max(...ir.nodes.map((n) => n.bbox[0] + n.bbox[2])) + pad
    const y1 = Math.max(...ir.nodes.map((n) => n.bbox[1] + n.bbox[3])) + pad
    lines.push(`var sys = create("system", { x: ${Math.round(x0)}, y: ${Math.round(y0)}, domain: ${JSON.stringify(ir.domain)}, width: ${Math.round(x1 - x0)}, height: ${Math.round(y1 - y0)} });`)
  }

  if (ir.domain === 'diagram') errors.push('domain "diagram" has no compiler yet (wave 4: diagram() / DSA Lab)')

  for (const n of ir.nodes) {
    if (kindOf.has(n.id)) { errors.push(`duplicate node id "${n.id}"`); continue }
    if (!KNOWN_KINDS.has(n.cls)) {
      errors.push(`node "${n.id}": class "${n.cls}" is not a SimScript component — a class without a component is a gap to report, not one to invent`)
      continue
    }
    if (placed && !BODY_KINDS.has(n.cls) && !OPTICS_KINDS.has(n.cls)) {
      errors.push(`node "${n.id}": "${n.cls}" does not belong in a ${ir.domain} sketch`)
      continue
    }
    kindOf.set(n.id, n.cls)
    names.set(n.id, varName(n.id))
    lines.push(`var ${names.get(n.id)} = create(${JSON.stringify(n.cls)}, ${propsOf(n, ir.domain, doubts)});`)
    if (n.conf < 0.6 && !doubts.some((d) => d.ref === n.id && d.why === 'low-confidence')) doubts.push({ ref: n.id, why: 'low-confidence' })
  }

  for (const e of ir.edges) {
    const ends = [e.a, e.b]
    let bad = false
    for (const p of ends) {
      const k = kindOf.get(p.node)
      if (!k) { errors.push(`edge refers to unknown node "${p.node}"`); bad = true; continue }
      if (!placed && !(/^[A-Za-z_$][\w$]*$/.test(pinName(p.pin)) && anchorValid(k, pinName(p.pin)))) {
        errors.push(`node "${p.node}" (${k}) has no pin "${p.pin}" — use one of: ${anchorNames(k).join(', ') || 'a, b'}`)
        bad = true
      }
    }
    if (bad) continue
    if (!placed && e.kind !== 'wire') { errors.push(`a ${e.kind} cannot join circuit parts (${e.a.node} → ${e.b.node})`); continue }
    if (placed && e.kind === 'wire') continue // wires carry no meaning in a situation sketch
    if (placed && !LINE_EDGES.has(e.kind)) continue
    const a = placed ? `${names.get(e.a.node)}.centre` : `${names.get(e.a.node)}.${pinName(e.a.pin)}`
    const b = placed ? `${names.get(e.b.node)}.centre` : `${names.get(e.b.node)}.${pinName(e.b.pin)}`
    lines.push(e.kind === 'wire' ? `connect(${a}, ${b});` : `connect(${a}, ${b}, ${JSON.stringify(e.kind)});`)
  }

  if (ir.domain === 'circuit') {
    const probe = ir.nodes.find((n) => ['resistor', 'bulb', 'led', 'diode'].includes(n.cls) && names.has(n.id))
    if (probe) lines.push(`graph.plot(${names.get(probe.id)}.I);`)
  }

  return { ok: errors.length === 0, script: lines.join('\n'), errors, doubts }
}
