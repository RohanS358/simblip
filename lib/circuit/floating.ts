// Which pins of a circuit are connected to NOTHING? A transistor with only its base wired is not a differential
// amplifier, it is a drawing of one — and a lesson that quotes "0.15 nA" from it teaches nothing. Built on the
// engine's own net extraction, so it agrees exactly with what the simulator will treat as connected.

import { buildCircuit } from './engine'
import type { SceneObject } from '@/lib/scene/types'

export interface FloatingPin { name: string; symbol: string; pin: number }

/** Pins that are optional by design: ground has one pin by nature; an op-amp runs without its supply pins (3 and 4). */
const optional = (symbol: string, pin: number) => symbol === 'gnd' || (symbol === 'opamp' && pin >= 3)

export function floatingPins(objects: SceneObject[]): FloatingPin[] {
  const c = buildCircuit(objects)
  if (!c) return []
  const uses = new Map<number, number>()
  for (const comp of c.comps) for (const n of comp.nets) uses.set(n, (uses.get(n) ?? 0) + 1)
  for (const w of c.wires) uses.set(w.net, (uses.get(w.net) ?? 0) + 1) // a wire touching the pin is a connection
  const byId = new Map(objects.map((o) => [o.id, o]))
  const out: FloatingPin[] = []
  for (const comp of c.comps) {
    comp.nets.forEach((n, pin) => {
      if ((uses.get(n) ?? 0) <= 1 && !optional(comp.symbol, pin)) out.push({ name: byId.get(comp.id)?.name ?? comp.symbol, symbol: comp.symbol, pin })
    })
  }
  return out
}
