'use client'

// Overview mini-map (UX masterplan §3): collapsed by default — for the
// common case (a handful of objects) it's one more thing to parse, so it
// only earns screen space once the page has enough objects that "where is
// everything relative to where I am" becomes a real question. Object
// bounding boxes as dots, current viewport as a rectangle, click-to-jump.

import { useMemo, useState } from 'react'
import { Map as MapIcon } from 'lucide-react'
import type { SceneObject } from '@/lib/scene/types'
import type { Viewport } from '@/lib/store/document'
import { useDocStore } from '@/lib/store/document'
import { cn } from '@/lib/utils'

const MAP_W = 120
const MAP_H = 80
const PAD = 10
// Below this object count, zoom-to-fit already covers "where's everything"
// more cheaply than a permanent overview surface would.
const MIN_OBJECTS = 20

export function MiniMap({
  pageId,
  objects,
  viewport,
  containerSize,
}: {
  pageId: string
  objects: Record<string, SceneObject> | undefined
  viewport: Viewport
  containerSize: { w: number; h: number }
}) {
  const [expanded, setExpanded] = useState(false)
  const list = useMemo(() => Object.values(objects ?? {}), [objects])

  const layout = useMemo(() => {
    if (list.length === 0) return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const o of list) {
      x0 = Math.min(x0, o.position.x)
      y0 = Math.min(y0, o.position.y)
      x1 = Math.max(x1, o.position.x + o.size.w)
      y1 = Math.max(y1, o.position.y + o.size.h)
    }
    // Union in the current viewport rect too, so it's never clipped off the
    // overview just because the user panned away from the content.
    const vx0 = -viewport.x / viewport.zoom
    const vy0 = -viewport.y / viewport.zoom
    const vx1 = vx0 + containerSize.w / viewport.zoom
    const vy1 = vy0 + containerSize.h / viewport.zoom
    x0 = Math.min(x0, vx0); y0 = Math.min(y0, vy0)
    x1 = Math.max(x1, vx1); y1 = Math.max(y1, vy1)

    const worldW = Math.max(x1 - x0, 1)
    const worldH = Math.max(y1 - y0, 1)
    const innerW = MAP_W - PAD * 2
    const innerH = MAP_H - PAD * 2
    const scale = Math.min(innerW / worldW, innerH / worldH)
    const offX = PAD + (innerW - worldW * scale) / 2
    const offY = PAD + (innerH - worldH * scale) / 2
    const toMap = (wx: number, wy: number) => ({
      x: offX + (wx - x0) * scale,
      y: offY + (wy - y0) * scale,
    })
    return { x0, y0, scale, offX, offY, toMap, vx0, vy0, vx1, vy1 }
  }, [list, viewport.x, viewport.y, viewport.zoom, containerSize.w, containerSize.h])

  if (list.length < MIN_OBJECTS || !layout) return null

  const jump = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const worldX = layout.x0 + (mx - layout.offX) / layout.scale
    const worldY = layout.y0 + (my - layout.offY) / layout.scale
    useDocStore.getState().setViewport(pageId, {
      ...viewport,
      x: -worldX * viewport.zoom + containerSize.w / 2,
      y: -worldY * viewport.zoom + containerSize.h / 2,
    })
  }

  if (!expanded) {
    return (
      <button
        type="button"
        aria-label="Show overview map"
        onClick={() => setExpanded(true)}
        onMouseEnter={() => setExpanded(true)}
        className="glass fixed bottom-4 right-20 z-30 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        <MapIcon className="h-3 w-3" />
      </button>
    )
  }

  const viewRect = {
    left: layout.offX + (layout.vx0 - layout.x0) * layout.scale,
    top: layout.offY + (layout.vy0 - layout.y0) * layout.scale,
    width: (layout.vx1 - layout.vx0) * layout.scale,
    height: (layout.vy1 - layout.vy0) * layout.scale,
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseLeave={() => setExpanded(false)}
      onClick={jump}
      style={{ width: MAP_W, height: MAP_H }}
      className="glass fixed bottom-4 right-20 z-30 cursor-pointer overflow-hidden rounded-lg"
    >
      {list.map((o) => {
        const c = layout.toMap(o.position.x + o.size.w / 2, o.position.y + o.size.h / 2)
        return (
          <span
            key={o.id}
            className="absolute h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/70"
            style={{ left: c.x, top: c.y }}
          />
        )
      })}
      <div
        className={cn('pointer-events-none absolute border border-[var(--accent-blue)]')}
        style={{
          left: Math.max(0, viewRect.left),
          top: Math.max(0, viewRect.top),
          width: Math.min(viewRect.width, MAP_W),
          height: Math.min(viewRect.height, MAP_H),
        }}
      />
    </div>
  )
}
