'use client'

// One registry of everything you can insert into a page: the component
// palette (every domain) plus the standalone widgets. Both the Ctrl+K search
// and the canvas "/" menu read from here, so a new component shows up in
// both without touching either.

import { COMPONENTS, createGeometry } from './factory'
import { useDocStore } from '@/lib/store/document'
import type { SceneObject, Vec2 } from './types'

export interface Insertable {
  id: string
  label: string
  group: string
  /** extra words the search should match on */
  keywords: string
  create: (p: Vec2) => SceneObject
}

const widget = (
  kind: Parameters<typeof createGeometry>[0],
  label: string,
  keywords: string
): Insertable => ({
  id: `widget:${kind}`,
  label,
  group: 'Objects',
  keywords: `${label} ${keywords}`,
  create: (p) => createGeometry(kind, p),
})

import { usePrefs } from '@/lib/store/preferences'

const WIDGETS: Insertable[] = [
  widget('text', 'Text', 'write markdown paragraph'),
  widget('note', 'Note', 'sticky memo'),
  widget('formula', 'Formula', 'latex equation derivative integral laplace fourier'),
  widget('graph', 'Graph', 'plot chart series oscilloscope'),
  widget('table', 'Formula Table', 'excel data spreadsheet calculation formula'),
  widget('gridtable', 'Grid Table', 'simple word canva grid table rows columns transparent cell'),
  widget('slider', 'Slider', 'control input variable parameter interactive slider real-time'),
  widget('button', 'Button', 'control click trigger action set variable parameter'),
  widget('trigger', 'Trigger', 'conditional threshold comparison compare toggle automator'),
  widget('cashflow', 'Cash Flow', 'economics npv irr annuity salvage marr'),
  widget('truthtable', 'Truth Table', 'digital logic gate boolean inputs outputs'),
  widget('dsa', 'DSA Lab', 'c++ cpp code algorithm sort search recursion pointer array visualize interpreter complexity big-o'),
  widget('circle', 'Circle', 'shape ellipse'),
  widget('rect', 'Rectangle', 'shape box square'),
  widget('line', 'Line', 'shape beam segment'),
]

const title = (s: string) => (s === 'dsa' ? 'DSA' : s.charAt(0).toUpperCase() + s.slice(1))

export function getInsertables(): Insertable[] {
  const packages = usePrefs.getState?.()?.packages ?? {}
  const activeComponents = COMPONENTS.filter((c) => packages[c.domain] !== false)
  return [
    ...WIDGETS,
    ...activeComponents.map((c) => ({
      id: `component:${c.id}`,
      label: c.label,
      group: title(c.domain),
      keywords: `${c.label} ${c.domain} ${c.id.replace(/-/g, ' ')}`,
      create: c.create,
    })),
  ]
}

export const INSERTABLES: Insertable[] = getInsertables()

/** Case-insensitive token search — every typed word must appear somewhere. */
export function searchInsertables(query: string, limit = 40): Insertable[] {
  const q = query.trim().toLowerCase()
  const list = getInsertables()
  if (!q) return list.slice(0, limit)
  const words = q.split(/\s+/)
  const scored = list.map((it) => {
    const hay = `${it.label} ${it.group} ${it.keywords}`.toLowerCase()
    if (!words.every((w) => hay.includes(w))) return null
    // Prefix matches on the label rank first, then plain label hits.
    const label = it.label.toLowerCase()
    const rank = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2
    return { it, rank }
  }).filter((x): x is { it: Insertable; rank: number } => x !== null)
  return scored.sort((a, b) => a.rank - b.rank).slice(0, limit).map((x) => x.it)
}

/** Drop an insertable onto a page, centred on `center` (page coordinates). */
export function insertAt(pageId: string, item: Insertable, center: Vec2): SceneObject {
  const store = useDocStore.getState()
  const obj = item.create(center)
  obj.position = { x: center.x - obj.size.w / 2, y: center.y - obj.size.h / 2 }
  store.pushHistory(pageId)
  store.addObject(pageId, obj)
  store.setSelection([obj.id])
  return obj
}

/** Page coordinates of the middle of the visible canvas. */
export function viewportCenter(pageId: string): Vec2 {
  const v = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
  const w = typeof window === 'undefined' ? 1200 : window.innerWidth
  const h = typeof window === 'undefined' ? 800 : window.innerHeight
  return { x: (w / 2 - v.x) / v.zoom, y: (h / 2 - v.y) / v.zoom }
}
