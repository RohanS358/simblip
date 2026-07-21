'use client'

// The per-page controls — sit at the right edge of the tab bar (see
// tabs-bar.tsx), laid out inline as bare buttons rather than tucked behind a
// menu or wrapped in a floating pill. Up to three groups, whichever apply:
// zoom, then the current page's own controls (the PDF reader's page/notes/
// file controls, published by PdfView via usePdfDockStore — or the doc page
// kind's Export PDF, published by DocView via useDocDockStore), then the
// simulation Transport (rightmost). A page is either 'pdf' or 'doc', never
// both, so only one of the two docks is ever populated at once. None of
// this floats over the canvas anymore, so reading/exporting/simulating
// doesn't cost any canvas space.

import {
  Download, FileDown, FileUp, Link as LinkIcon, Link2Off, Loader2,
  NotebookPen, ZoomIn, ZoomOut,
} from 'lucide-react'
import { usePdfDockStore } from '@/lib/store/pdf-dock'
import { useDocDockStore } from '@/lib/store/doc-dock'
import { Transport } from './transport'
import { cn } from '@/lib/utils'

function DockBtn({
  active, disabled, label, onClick, children,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
        active
          ? 'text-[var(--accent-blue)]'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-4 w-px shrink-0 bg-border" />
}

function ZoomGroup({ zoom, setZoom }: { zoom: number; setZoom: (zoom: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <DockBtn label="Zoom out" onClick={() => setZoom(zoom - 0.1)}>
        <ZoomOut className="h-3.5 w-3.5" />
      </DockBtn>
      <span className="min-w-9 shrink-0 text-center font-mono text-[10.5px] tabular-nums text-muted-foreground">
        {Math.round(zoom * 100)}%
      </span>
      <DockBtn label="Zoom in" onClick={() => setZoom(zoom + 0.1)}>
        <ZoomIn className="h-3.5 w-3.5" />
      </DockBtn>
    </div>
  )
}

export function PageControlsMenu({
  pageId,
  showTransport,
}: {
  pageId: string | null
  showTransport: boolean
}) {
  const pdfDock = usePdfDockStore((s) => s.dock)
  const docDock = useDocDockStore((s) => s.dock)
  const showPdf = !!pdfDock
  const showDoc = !!docDock
  const showSim = showTransport && !!pageId
  const showZoom = showPdf || showDoc

  if (!showPdf && !showDoc && !showSim) return null

  return (
    <div className="flex shrink-0 items-center pr-1">
      {showPdf && <ZoomGroup zoom={pdfDock.zoom} setZoom={pdfDock.setZoom} />}
      {showDoc && <ZoomGroup zoom={docDock.zoom} setZoom={docDock.setZoom} />}

      {showZoom && pdfDock && <Divider />}
      {pdfDock && (
        <div className="flex items-center gap-0.5">
          <span className="mr-0.5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {pdfDock.current}/{pdfDock.numPages}
          </span>
          <DockBtn
            label={pdfDock.notesOpen ? 'Close notes' : 'Open notes'}
            active={pdfDock.notesOpen}
            onClick={pdfDock.toggleNotes}
          >
            <NotebookPen className="h-3.5 w-3.5" />
          </DockBtn>
          {pdfDock.notesOpen && (
            <DockBtn
              label={pdfDock.linked ? 'Unlink notes from PDF pages' : 'Link: one note page per PDF page'}
              active={pdfDock.linked}
              onClick={pdfDock.toggleLink}
            >
              {pdfDock.linked ? <LinkIcon className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
            </DockBtn>
          )}
          <DockBtn label="Download original" onClick={pdfDock.download}>
            <Download className="h-3.5 w-3.5" />
          </DockBtn>
          <DockBtn label="Replace file" onClick={pdfDock.replace}>
            <FileUp className="h-3.5 w-3.5" />
          </DockBtn>
        </div>
      )}

      {showZoom && docDock && <Divider />}
      {docDock && (
        <DockBtn
          label={docDock.exporting ? 'Exporting…' : 'Export PDF'}
          disabled={docDock.exporting}
          onClick={docDock.exportPdf}
        >
          {docDock.exporting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileDown className="h-3.5 w-3.5" />
          )}
        </DockBtn>
      )}

      {(showPdf || showDoc) && showSim && <Divider />}
      {showSim && <Transport pageId={pageId!} flat />}
    </div>
  )
}
