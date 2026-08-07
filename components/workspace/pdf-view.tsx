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
//
// Page nav/notes/zoom/file controls don't float their own pill anymore —
// they're published to usePdfDockStore and rendered from PageControlsMenu in
// the tab bar instead, so reading a PDF doesn't cost any canvas real estate.

import { useCallback, useEffect, useRef, useState, useLayoutEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { attachPdfToPage, type AttachedFile } from '@/lib/store/pdf-attach'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { usePdfDockStore } from '@/lib/store/pdf-dock'
import { getFile } from '@/lib/storage/manager'
import { uid } from '@/lib/scene/types'
import { DocView } from './doc-view'
import { InfiniteCanvas } from './canvas'
import { PdfDropzone } from './pdf-dropzone'
import { usePinchZoom } from '@/hooks/use-pinch-zoom'
import { useTransientHud } from '@/hooks/use-transient-hud'


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
/** Ink world-coordinate width for every PDF page, on every device. The
 *  overlay canvas is laid out at this fixed width and visually scaled to the
 *  page's rendered width — so a stroke drawn on a phone lands on the same
 *  spot of the page on a desktop (the canvas corrects pointer input for
 *  ancestor scale, see toLocal in canvas.tsx). */
const ANNOT_W = 900

function PdfPage({
  doc, n, annotId, active, onCurrent, onFocus,
}: {
  doc: PdfDoc
  n: number
  annotId: string | null
  /** Several PdfPages (and their ink overlays) mount near the viewport at
   *  once, but only the one holding the shell's active target (see
   *  `activeSheetId` below) should answer to the keyboard — see
   *  InfiniteCanvas's `active` prop. */
  active: boolean
  onCurrent: (n: number) => void
  onFocus: (n: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(n <= 2)
  const [aspect, setAspect] = useState(1.414)
  const [hostW, setHostW] = useState(0)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHostW(el.clientWidth))
    ro.observe(el)
    setHostW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

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
      data-pdf-host={n === 1 ? '' : undefined}
      className="relative mx-auto w-full max-w-[900px] overflow-hidden rounded-md bg-white shadow-[0_2px_16px_rgba(0,0,0,0.14)]"
      style={{ aspectRatio: `1 / ${aspect}` }}
      onPointerDownCapture={() => onFocus(n)}
    >
      {near && <canvas ref={canvasRef} className="block h-full w-full" />}
      {annotId && hostW > 0 && (
        // passthrough: ink/objects on the page stay selectable and draggable
        // while empty-area touches still scroll the reader underneath.
        <div className="absolute inset-0 z-10 overflow-hidden">
          <div
            style={{
              width: ANNOT_W,
              height: ANNOT_W * aspect,
              transform: `scale(${hostW / ANNOT_W})`,
              transformOrigin: 'top left',
            }}
          >
            <InfiniteCanvas key={annotId} pageId={annotId} locked transparent passthrough active={active} />
          </div>
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1.5 right-2 z-20 rounded-md bg-black/35 px-1.5 py-0.5 text-[0.625rem] font-medium text-white/90 backdrop-blur-sm">
        {n}
      </span>
    </div>
  )
}

export function PdfView({ pageId }: { pageId: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId))
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
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
  // Transient zoom readout — same language as the board's zoom pill.
  const zoomHud = useTransientHud(zoom)
  const [naturalH, setNaturalH] = useState(0)
  // A single page's true (unscaled) width — every PdfPage shares the same
  // w-full/max-w-[900px] clamp, so any one of them stands in for "the
  // page's natural width" (used by fitWidth below). Reading offsetWidth is
  // unaffected by the transform: scale() zoom applies to contentRef — CSS
  // transforms don't change layout box metrics — so no zoom-division needed.
  const [naturalW, setNaturalW] = useState(0)
  // A single page's true (unscaled) height — same host element as naturalW,
  // just the other axis. naturalH (below) is the whole SCROLLED STACK's
  // height (all pages + gaps), which is what the scroll container needs to
  // know its size — but "full height" has to fit ONE page, or it zooms out
  // to show the entire document instead of filling the viewport with page 1.
  const [pageNaturalH, setPageNaturalH] = useState(0)
  // The reader pane's own viewport size — what fitWidth/fitHeight solve for.
  const [viewW, setViewW] = useState(0)
  const [viewH, setViewH] = useState(0)
  // Which pane last had a pointer down in it owns the real board dock — a
  // page you click on the reader side, or the notes canvas on the other.
  const [focus, setFocus] = useState<'reader' | 'notes'>('reader')
  const inputRef = useRef<HTMLInputElement>(null)
  const splitRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const zoomAnchor = useRef<{ py: number; clientY: number } | null>(null)

const zoomAt = useCallback((_clientX: number, clientY: number, factor: number) => {
  const el = readerRef.current
  if (!el) return
  const rect = el.getBoundingClientRect()
  setZoom((z) => {
    const nz = Math.min(3, Math.max(0.25, z * factor))
    if (nz === z) return z
    // capture the content-space point under the cursor BEFORE zoom changes
    zoomAnchor.current = { py: (clientY - rect.top + el.scrollTop) / z, clientY: clientY - rect.top }
    return nz
  })
}, [])

// Runs synchronously after the DOM updates but before the browser paints —
// so the corrected scrollTop lands in the SAME frame as the new scale,
// instead of one frame later (which is what caused the jump-then-snap).
useLayoutEffect(() => {
  const el = readerRef.current
  const anchor = zoomAnchor.current
  if (!el || !anchor) return
  el.scrollTop = anchor.py * zoom - anchor.clientY
  zoomAnchor.current = null
}, [zoom])

  // Ctrl/⌘+wheel or trackpad pinch zooms the page stack — same gesture as
  // everywhere else in the app. A plain wheel is left alone to scroll.
  useEffect(() => {
    const el = readerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0022))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // Touch: two-finger pinch, the only zoom gesture a phone has. Baseline
  // (zoom, scroll position, original midpoint) is captured once when the
  // fingers land and held fixed for the whole gesture — see usePinchZoom.
  const pinchBaseRef = useRef<{ zoom: number; scrollTop: number; clientY: number } | null>(null)

  const onPinchStart = useCallback(
    (_clientX: number, clientY: number) => {
      const el = readerRef.current
      if (!el) return
      pinchBaseRef.current = { zoom, scrollTop: el.scrollTop, clientY }
    },
    [zoom]
  )

  const onPinchMove = useCallback((ratio: number, _clientX: number, clientY: number) => {
    const el = readerRef.current
    const base = pinchBaseRef.current
    if (!el || !base) return
    const rect = el.getBoundingClientRect()
    const nz = Math.min(3, Math.max(0.25, base.zoom * ratio))
    // Content-space point under the ORIGINAL two-finger midpoint — fixed for
    // the whole gesture. Only the on-screen target (the current midpoint)
    // moves as the fingers move; that's what keeps the same bit of content
    // pinned under the fingers instead of sliding.
    const py = (base.clientY - rect.top + base.scrollTop) / base.zoom
    zoomAnchor.current = { py, clientY: clientY - rect.top }
    setZoom(nz)
  }, [])

  usePinchZoom(readerRef, { onStart: onPinchStart, onMove: onPinchMove })

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

  useEffect(() => {
    const host = readerRef.current?.querySelector<HTMLElement>('[data-pdf-host]')
    if (!host) return
    const ro = new ResizeObserver(() => {
      setNaturalW(host.offsetWidth)
      setPageNaturalH(host.offsetHeight)
    })
    ro.observe(host)
    setNaturalW(host.offsetWidth)
    setPageNaturalH(host.offsetHeight)
    return () => ro.disconnect()
  }, [doc])

  useEffect(() => {
    const el = readerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewW(el.clientWidth)
      setViewH(el.clientHeight)
    })
    ro.observe(el)
    setViewW(el.clientWidth)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const [local, setLocal] = useState<AttachedFile | null>(null)
  const [hydrated, setHydrated] = useState(false)
  // Resolve the page's file via OPFS + manifest (lib/storage/manager.ts),
  // keyed off meta.fileUrl's `opfs:<fileId>` marker — offline-first: getFile
  // checks this device's local OPFS copy before ever touching the network,
  // and re-seeds OPFS from Vercel Blob (durable, cross-device) on a miss, so
  // a second device opening this page for the first time still works. No
  // separate "keep the cloud seed alive" dance needed anymore — Blob
  // storage is already durable, unlike the old 7-day rolling /api/files seed
  // this replaces.
  const fileName = meta?.fileName
  useEffect(() => {
    const fileId = meta?.fileUrl?.startsWith('opfs:') ? meta.fileUrl.slice('opfs:'.length) : null
    if (!fileId) {
      setHydrated(true)
      return
    }
    let dead = false
    void (async () => {
      try {
        const blob = await getFile(fileId)
        if (!blob || dead) return
        setLocal({ url: URL.createObjectURL(blob), name: fileName ?? 'document.pdf', mime: blob.type || 'application/pdf', fileId })
      } finally {
        if (!dead) setHydrated(true)
      }
    })()
    return () => {
      dead = true
    }
  }, [meta?.fileUrl, fileName])
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
    let stored
    try {
      stored = await attachPdfToPage(pageId, f, setConverting)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not convert this file.')
      return
    }
    setLocal(stored)
    setRev((v) => v + 1)
    // attachPdfToPage already wrote the file to OPFS + kicked off its
    // background Blob upload — nothing else to do here.
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

  // Hand this page's controls to PageControlsMenu (in the tab bar) instead of
  // rendering any floating dock chrome of our own — see the file banner.
  useEffect(() => {
    if (!doc) {
      usePdfDockStore.getState().set(null)
      return
    }
    usePdfDockStore.getState().set({
      current,
      numPages: doc.numPages,
      notesOpen,
      linked,
      zoom,
      toggleNotes: openNotes,
      toggleLink: () => setLinked((v) => !v),
      setZoom: (z) => setZoom(Math.min(3, Math.max(0.25, z))),
      fitWidth: () => naturalW > 0 && setZoom(Math.min(3, Math.max(0.25, viewW / naturalW))),
      fitHeight: () => pageNaturalH > 0 && setZoom(Math.min(3, Math.max(0.25, viewH / pageNaturalH))),
      download: () => {
        if (!fileUrl) return
        const a = document.createElement('a')
        a.href = fileUrl
        a.download = meta?.fileName ?? 'document.pdf'
        a.click()
      },
      replace: () => inputRef.current?.click(),
    })
    return () => usePdfDockStore.getState().set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, current, notesOpen, linked, zoom, fileUrl, meta?.fileName, naturalW, naturalH, pageNaturalH, viewW, viewH])

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

  const reader = (
    <div
      ref={readerRef}
      className="relative h-full min-w-0 flex-1 overflow-y-auto bg-muted/40 px-3 py-4 sm:px-6"
      // See doc-view.tsx: without this, native page-zoom competes with
      // usePinchZoom's own two-finger handling on mobile/tablet.
      style={{ touchAction: 'pan-y' }}
      // Only wired while a doc is already loaded — that's the "drop a
      // replacement file anywhere on the reader" gesture. While empty, the
      // PdfDropzone below owns drag-and-drop itself; wiring both here would
      // double-fire attach() on the same drop.
      onDragOver={doc ? (e) => {
        e.preventDefault()
        setDragOver(true)
      } : undefined}
      onDragLeave={doc ? () => setDragOver(false) : undefined}
      onDrop={doc ? (e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files?.[0]
        if (f) void attach(f)
      } : undefined}
    >
      {dragOver && (
        <div className="animate-in fade-in-0 pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)] duration-150">
          <span className="animate-in fade-in-0 zoom-in-95 rounded-lg bg-card px-3 py-1.5 text-[0.75rem] font-semibold shadow duration-150">
            Drop to open
          </span>
        </div>
      )}
      {converting ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-[0.75rem]">{converting}</span>
        </div>
      ) : !doc ? (
        <PdfDropzone onFile={(f) => void attach(f)} openingLabel={fileUrl ? 'Opening…' : undefined} />
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
                active={!!meta?.annotPages?.[i] && meta.annotPages[i] === activeSheetId}
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
            {/* borderless split — the divider is the only seam. The ::after
                pad widens the grab target without widening the seam. */}
            <div
              role="separator"
              aria-label="Resize notes"
              className="relative w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors after:absolute after:inset-y-0 after:-inset-x-1.5 after:content-[''] hover:bg-[var(--accent-blue)]/30 active:bg-[var(--accent-blue)]/50"
              onPointerDown={onDivider}
            />
            <div className="min-w-0 flex-1" onPointerDownCapture={() => setFocus('notes')}>
              {linked ? (
                linkedNoteId ? (
                  <div className="relative h-full w-full bg-background">
                    <InfiniteCanvas key={linkedNoteId} pageId={linkedNoteId} active={activeSheetId === linkedNoteId} />
                    <span className="pointer-events-none absolute left-3 top-2 z-10 text-[0.65625rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      Notes · page {current}
                    </span>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-[0.75rem] text-muted-foreground">
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

      {zoomHud && doc && (
        <div className="glass pointer-events-none absolute bottom-4 right-4 z-30 rounded-full px-3 py-1 font-mono text-[0.6875rem] text-muted-foreground">
          {Math.round(zoom * 100)}%
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
