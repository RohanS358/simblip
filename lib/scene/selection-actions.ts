'use client'

// The selection-actions pipeline — ONE place that decides what you can do to
// the current selection. The dock's contextual segment, the canvas context
// menu and any future surface all render from `actionsForSelection`, so an
// action is defined once and appears everywhere it belongs.
//
// Extensible on purpose: object kinds/behaviors that carry their own verbs
// (a graph's "Reset axes", a circuit's "Recognize components") contribute
// them through `registerSelectionActions` instead of patching this file —
// the registry is read at call time, so providers may register whenever
// their module loads.

import type { LucideIcon } from 'lucide-react'
import {
  SlidersHorizontal,
  Copy,
  CopyPlus,
  BringToFront,
  Group,
  Ungroup,
  SendToBack,
  Trash2,
  Zap,
} from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { openProperties } from '@/lib/store/sidebar-sections'
import { setClipboard, getClipboard, nextPasteOffset } from '@/lib/store/clipboard'
import { nextTopZ, reorderZ, restackZ } from '@/lib/scene/z-order'
import { makeGroup, rootGroupOf } from '@/lib/scene/group'
import { str, uid, type SceneObject } from '@/lib/scene/types'
import { specsForGeometry, NO_BEHAVIOR_KINDS } from '@/lib/behaviors/registry'

export interface ActionCtx {
  pageId: string
  /** Selected object ids (never empty — empty selections have no actions). */
  ids: string[]
  /** Edit mode. Play mode offers Properties only — hands off a running sim. */
  editing: boolean
}

export interface SelectionAction {
  id: string
  label: string
  icon: LucideIcon
  run: () => void
  danger?: boolean
  /** Ordering + separator bucket in the dock: edit → arrange → convert → share. */
  group: 'edit' | 'arrange' | 'convert' | 'share'
  /** Fine-grained sort order within the group (lower = earlier). Defaults to 0. */
  order?: number
}

export type ActionProvider = (ctx: ActionCtx) => SelectionAction[]

// ── Shared edit operations (were closures inside canvas.tsx) ───────────────

/** Newly created/pasted/duplicated objects always land ABOVE everything
 *  already on the page.
 *
 *  This used to be `Math.max(pageMax + 1, nextZ())`, which looks right and
 *  is not: nextZ() is a session counter seeded from `Date.now() % 1e6`, so
 *  on a page holding a `Date.now()`-stamped object it returned a number far
 *  ABOVE CSS's 32-bit z-index ceiling. Everything above that ceiling clamps
 *  to the same layer, so new ink could not be lifted over an existing
 *  picture. The page's own max — kept a small dense ordinal by
 *  lib/scene/z-order — is the only input that matters. */
export function topZ(pageId: string): number {
  return nextTopZ(useDocStore.getState().pages[pageId]?.objects ?? {})
}

import { parse } from '@/lib/text/marks'

export function copySelection(pageId: string) {
  const store = useDocStore.getState()
  const objs = store.selection
    .map((id) => store.pages[pageId]?.objects[id])
    .filter((o): o is SceneObject => Boolean(o))
  if (objs.length > 0) {
    setClipboard(objs)
    const textPieces = objs
      .map((o) => {
        const raw = o.parameters?.text?.value ?? ''
        if (typeof raw === 'string' && raw.trim()) {
          try {
            return parse(raw).text
          } catch {
            return raw
          }
        }
        return ''
      })
      .filter(Boolean)
    if (textPieces.length > 0 && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(textPieces.join('\n\n')).catch(() => {})
    }
  }
}

export function cutSelection(pageId: string) {
  copySelection(pageId)
  const store = useDocStore.getState()
  if (store.selection.length > 0) store.removeObjects(pageId, store.selection)
}

export function pasteClipboard(pageId: string) {
  const items = getClipboard()
  if (items.length === 0) return
  const store = useDocStore.getState()
  const offset = nextPasteOffset()
  const idMap = new Map<string, string>()
  const clones = items.map((src) => {
    const clone: SceneObject = JSON.parse(JSON.stringify(src))
    const newId = uid()
    idMap.set(src.id, newId)
    clone.id = newId
    clone.position = { x: src.position.x + offset, y: src.position.y + offset }
    clone.z = topZ(pageId)
    clone.behaviors.forEach((b) => (b.id = uid()))
    return clone
  })
  // A graph pasted together with the object it's bound to should stay
  // paired with the NEW copy, not silently keep pointing at the original.
  for (const clone of clones) {
    const sourceId = clone.parameters.sourceId
    if (clone.geometry.kind === 'graph' && sourceId?.kind === 'string' && idMap.has(sourceId.value)) {
      clone.parameters.sourceId = str(idMap.get(sourceId.value)!)
    }
  }
  store.pushHistory(pageId)
  for (const clone of clones) store.addObject(pageId, clone, { history: false })
  store.setSelection(clones.map((c) => c.id))
}

/** Clone the given objects with a small offset; the clones become the
 *  selection. A lone clone gets a " copy" name; a group keeps its names. */
export function duplicateObjects(pageId: string, ids: string[]) {
  const store = useDocStore.getState()
  const made: string[] = []
  for (const id of ids) {
    const src = store.pages[pageId]?.objects[id]
    if (!src) continue
    const clone: SceneObject = JSON.parse(JSON.stringify(src))
    clone.id = uid()
    if (ids.length === 1) clone.name = `${src.name} copy`
    clone.position = { x: src.position.x + 24, y: src.position.y + 24 }
    clone.z = topZ(pageId)
    clone.behaviors.forEach((b) => (b.id = uid()))
    store.addObject(pageId, clone)
    made.push(clone.id)
  }
  if (made.length > 0) store.setSelection(made)
}

/** Restack every given object to the page's very front or very back,
 *  preserving their relative order. */
export function restackObjects(pageId: string, ids: string[], where: 'front' | 'back') {
  const store = useDocStore.getState()
  const objects = store.pages[pageId]?.objects
  if (!objects) return
  // Send-to-back used to write NEGATIVE z (base - count + i, with base = the
  // page minimum). Negative values are legal CSS but they sink the object
  // behind the canvas background layer, and they broke the "z is a dense
  // 1..N ordinal" invariant the Layers list relies on. A splice restack
  // renumbers instead, so back always means "index 1", never "below zero".
  const patch = restackZ(objects, ids, where)
  const changed = Object.entries(patch)
  if (changed.length === 0) return
  store.pushHistory(pageId)
  for (const [id, z] of changed) store.updateObject(pageId, id, { z })
}

/** Move `ids` so they sit directly above `afterId` (null = send to the very
 *  bottom). This is what a drag in the Layers list commits. */
export function reorderObjects(pageId: string, ids: string[], afterId: string | null) {
  const store = useDocStore.getState()
  const objects = store.pages[pageId]?.objects
  if (!objects) return
  const patch = reorderZ(objects, ids, afterId)
  const changed = Object.entries(patch)
  if (changed.length === 0) return
  store.pushHistory(pageId)
  for (const [id, z] of changed) store.updateObject(pageId, id, { z })
}

/** Wrap the selection in a container object. The members keep their absolute
 *  positions (see lib/scene/group.ts) — only ownership changes. */
export function groupObjects(pageId: string, ids: string[]) {
  const store = useDocStore.getState()
  const objects = store.pages[pageId]?.objects
  if (!objects) return
  // Never nest an object under two parents: group whatever ROOT each id
  // belongs to, so selecting a child of an existing group re-groups that
  // whole group rather than stealing one member out of it.
  const roots = [...new Set(ids.map((id) => rootGroupOf(id, objects)))]
  const members = roots
    .map((id) => objects[id])
    .filter((o): o is SceneObject => Boolean(o) && !o.metadata.locked)
  const group = makeGroup(members)
  if (!group) return
  group.z = nextTopZ(objects)
  store.pushHistory(pageId)
  store.addObject(pageId, group, { history: false })
  store.setSelection([group.id])
}

/** Dissolve the selected group(s), releasing their children back to the page.
 *  Children keep their positions, so nothing visibly moves. */
export function ungroupObjects(pageId: string, ids: string[]) {
  const store = useDocStore.getState()
  const objects = store.pages[pageId]?.objects
  if (!objects) return
  const groups = ids
    .map((id) => objects[id])
    .filter((o): o is SceneObject => o?.geometry.kind === 'group')
  if (groups.length === 0) return
  store.pushHistory(pageId)
  const freed: string[] = []
  for (const g of groups) {
    freed.push(...(g.geometry.children ?? []).filter((id) => objects[id]))
  }
  // Empty each container BEFORE deleting it. removeObjects cascades into a
  // group's children by design (deleting a group deletes its contents), so
  // dissolving one has to hand it over already empty or ungrouping would
  // wipe out exactly the objects it is meant to release.
  for (const g of groups) {
    store.updateObject(pageId, g.id, { geometry: { ...g.geometry, children: [] } })
  }
  store.removeObjects(pageId, groups.map((g) => g.id))
  store.setSelection(freed)
}

// ── The registry ────────────────────────────────────────────────────────────

const providers = new Map<string, ActionProvider>()

/** Contribute actions for matching selections. Keyed so hot-reload and
 *  re-imports replace rather than duplicate. Returns an unregister fn. */
export function registerSelectionActions(key: string, provider: ActionProvider): () => void {
  providers.set(key, provider)
  return () => {
    if (providers.get(key) === provider) providers.delete(key)
  }
}

const GROUP_ORDER: SelectionAction['group'][] = ['arrange', 'edit', 'convert', 'share']
// Promoted order for a fresh, unconverted shape (§10): attaching its first
// behavior is overwhelmingly the next thing done to it, so it leads instead
// of sitting after generic ops. Same groups, 'convert' moved to the front.
const PROMOTED_GROUP_ORDER: SelectionAction['group'][] = ['convert', 'arrange', 'edit', 'share']

/** Everything the current selection can do, grouped and ordered for display.
 *  Empty array when nothing is selected. */
export function actionsForSelection(ctx: ActionCtx): SelectionAction[] {
  if (ctx.ids.length === 0) return []

  // Requested order: Bring Front, Send Back, Duplicate, Copy, Properties, Delete
  const core: SelectionAction[] = [
    { id: 'properties', label: 'Properties', icon: SlidersHorizontal, group: 'edit', order: 50, run: openProperties },
  ]
  if (ctx.editing) {
    core.push(
      { id: 'bring-front', label: 'Bring to front', icon: BringToFront, group: 'arrange', order: 10, run: () => restackObjects(ctx.pageId, ctx.ids, 'front') },
      { id: 'send-back',   label: 'Send to back',   icon: SendToBack,   group: 'arrange', order: 20, run: () => restackObjects(ctx.pageId, ctx.ids, 'back') },
      { id: 'duplicate',   label: 'Duplicate',       icon: CopyPlus,     group: 'arrange', order: 30, run: () => duplicateObjects(ctx.pageId, ctx.ids) },
      { id: 'copy',        label: 'Copy',             icon: Copy,         group: 'arrange', order: 40, run: () => copySelection(ctx.pageId) },
      { id: 'delete',      label: 'Delete',           icon: Trash2,       group: 'edit',    order: 99, danger: true, run: () => useDocStore.getState().removeObjects(ctx.pageId, ctx.ids) },
    )
    const objs = useDocStore.getState().pages[ctx.pageId]?.objects ?? {}
    if (ctx.ids.length > 1) {
      core.push({
        id: 'group', label: 'Group', icon: Group, group: 'arrange', order: 5,
        run: () => groupObjects(ctx.pageId, ctx.ids),
      })
    }
    if (ctx.ids.some((id) => objs[id]?.geometry.kind === 'group')) {
      core.push({
        id: 'ungroup', label: 'Ungroup', icon: Ungroup, group: 'arrange', order: 6,
        run: () => ungroupObjects(ctx.pageId, ctx.ids),
      })
    }
  }

  // A lone, freshly-drawn shape with nothing attached yet and at least one
  // eligible behavior: surface the conversion step itself, promoted to the
  // top of the menu — the same state the Behaviors panel's empty-state
  // hint ("Attach a behavior to make it real") already describes.
  let promote = false
  if (ctx.editing && ctx.ids.length === 1) {
    const obj = useDocStore.getState().pages[ctx.pageId]?.objects[ctx.ids[0]]
    if (
      obj &&
      obj.behaviors.length === 0 &&
      !NO_BEHAVIOR_KINDS.includes(obj.geometry.kind) &&
      specsForGeometry(obj.geometry.kind).length > 0
    ) {
      promote = true
      core.push({
        id: 'convert-to-physics',
        label: 'Convert to physics object',
        icon: Zap,
        group: 'convert',
        run: openProperties,
      })
    }
  }

  const extra = ctx.editing ? [...providers.values()].flatMap((p) => p(ctx)) : []

  const groupOrder = promote ? PROMOTED_GROUP_ORDER : GROUP_ORDER
  return [...core, ...extra].sort(
    (a, b) =>
      groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) ||
      (a.order ?? 0) - (b.order ?? 0)
  )
}
