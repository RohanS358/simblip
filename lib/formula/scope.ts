// The base every page expression is solved against, below the page's own
// variables. Kept apart from the document store — which is Zustand, browser
// storage and a persist middleware — so it stays pure, importable anywhere,
// and testable without a store.

import type { ParamValue, SceneObject } from '@/lib/scene/types'
import type { Scope } from './engine'


/** SI values for the constants formulas name without ever defining. A page
 *  variable or a scene parameter of the same name wins over these. */
export const CONSTANTS: Scope = {
  epsilon_0: 8.8541878128e-12,
  mu_0: 1.25663706212e-6,
  c: 299792458,
  g: 9.80665,
  G: 6.6743e-11,
  h: 6.62607015e-34,
  hbar: 1.054571817e-34,
  k_e: 8.9875517923e9,
  q_e: 1.602176634e-19,
  m_e: 9.1093837015e-31,
  k_B: 1.380649e-23,
  N_A: 6.02214076e23,
  R_gas: 8.314462618,
}

/** Names too short or too overloaded to hand to a scene parameter — `x` is
 *  the graph's sweep, `e`/`i`/`pi` are mathjs's own. */
const RESERVED_SYMBOLS = new Set(['x', 'y', 'z', 't', 'e', 'i', 'j', 'pi'])

/** Numeric parameters of the objects on the page, exposed under their own
 *  names (sigma, epsilonR, mass, R…). Two objects carrying the same parameter
 *  is the normal case — a ± pair of plates both have `sigma` — so the FIRST
 *  one wins and the formula reads the magnitude it was written with. */
export function paramScopeOf(content: { objects: Record<string, SceneObject> }): Scope {
  const out: Scope = {}
  const take = (name: string, p: ParamValue) => {
    if (p.kind !== 'number' || name in out || RESERVED_SYMBOLS.has(name)) return
    if (p.error || !Number.isFinite(p.value)) return
    out[name] = p.value
  }
  for (const obj of Object.values(content.objects)) {
    for (const [name, p] of Object.entries(obj.parameters)) take(name, p)
    for (const b of obj.behaviors) for (const [name, p] of Object.entries(b.params)) take(name, p)
  }
  // A parameter is written `epsilonR` in a script and `\epsilon_R` in the
  // maths it exists to feed. Same quantity, two spellings — so a camelCase
  // parameter also answers to its subscripted form.
  for (const [name, v] of Object.entries(out)) {
    const sub = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    if (sub !== name && !(sub in out)) out[sub] = v
  }
  return out
}

