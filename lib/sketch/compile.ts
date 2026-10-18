// Scene IR → SimScript. No model, no randomness: the same IR always compiles to
// the same script, and every script goes through the same lint gate as AI
// output. If lint rejects what this file emits, the compiler has a bug — never
// the model (SIMBLIP AI Plan, Document 2, §3.3).
//
// Circuits and digital logic are emitted WITHOUT x/y: the sketch only has to be
// topologically right, and the schematic auto-layout draws it tidily. Pass
// `layout: 'keep'` to place parts by their sketched bounding boxes instead.
//
// compileIR never throws. Anything wrong with the IR comes back as `errors`,
// anything the user should double-check comes back as `doubts`.

import { SketchIR, type SketchIRDoubt, type SketchIRNode, type SketchIRType } from './ir'
import { KNOWN_KINDS } from '@/lib/ai/simscript-corpus'
import { ANCHOR_INDEX } from '@/lib/scene/simscript-props'
import { anchorValid, channelsOf, lintSimScript } from '@/lib/ai/simscript-lint'
import { compileMechanicsIR } from './compile-mech'
import { compileOpticsIR } from './compile-optics'

export type CompileErrorCode =
  | 'schema' | 'unsupported-domain' | 'duplicate-node' | 'unknown-class' | 'not-a-component'
  | 'unknown-node' | 'bad-pin' | 'self-loop' | 'bad-edge-kind' | 'unknown-param' | 'lint'

export interface CompileError {
  code: CompileErrorCode
  message: string
  /** The node id or edge description the error is about. */
  ref?: string
}

export interface CompileOptions {
  /** 'auto' (default): no x/y, the schematic layout draws it. 'keep': place by IR bbox. */
  layout?: 'auto' | 'keep'
  /** Plot the current through the first load (circuit domain). Default true. */
  plot?: boolean
}

export interface CompileResult {
  ok: boolean
  /** Empty when `ok` is false. */
  script: string
  errors: CompileError[]
  warnings: string[]
  /** The IR's own doubts, plus the ones the compiler adds. */
  doubts: SketchIRDoubt[]
}

/** Classes the taxonomy lists that are not components — wires are S0's job. */
const NOT_COMPONENTS = new Set(['wire', 'junction', 'junction-dot', 'text', 'unknown'])

/** Domains this compiler can emit so far. */
const SUPPORTED = new Set<SketchIRType['domain']>(['circuit', 'digital', 'mechanics', 'optics'])

/** Live parameters a kind accepts, from simscript-component-reference.md. */
const PARAMS: Record<string, string[]> = {
  battery: ['V'], 'ac-source': ['V', 'f', 'wave'], 'current-source': ['I'],
  resistor: ['R'], bulb: ['R'], capacitor: ['C'], inductor: ['L'],
  potentiometer: ['R', 'ratio'], switch: ['closed'], fuse: ['Imax'],
  diode: ['Vf'], led: ['Vf'], zener: ['Vf', 'Vz'],
  bjt: ['beta'], 'bjt-pnp': ['beta'], mosfet: ['Vt'], 'mosfet-pmos': ['Vt'], opamp: ['gain'],
  input: ['value'], clock: ['f'], counter4: ['mod', 'dir'],
  transformer: ['n'], 'transformer-ct': ['n'],
  vcvs: ['gain'], vccs: ['gm'], ccvs: ['r'], cccs: ['beta'],
  'three-phase-source': ['V', 'f'],
}

/** The one parameter a value written beside a part almost always means. */
const MAIN_PARAM: Record<string, string> = {
  battery: 'V', 'ac-source': 'V', 'current-source': 'I', resistor: 'R', bulb: 'R',
  capacitor: 'C', inductor: 'L',
}

/** The parameter a person usually means by "the value" of a part (R for a resistor…), if it has one. */
export function mainParamOf(cls: string): string | null {
  return MAIN_PARAM[cls] ?? PARAMS[cls]?.[0] ?? null
}

/** A unit letter fixes which parameter a bare label means. */
const UNIT_PARAM: Record<string, string> = { 'Ω': 'R', V: 'V', A: 'I', F: 'C', H: 'L' }

/** A source with no readable voltage gets this, and a doubt so the user is asked. */
const DEFAULT_BATTERY_V = 9

/** Pins that are not valid JS identifiers → the alias the runtime resolves. */
const PIN_ALIAS: Record<string, string> = {
  'in+': 'inp', 'in-': 'inn', 'ctrl+': 'ctrlp', 'ctrl-': 'ctrln',
  'primary+': 'p1', 'primary-': 'p2', 'secondary+': 's1', 'secondary-': 's2',
  'current+': 'ip', 'current-': 'in_', 'voltage+': 'vp', 'voltage-': 'vn',
}

const SI: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3,
  k: 1e3, K: 1e3, M: 1e6, meg: 1e6, Meg: 1e6, MEG: 1e6, G: 1e9,
}

const QUANTITY = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(meg|Meg|MEG|[pnuµμmkKMG])?\s*(Ω|ohms?|Ohms?|V|A|F|H|Hz|s|W)?$/

export interface Quantity {
  value: number
  /** Normalised unit symbol, or '' when none was written. */
  unit: string
}

/** "10k" → 10000, "4.7 kΩ" → 4700, "100n" → 1e-7, "9V" → 9. Null if unreadable. */
export function parseQuantity(text: string): Quantity | null {
  const m = QUANTITY.exec(text.trim().replace(/\s+/g, ' '))
  if (!m) return null
  const prefix = m[2] ? SI[m[2]] : 1
  const value = Number((Number(m[1]) * prefix).toPrecision(12))
  if (!Number.isFinite(value)) return null
  const raw = m[3] ?? ''
  const unit = /^ohm/i.test(raw) ? 'Ω' : raw
  return { value, unit }
}

const sanitizeVar = (kind: string) => kind.replace(/[^a-z0-9]/gi, '_')

/** Emit a JS-safe anchor access for a pin, or null if the kind has no such pin. */
function pinAccess(kind: string, pin: string): string | null {
  const alias = PIN_ALIAS[pin]
  if (alias && anchorValid(kind, alias)) return alias
  if (/^[A-Za-z_$][\w$]*$/.test(pin)) return anchorValid(kind, pin) ? pin : null
  const idx = ANCHOR_INDEX[kind]?.[pin]
  return idx === undefined ? null : `pin${idx}`
}

const fmtNum = (n: number) => String(Number(n.toPrecision(12)))

export function compileIR(input: unknown, options: CompileOptions = {}): CompileResult {
  const errors: CompileError[] = []
  const warnings: string[] = []
  const doubts: SketchIRDoubt[] = []
  const fail = (): CompileResult => ({ ok: false, script: '', errors, warnings, doubts })
  const addDoubt = (d: SketchIRDoubt) => {
    if (!doubts.some((x) => x.ref === d.ref && x.why === d.why)) doubts.push(d)
  }

  const parsed = SketchIR.safeParse(input)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ code: 'schema', message: `${issue.path.join('.') || 'ir'}: ${issue.message}` })
    }
    return fail()
  }
  const ir = parsed.data
  for (const d of ir.doubts) addDoubt(d)

  if (!SUPPORTED.has(ir.domain)) {
    errors.push({
      code: 'unsupported-domain',
      message: `domain "${ir.domain}" is not compiled yet — circuit, digital, mechanics and optics only`,
    })
    return fail()
  }
  if (ir.domain === 'mechanics') return compileMechanicsIR(ir)
  if (ir.domain === 'optics') return compileOpticsIR(ir)

  // ── nodes ────────────────────────────────────────────────────────────────
  const byId = new Map<string, SketchIRNode>()
  const kindOf = new Map<string, string>()
  const varOf = new Map<string, string>()
  const counters: Record<string, number> = {}

  for (const node of ir.nodes) {
    if (byId.has(node.id)) {
      errors.push({ code: 'duplicate-node', message: `node id "${node.id}" appears twice`, ref: node.id })
      continue
    }
    byId.set(node.id, node)
    const kind = node.cls.trim().toLowerCase()
    if (NOT_COMPONENTS.has(kind)) {
      errors.push({
        code: 'not-a-component',
        message: `"${node.cls}" is not a component — wires, junction dots and text are handled before the IR`,
        ref: node.id,
      })
      continue
    }
    if (!KNOWN_KINDS.has(kind)) {
      errors.push({ code: 'unknown-class', message: `unknown class "${node.cls}" — not a SimScript component`, ref: node.id })
      continue
    }
    kindOf.set(node.id, kind)
    const base = sanitizeVar(kind)
    counters[base] = (counters[base] ?? 0) + 1
    varOf.set(node.id, `${base}${counters[base]}`)
    if (node.conf < 0.6) addDoubt({ ref: node.id, why: 'low-confidence' })
  }

  // ── edges ────────────────────────────────────────────────────────────────
  const connects: string[] = []
  const seen = new Set<string>()
  for (const edge of ir.edges) {
    const desc = `${edge.a.node}.${edge.a.pin} — ${edge.b.node}.${edge.b.pin}`
    if (edge.kind !== 'wire') {
      errors.push({ code: 'bad-edge-kind', message: `${ir.domain} edges must be wires, got "${edge.kind}" (${desc})`, ref: desc })
      continue
    }
    let bad = false
    const ends: string[] = []
    for (const end of [edge.a, edge.b]) {
      if (!byId.has(end.node)) {
        errors.push({ code: 'unknown-node', message: `edge refers to node "${end.node}" which does not exist (${desc})`, ref: desc })
        bad = true
        continue
      }
      const kind = kindOf.get(end.node)
      if (!kind) { bad = true; continue } // its own error is already reported
      const access = pinAccess(kind, end.pin)
      if (!access) {
        errors.push({ code: 'bad-pin', message: `${kind} "${end.node}" has no pin "${end.pin}" (${desc})`, ref: desc })
        bad = true
        continue
      }
      ends.push(`${varOf.get(end.node)}.${access}`)
    }
    if (bad) continue
    if (ends[0] === ends[1]) {
      errors.push({ code: 'self-loop', message: `a wire from a pin to itself (${desc})`, ref: desc })
      continue
    }
    const key = [...ends].sort().join('|')
    if (seen.has(key)) {
      warnings.push(`duplicate wire ${desc} ignored`)
      continue
    }
    seen.add(key)
    connects.push(`connect(${ends[0]}, ${ends[1]});`)
    if (edge.conf < 0.6) addDoubt({ ref: desc, why: 'ambiguous-junction' })
  }

  // ── values ───────────────────────────────────────────────────────────────
  const labelFor = new Map<string, string[]>()
  for (const label of ir.labels) {
    if (!label.attachedTo) continue
    labelFor.set(label.attachedTo, [...(labelFor.get(label.attachedTo) ?? []), label.text])
  }

  const propsOf = (node: SketchIRNode, kind: string): Array<[string, string]> => {
    const accepted = PARAMS[kind] ?? []
    const out = new Map<string, string>()
    for (const [key, text] of Object.entries(node.values ?? {})) {
      if (!accepted.includes(key)) {
        errors.push({
          code: 'unknown-param',
          message: `${kind} has no parameter "${key}"${accepted.length ? ` — it takes ${accepted.join(', ')}` : ''}`,
          ref: node.id,
        })
        continue
      }
      const q = parseQuantity(text)
      if (!q) {
        addDoubt({ ref: node.id, why: 'unreadable-value' })
        warnings.push(`could not read "${text}" as a value for ${node.id}.${key}`)
        continue
      }
      out.set(key, fmtNum(q.value))
    }
    // A value written beside the part, when the part itself carries none.
    const main = MAIN_PARAM[kind]
    if (main && !out.has(main)) {
      for (const text of labelFor.get(node.id) ?? []) {
        const q = parseQuantity(text)
        if (!q) continue
        if (q.unit && UNIT_PARAM[q.unit] !== main) continue
        out.set(main, fmtNum(q.value))
        break
      }
    }
    if (kind === 'battery' && !out.has('V')) {
      out.set('V', String(DEFAULT_BATTERY_V))
      addDoubt({ ref: node.id, why: 'unreadable-value' })
      warnings.push(`${node.id}: no voltage given — defaulted to ${DEFAULT_BATTERY_V} V`)
    }
    return [...out]
  }

  if (errors.length) return fail()

  // ── emit ─────────────────────────────────────────────────────────────────
  const keep = options.layout === 'keep'
  const minX = ir.nodes.length ? Math.min(...ir.nodes.map((n) => n.bbox[0])) : 0
  const minY = ir.nodes.length ? Math.min(...ir.nodes.map((n) => n.bbox[1])) : 0
  const lines: string[] = []

  for (const node of ir.nodes) {
    const kind = kindOf.get(node.id)!
    const props: string[] = propsOf(node, kind).map(([k, v]) => `${k}: ${v}`)
    if (keep) {
      // +10 keeps every coordinate non-zero: only a non-zero x/y counts as placed.
      props.push(`x: ${Math.round(node.bbox[0] - minX) + 10}`, `y: ${Math.round(node.bbox[1] - minY) + 10}`)
      if (node.rot) props.push(`rotation: ${node.rot}`)
      if (node.flip) props.push('flipH: true')
    }
    lines.push(`var ${varOf.get(node.id)} = create("${kind}", ${props.length ? `{ ${props.join(', ')} }` : '{}'});`)
  }
  if (errors.length) return fail()

  lines.push(...connects)

  if (ir.domain === 'circuit' && options.plot !== false) {
    const load = ir.nodes.find((n) => ['resistor', 'bulb', 'led', 'diode'].includes(kindOf.get(n.id)!) && channelsOf(kindOf.get(n.id)!).includes('I'))
    if (load) lines.push(`graph.plot(${varOf.get(load.id)}.I);`)
  }

  const script = lines.join('\n')
  const lint = lintSimScript(script)
  if (!lint.ok) {
    for (const message of lint.errors) errors.push({ code: 'lint', message: `compiler bug — emitted a script that fails lint: ${message}` })
    return fail()
  }
  return { ok: true, script, errors, warnings: [...warnings, ...lint.warnings], doubts }
}
