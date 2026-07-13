'use client'

// Focus mode (phones and tablets).
//
// On a small screen the Inspector covers the thing you're editing — you change
// a value and can't see what it did. So opening properties on a touch device
// LIFTS the selected object out of the canvas: the board dims, and the object
// itself floats above it, live, re-rendering as you edit. It's the same
// component the canvas draws, not a screenshot, so a running simulation keeps
// running and a graph keeps updating while you tune it.
//
// Tap the dimmed area and the object flies back to exactly where it came from.

import { useEffect, useState } from 'react'
import { motion as fm, AnimatePresence } from 'framer-motion'
import { useDocStore } from '@/lib/store/document'
import { getElement } from '@/lib/physics/world'
import { OBJECT_RENDERERS } from '@/components/objects'
import { useSpring } from '@/lib/motion'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function FocusObject({
  pageId,
  objectId,
  onDismiss,
  reserve,
}: {
  pageId: string
  objectId: string | null
  onDismiss: () => void
  /** Space the properties panel occupies — the object must not hide under it. */
  reserve?: { right?: number; bottom?: number }
}) {
  const object = useDocStore((s) => (objectId ? s.pages[pageId]?.objects[objectId] : undefined))
  const spring = useSpring('soft')
  // Where the object currently sits on screen — the animation starts there, so
  // it reads as the SAME object rising up, not a copy appearing.
  const [from, setFrom] = useState<Rect | null>(null)

  useEffect(() => {
    if (!objectId) {
      setFrom(null)
      return
    }
    const el = getElement(objectId)
    const r = el?.getBoundingClientRect()
    if (r) setFrom({ x: r.left, y: r.top, w: r.width, h: r.height })
  }, [objectId])

  if (!object || !from) return null

  const Renderer = OBJECT_RENDERERS[object.geometry.kind]
  if (!Renderer) return null

  // Fill the free space — everything the properties panel isn't using. The
  // object is scaled to FIT that box (one uniform factor, so its proportions
  // are untouched), padded off whichever side runs out first. Scaling up is
  // allowed: the point of focusing is to see the thing large.
  const PAD = 28
  const availW = window.innerWidth - (reserve?.right ?? 0)
  const availH = window.innerHeight - (reserve?.bottom ?? 0)
  const boxW = Math.max(80, availW - PAD * 2)
  const boxH = Math.max(80, availH - PAD * 2)
  const scale = Math.min(boxW / Math.max(object.size.w, 1), boxH / Math.max(object.size.h, 1))
  const toW = object.size.w * scale
  const toH = object.size.h * scale
  const toX = (availW - toW) / 2
  const toY = (availH - toH) / 2

  return (
    <AnimatePresence>
      <fm.div key="scrim" className="fixed inset-0 z-[55]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        {/* Tap anywhere dark to send it home. */}
        <button
          type="button"
          aria-label="Close focus view"
          className="absolute inset-0 h-full w-full bg-black/55 backdrop-blur-[2px]"
          onClick={onDismiss}
        />

        <fm.div
          className="pointer-events-none absolute origin-top-left"
          initial={{ x: from.x, y: from.y, width: from.w, height: from.h, opacity: 0.6 }}
          animate={{ x: toX, y: toY, width: toW, height: toH, opacity: 1 }}
          exit={{ x: from.x, y: from.y, width: from.w, height: from.h, opacity: 0 }}
          transition={spring}
        >
          {/* No card, no frame — just the component itself, floating on the
              dim. It's rendered at its true size and scaled, so its internals
              (graphs, tables, text) stay crisp and LIVE rather than being
              blown up as pixels. */}
          <div
            className="pointer-events-auto origin-top-left"
            style={{
              width: object.size.w,
              height: object.size.h,
              transform: `scale(${scale})`,
            }}
          >
            <Renderer pageId={pageId} object={object} selected={false} />
          </div>
        </fm.div>
      </fm.div>
    </AnimatePresence>
  )
}
