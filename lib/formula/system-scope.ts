// Per-system variables. A system (the rect with metadata.render === 'system')
// carries its own named values — and its own g / drag / timeScale — that apply
// only to what sits inside it and beat the page's. Precedence, innermost first:
//
//   system variable  >  page variable  >  engine default
//
// They live in the system object's metadata (`vars`), so they ride every path
// an object already rides — page bundle, sync, clone-on-share, undo — with no
// new store, schema or migration. Pure and store-free, like ./scope.

import type { SceneObject, Variable } from '@/lib/scene/types'
import { solveScope, type Scope } from './engine'

export const isSystem = (o: SceneObject | undefined): o is SceneObject => o?.metadata.render === 'system'

/** The system's own variables (empty for anything else). */
export const systemVarsOf = (o: SceneObject | undefined): Variable[] =>
  o && isSystem(o) && Array.isArray(o.metadata.vars) ? (o.metadata.vars as Variable[]) : []

/** The engine knobs a system may override, with the defaults the runtime uses. */
export const ENGINE_VARS = [
  { name: 'g', def: '9.81', label: 'Gravity (m/s²)' },
  { name: 'drag', def: '0.01', label: 'Air resistance (0 = vacuum)' },
  { name: 'timeScale', def: '1', label: 'Simulation speed ×' },
] as const

/** An object counts as inside a system when its centre is within the box —
 *  the same rule a scoped run uses to decide what to simulate. */
export function insideSystem(sys: SceneObject, o: SceneObject): boolean {
  if (o.id === sys.id) return false
  const cx = o.position.x + o.size.w / 2
  const cy = o.position.y + o.size.h / 2
  return (
    cx >= sys.position.x &&
    cx <= sys.position.x + sys.size.w &&
    cy >= sys.position.y &&
    cy <= sys.position.y + sys.size.h
  )
}

/** The innermost (smallest) system containing `o`, or undefined. A system is
 *  never "inside" another system for variable purposes — only plain objects
 *  take a system's scope. */
export function systemOf(objects: Record<string, SceneObject>, o: SceneObject): SceneObject | undefined {
  if (isSystem(o)) return undefined
  let best: SceneObject | undefined
  for (const s of Object.values(objects)) {
    if (!isSystem(s) || !insideSystem(s, o)) continue
    if (!best || s.size.w * s.size.h < best.size.w * best.size.h) best = s
  }
  return best
}

/** Solve a system's variables against the page scope. Returns the variables
 *  with fresh value/error. System vars may reference page vars (and each other). */
export function solveSystemVars(vars: Variable[], pageScope: Scope): Variable[] {
  return vars.length === 0 ? vars : solveScope(vars, pageScope).variables
}

/** Page scope with the system's already-solved variables laid over it. Cheap
 *  (no parsing) — safe to call per frame; values were solved at edit time. */
export function systemScope(sys: SceneObject | undefined, pageScope: Scope): Scope {
  const vars = systemVarsOf(sys)
  if (vars.length === 0) return pageScope
  const out: Scope = { ...pageScope }
  for (const v of vars) if (!v.error && Number.isFinite(v.value)) out[v.name] = v.value
  return out
}

/** A system addressed the way the AI addresses things: by id, else by name. */
export function findSystem(objects: Record<string, SceneObject>, ref: string): SceneObject | undefined {
  const byId = objects[ref]
  if (isSystem(byId)) return byId
  const want = ref.trim().toLowerCase()
  return Object.values(objects).find((o) => isSystem(o) && o.name.trim().toLowerCase() === want)
}
