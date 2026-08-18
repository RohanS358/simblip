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
import { BEHAVIOR_SPECS } from '@/lib/behaviors/registry'
import {
  ANCHOR_INDEX, CHANNELS_BY_SYMBOL, DEFAULT_SYMBOL_CHANNELS, BODY_CHANNELS,
  DIELECTRIC_CHANNELS,
  SILENT_SYMBOLS,
} from '@/lib/scene/simscript-props'

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
  const body = (fenced ? fenced[1] : source.replace(/```[a-zA-Z]*\n?/g, '')).trim()
  if (fenced) return body
  // Unfenced prose preamble ("Here is the script:") — drop everything before
  // the first line that actually looks like SimScript. Same reasoning as
  // fences: a model round is far too expensive to spend on chit-chat we can
  // strip for free. Only trims when a real statement is found, so a script
  // that is ALL prose still fails loudly rather than becoming empty.
  const lines = body.split('\n')
  const first = lines.findIndex((l) => /^\s*(?:var|let|const)\s|^\s*(?:connect|create|addproperty|graph)\s*[.(]|^\s*\/\//.test(l))
  return first > 0 ? lines.slice(first).join('\n').trim() : body
}

/**
 * Blank out comments, keeping the string the same length.
 *
 * Replacing with spaces rather than deleting keeps every character offset
 * intact, so positions reported from the scanned text still line up with the
 * source the user (and the model) sees.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
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

/**
 * Split `obj.member` into its two parts.
 *
 * Returns null for anything that is not exactly one level deep. Chained
 * access (`battery.channel.V`, `bulb.a.x`) is never valid SimScript — an
 * anchor or channel is always a single property — and the model reaches for
 * it when it is unsure of the real name. Matching loosely here let those
 * through silently, producing a plot of nothing.
 */
function splitAccess(arg: string): { varName: string; member: string } | null {
  const m = arg.match(/^([a-zA-Z_$][\w$]*)\s*\.\s*([a-zA-Z_$][\w$]*)$/)
  return m ? { varName: m[1], member: m[2] } : null
}

/** Is this a deeper property chain than SimScript allows? */
const isChained = (arg: string): boolean => /^[a-zA-Z_$][\w$]*(?:\s*\.\s*[a-zA-Z_$][\w$]*){2,}$/.test(arg)

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

/** Line-kind mechanics components that ONLY exist as a constraint between two
 *  bodies. Mirrors MECHANICS_COMPONENTS in lib/scene/simscript.ts. */
const CONNECTOR_KINDS = new Set(['spring', 'rope', 'rod', 'damper'])

/** Kinds that fall under gravity, so a scene containing one usually wants
 *  something to land on. */
const FALLING_KINDS = new Set(['mass', 'block', 'beam', 'wheel', 'motor'])

/** Kinds that are positioned by hand rather than by the circuit auto-layout —
 *  every mechanics/optics/waves kind. Circuit symbols are deliberately absent:
 *  passing x/y to those fights the schematic layout engine. */
const PLACED_KINDS = new Set([
  ...CONNECTOR_KINDS, ...FALLING_KINDS,
  'ground', 'hinge', 'charge', 'efield', 'bfield', 'heat-block', 'heatblock',
  'torsion-pendulum', 'torsionpendulum', 'reference-point',
  'light-source', 'lightsource', 'thin-lens', 'lens', 'optical-mirror',
  'optical-screen', 'slit', 'wave-source', 'wave-boundary',
])

/** The channels a kind really publishes, for graph.plot checking. */
function channelsOf(kind: string): string[] {
  if (kind === 'dielectric') return [...DIELECTRIC_CHANNELS]
  if (MECHANICS_KINDS.has(kind)) return [...BODY_CHANNELS]
  if (SILENT_SYMBOLS.includes(kind)) return []
  const named = CHANNELS_BY_SYMBOL[kind]
  // A circuit symbol with no named entry reports the standard V/I/P.
  if (named) return [...named]
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
    // The newlines are load-bearing: without them a script ending in a
    // `// comment` swallows the closing brace and every valid trailing
    // comment reads as a syntax error.
    // eslint-disable-next-line no-new-func
    new Function('sandbox', `with(sandbox) {\n${transpiled}\n}`)
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

  // Every check below scans text, so commented-out code would still match —
  // and a model that fixes an error by commenting the line out (a correct
  // fix, and the one it reaches for most) would be flagged forever, making
  // the repair loop unwinnable. Blank the comments, preserving offsets so
  // any future line-number reporting stays accurate.
  const code = stripComments(cleaned)
  const kinds = varKinds(code)

  // 2. create() kinds.
  const createRe = /create\s*\(\s*(['"])([^'"]+)\1/g
  let m: RegExpExecArray | null
  while ((m = createRe.exec(code)) !== null) {
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
  while ((m = connectRe.exec(code)) !== null) {
    const raw = m[1]
    const args = raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (args.length < 2) {
      errors.push(`connect(${raw.trim()}) needs two anchors`)
      continue
    }
    for (const arg of args.slice(0, 2)) {
      if (isChained(arg)) {
        const root = arg.split('.')[0].trim()
        errors.push(
          `connect(${raw.trim()}) — "${arg}" goes too deep; an anchor is one property, e.g. ${root}.${anchorNames(kinds[root] ?? '')[0] ?? 'a'}`
        )
        continue
      }
      const parts = splitAccess(arg)
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
      const { varName, member: anchor } = parts
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
  while ((m = plotRe.exec(code)) !== null) {
    for (const arg of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/^['"]/.test(arg)) continue // a style string ("line", "bar", …)
      if (isChained(arg)) {
        const root = arg.split('.')[0].trim()
        const legal = channelsOf(kinds[root] ?? '')
        errors.push(
          `graph.plot(${arg}) — "${arg}" goes too deep; plot a channel directly` +
            (legal.length > 0 ? `, e.g. ${root}.${legal[0]} (valid: ${legal.join(', ')})` : '')
        )
        continue
      }
      const parts = splitAccess(arg)
      if (!parts) continue
      const { varName, member: channel } = parts
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
  while ((m = addRe.exec(code)) !== null) {
    const kind = kinds[m[1]]
    if (!kind) continue
    const isCircuit = ANCHOR_INDEX[kind] !== undefined
    if (isCircuit && /^(rigidBody|staticBody|spring|rope|rod|damper|hinge|motor)$/i.test(m[3])) {
      errors.push(
        `addproperty(${m[1]}, "${m[3]}") — "${kind}" is a circuit component, not a physical body; drop this line`
      )
    }
  }

  // 5b. Params that do not exist.
  //
  // addproperty() copies EVERY key straight into behavior.params
  // (lib/scene/simscript.ts) — nothing checks the name against the registry.
  // So `addproperty(slab, "efield", { epsr: 4 })` stored epsr, the solver
  // never read it, and the script "succeeded" while modelling nothing. That
  // is the worst failure mode available: silent, and indistinguishable from
  // success. A question about a dielectric got a scene with no dielectric.
  //
  // The registry already declares every valid param, so this is a lookup.
  const addFull = /addproperty\s*\(\s*([a-zA-Z_$][\w$]*)\s*,\s*(['"])([^'"]+)\2\s*,\s*\{([^}]*)\}/g
  while ((m = addFull.exec(code)) !== null) {
    const spec = BEHAVIOR_SPECS.find((b) => b.type === m![3])
    if (!spec) continue
    const allowed = new Set(spec.params.map((p) => p.name))
    if (allowed.size === 0) continue
    for (const km of m[4].matchAll(/([a-zA-Z_$][\w$]*)\s*:/g)) {
      if (allowed.has(km[1])) continue
      const list = [...allowed].join(', ')
      errors.push(
        `addproperty(${m[1]}, "${m[3]}", { ${km[1]}: … }) — "${m[3]}" has no "${km[1]}" param, so it would be silently ignored. Valid: ${list}`
      )
    }
  }

  // 6. Soft signals.
  // 6. Mechanics soundness — the scenes that lint clean and simulate DEAD.
  //
  // Everything above checks that the script is well-formed. None of it checks
  // that the result moves. These three failures all produce a canvas that
  // looks built and does nothing, which is the regression users actually
  // report ("the simulation stopped working"), so they are errors, not
  // warnings: the repair loop can fix each one with a single added call.
  const createdKinds = new Set(Object.values(kinds))

  // (a) A spring/rope/rod/damper IS a constraint. Created and never connected,
  // it is a line on the canvas that binds nothing — buildWorld pairs it to
  // bodies by what its endpoints touch, and an unconnected one touches air.
  for (const [varName, kind] of Object.entries(kinds)) {
    if (!CONNECTOR_KINDS.has(kind)) continue
    const used = new RegExp(`connect\\s*\\([^()]*\\b${varName}\\s*\\.`).test(code)
    if (!used) {
      errors.push(
        `"${varName}" is a ${kind} — a ${kind} only does something once both ends are attached; ` +
          `add connect(${varName}.a, <body>.centre); and connect(${varName}.b, <other>.centre);`
      )
    }
  }

  // (b) connect() between two physical bodies with no type makes a "wire" —
  // an ELECTRICAL behavior. It draws a line and applies zero physics, so the
  // bodies just fall independently.
  const typedConnectRe = /connect\s*\(([^()]*)\)/g
  let cm: RegExpExecArray | null
  while ((cm = typedConnectRe.exec(code)) !== null) {
    const args = cm[1].split(',').map((a) => a.trim()).filter(Boolean)
    if (args.length !== 2) continue // a third arg is the type — already fine
    const kindOfArg = (a: string) => kinds[splitAccess(a)?.varName ?? a]
    const [k1, k2] = [kindOfArg(args[0]), kindOfArg(args[1])]
    if (!k1 || !k2) continue
    // Only flag body↔body. A connector endpoint (rod.a) is bound geometrically
    // and needs no type, and circuit symbols legitimately take the wire default.
    const physical = (k: string) => FALLING_KINDS.has(k) || k === 'ground' || k === 'hinge'
    if (physical(k1) && physical(k2)) {
      errors.push(
        `connect(${cm[1].trim()}) joins two physical bodies with a "wire", which is electrical and applies no force — ` +
          `add a type: connect(${args[0]}, ${args[1]}, "rod") (or "rope"/"spring"/"damper")`
      )
    }
  }

  // (c) Mechanics kinds are placed by hand — the circuit auto-layout never
  // touches them. Omitting x/y stacks every body on the same origin pixel,
  // so they start interpenetrating and explode apart on the first frame.
  const placedNoPos: string[] = []
  const createCallRe = /(?:var|let|const)?\s*([a-zA-Z_$][\w$]*)\s*=\s*create\s*\(\s*(['"])([^'"]+)\2\s*(?:,\s*(\{[^{}]*\}))?\s*\)/g
  while ((cm = createCallRe.exec(code)) !== null) {
    const kind = cm[3].toLowerCase()
    if (!PLACED_KINDS.has(kind)) continue
    // A connector's span comes from `length`, and its position from the ends
    // connect() drags it to — it genuinely does not need x/y.
    if (CONNECTOR_KINDS.has(kind)) continue
    const props = cm[4] ?? ''
    // A body held by a connector is placed by that link, not by x/y — the
    // connector drags its endpoints onto whatever it was told to bind.
    const linked = new RegExp(`connect\\s*\\([^()]*\\b${cm[1]}\\s*\\.`).test(code)
    if (linked) continue
    if (!/\bx\s*:/.test(props) || !/\by\s*:/.test(props)) placedNoPos.push(cm[1])
  }
  if (placedNoPos.length > 1) {
    errors.push(
      `${placedNoPos.map((v) => `"${v}"`).join(', ')} are mechanics/optics components with no x/y — ` +
        `these are NOT auto-laid-out like circuits, so they all stack on one point. Give each an x and y (canvas px, +y is down).`
    )
  }

  // (d) A body under gravity with nothing to land on falls forever, off-canvas
  // within a second. A warning, not an error: free-fall and projectile scenes
  // are legitimately groundless, and a graph of the fall is a real answer.
  const hasFalling = [...createdKinds].some((k) => FALLING_KINDS.has(k))
  const hasSupport = [...createdKinds].some((k) =>
    k === 'ground' || k === 'hinge' || CONNECTOR_KINDS.has(k))
  if (hasFalling && !hasSupport) {
    warnings.push(
      'nothing in this scene supports the bodies — they fall off-canvas in about a second. ' +
        'Add create("ground", { x, y, width }) below them unless free fall is the point.'
    )
  }

  if (/\bawait\b|\basync\b/.test(code)) warnings.push('SimScript is synchronous — async/await does nothing')
  if (/document\.|window\./.test(code)) warnings.push('DOM access does nothing inside SimScript')

  return { ok: errors.length === 0, errors, warnings, cleaned }
}
