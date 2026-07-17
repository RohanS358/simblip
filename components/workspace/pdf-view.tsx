'use client'

// PDF/PPT reader page. Upload (or drag-drop) any document — PPT/DOCX/… are
// converted to PDF in the browser (lib/store/to-pdf.ts) — then read it as a
// scrolling stack of pages and mark it up with the pen. Reader pages are for
// READING: no simulations, so the dock here is a purpose-built annotation
// dock, not the board toolbar.
//
// Notes: a side-by-side (borderless) notes doc with the full board toolset;
// LINK mode gives every PDF page its own dedicated note sheet, so you can
// simulate right next to the page you are reading.
//
// The file also uploads to the app database (best-effort) where it lives for
// 10 days, renewed on every read — see app/api/files/[...path]/route.ts.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download, Eraser, FileUp, Highlighter, Link as LinkIcon, Link2Off, Loader2,
  MousePointer2, NotebookPen, Pen, RotateCcw, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getSessionFile, putSessionFile, getSessionBlob } from '@/lib/store/session-files'
import { convertToPdf } from '@/lib/store/to-pdf'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { usePdfAnnotations, type PdfStroke } from '@/lib/store/pdf-annotations'
import { resolveSharedFile } from '@/lib/data/session-upload'
import { getAccessToken } from '@/lib/auth/store'
import * as db from '@/lib/data/db'
import { uid } from '@/lib/scene/types'
import { DocView } from './doc-view'
import { InfiniteCanvas } from './canvas'
import { cn } from '@/lib/utils'

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

type Mode = 'read' | 'pen' | 'hl' | 'eraser'
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b']
const SIZES = [0.002, 0.004, 0.008] // in page-width units

/** One rendered PDF page + its annotation overlay. */
function PdfPage({
  doc, n, pageId, mode, color, size, onCurrent,
}: {
  doc: PdfDoc
  n: number
  pageId: string
  mode: Mode
  color: string
  size: number
  onCurrent: (n: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(n <= 2)
  const [aspect, setAspect] = useState(1.414)
  const strokes = usePdfAnnotations((s) => s.strokes[pageId]?.[n] ?? [])
  const drawing = useRef<number[] | null>(null)
  const [live, setLive] = useState<number[] | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        setNear((v) => v || e.isIntersecting)
        if (e.isIntersecting && e.intersectionRatio > 0.4) onCurrent(n)
      },
      { rootMargin: '800px 0px', threshold: [0, 0.5] }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [n, onCurrent])

  // Render once when the page first comes near the viewport.
  useEffect(() => {
    if (!near) return
    const canvas = canvasRef.current
    if (!canvas) return
    let dead = false
    void (async () => {
      const p = await doc.getPage(n)
      if (dead) return
      const base = p.getViewport({ scale: 1 })
      setAspect(base.height / base.width)
      const width = hostRef.current?.clientWidth || 700
      const scale = (width / base.width) * Math.min(2.5, (window.devicePixelRatio || 1) * 1.6)
      const vp = p.getViewport({ scale })
      canvas.width = vp.width
      canvas.height = vp.height
      const ctx = canvas.getContext('2d')
      if (ctx) await p.render({ canvasContext: ctx, viewport: vp }).promise
    })()
    return () => {
      dead = true
    }
  }, [near, doc, n])

  const norm = (e: React.PointerEvent) => {
    const r = hostRef.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width] as const
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode === 'read') return
    e.stopPropagation()
    e.preventDefault()
    const [x, y] = norm(e)
    if (mode === 'eraser') {
      usePdfAnnotations.getState().eraseAt(pageId, n, x, y, 0.015)
      drawing.current = [] // flag "erasing while moving"
      return
    }
    drawing.current = [x, y]
    setLive([x, y])
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (mode === 'read' || !drawing.current) return
    const [x, y] = norm(e)
    if (mode === 'eraser') {
      usePdfAnnotations.getState().eraseAt(pageId, n, x, y, 0.015)
      return
    }
    drawing.current.push(x, y)
    setLive([...drawing.current])
  }
  const onPointerUp = () => {
    if (drawing.current && drawing.current.length >= 4 && mode !== 'eraser') {
      const stroke: PdfStroke = {
        pts: drawing.current,
        color,
        size: mode === 'hl' ? size * 4 : size,
        hl: mode === 'hl',
      }
      usePdfAnnotations.getState().addStroke(pageId, n, stroke)
    }
    drawing.current = null
    setLive(null)
  }

  const path = (pts: number[]) =>
    pts.reduce((d, v, i) => (i % 2 ? `${d}${v} ` : `${d}${i === 0 ? 'M' : 'L'}${v} `), '')

  return (
    <div
      ref={hostRef}
      className="relative mx-auto w-full max-w-[900px] overflow-hidden rounded-md bg-white shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
      style={{ aspectRatio: `1 / ${aspect}` }}
    >
      {near && <canvas ref={canvasRef} className="block h-full w-full" />}
      {/* annotation layer — interactive only while a pen tool is armed */}
      <svg
        viewBox={`0 0 1 ${aspect}`}
        preserveAspectRatio="none"
        className={cn(
          'absolute inset-0 h-full w-full',
          mode === 'read' ? 'pointer-events-none' : 'touch-none',
          mode === 'pen' || mode === 'hl' ? 'cursor-crosshair' : mode === 'eraser' ? 'cursor-cell' : ''
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {strokes.map((s, i) => (
          <path
            key={i}
            d={path(s.pts)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.size}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={s.hl ? 0.35 : 0.95}
          />
        ))}
        {live && (
          <path
            d={path(live)}
            fill="none"
            stroke={color}
            strokeWidth={mode === 'hl' ? size * 4 : size}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={mode === 'hl' ? 0.35 : 0.95}
          />
        )}
      </svg>
      <span className="pointer-events-none absolute bottom-1.5 right-2.5 text-[10.5px] font-medium text-neutral-500">
        {n}
      </span>
    </div>
  )
}

export function PdfView({ pageId }: { pageId: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.notebooks, pageId))
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [converting, setConverting] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [rev, setRev] = useState(0)
  const [mode, setMode] = useState<Mode>('read')
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(SIZES[1])
  const [current, setCurrent] = useState(1)
  const [notesOpen, setNotesOpen] = useState(false)
  const [linked, setLinked] = useState(false)
  const [notesRatio, setNotesRatio] = useState(0.55)
  const [sharedUrl, setSharedUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const splitRef = useRef<HTMLDivElement>(null)

  const local = getSessionFile(pageId)
  // Fall back to the database copy (another device / after local wipe) —
  // reading it also renews its 10-day retention window.
  useEffect(() => {
    if (local || !meta?.fileUrl) return
    let dead = false
    void resolveSharedFile(meta.fileUrl).then((url) => {
      if (!dead) setSharedUrl(url)
    })
    return () => {
      dead = true
    }
  }, [local, meta?.fileUrl])
  const fileUrl = local?.url ?? sharedUrl

  useEffect(() => {
    if (!fileUrl) return
    let dead = false
    void loadPdfjs().then(async (pdfjs) => {
      try {
        const d = (await pdfjs.getDocument({ url: fileUrl }).promise) as unknown as PdfDoc
        if (!dead) setDoc(d)
      } catch {
        if (!dead) toast.error('Could not open this document.')
      }
    })
    return () => {
      dead = true
      setDoc(null)
    }
  }, [fileUrl, rev])

  const attach = async (f: File) => {
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
    let toStore = f
    if (!(f.type === 'application/pdf' || ext === '.pdf')) {
      setConverting('Converting to PDF…')
      try {
        toStore = await convertToPdf(f, (done, total) => setConverting(`Converting to PDF… ${done}/${total}`))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not convert this file.')
        return
      } finally {
        setConverting(null)
      }
    }
    putSessionFile(pageId, toStore)
    useWorkspaceStore.getState().updatePageMeta(pageId, { fileName: f.name, fileMime: 'application/pdf' })
    if (meta && meta.name.startsWith('Untitled')) useWorkspaceStore.getState().renamePage(pageId, f.name.replace(/\.[^.]+$/, ''))
    setRev((v) => v + 1)
    // Database copy (10-day retention, renewed on read) — best-effort.
    void (async () => {
      try {
        const blob = await getSessionBlob(pageId)
        if (!blob) return
        if (db.dbMode === 'cloud') {
          const path = `notebook/${pageId}`
          const res = await fetch(`/api/files/${path}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${getAccessToken() ?? ''}`,
              'Content-Type': 'application/pdf',
            },
            body: blob,
          })
          if (res.ok) useWorkspaceStore.getState().updatePageMeta(pageId, { fileUrl: `/api/files/${path}` })
        }
      } catch {
        // local copy still works; the cloud copy is a convenience
      }
    })()
  }

  const onCurrent = useCallback((n: number) => setCurrent(n), [])

  // Per-page linked note sheet (created on demand).
  const linkedNoteId = linked
    ? (meta?.notesPages?.[current - 1] || null)
    : null
  const openNotes = () => {
    if (!meta?.docPages?.length)
      useWorkspaceStore.getState().updatePageMeta(pageId, { docPages: [uid()] })
    setNotesOpen((v) => !v)
  }
  useEffect(() => {
    if (notesOpen && linked) useWorkspaceStore.getState().ensureNotesPage(pageId, current)
  }, [notesOpen, linked, current, pageId])

  const onDivider = (e: React.PointerEvent) => {
    e.preventDefault()
    const host = splitRef.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) =>
      setNotesRatio(Math.min(0.8, Math.max(0.25, (ev.clientX - host.left) / host.width)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const ToolBtn = ({
    active, label, onClick, children,
  }: { active?: boolean; label: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'rounded-lg p-1.5 transition-colors hover:bg-accent',
        active ? 'text-[var(--accent-blue)]' : 'text-muted-foreground hover:text-foreground'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )

  const reader = (
    <div
      className="relative h-full min-w-0 flex-1 overflow-y-auto bg-muted/40 px-3 py-4 sm:px-6"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) void attach(f)
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)]">
          <span className="rounded-lg bg-card px-3 py-1.5 text-[12px] font-semibold shadow">Drop to open</span>
        </div>
      )}
      {converting ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-[12px]">{converting}</span>
        </div>
      ) : !doc ? (
        <button
          type="button"
          className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => inputRef.current?.click()}
        >
          <FileUp className="h-8 w-8" />
          <span className="max-w-72 text-center text-[13px] leading-relaxed">
            {fileUrl ? 'Opening…' : (
              <>Upload a PDF or PowerPoint to read here
              <br />
              <span className="text-[11px] opacity-70">
                Click, or drag &amp; drop. PPT/DOCX convert to PDF in your browser. Kept in your
                library for 10 days after the last read.
              </span></>
            )}
          </span>
        </button>
      ) : (
        <div className="flex flex-col gap-4 pb-28">
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage
              key={i + 1}
              doc={doc}
              n={i + 1}
              pageId={pageId}
              mode={mode}
              color={color}
              size={size}
              onCurrent={onCurrent}
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="relative flex h-full w-full flex-col">
      <div ref={splitRef} className="flex min-h-0 flex-1">
        {notesOpen && doc ? (
          <>
            <div style={{ width: `${notesRatio * 100}%` }} className="min-w-0">
              {reader}
            </div>
            {/* borderless split — the divider is the only seam */}
            <div
              role="separator"
              aria-label="Resize notes"
              className="w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent-blue)]/30"
              onPointerDown={onDivider}
            />
            <div className="min-w-0 flex-1">
              {linked ? (
                linkedNoteId ? (
                  <div className="relative h-full w-full bg-background">
                    <InfiniteCanvas key={linkedNoteId} pageId={linkedNoteId} />
                    <span className="pointer-events-none absolute left-3 top-2 z-10 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Notes · page {current}
                    </span>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                    Preparing note page…
                  </div>
                )
              ) : (
                <DocView pageId={pageId} bare />
              )}
            </div>
          </>
        ) : (
          reader
        )}
      </div>

      {/* The reader dock — annotation-only, on purpose. */}
      {doc && (
        <div className="glass-strong absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl px-2 py-1">
          <span className="min-w-14 px-1 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {current}/{doc.numPages}
          </span>
          <ToolBtn label="Read / scroll" active={mode === 'read'} onClick={() => setMode('read')}>
            <MousePointer2 className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn label="Pen" active={mode === 'pen'} onClick={() => setMode('pen')}>
            <Pen className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn label="Highlighter" active={mode === 'hl'} onClick={() => setMode('hl')}>
            <Highlighter className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn label="Eraser" active={mode === 'eraser'} onClick={() => setMode('eraser')}>
            <Eraser className="h-4 w-4" />
          </ToolBtn>
          {(mode === 'pen' || mode === 'hl') && (
            <>
              <span className="mx-0.5 h-5 w-px bg-border" />
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  className={cn('h-4.5 w-4.5 rounded-full border-2', color === c ? 'border-foreground' : 'border-transparent')}
                  style={{ backgroundColor: c, width: 17, height: 17 }}
                  onClick={() => setColor(c)}
                />
              ))}
              <span className="mx-0.5 h-5 w-px bg-border" />
              {SIZES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-label="Stroke size"
                  className={cn('grid h-6 w-5 place-items-center rounded', size === s && 'bg-accent')}
                  onClick={() => setSize(s)}
                >
                  <span className="rounded-full bg-foreground" style={{ width: 3 + SIZES.indexOf(s) * 3, height: 3 + SIZES.indexOf(s) * 3 }} />
                </button>
              ))}
            </>
          )}
          <span className="mx-0.5 h-5 w-px bg-border" />
          <ToolBtn label="Undo stroke" onClick={() => usePdfAnnotations.getState().undoStroke(pageId, current)}>
            <RotateCcw className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn label="Clear this page's ink" onClick={() => usePdfAnnotations.getState().clearPage(pageId, current)}>
            <Trash2 className="h-4 w-4" />
          </ToolBtn>
          <span className="mx-0.5 h-5 w-px bg-border" />
          <ToolBtn label={notesOpen ? 'Close notes' : 'Open notes'} active={notesOpen} onClick={openNotes}>
            <NotebookPen className="h-4 w-4" />
          </ToolBtn>
          {notesOpen && (
            <ToolBtn
              label={linked ? 'Unlink notes from PDF pages' : 'Link: one note page per PDF page'}
              active={linked}
              onClick={() => setLinked((v) => !v)}
            >
              {linked ? <LinkIcon className="h-4 w-4" /> : <Link2Off className="h-4 w-4" />}
            </ToolBtn>
          )}
          <ToolBtn
            label="Download original"
            onClick={() => {
              if (!fileUrl) return
              const a = document.createElement('a')
              a.href = fileUrl
              a.download = meta?.fileName ?? 'document.pdf'
              a.click()
            }}
          >
            <Download className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn label="Replace file" onClick={() => inputRef.current?.click()}>
            <FileUp className="h-4 w-4" />
          </ToolBtn>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.pptx,.ppt,.docx,.txt,.md"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void attach(f)
        }}
      />
    </div>
  )
}
