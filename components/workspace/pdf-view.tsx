'use client'

// PDF/PPT reader page. Upload (or drag-drop) any document — PPT/DOCX/… are
// converted to PDF in the browser (lib/store/to-pdf.ts) — then read it as a
// scrolling stack of pages and mark it up with the pen.
//
// Ink on a page is a REAL InfiniteCanvas overlay (transparent, locked to the
// page — no separate drawing system): whichever page or notes pane you last
// clicked into becomes the shell's active target, so the real board dock
// (Toolbar/Transport) — same pen, same double-tap-for-settings, same
// undo/redo — draws right on top of the page image. See lib/store/workspace
// `annotPages` (one real canvas per PDF page number).
//
// Notes: a side-by-side (borderless) notes doc with the full board toolset;
// LINK mode gives every PDF page its own dedicated note sheet, so you can
// simulate right next to the page you are reading.
//
// The file also uploads to the app database (best-effort) where it lives for
// 7 days, renewed on every read — see app/api/files/[...path]/route.ts.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Download, FileUp, Link as LinkIcon, Link2Off, Loader2,
  NotebookPen, ZoomIn, ZoomOut,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'
import { getSessionFile, putSessionFile, getSessionBlob } from '@/lib/store/session-files'
import { convertToPdf } from '@/lib/store/to-pdf'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
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

/** One rendered PDF page + its real ink overlay (mounted once the page has
 *  an annotation canvas — created on demand the moment it's focused). */
function PdfPage({
  doc, n, annotId, onCurrent, onFocus,
}: {
  doc: PdfDoc
  n: number
  annotId: string | null
  onCurrent: (n: number) => void
  onFocus: (n: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(n <= 2)
  const [aspect, setAspect] = useState(1.414)
  // Only capture the pointer while a drawing tool is armed — in 'select'
  // (the default) the overlay must be a no-op so touch/mouse drag keeps
  // scrolling the reader instead of starting a marquee over the page.
  const drawing = useDocStore((s) => s.tool !== 'select')

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

  return (
    <div
      ref={hostRef}
      className="relative mx-auto w-full max-w-[900px] overflow-hidden rounded-md bg-white shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
      style={{ aspectRatio: `1 / ${aspect}` }}
      onPointerDownCapture={() => onFocus(n)}
    >
      {near && <canvas ref={canvasRef} className="block h-full w-full" />}
      {annotId && (
        <div className={cn('absolute inset-0 z-10', !drawing && 'pointer-events-none')}>
          <InfiniteCanvas key={annotId} pageId={annotId} locked transparent />
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1.5 right-2.5 z-20 text-[10.5px] font-medium text-neutral-500">
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
  const [current, setCurrent] = useState(1)
  const [notesOpen, setNotesOpen] = useState(false)
  const [linked, setLinked] = useState(false)
  const [notesRatio, setNotesRatio] = useState(0.55)
  const [sharedUrl, setSharedUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [naturalH, setNaturalH] = useState(0)
  // Which pane last had a pointer down in it owns the real board dock — a
  // page you click on the reader side, or the notes canvas on the other.
  const [focus, setFocus] = useState<'reader' | 'notes'>('reader')
  const inputRef = useRef<HTMLInputElement>(null)
  const splitRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Ctrl/⌘+wheel or trackpad pinch zooms the page stack — same gesture as
  // everywhere else in the app. A plain wheel is left alone to scroll.
  useEffect(() => {
    const el = readerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setZoom((z) => Math.min(3, Math.max(0.25, z * Math.exp(-e.deltaY * 0.0022))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // CSS `zoom` resizes the layout box instead of just visually magnifying it
  // — pages reflow and ink lands in the wrong place. `transform: scale()` is
  // a pure visual zoom, like zooming into an image, but doesn't reflow, so
  // the scroll container needs to be told how tall the scaled stack really is.
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setNaturalH(el.offsetHeight))
    ro.observe(el)
    setNaturalH(el.offsetHeight)
    return () => ro.disconnect()
  }, [doc])

  const local = getSessionFile(pageId)
  // Fall back to the database copy (another device / after local wipe) —
  // reading it also renews its 7-day retention window.
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
    // Database copy (7-day retention, renewed on read) — best-effort.
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
  const onPageFocus = useCallback((n: number) => {
    setCurrent(n)
    setFocus('reader')
  }, [])

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

  // The shell only mounts the real board dock (Toolbar/Transport) for a PDF
  // page while this is true, targeting whichever pane was last clicked: the
  // current reader page's own ink layer, or an open linked notes sheet.
  // Unlinked notes are a normal doc — DocView manages activeSheetId itself
  // once the notes pane has focus.
  useEffect(() => {
    useWorkspaceStore.setState({ pdfToolsActive: !!doc })
    if (!doc) return
    if (focus === 'reader') {
      const annotId = useWorkspaceStore.getState().ensureAnnotPage(pageId, current)
      useWorkspaceStore.getState().setActiveSheet(annotId)
    } else if (focus === 'notes' && linked && linkedNoteId) {
      useWorkspaceStore.getState().setActiveSheet(linkedNoteId)
    }
  }, [doc, focus, current, pageId, linked, linkedNoteId])

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
      ref={readerRef}
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
                library for 7 days after the last read.
              </span></>
            )}
          </span>
        </button>
      ) : (
        // Spacer reserves the scaled stack's real footprint — see the
        // ResizeObserver effect above.
        <div style={zoom !== 1 ? { height: naturalH * zoom } : undefined}>
          <div
            ref={contentRef}
            className="flex flex-col gap-4 pb-28"
            style={zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: 'top center' } : undefined}
          >
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                doc={doc}
                n={i + 1}
                annotId={meta?.annotPages?.[i] || null}
                onCurrent={onCurrent}
                onFocus={onPageFocus}
              />
            ))}
          </div>
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
            <div className="min-w-0 flex-1" onPointerDownCapture={() => setFocus('notes')}>
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

      {/* The reader dock — page nav, notes, file actions. Drawing lives on
          the real board dock now (see the focus effect above), so this stays
          small and never competes for space with it. */}
      {doc && (
        <div
          className={cn(
            'glass-strong no-scrollbar absolute bottom-4 z-30 flex max-w-[calc(100vw-9rem)] items-center gap-0.5 overflow-x-auto rounded-2xl px-2 py-1',
            !notesOpen && 'left-1/2 -translate-x-1/2'
          )}
          style={notesOpen ? { left: `${(notesRatio * 100) / 2}%`, transform: 'translateX(-50%)' } : undefined}
        >
          <span className="min-w-14 px-1 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {current}/{doc.numPages}
          </span>
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
          <span className="mx-0.5 h-5 w-px bg-border" />
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

      {/* Page zoom — its own corner, clear of the reader dock above. With
          notes open it stays over the READER pane only, so it doesn't land
          on top of the notes doc's own controls on the other side. */}
      {doc && (
        <div
          className={cn(
            'glass-strong absolute bottom-4 z-20 flex items-center gap-1.5 rounded-2xl px-2.5 py-1.5',
            !notesOpen && 'right-4'
          )}
          style={notesOpen ? { right: `calc(${(1 - notesRatio) * 100}% + 0.5rem)` } : undefined}
        >
          <button
            type="button"
            aria-label="Zoom out"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.1))}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <Slider
            className="w-20"
            min={0.25}
            max={3}
            step={0.05}
            value={[zoom]}
            onValueChange={([v]) => setZoom(v)}
          />
          <button
            type="button"
            aria-label="Zoom in"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setZoom((z) => Math.min(3, z + 0.1))}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-9 text-center font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
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
