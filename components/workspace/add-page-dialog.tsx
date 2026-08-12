'use client'

// The "+" overlay for adding a page — a top-level kind picker (Whiteboard /
// Document / Upload), where Document is the umbrella for every canvas-sheet
// page: A4/Letter doc, Presentation (slide deck + Present mode), and
// Spreadsheet all live one step behind the Document tile instead of each
// getting their own top-level tile. Document/Presentation share one
// canvas-sheet engine (doc-view.tsx / presentation-view.tsx) — Document
// exports to PDF and .docx, Presentation is the same engine laid out as a
// slide deck. Upload is the one universal entry point for any existing
// file (PDF, .docx, .xlsx, .pptx, or an image) — it reads the extension
// and routes to the matching kind automatically, same resolver
// open-file.ts uses for files already sitting in the folder tree — so the
// doc/presentation/spreadsheet steps below offer TEMPLATES to start from,
// not their own upload box (that would just be a second, redundant path to
// what Upload already does).

import { useEffect, useState } from 'react'
import { ChevronLeft, FileText, Layout, Presentation as PresentationIcon, FileSpreadsheet, Upload as UploadIcon, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { attachPdfToPage } from '@/lib/store/pdf-attach'
import { DOC_PAGE_PRESETS, resolveDocPageSize, type DocPageSize, type Orientation } from '@/lib/scene/doc-page-sizes'
import {
  docTemplate,
  pptxTemplate,
  xlsxTemplate,
  type DocTemplateId,
  type PptxTemplateId,
  type XlsxTemplateId,
} from '@/lib/scene/page-templates'
import { pageKindForFile } from './open-file'
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

export type Step = 'kind' | 'board' | 'doc-kind' | 'doc' | 'pptx' | 'xlsx' | 'web' | 'upload'

const KIND_TILES: { step: Step; label: string; hint: string; icon: typeof Layout }[] = [
  { step: 'board', label: 'Whiteboard', hint: 'Infinite canvas', icon: Layout },
  { step: 'doc-kind', label: 'Document', hint: 'Doc, presentation or spreadsheet', icon: FileText },
  { step: 'web', label: 'Web Browser', hint: 'Search, offline cache & pen notes', icon: Globe },
  { step: 'upload', label: 'Upload', hint: 'PDF, Word, Excel, PPT, image', icon: UploadIcon },
]

const DOC_KIND_TILES: { step: Step; label: string; hint: string; icon: typeof Layout }[] = [
  { step: 'doc', label: 'Document', hint: 'A4, Letter — export .pdf/.docx', icon: FileText },
  { step: 'pptx', label: 'Presentation', hint: 'Slides, Present mode', icon: PresentationIcon },
  { step: 'xlsx', label: 'Spreadsheet', hint: 'Templates or blank', icon: FileSpreadsheet },
]

const DOC_TEMPLATES: { id: DocTemplateId; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'report', label: 'Report' },
  { id: 'resume', label: 'Resume' },
  { id: 'meeting-notes', label: 'Meeting Notes' },
]

const PPTX_TEMPLATES: { id: PptxTemplateId; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'title-deck', label: 'Title Slide Deck' },
  { id: 'pitch-deck', label: 'Pitch Deck' },
]

const XLSX_TEMPLATES: { id: XlsxTemplateId; label: string }[] = [
  { id: 'blank', label: 'Blank' },
  { id: 'budget', label: 'Budget' },
  { id: 'task-tracker', label: 'Task Tracker' },
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
  /** `step` deep-links past the kind picker: the mobile home screen's
   *  create tiles already say which kind you picked, so making you pick it
   *  again in the dialog is a wasted tap. */
  target: { parentId: string; step?: Step } | null
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
    setStep(target.step ?? 'kind')
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
    const id = useWorkspaceStore.getState().addPageIn(target.parentId, name.trim() || 'Untitled Page', 'board')
    finish(id)
  }

  const [webUrl, setWebUrl] = useState('https://www.google.com.np')

  const createWeb = () => {
    if (!target) return
    const urlResolved = /^https?:\/\//i.test(webUrl.trim())
      ? webUrl.trim()
      : webUrl.trim()
        ? `https://${webUrl.trim()}`
        : 'https://en.wikipedia.org/wiki/Physics'
    const id = useWorkspaceStore.getState().addPageIn(target.parentId, name.trim() || 'New Browser Tab', 'web')
    useWorkspaceStore.getState().updatePageMeta(id, {
      webUrl: urlResolved,
      webHistory: [urlResolved],
      webHistoryIndex: 0,
    })
    finish(id)
  }

  const createDoc = async (templateId: DocTemplateId) => {
    if (!target) return
    const preset = DOC_PAGE_PRESETS.find((p) => p.id === presetId) ?? DOC_PAGE_PRESETS[0]
    const size = resolveDocPageSize(preset, preset.fixedOrientation ? 'landscape' : orientation)
    const id = useWorkspaceStore.getState().addPageIn(target.parentId, name.trim() || 'Untitled Doc', 'doc')
    useWorkspaceStore.getState().updatePageMeta(id, { docPageSize: size })
    const objects = docTemplate(templateId)
    if (objects.length) {
      // Re-read state AFTER addPageIn — a store snapshot taken before that
      // call doesn't reflect the node it just created (zustand's set()
      // doesn't retroactively update an already-destructured snapshot).
      const meta = useWorkspaceStore.getState().nodes[id]
      const sheetId = meta?.kind === 'page' ? meta.docPages?.[0] : undefined
      if (sheetId) {
        const { useDocStore } = await import('@/lib/store/document')
        for (const obj of objects) useDocStore.getState().addObject(sheetId, obj)
      }
    }
    finish(id)
  }

  const createPptx = async (templateId: PptxTemplateId) => {
    if (!target) return
    const store = useWorkspaceStore.getState()
    const id = store.addPageIn(target.parentId, 'Untitled Presentation', 'pptx')
    const { useDocStore } = await import('@/lib/store/document')
    for (const objects of pptxTemplate(templateId)) {
      const slideId = store.addDocSheet(id)
      for (const obj of objects) useDocStore.getState().addObject(slideId, obj)
    }
    finish(id)
  }

  const createXlsx = async (templateId: XlsxTemplateId) => {
    if (!target) return
    const id = useWorkspaceStore.getState().addPageIn(target.parentId, 'Untitled Spreadsheet', 'xlsx')
    const data = xlsxTemplate(templateId)
    if (Object.keys(data).length) {
      const { useFilePageContentStore } = await import('@/lib/store/file-page-content')
      useFilePageContentStore.getState().setContent(id, data)
    }
    finish(id)
  }

  const createPdf = async (file: File) => {
    if (!target) return
    const id = useWorkspaceStore
      .getState()
      .addPageIn(target.parentId, file.name.replace(/\.[^.]+$/, ''), 'pdf')
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

  /** Word/Excel/PPT/image go through this — same fileUrl handoff open-file.ts
   *  uses for files already in the tree, so both paths import identically. */
  const createFromUpload = async (kind: 'doc' | 'xlsx' | 'pptx' | 'image', file: File) => {
    if (!target) return
    setConverting('Uploading…')
    try {
      const { putFile } = await import('@/lib/storage/manager')
      const { useAuthStore } = await import('@/lib/auth/store')
      const ownerId = useAuthStore.getState().profile?.id ?? 'anon'
      const fileId = await putFile(file, file.name, file.type || 'application/octet-stream', ownerId)
      const id = useWorkspaceStore
        .getState()
        .addPageIn(target.parentId, file.name.replace(/\.[^.]+$/, ''), kind)
      useWorkspaceStore.getState().updatePageMeta(id, {
        fileUrl: `opfs:${fileId}`,
        fileName: file.name,
        fileMime: file.type,
      })
      finish(id)
    } catch {
      toast.error('Could not upload this file.')
    } finally {
      setConverting(null)
    }
  }

  /** Upload's single dropzone: read the extension and route to whichever
   *  kind can open it — same resolver a file sitting in the folder tree
   *  uses on click (open-file.ts's pageKindForFile). */
  const createFromAnyUpload = async (file: File) => {
    const kind = pageKindForFile({ mime: file.type, name: file.name })
    if (!kind) {
      toast.error("This file type isn't supported yet.")
      return
    }
    if (kind === 'pdf') {
      await createPdf(file)
      return
    }
    await createFromUpload(kind as 'doc' | 'xlsx' | 'pptx' | 'image', file)
  }

  const STEP_TITLES: Record<Step, string> = {
    kind: 'Add a page',
    board: 'New whiteboard',
    'doc-kind': 'Document',
    doc: 'New document',
    pptx: 'New presentation',
    xlsx: 'New spreadsheet',
    web: 'New web browser tab',
    upload: 'Upload a file',
  }
  const title = STEP_TITLES[step]
  // doc/pptx/xlsx are reached THROUGH doc-kind, so their back arrow returns
  // there, not all the way to the top-level kind picker.
  const backStep: Step = step === 'doc' || step === 'pptx' || step === 'xlsx' ? 'doc-kind' : 'kind'

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className={step === 'kind' || step === 'doc-kind' ? 'max-w-lg' : 'max-w-md'}>
        <DialogHeader>
          <div className="flex items-center gap-1.5">
            {step !== 'kind' && (
              <button
                type="button"
                aria-label="Back"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setStep(backStep)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          {step === 'kind' && <DialogDescription>What kind of page do you want to add?</DialogDescription>}
          {step === 'doc-kind' && <DialogDescription>What kind of document?</DialogDescription>}
        </DialogHeader>

        {step === 'kind' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {KIND_TILES.map((t) => (
              <Tile key={t.step} onClick={() => setStep(t.step)}>
                <t.icon className="h-6 w-6 text-muted-foreground" />
                <span className="text-[0.78125rem] font-semibold">{t.label}</span>
                <span className="text-[0.65625rem] leading-tight text-muted-foreground">{t.hint}</span>
              </Tile>
            ))}
          </div>
        )}

        {step === 'doc-kind' && (
          <div className="grid grid-cols-3 gap-3">
            {DOC_KIND_TILES.map((t) => (
              <Tile key={t.step} onClick={() => setStep(t.step)}>
                <t.icon className="h-6 w-6 text-muted-foreground" />
                <span className="text-[0.78125rem] font-semibold">{t.label}</span>
                <span className="text-[0.65625rem] leading-tight text-muted-foreground">{t.hint}</span>
              </Tile>
            ))}
          </div>
        )}

        {step === 'board' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[0.75rem]">Name</Label>
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
              <Label className="text-[0.75rem]">Name</Label>
              <Input
                autoFocus
                value={name}
                placeholder="Untitled Doc"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[0.75rem]">Page size</Label>
              <div className="grid grid-cols-3 gap-3">
                {DOC_PAGE_PRESETS.map((p) => {
                  const size = resolveDocPageSize(p, p.fixedOrientation ? 'landscape' : orientation)
                  return (
                    <Tile key={p.id} active={presetId === p.id} onClick={() => setPresetId(p.id)}>
                      <div
                        className="flex w-10 items-center justify-center rounded-[2px] border border-current text-muted-foreground/50"
                        style={{ aspectRatio: `${size.w} / ${size.h}` }}
                      />
                      <span className="text-[0.75rem] font-semibold">{p.label}</span>
                    </Tile>
                  )
                })}
              </div>
            </div>
            {!DOC_PAGE_PRESETS.find((p) => p.id === presetId)?.fixedOrientation && (
              <div className="flex items-center gap-2">
                <Label className="text-[0.75rem]">Orientation</Label>
                <div className="flex overflow-hidden rounded-lg border border-border/60">
                  {(['portrait', 'landscape'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOrientation(o)}
                      className={cn(
                        'px-2.5 py-1 text-[0.71875rem] font-medium capitalize transition-colors',
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
            <div className="space-y-1.5">
              <Label className="text-[0.75rem]">Template</Label>
              <div className="grid grid-cols-4 gap-2">
                {DOC_TEMPLATES.map((t) => (
                  <Tile key={t.id} onClick={() => void createDoc(t.id)}>
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <span className="text-[0.71875rem] font-semibold">{t.label}</span>
                  </Tile>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 'pptx' && (
          <div className="space-y-1.5">
            <Label className="text-[0.75rem]">Template</Label>
            <div className="grid grid-cols-3 gap-3">
              {PPTX_TEMPLATES.map((t) => (
                <Tile key={t.id} onClick={() => void createPptx(t.id)}>
                  <PresentationIcon className="h-6 w-6 text-muted-foreground" />
                  <span className="text-[0.78125rem] font-semibold">{t.label}</span>
                </Tile>
              ))}
            </div>
          </div>
        )}

        {step === 'xlsx' && (
          <div className="space-y-1.5">
            <Label className="text-[0.75rem]">Template</Label>
            <div className="grid grid-cols-3 gap-3">
              {XLSX_TEMPLATES.map((t) => (
                <Tile key={t.id} onClick={() => void createXlsx(t.id)}>
                  <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
                  <span className="text-[0.78125rem] font-semibold">{t.label}</span>
                </Tile>
              ))}
            </div>
          </div>
        )}

        {step === 'web' && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[0.75rem]">Tab name</Label>
              <Input
                autoFocus
                value={name}
                placeholder="New Browser Tab"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[0.75rem]">Starting URL or search</Label>
              <Input
                value={webUrl}
                placeholder="https://en.wikipedia.org/wiki/Physics"
                onChange={(e) => setWebUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createWeb()}
              />
              <p className="text-[0.6875rem] text-muted-foreground">
                You can enter a full URL or any search term — it will open on Wikipedia.
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={createWeb}>Open Browser</Button>
            </div>
          </>
        )}

        {step === 'upload' && (
          <div className="h-56 overflow-hidden rounded-xl border border-dashed border-border/60">
            <PdfDropzone
              onFile={(f) => void createFromAnyUpload(f)}
              converting={converting}
              openingLabel="Upload a PDF, Word, Excel, PowerPoint, or image file"
              accept=".pdf,.docx,.xlsx,.pptx,image/*,.txt,.md"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
