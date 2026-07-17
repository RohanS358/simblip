'use client'

// Doc page: a scrollable stack of A4-proportioned SHEETS, each one a full
// infinite-canvas surface — same objects, behaviors, simulations and tools as
// a board, but paginated like a document and exportable to PDF.
//
// Resource notes: only sheets near the viewport mount a live canvas (the rest
// are light placeholders), and export force-mounts everything just long
// enough to rasterize.

import { useEffect, useRef, useState } from 'react'
import { FileDown, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { InfiniteCanvas } from './canvas'
import { cn } from '@/lib/utils'

/** A4 at ~96 dpi. Sheets keep this ratio at any pane width. */
export const SHEET_W = 794
export const SHEET_H = 1123

function Sheet({
  sheetId,
  index,
  active,
  mounted,
  onVisible,
  onFocus,
  onRemove,
  removable,
}: {
  sheetId: string
  index: number
  active: boolean
  mounted: boolean
  onVisible: (i: number, v: boolean) => void
  onFocus: () => void
  onRemove: () => void
  removable: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => onVisible(index, e.isIntersecting),
      { rootMargin: '600px 0px' } // pre-mount one sheet ahead in each direction
    )
    io.observe(el)
    return () => io.disconnect()
  }, [index, onVisible])

  return (
    <div
      ref={ref}
      data-sheet={sheetId}
      className={cn(
        'group relative mx-auto w-full max-w-[900px] overflow-hidden rounded-md bg-white shadow-[0_2px_16px_rgba(0,0,0,0.14)] dark:bg-neutral-900',
        active && 'ring-2 ring-[var(--accent-blue)]/60'
      )}
      style={{ aspectRatio: `${SHEET_W} / ${SHEET_H}` }}
      onPointerDownCapture={onFocus}
    >
      {mounted ? (
        <InfiniteCanvas key={sheetId} pageId={sheetId} />
      ) : (
        <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
          Page {index + 1}
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1.5 right-2.5 z-10 text-[10.5px] font-medium text-muted-foreground">
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
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const exportPdf = async () => {
    if (!sheets.length || exporting) return
    setExporting(true)
    try {
      // Everything must be in the DOM to rasterize; mount all, give the
      // canvases a beat to paint, then capture at 2× for a crisp PDF.
      setVisible(new Set(sheets.map((_, i) => i)))
      await new Promise((r) => setTimeout(r, 900))
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ])
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
      const pw = pdf.internal.pageSize.getWidth()
      const ph = pdf.internal.pageSize.getHeight()
      const host = scrollRef.current!
      for (let i = 0; i < sheets.length; i++) {
        const el = host.querySelector<HTMLElement>(`[data-sheet="${sheets[i]}"]`)
        if (!el) continue
        const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false })
        if (i > 0) pdf.addPage()
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, ph)
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
    useWorkspaceStore.getState().updatePageMeta(pageId, {
      docPages: sheets.filter((s) => s !== sheetId),
    })
    useDocStore.getState().forgetPage(sheetId)
    if (activeSheetId === sheetId) setActiveSheet(sheets.find((s) => s !== sheetId) ?? null)
  }

  return (
    <div className="relative h-full w-full">
      <div ref={scrollRef} className="h-full w-full overflow-y-auto bg-muted/40 px-3 py-4 sm:px-6">
        <div className="flex flex-col gap-4 pb-24">
          {sheets.map((sheetId, i) => (
            <Sheet
              key={sheetId}
              sheetId={sheetId}
              index={i}
              active={!bare && activeSheetId === sheetId}
              mounted={visible.has(i) || visible.has(i - 1) || visible.has(i + 1)}
              onVisible={onVisible}
              onFocus={() => setActiveSheet(sheetId)}
              onRemove={() => removeSheet(sheetId)}
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

      {!bare && (
        <button
          type="button"
          disabled={exporting}
          className="glass-strong absolute right-4 top-3 z-20 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          onClick={() => void exportPdf()}
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
          {exporting ? 'Exporting…' : 'Export PDF'}
        </button>
      )}
    </div>
  )
}
