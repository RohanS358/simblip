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
  SendToBack,
  Trash2,
} from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { openProperties } from '@/lib/store/sidebar-sections'
import { setClipboard, getClipboard, nextPasteOffset } from '@/lib/store/clipboard'
import { nextZ } from '@/lib/scene/factory'
import { str, uid, type SceneObject } from '@/lib/scene/types'

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
}

export type ActionProvider = (ctx: ActionCtx) => SelectionAction[]

// ── Shared edit operations (were closures inside canvas.tsx) ───────────────

/** Newly created/pasted/duplicated objects always land ABOVE everything
 *  already on the page — the page's actual max, not just a session counter,
 *  since a page can hold objects from earlier sessions with a higher z. */
export function topZ(pageId: string): number {
  const objs = useDocStore.getState().pages[pageId]?.objects ?? {}
  let max = 0
  for (const o of Object.values(objs)) if (o.z > max) max = o.z
  return Math.max(max + 1, nextZ())
}

export function copySelection(pageId: string) {
  const store = useDocStore.getState()
  const objs = store.selection
    .map((id) => store.pages[pageId]?.objects[id])
    .filter((o): o is SceneObject => Boolean(o))
  if (objs.length > 0) setClipboard(objs)
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
  const all = Object.values(store.pages[pageId]?.objects ?? {}).map((o) => o.z)
  const base = where === 'front' ? Math.max(...all, 0) : Math.min(...all, 0)
  const ordered = ids
    .map((id) => store.pages[pageId]?.objects[id])
    .filter((o): o is SceneObject => Boolean(o))
    .sort((a, b) => a.z - b.z)
  ordered.forEach((o, i) => {
    const z = where === 'front' ? base + 1 + i : base - ordered.length + i
    store.updateObject(pageId, o.id, { z }, { history: true })
  })
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

const GROUP_ORDER: SelectionAction['group'][] = ['edit', 'arrange', 'convert', 'share']

/** Everything the current selection can do, grouped and ordered for display.
 *  Empty array when nothing is selected. */
export function actionsForSelection(ctx: ActionCtx): SelectionAction[] {
  if (ctx.ids.length === 0) return []

  const core: SelectionAction[] = [
    { id: 'properties', label: 'Properties', icon: SlidersHorizontal, group: 'edit', run: openProperties },
  ]
  if (ctx.editing) {
    core.push(
      { id: 'copy', label: 'Copy', icon: Copy, group: 'edit', run: () => copySelection(ctx.pageId) },
      { id: 'duplicate', label: 'Duplicate', icon: CopyPlus, group: 'edit', run: () => duplicateObjects(ctx.pageId, ctx.ids) },
      { id: 'bring-front', label: 'Bring to front', icon: BringToFront, group: 'arrange', run: () => restackObjects(ctx.pageId, ctx.ids, 'front') },
      { id: 'send-back', label: 'Send to back', icon: SendToBack, group: 'arrange', run: () => restackObjects(ctx.pageId, ctx.ids, 'back') },
      { id: 'delete', label: 'Delete', icon: Trash2, group: 'edit', danger: true, run: () => useDocStore.getState().removeObjects(ctx.pageId, ctx.ids) },
    )
  }

  const extra = ctx.editing ? [...providers.values()].flatMap((p) => p(ctx)) : []

  return [...core, ...extra].sort(
    (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
  )
}
