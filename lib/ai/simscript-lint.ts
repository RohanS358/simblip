// SimScript linter — pure, runs on the server and in the browser. Used by
// the training pipeline to guarantee every dataset sample is executable, and
// by /api/ai's generate→verify→repair loop.
//
// This is where the AI pipeline's reliability comes from. Generation costs
// ~2s of GPU; verification costs microseconds and no model at all — so the
// common case pays nothing for safety and only real failures cost a retry.
//
// It cannot fully execute a script (that needs the document store), but it
// checks everything that is decidable from the source text, against the SAME
// registries the runtime uses — never a hand-copied list, so a check here
// cannot drift from what actually happens on the canvas.
//
// Every error string is phrased as a REPAIR INSTRUCTION, not a diagnosis:
// the repair prompt is literally "here is your script, here are the errors,
// fix exactly these", and small models follow a concrete fix far better than
// they recover from "invalid anchor".

import { KNOWN_KINDS } from './simscript-corpus'
import { ANCHOR_INDEX } from '@/lib/scene/simscript-props'
import {
  channelsForKind, DEFAULT_SYMBOL_CHANNELS, BODY_CHANNELS, SILENT_SYMBOLS,
} from '@/lib/scene/channels'

export interface LintResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  /** The source with markdown fences stripped — what should actually be run
   *  or fed back for repair. Always set, even when `ok` is false. */
  cleaned: string
}

const GENERIC_OK = new Set(['rect', 'circle', 'line', 'polygon'])

/** Kinds that carry a rigidBody, so they stream motion channels. Mirrors
 *  MECHANICS_COMPONENTS in lib/scene/simscript.ts. */
const MECHANICS_KINDS = new Set([
  'mass', 'block', 'beam', 'wheel', 'motor', 'charge', 'reference-point',
])

/** Anchor names that resolve positionally rather than through a symbol's
 *  table — the runtime's numeric ('pin0', 't1') and conventional ('centre',
 *  'in', 'out') fallbacks. See resolveAnchor in lib/scene/simscript.ts;
 *  treating these as unknown would be a false positive. */
const POSITIONAL_ANCHOR = /^(?:centre|center|in|out|positive|negative|anode|cathode|terminal|(?:pin|t|terminal)?\d+)$/i

/**
 * Markdown fences are stripped, never treated as a hard failure.
 *
 * Every local model wraps code in them. Erroring would spend a full ~2s
 * generation round to fix what one replace() handles for free. The corpus
 * still teaches "no fences" (it costs output tokens), but no model round is
 * ever burned on it.
 */
function stripFences(source: string): string {
  const fenced = source.match(/```(?:[a-zA-Z]*)\n([\s\S]*?)```/)
  return (fenced ? fenced[1] : source.replace(/```[a-zA-Z]*\n?/g, '')).trim()
}

/**
 * `var x = create("kind", …)` → `{ x: "kind" }`.
 *
 * The enabling primitive for every semantic check below: without knowing
 * which kind a variable holds, `connect(a.foo, b.bar)` is unverifiable.
 */
function varKinds(source: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /(?:var|let|const)?\s*([a-zA-Z_$][\w$]*)\s*=\s*create\s*\(\s*(['"])([^'"]+)\2/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) out[m[1]] = m[3].toLowerCase()
  return out
}

/** Does `kind` accept `anchor`? Mirrors resolveAnchor's lookup order exactly
 *  (raw name, then input→in / output→out normalized, then _t2, then the
 *  positional fallbacks) so a name the runtime WOULD resolve never errors. */
function anchorValid(kind: string, anchor: string): boolean {
  if (POSITIONAL_ANCHOR.test(anchor)) return true
  const norm = anchor.replace(/^input/i, 'in').replace(/^output/i, 'out')
  const map = ANCHOR_INDEX[kind] ?? {}
  return anchor in map || norm in map || anchor in ANCHOR_INDEX._t2 || norm in ANCHOR_INDEX._t2
}

/**
 * The anchor names to SUGGEST for a kind, idiomatic ones first.
 *
 * A resistor's table lists `input1, input2, in1, in2, a, b, in, out` — all
 * valid, but the corpus teaches `a`/`b`, so leading with `input1` pushes the
 * model toward the spelling its training data uses least. Order the hint the
 * way we want the model to write.
 */
const PREFERRED_ANCHORS = ['a', 'b', 'positive', 'negative', 'anode', 'cathode', 'in', 'out']

function anchorNames(kind: string): string[] {
  const all = Object.keys(ANCHOR_INDEX[kind] ?? {})
  const preferred = PREFERRED_ANCHORS.filter((n) => all.includes(n))
  const rest = all.filter((n) => !preferred.includes(n))
  return [...preferred, ...rest].slice(0, 6)
}

/** The channels a kind really publishes, for graph.plot checking. */
function channelsOf(kind: string): string[] {
  const mech = MECHANICS_KINDS.has(kind)
  if (mech) return [...BODY_CHANNELS]
  if (SILENT_SYMBOLS.has(kind)) return []
  const named = channelsForKind(kind)
  // A circuit symbol with no named entry reports the standard V/I/P.
  if (named.length > 0) return named
  return KNOWN_KINDS.has(kind) ? [...DEFAULT_SYMBOL_CHANNELS] : []
}

export function lintSimScript(source: string): LintResult {
  const errors: string[] = []
  const warnings: string[] = []
  const cleaned = stripFences(source)
  const fail = () => ({ ok: false, errors, warnings, cleaned })

  if (cleaned !== source.trim()) {
    warnings.push('markdown fences were stripped — emit bare SimScript, it costs fewer tokens')
  }

  // 1. Syntax — same transpile the runtime applies before executing. A
  // reserved word (`var switch = …`, which the model reaches for constantly)
  // surfaces here.
  const transpiled = cleaned.replace(/\b(var|let|const)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/g, '$2')
  try {
    // eslint-disable-next-line no-new-func
    new Function('sandbox', `with(sandbox) { ${transpiled} }`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Name the actual cause when it is the usual one: "Unexpected token '='"
    // is not something a 7B can act on; "switch is a reserved word" is.
    const reserved = cleaned.match(/\b(?:var|let|const)\s+(switch|class|new|delete|for|if|else|return|function|this|with|do|in|case|default|void|typeof)\b/)
    errors.push(
      reserved
        ? `syntax: "${reserved[1]}" is a reserved JavaScript word and cannot be a variable name — rename it (e.g. ${reserved[1]}1)`
        : `syntax: ${msg}`
    )
    return fail()
  }

  const kinds = varKinds(cleaned)

  // 2. create() kinds.
  const createRe = /create\s*\(\s*(['"])([^'"]+)\1/g
  let m: RegExpExecArray | null
  while ((m = createRe.exec(cleaned)) !== null) {
    const kind = m[2].toLowerCase()
    if (kind === 'graph') {
      errors.push('create("graph") is wrong — use graph.plot(obj.channel) instead')
      continue
    }
    if (kind === 'symbol') {
      errors.push('create("symbol", …) is wrong — create the component kind directly, e.g. create("resistor")')
      continue
    }
    if (!KNOWN_KINDS.has(kind) && !GENERIC_OK.has(kind)) {
      errors.push(`unknown kind "${m[2]}" — not a SimScript component`)
    }
  }

  // 3. connect() arity AND anchors.
  //
  // Arity alone was never enough: `connect(sw.b, bulb)` has two arguments and
  // silently wires to nothing, producing a scene that LOOKS built but is not
  // connected — the worst failure mode, because it is invisible.
  const connectRe = /connect\s*\(([^()]*)\)/g
  while ((m = connectRe.exec(cleaned)) !== null) {
    const raw = m[1]
    const args = raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (args.length < 2) {
      errors.push(`connect(${raw.trim()}) needs two anchors`)
      continue
    }
    for (const arg of args.slice(0, 2)) {
      const parts = arg.match(/^([a-zA-Z_$][\w$]*)\s*\.\s*([a-zA-Z_$][\w$]*)$/)
      if (!parts) {
        // A bare identifier that we know is an object is the missing-anchor case.
        const bare = arg.match(/^([a-zA-Z_$][\w$]*)$/)
        if (bare && kinds[bare[1]]) {
          const kind = kinds[bare[1]]
          const names = anchorNames(kind)
          errors.push(
            `connect(${raw.trim()}) — "${bare[1]}" is missing an anchor; write ${bare[1]}.${names[0] ?? 'a'}` +
              (names.length > 1 ? ` (valid: ${names.join(', ')})` : '')
          )
        }
        continue
      }
      const [, varName, anchor] = parts
      const kind = kinds[varName]
      if (!kind) continue // unknown variable — not this check's business
      if (!anchorValid(kind, anchor)) {
        const names = anchorNames(kind)
        errors.push(
          `connect(${raw.trim()}) — "${kind}" has no anchor "${anchor}"` +
            (names.length > 0 ? `; use one of: ${names.join(', ')}` : '')
        )
      }
    }
  }

  // 4. graph.plot() channels. `graph.plot(bulb.channel)` parses fine and
  // plots nothing; the model invents `.channel`, `.value`, `.output` freely.
  const plotRe = /graph\s*\.\s*plot\s*\(([^()]*)\)/g
  while ((m = plotRe.exec(cleaned)) !== null) {
    for (const arg of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/^['"]/.test(arg)) continue // a style string ("line", "bar", …)
      const parts = arg.match(/^([a-zA-Z_$][\w$]*)\s*\.\s*([a-zA-Z_$][\w$]*)$/)
      if (!parts) continue
      const [, varName, channel] = parts
      const kind = kinds[varName]
      if (!kind) continue
      const legal = channelsOf(kind)
      if (legal.length === 0) {
        errors.push(`graph.plot(${arg}) — "${kind}" publishes no data and cannot be plotted`)
      } else if (!legal.includes(channel)) {
        errors.push(`graph.plot(${arg}) — "${kind}" has no channel "${channel}"; use one of: ${legal.join(', ')}`)
      }
    }
  }

  // 5. addproperty() sanity. Physics on a battery is nonsense, and the model
  // reaches for rigidBody reflexively on anything it has just created.
  const addRe = /addproperty\s*\(\s*([a-zA-Z_$][\w$]*)\s*,\s*(['"])([^'"]+)\2/g
  while ((m = addRe.exec(cleaned)) !== null) {
    const kind = kinds[m[1]]
    if (!kind) continue
    const isCircuit = ANCHOR_INDEX[kind] !== undefined
    if (isCircuit && /^(rigidBody|staticBody|spring|rope|rod|damper|hinge|motor)$/i.test(m[3])) {
      errors.push(
        `addproperty(${m[1]}, "${m[3]}") — "${kind}" is a circuit component, not a physical body; drop this line`
      )
    }
  }

  // 6. Soft signals.
  if (/\bawait\b|\basync\b/.test(cleaned)) warnings.push('SimScript is synchronous — async/await does nothing')
  if (/document\.|window\./.test(cleaned)) warnings.push('DOM access does nothing inside SimScript')

  return { ok: errors.length === 0, errors, warnings, cleaned }
}
