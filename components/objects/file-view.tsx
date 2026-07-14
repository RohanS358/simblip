'use client'

// Session document element — a PDF VIEWER AND CONVERTER. One full page at a
// time, rendered by pdf.js onto a high-DPI canvas (crisp at any whiteboard
// zoom, no browser viewer chrome). Presentations and documents (pptx, docx,
// txt…) are converted to PDF IN THE BROWSER (lib/store/to-pdf.ts — no server
// binary, so it works on Vercel) and then flow through the exact same
// pipeline, so everything ends up a PDF. The content is pointer-inert:
// clicking/dragging the body selects and moves the element like any other
// object; ONLY the floating control bar is interactive. Files are
// session-only, never saved.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileUp, Loader2, Maximize2, Minimize2, Rows3, Square } from 'lucide-react'
import { toast } from 'sonner'
import { getSessionFile, putSessionFile } from '@/lib/store/session-files'
import { convertToPdf } from '@/lib/store/to-pdf'
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
  const [converting, setConverting] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  /** Expanded: every page laid out top-to-bottom and scrollable, instead of
   *  one page at a time. Reading a whole handout beats clicking through it. */
  const [expanded, setExpanded] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
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

  /** Attach a file. Anything that isn't already a PDF or an image is
   *  converted to PDF in the browser first, so the viewer only ever
   *  renders PDFs (and slide nav / the phone remote keep working). */
  const attach = async (f: File) => {
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
    const alreadyViewable =
      f.type === 'application/pdf' || ext === '.pdf' || f.type.startsWith('image/')

    let toStore: File = f
    if (!alreadyViewable) {
      setConverting('Converting to PDF…')
      try {
        toStore = await convertToPdf(f, (done, total) =>
          setConverting(`Converting to PDF… ${done}/${total}`)
        )
        toast.success(`Converted ${f.name} to PDF`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not convert this file to PDF.')
        return
      } finally {
        setConverting(null)
      }
    }

    putSessionFile(object.id, toStore)
    docRef.current = null
    setNumPages(0)
    setPage(1)
    setRev((n) => n + 1)
  }

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

  // Expanded view: render every page into its own canvas, stacked vertically.
  // Done once per document (not per frame), so scrolling stays cheap.
  useEffect(() => {
    const doc = docRef.current
    const strip = stripRef.current
    if (!expanded || !doc || !strip || numPages === 0) return
    let dead = false
    void (async () => {
      strip.innerHTML = ''
      const width = strip.clientWidth || 600
      for (let n = 1; n <= doc.numPages; n++) {
        if (dead) return
        const p = await doc.getPage(n)
        const base = p.getViewport({ scale: 1 })
        const fit = width / base.width
        const scale = fit * Math.min(3, (window.devicePixelRatio || 1) * 2)
        const vp = p.getViewport({ scale })
        const c = document.createElement('canvas')
        c.width = vp.width
        c.height = vp.height
        c.style.width = '100%'
        c.style.height = 'auto'
        c.style.display = 'block'
        c.style.marginBottom = '10px'
        c.style.borderRadius = '4px'
        c.style.boxShadow = '0 1px 6px rgba(0,0,0,.14)'
        const ctx = c.getContext('2d')
        if (!ctx) continue
        await p.render({ canvasContext: ctx, viewport: vp }).promise
        if (dead) return
        strip.appendChild(c)
      }
    })()
    return () => {
      dead = true
    }
  }, [expanded, numPages, rev])

  // Render exactly ONE page, oversampled 2× past devicePixelRatio so it
  // stays sharp when the whiteboard zooms the element up.
  useEffect(() => {
    const doc = docRef.current
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!doc || !canvas || !box || numPages === 0 || expanded) return
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
        // NOT pointer-inert any more: drag-and-drop events don't fire on
        // elements with pointer-events:none. Pointer events still BUBBLE to the
        // object wrapper, so clicking or dragging the body selects and moves
        // the element exactly as before — nothing here stops propagation.
        className={cn(
          'relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border bg-white shadow-sm transition-colors dark:bg-neutral-900',
          dragOver ? 'border-2 border-dashed border-[var(--accent-blue)]' : 'border-border/60'
        )}
        // Drop a file straight onto the window — the same pipeline as the
        // attach button, so a .pptx dropped here is converted just the same.
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void attach(f)
        }}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)]">
            <span className="rounded-lg bg-card px-3 py-1.5 text-[12px] font-semibold shadow">
              Drop to open
            </span>
          </div>
        )}
        {converting ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-[12px]">{converting}</span>
          </div>
        ) : !file ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <FileUp className="h-6 w-6" />
            <span className="px-4 text-center text-[12px] leading-relaxed">
              {object.name || 'Attach a document, slide deck or image'}
              <br />
              <span className="text-[10.5px] opacity-70">
                PDF, PowerPoint (.pptx), Word (.docx), text or image — anything that
                isn&apos;t a PDF is converted to one right here in your browser.
                Session-only, never saved to the cloud.
              </span>
            </span>
          </div>
        ) : isPdf && expanded ? (
          <div
            ref={stripRef}
            className="pointer-events-auto h-full w-full overflow-y-auto p-2"
            // The strip scrolls, so it must swallow the wheel — otherwise the
            // whiteboard would zoom underneath it.
            onWheel={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
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
        {isPdf && numPages > 0 && !expanded && (
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
        {isPdf && numPages > 0 && (
          <button
            type="button"
            aria-label={expanded ? 'Show one page at a time' : 'Expand — show every page'}
            title={expanded ? 'Single page' : 'Expand all pages'}
            aria-pressed={expanded}
            className={cn(
              'rounded-lg p-1.5 hover:bg-accent',
              expanded ? 'text-[var(--accent-blue)]' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Square className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}
          </button>
        )}
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
        accept=".pdf,image/*,.pptx,.docx,.txt,.md,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = '' // let the same file be re-picked after an error
          if (f) void attach(f)
        }}
      />
    </div>
  )
}
