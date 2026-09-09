'use client'

// The per-page controls — sit at the right edge of the tab bar (see
// tabs-bar.tsx), laid out inline as bare buttons rather than tucked behind a
// menu or wrapped in a floating pill. Up to two groups, whichever apply:
// zoom, then the current page's own controls (the PDF reader's page/notes/
// file controls via usePdfDockStore, or the doc page kind's Export PDF/.docx
// via useDocDockStore), then the simulation Transport (rightmost). The
// presentation kind's own controls (zoom/transition/slides/present) live in
// their own bar below presentation-view.tsx's slide rail instead — full
// labels, not icon-only, since that page kind has enough controls to want
// the room a dedicated bar gives them.

import { useState } from 'react'
import {
  ChevronLeft, ChevronRight, Columns2, Download, FileDown, FileUp, GalleryThumbnails, Link as LinkIcon,
  Link2Off, Loader2, MonitorPlay, NotebookPen, Rows, Square, ZoomIn, ZoomOut,
} from 'lucide-react'
import { usePdfDockStore } from '@/lib/store/pdf-dock'
import { useDocDockStore } from '@/lib/store/doc-dock'
import { useTransportDockStore } from '@/lib/store/transport-dock'
import { usePrefs } from '@/lib/store/preferences'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { PresentDialog } from './page-actions'
import { HoldableMergedTransport } from './transport'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

function ZoomGroup({
  zoom, setZoom, fitWidth, fitHeight,
}: {
  zoom: number
  setZoom: (zoom: number) => void
  fitWidth: () => void
  fitHeight: () => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <DockBtn label="Zoom out" onClick={() => setZoom(zoom - 0.1)}>
        <ZoomOut className="h-3.5 w-3.5" />
      </DockBtn>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Zoom options"
            className="min-w-9 shrink-0 rounded-md px-0.5 text-center font-mono text-ui-2xs tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {Math.round(zoom * 100)}%
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-40">
          <DropdownMenuItem onClick={fitWidth}>Full width</DropdownMenuItem>
          <DropdownMenuItem onClick={fitHeight}>Full height</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setZoom(1)}>100%</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DockBtn label="Zoom in" onClick={() => setZoom(zoom + 0.1)}>
        <ZoomIn className="h-3.5 w-3.5" />
      </DockBtn>
    </div>
  )
}


const VIEW_MODES = [
  { id: 'scroll', label: 'Continuous scroll', Icon: Rows },
  { id: 'single', label: 'Single page', Icon: Square },
  { id: 'double', label: 'Two pages side by side', Icon: Columns2 },
] as const

function PdfViewModeGroup({
  mode, setMode,
}: {
  mode: 'scroll' | 'single' | 'double'
  setMode: (mode: 'scroll' | 'single' | 'double') => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      {VIEW_MODES.map(({ id, label, Icon }) => (
        <DockBtn key={id} label={label} active={mode === id} onClick={() => setMode(id)}>
          <Icon className="h-3.5 w-3.5" />
        </DockBtn>
      ))}
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
  const isFloating = useTransportDockStore((s) => s.floating)
  const dockPrefs = usePrefs((s) => s.dock)
  const dockHasTransport = dockPrefs.layoutMode === 'extended' && dockPrefs.showTransport
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const pageName = useWorkspaceStore((s) => (pageId ? s.nodes[pageId]?.name : undefined))
  const [presenting, setPresenting] = useState(false)

  const showPdf = !!pdfDock
  const showDoc = !!docDock
  const showSim = showTransport && !!pageId && !isFloating && !dockHasTransport
  const showZoom = showPdf || showDoc
  const showPresent = showPdf && !!pageId && can(role, 'share-pages')

  if (!showPdf && !showDoc && !showSim) return null

  return (
    <div className="flex shrink-0 items-center pr-1">
      {showPdf && (
        <ZoomGroup zoom={pdfDock.zoom} setZoom={pdfDock.setZoom} fitWidth={pdfDock.fitWidth} fitHeight={pdfDock.fitHeight} />
      )}
      {showDoc && (
        <ZoomGroup zoom={docDock.zoom} setZoom={docDock.setZoom} fitWidth={docDock.fitWidth} fitHeight={docDock.fitHeight} />
      )}

      {showZoom && pdfDock && <Divider />}
      {pdfDock && (
        <div className="flex items-center gap-0.5">
          <DockBtn
            label="Previous page"
            disabled={pdfDock.current <= 1}
            onClick={() => pdfDock.scrollToPage?.(pdfDock.current - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </DockBtn>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const num = parseInt((e.currentTarget.elements.namedItem('pageNum') as HTMLInputElement)?.value, 10)
              if (num >= 1 && num <= pdfDock.numPages) {
                pdfDock.scrollToPage?.(num)
              }
            }}
            className="flex items-center gap-0.5 mr-1"
          >
            <input
              key={pdfDock.current}
              name="pageNum"
              defaultValue={pdfDock.current}
              type="number"
              min={1}
              max={pdfDock.numPages}
              aria-label="Jump to page"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              onBlur={(e) => {
                const num = parseInt(e.target.value, 10)
                if (num >= 1 && num <= pdfDock.numPages && num !== pdfDock.current) {
                  pdfDock.scrollToPage?.(num)
                }
              }}
              className="w-7 h-5 rounded border border-border/50 bg-background/80 px-1 text-center font-mono text-ui-xs tabular-nums text-foreground outline-none focus:border-[var(--accent-blue)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="font-mono text-ui-xs tabular-nums text-muted-foreground">
              /{pdfDock.numPages}
            </span>
          </form>
          <DockBtn
            label="Next page"
            disabled={pdfDock.current >= pdfDock.numPages}
            onClick={() => pdfDock.scrollToPage?.(pdfDock.current + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </DockBtn>
          <Divider />
          <PdfViewModeGroup mode={pdfDock.viewMode} setMode={pdfDock.setViewMode} />
          {showPresent && (
            <DockBtn label="Present on room board…" onClick={() => setPresenting(true)}>
              <MonitorPlay className="h-3.5 w-3.5" />
            </DockBtn>
          )}
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
        <div className="flex items-center gap-0.5">
          <DockBtn
            label={docDock.sorterOpen ? 'Hide page sorter' : 'Reorder pages'}
            active={docDock.sorterOpen}
            onClick={docDock.toggleSorter}
          >
            <GalleryThumbnails className="h-3.5 w-3.5" />
          </DockBtn>
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
          <DockBtn
            label={docDock.exportingDocx ? 'Exporting…' : 'Export .docx'}
            disabled={docDock.exportingDocx}
            onClick={docDock.exportDocx}
          >
            {docDock.exportingDocx ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </DockBtn>
        </div>
      )}

      {(showPdf || showDoc) && showSim && <Divider />}
      {showSim && <HoldableMergedTransport pageId={pageId!} />}

      {showPresent && (
        <PresentDialog
          page={presenting && pageId ? { id: pageId, name: pageName ?? 'Untitled' } : null}
          onOpenChange={(o) => !o && setPresenting(false)}
        />
      )}
    </div>
  )
}
