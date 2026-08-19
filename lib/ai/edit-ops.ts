// Editing the page you are already on.
//
// SimScript is CREATE-ONLY. `create()` mints a fresh uid and appends; `set()`
// binds handles from the same run; nothing in lib/scene/simscript.ts resolves
// an object that already exists. So "make the bob heavier" has no expressible
// form — the model's only move is to re-emit the whole scene, which is the
// duplication failure that once produced 109 objects for one prompt.
//
// The fix is a second verb set, not a replacement: SimScript stays the right
// tool for building a wired circuit from nothing, where one line beats thirty
// ops. This addresses the other half — changing what is already there.
//
// A JSON op list rather than a mutating dialect, because:
//   • it is VERIFIABLE before it runs — every id checked against the real
//     page, every component against COMPONENTS, every behavior against
//     BEHAVIOR_TYPES, so a bad op is rejected with a reason to repair from;
//   • it is a CLOSED vocabulary — the open surface of a scripting language is
//     where a model invents create("shape") (see route-intent.ts's header);
//   • a local 7B emits JSON far more reliably than a novel DSL.
//
// Ops map 1:1 onto lib/store/document.ts actions, so an AI edit is the same
// mutation a drag performs: it syncs, persists and undoes for free.

import { z } from 'zod'
import { COMPONENTS } from '@/lib/scene/factory'
import { BEHAVIOR_TYPES } from '@/lib/behaviors/registry'
import type { GeometryKind, PageDoc } from '@/lib/scene/types'

/** Plain geometry kinds an `add` may name.
 *
 *  COMPONENTS covers physics and circuit parts only — there is no 'graph',
 *  'note' or 'text' entry, because the toolbar builds those through
 *  createGeometry() instead. Measured consequence: asked to "add a graph next
 *  to the mass" the model had no valid id and reached for the nearest
 *  component ('system-mechanics'), quietly producing the wrong object. Both
 *  vocabularies are accepted so the request is answerable. */
export const ADDABLE_GEOMETRY: GeometryKind[] = [
  'note', 'text', 'formula', 'graph', 'chart', 'table', 'gridtable',
  'surface3d', 'cashflow', 'truthtable', 'slider', 'button', 'trigger',
  'code', 'dsa', 'rect', 'circle', 'line', 'polygon',
]

const vec = z.object({ x: z.number(), y: z.number() })

/** The op vocabulary. Deliberately small: six verbs cover every edit the
 *  document store can perform, and each one is a single store call. */
export const editOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    /** A COMPONENTS id or an ADDABLE_GEOMETRY kind — the model never
     *  hand-builds a SceneObject. */
    component: z.string(),
    position: vec,
    /** Optional friendly name; the factory supplies one otherwise. */
    name: z.string().optional(),
    /** Content set at creation — a note's text, a slider's label.
     *
     *  Without this the model had to add an object and then setParam on it,
     *  but a freshly added object has no id to address until the batch runs.
     *  Measured: "add a note saying check units" failed every time. Setting
     *  content at creation is also simply fewer ops. */
    params: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String))
      .optional(),
  }),
  z.object({
    op: z.literal('update'),
    id: z.string(),
    position: vec.optional(),
    size: z.object({ w: z.number(), h: z.number() }).optional(),
    rotation: z.number().optional(),
    name: z.string().optional(),
  }),
  z.object({ op: z.literal('remove'), ids: z.array(z.string()).min(1) }),
  z.object({
    op: z.literal('setParam'),
    id: z.string(),
    name: z.string(),
    /** Numeric params take an expression; text params take their text.
     *  Coerced from number/boolean because a model writes `5`, not `"5"`,
     *  and failing a whole plan over a JSON type is a pointless round-trip. */
    value: z.union([z.string(), z.number(), z.boolean()]).transform(String),
  }),
  z.object({
    op: z.literal('addBehavior'),
    id: z.string(),
    type: z.string(),
  }),
  z.object({ op: z.literal('setVariable'), name: z.string(), expr: z.string() }),
])

export const editPlanSchema = z.object({
  ops: z.array(editOpSchema).min(1).max(40),
  /** One plain sentence for the confirmation prompt. */
  summary: z.string(),
})

export type EditOp = z.infer<typeof editOpSchema>
export type EditPlan = z.infer<typeof editPlanSchema>

export interface VerifyResult {
  ok: boolean
  errors: string[]
  plan?: EditPlan
}

const COMPONENT_IDS = new Set(COMPONENTS.map((c) => c.id))
const GEOMETRY_IDS = new Set<string>(ADDABLE_GEOMETRY)

/** Is this something `add` can create — a registry component or a bare
 *  geometry kind? */
export const isAddable = (id: string) => COMPONENT_IDS.has(id) || GEOMETRY_IDS.has(id)
const BEHAVIOR_SET = new Set<string>(BEHAVIOR_TYPES)

/** Positions must stay somewhere a human could have put them. A model that
 *  emits x=1e9 would place an object no one can ever find or delete. */
const COORD_LIMIT = 100_000

/**
 * Check a plan against the REAL page it will be applied to.
 *
 * Run twice: once after generation (so a failure can be repaired), and again
 * at apply time, because the page can change in between — the user may have
 * deleted the very object the model addressed. Any unknown id aborts the
 * WHOLE batch: half an applied patch is worse than none.
 */
export function verifyPlan(raw: unknown, doc: PageDoc | undefined): VerifyResult {
  const parsed = editPlanSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`),
    }
  }
  if (!doc) return { ok: false, errors: ['No page is open to edit.'] }

  const errors: string[] = []
  // Track ids as the batch would see them: an object added earlier in this
  // plan is addressable later, and one removed earlier is not.
  const live = new Set(Object.keys(doc.objects))
  const addedAliases = new Set<string>()

  const known = (id: string) => live.has(id) || addedAliases.has(id)

  for (const [i, op] of parsed.data.ops.entries()) {
    const at = `op ${i + 1} (${op.op})`
    switch (op.op) {
      case 'add': {
        if (!isAddable(op.component)) {
          errors.push(`${at}: unknown component "${op.component}"`)
        }
        if (Math.abs(op.position.x) > COORD_LIMIT || Math.abs(op.position.y) > COORD_LIMIT) {
          errors.push(`${at}: position is off the page`)
        }
        break
      }
      case 'update': {
        if (!known(op.id)) errors.push(`${at}: no object "${op.id}" on this page`)
        if (op.position && (Math.abs(op.position.x) > COORD_LIMIT || Math.abs(op.position.y) > COORD_LIMIT)) {
          errors.push(`${at}: position is off the page`)
        }
        if (op.size && (op.size.w <= 0 || op.size.h <= 0)) {
          errors.push(`${at}: size must be positive`)
        }
        break
      }
      case 'remove': {
        for (const id of op.ids) {
          if (!known(id)) errors.push(`${at}: no object "${id}" on this page`)
          live.delete(id)
          addedAliases.delete(id)
        }
        break
      }
      case 'setParam': {
        if (!known(op.id)) {
          errors.push(`${at}: no object "${op.id}" on this page`)
          break
        }
        // Only check parameters of objects that already exist: one added in
        // this same batch has no parameters until the factory runs.
        const obj = doc.objects[op.id]
        if (obj && !(op.name in obj.parameters)) {
          const available = Object.keys(obj.parameters).slice(0, 6).join(', ')
          errors.push(
            `${at}: "${obj.geometry.kind}" has no parameter "${op.name}"${available ? ` (has: ${available})` : ''}`
          )
        }
        break
      }
      case 'addBehavior': {
        if (!known(op.id)) errors.push(`${at}: no object "${op.id}" on this page`)
        if (!BEHAVIOR_SET.has(op.type)) errors.push(`${at}: unknown behavior "${op.type}"`)
        break
      }
      case 'setVariable': {
        if (!/^[A-Za-z_]\w*$/.test(op.name)) {
          errors.push(`${at}: "${op.name}" is not a usable variable name`)
        }
        break
      }
    }
  }

  return errors.length > 0
    ? { ok: false, errors: errors.slice(0, 6) }
    : { ok: true, errors: [], plan: parsed.data }
}

/** Plain-language preview, one line per op — what the user confirms against.
 *  Reads the page so an id becomes the object's actual name. */
export function describePlan(plan: EditPlan, doc: PageDoc | undefined): string[] {
  const nameOf = (id: string) => {
    const o = doc?.objects[id]
    return o ? `${o.name || o.geometry.kind}` : id
  }
  return plan.ops.map((op) => {
    switch (op.op) {
      case 'add':
        return `Add a ${op.component}`
      case 'update': {
        const bits: string[] = []
        if (op.position) bits.push('move')
        if (op.size) bits.push('resize')
        if (op.rotation !== undefined) bits.push('rotate')
        if (op.name) bits.push(`rename to "${op.name}"`)
        return `${bits.join(', ') || 'Update'} ${nameOf(op.id)}`
      }
      case 'remove':
        return `Delete ${op.ids.map(nameOf).join(', ')}`
      case 'setParam':
        return `Set ${nameOf(op.id)} ${op.name} = ${op.value}`
      case 'addBehavior':
        return `Give ${nameOf(op.id)} ${op.type}`
      case 'setVariable':
        return `Set variable ${op.name} = ${op.expr}`
    }
  })
}
