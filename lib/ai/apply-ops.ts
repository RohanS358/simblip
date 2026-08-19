'use client'

// Applying a verified edit plan to the page.
//
// The whole batch is ONE history entry: pushHistory once up front, then every
// store call with `history: false` (already the default — see
// document.ts:583). So an AI edit is a single Ctrl+Z, no matter how many ops
// it contained. That undo guarantee is what makes direct editing acceptable
// at all, and it is why nothing here invents its own history handling.
//
// Ops are re-verified against the live page immediately before applying. The
// page may have changed since generation — the user could have deleted the
// object the model addressed — and applying half a patch is worse than
// applying none.

import { useDocStore } from '@/lib/store/document'
import { componentById, createGeometry } from '@/lib/scene/factory'
import { uid } from '@/lib/scene/types'
import { verifyPlan, ADDABLE_GEOMETRY, type EditPlan } from '@/lib/ai/edit-ops'
import type { GeometryKind } from '@/lib/scene/types'

const GEOMETRY_KINDS = new Set<string>(ADDABLE_GEOMETRY)

export interface ApplyResult {
  ok: boolean
  /** How many ops actually ran. */
  applied: number
  errors: string[]
}

export function applyPlan(pageId: string, plan: EditPlan): ApplyResult {
  const store = useDocStore.getState()
  const doc = store.pages[pageId]

  // Re-verify against the page as it is NOW, not as it was when generated.
  const check = verifyPlan(plan, doc)
  if (!check.ok) return { ok: false, applied: 0, errors: check.errors }

  // One entry for the whole batch.
  store.pushHistory(pageId)

  let applied = 0
  const errors: string[] = []

  for (const op of plan.ops) {
    try {
      switch (op.op) {
        case 'add': {
          // A registry component, or a bare geometry kind (note/graph/text…)
          // which the toolbar also builds through createGeometry.
          const def = componentById(op.component)
          const obj = def
            ? def.create(op.position)
            : GEOMETRY_KINDS.has(op.component)
              ? createGeometry(op.component as GeometryKind, op.position)
              : null
          if (!obj) {
            errors.push(`unknown component "${op.component}"`)
            continue
          }
          obj.id = uid()
          if (op.name) obj.name = op.name
          // Content at creation: a note's text, a slider's label. Applied to
          // the object before it lands so there is no flash of an empty one.
          for (const [k, v] of Object.entries(op.params ?? {})) {
            const existing = obj.parameters[k]
            if (existing?.kind === 'number') {
              const n = Number(v)
              obj.parameters[k] = { kind: 'number', expr: v, value: Number.isFinite(n) ? n : 0 }
            } else if (existing?.kind === 'bool') {
              obj.parameters[k] = { kind: 'bool', value: v === 'true' }
            } else {
              obj.parameters[k] = { kind: 'string', value: v }
            }
          }
          store.addObject(pageId, obj, { history: false })
          break
        }
        case 'update': {
          store.updateObject(
            pageId,
            op.id,
            {
              ...(op.position ? { position: op.position } : {}),
              ...(op.size ? { size: op.size } : {}),
              ...(op.rotation !== undefined ? { rotation: op.rotation } : {}),
              ...(op.name ? { name: op.name } : {}),
            },
            { history: false }
          )
          break
        }
        case 'remove':
          store.removeObjects(pageId, op.ids)
          break
        case 'setParam': {
          // A parameter is numeric (an expression) or textual. Route by the
          // param's own kind so "5" lands as an expression on a mass and as
          // literal text on a note.
          const param = useDocStore.getState().pages[pageId]?.objects[op.id]?.parameters[op.name]
          if (param?.kind === 'number') store.setParam(pageId, op.id, op.name, op.value)
          else store.setStringParam(pageId, op.id, op.name, op.value)
          break
        }
        case 'addBehavior':
          // The type was checked against BEHAVIOR_TYPES by verifyPlan.
          store.addBehavior(pageId, op.id, op.type as Parameters<typeof store.addBehavior>[2])
          break
        case 'setVariable':
          store.upsertVariable(pageId, op.name, op.expr)
          break
      }
      applied++
    } catch (e) {
      errors.push(`${op.op}: ${e instanceof Error ? e.message : 'failed'}`)
    }
  }

  return { ok: errors.length === 0, applied, errors }
}
