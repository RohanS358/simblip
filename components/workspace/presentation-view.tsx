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

import { useEffect, useRef, useState } from 'react'
import { motion as fm, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Copy, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { getFile } from '@/lib/storage/manager'
import { usePresentationDockStore, type SlideTransition } from '@/lib/store/presentation-dock'
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

  const slideId = slides[i]

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
          <TransitionSlide
            transition={transition}
            dir={dir}
            slideKey={slideId}
            className="relative aspect-video w-full max-w-[1400px] overflow-hidden rounded-md bg-white shadow-2xl"
            style={{ backgroundColor: sheetColors?.[slideId] }}
          >
            <InfiniteCanvas key={slideId} pageId={slideId} locked transparent passthrough viewer active={false} />
          </TransitionSlide>
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
    const w = stageRef.current?.clientWidth
    if (w) setZoom(Math.min(3, Math.max(0.25, (w - 48) / 960)))
  }
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

  // Toolbar buttons (Present/Export/New slide) publish to the shared
  // tab-bar dock instead of floating their own chrome — same pattern
  // doc-view.tsx/pdf-view.tsx use. The slide-thumbnail rail stays inline
  // here (page-navigation UI, not a toolbar control), matching how PdfView
  // keeps its own page thumbnails/notes pane inline while only its button
  // controls move to the dock.
  useEffect(() => {
    usePresentationDockStore.getState().set({
      current,
      numSlides: slides.length,
      exporting,
      importing,
      zoom,
      setZoom,
      fitWidth,
      transition,
      setTransition,
      present: () => setPresenting(true),
      exportPptx: () => void exportPptx(),
      addSlide: () => {
        useWorkspaceStore.getState().addDocSheet(pageId)
        setCurrent(slides.length)
      },
    })
    return () => usePresentationDockStore.getState().set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, slides.length, exporting, importing, pageId, zoom, transition])

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
            className="relative shrink-0 overflow-hidden rounded-md"
            style={{ width: 960, height: 540, transform: `scale(${zoom})` }}
          >
            <TransitionSlide
              transition={transition}
              dir={stageDir}
              slideKey={activeSlideId}
              className="absolute inset-0 shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
              style={{ backgroundColor: meta?.sheetColors?.[activeSlideId] }}
            >
              <InfiniteCanvas key={activeSlideId} pageId={activeSlideId} locked transparent passthrough active />
            </TransitionSlide>
          </div>
        ) : null}
      </div>

      <div
        ref={railRef}
        className="flex h-24 shrink-0 items-center gap-2 overflow-x-auto border-t border-border/60 bg-muted/30 p-2"
      >
        {displayedSlides.map((id) => {
          const i = slides.indexOf(id)
          return (
            <ContextMenu key={id}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  data-slide-tile
                  onPointerDown={onTilePointerDown(id)}
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
                  {slides.length > 1 && (
                    <span
                      role="button"
                      aria-label="Delete slide"
                      className="absolute right-1 top-1 z-10 rounded bg-black/40 p-0.5 text-white opacity-0 hover:bg-destructive group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeSlide(id)
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </span>
                  )}
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
          )
        })}
        <button
          type="button"
          aria-label="Add slide"
          className="flex aspect-video h-full shrink-0 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground/50 transition-colors hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)]"
          onClick={() => {
            useWorkspaceStore.getState().addDocSheet(pageId)
            setCurrent(slides.length)
          }}
        >
          <Plus className="h-5 w-5" />
        </button>
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
