'use client'

// Presentation page: the SAME sheet-of-SceneObjects engine as doc-view.tsx
// (a slide IS a docPages entry — plain scene-object canvas content, edited
// with the exact same tools/objects/drag-drop as a Document) laid out as a
// slide deck instead of a scrolling document: a slide-list rail down the
// side, one slide shown at a time, and a Present button for a fullscreen
// slideshow. doc-view.tsx itself is untouched — this is a separate
// component built on the same underlying page-content primitives, not a
// variant grafted onto it.
//
// Import parses an uploaded .pptx's slide XML into SceneObjects on first
// open (lib/store/pptx-import.ts) — best-effort fidelity, not pixel-perfect.
// Export walks the slide object trees back into a real .pptx via pptxgenjs.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion as fm, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Copy, Loader2, X, ChevronLeft, ChevronRight,
  ZoomIn, ZoomOut, Sparkles, Download, MonitorPlay,
} from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { getFile } from '@/lib/storage/manager'
import type { SlideTransition } from '@/lib/store/presentation-dock'
import { InfiniteCanvas } from './canvas'
import { PageThumbnail } from './page-thumbnail'
import { cn } from '@/lib/utils'
import { uid } from '@/lib/scene/types'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'

// Variants keyed by direction (1 = advancing, -1 = going back) so "slide"
// always animates the new slide in from the direction you're moving toward,
// matching how every real presentation tool's slide transition works.
const SLIDE_VARIANTS = {
  initial: (dir: 1 | -1) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 1 }),
  animate: { x: '0%', opacity: 1 },
  exit: (dir: 1 | -1) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 1 }),
}
const FADE_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

function TransitionSlide({
  transition,
  dir,
  slideKey,
  className,
  style,
  children,
}: {
  transition: SlideTransition
  dir: 1 | -1
  slideKey: string
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  if (transition === 'none') {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    )
  }
  const variants = transition === 'slide' ? SLIDE_VARIANTS : FADE_VARIANTS
  return (
    <AnimatePresence mode="wait" custom={dir} initial={false}>
      <fm.div
        key={slideKey}
        custom={dir}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        className={className}
        style={style}
      >
        {children}
      </fm.div>
    </AnimatePresence>
  )
}

function PresentOverlay({
  slides,
  startAt,
  onClose,
  sheetColors,
  transition,
}: {
  slides: string[]
  startAt: number
  onClose: () => void
  sheetColors?: Record<string, string>
  transition: SlideTransition
}) {
  const [i, setI] = useState(startAt)
  const [dir, setDir] = useState<1 | -1>(1)
  const go = (next: number) => {
    setDir(next > i ? 1 : -1)
    setI(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === ' ') go(Math.min(slides.length - 1, i + 1))
      if (e.key === 'ArrowLeft') go(Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length, onClose, i])

  // Phone remote's Previous/Next while the overlay itself is on screen —
  // the parent PresentationView also listens for this same event to keep
  // its own `current` in sync for when the overlay closes, but that state
  // is separate from this overlay's own `i` (only seeded once at mount via
  // startAt), so this overlay needs its own listener too.
  useEffect(() => {
    const onRemote = (e: Event) => {
      const d = (e as CustomEvent).detail as { dir: number }
      go(Math.max(0, Math.min(slides.length - 1, i + d.dir)))
    }
    window.addEventListener('simblip-remote-pptx', onRemote)
    return () => window.removeEventListener('simblip-remote-pptx', onRemote)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length, i])

  // Remote's End slideshow (slideshow:false) — mirrors Escape.
  useEffect(() => {
    const onRemote = (e: Event) => {
      const d = (e as CustomEvent).detail as { on: boolean }
      if (!d.on) onClose()
    }
    window.addEventListener('simblip-remote-slideshow', onRemote)
    return () => window.removeEventListener('simblip-remote-slideshow', onRemote)
  }, [onClose])

  const slideId = slides[i]

  // The slide's own content is positioned in SIMBLIP's fixed 960x540
  // coordinate space (see pptx-import.ts's SIMBLIP_SLIDE_W/H_PX and the
  // main stage's own `width: 960, height: 540` box) — the frame here must
  // stay a literal 960x540 box and get scaled down/up via CSS transform to
  // fit the fullscreen viewport, the same way the main stage does with
  // `zoom`. Letting the frame's own CSS width stretch responsively
  // (the previous w-full max-w-[1400px]) kept objects at their correct
  // relative positions but in a box far bigger than the space they were
  // laid out for — everything clustered top-left with dead space around it.
  const [frameScale, setFrameScale] = useState(1)
  useEffect(() => {
    const compute = () => {
      // visualViewport tracks the actually-visible area on mobile (shrinks
      // when a browser chrome bar is showing, or the on-screen keyboard is
      // up) — window.innerHeight alone doesn't update for that, so the
      // frame would overflow under the address bar on phones.
      const vv = window.visualViewport
      const vw = vv?.width ?? window.innerWidth
      const vh = vv?.height ?? window.innerHeight
      // Chrome reserve scales with the viewport instead of a flat 200px:
      // on a small phone in landscape that constant exceeded the height
      // outright, producing a zero-or-negative scale and a blank slide.
      const padX = vw < 640 ? 24 : 64
      const reserve = Math.min(200, Math.max(72, vh * 0.18))
      const availW = Math.max(120, vw - padX)
      const availH = Math.max(80, vh - reserve)
      setFrameScale(Math.max(0.05, Math.min(availW / 960, availH / 540)))
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('orientationchange', compute)
    window.visualViewport?.addEventListener('resize', compute)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('orientationchange', compute)
      window.visualViewport?.removeEventListener('resize', compute)
    }
  }, [])

  // Swipe to change slides. On a phone the overlay is fullscreen with no
  // visible controls but the close button, so without this there was no way
  // to advance a slide by touch at all — the keyboard handler above is
  // desktop-only in practice.
  const swipeRef = useRef<{ x: number; y: number } | null>(null)
  const onSwipeStart = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    swipeRef.current = { x: e.clientX, y: e.clientY }
  }
  const onSwipeEnd = (e: React.PointerEvent) => {
    const s = swipeRef.current
    swipeRef.current = null
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    // Horizontal intent only, so a vertical drag (or a pinch) never advances.
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0) go(Math.min(slides.length - 1, i + 1))
    else go(Math.max(0, i - 1))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        touchAction: 'none',
      }}
      onPointerDown={onSwipeStart}
      onPointerUp={onSwipeEnd}
      onPointerCancel={() => (swipeRef.current = null)}
    >
      <button
        type="button"
        aria-label="Exit presentation"
        className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-8">
        {slideId && (
          <div
            className="relative shrink-0 overflow-hidden rounded-md shadow-2xl"
            style={{ width: 960, height: 540, transform: `scale(${frameScale})` }}
          >
            <TransitionSlide
              transition={transition}
              dir={dir}
              slideKey={slideId}
              className="absolute inset-0 bg-white"
              style={{ backgroundColor: sheetColors?.[slideId] }}
            >
              <InfiniteCanvas key={slideId} pageId={slideId} locked transparent passthrough viewer active={false} />
            </TransitionSlide>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-4 pb-6 text-white">
        <button
          type="button"
          aria-label="Previous slide"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30"
          disabled={i === 0}
          onClick={() => go(Math.max(0, i - 1))}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-mono text-[0.8125rem] tabular-nums">
          {i + 1} / {slides.length}
        </span>
        <button
          type="button"
          aria-label="Next slide"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 disabled:opacity-30"
          disabled={i === slides.length - 1}
          onClick={() => go(Math.min(slides.length - 1, i + 1))}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

export function PresentationView({ pageId }: { pageId: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId))
  const slides = meta?.docPages ?? []
  // Touch has no hover — the insert-slide '+' between tiles was only ever
  // shown on onMouseEnter, so it never appeared on a phone/tablet at all.
  const isTouch = useIsMobile()
  const [current, setCurrent] = useState(0)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [presenting, setPresenting] = useState(false)
  // A pure CSS view scale on the rendered slide frame — same model as
  // doc-view.tsx's zoom (transform: scale(zoom)), NOT the canvas's own
  // internal viewport zoom (InfiniteCanvas keeps that permanently locked
  // to 1 for doc/pptx sheets — see canvas.tsx's `locked` effect — so
  // object positions always mean the same on-slide px regardless of how
  // zoomed-in the user's VIEW of the slide currently is).
  const [zoom, setZoomRaw] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const setZoom = (z: number) => setZoomRaw(Math.min(3, Math.max(0.25, z)))
  const fitWidth = () => {
    const el = stageRef.current
    if (el) {
      const scaleW = (el.clientWidth - 48) / 960
      const scaleH = (el.clientHeight - 48) / 540
      setZoom(Math.min(3, Math.max(0.25, Math.min(scaleW, scaleH))))
    }
  }

  // Auto-fit on initial mount so the presentation fills the stage viewport cleanly.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const scaleW = (el.clientWidth - 48) / 960
    const scaleH = (el.clientHeight - 48) / 540
    setZoomRaw(Math.min(3, Math.max(0.25, Math.min(scaleW, scaleH))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // How the active slide animates in on change — applies both to the main
  // stage (board remote / manual rail clicks) and the fullscreen Present
  // overlay, so a board audience sees the same transition the presenter set.
  const [transition, setTransition] = useState<SlideTransition>('none')
  const [stageDir, setStageDir] = useState<1 | -1>(1)
  const goToSlide = (next: number) => {
    setCurrent((c) => {
      setStageDir(next >= c ? 1 : -1)
      return next
    })
  }
  const importedRef = useRef(false)

  const fileUrl = meta?.fileUrl
  useEffect(() => {
    if (slides.length > 0 || importedRef.current) return
    const fileId = fileUrl?.startsWith('opfs:') ? fileUrl.slice('opfs:'.length) : null
    if (!fileId) {
      // No source file (or already-empty deck) — start with one blank slide.
      importedRef.current = true
      useWorkspaceStore.getState().addDocSheet(pageId)
      return
    }
    importedRef.current = true
    setImporting(true)
    void (async () => {
      try {
        const blob = await getFile(fileId)
        if (!blob) throw new Error('missing file')
        const { useAuthStore } = await import('@/lib/auth/store')
        const ownerId = useAuthStore.getState().profile?.id ?? 'anon'
        const { importPptx } = await import('@/lib/store/pptx-import')
        const imported = await importPptx(blob, ownerId)
        const { useDocStore } = await import('@/lib/store/document')
        const sheetColors: Record<string, string> = {}
        for (const slide of imported.length ? imported : [{ objects: [] }]) {
          const slideId = useWorkspaceStore.getState().addDocSheet(pageId)
          for (const obj of slide.objects) useDocStore.getState().addObject(slideId, obj)
          if (slide.background) sheetColors[slideId] = slide.background
        }
        if (Object.keys(sheetColors).length) {
          useWorkspaceStore.getState().updatePageMeta(pageId, { sheetColors })
        }
      } catch {
        toast.error('Could not read this presentation — starting blank.')
        useWorkspaceStore.getState().addDocSheet(pageId)
      } finally {
        setImporting(false)
      }
    })()
  }, [slides.length, fileUrl, pageId])

  const removeSlide = (slideId: string) => {
    if (slides.length <= 1) return
    useWorkspaceStore.getState().updatePageMeta(pageId, { docPages: slides.filter((id) => id !== slideId) })
    void import('@/lib/store/document').then(({ useDocStore }) => useDocStore.getState().forgetPage(slideId))
    setCurrent((c) => Math.max(0, Math.min(c, slides.length - 2)))
  }

  // Deep-clones every SceneObject onto a fresh sheet id (fresh object ids
  // too — two objects sharing an id across pages would corrupt selection/
  // history, which are keyed by id alone) and inserts it right after the
  // source slide, matching every real presentation tool's "Duplicate slide".
  const duplicateSlide = async (slideId: string) => {
    const { useDocStore } = await import('@/lib/store/document')
    const sourceObjects = useDocStore.getState().pages[slideId]?.objects ?? {}
    const newId = useWorkspaceStore.getState().addDocSheet(pageId)
    for (const obj of Object.values(sourceObjects)) {
      useDocStore.getState().addObject(newId, { ...obj, id: uid() }, { history: false })
    }
    const bg = meta?.sheetColors?.[slideId]
    const sourceIdx = slides.indexOf(slideId)
    // addDocSheet appends newId at the end of docPages — move it to sit
    // right after its source instead.
    const reordered = slides.slice()
    reordered.splice(sourceIdx + 1, 0, newId)
    useWorkspaceStore.getState().updatePageMeta(pageId, {
      docPages: reordered,
      sheetColors: bg ? { ...meta?.sheetColors, [newId]: bg } : meta?.sheetColors,
    })
    setCurrent(sourceIdx + 1)
  }

  const reorderSlides = (next: string[]) => {
    useWorkspaceStore.getState().updatePageMeta(pageId, { docPages: next })
    const activeId = slides[current]
    const nextIdx = next.indexOf(activeId)
    if (nextIdx !== -1) setCurrent(nextIdx)
  }

  // Pointer-based drag-reorder — same interaction model as doc-sorter.tsx's
  // filmstrip (raw Pointer Events, not HTML5 DnD, for unified mouse/touch/
  // pen support): nearest-tile-by-X, since the rail is a horizontal strip.
  const railRef = useRef<HTMLDivElement>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragOrderRef = useRef<string[]>(slides)
  // Index of the gap between slides where '+' button is hovered (0 = before first, n = after last)
  const [hoverGap, setHoverGap] = useState<number | null>(null)

  // Touch needs a hold before drag activates, else the reorder gesture
  // fights the rail's native horizontal scroll on every swipe. Mouse can
  // keep the old instant 4px threshold — a mouse-down-drag on a desktop
  // trackpad/wheel doesn't compete with a scroll gesture the same way.
  const HOLD_MS = 1000
  const EDGE_SCROLL_PX = 48
  const EDGE_SCROLL_SPEED = 12

  const onTilePointerDown = (slideId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const isTouchPointer = e.pointerType === 'touch' || e.pointerType === 'pen'
    const drag = { moved: false, armed: !isTouchPointer }
    const startX = e.clientX
    const startY = e.clientY
    dragOrderRef.current = slides
    let autoScrollRaf: number | null = null
    let lastClientX = startX

    const stopAutoScroll = () => {
      if (autoScrollRaf !== null) cancelAnimationFrame(autoScrollRaf)
      autoScrollRaf = null
    }

    const tick = () => {
      const rail = railRef.current
      if (!rail || !drag.moved) {
        autoScrollRaf = null
        return
      }
      const r = rail.getBoundingClientRect()
      if (lastClientX < r.left + EDGE_SCROLL_PX) rail.scrollLeft -= EDGE_SCROLL_SPEED
      else if (lastClientX > r.right - EDGE_SCROLL_PX) rail.scrollLeft += EDGE_SCROLL_SPEED
      autoScrollRaf = requestAnimationFrame(tick)
    }

    const startDrag = () => {
      if (drag.moved) return
      drag.moved = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDraggingId(slideId)
      setDragOrder(slides)
      autoScrollRaf = requestAnimationFrame(tick)
    }

    let holdTimer: ReturnType<typeof setTimeout> | null = isTouchPointer
      ? setTimeout(() => {
          drag.armed = true
          startDrag()
        }, HOLD_MS)
      : null

    const reorderTo = (clientX: number) => {
      const rail = railRef.current
      if (!rail) return
      const tiles = Array.from(rail.querySelectorAll<HTMLElement>('[data-slide-tile]'))
      let nearestIdx = 0
      let nearestDist = Infinity
      tiles.forEach((el, i) => {
        const r = el.getBoundingClientRect()
        const d = Math.abs(clientX - (r.left + r.width / 2))
        if (d < nearestDist) {
          nearestDist = d
          nearestIdx = i
        }
      })
      setDragOrder((prev) => {
        const cur = prev ?? slides
        const from = cur.indexOf(slideId)
        if (from === -1 || from === nearestIdx) return prev
        const next = cur.slice()
        next.splice(from, 1)
        next.splice(nearestIdx, 0, slideId)
        dragOrderRef.current = next
        return next
      })
    }

    const move = (ev: PointerEvent) => {
      lastClientX = ev.clientX
      // Before the hold fires (touch) or the threshold trips (mouse), any
      // real movement means the user is scrolling the rail, not reordering
      // — cancel the pending hold so native scroll takes over.
      if (!drag.armed) {
        if (Math.abs(ev.clientX - startX) > 8 || Math.abs(ev.clientY - startY) > 8) {
          if (holdTimer) clearTimeout(holdTimer)
          holdTimer = null
        }
        return
      }
      if (!drag.moved) {
        if (isTouchPointer) return // hold timer owns activation for touch
        if (Math.abs(ev.clientX - startX) < 4) return
        startDrag()
      }
      reorderTo(ev.clientX)
    }
    const up = () => {
      if (holdTimer) clearTimeout(holdTimer)
      stopAutoScroll()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDraggingId(null)
      setDragOrder(null)
      // A drag that never actually moved (held past HOLD_MS but released
      // without dragging) shouldn't navigate — the hold itself wasn't a tap.
      if (drag.moved) reorderSlides(dragOrderRef.current)
      else if (isTouchPointer ? !drag.armed : true) goToSlide(slides.indexOf(slideId))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const displayedSlides = dragOrder ?? slides

  /** Insert a blank slide at position `afterIndex` (0 = prepend, n = append after slide n-1) */
  const insertSlideAt = (afterIndex: number) => {
    const newId = useWorkspaceStore.getState().addDocSheet(pageId)
    const current = useWorkspaceStore.getState()
    const updatedSlides = [...slides]
    // addDocSheet appends to the end; reorder to the desired position
    updatedSlides.splice(afterIndex, 0, newId)
    useWorkspaceStore.getState().updatePageMeta(pageId, { docPages: updatedSlides })
    setCurrent(afterIndex)
    setHoverGap(null)
  }

  const exportPptx = async () => {
    setExporting(true)
    try {
      const { useDocStore } = await import('@/lib/store/document')
      const { exportPptx: doExport } = await import('@/lib/store/pptx-export')
      const slideContents = slides.map((id) => useDocStore.getState().pages[id]?.objects ?? {})
      const backgrounds = slides.map((id) => meta?.sheetColors?.[id])
      const blob = await doExport(slideContents, backgrounds)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${meta?.name ?? 'presentation'}.pptx`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      toast.error('Could not export this presentation.')
    } finally {
      setExporting(false)
    }
  }

  const activeSlideId = slides[current]

  // sidebar.tsx's Inspector reads activeSheetId (not activePageId) for doc/
  // pptx pages — a Presentation's real content lives in the per-slide
  // docPages entry, not the presentation container page itself. Without
  // this, selecting an object on a slide looked up its page under the
  // wrong id and the Inspector always rendered empty.
  useEffect(() => {
    useWorkspaceStore.getState().setActiveSheet(activeSlideId ?? null)
    return () => useWorkspaceStore.getState().setActiveSheet(null)
  }, [activeSlideId])

  // Teacher's phone remote (board presentations) — same pattern as
  // file-view.tsx's simblip-remote-pdf listener, one custom event per page
  // kind since a board session mounts exactly one page kind at a time.
  useEffect(() => {
    const onRemote = (e: Event) => {
      const d = (e as CustomEvent).detail as { dir: number }
      setStageDir(d.dir > 0 ? 1 : -1)
      setCurrent((c) => Math.max(0, Math.min(slides.length - 1, c + d.dir)))
    }
    window.addEventListener('simblip-remote-pptx', onRemote)
    return () => window.removeEventListener('simblip-remote-pptx', onRemote)
  }, [slides.length])

  // Remote-triggered fullscreen slideshow — same PresentOverlay the local
  // "Present" button opens, just started/stopped from the phone.
  useEffect(() => {
    const onRemote = (e: Event) => {
      const d = (e as CustomEvent).detail as { on: boolean }
      setPresenting(d.on)
    }
    window.addEventListener('simblip-remote-slideshow', onRemote)
    return () => window.removeEventListener('simblip-remote-slideshow', onRemote)
  }, [])


  return (
    <div className="flex h-full w-full flex-col">
      {/*
        The stage scrolls when the slide is zoomed past the viewport.
        `transform: scale()` does NOT contribute to a parent's scrollable
        area — the box keeps its unscaled 960×540 size for layout — so the
        old negative-margin trick only approximated it and broke entirely
        when zoomed out. A wrapper sized to the SCALED dimensions gives the
        scroll container something real to measure, and `touch-action` +
        `-webkit-overflow-scrolling` are what make it actually drag on iOS,
        where the default here was "nothing moves".
      */}
      <div
        ref={stageRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/40"
        style={{ touchAction: 'pan-x pan-y pinch-zoom', WebkitOverflowScrolling: 'touch' }}
      >
        {importing ? (
          <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[0.75rem]">Importing presentation…</span>
          </div>
        ) : activeSlideId ? (
          <div
            className="flex min-h-full items-center justify-center p-4 sm:p-6"
            // The scaled footprint, so the scroll container can measure it.
            style={{ minWidth: 960 * zoom + 32, minHeight: 540 * zoom + 32 }}
          >
          <div
            className="relative shrink-0 overflow-hidden rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
            style={{
              width: 960,
              height: 540,
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
            <TransitionSlide
              transition={transition}
              dir={stageDir}
              slideKey={activeSlideId}
              className="absolute inset-0 bg-white"
              style={{ backgroundColor: meta?.sheetColors?.[activeSlideId] }}
            >
              <InfiniteCanvas key={activeSlideId} pageId={activeSlideId} locked transparent passthrough active />
            </TransitionSlide>
          </div>
          </div>
        ) : null}
      </div>

      {/* Slide rail. Shorter on phones, where a 96px rail plus the toolbar
          ate most of a small viewport and left the slide itself squeezed. */}
      <div
        ref={railRef}
        className="flex h-16 shrink-0 items-center gap-0 overflow-x-auto overscroll-x-contain border-t border-border/60 bg-muted/30 p-2 sm:h-24"
        style={{ touchAction: 'pan-x', WebkitOverflowScrolling: 'touch' }}
        onMouseLeave={() => setHoverGap(null)}
      >
        {displayedSlides.map((id, tileIdx) => {
          const i = slides.indexOf(id)
          return (
            <div key={id} className="flex items-center h-full">
              {/* Gap before this tile — shows '+' on hover */}
              <div
                className="relative flex items-center justify-center h-full"
                style={{ width: 18 }}
                onMouseEnter={() => setHoverGap(tileIdx)}
              >
                {(isTouch || hoverGap === tileIdx) && !draggingId && (
                  <button
                    type="button"
                    aria-label={`Insert slide at position ${tileIdx + 1}`}
                    className="absolute z-20 flex items-center justify-center rounded-full bg-[var(--accent-blue)] text-white shadow-md transition-transform hover:scale-110 active:scale-95"
                    style={isTouch ? { width: 28, height: 28 } : { width: 20, height: 20 }}
                    onClick={() => insertSlideAt(tileIdx)}
                  >
                    <Plus className="h-3 w-3" strokeWidth={3} />
                  </button>
                )}
              </div>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    data-slide-tile
                    onPointerDown={onTilePointerDown(id)}
                    onMouseEnter={() => setHoverGap(null)}
                    className={cn(
                      'group relative aspect-video h-full shrink-0 touch-none cursor-grab overflow-hidden rounded-md border bg-white text-left active:cursor-grabbing',
                      i === current ? 'border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/30' : 'border-border/60',
                      draggingId === id && 'opacity-70'
                    )}
                    style={{ backgroundColor: meta?.sheetColors?.[id] }}
                  >
                    <PageThumbnail pageId={id} className="pointer-events-none absolute inset-0 h-full w-full" />
                    <span className="absolute left-1 top-1 z-10 rounded bg-black/40 px-1 text-[0.5625rem] font-semibold text-white">
                      {i + 1}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => void duplicateSlide(id)}>
                    <Copy className="h-4 w-4" /> Duplicate slide
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    disabled={slides.length <= 1}
                    onClick={() => removeSlide(id)}
                  >
                    <Trash2 className="h-4 w-4" /> Delete slide
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
          )
        })}
        {/* Gap after the last slide */}
        <div
          className="relative flex items-center justify-center h-full"
          style={{ width: 18 }}
          onMouseEnter={() => setHoverGap(displayedSlides.length)}
        >
          {(isTouch || hoverGap === displayedSlides.length) && !draggingId && (
            <button
              type="button"
              aria-label="Insert slide at end"
              className="absolute z-20 flex items-center justify-center rounded-full bg-[var(--accent-blue)] text-white shadow-md transition-transform hover:scale-110 active:scale-95"
              style={isTouch ? { width: 28, height: 28 } : { width: 20, height: 20 }}
              onClick={() => insertSlideAt(displayedSlides.length)}
            >
              <Plus className="h-3 w-3" strokeWidth={3} />
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Add slide"
          className="flex aspect-video h-full shrink-0 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground/50 transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
          onMouseEnter={() => setHoverGap(null)}
          onClick={() => {
            useWorkspaceStore.getState().addDocSheet(pageId)
            setCurrent(slides.length)
          }}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {/*
        Toolbar. Every group is `shrink-0` inside a scrolling strip: without
        that, flex children shrink below their content on a narrow screen and
        their labels collide — which is the "overlapping panels" seen on
        mobile. Scrolling horizontally is the correct answer on a phone;
        squeezing is not. Safe-area padding keeps the last control clear of
        the home indicator.
      */}
      <div
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto overscroll-x-contain border-t border-border/60 bg-muted/20 px-3 py-2"
        style={{
          touchAction: 'pan-x',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
        }}
      >

        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 bg-background/60 p-0.5">
          <button
            type="button"
            aria-label="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setZoom(zoom - 0.1)}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-11 shrink-0 text-center font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setZoom(zoom + 0.1)}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={fitWidth}
          >
            Fit width
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border/60 bg-background/60 p-0.5">
          {(['none', 'fade', 'slide'] as SlideTransition[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={transition === t}
              className={cn(
                'shrink-0 rounded-md px-2 py-1 text-[0.6875rem] font-medium capitalize transition-colors',
                transition === t
                  ? 'bg-[var(--accent-blue)] text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              onClick={() => setTransition(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
          Slide {current + 1} of {slides.length}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={exporting || importing}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-[0.75rem] font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            onClick={() => void exportPptx()}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export PowerPoint'}</span>
          </button>
          <button
            type="button"
            disabled={importing || slides.length === 0}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-blue)] px-3 py-1.5 text-[0.75rem] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            onClick={() => setPresenting(true)}
          >
            <MonitorPlay className="h-3.5 w-3.5" />
            Present
          </button>
        </div>
      </div>

      {presenting && (
        <PresentOverlay
          slides={slides}
          startAt={current}
          onClose={() => setPresenting(false)}
          sheetColors={meta?.sheetColors}
          transition={transition}
        />
      )}
    </div>
  )
}
