'use client'

// The lesson camera: pan and zoom the board so a set of objects sits inside the part the
// student can actually see, clear of the caption bar and the tool dock. Tweened, so the
// picture glides into frame instead of cutting. Shared by the player (new section) and the
// section strip (go back and look).

import { useDocStore } from '@/lib/store/document'
import { sleep } from '@/lib/walkthrough/walkthrough-cursor-driver'
import { boxOf } from './sections'

/** The part of the board the student can actually SEE. The canvas runs under the floating side panel
 *  (the shell marks it `data-board-inset="left"`), so its own rectangle is wider than the visible board:
 *  everything the lesson places on screen — the camera frame, the caption bar, the teacher — works from
 *  this rectangle instead. Null when there is no board on screen. */
export function visibleBoard(): { left: number; top: number; width: number; height: number } | null {
  const c = document.querySelector('[aria-label="Infinite canvas"]')?.getBoundingClientRect()
  if (!c || c.width < 240 || c.height < 200) return null
  const inset = document.querySelector('[data-board-inset="left"]')?.getBoundingClientRect()
  const left = inset ? Math.min(c.right - 240, Math.max(c.left, inset.right)) : c.left
  return { left, top: c.top, width: c.right - left, height: c.height }
}

/** Space kept clear along the bottom of the board for the caption bar, controls and tool dock. */
export const FRAME_BOTTOM = 340

export async function frameObjects(pageId: string, ids: string[] | null, cancelled: () => boolean = () => false): Promise<void> {
  const root = document.querySelector(`[data-canvas-root="${pageId}"]`) as HTMLElement | null
  const all = Object.values(useDocStore.getState().pages[pageId]?.objects ?? {})
  const objs = ids ? all.filter((o) => ids.includes(o.id)) : all
  const box = boxOf(objs)
  if (!root || !box) return
  const r = root.getBoundingClientRect()
  // The root runs under the sidebar and panels; the part the student can SEE is the inner canvas.
  const vis = visibleBoard() ?? r
  const offX = vis.left - r.left, offY = vis.top - r.top
  const pad = 28, topReserve = 76 /* the page header floats over the board */
  const availW = Math.max(200, vis.width - pad * 2), availH = Math.max(160, vis.height - FRAME_BOTTOM - topReserve)
  const zoom = Math.max(0.3, Math.min(1.1, availW / Math.max(1, box.w), availH / Math.max(1, box.h)))
  const target = { zoom, x: offX + pad + (availW - box.w * zoom) / 2 - box.x * zoom, y: offY + topReserve + (availH - box.h * zoom) / 2 - box.y * zoom }
  const from = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
  // A long trip between distant sections reads as a deliberate slide, not a snap.
  const dist = Math.hypot(target.x - from.x, target.y - from.y)
  const steps = Math.max(12, Math.min(36, Math.round(dist / 40)))
  for (let i = 1; i <= steps && !cancelled(); i++) {
    const t = i / steps
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 // ease in-out: the board is moved by hand
    useDocStore.getState().setViewport(pageId, { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, zoom: from.zoom + (target.zoom - from.zoom) * e })
    await sleep(24)
  }
}
