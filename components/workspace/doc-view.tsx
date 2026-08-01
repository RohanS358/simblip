'use client'

// Doc page: a scrollable stack of A4-proportioned SHEETS, each one a full
// infinite-canvas surface — same objects, behaviors, simulations and tools as
// a board, but paginated like a document and exportable to PDF.
//
// Unlike a board, a sheet is STATIC: it doesn't pan or zoom internally (wheel/
// pinch on the canvas do nothing) — a page is a fixed piece of paper, not an
// infinite plane. Viewing zoom lives one level up, uniform across every sheet,
// via ctrl/⌘+wheel, pinch, or the zoom control in the tab bar. Each sheet's
// own size can be dragged from its bottom-right corner and is saved per sheet.
//
// Resource notes: only sheets near the viewport mount a live canvas (the rest
// are light placeholders), and export force-mounts everything just long
// enough to rasterize.
//
// Export and zoom don't float their own chrome over the canvas — they're
// published to useDocDockStore (lib/store/doc-dock.ts) and rendered from
// PageControlsMenu in the tab bar instead (see tabs-bar.tsx), same pattern
// as PdfView/usePdfDockStore.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Plus, Trash2, GripHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { usePinchZoom } from '@/hooks/use-pinch-zoom'
import { useTransientHud } from '@/hooks/use-transient-hud'
import { useDocDockStore } from '@/lib/store/doc-dock'
import { sanitizeFormFields } from '@/lib/store/to-pdf'
import { InfiniteCanvas } from './canvas'
import { cn } from '@/lib/utils'

/** A4 at ~96 dpi. Sheets keep this ratio at any pane width unless resized. */
export const SHEET_W = 794
export const SHEET_H = 1123
const MIN_SHEET = 320
const MAX_SHEET = 2400
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

/** Compulsory title/subtitle/date banner on a doc's first page — not a
 *  SceneObject, so there's nothing to accidentally delete. Sits inside the
 *  same [data-sheet] element PDF export rasterizes, so it prints too. Title
 *  reuses the page's own name (renaming it here is the same rename as the
 *  notebook tree); subtitle/date are new PageMeta fields. The date field
 *  shows today's date until someone picks a different one, without writing
 *  anything until they do. */
function DocFirstPageHeader({ docPageId, name }: { docPageId: string; name: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.notebooks, docPageId))
  const renamePage = useWorkspaceStore((s) => s.renamePage)
  const subtitle = meta?.docSubtitle ?? ''
  const dateVal = meta?.docDate ?? new Date().toISOString().slice(0, 10)
  const stop = (e: React.KeyboardEvent) => e.stopPropagation()

  return (
    <div className="absolute inset-x-0 top-0 z-[5] border-b border-black/10 bg-white px-6 py-3 dark:border-white/10 dark:bg-neutral-900 sm:px-10 sm:py-5">
      <div className="flex items-start justify-between gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => renamePage(docPageId, e.target.value)}
          onKeyDown={stop}
          placeholder="Document title"
          aria-label="Document title"
          className="min-w-0 flex-1 bg-transparent text-xl font-bold leading-tight text-neutral-900 outline-none dark:text-neutral-100 sm:text-2xl"
        />
        <input
          type="date"
          value={dateVal}
          onChange={(e) => useWorkspaceStore.getState().updatePageMeta(docPageId, { docDate: e.target.value })}
          onKeyDown={stop}
          aria-label="Document date"
          className="shrink-0 bg-transparent text-right font-mono text-[11px] text-neutral-500 outline-none dark:text-neutral-400"
        />
      </div>
      <input
        type="text"
        value={subtitle}
        onChange={(e) => useWorkspaceStore.getState().updatePageMeta(docPageId, { docSubtitle: e.target.value })}
        onKeyDown={stop}
        placeholder="Subtitle"
        aria-label="Document subtitle"
        className="mt-0.5 w-full min-w-0 bg-transparent text-[13px] text-neutral-500 outline-none dark:text-neutral-400"
      />
    </div>
  )
}

function Sheet({
  sheetId,
  index,
  size,
  active,
  canvasActive,
  mounted,
  docPageId,
  docName,
  onVisible,
  onFocus,
  onRemove,
  onResize,
  removable,
}: {
  sheetId: string
  index: number
  size: { w: number; h: number }
  active: boolean
  /** Distinct from `active`: whether THIS sheet's InfiniteCanvas should
   *  answer to the keyboard. `active` also folds in `!bare` to suppress the
   *  visual ring on borderless embeds (the PDF notes pane) — but keyboard
   *  routing must still work there, so it's driven by activeSheetId alone. */
  canvasActive: boolean
  mounted: boolean
  /** parent doc's page id + name — only used to render the compulsory
   *  title/subtitle/date header on the first sheet (index 0). */
  docPageId: string
  docName: string
  onVisible: (i: number, v: boolean) => void
  onFocus: () => void
  onRemove: () => void
  onResize: (w: number, h: number) => void
  removable: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<{ w: number; h: number } | null>(null)
  const dims = live ?? size
  // Rendered width — maxWidth clamps the sheet on narrow screens, so the
  // canvas is laid out at the sheet's TRUE size and visually scaled down;
  // ink coordinates then mean the same thing on every device.
  const [rw, setRw] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => onVisible(index, e.isIntersecting),
      { rootMargin: '600px 0px' } // pre-mount one sheet ahead in each direction
    )
    io.observe(el)
    const ro = new ResizeObserver(() => setRw(el.clientWidth))
    ro.observe(el)
    setRw(el.clientWidth)
    return () => {
      io.disconnect()
      ro.disconnect()
    }
  }, [index, onVisible])

  const onResizeStart = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = ref.current!.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const startW = size.w
    const startH = size.h
    const move = (ev: PointerEvent) => {
      const w = Math.min(MAX_SHEET, Math.max(MIN_SHEET, startW + ((ev.clientX - startX) / rect.width) * startW))
      const h = Math.min(MAX_SHEET, Math.max(MIN_SHEET, startH + ((ev.clientY - startY) / rect.height) * startH))
      setLive({ w: Math.round(w), h: Math.round(h) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLive((v) => {
        if (v) onResize(v.w, v.h)
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      ref={ref}
      data-sheet={sheetId}
      className={cn(
        'group relative mx-auto overflow-hidden rounded-md bg-white shadow-[0_2px_16px_rgba(0,0,0,0.14)] dark:bg-neutral-900',
        // Focused, not alarmed: a quiet ring plus a soft tinted glow.
        active &&
          'ring-1 ring-[var(--accent-blue)]/50 shadow-[0_2px_24px_color-mix(in_oklch,var(--accent-blue)_18%,transparent)]'
      )}
      style={{ width: dims.w, maxWidth: '100%', aspectRatio: `${dims.w} / ${dims.h}` }}
      onPointerDownCapture={onFocus}
    >
      {mounted ? (
        <div className="absolute inset-0 overflow-hidden">
          <div
            style={{
              width: dims.w,
              height: dims.h,
              transform: `scale(${(rw || dims.w) / dims.w})`,
              transformOrigin: 'top left',
            }}
          >
            <InfiniteCanvas key={sheetId} pageId={sheetId} locked active={canvasActive} />
            {/* Lives INSIDE the same true-pixel/scaled box as the canvas,
                not as a sibling at the sheet's own (possibly narrower,
                CSS-fit) display size — otherwise it sits in a different
                coordinate system than the content it's supposed to cap,
                which is what made it double/mis-align under html2canvas's
                PDF-export capture. */}
            {index === 0 && <DocFirstPageHeader docPageId={docPageId} name={docName} />}
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
          Page {index + 1}
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1.5 left-2 z-10 rounded-md bg-foreground/8 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
        {index + 1}
      </span>
      {removable && (
        <button
          type="button"
          aria-label={`Delete page ${index + 1}`}
          className="absolute right-1.5 top-1.5 z-10 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-[var(--accent-rose)] group-hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      {/* Drag to resize the page — persisted per sheet. */}
      <div
        role="separator"
        aria-label="Resize page"
        className="absolute bottom-0 right-0 z-10 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        onPointerDown={onResizeStart}
      >
        <GripHorizontal className="h-3 w-3 rotate-45" />
      </div>
    </div>
  )
}

export function DocView({ pageId, bare }: { pageId: string; bare?: boolean }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.notebooks, pageId))
  const addDocSheet = useWorkspaceStore((s) => s.addDocSheet)
  const setActiveSheet = useWorkspaceStore((s) => s.setActiveSheet)
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
  const sheets = meta?.docPages ?? []
  const [visible, setVisible] = useState<Set<number>>(() => new Set([0]))
  const [exporting, setExporting] = useState(false)
  const [zoom, setZoom] = useState(1)
  // Transient zoom readout — same language as the board's zoom pill.
  const zoomHud = useTransientHud(zoom)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [naturalH, setNaturalH] = useState(0)
  const [naturalW, setNaturalW] = useState(0)
  const [viewW, setViewW] = useState(0)
  const [viewH, setViewH] = useState(0)

  // CSS `zoom` RESIZES THE LAYOUT BOX (it isn't a pure visual scale) — the
  // page reflows, scroll math gets confused, and any split-view drawing goes
  // to the wrong spot. A `transform: scale()` is a pure visual magnification
  // — like zooming into an image — but it doesn't touch layout, so the
  // scroll container needs to be told how big the SCALED content actually
  // is; that's what this measures. contentRef never gets an explicit width
  // (see the JSX below), so this stays the TRUE unscaled size at every zoom
  // level, including through content changes (add/resize a sheet) — nothing
  // here depends on zoom, so there's no circularity between "what we
  // measure" and "what we then force the size to be".
  //
  // useLayoutEffect (not useEffect) so the first real measurement lands
  // before paint — otherwise the stage/content below would flash at 0×0 for
  // one frame on mount.
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setNaturalH(el.offsetHeight)
      setNaturalW(el.offsetWidth)
    })
    ro.observe(el)
    setNaturalH(el.offsetHeight)
    setNaturalW(el.offsetWidth)
    return () => ro.disconnect()
  }, [])

  // The scroller's own viewport size — needed to decide, in JS, whether the
  // (possibly scaled) content fits and should be centered, or overflows and
  // should sit flush at the scroll origin. This used to be left to CSS
  // `mx-auto`, but auto margins are specified to collapse to 0 once content
  // is wider than its container (CSS2.1 §10.3.3) rather than staying
  // symmetric — so the page visibly snapped flush-left the moment zoomed
  // content got wider than the pane, and everything downstream (the scroll-
  // anchor math) was re-deriving that same ambiguous position from
  // getBoundingClientRect() instead of just computing it. Tracking the
  // viewport size directly lets `padLeft`/`padTop` below reproduce that
  // "center if it fits, else flush" behavior ourselves, deterministically.
  useLayoutEffect(() => {
    const el = scrollRef.current
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

  // The scrollable "stage" is always at least as big as the viewport (so a
  // small/unzoomed document still has room to be centered in) and grows to
  // the scaled content's real footprint once that exceeds the viewport (so
  // the scroller has something to actually scroll to). padLeft/padTop place
  // the content within that stage: centered when there's slack, flush at 0
  // when there isn't — the content can never end up somewhere the stage
  // doesn't reserve room for, which is what made horizontal scrolling
  // actually engage.
  const stageW = Math.max(viewW, naturalW * zoom)
  const stageH = Math.max(viewH, naturalH * zoom)
  const padLeft = (stageW - naturalW * zoom) / 2
  const padTop = (stageH - naturalH * zoom) / 2

  // The toolbar/inspector need a target sheet from the moment the doc opens.
  useEffect(() => {
    if (sheets.length && (!activeSheetId || !sheets.includes(activeSheetId)))
      setActiveSheet(sheets[0])
  }, [sheets, activeSheetId, setActiveSheet])

  const onVisible = (i: number, v: boolean) =>
    setVisible((prev) => {
      if (prev.has(i) === v) return prev
      const next = new Set(prev)
      v ? next.add(i) : next.delete(i)
      return next
    })

  // Zoom anchored at a screen point (cursor, or viewport center for the
  // buttons/slider) on BOTH axes. `zoomAt` captures which content-space
  // point (contentRef-local, unscaled) is currently under that screen
  // point — a plain read off the DOM, always accurate regardless of margins.
  // The useLayoutEffect below then solves for the scrollLeft/scrollTop that
  // puts that same content point back under that same screen point at the
  // NEW zoom — but instead of re-measuring contentRef's rendered position a
  // second time (which is exactly what silently broke: that position comes
  // from padLeft/padTop above, and getBoundingClientRect() only reflects it
  // AFTER the browser has actually committed the new layout, which isn't
  // guaranteed to have happened for every intermediate style in one
  // useLayoutEffect pass), it computes the target position directly from
  // padLeft/padTop/zoom — the same numbers the JSX below uses to place
  // contentRef — so there's exactly one place that decides where the
  // content sits, not two that are supposed to agree.
  const zoomAnchor = useRef<{ px: number; py: number; clientX: number; clientY: number } | null>(null)

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const content = contentRef.current
    if (!content) return
    setZoom((z) => {
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor))
      if (nz === z) return z
      const cRect = content.getBoundingClientRect()
      zoomAnchor.current = { px: (clientX - cRect.left) / z, py: (clientY - cRect.top) / z, clientX, clientY }
      return nz
    })
  }, [])

  // Runs synchronously after the DOM updates but before the browser paints.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const anchor = zoomAnchor.current
    if (!el || !anchor) return
    const scrollRect = el.getBoundingClientRect()
    el.scrollLeft = padLeft + anchor.px * zoom - (anchor.clientX - scrollRect.left)
    el.scrollTop = padTop + anchor.py * zoom - (anchor.clientY - scrollRect.top)
    zoomAnchor.current = null
    // padLeft/padTop are derived every render from viewW/viewH/naturalW/
    // naturalH/zoom — this only needs to re-run when zoom itself changes
    // (that's the one thing zoomAt/onPinchMove actually set an anchor for);
    // the anchor-null guard above makes it a no-op on any other render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const zoomAtCenter = (factor: number) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  // Ctrl/⌘+wheel or trackpad pinch zooms the page stack — same gesture as
  // everywhere else in the app. A plain wheel is left alone to scroll (both
  // axes — the scroller is natively overflow-auto on x and y, so a
  // shift+wheel or trackpad pan navigates left/right same as any scroll
  // area once zoomed content is wider than the viewport).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Touch: two-finger pinch, the only zoom gesture a phone has. The
  // content-space anchor (px,py) is captured ONCE when the fingers land and
  // held fixed for the whole gesture — that's what pins the same bit of
  // content under the fingers as they move — while the on-screen target
  // (clientX/clientY) updates every frame through the shared zoomAnchor/
  // useLayoutEffect resolution above.
  const pinchBaseRef = useRef<{ zoom: number; px: number; py: number } | null>(null)

  const onPinchStart = useCallback(
    (clientX: number, clientY: number) => {
      const content = contentRef.current
      if (!content) return
      const cRect = content.getBoundingClientRect()
      pinchBaseRef.current = { zoom, px: (clientX - cRect.left) / zoom, py: (clientY - cRect.top) / zoom }
    },
    [zoom]
  )

  const onPinchMove = useCallback((ratio: number, clientX: number, clientY: number) => {
    const base = pinchBaseRef.current
    if (!base) return
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.zoom * ratio))
    zoomAnchor.current = { px: base.px, py: base.py, clientX, clientY }
    setZoom(nz)
  }, [])

  usePinchZoom(scrollRef, { onStart: onPinchStart, onMove: onPinchMove })

  const sizeOf = (sheetId: string) => meta?.sheetSizes?.[sheetId] ?? { w: SHEET_W, h: SHEET_H }
  const resizeSheet = (sheetId: string, w: number, h: number) => {
    useWorkspaceStore.getState().updatePageMeta(pageId, {
      sheetSizes: { ...(meta?.sheetSizes ?? {}), [sheetId]: { w, h } },
    })
  }

  const exportPdf = async () => {
    if (!sheets.length || exporting) return
    // A blank page renders nothing worth printing and just burns a page — skip it.
    const docs = useDocStore.getState().pages
    const nonEmpty = sheets.filter((id) => Object.keys(docs[id]?.objects ?? {}).length > 0)
    if (nonEmpty.length === 0) {
      toast.error('Every page is empty — nothing to export.')
      return
    }
    setExporting(true)
    try {
      // Everything must be in the DOM to rasterize; mount all at true scale
      // (a live zoom would rasterize at the wrong size), give the canvases a
      // beat to paint, then capture at 2× for a crisp PDF.
      setZoom(1)
      setVisible(new Set(sheets.map((_, i) => i)))
      await new Promise((r) => setTimeout(r, 900))
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ])
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
      const pw = pdf.internal.pageSize.getWidth()
      const ph = pdf.internal.pageSize.getHeight()
      const host = scrollRef.current!
      let firstPage = true
      for (const sheetId of nonEmpty) {
        const el = host.querySelector<HTMLElement>(`[data-sheet="${sheetId}"]`)
        if (!el) continue
        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          logging: false,
          onclone: (_doc, cloned) => sanitizeFormFields(cloned as HTMLElement),
        })
        if (!firstPage) pdf.addPage()
        firstPage = false
        // Fit the sheet inside A4 keeping its (possibly custom) aspect ratio
        // — stretching a free-resized page to the full A4 box distorts it.
        const ratio = canvas.height / canvas.width
        let w = pw
        let h = pw * ratio
        if (h > ph) {
          h = ph
          w = ph / ratio
        }
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h)
      }
      pdf.save(`${meta?.name ?? 'document'}.pdf`)
      toast.success('Exported to PDF')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF export failed')
    } finally {
      setExporting(false)
    }
  }

  const removeSheet = (sheetId: string) => {
    const nextSizes = { ...(meta?.sheetSizes ?? {}) }
    delete nextSizes[sheetId]
    useWorkspaceStore.getState().updatePageMeta(pageId, {
      docPages: sheets.filter((s) => s !== sheetId),
      sheetSizes: nextSizes,
    })
    useDocStore.getState().forgetPage(sheetId)
    if (activeSheetId === sheetId) setActiveSheet(sheets.find((s) => s !== sheetId) ?? null)
  }

  // Export/zoom don't float their own chrome anymore — published to
  // useDocDockStore and rendered from PageControlsMenu in the tab bar
  // instead (see doc-dock.ts). `bare` embeds (the PDF reader's notes pane)
  // never publish — that surface has no tab bar and no export of its own.
  useEffect(() => {
    if (bare) {
      useDocDockStore.getState().set(null)
      return
    }
    useDocDockStore.getState().set({
      zoom,
      exporting,
      setZoom: (z) => zoomAtCenter(z / zoom),
      exportPdf: () => void exportPdf(),
    })
    return () => useDocDockStore.getState().set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bare, zoom, exporting])

  return (
    <div className="relative h-full w-full">
      <div
        ref={scrollRef}
        className="h-full w-full overflow-auto bg-muted/40"
        // Without this, a two-finger pinch here races the browser's own
        // native page-zoom on mobile/tablet (nothing in the viewport meta
        // disables it) instead of reaching usePinchZoom below — the native
        // gesture would win or fight the JS one, so pinching a doc page
        // visibly failed to zoom the CONTENT and instead zoomed the whole
        // UI. Excluding pinch-zoom from touch-action keeps native pan-x/
        // pan-y (plain scrolling) while routing two-finger gestures to JS.
        style={{ touchAction: 'pan-x pan-y' }}
      >
        {/* Stage reserves the scaled content's real footprint (or the
            viewport's, whichever is bigger) so there's always somewhere for
            the scroller to actually scroll to — transform doesn't reflow, so
            nothing else tells the scroller how big the zoomed page is.
            contentRef sits inside it at (padLeft, padTop), computed above:
            centered while it fits, flush at the origin once it doesn't —
            deterministic in JS rather than left to `mx-auto`'s collapse-to-
            zero-margin behavior, which is what actually broke here. */}
        <div className="relative" style={{ width: stageW, height: stageH }}>
          <div
            ref={contentRef}
            className="absolute flex w-fit flex-col gap-4 px-3 py-4 pb-24 sm:px-6"
            style={{ left: padLeft, top: padTop, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            {sheets.map((sheetId, i) => (
              <Sheet
                key={sheetId}
                sheetId={sheetId}
                index={i}
                size={sizeOf(sheetId)}
                active={!bare && activeSheetId === sheetId}
                canvasActive={activeSheetId === sheetId}
                mounted={visible.has(i) || visible.has(i - 1) || visible.has(i + 1)}
                docPageId={pageId}
                docName={meta?.name ?? 'Untitled'}
                onVisible={onVisible}
                onFocus={() => setActiveSheet(sheetId)}
                onRemove={() => removeSheet(sheetId)}
                onResize={(w, h) => resizeSheet(sheetId, w, h)}
                removable={sheets.length > 1}
              />
            ))}
            <button
              type="button"
              className="mx-auto flex items-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-[color,border-color,transform] duration-150 ease-out hover:border-[var(--accent-blue)] hover:text-foreground active:scale-[0.97]"
              onClick={() => setActiveSheet(addDocSheet(pageId))}
            >
              <Plus className="h-4 w-4" /> Add page
            </button>
          </div>
        </div>
      </div>
      {zoomHud && !bare && (
        <div className="glass pointer-events-none absolute bottom-4 right-4 z-30 rounded-full px-3 py-1 font-mono text-[11px] text-muted-foreground">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  )
}