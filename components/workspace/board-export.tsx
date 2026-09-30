'use client'

// Whiteboard export: PNG / JPEG / WebP / PDF of everything drawn on the board,
// cropped to the used space plus a margin you choose. The board is mounted a
// second time, behind the app at 1:1, as the same viewer canvas the page
// thumbnails use, then rasterized with html2canvas (the doc PDF export's
// recipe). Rendered as the body of the shared ExportButton popover.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { usePrefs } from '@/lib/store/preferences'
import { InfiniteCanvas } from './canvas'
import { cn } from '@/lib/utils'

type Format = 'png' | 'jpeg' | 'webp' | 'pdf'
type Bg = 'grid' | 'white' | 'transparent'
type PdfPage = 'fit' | 'a4' | 'letter'

const MAX_SIDE = 8000 // px — browsers refuse canvases much larger
const PDF_PT: Record<Exclude<PdfPage, 'fit'>, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] }
const MIME: Record<Exclude<Format, 'pdf'>, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

type Box = { x: number; y: number; w: number; h: number }

/** Used space of the page. A rotated object is covered by the circle through
 *  its corners, so nothing rotated gets clipped. */
function usedBox(
  objects: Record<string, { position: { x: number; y: number }; size: { w: number; h: number }; rotation?: number }>,
  margin: number
): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const o of Object.values(objects)) {
    let { x, y } = o.position
    let { w, h } = o.size
    if (o.rotation) {
      const r = Math.hypot(w, h) / 2
      x += w / 2 - r
      y += h / 2 - r
      w = h = r * 2
    }
    x0 = Math.min(x0, x); y0 = Math.min(y0, y)
    x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h)
  }
  if (!isFinite(x0)) return null
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + margin * 2, h: y1 - y0 + margin * 2 }
}

function Seg<T extends string | number>({
  value, options, onChange, label, disabled,
}: {
  value: T
  options: { id: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  label: string
  disabled?: boolean
}) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.id)}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.id)}
            className={cn(
              'flex-1 rounded-lg border py-1 text-ui-xs transition-colors disabled:opacity-40',
              value === o.id
                ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'border-border/60 text-muted-foreground hover:bg-accent'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function BoardExportPanel({ pageId }: { pageId: string }) {
  const pageName = useWorkspaceStore((s) => s.nodes[pageId]?.name) ?? 'whiteboard'
  const gridPref = usePrefs((s) => s.notebook.grid)
  const gridSize = usePrefs((s) => s.notebook.gridSize) ?? 40
  const [format, setFormat] = useState<Format>('png')
  const [bg, setBg] = useState<Bg>(gridPref === 'none' ? 'white' : 'grid')
  const [scale, setScale] = useState(2)
  const [margin, setMargin] = useState(48)
  const [quality, setQuality] = useState(92)
  const [pdfPage, setPdfPage] = useState<PdfPage>('fit')
  const [name, setName] = useState('')
  const [job, setJob] = useState<Box | null>(null)

  const opaqueOnly = format === 'jpeg' || format === 'pdf'
  // JPEG and PDF have no alpha: "transparent" falls back to white there.
  const effBg: Bg = opaqueOnly && bg === 'transparent' ? 'white' : bg
  const gridKind = gridPref === 'none' ? 'dots' : gridPref
  const lossy = format === 'jpeg' || format === 'webp'

  const preview = usedBox(useDocStore.getState().pages[pageId]?.objects ?? {}, margin)
  const px = preview ? Math.min(scale, MAX_SIDE / Math.max(preview.w, preview.h)) : scale
  const dims = preview ? `${Math.round(preview.w * px)} × ${Math.round(preview.h * px)} px` : 'Nothing drawn yet'

  const run = async (copy: boolean) => {
    const box = usedBox(useDocStore.getState().pages[pageId]?.objects ?? {}, margin)
    if (!box) return toast.message('Nothing on this board to export yet')
    setJob(box)
    try {
      // Let the stage's canvas mount and paint its objects.
      await new Promise((r) => setTimeout(r, 700))
      const el = document.getElementById('board-export-stage')
      if (!el) throw new Error('Export failed to start')
      const { default: html2canvas } = await import('html2canvas-pro')
      const canvas = await html2canvas(el, {
        scale: Math.min(scale, MAX_SIDE / Math.max(box.w, box.h)),
        useCORS: true,
        logging: false,
        foreignObjectRendering: true,
        backgroundColor: effBg === 'transparent' ? null : '#ffffff',
      })
      const toBlob = (mime: string, q: number) =>
        new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Export failed'))), mime, q))

      if (copy) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toBlob('image/png', 1) })])
        toast.success('Copied to clipboard')
        return
      }

      const file = `${name.trim() || pageName}.${format === 'jpeg' ? 'jpg' : format}`
      let blob: Blob
      if (format === 'pdf') {
        const { jsPDF } = await import('jspdf')
        const img = canvas.toDataURL('image/jpeg', quality / 100)
        let pdf
        if (pdfPage === 'fit') {
          pdf = new jsPDF({ unit: 'px', format: [box.w, box.h], orientation: box.w > box.h ? 'landscape' : 'portrait', hotfixes: ['px_scaling'] })
          pdf.addImage(img, 'JPEG', 0, 0, box.w, box.h)
        } else {
          const [pw, ph] = PDF_PT[pdfPage]
          const land = box.w > box.h
          pdf = new jsPDF({ unit: 'pt', format: pdfPage, orientation: land ? 'landscape' : 'portrait' })
          const W = land ? ph : pw
          const H = land ? pw : ph
          const pad = 24
          const k = Math.min((W - pad * 2) / box.w, (H - pad * 2) / box.h)
          pdf.addImage(img, 'JPEG', (W - box.w * k) / 2, (H - box.h * k) / 2, box.w * k, box.h * k)
        }
        blob = pdf.output('blob')
      } else {
        blob = await toBlob(MIME[format], quality / 100)
      }
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = file
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      toast.success(`Exported ${file}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setJob(null)
    }
  }

  return (
    <div className="w-64 p-3">
      <Seg
        label="Format"
        value={format}
        onChange={setFormat}
        options={[
          { id: 'png', label: 'PNG' },
          { id: 'jpeg', label: 'JPEG' },
          { id: 'webp', label: 'WebP' },
          { id: 'pdf', label: 'PDF' },
        ]}
      />
      <Seg
        label="Background"
        value={effBg}
        onChange={setBg}
        options={[
          { id: 'grid', label: 'Grid' },
          { id: 'white', label: 'Plain white' },
          { id: 'transparent', label: 'None', disabled: opaqueOnly },
        ]}
      />
      <Seg
        label="Resolution"
        value={scale}
        onChange={setScale}
        options={[1, 2, 3, 4].map((n) => ({ id: n, label: `${n}×` }))}
      />
      <Seg
        label="Margin"
        value={margin}
        onChange={setMargin}
        options={[
          { id: 0, label: 'None' },
          { id: 24, label: 'S' },
          { id: 48, label: 'M' },
          { id: 96, label: 'L' },
        ]}
      />
      {format === 'pdf' && (
        <Seg
          label="Page"
          value={pdfPage}
          onChange={setPdfPage}
          options={[
            { id: 'fit', label: 'Fit content' },
            { id: 'a4', label: 'A4' },
            { id: 'letter', label: 'Letter' },
          ]}
        />
      )}
      {(lossy || format === 'pdf') && (
        <label className="mb-3 block">
          <span className="mb-1 flex justify-between text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Quality <span className="tabular-nums normal-case">{quality}%</span>
          </span>
          <input
            type="range"
            min={50}
            max={100}
            step={5}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="w-full accent-[var(--accent-blue)]"
          />
        </label>
      )}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={pageName}
        aria-label="File name"
        className="mb-2 w-full rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 text-ui-sm outline-none focus:border-[var(--accent-blue)]/70"
      />
      <p className="mb-2 text-ui-2xs tabular-nums text-muted-foreground">{dims}</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={!!job || !preview}
          onClick={() => run(false)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-blue)] py-1.5 text-ui-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {job && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {job ? 'Exporting…' : 'Export'}
        </button>
        <button
          type="button"
          disabled={!!job || !preview}
          onClick={() => run(true)}
          aria-label="Copy as PNG"
          title="Copy as PNG"
          className="flex w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      {job &&
        createPortal(
          <div aria-hidden className="pointer-events-none fixed left-0 top-0 -z-50" style={{ width: job.w, height: job.h }}>
            <div
              id="board-export-stage"
              className={cn(
                'relative overflow-hidden',
                effBg === 'grid' && gridKind === 'dots' && 'canvas-dots',
                effBg === 'grid' && gridKind === 'lines' && 'canvas-lines',
                effBg === 'grid' && gridKind === 'graph' && 'canvas-graph'
              )}
              style={{
                width: job.w,
                height: job.h,
                backgroundColor: effBg === 'white' ? '#fff' : effBg === 'grid' ? 'var(--background)' : undefined,
                // Grid cells stay aligned to the page origin, as on the board.
                backgroundSize: effBg !== 'grid' ? undefined : gridKind === 'lines' ? `100% ${gridSize}px` : `${gridSize}px ${gridSize}px`,
                backgroundPosition: effBg !== 'grid' ? undefined : `${-job.x}px ${-job.y}px`,
              }}
            >
              <div className="absolute" style={{ left: -job.x, top: -job.y, width: job.x + job.w, height: job.y + job.h }}>
                <InfiniteCanvas pageId={pageId} locked transparent passthrough viewer active={false} />
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
