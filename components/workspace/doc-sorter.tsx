'use client'

// PowerPoint/Canva-style page sorter for a doc's sheets — a bottom filmstrip
// of thumbnails you can drag to reorder or tap to jump to. Reorder is
// pointer-based (not HTML5 drag-and-drop): the sheet resize handle and every
// other drag gesture in this app already goes through raw Pointer Events for
// unified mouse/touch/pen support, and HTML5 DnD's touch support is
// inconsistent — a real gap for a feature whose whole point includes mobile
// parity.

import { useEffect, useRef, useState } from 'react'
import { motion as fm } from 'framer-motion'
import { X } from 'lucide-react'
import { PageThumbnail } from './page-thumbnail'
import { cn } from '@/lib/utils'

export function DocSorter({
  sheets,
  activeSheetId,
  onReorder,
  onJump,
  onClose,
}: {
  sheets: string[]
  activeSheetId: string | null
  onReorder: (next: string[]) => void
  onJump: (sheetId: string) => void
  onClose: () => void
}) {
  const [order, setOrder] = useState(sheets)
  const orderRef = useRef(order)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Reflect an external change (a sheet added/removed elsewhere) — but never
  // fight a drag in progress.
  useEffect(() => {
    if (!draggingId) setOrder(sheets)
  }, [sheets, draggingId])
  useEffect(() => {
    orderRef.current = order
  }, [order])

  const onTilePointerDown = (sheetId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const drag = { moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const startX = e.clientX

    const move = (ev: PointerEvent) => {
      if (!drag.moved) {
        if (Math.abs(ev.clientX - startX) < 4) return
        drag.moved = true
        setDraggingId(sheetId)
      }
      const container = containerRef.current
      if (!container) return
      const tiles = Array.from(container.querySelectorAll<HTMLElement>('[data-sorter-tile]'))
      let nearestIdx = 0
      let nearestDist = Infinity
      tiles.forEach((el, i) => {
        const r = el.getBoundingClientRect()
        const d = Math.abs(ev.clientX - (r.left + r.width / 2))
        if (d < nearestDist) {
          nearestDist = d
          nearestIdx = i
        }
      })
      setOrder((prev) => {
        const from = prev.indexOf(sheetId)
        if (from === -1 || from === nearestIdx) return prev
        const next = prev.slice()
        next.splice(from, 1)
        next.splice(nearestIdx, 0, sheetId)
        return next
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraggingId(null)
      if (drag.moved) onReorder(orderRef.current)
      else onJump(sheetId)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="glass-strong absolute inset-x-0 bottom-0 z-30 flex h-32 flex-col border-t border-border/40">
      <div className="flex shrink-0 items-center justify-between px-3 py-1">
       
        <button
          type="button"
          aria-label="Close page sorter"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={containerRef} className="thin-scrollbar flex min-h-0 flex-1 items-center gap-2.5 overflow-x-auto px-3 pb-2">
        {order.map((sheetId, i) => (
          <fm.div
            key={sheetId}
            layout
            data-sorter-tile
            onPointerDown={onTilePointerDown(sheetId)}
            className={cn(
              'relative h-full shrink-0 touch-none cursor-grab overflow-hidden rounded-md border bg-white shadow-sm active:cursor-grabbing dark:bg-neutral-900',
              activeSheetId === sheetId ? 'border-[var(--accent-blue)]' : 'border-border/50',
              draggingId === sheetId && 'opacity-70'
            )}
            style={{ aspectRatio: '210 / 297' }}
          >
            <PageThumbnail pageId={sheetId} className="pointer-events-none h-full w-full" />
            <span className="pointer-events-none absolute bottom-0.5 left-1 rounded bg-foreground/10 px-1 text-[0.5625rem] font-medium text-muted-foreground">
              {i + 1}
            </span>
          </fm.div>
        ))}
      </div>
    </div>
  )
}
