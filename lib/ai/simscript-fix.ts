// Deterministic SimScript repair — the model round we don't have to spend.
//
// The generate→lint→repair loop costs a FULL generation (~2.2s of GPU) per
// repair attempt, and measured on held-out course prompts the majority of
// first-pass failures are not design mistakes at all. They are spelling:
// `.voltage` for `.V`, `battery.a` for `battery.positive`, `create("cap")`,
// `var switch = …`. A 7B fixes those by regenerating the whole scene — often
// losing parts that were already right — when a table lookup fixes them for
// free.
//
// So: run this BEFORE the linter. Anything it repairs never becomes an error,
// never reaches the repair prompt, and never costs a round.
//
// THE RULE FOR ADDING A FIX HERE: it must be unambiguous. A wrong autofix is
// worse than an error, because the linter then passes it and the user gets a
// scene that looks built and is silently wrong. That is why `connect(sw, bulb)`
// (a missing anchor) is NOT fixed here — picking a terminal for the model
// would invent wiring. Every rule below either has one legal answer or makes
// no change at all.
//
// Reuses the linter's registry-derived helpers, never its own copy of the
// tables — same reason simscript-lint.ts reads the real registries.

import { KNOWN_KINDS } from './simscript-corpus'
import {
  varKinds, anchorValid, anchorNames, channelsOf, GENERIC_OK,
  CREATE_CALL_SOURCE, PLACED_KINDS, CONNECTOR_KINDS, paramsOf, GEOMETRY_PARAMS,
} from './simscript-lint'

export interface FixResult {
  code: string
  /** What was changed, one line each — surfaced as generation warnings so a
   *  systematically bad habit stays visible instead of being papered over. */
  notes: string[]
}

/** JavaScript reserved words the model reaches for as variable names. `switch`
 *  is the constant offender (it is also a component kind, so it reads as the
 *  obvious name); the rest come from the same instinct. A reserved name is a
 *  hard syntax error, which makes the linter bail before any other check runs
 *  — so this fix also unblocks every check downstream of it. */
const RESERVED = [
  'switch', 'class', 'new', 'delete', 'for', 'if', 'else', 'return',
  'function', 'this', 'with', 'do', 'in', 'case', 'default', 'void', 'typeof',
]

/** Names the model invents for kinds that already exist. Abbreviations and
 *  plain-English synonyms only — never a guess between two real kinds (`gnd`
 *  and `ground` are both real and mean different things, so neither maps). */
const KIND_ALIASES: Record<string, string> = {
  cap: 'capacitor', capacitance: 'capacitor',
  res: 'resistor', resistance: 'resistor', resistors: 'resistor',
  ind: 'inductor', inductance: 'inductor',
  lamp: 'bulb', lightbulb: 'bulb', 'light-bulb': 'bulb', globe: 'bulb',
  cell: 'battery', 'dc-source': 'battery', dcsource: 'battery', 'voltage-source': 'battery',
  acsource: 'ac-source', 'ac-voltage-source': 'ac-source', 'sine-source': 'ac-source',
  transistor: 'bjt', npn: 'bjt', pnp: 'bjt-pnp',
  nmos: 'mosfet', pmos: 'mosfet-pmos',
  pot: 'potentiometer', rheostat: 'potentiometer',
  'op-amp': 'opamp', 'operational-amplifier': 'opamp',
  lens: 'thin-lens', mirror: 'optical-mirror', screen: 'optical-screen',
  weight: 'mass', body: 'mass', ball: 'mass', bob: 'mass',
  textbox: 'text', label: 'text', comment: 'note', sticky: 'note',
  equation: 'formula', latex: 'formula',
}

/** Anchor names the model invents, mapped to the one the runtime resolves.
 *  Pair-wise and unambiguous: `p`/`n` is only ever a source's terminals. */
const ANCHOR_ALIASES: Record<string, string> = {
  p: 'positive', plus: 'positive', pos: 'positive', vcc: 'positive', vin: 'positive',
  n: 'negative', minus: 'negative', neg: 'negative', gnd: 'negative', vout: 'out',
  left: 'a', right: 'b', node1: 'a', node2: 'b', one: 'a', two: 'b',
  select: 'sel', selector: 'sel', enable: 'en', clock: 'clk', reset: 'rst',
  start: 'a', end: 'b', from: 'a', to: 'b',
  center: 'centre', middle: 'centre', origin: 'centre',
  b: 'base', c: 'collector', e: 'emitter', // bjt shorthand; guarded below
  g: 'gate', d: 'drain', s: 'source',
  input: 'in', output: 'out',
}

/** Channel names the model invents. The registry spells these `V`, `I`, `P`,
 *  `speed`, `omega`, `ke` — a model writes them out in words. */
const CHANNEL_ALIASES: Record<string, string> = {
  voltage: 'V', volt: 'V', volts: 'V', emf: 'V', potential: 'V',
  current: 'I', amps: 'I', amperes: 'I', amperage: 'I',
  power: 'P', watts: 'P', wattage: 'P',
  velocity: 'speed', vel: 'speed', magnitude: 'speed',
  position: 'x', pos: 'x', displacement: 'x', disp: 'x', distance: 'x',
  height: 'y', altitude: 'y', depth: 'y',
  'angular-velocity': 'omega', angularvelocity: 'omega', spin: 'omega', w: 'omega',
  theta: 'angle', ang: 'angle', rotation: 'angle',
  energy: 'ke', kineticenergy: 'ke', 'kinetic-energy': 'ke', ke_energy: 'ke',
}

/** Which `domain:` a system full of these kinds should declare. Mechanics is
 *  the fallback because it is what the overwhelming majority of placed scenes
 *  are, and it is what every corpus example uses. */
const DOMAIN_KINDS: [string, Set<string>][] = [
  ['optics', new Set(['light-source', 'lightsource', 'thin-lens', 'lens', 'optical-mirror', 'optical-screen', 'slit'])],
  ['waves', new Set(['wave-source', 'wave-boundary', 'transmission-line'])],
  ['quantum', new Set(['quantum-well', 'tunnel-barrier'])],
]

/** Placed components with explicit coordinates, and any system rects already
 *  declared. Mirrors the geometry simscript-lint.ts checks in rule (d) — same
 *  parser, same default size, so a rect this builds always satisfies it. */
const DEFAULT_SIZE = 64

interface Placed { cx: number; cy: number; kind: string }
interface SysRect { x: number; y: number; w: number; h: number; text: string }

function readScene(code: string): { placed: Placed[]; systems: SysRect[] } {
  const re = new RegExp(CREATE_CALL_SOURCE, 'g')
  const placed: Placed[] = []
  const systems: SysRect[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const kind = m[3].toLowerCase()
    const props = m[4] ?? ''
    const num = (r: RegExp) => {
      const hit = r.exec(props)
      return hit ? Number(hit[1]) : undefined
    }
    if (kind === 'system') {
      systems.push({
        x: num(/\bx\s*:\s*(-?\d+(?:\.\d+)?)/) ?? 0,
        y: num(/\by\s*:\s*(-?\d+(?:\.\d+)?)/) ?? 0,
        w: num(/\bwidth\s*:\s*(-?\d+(?:\.\d+)?)/) ?? 460,
        h: num(/\bheight\s*:\s*(-?\d+(?:\.\d+)?)/) ?? 320,
        text: m[0],
      })
      continue
    }
    if (!PLACED_KINDS.has(kind) || CONNECTOR_KINDS.has(kind)) continue
    const x = num(/\bx\s*:\s*(-?\d+(?:\.\d+)?)/)
    const y = num(/\by\s*:\s*(-?\d+(?:\.\d+)?)/)
    if (x === undefined || y === undefined) continue
    const w = num(/\bwidth\s*:\s*(-?\d+(?:\.\d+)?)/) ?? DEFAULT_SIZE
    const h = num(/\bheight\s*:\s*(-?\d+(?:\.\d+)?)/) ?? DEFAULT_SIZE
    placed.push({ cx: x + w / 2, cy: y + h / 2, kind })
  }
  return { placed, systems }
}

/** Names that mean "the reading", used where a real channel belongs. This is
 *  the single most common channel failure in the measured sweep — the model
 *  writes `graph.plot(vm.channel)` literally, having been told the word
 *  "channel" in the API description. It is only safe to resolve when the
 *  kind leaves no choice: one channel, or an instrument whose whole purpose
 *  names the quantity it reads. */
const PLACEHOLDER_CHANNELS = new Set([
  'channel', 'value', 'output', 'out', 'data', 'signal', 'reading',
  'measurement', 'result', 'quantity',
])

/** Instruments that read exactly one quantity, whatever else their symbol
 *  class nominally publishes. */
const METER_CHANNEL: Record<string, string> = {
  voltmeter: 'V', probe: 'V', 'logic-probe': 'V',
  ammeter: 'I', wattmeter: 'P',
}

/** Behavior params the model spells out in full. `dampingCoefficient` is
 *  handled by the prefix rule in resolveName; these are the ones where the
 *  real name shares no prefix with the invented one. */
const PARAM_ALIASES: Record<string, string> = {
  springconstant: 'k', stiffness: 'k', spring_constant: 'k', springrate: 'k',
  dampingratio: 'damping', dampingfactor: 'damping', dampingconstant: 'damping',
  bounce: 'restitution', elasticity: 'restitution', bounciness: 'restitution',
  weight: 'mass', m: 'mass',
  angularvelocity: 'omega', angularspeed: 'speed', rpm: 'speed', velocity: 'speed',
  mu: 'friction', frictioncoefficient: 'friction',
}

/** Levenshtein distance, capped — we only ever care about "within 2". */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * The one legal name `wrong` was reaching for, or null.
 *
 * Order matters and is the whole safety argument: an exact case-insensitive
 * hit is certain, an alias is a curated certainty, and only then do we allow
 * a typo guess — and that guess must be UNIQUE. Two legal names within edit
 * distance 2 means we cannot know which was meant, so we change nothing and
 * let the model see the error. Guessing there is how an autofix ships wiring
 * the user never asked for.
 */
function resolveName(
  wrong: string,
  legal: readonly string[],
  aliases: Record<string, string>
): string | null {
  if (legal.includes(wrong)) return null
  const lower = wrong.toLowerCase()

  // Case only — `.v` for `.V`, `create("Resistor")`.
  const cased = legal.filter((n) => n.toLowerCase() === lower)
  if (cased.length === 1) return cased[0]

  const aliased = aliases[lower]
  if (aliased && legal.includes(aliased)) return aliased

  // A legal name spelled out longhand: `dampingCoefficient` for `damping`,
  // `positiveTerminal` for `positive`. Unique prefix only — two legal names
  // both prefixing it means we cannot tell which, same rule as everywhere.
  const prefixed = legal.filter((n) => n.length >= 3 && lower.startsWith(n.toLowerCase()))
  if (prefixed.length === 1) return prefixed[0]

  // Typo-matching is for WORDS. On a one- or two-character name every symbol
  // is a neighbour of every other, and the measured escape was real: a
  // transformer publishes only `I`, so `graph.plot(tr.V)` — a legitimate
  // request for a quantity that component does not report — was "repaired"
  // into a plot of the current. Distance 1, completely different physics, and
  // the linter would have passed it. Short names get the exact and alias
  // rules above and nothing more.
  if (lower.length <= 2) return null

  const near = legal.filter((n) => distance(lower, n.toLowerCase()) <= 2)
  return near.length === 1 ? near[0] : null
}

/** Rename an identifier everywhere it is used as a variable — never inside a
 *  string (`create("switch")` names the KIND and must not move) and never as
 *  a property (`obj.switch`). */
function renameVar(code: string, from: string, to: string): string {
  return code.replace(
    new RegExp(`(^|[^.\\w$'"\`])${from}(?![\\w$'"\`])`, 'g'),
    (_m, pre: string) => `${pre}${to}`
  )
}

/**
 * The channel a placeholder or a terminal name was standing in for.
 *
 * Two cases, both with exactly one answer:
 *   `vm.channel`  — a placeholder on an instrument that reads one quantity
 *   `op.out`      — an ANCHOR where a channel belongs, on an electrical part,
 *                   where what anyone means by "the output" is its voltage
 *
 * Anything else returns null and stays an error. A meter with two plausible
 * readings is not something to guess at.
 */
function placeholderChannel(kind: string, name: string, legal: string[]): string | null {
  const lower = name.toLowerCase()
  if (PLACEHOLDER_CHANNELS.has(lower)) {
    if (legal.length === 1) return legal[0]
    const meter = METER_CHANNEL[kind]
    if (meter && legal.includes(meter)) return meter
  }
  // Only electrical kinds — a mechanics body publishes x/y/vx/…, where a
  // terminal name means nothing and there is no default to fall back on.
  if (anchorValid(kind, name) && legal.includes('V')) return 'V'
  return null
}

/**
 * Repair everything mechanically decidable, leave everything else alone.
 *
 * Pure and idempotent: running it twice changes nothing the second time,
 * which is what lets the repair loop call it on every attempt without the
 * fixes fighting each other.
 */
export function autofixSimScript(source: string): FixResult {
  let code = source
  const notes: string[] = []

  // 1. Reserved words as variable names. First, because it is a hard syntax
  //    error: the linter returns on it and no other check ever runs.
  for (const word of RESERVED) {
    const re = new RegExp(`\\b(?:var|let|const)\\s+${word}\\b`)
    if (!re.test(code)) continue
    // `switch1`, unless the script already uses that too.
    let replacement = `${word}1`
    for (let n = 1; new RegExp(`\\b${replacement}\\b`).test(code); n++) {
      replacement = `${word}${n + 1}`
    }
    code = renameVar(code, word, replacement)
    notes.push(`renamed variable "${word}" to "${replacement}" — reserved JavaScript word`)
  }

  // 2. create("graph"). The model builds a graph object and calls .plot on it;
  //    SimScript's graph is ambient. Drop the declaration and re-point the
  //    calls — the plots themselves were fine.
  const graphDecl = code.match(
    /^[^\S\n]*(?:var|let|const)\s+([a-zA-Z_$][\w$]*)\s*=\s*create\s*\(\s*['"]graph['"][^)]*\)\s*;?[^\S\n]*\n?/m
  )
  if (graphDecl) {
    const name = graphDecl[1]
    code = code.replace(graphDecl[0], '')
    code = code.replace(new RegExp(`\\b${name}\\s*\\.\\s*plot\\s*\\(`, 'g'), 'graph.plot(')
    notes.push(`removed create("graph") — graph.plot() is ambient, no object needed`)
  }

  // 3. create() kinds.
  const legalKinds = [...KNOWN_KINDS, ...GENERIC_OK] as string[]
  code = code.replace(
    /create\s*\(\s*(['"])([^'"]+)\1/g,
    (whole, q: string, kind: string) => {
      const fixed = resolveName(kind, legalKinds, KIND_ALIASES)
      if (!fixed) return whole
      notes.push(`create("${kind}") -> create("${fixed}")`)
      return `create(${q}${fixed}${q}`
    }
  )

  // 4 & 5 need to know what each variable is, and step 3 may have just
  //   changed that — so read the kinds AFTER the kind fixes land.
  const kinds = varKinds(code)

  // 4. connect() anchors. Only a var whose kind we know, and only an anchor
  //    the runtime would genuinely reject.
  code = code.replace(/connect\s*\(([^()]*)\)/g, (whole, args: string) => {
    const fixedArgs = args.replace(
      /\b([a-zA-Z_$][\w$]*)\s*\.\s*([a-zA-Z_$][\w$]*)\b/g,
      (arg, varName: string, anchor: string) => {
        const kind = kinds[varName]
        if (!kind || anchorValid(kind, anchor)) return arg
        const legal = anchorNames(kind)
        // The bjt/mosfet single-letter aliases are only safe on those kinds —
        // `b` is a real anchor on every two-terminal component.
        const aliases =
          /^bjt|^mosfet/.test(kind) ? ANCHOR_ALIASES : { ...ANCHOR_ALIASES, b: 'b', c: 'c', e: 'e', d: 'd', s: 's', g: 'g' }
        const fixed = resolveName(anchor, legal, aliases)
        if (!fixed) return arg
        notes.push(`${varName}.${anchor} -> ${varName}.${fixed} (${kind} has no anchor "${anchor}")`)
        return `${varName}.${fixed}`
      }
    )
    return fixedArgs === args ? whole : `connect(${fixedArgs})`
  })

  // 5. graph.plot() channels.
  code = code.replace(/graph\s*\.\s*plot\s*\(([^()]*)\)/g, (whole, args: string) => {
    const fixedArgs = args.replace(
      /\b([a-zA-Z_$][\w$]*)\s*\.\s*([a-zA-Z_$][\w$]*)\b/g,
      (arg, varName: string, channel: string) => {
        const kind = kinds[varName]
        if (!kind) return arg
        const legal = channelsOf(kind)
        // No channels at all is a real error (the thing publishes nothing) —
        // there is no right answer to substitute, so leave it for the linter.
        if (legal.length === 0 || legal.includes(channel)) return arg
        const fixed =
          resolveName(channel, legal, CHANNEL_ALIASES) ?? placeholderChannel(kind, channel, legal)
        if (!fixed) return arg
        notes.push(`${varName}.${channel} -> ${varName}.${fixed} (${kind} has no channel "${channel}")`)
        return `${varName}.${fixed}`
      }
    )
    return fixedArgs === args ? whole : `graph.plot(${fixedArgs})`
  })

  // 6. A control aimed at a param that does not exist.
  //
  // The worst of the mechanical failures, because the linter's own note
  // explains why: an unresolvable targetParamName falls back to the SLIDER'S
  // OWN value and the factory default is `x`, so the control does not merely
  // sit inert — it writes its number into the target's position and throws the
  // object out of its system box. The model spells the param out in full
  // (`dampingCoefficient` for `damping`), which is a lookup, not a redesign.
  code = code.replace(
    /create\s*\(\s*(['"])(slider|button|trigger)\1\s*,\s*\{([^{}]*)\}/g,
    (whole, _q: string, _control: string, props: string) => {
      const nameM = /targetParamName\s*:\s*['"]([^'"]+)['"]/.exec(props)
      if (!nameM) return whole
      const param = nameM[1]
      if (GEOMETRY_PARAMS.includes(param)) return whole
      const targetM = /target(?:ObjectId|Object|)\s*:\s*([A-Za-z_$][\w$]*)/.exec(props)
      const targetKind = targetM ? kinds[targetM[1]] : undefined
      if (!targetKind) return whole
      const own = paramsOf(targetKind)
      if (own.length === 0 || own.includes(param)) return whole
      // Geometry is always legal, but never a GUESS — resolving an invented
      // physics name to `x` is exactly the position-corrupting outcome above.
      const fixed = resolveName(param, own, PARAM_ALIASES)
      if (!fixed) return whole
      notes.push(`targetParamName "${param}" -> "${fixed}" (${targetKind} has no param "${param}")`)
      return whole.replace(nameM[0], nameM[0].replace(param, fixed))
    }
  )

  // 7 & 8. The system boundary.
  //
  // This is the most expensive error the linter reports, because the scene is
  // usually CORRECT — the model built the right bodies at the right places and
  // simply did not declare the box that Play/Step scopes a run to. Regenerating
  // to add a wrapper risks losing a scene that was already right, and costs a
  // full round to do it. The containment is arithmetic: the components state
  // where they are, so the rect that holds them is derived, not guessed.
  {
    const { placed, systems } = readScene(code)

    if (placed.length > 1 && systems.length === 0) {
      // Corpus convention: the system sits at the origin and the components
      // live at small offsets inside it. Size to the content, floored at the
      // corpus default so a two-body scene still gets room to move.
      const right = Math.max(...placed.map((p) => p.cx))
      const bottom = Math.max(...placed.map((p) => p.cy))
      const width = Math.max(460, Math.ceil((right + DEFAULT_SIZE) / 20) * 20)
      const height = Math.max(360, Math.ceil((bottom + DEFAULT_SIZE) / 20) * 20)
      const domain =
        DOMAIN_KINDS.find(([, set]) => placed.some((p) => set.has(p.kind)))?.[0] ?? 'mechanics'
      code =
        `var sys = create("system", { x: 0, y: 0, domain: "${domain}", width: ${width}, height: ${height} });\n` +
        code.replace(/^\n+/, '')
      notes.push(`added the missing create("system") wrapper (${domain}, ${width}x${height})`)
    } else if (placed.length > 0 && systems.length === 1) {
      // Components outside the only system are dropped from its run. Widening
      // is the fix the linter itself offers, and it is the safe direction: the
      // rect only ever grows, so nothing that was already in scope leaves it.
      //
      // Containment is CENTRE-in-rect, exactly as buildWorld and the linter
      // test it — never the component's bounding box. Widening on the box
      // instead grew systems that were already correct, which is a silent
      // edit to a valid script and the one thing this pass must never do.
      const s0 = systems[0]
      const outside = placed.filter(
        (p) => p.cx < s0.x || p.cx > s0.x + s0.w || p.cy < s0.y || p.cy > s0.y + s0.h
      )
      if (outside.length === 0) return { code, notes }
      const minX = Math.min(s0.x, ...placed.map((p) => p.cx))
      const minY = Math.min(s0.y, ...placed.map((p) => p.cy))
      const maxX = Math.max(s0.x + s0.w, ...placed.map((p) => p.cx))
      const maxY = Math.max(s0.y + s0.h, ...placed.map((p) => p.cy))
      const x = Math.floor(minX / 20) * 20
      const y = Math.floor(minY / 20) * 20
      const w = Math.ceil((maxX - x) / 20) * 20
      const h = Math.ceil((maxY - y) / 20) * 20
      if (x !== s0.x || y !== s0.y || w !== s0.w || h !== s0.h) {
        const widened = s0.text
          .replace(/\bx\s*:\s*-?\d+(?:\.\d+)?/, `x: ${x}`)
          .replace(/\by\s*:\s*-?\d+(?:\.\d+)?/, `y: ${y}`)
          .replace(/\bwidth\s*:\s*-?\d+(?:\.\d+)?/, `width: ${w}`)
          .replace(/\bheight\s*:\s*-?\d+(?:\.\d+)?/, `height: ${h}`)
        if (widened !== s0.text) {
          code = code.replace(s0.text, widened)
          notes.push(`widened the system to ${w}x${h} at (${x}, ${y}) so every component stays in scope`)
        }
      }
    }
  }

  return { code, notes }
}
