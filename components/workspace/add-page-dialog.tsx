'use client'

// The "+" overlay for adding a page — replaces the old plain dropdown with a
// kind picker (Board / Document / PDF), then a per-kind step: name a board,
// pick a document's page size, or drop/browse a file straight onto a PDF
// page (attaching it in the same step instead of uploading afterward).

import { useEffect, useState } from 'react'
import { ChevronLeft, FileText, Layout, BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { attachPdfToPage } from '@/lib/store/pdf-attach'
import { DOC_PAGE_PRESETS, resolveDocPageSize, type DocPageSize, type Orientation } from '@/lib/scene/doc-page-sizes'
import { PdfDropzone } from './pdf-dropzone'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type Step = 'kind' | 'board' | 'doc' | 'pdf'

const KIND_TILES: { step: Step; label: string; hint: string; icon: typeof Layout }[] = [
  { step: 'board', label: 'Whiteboard', hint: 'Infinite canvas', icon: Layout },
  { step: 'doc', label: 'Document', hint: 'A4, Letter or slides', icon: FileText },
  { step: 'pdf', label: 'PDF / PPT', hint: 'Upload to read', icon: BookOpen },
]

function Tile({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-2 overflow-hidden rounded-xl border p-3 text-center transition-colors active:scale-95',
        active
          ? 'border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_10%,transparent)]'
          : 'border-border/60 hover:border-[var(--ring)] hover:bg-accent'
      )}
    >
      {children}
    </button>
  )
}

export function AddPageDialog({
  target,
  onOpenChange,
  onCreated,
}: {
  target: { notebookId: string; sectionId: string } | null
  onOpenChange: (open: boolean) => void
  /** Extra post-create behavior a call site wants (mobile-shell navigates
   *  straight into the editor). addPage already sets activePageId, so
   *  desktop needs nothing extra here. */
  onCreated?: (pageId: string) => void
}) {
  const [step, setStep] = useState<Step>('kind')
  const [name, setName] = useState('')
  const [presetId, setPresetId] = useState<DocPageSize['id']>('a4')
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [converting, setConverting] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    setStep('kind')
    setName('')
    setPresetId('a4')
    setOrientation('portrait')
    setConverting(null)
  }, [target])

  const finish = (pageId: string) => {
    onCreated?.(pageId)
    onOpenChange(false)
  }

  const createBoard = () => {
    if (!target) return
    const id = useWorkspaceStore
      .getState()
      .addPage(target.notebookId, target.sectionId, name.trim() || 'Untitled Page', 'board')
    finish(id)
  }

  const createDoc = () => {
    if (!target) return
    const preset = DOC_PAGE_PRESETS.find((p) => p.id === presetId) ?? DOC_PAGE_PRESETS[0]
    const size = resolveDocPageSize(preset, preset.fixedOrientation ? 'landscape' : orientation)
    const id = useWorkspaceStore
      .getState()
      .addPage(target.notebookId, target.sectionId, name.trim() || 'Untitled Doc', 'doc')
    useWorkspaceStore.getState().updatePageMeta(id, { docPageSize: size })
    finish(id)
  }

  const createPdf = async (file: File) => {
    if (!target) return
    const id = useWorkspaceStore
      .getState()
      .addPage(target.notebookId, target.sectionId, file.name.replace(/\.[^.]+$/, ''), 'pdf')
    try {
      await attachPdfToPage(id, file, setConverting)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not convert this file.')
      // The page still exists, empty — pdf-view's own dropzone can retry.
      finish(id)
      return
    }
    finish(id)
  }

  const title =
    step === 'kind' ? 'Add a page' : step === 'board' ? 'New whiteboard' : step === 'doc' ? 'New document' : 'New PDF / PPT'

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-1.5">
            {step !== 'kind' && (
              <button
                type="button"
                aria-label="Back"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setStep('kind')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          {step === 'kind' && <DialogDescription>What kind of page do you want to add?</DialogDescription>}
        </DialogHeader>

        {step === 'kind' && (
          <div className="grid grid-cols-3 gap-3">
            {KIND_TILES.map((t) => (
              <Tile key={t.step} onClick={() => setStep(t.step)}>
                <t.icon className="h-6 w-6 text-muted-foreground" />
                <span className="text-[12.5px] font-semibold">{t.label}</span>
                <span className="text-[10.5px] leading-tight text-muted-foreground">{t.hint}</span>
              </Tile>
            ))}
          </div>
        )}

        {step === 'board' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Name</Label>
              <Input
                autoFocus
                value={name}
                placeholder="Untitled Page"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createBoard()}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={createBoard}>Create</Button>
            </div>
          </>
        )}

        {step === 'doc' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Name</Label>
              <Input
                autoFocus
                value={name}
                placeholder="Untitled Doc"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createDoc()}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Page size</Label>
              <div className="grid grid-cols-3 gap-3">
                {DOC_PAGE_PRESETS.map((p) => {
                  const size = resolveDocPageSize(p, p.fixedOrientation ? 'landscape' : orientation)
                  return (
                    <Tile key={p.id} active={presetId === p.id} onClick={() => setPresetId(p.id)}>
                      <div
                        className="flex w-10 items-center justify-center rounded-[2px] border border-current text-muted-foreground/50"
                        style={{ aspectRatio: `${size.w} / ${size.h}` }}
                      />
                      <span className="text-[12px] font-semibold">{p.label}</span>
                    </Tile>
                  )
                })}
              </div>
            </div>
            {!DOC_PAGE_PRESETS.find((p) => p.id === presetId)?.fixedOrientation && (
              <div className="flex items-center gap-2">
                <Label className="text-[12px]">Orientation</Label>
                <div className="flex overflow-hidden rounded-lg border border-border/60">
                  {(['portrait', 'landscape'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOrientation(o)}
                      className={cn(
                        'px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors',
                        orientation === o
                          ? 'bg-[var(--accent-blue)] text-white'
                          : 'text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={createDoc}>Create</Button>
            </div>
          </>
        )}

        {step === 'pdf' && (
          <div className="h-56 overflow-hidden rounded-xl border border-dashed border-border/60">
            <PdfDropzone onFile={(f) => void createPdf(f)} converting={converting} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
