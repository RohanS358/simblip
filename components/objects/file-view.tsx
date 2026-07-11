'use client'

// Session document element — one full PDF page at a time, rendered by
// pdf.js onto a high-DPI canvas (crisp at any whiteboard zoom, no browser
// viewer chrome). The content is pointer-inert: clicking/dragging the body
// selects and moves the element like any other object; ONLY the floating
// control bar is interactive. Files are session-only, never saved.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileUp, Maximize2, Minimize2 } from 'lucide-react'
import { getSessionFile, putSessionFile } from '@/lib/store/session-files'
import { cn } from '@/lib/utils'
import type { ObjectRendererProps } from './types'

// pdf.js is loaded lazily on first use so it never weighs down the notebook.
type PdfDoc = {
  numPages: number
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number }
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
  }>
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null
const loadPdfjs = () => {
  pdfjsPromise ??= import('pdfjs-dist').then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString()
    return mod
  })
  return pdfjsPromise
}

export function FileObject({ object }: ObjectRendererProps) {
  const [page, setPage] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [rev, setRev] = useState(0) // bumps when a file is (re)attached
  const [fs, setFs] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<PdfDoc | null>(null)

  // Local attachment first; else a copy shared by the presenter (bucket URL
  // or demo-db data URL stamped into metadata at present-time).
  const local = getSessionFile(object.id)
  const [shared, setShared] = useState<{ url: string; name: string; mime: string } | null>(null)
  const sharedUrl = object.metadata.fileUrl as string | undefined
  useEffect(() => {
    if (local || !sharedUrl) return
    let dead = false
    void import('@/lib/data/session-upload').then(({ resolveSharedFile }) =>
      resolveSharedFile(sharedUrl).then((url) => {
        if (!dead && url)
          setShared({
            url,
            name: (object.metadata.fileName as string) ?? 'Document',
            mime: (object.metadata.fileMime as string) ?? 'application/pdf',
          })
      })
    )
    return () => {
      dead = true
    }
  }, [local, sharedUrl, object.metadata.fileName, object.metadata.fileMime])

  const file = local ?? shared
  const isPdf = file?.mime === 'application/pdf' || (file?.name.toLowerCase().endsWith('.pdf') ?? false)
  const isImage = file?.mime.startsWith('image/') ?? false

  // Open the document.
  useEffect(() => {
    if (!file || !isPdf) return
    let dead = false
    void loadPdfjs().then(async (pdfjs) => {
      const doc = (await pdfjs.getDocument({ url: file.url }).promise) as unknown as PdfDoc
      if (dead) return
      docRef.current = doc
      setNumPages(doc.numPages)
      setPage(1)
    })
    return () => {
      dead = true
      docRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, file?.url, isPdf])

  // Render exactly ONE page, oversampled 2× past devicePixelRatio so it
  // stays sharp when the whiteboard zooms the element up.
  useEffect(() => {
    const doc = docRef.current
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!doc || !canvas || !box || numPages === 0) return
    let dead = false
    void (async () => {
      const p = await doc.getPage(Math.min(page, doc.numPages))
      if (dead) return
      const base = p.getViewport({ scale: 1 })
      const fit = Math.min(box.clientWidth / base.width, box.clientHeight / base.height) || 1
      const scale = fit * Math.min(3, (window.devicePixelRatio || 1) * 2)
      const vp = p.getViewport({ scale })
      canvas.width = vp.width
      canvas.height = vp.height
      canvas.style.width = `${base.width * fit}px`
      canvas.style.height = `${base.height * fit}px`
      const ctx = canvas.getContext('2d')
      if (ctx) await p.render({ canvasContext: ctx, viewport: vp }).promise
    })()
    return () => {
      dead = true
    }
  }, [page, numPages, rev, fs, object.size.w, object.size.h])

  // Teacher's phone remote (board presentations): page the document without
  // anyone touching the board. No objectId targets every viewer on the page.
  useEffect(() => {
    const onRemote = (e: Event) => {
      const d = (e as CustomEvent).detail as { dir: number; objectId?: string }
      if (d.objectId && d.objectId !== object.id) return
      setPage((p) => Math.max(1, Math.min(numPages || 1, p + d.dir)))
    }
    window.addEventListener('simblip-remote-pdf', onRemote)
    return () => window.removeEventListener('simblip-remote-pdf', onRemote)
  }, [numPages, object.id])

  // Fullscreen presentation: track state, re-render at the bigger size and
  // page with the arrow keys while it's up.
  useEffect(() => {
    const onChange = () => setFs(document.fullscreenElement === boxRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  useEffect(() => {
    if (!fs) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((p) => Math.min(numPages, p + 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((p) => Math.max(1, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fs, numPages])

  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation()

  return (
    <div className="relative h-full w-full">
      {/* Body is pointer-inert: clicks fall through to the object wrapper,
          so the element selects and drags — never the document. */}
      <div
        ref={boxRef}
        className="pointer-events-none relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm dark:bg-neutral-900"
      >
        {!file ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileUp className="h-6 w-6" />
            <span className="px-4 text-center text-[12px] leading-relaxed">
              {object.name || 'Attach a PDF or image'}
              <br />
              <span className="text-[10.5px] opacity-70">
                Session-only — never saved to the cloud. PowerPoint? Export it as PDF first.
              </span>
            </span>
          </div>
        ) : isPdf ? (
          <canvas ref={canvasRef} className="max-h-full max-w-full" />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={file.name} className="h-full w-full select-none object-contain" draggable={false} />
        ) : (
          <div className="px-4 text-center text-[12px] text-muted-foreground">
            {file.name}: this format can't be shown inline — export it as PDF and re-attach.
          </div>
        )}

        {/* Page nav sits mid-left / mid-right — where thumbs and presenters
            actually reach (children may re-enable pointer events). */}
        {isPdf && numPages > 0 && (
          <>
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              className={cn(
                'glass-strong pointer-events-auto absolute left-1.5 top-1/2 z-10 -translate-y-1/2 rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25',
                fs ? 'p-3' : 'p-1.5'
              )}
              onPointerDown={stop}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className={fs ? 'h-6 w-6' : 'h-4 w-4'} />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= numPages}
              className={cn(
                'glass-strong pointer-events-auto absolute right-1.5 top-1/2 z-10 -translate-y-1/2 rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-25',
                fs ? 'p-3' : 'p-1.5'
              )}
              onPointerDown={stop}
              onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            >
              <ChevronRight className={fs ? 'h-6 w-6' : 'h-4 w-4'} />
            </button>
          </>
        )}

        {/* Fullscreen keeps counter + exit at the bottom. */}
        {fs && (
          <div className="glass-strong pointer-events-auto absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl px-3 py-1.5">
            {isPdf && numPages > 0 && (
              <span className="min-w-14 text-center font-mono text-[12.5px] tabular-nums">
                {page} / {numPages}
              </span>
            )}
            <button
              type="button"
              aria-label="Exit fullscreen"
              className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => void document.exitFullscreen?.()}
            >
              <Minimize2 className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>

      {/* Floating controls — the ONLY interactive part of the element. */}
      <div
        className="glass-strong absolute -bottom-11 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl px-1.5 py-1"
        onPointerDown={stop}
        onDoubleClick={stop}
      >
        {isPdf && numPages > 0 && (
          <span className="min-w-12 text-center font-mono text-[11px] tabular-nums">
            {page} / {numPages}
          </span>
        )}
        <button
          type="button"
          aria-label="Attach or replace file"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => inputRef.current?.click()}
        >
          <FileUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Fullscreen"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => void boxRef.current?.requestFullscreen?.()}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/*,.pptx,.ppt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            putSessionFile(object.id, f)
            docRef.current = null
            setNumPages(0)
            setPage(1)
            setRev((n) => n + 1)
          }
        }}
      />
    </div>
  )
}
