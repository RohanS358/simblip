'use client'

// Presentation page: the SAME sheet-of-SceneObjects engine as doc-view.tsx
// (a slide IS a docPages entry — plain scene-object canvas content, edited
// with the exact same tools/objects/drag-drop as a Document) laid out as a
// slide deck instead of a scrolling document: a slide-list rail down the
// side, one slide shown at a time, and a Present button for a fullscreen
// slideshow. doc-view.tsx itself is untouched — this is a separate
// component built on the same underlying page-content primitives, not a
// variant grafted onto it.
//
// Import parses an uploaded .pptx's slide XML into SceneObjects on first
// open (lib/store/pptx-import.ts) — best-effort fidelity, not pixel-perfect.
// Export walks the slide object trees back into a real .pptx via pptxgenjs.

import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { getFile } from '@/lib/storage/manager'
import { usePresentationDockStore } from '@/lib/store/presentation-dock'
import { InfiniteCanvas } from './canvas'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function PresentOverlay({
  slides,
  startAt,
  onClose,
  sheetColors,
}: {
  slides: string[]
  startAt: number
  onClose: () => void
  sheetColors?: Record<string, string>
}) {
  const [i, setI] = useState(startAt)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === ' ') setI((v) => Math.min(slides.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length, onClose])

  const slideId = slides[i]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <button
        type="button"
        aria-label="Exit presentation"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex flex-1 items-center justify-center p-8">
        {slideId && (
          <div
            className="relative aspect-video w-full max-w-[1400px] overflow-hidden rounded-md bg-white shadow-2xl"
            style={{ backgroundColor: sheetColors?.[slideId] }}
          >
            <InfiniteCanvas key={slideId} pageId={slideId} locked passthrough viewer active={false} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-4 pb-6 text-white">
        <button
          type="button"
          aria-label="Previous slide"
          className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30"
          disabled={i === 0}
          onClick={() => setI((v) => Math.max(0, v - 1))}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="font-mono text-[0.8125rem] tabular-nums">
          {i + 1} / {slides.length}
        </span>
        <button
          type="button"
          aria-label="Next slide"
          className="rounded-full p-2 hover:bg-white/10 disabled:opacity-30"
          disabled={i === slides.length - 1}
          onClick={() => setI((v) => Math.min(slides.length - 1, v + 1))}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

export function PresentationView({ pageId }: { pageId: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId))
  const slides = meta?.docPages ?? []
  const [current, setCurrent] = useState(0)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const importedRef = useRef(false)

  const fileUrl = meta?.fileUrl
  useEffect(() => {
    if (slides.length > 0 || importedRef.current) return
    const fileId = fileUrl?.startsWith('opfs:') ? fileUrl.slice('opfs:'.length) : null
    if (!fileId) {
      // No source file (or already-empty deck) — start with one blank slide.
      importedRef.current = true
      useWorkspaceStore.getState().addDocSheet(pageId)
      return
    }
    importedRef.current = true
    setImporting(true)
    void (async () => {
      try {
        const blob = await getFile(fileId)
        if (!blob) throw new Error('missing file')
        const { useAuthStore } = await import('@/lib/auth/store')
        const ownerId = useAuthStore.getState().profile?.id ?? 'anon'
        const { importPptx } = await import('@/lib/store/pptx-import')
        const imported = await importPptx(blob, ownerId)
        const { useDocStore } = await import('@/lib/store/document')
        const sheetColors: Record<string, string> = {}
        for (const slide of imported.length ? imported : [{ objects: [] }]) {
          const slideId = useWorkspaceStore.getState().addDocSheet(pageId)
          for (const obj of slide.objects) useDocStore.getState().addObject(slideId, obj)
          if (slide.background) sheetColors[slideId] = slide.background
        }
        if (Object.keys(sheetColors).length) {
          useWorkspaceStore.getState().updatePageMeta(pageId, { sheetColors })
        }
      } catch {
        toast.error('Could not read this presentation — starting blank.')
        useWorkspaceStore.getState().addDocSheet(pageId)
      } finally {
        setImporting(false)
      }
    })()
  }, [slides.length, fileUrl, pageId])

  const removeSlide = (slideId: string) => {
    if (slides.length <= 1) return
    useWorkspaceStore.getState().updatePageMeta(pageId, { docPages: slides.filter((id) => id !== slideId) })
    void import('@/lib/store/document').then(({ useDocStore }) => useDocStore.getState().forgetPage(slideId))
    setCurrent((c) => Math.max(0, Math.min(c, slides.length - 2)))
  }

  const exportPptx = async () => {
    setExporting(true)
    try {
      const { useDocStore } = await import('@/lib/store/document')
      const { exportPptx: doExport } = await import('@/lib/store/pptx-export')
      const slideContents = slides.map((id) => useDocStore.getState().pages[id]?.objects ?? {})
      const backgrounds = slides.map((id) => meta?.sheetColors?.[id])
      const blob = await doExport(slideContents, backgrounds)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${meta?.name ?? 'presentation'}.pptx`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      toast.error('Could not export this presentation.')
    } finally {
      setExporting(false)
    }
  }

  const activeSlideId = slides[current]

  // Toolbar buttons (Present/Export/New slide) publish to the shared
  // tab-bar dock instead of floating their own chrome — same pattern
  // doc-view.tsx/pdf-view.tsx use. The slide-thumbnail rail stays inline
  // here (page-navigation UI, not a toolbar control), matching how PdfView
  // keeps its own page thumbnails/notes pane inline while only its button
  // controls move to the dock.
  useEffect(() => {
    usePresentationDockStore.getState().set({
      current,
      numSlides: slides.length,
      exporting,
      importing,
      present: () => setPresenting(true),
      exportPptx: () => void exportPptx(),
      addSlide: () => {
        useWorkspaceStore.getState().addDocSheet(pageId)
        setCurrent(slides.length)
      },
    })
    return () => usePresentationDockStore.getState().set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, slides.length, exporting, importing, pageId])

  return (
    <div className="flex h-full w-full">
      <div className="flex w-40 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border/60 bg-muted/30 p-2">
        {slides.map((id, i) => (
          <button
            key={id}
            type="button"
            onClick={() => setCurrent(i)}
            className={cn(
              'group relative aspect-video w-full shrink-0 overflow-hidden rounded-md border bg-white text-left',
              i === current ? 'border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/30' : 'border-border/60'
            )}
            style={{ backgroundColor: meta?.sheetColors?.[id] }}
          >
            <span className="absolute left-1 top-1 z-10 rounded bg-black/40 px-1 text-[0.5625rem] font-semibold text-white">
              {i + 1}
            </span>
            {slides.length > 1 && (
              <span
                role="button"
                aria-label="Delete slide"
                className="absolute right-1 top-1 z-10 rounded bg-black/40 p-0.5 text-white opacity-0 hover:bg-destructive group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  removeSlide(id)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </span>
            )}
          </button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => {
            useWorkspaceStore.getState().addDocSheet(pageId)
            setCurrent(slides.length)
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Slide
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-6">
          {importing ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-[0.75rem]">Importing presentation…</span>
            </div>
          ) : activeSlideId ? (
            <div
              className="relative aspect-video w-full max-w-[960px] overflow-hidden rounded-md bg-white shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
              style={{ backgroundColor: meta?.sheetColors?.[activeSlideId] }}
            >
              <InfiniteCanvas key={activeSlideId} pageId={activeSlideId} locked passthrough active />
            </div>
          ) : null}
        </div>
      </div>

      {presenting && (
        <PresentOverlay
          slides={slides}
          startAt={current}
          onClose={() => setPresenting(false)}
          sheetColors={meta?.sheetColors}
        />
      )}
    </div>
  )
}
