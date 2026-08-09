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
      const availW = window.innerWidth - 64 // matches the p-8 padding below
      const availH = window.innerHeight - 200 // header/footer chrome
      setFrameScale(Math.min(availW / 960, availH / 540))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <button
        type="button"
        aria-label="Exit presentation"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
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
          className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30"
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
          className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30"
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

  const onTilePointerDown = (slideId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const drag = { moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const startX = e.clientX
    dragOrderRef.current = slides

    const move = (ev: PointerEvent) => {
      if (!drag.moved) {
        if (Math.abs(ev.clientX - startX) < 4) return
        drag.moved = true
        setDraggingId(slideId)
        setDragOrder(slides)
      }
      const rail = railRef.current
      if (!rail) return
      const tiles = Array.from(rail.querySelectorAll<HTMLElement>('[data-slide-tile]'))
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
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraggingId(null)
      setDragOrder(null)
      if (drag.moved) reorderSlides(dragOrderRef.current)
      else goToSlide(slides.indexOf(slideId))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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
      <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-6">
        {importing ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-[0.75rem]">Importing presentation…</span>
          </div>
        ) : activeSlideId ? (
          <div
            className="relative shrink-0 overflow-hidden rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
            style={{
              width: 960,
              height: 540,
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              margin: `${Math.max(0, (540 * (zoom - 1)) / 2)}px ${Math.max(0, (960 * (zoom - 1)) / 2)}px`,
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
        ) : null}
      </div>

      <div
        ref={railRef}
        className="flex h-24 shrink-0 items-center gap-0 overflow-x-auto border-t border-border/60 bg-muted/30 p-2"
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
                {hoverGap === tileIdx && !draggingId && (
                  <button
                    type="button"
                    aria-label={`Insert slide at position ${tileIdx + 1}`}
                    className="absolute z-20 flex items-center justify-center rounded-full bg-[var(--accent-blue)] text-white shadow-md transition-transform hover:scale-110 active:scale-95"
                    style={{ width: 20, height: 20 }}
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
          {hoverGap === displayedSlides.length && !draggingId && (
            <button
              type="button"
              aria-label="Insert slide at end"
              className="absolute z-20 flex items-center justify-center rounded-full bg-[var(--accent-blue)] text-white shadow-md transition-transform hover:scale-110 active:scale-95"
              style={{ width: 20, height: 20 }}
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

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/60 p-0.5">
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

        <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-background/60 p-0.5">
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

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            disabled={exporting || importing}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-[0.75rem] font-medium text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            onClick={() => void exportPptx()}
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {exporting ? 'Exporting…' : 'Export PowerPoint'}
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
