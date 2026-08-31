'use client'

// The Layers list: every object on the page, top of the stack first, with
// drag-to-restack and grouping — the Canva/Figma layers panel.
//
// Two deliberate choices:
//
//  1. Top-first. The list reads the way the page looks at you: the object
//     drawn ON TOP is the first row. The store's z is the opposite order
//     (1 = bottom), so this component reverses once, here, and never asks
//     the reader to invert in their head.
//
//  2. Pointer events, not HTML5 drag-and-drop. The repo's other lists use
//     `draggable` + dataTransfer, which does not fire on touch at all. This
//     panel has to work on a tablet, so it tracks pointermove itself.

import { useCallback, useMemo, useRef, useState } from 'react'
import { ChevronRight, GripVertical, Eye, EyeOff, Lock, LockOpen, Group, Ungroup } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import type { SceneObject } from '@/lib/scene/types'
import { stackOrder } from '@/lib/scene/z-order'
import { childrenOf, groupOf } from '@/lib/scene/group'
import { reorderObjects, groupObjects, ungroupObjects } from '@/lib/scene/selection-actions'
import { LayerThumb } from './layer-thumb'
import { cn } from '@/lib/utils'

/** A row in the rendered list: an object plus how deep it is nested. */
interface Row {
  obj: SceneObject
  depth: number
}

/** Flatten the page into display rows, top of the stack first.
 *
 *  Children are listed under their group (and only there) so an object never
 *  appears twice — the flat `objects` map holds group members as top-level
 *  entries, so they have to be filtered out of the root pass explicitly. */
function buildRows(
  objects: Record<string, SceneObject>,
  collapsed: Set<string>
): Row[] {
  const owned = new Set<string>()
  for (const o of Object.values(objects)) {
    if (o.geometry.kind === 'group') for (const c of o.geometry.children ?? []) owned.add(c)
  }

  const rows: Row[] = []
  const seen = new Set<string>()
  const push = (obj: SceneObject, depth: number) => {
    if (seen.has(obj.id)) return // cycle guard: corrupt data must not hang the list
    seen.add(obj.id)
    rows.push({ obj, depth })
    if (obj.geometry.kind === 'group' && !collapsed.has(obj.id)) {
      // Children top-first too, so the nesting reads the same way as the root.
      for (const child of childrenOf(obj, objects).slice().reverse()) push(child, depth + 1)
    }
  }

  // A system boundary is page furniture (z 0, always the backdrop), not a
  // layer the user restacks — listing it would only add a row that refuses
  // to move.
  for (const obj of stackOrder(objects).reverse()) {
    if (owned.has(obj.id)) continue
    if (obj.metadata.render === 'system') continue
    push(obj, 0)
  }
  return rows
}

/** What an object is called in the list. Ink and shapes rarely get named, so
 *  fall back to the kind rather than showing a bare auto-name. */
function layerLabel(obj: SceneObject): string {
  if (obj.geometry.kind === 'group') return obj.name || 'Group'
  return obj.name || obj.geometry.kind
}

export function LayersPanel({ pageId }: { pageId: string }) {
  const objects = useDocStore((s) => s.pages[pageId]?.objects)
  const selection = useDocStore((s) => s.selection)
  const setSelection = useDocStore((s) => s.setSelection)
  const updateObject = useDocStore((s) => s.updateObject)

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  /** id being dragged, and the row it would land above (null = bottom). */
  const [drag, setDrag] = useState<{ id: string; overId: string | null } | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const rows = useMemo(() => buildRows(objects ?? {}, collapsed), [objects, collapsed])

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** Which row the pointer is over, by hit-testing the rendered rows. Using
   *  geometry rather than per-row enter/leave handlers keeps this correct on
   *  touch, where a moving finger fires no enter/leave events at all. */
  const rowAt = useCallback((clientY: number): string | null => {
    const el = listRef.current
    if (!el) return null
    const nodes = el.querySelectorAll<HTMLElement>('[data-layer-id]')
    for (const node of nodes) {
      const r = node.getBoundingClientRect()
      if (clientY >= r.top && clientY <= r.bottom) return node.dataset.layerId ?? null
    }
    return null
  }, [])

  const startDrag = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.preventDefault()
      e.stopPropagation()
      const move = (ev: PointerEvent) => setDrag({ id, overId: rowAt(ev.clientY) })
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        setDrag(null)
        const overId = rowAt(ev.clientY)
        if (!overId || overId === id) return
        // The list is top-first but z counts up from the bottom, so dropping
        // ONTO a row means "sit directly above it" only after flipping: the
        // row visually above the drop target is the one with the higher z.
        // reorderObjects places the dragged ids directly ABOVE `afterId`, so
        // the anchor is the row one position DOWN the rendered list.
        const idx = rows.findIndex((r) => r.obj.id === overId)
        const below = rows[idx + 1]
        reorderObjects(pageId, [id], below ? below.obj.id : null)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [pageId, rowAt, rows]
  )

  if (!objects || rows.length === 0) {
    return (
      <p className="py-6 text-center text-ui-sm leading-relaxed text-muted-foreground">
        Nothing on this page yet — draw or place something and it shows up here.
      </p>
    )
  }

  const selectedGroups = selection.filter((id) => objects[id]?.geometry.kind === 'group')

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* Group / Ungroup, the two operations that change the tree itself. */}
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={selection.length < 2}
          onClick={() => groupObjects(pageId, selection)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/60 px-2 py-1.5 text-ui-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <Group className="h-3.5 w-3.5" />
          Group
        </button>
        <button
          type="button"
          disabled={selectedGroups.length === 0}
          onClick={() => ungroupObjects(pageId, selectedGroups)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border/60 px-2 py-1.5 text-ui-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <Ungroup className="h-3.5 w-3.5" />
          Ungroup
        </button>
      </div>

      <div ref={listRef} className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {rows.map(({ obj, depth }) => {
          const isSelected = selection.includes(obj.id)
          const isGroup = obj.geometry.kind === 'group'
          const hidden = obj.metadata.hidden === true
          const locked = obj.metadata.locked === true
          const isDragging = drag?.id === obj.id
          const isDropTarget = drag !== null && drag.id !== obj.id && drag.overId === obj.id

          return (
            <div
              key={obj.id}
              data-layer-id={obj.id}
              onPointerDown={() => {
                // A child row selects the child directly — the whole point of
                // opening the group in the list is to reach inside it.
                setSelection([obj.id])
              }}
              style={{ marginLeft: depth * 14 }}
              className={cn(
                'group/row flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors',
                'bg-muted/60 hover:bg-muted',
                isSelected && 'bg-[var(--accent-blue)]/10 ring-2 ring-[var(--accent-blue)]',
                isDragging && 'opacity-40',
                isDropTarget && 'ring-2 ring-[var(--accent-blue)]/60',
                hidden && 'opacity-50'
              )}
            >
              {/* The grip is the ONLY drag handle: dragging from anywhere in
                  the row would make it impossible to scroll the list on a
                  touch screen. */}
              <button
                type="button"
                aria-label={`Reorder ${layerLabel(obj)}`}
                onPointerDown={(e) => startDrag(e, obj.id)}
                className="shrink-0 cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" />
              </button>

              {isGroup ? (
                <button
                  type="button"
                  aria-label={collapsed.has(obj.id) ? 'Expand group' : 'Collapse group'}
                  aria-expanded={!collapsed.has(obj.id)}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleCollapse(obj.id)
                  }}
                  className="shrink-0 text-muted-foreground transition-transform hover:text-foreground"
                >
                  <ChevronRight
                    className={cn('h-3.5 w-3.5 transition-transform', !collapsed.has(obj.id) && 'rotate-90')}
                  />
                </button>
              ) : (
                <span className="w-3.5 shrink-0" />
              )}

              <LayerThumb obj={obj} objects={objects} />

              <span className="min-w-0 flex-1 truncate text-ui-sm">{layerLabel(obj)}</span>

              {/* Visibility and lock stay visible once ON, so a hidden or
                  locked layer is legible without hovering every row — that
                  state is exactly what you go looking for when something
                  won't select. */}
              <button
                type="button"
                aria-label={hidden ? 'Show layer' : 'Hide layer'}
                onClick={(e) => {
                  e.stopPropagation()
                  updateObject(pageId, obj.id, { metadata: { ...obj.metadata, hidden: !hidden } })
                }}
                className={cn(
                  'shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground',
                  hidden ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'
                )}
              >
                {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                aria-label={locked ? 'Unlock layer' : 'Lock layer'}
                onClick={(e) => {
                  e.stopPropagation()
                  updateObject(pageId, obj.id, { metadata: { ...obj.metadata, locked: !locked } })
                }}
                className={cn(
                  'shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground',
                  locked ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'
                )}
              >
                {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
