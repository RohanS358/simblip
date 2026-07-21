'use client'

// The dynamic per-page controls menu — sits at the left edge of the tab bar
// (see tabs-bar.tsx). Two sections, either or both may appear: the PDF
// reader's page nav/notes/zoom/file controls (published by PdfView via
// usePdfDockStore — it no longer floats its own pill) and the simulation
// Transport for whichever content page is focused. Neither floats over the
// canvas anymore, so reading or simulating doesn't cost any canvas space.

import {
  SlidersHorizontal, Download, FileUp, Link as LinkIcon, Link2Off,
  NotebookPen, ZoomIn, ZoomOut,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePdfDockStore } from '@/lib/store/pdf-dock'
import { Transport } from './transport'
import { cn } from '@/lib/utils'

function DockBtn({
  active, label, onClick, children,
}: { active?: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
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

export function PageControlsMenu({
  pageId,
  showTransport,
}: {
  pageId: string | null
  showTransport: boolean
}) {
  const dock = usePdfDockStore((s) => s.dock)
  const showPdf = !!dock
  const showSim = showTransport && !!pageId

  if (!showPdf && !showSim) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Page controls"
          className="flex shrink-0 items-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 rounded-xl p-2.5">
        {showSim && (
          <div className="flex justify-center pb-1">
            <Transport pageId={pageId!} />
          </div>
        )}
        {showSim && showPdf && <DropdownMenuSeparator className="my-2" />}
        {dock && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                Page {dock.current} / {dock.numPages}
              </span>
              <div className="flex items-center gap-0.5">
                <DockBtn
                  label={dock.notesOpen ? 'Close notes' : 'Open notes'}
                  active={dock.notesOpen}
                  onClick={dock.toggleNotes}
                >
                  <NotebookPen className="h-4 w-4" />
                </DockBtn>
                {dock.notesOpen && (
                  <DockBtn
                    label={dock.linked ? 'Unlink notes from PDF pages' : 'Link: one note page per PDF page'}
                    active={dock.linked}
                    onClick={dock.toggleLink}
                  >
                    {dock.linked ? <LinkIcon className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
                  </DockBtn>
                )}
                <DockBtn label="Download original" onClick={dock.download}>
                  <Download className="h-4 w-4" />
                </DockBtn>
                <DockBtn label="Replace file" onClick={dock.replace}>
                  <FileUp className="h-4 w-4" />
                </DockBtn>
              </div>
            </div>
            <div className="flex items-center gap-1.5 px-0.5">
              <button
                type="button"
                aria-label="Zoom out"
                className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => dock.setZoom(dock.zoom - 0.1)}
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <Slider
                className="w-full"
                min={0.25}
                max={3}
                step={0.05}
                value={[dock.zoom]}
                onValueChange={([v]) => dock.setZoom(v)}
              />
              <button
                type="button"
                aria-label="Zoom in"
                className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => dock.setZoom(dock.zoom + 0.1)}
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-9 shrink-0 text-center font-mono text-[10.5px] tabular-nums text-muted-foreground">
                {Math.round(dock.zoom * 100)}%
              </span>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
