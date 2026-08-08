'use client'

// One registry of everything you can insert into a page: the component
// palette (every domain) plus the standalone widgets. Both the Ctrl+K search
// and the canvas "/" menu read from here, so a new component shows up in
// both without touching either.

import { COMPONENTS, createGeometry, baseObject } from './factory'
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
  widget('surface3d', '3D Graph', 'surface plot 3d z=f(x,y) plane sphere equation rotate calculus'),
  widget('chart', 'Chart', 'bar pie line area scatter stacked chart data visualization'),
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

/** Drop an insertable onto a page, centred on `center` (page coordinates).
 *  Two inserts in a row (viewport untouched) would otherwise land exactly on
 *  top of each other — nudge diagonally until clear of whatever's already
 *  sitting at that spot. */
export function insertAt(pageId: string, item: Insertable, center: Vec2): SceneObject {
  const store = useDocStore.getState()
  const obj = item.create(center)
  obj.position = { x: center.x - obj.size.w / 2, y: center.y - obj.size.h / 2 }
  const existing = Object.values(store.pages[pageId]?.objects ?? {})
  const overlaps = (p: Vec2) =>
    existing.some(
      (o) =>
        p.x < o.position.x + o.size.w &&
        p.x + obj.size.w > o.position.x &&
        p.y < o.position.y + o.size.h &&
        p.y + obj.size.h > o.position.y
    )
  for (let i = 0; i < 40 && overlaps(obj.position); i++)
    obj.position = { x: obj.position.x + 24, y: obj.position.y + 24 }
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

/** Natural pixel size of an image blob, capped to something sane for a
 *  freshly-pasted object so a 6000px phone photo doesn't fill the whole
 *  page — same idea as every other app's "paste image" default size. */
async function measureImage(blob: Blob): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const { w, h } = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = reject
      img.src = url
    })
    const MAX = 480
    const scale = Math.min(1, MAX / Math.max(w, h))
    return { w: Math.round(w * scale) || MAX, h: Math.round(h * scale) || MAX }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Upload an image or video blob and drop it onto a page as a picture object,
 *  centered on `center` — the paste/drop-image equivalent of insertAt. */
export async function insertImage(pageId: string, blob: Blob, name: string, center: Vec2): Promise<SceneObject> {
  const isVideo = blob.type.startsWith('video/')
  const [{ putFile }, { useAuthStore }, { w, h }] = await Promise.all([
    import('@/lib/storage/manager'),
    import('@/lib/auth/store'),
    isVideo ? Promise.resolve({ w: 480, h: 270 }) : measureImage(blob),
  ])
  const ownerId = useAuthStore.getState().profile?.id ?? 'anon'
  const fileId = await putFile(blob, name, blob.type || (isVideo ? 'video/mp4' : 'image/png'), ownerId)

  const obj = baseObject('picture', { x: center.x - w / 2, y: center.y - h / 2 }, name)
  obj.size = { w, h }
  obj.geometry.src = `opfs:${fileId}`
  if (isVideo) obj.metadata.isVideo = true

  const store = useDocStore.getState()
  const existingObjects = Object.values(store.pages[pageId]?.objects ?? {})
  const maxZ = existingObjects.reduce((max, o) => Math.max(max, o.z ?? 0), 0)
  obj.z = maxZ + 1

  store.pushHistory(pageId)
  store.addObject(pageId, obj)
  store.setSelection([obj.id])
  return obj
}
