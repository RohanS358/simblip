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

import { BounceLoader } from '@/components/ui/bounce-loader'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion as fm, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Copy, Loader2, X, ChevronLeft, ChevronRight, ChevronDown,
  ZoomIn, ZoomOut, Sparkles, Download, MonitorPlay, SlidersHorizontal, TableOfContents, List,
} from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { getFile } from '@/lib/storage/manager'
import type { SlideTransition } from '@/lib/store/presentation-dock'
import { usePresentationDockStore } from '@/lib/store/presentation-dock'
import { InfiniteCanvas } from './canvas'
import { LiveFrame } from './page-thumbnail'
import { SLIDE_W, SLIDE_H } from '@/lib/scene/frames'
import { play, stop } from '@/lib/physics/world'
import { cn } from '@/lib/utils'
import { uid } from '@/lib/scene/types'
import { parse } from '@/lib/text/marks'
import { useIsMobile, useIsNarrow } from '@/hooks/use-mobile'
import { useBottomChrome } from '@/hooks/use-dock-clearance'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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

  // Run the slide.
  //
  // Present mode mounts its canvas with `viewer active={false}` and shows no
  // dock — no transport, no per-system Play button — so a slide carrying a
  // pendulum, a circuit or a wave just sat there frozen while presenting,
  // even though the same slide simulates fine in the editor. Nothing else in
  // the app starts a world; play() is the only entry point.
  //
  // Unconditional on purpose: a world with nothing to simulate ticks an empty
  // engine, which costs nothing, and any "does this slide have a simulation?"
  // heuristic would have to know about bodies, circuits, charges, fields,
  // thermal and tracers separately — six chances to be wrong for no gain.
  // The run only mutates the DOM (syncDom), never the stored scene, so
  // leaving a slide resets it exactly as Stop does in the editor.
  useEffect(() => {
    if (!slideId) return
    play(slideId)
    return () => stop()
  }, [slideId])

  // The slide's own content is positioned in SIMBLIP's fixed SLIDE_W×SLIDE_H
  // coordinate space (lib/scene/frames — the same frame pptx-import.ts maps
  // onto and the main stage below uses) — the frame here must stay a literal
  // 960×540 box and get scaled down/up via CSS transform to
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
      setFrameScale(Math.max(0.05, Math.min(availW / SLIDE_W, availH / SLIDE_H)))
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
            style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${frameScale})` }}
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
  // Layout question, not device question: a phone has no room for two stacked
  // bars of chrome under the slide, a tablet does. (useIsMobile is true for
  // both, so it's the wrong signal here — see hooks/use-mobile.ts.)
  const isPhone = useIsNarrow(767)
  // Phone chrome: the secondary controls (zoom, transition, export) live in a
  // sheet instead of a horizontally-scrolling strip that pushed Present —
  // the screen's primary action — off the right edge entirely.
  const [optionsOpen, setOptionsOpen] = useState(false)
  // The filmstrip is the biggest single block of chrome on a phone. It's
  // needed to *change* slides and dead weight while editing one, so it
  // collapses; the slide counter in the bar is the toggle.
  const [railOpen, setRailOpen] = useState(true)
  const bottomChromeRef = useBottomChrome<HTMLDivElement>()
  const [current, setCurrent] = useState(0)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [presenting, setPresenting] = useState(false)
  // State for Table of Contents side rail
  const [tocOpen, setTocOpen] = useState(false)
  const [tocEntries, setTocEntries] = useState<{ slideIndex: number; title: string; level: number }[]>([])

  // Extract PDF outline or slide headings whenever slides or source file changes
  useEffect(() => {
    let dead = false
    void (async () => {
      const entries: { slideIndex: number; title: string; level: number }[] = []
      const fileId = meta?.fileUrl?.startsWith('opfs:') ? meta.fileUrl.slice('opfs:'.length) : null

      // Try PDF outline first if available
      if (fileId) {
        try {
          const blob = await getFile(fileId)
          if (blob && (blob.type === 'application/pdf' || meta?.fileMime === 'application/pdf' || meta?.fileName?.endsWith('.pdf'))) {
            const pdfjs = await import('pdfjs-dist')
            pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
            const arrayBuffer = await blob.arrayBuffer()
            const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
            const outline = await doc.getOutline()
            if (outline && outline.length > 0) {
              const processItems = async (items: any[], level = 0) => {
                for (const item of items) {
                  let pageNum = -1
                  if (typeof item.dest === 'string') {
                    const dest = await doc.getDestination(item.dest)
                    if (dest) pageNum = await doc.getPageIndex(dest[0])
                  } else if (Array.isArray(item.dest)) {
                    pageNum = await doc.getPageIndex(item.dest[0])
                  }
                  if (pageNum >= 0 && pageNum < slides.length) {
                    entries.push({ slideIndex: pageNum, title: item.title, level })
                  }
                  if (item.items && item.items.length > 0) {
                    await processItems(item.items, level + 1)
                  }
                }
              }
              await processItems(outline)
            }
          }
        } catch {
          // Ignore PDF outline parsing errors, fallback to slide object headings
        }
      }

      // If no PDF outline entries were found, extract slide object headings/text
      if (entries.length === 0 && slides.length > 0) {
        const { useDocStore } = await import('@/lib/store/document')
        const pagesState = useDocStore.getState().pages
        slides.forEach((slideId, idx) => {
          const page = pagesState[slideId]
          if (!page || !page.objects) return
          const objs = Object.values(page.objects)
          // Find text objects on this slide. The object's type lives in
          // geometry.kind and its content in parameters.text as a SERIALIZED
          // {text, marks} blob (lib/text/marks.ts) — `o.kind`/`o.text` are
          // not fields on SceneObject at all, so this loop previously matched
          // nothing and every deck silently got an empty outline. Same
          // extraction pptx-export.ts uses.
          const textObjs = objs.filter(
            (o) => o.geometry.kind === 'text' || o.geometry.kind === 'note'
          )
          let title = ''
          for (const obj of textObjs) {
            const rawParam = obj.parameters.text
            const raw = rawParam?.kind === 'string' ? rawParam.value : ''
            if (!raw) continue
            const rawText = parse(raw).text
            const lines = rawText.split('\n').map((l: string) => l.trim()).filter(Boolean)
            if (lines.length > 0) {
              // Strip markdown/prefix formatting
              title = lines[0].replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '')
              if (title) break
            }
          }
          if (title) {
            entries.push({ slideIndex: idx, title, level: 0 })
          }
        })
      }

      if (!dead) setTocEntries(entries)
    })()
    return () => {
      dead = true
    }
  }, [slides, meta?.fileUrl, meta?.fileName, meta?.fileMime])

  // A pure CSS view scale on the rendered slide frame — same model as
  // doc-view.tsx's zoom (transform: scale(zoom)), NOT the canvas's own
  // internal viewport zoom (InfiniteCanvas keeps that permanently locked
  // to 1 for doc/pptx sheets — see canvas.tsx's `locked` effect — so
  // object positions always mean the same on-slide px regardless of how
  // zoomed-in the user's VIEW of the slide currently is).
  const [zoom, setZoomRaw] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const setZoom = (z: number) => setZoomRaw(Math.min(3, Math.max(0.25, z)))

  // The stage viewport's own size, so the slide can be placed in JS instead
  // of by flex.
  //
  // The old markup centered it with `flex min-h-full items-center` + `p-6`.
  // `min-height: 100%` resolves against the scroller's CONTENT box, but the
  // wrapper's own 24px padding is then added OUTSIDE that (border-box sizing
  // applies to `height`, not to a percentage `min-height` resolved this way)
  // — so the wrapper ended up taller than the stage, its centre fell below
  // the stage's centre, and the slide rendered visibly high. Measured on a
  // 1400×700 stage: 24px above vs 136px below at 100% zoom, up to 312px off
  // across viewports/zooms.
  //
  // doc-view.tsx already solved this for sheets: measure the viewport and
  // place the content from its SCALED footprint. (See stageH/padTop below.)
  const [viewW, setViewW] = useState(0)
  const [viewH, setViewH] = useState(0)
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewW(el.clientWidth)
      setViewH(el.clientHeight)
    })
    ro.observe(el)
    setViewW(el.clientWidth)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // The scrollable stage is at least the viewport (so a zoomed-out slide has
  // room to sit centered in) and grows to the slide's real scaled footprint
  // once that overflows (so the scroller has somewhere to scroll). padLeft/
  // padTop then place the slide: centered while it fits, flush at 0 when it
  // doesn't. STAGE_PAD keeps the old breathing room around the slide.
  const STAGE_PAD = 32
  const scaledW = SLIDE_W * zoom + STAGE_PAD
  const scaledH = SLIDE_H * zoom + STAGE_PAD
  const stageW = Math.max(viewW, scaledW)
  const stageH = Math.max(viewH, scaledH)
  const padLeft = (stageW - SLIDE_W * zoom) / 2
  const padTop = (stageH - SLIDE_H * zoom) / 2

  /**
   * The scale that fits the slide in the stage.
   *
   * On a wide screen that's min(width, height) — the whole slide visible at
   * once, which is what a presentation editor should show. On a phone that
   * same rule is useless: a 390px-wide stage fits 960×540 at ~0.35, and the
   * height constraint pushes it lower still, so the slide renders as an
   * unreadable postage stamp. Worse, "fits entirely" means the content is
   * never bigger than the scroller, so there is nothing to scroll TO — which
   * is why the stage felt frozen on mobile.
   *
   * Narrow screens therefore fit to WIDTH only. The slide stays legible, is
   * taller than the stage, and the scroll container finally has real overflow
   * to pan through (the wrapper below is sized to the scaled footprint).
   */
  const fitScale = (el: HTMLElement) => {
    const scaleW = (el.clientWidth - 48) / SLIDE_W
    const scaleH = (el.clientHeight - 48) / SLIDE_H
    return Math.min(3, Math.max(0.25, el.clientWidth < 640 ? scaleW : Math.min(scaleW, scaleH)))
  }

  /**
   * Phones open the deck zoomed in rather than at fit-width.
   *
   * Fit-width on a 390px screen is ~0.35: 8pt body text renders at under 3
   * real pixels, and — because a fitted slide is by definition no bigger than
   * the stage — the scroll container has zero overflow, so one-finger drag
   * has nothing to scroll and the preview feels frozen. Opening at ~2× the
   * fit gives readable text AND real overflow in both axes to pan through.
   * `Fit width` in the toolbar still drops back to the fitted scale.
   */
  const openScale = (el: HTMLElement) => {
    const fit = fitScale(el)
    return el.clientWidth < 640 ? Math.min(3, fit * 2) : fit
  }

  const fitWidth = () => {
    const el = stageRef.current
    if (el) setZoom(fitScale(el))
  }

  // Auto-fit on initial mount so the presentation fills the stage viewport cleanly.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (el) setZoomRaw(openScale(el))
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

  useEffect(() => {
    usePresentationDockStore.getState().set({
      tocOpen,
      toggleToc: () => setTocOpen((v) => !v),
      hasToc: tocEntries.length > 0,
      goToSlide,
    })
    return () => usePresentationDockStore.getState().set(null)
  }, [tocOpen, tocEntries.length])


  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Toggleable Table of Contents Side Rail */}
        <AnimatePresence>
          {tocOpen && (
            <fm.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="relative flex h-full shrink-0 flex-col border-r border-border/60 bg-background/95 backdrop-blur-md z-20 overflow-hidden shadow-sm"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
                <div className="flex items-center gap-2 text-foreground font-semibold text-xs uppercase tracking-wider">
                  <TableOfContents className="h-4 w-4 text-[var(--accent-blue)]" />
                  <span>Table of Contents</span>
                </div>
                <button
                  type="button"
                  aria-label="Close Table of Contents"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setTocOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-1.5 px-1.5 space-y-0.5">
                {tocEntries.length > 0 ? (
                  tocEntries.map((item, index) => {
                    const isSelected = current === item.slideIndex
                    const level = item.level ?? 0
                    return (
                      <button
                        key={`${item.slideIndex}-${index}`}
                        type="button"
                        onClick={() => goToSlide(item.slideIndex)}
                        style={{ paddingLeft: `${level * 0.75 + 0.5}rem` }}
                        className={cn(
                          'relative w-full text-left rounded px-2 py-1 text-[0.75rem] transition-colors flex items-center justify-between gap-1.5 group',
                          isSelected
                            ? 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] font-medium'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                        )}
                      >
                        {/* Tree branch line for indented child topics */}
                        {level > 0 && (
                          <span
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-2 border-t border-border/60"
                            style={{ left: `${(level - 1) * 0.75 + 0.5}rem` }}
                          />
                        )}
                        <span className="truncate leading-tight">{item.title}</span>
                        <span className="shrink-0 font-mono text-[0.625rem] opacity-40 group-hover:opacity-100 transition-opacity">
                          s.{item.slideIndex + 1}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <div className="p-4 text-center text-[0.75rem] text-muted-foreground">
                    No Table of Contents available for this presentation.
                  </div>
                )}
              </div>
            </fm.div>
          )}
        </AnimatePresence>

      {/*
        The stage scrolls when the slide is zoomed past the viewport.
        `transform: scale()` does NOT contribute to a parent's scrollable
        area — the box keeps its unscaled 960×540 size for layout — so the
        wrapper below is sized to the SCALED footprint (stageW/stageH) to
        give the scroll container something real to measure, and the slide is
        positioned inside it at (padLeft, padTop) rather than centered by
        flex. `touch-action` + `-webkit-overflow-scrolling` are what make it
        actually drag on iOS, where the default here was "nothing moves".
      */}
      <div
        ref={stageRef}
        className="min-h-0 flex-1 overflow-auto overscroll-contain bg-muted/40"
        style={{ touchAction: 'pan-x pan-y pinch-zoom', WebkitOverflowScrolling: 'touch' }}
      >
        {importing ? (
          <div className="flex h-full items-center justify-center">
            <BounceLoader size={200} label="Opening presentation…" />
          </div>
        ) : activeSlideId ? (
          <div className="relative" style={{ width: stageW, height: stageH }}>
          <div
            className="absolute overflow-hidden rounded-md shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
            style={{
              left: padLeft,
              top: padTop,
              width: SLIDE_W,
              height: SLIDE_H,
              transform: `scale(${zoom})`,
              // top left, so the scaled box grows from exactly the (padLeft,
              // padTop) the math above placed it at — `center center` would
              // spill half the growth back across that computed origin.
              transformOrigin: 'top left',
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
      </div>

      {/* The slide rail and the control bar are this view's own bottom chrome.
          The drawing dock floats over the whole content box, so it has to know
          how tall they are or it lands on top of them — hence the measured
          wrapper (useBottomChrome → useViewChrome → canvas-controls.tsx). */}
      <div ref={bottomChromeRef} className="flex shrink-0 flex-col">
      {/* Slide rail. Shorter on phones, where a 96px rail plus the toolbar
          ate most of a small viewport and left the slide itself squeezed —
          and collapsible there, so editing a slide can use the whole screen.
          Always open on tablet/desktop, which have the room. */}
      <div
        ref={railRef}
        className={cn(
          'thin-scrollbar flex shrink-0 items-center gap-0 overflow-x-auto overscroll-x-contain border-t border-border/60 bg-muted/30 transition-[height,padding] duration-200 ease-out sm:h-24 sm:p-2',
          !isPhone || railOpen ? 'h-14 p-2' : 'h-0 overflow-hidden border-t-0 p-0'
        )}
        style={{ touchAction: 'pan-x', WebkitOverflowScrolling: 'touch' }}
        onMouseLeave={() => setHoverGap(null)}
        aria-hidden={isPhone && !railOpen}
      >
        {displayedSlides.map((id, tileIdx) => {
          const i = slides.indexOf(id)
          return (
            // shrink-0 is what makes the rail scrollable at all. Without it
            // this wrapper is a shrinkable flex item, so adding slides just
            // compressed each wrapper instead of growing the row — the tile
            // inside kept its own width while its parent collapsed around it,
            // scrollWidth never exceeded clientWidth, and there was literally
            // nothing to scroll by wheel OR touch.
            <div key={id} className="flex shrink-0 items-center h-full">
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
                    style={{ width: 18, height: 18 }}
                    onClick={() => insertSlideAt(tileIdx)}
                  >
                    <Plus className="h-2.5 w-2.5" strokeWidth={3} />
                  </button>
                )}
              </div>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  {/* A div, not a button: the tile renders a LIVE slide via
                      LiveFrame, and a slide can legitimately contain its own
                      controls — a system boundary's Run/Step buttons, a
                      slider — which made this a <button> inside a <button>.
                      That is invalid HTML and broke hydration. Nothing native
                      is lost: selection runs off onPointerDown, never a click
                      or a form submit, so the role/tabIndex/keydown below
                      restore everything the element was actually providing. */}
                  <div
                    data-slide-tile
                    role="button"
                    tabIndex={0}
                    aria-current={i === current ? 'true' : undefined}
                    aria-label={`Slide ${i + 1}`}
                    onPointerDown={onTilePointerDown(id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        goToSlide(i)
                      }
                    }}
                    onMouseEnter={() => setHoverGap(null)}
                    className={cn(
                      // touch-pan-x, not touch-none: the tiles cover nearly the
                      // whole rail, so touch-none here meant a swipe starting
                      // on one could never scroll it. Reorder-by-drag still
                      // works — onTilePointerDown only arms after HOLD_MS and
                      // its `move` handler cancels the pending hold once the
                      // finger travels >8px, deliberately handing that gesture
                      // back to the native scroll this now permits.
                      'group relative aspect-video h-full shrink-0 touch-pan-x cursor-grab overflow-hidden rounded-md border bg-white text-left active:cursor-grabbing',
                      i === current ? 'border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/30' : 'border-border/60',
                      draggingId === id && 'opacity-70'
                    )}
                    style={{ backgroundColor: meta?.sheetColors?.[id] }}
                  >
                    {/* The real slide, not a bbox sketch — a deck's tiles all
                        look alike otherwise. See page-thumbnail.tsx. */}
                    <LiveFrame pageId={id} w={SLIDE_W} h={SLIDE_H} background={meta?.sheetColors?.[id]} />
                    <span className="absolute left-1 top-1 z-10 rounded bg-black/40 px-1 text-[0.5625rem] font-semibold text-white">
                      {i + 1}
                    </span>
                  </div>
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
              style={{ width: 18, height: 18 }}
              onClick={() => insertSlideAt(displayedSlides.length)}
            >
              <Plus className="h-2.5 w-2.5" strokeWidth={3} />
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
        Phone control bar — one row, three jobs, in priority order:
        counter (also the rail toggle) · options · Present.

        The old strip put five equal-weight control groups in a horizontal
        scroller, which pushed Present — the entire point of a presentation
        editor — off the right edge where nobody would find it. Here the
        primary action is a filled accent button pinned to the right of the
        thumb zone, the secondary controls collapse into a sheet, and the
        counter carries the value (`4 / 11`) at a heavier weight than its
        label, instead of dividing the eye between five same-weight chips.
      */}
      {isPhone ? (
        <div
          className="flex shrink-0 items-center gap-2 border-t border-border/60 bg-muted/20 px-3 py-2"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          {/* Counter doubles as the filmstrip toggle — the rail is the only
              other thing that shows "which slide", so they belong together. */}
          <button
            type="button"
            aria-expanded={railOpen}
            aria-label={railOpen ? 'Hide slide list' : 'Show slide list'}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/60 py-1.5 pl-2.5 pr-2 transition-transform active:scale-95"
            onClick={() => setRailOpen((v) => !v)}
          >
            <span className="font-mono text-[0.8125rem] font-semibold tabular-nums text-foreground">
              {current + 1}
              <span className="text-muted-foreground/70">/{slides.length}</span>
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                railOpen ? '' : 'rotate-180'
              )}
            />
          </button>

          {/* With the filmstrip collapsed there's no other way to change
              slides — the stage's own horizontal drag means "pan the slide"
              now that it's zoomed past the viewport, so it can't also mean
              "next slide". These only exist in that state. */}
          {!railOpen && (
            <>
              <button
                type="button"
                aria-label="Previous slide"
                disabled={current === 0}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground transition-transform active:scale-95 disabled:opacity-30"
                onClick={() => goToSlide(Math.max(0, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Next slide"
                disabled={current >= slides.length - 1}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground transition-transform active:scale-95 disabled:opacity-30"
                onClick={() => goToSlide(Math.min(slides.length - 1, current + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}

          <button
            type="button"
            aria-label="Slide options"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground transition-transform active:scale-95"
            onClick={() => setOptionsOpen(true)}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          {/* Add lives on the bar only while the filmstrip is open — the rail
              has its own inline '+' affordances, and once it's collapsed the
              prev/next arrows are the better use of that width. */}
          {railOpen && (
            <button
              type="button"
              aria-label="Add slide"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground transition-transform active:scale-95"
              onClick={() => {
                useWorkspaceStore.getState().addDocSheet(pageId)
                setCurrent(slides.length)
              }}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}

          {/* Primary action: filled accent, right edge of the thumb zone. */}
          <button
            type="button"
            disabled={importing || slides.length === 0}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-[0.8125rem] font-semibold text-primary-foreground shadow-sm transition-transform active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            onClick={() => setPresenting(true)}
          >
            <MonitorPlay className="h-4 w-4" />
            Present
          </button>
        </div>
      ) : (
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
      )}
      </div>

      {/* Phone options sheet — everything the compact bar doesn't show.
          A sheet, not a scrolling strip: each control gets a label and full
          width, so zoom and transition stop competing for the same 40px. */}
      <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
        <SheetContent
          side="bottom"
          className="gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="text-[0.9375rem]">Slide options</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pt-2">
            <div>
              <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground/70">
                Zoom
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Zoom out"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground transition-transform active:scale-95"
                  onClick={() => setZoom(zoom - 0.1)}
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="min-w-14 text-center font-mono text-[0.9375rem] font-semibold tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground transition-transform active:scale-95"
                  onClick={() => setZoom(zoom + 0.1)}
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-[0.8125rem] font-medium transition-transform active:scale-95"
                  onClick={fitWidth}
                >
                  Fit width
                </button>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground/70">
                Transition
              </p>
              <div className="flex gap-2">
                {(['none', 'fade', 'slide'] as SlideTransition[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={transition === t}
                    className={cn(
                      'flex-1 rounded-xl border px-3 py-2.5 text-[0.8125rem] font-medium capitalize transition-transform active:scale-95',
                      transition === t
                        ? 'border-transparent bg-[var(--accent-blue)] text-primary-foreground'
                        : 'border-border/60 bg-background/60 text-muted-foreground'
                    )}
                    onClick={() => setTransition(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-[0.875rem] font-medium transition-transform active:scale-95"
                onClick={() => {
                  useWorkspaceStore.getState().addDocSheet(pageId)
                  setCurrent(slides.length)
                  setOptionsOpen(false)
                }}
              >
                <Plus className="h-4 w-4" />
                Add slide
              </button>
              <button
                type="button"
                disabled={exporting || importing}
                className="flex items-center justify-center gap-2 rounded-xl border border-border/60 bg-background/60 px-4 py-3 text-[0.875rem] font-medium transition-transform active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                onClick={() => void exportPptx()}
              >
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {exporting ? 'Exporting…' : 'Export PowerPoint'}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
