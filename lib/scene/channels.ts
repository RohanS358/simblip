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
// The tables live in simscript-props.ts — a module with no imports and no
// 'use client' — so the server-side SimScript linter can read the same data
// this renderer does without pulling a client module into a route.
import {
  BODY_CHANNELS as BODY,
  DEFAULT_SYMBOL_CHANNELS as VIP,
  CHANNELS_BY_SYMBOL as BY_SYMBOL,
  SILENT_SYMBOLS,
} from './simscript-props'

const SILENT = { has: (k: string) => SILENT_SYMBOLS.includes(k) }





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
