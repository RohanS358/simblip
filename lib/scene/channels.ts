'use client'

// What each object actually publishes to the graph bus.
//
// A mass streams motion (x, y, vx, vy…); a resistor streams V, I, P; a logic
// probe streams `level`. Offering voltage on a mass is nonsense, so this is
// the one place that knows which channels an object CAN emit — derived from
// what lib/physics/world.ts sample() and lib/circuit/engine.ts readings
// actually push. The Variables panel and the graph series picker both read
// it, and it works BEFORE the simulation has ever run (a live buffer only
// exists after Play, but a user shouldn't have to press Play to bind a
// variable).

import type { SceneObject } from './types'

/** Motion channels every dynamic rigid body streams (SI units). */
const BODY = ['x', 'y', 'vx', 'vy', 'speed', 'angle', 'omega', 'ke']

/** Two-terminal electrical parts all report the same three. */
const VIP = ['V', 'I', 'P']

/** symbol → the exact channels that symbol's reading pushes. */
const BY_SYMBOL: Record<string, string[]> = {
  potentiometer: ['Vtop', 'Vwiper', 'Vbottom'],
  'induction-motor': ['omega', 'torque', 'slip', 'I'],
  'dc-machine': ['V', 'I', 'P', 'omega', 'torque'],
  vcvs: ['Vctrl', 'Vout', 'I'],
  vccs: ['Vctrl', 'Vout', 'I'],
  ccvs: ['Isense', 'Vout', 'I'],
  cccs: ['Isense', 'Vout', 'I'],
  transformer: ['Vprimary', 'Vsecondary', 'I'],
  'transformer-ct': ['Vprimary', 'Vsec1', 'Vsec2'],
  'three-phase-source': ['Va', 'Vb', 'Vc', 'Vab'],
  probe: ['V'],
  'logic-probe': ['level'],
  output: ['value'],
  clock: ['value'],
  input: ['value'],
}

/** Symbols with no reading at all — gates, wiring, decoration. */
const SILENT = new Set([
  'gnd', 'and-gate', 'or-gate', 'xor-gate', 'nand-gate', 'nor-gate', 'not-gate',
  'd-ff', 'jk-ff', 't-ff', 'sr-latch', 'mux', 'demux', 'decoder', 'encoder',
  'half-adder', 'full-adder', 'comparator', 'tristate', 'seven-seg', 'bcd-7seg',
  'register4', 'counter4',
])

const has = (obj: SceneObject, type: string) =>
  obj.behaviors.some((b) => b.enabled && b.type === type)

/**
 * The channels this object streams to graphs — its real, usable outputs.
 * Empty when the object produces no data (a gate, a drawing, a note).
 */
export function channelsFor(obj: SceneObject): string[] {
  const out: string[] = []

  // Mechanics: only DYNAMIC bodies move, so only they stream motion.
  if (has(obj, 'rigidBody')) out.push(...BODY)

  // Electrical / electronics / digital symbols.
  const sym = obj.geometry.kind === 'symbol' ? obj.geometry.symbol : undefined
  if (sym && !SILENT.has(sym)) out.push(...(BY_SYMBOL[sym] ?? VIP))

  // Thermal rides along on whatever the object already is (a hot block still
  // reports its motion; a static heat sink reports only temperature).
  if (has(obj, 'thermal')) out.push('temp')

  return [...new Set(out)]
}

/**
 * The channels a KIND publishes, without needing a built object.
 *
 * `channelsFor` above needs a real SceneObject (it inspects attached
 * behaviors). The SimScript linter only has source text — it can see
 * `create("bulb", …)` but has executed nothing — so it needs the same answer
 * keyed by kind name. Both read the same tables, so they cannot disagree.
 *
 * `mechanics` is passed for kinds that carry a rigidBody (mass, block,
 * wheel…), since motion channels come from the behavior, not the symbol.
 */
export function channelsForKind(kind: string, mechanics = false): string[] {
  const out: string[] = []
  if (mechanics) out.push(...BODY)
  if (!SILENT.has(kind)) out.push(...(BY_SYMBOL[kind] ?? []))
  return [...new Set(out)]
}

/** Two-terminal electrical default — what any unlisted circuit symbol reports. */
export const DEFAULT_SYMBOL_CHANNELS = VIP
/** Motion channels a dynamic body streams. */
export const BODY_CHANNELS = BODY
/** Symbols that publish nothing at all. */
export const SILENT_SYMBOLS = SILENT

// ── Truth-table roles ───────────────────────────────────────────────────────
// A truth table drives some components and reads others. That used to live in
// its own symbol allowlists in lib/circuit/truth-table.ts, disconnected from
// the channel registry above — so a symbol could be graphable but invisible to
// the table (or the reverse) with nothing to catch the drift. Both questions
// are "what does this symbol do?", so both are answered here.

/** Symbols a truth table can DRIVE → the param it forces. */
export const DRIVABLE: Record<string, string> = {
  input: 'value', // logic input → its `value` param
  switch: 'closed', // a switch is a 1-bit input too
}

/** Symbols a truth table can READ. */
export const READABLE = new Set(['output', 'logic-probe', 'led', 'bulb'])

const symbolOf = (o: SceneObject): string | undefined =>
  o.geometry.kind === 'symbol' ? o.geometry.symbol : undefined

/** Can a truth table force this object's state? */
export const isDrivable = (o: SceneObject): boolean => {
  const s = symbolOf(o)
  return !!s && s in DRIVABLE
}

/** Can a truth table read this object's state? */
export const isReadable = (o: SceneObject): boolean => {
  const s = symbolOf(o)
  return !!s && READABLE.has(s)
}

/** Human-readable unit hint for a channel — used in pickers. */
export const CHANNEL_LABELS: Record<string, string> = {
  x: 'x position (cm)',
  y: 'y position (cm)',
  vx: 'x velocity (cm/s)',
  vy: 'y velocity (cm/s)',
  speed: 'speed (cm/s)',
  angle: 'angle (rad)',
  omega: 'angular velocity (rad/s)',
  ke: 'kinetic energy (J)',
  temp: 'temperature (°C)',
  V: 'voltage (V)',
  I: 'current (A)',
  P: 'power (W)',
  Vout: 'output voltage (V)',
  Vctrl: 'control voltage (V)',
  Isense: 'sense current (A)',
  Vtop: 'top voltage (V)',
  Vwiper: 'wiper voltage (V)',
  Vbottom: 'bottom voltage (V)',
  Vprimary: 'primary voltage (V)',
  Vsecondary: 'secondary voltage (V)',
  torque: 'torque (N·m)',
  slip: 'slip',
  level: 'logic level (0/1)',
  value: 'value',
}
