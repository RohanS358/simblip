'use client'

// Doc page: a scrollable stack of A4-proportioned SHEETS, each one a full
// infinite-canvas surface — same objects, behaviors, simulations and tools as
// a board, but paginated like a document and exportable to PDF.
//
// Unlike a board, a sheet is STATIC: it doesn't pan or zoom internally (wheel/
// pinch on the canvas do nothing) — a page is a fixed piece of paper, not an
// infinite plane. Viewing zoom lives one level up, uniform across every sheet,
// via ctrl/⌘+wheel, pinch, or the slider bottom-right. Each sheet's own size
// can be dragged from its bottom-right corner and is saved per sheet.
//
// Resource notes: only sheets near the viewport mount a live canvas (the rest
// are light placeholders), and export force-mounts everything just long
// enough to rasterize.

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileDown, Loader2, Plus, Trash2, ZoomIn, ZoomOut, GripHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { usePinchZoom } from '@/hooks/use-pinch-zoom'
import { useDockClearance } from '@/hooks/use-dock-clearance'
import { sanitizeColors } from '@/lib/store/to-pdf'
import { Slider } from '@/components/ui/slider'
import { InfiniteCanvas } from './canvas'
import { cn } from '@/lib/utils'

/** A4 at ~96 dpi. Sheets keep this ratio at any pane width unless resized. */
export const SHEET_W = 794
export const SHEET_H = 1123
const MIN_SHEET = 320
const MAX_SHEET = 2400
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

function Sheet({
  sheetId,
  index,
  size,
  active,
  mounted,
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
  mounted: boolean
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
        active && 'ring-2 ring-[var(--accent-blue)]/60'
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
            <InfiniteCanvas key={sheetId} pageId={sheetId} locked />
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
          Page {index + 1}
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1.5 left-2.5 z-10 text-[10.5px] font-medium text-muted-foreground">
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [naturalH, setNaturalH] = useState(0)
  const [naturalW, setNaturalW] = useState(0)
  // The board dock (Toolbar) floats over this same page — when it's docked
  // to the top it shares Export's corner, so Export moves down out of its way.
  // Both floating controls sit in dock-reachable corners — measure the dock
  // and step aside only when it actually grows into them.
  const exportRef = useRef<HTMLButtonElement>(null)
  const exportShift = useDockClearance(exportRef, [bare, exporting])
  const zoomStripRef = useRef<HTMLDivElement>(null)
  const zoomStripShift = useDockClearance(zoomStripRef, [bare])

  // CSS `zoom` RESIZES THE LAYOUT BOX (it isn't a pure visual scale) — the
  // page reflows, scroll math gets confused, and any split-view drawing goes
  // to the wrong spot. A `transform: scale()` is a pure visual magnification
  // — like zooming into an image — but it doesn't touch layout, so the
  // scroll container needs to be told how big the SCALED content actually
  // is; that's what this measures.
  useEffect(() => {
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
  // buttons/slider). With transformOrigin 'top left', a content-space point
  // (px, py) renders on screen at px*zoom - scrollLeft. To keep that same
  // content point under the same screen point after zoom changes z -> nz,
  // solve for the new scrollLeft/scrollTop and apply it once React has
  // re-rendered the sizer/content at the new zoom.
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setZoom((z) => {
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor))
      if (nz === z) return z
      const cx = clientX - rect.left + el.scrollLeft
      const cy = clientY - rect.top + el.scrollTop
      const px = cx / z
      const py = cy / z
      requestAnimationFrame(() => {
        el.scrollLeft = px * nz - (clientX - rect.left)
        el.scrollTop = py * nz - (clientY - rect.top)
      })
      return nz
    })
  }

  const zoomAtCenter = (factor: number) => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  // Ctrl/⌘+wheel and trackpad pinch zoom the whole page stack, anchored at
  // the cursor. A plain wheel is left alone so it scrolls the page list.
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
  }, [])

  // Touch: two-finger pinch zooms too, anchored at the finger midpoint —
  // the only zoom gesture a phone has. Baseline (zoom, scroll position,
  // original midpoint) is captured once when the fingers land and held
  // fixed for the whole gesture — see usePinchZoom.
  const pinchBaseRef = useRef<{
    zoom: number
    scrollLeft: number
    scrollTop: number
    clientX: number
    clientY: number
  } | null>(null)

  const onPinchStart = useCallback(
    (clientX: number, clientY: number) => {
      const el = scrollRef.current
      if (!el) return
      pinchBaseRef.current = { zoom, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, clientX, clientY }
    },
    [zoom]
  )

  const onPinchMove = useCallback((ratio: number, clientX: number, clientY: number) => {
    const el = scrollRef.current
    const base = pinchBaseRef.current
    if (!el || !base) return
    const rect = el.getBoundingClientRect()
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, base.zoom * ratio))
    // Content-space point under the ORIGINAL two-finger midpoint — fixed for
    // the whole gesture — mapped to the CURRENT midpoint on screen.
    const px = (base.clientX - rect.left + base.scrollLeft) / base.zoom
    const py = (base.clientY - rect.top + base.scrollTop) / base.zoom
    requestAnimationFrame(() => {
      el.scrollLeft = px * nz - (clientX - rect.left)
      el.scrollTop = py * nz - (clientY - rect.top)
    })
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

  return (
    <div className="relative h-full w-full">
      <div ref={scrollRef} className="h-full w-full overflow-auto bg-muted/40 px-3 py-4 sm:px-6">
        {/* Spacer reserves the scaled content's real footprint on both axes
            so the container has enough room to scroll to — transform doesn't
            reflow, so nothing else tells it how big the zoomed page is.
            margin:auto (not flex centering) so overflow on either side
            stays scrollable instead of getting clipped. */}
        <div style={zoom !== 1 ? { width: naturalW * zoom, height: naturalH * zoom, margin: '0 auto' } : undefined}>
          <div
            ref={contentRef}
            className="flex flex-col gap-4 pb-24"
            style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: 'top left', width: naturalW } : undefined}
          >
            {sheets.map((sheetId, i) => (
              <Sheet
                key={sheetId}
                sheetId={sheetId}
                index={i}
                size={sizeOf(sheetId)}
                active={!bare && activeSheetId === sheetId}
                mounted={visible.has(i) || visible.has(i - 1) || visible.has(i + 1)}
                onVisible={onVisible}
                onFocus={() => setActiveSheet(sheetId)}
                onRemove={() => removeSheet(sheetId)}
                onResize={(w, h) => resizeSheet(sheetId, w, h)}
                removable={sheets.length > 1}
              />
            ))}
            <button
              type="button"
              className="mx-auto flex items-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-2 text-[12.5px] text-muted-foreground transition-colors hover:border-[var(--accent-blue)] hover:text-foreground"
              onClick={() => setActiveSheet(addDocSheet(pageId))}
            >
              <Plus className="h-4 w-4" /> Add page
            </button>
          </div>
        </div>
      </div>

      {!bare && (
        <button
          type="button"
          ref={exportRef}
          disabled={exporting}
          style={{ translate: `${exportShift.x}px ${exportShift.y}px` }}
          className="glass-strong absolute right-4 top-3 z-20 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-[translate,color] duration-200 hover:text-foreground disabled:opacity-60"
          onClick={() => void exportPdf()}
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
      )}

      {/* Doc-wide zoom — uniform across every sheet. Skipped in `bare` (the
          PDF reader's notes pane already has its own zoom control). */}
      {!bare && (
      <div
        ref={zoomStripRef}
        style={{ translate: `${zoomStripShift.x}px ${zoomStripShift.y}px` }}
        className="glass-strong absolute bottom-4 right-4 z-20 flex items-center gap-1.5 rounded-2xl px-2.5 py-1.5 transition-[translate] duration-200"
      >
        <button
          type="button"
          aria-label="Zoom out"
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => zoomAtCenter(0.9)}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <Slider
          className="w-20"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={[zoom]}
          onValueChange={([v]) => zoomAtCenter(v / zoom)}
        />
        <button
          type="button"
          aria-label="Zoom in"
          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => zoomAtCenter(1 / 0.9)}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-9 text-center font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
      </div>
      )}
    </div>
  )
}