'use client'

// The single Export control, identical on every page kind. A whiteboard gets
// the full image/PDF options panel; every other kind lists the formats its
// view published to useExportDock.

import { FileDown, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useExportDock, type ExportItem } from '@/lib/store/export-dock'
import { useDocDockStore } from '@/lib/store/doc-dock'
import { usePdfDockStore } from '@/lib/store/pdf-dock'
import { BoardExportPanel } from './board-export'

export function ExportButton({ pageId, board }: { pageId: string | null; board: boolean }) {
  // Doc and PDF already publish their own docks (zoom, pages…); their export
  // actions are read from there. Slides and sheets publish to useExportDock.
  const docDock = useDocDockStore((s) => s.dock)
  const pdfDock = usePdfDockStore((s) => s.dock)
  const published = useExportDock((s) => s.items)
  const items: ExportItem[] | null = docDock
    ? [
        { id: 'pdf', label: 'PDF', hint: 'Paged, print-ready', busy: docDock.exporting, run: docDock.exportPdf },
        { id: 'docx', label: 'Word (.docx)', hint: 'Editable document', busy: docDock.exportingDocx, run: docDock.exportDocx },
      ]
    : pdfDock
      ? [{ id: 'orig', label: 'Original PDF', hint: 'Download the file as uploaded', run: pdfDock.download }]
      : published
  const busy = !!items?.some((i) => i.busy)
  if (board ? !pageId : !items?.length) return null
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Export"
        title="Export"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="z-[100] w-auto p-0">
        {board ? (
          <BoardExportPanel pageId={pageId!} />
        ) : (
          <div className="flex w-56 flex-col gap-0.5 p-1.5">
            <p className="px-2 pb-1 pt-1 text-ui-2xs font-semibold uppercase tracking-wide text-muted-foreground">Export as</p>
            {items!.map((i) => (
              <button
                key={i.id}
                type="button"
                disabled={i.busy}
                onClick={i.run}
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-ui-sm transition-colors hover:bg-accent disabled:opacity-50"
              >
                <span className="min-w-0">
                  {i.busy ? 'Exporting…' : i.label}
                  {i.hint && <span className="block text-ui-2xs text-muted-foreground">{i.hint}</span>}
                </span>
                {i.busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
