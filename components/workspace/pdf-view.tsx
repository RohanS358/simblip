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

import { BounceLoader } from '@/components/ui/bounce-loader'
import { useCallback, useEffect, useRef, useState, useLayoutEffect } from 'react'
import { toast } from 'sonner'
import { attachPdfToPage, type AttachedFile } from '@/lib/store/pdf-attach'
import { CONVERTIBLE } from '@/lib/store/to-pdf'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { usePdfDockStore } from '@/lib/store/pdf-dock'
import { useTocStore } from '@/lib/store/toc'
import { getFile } from '@/lib/storage/manager'
import { uid } from '@/lib/scene/types'
import { cn } from '@/lib/utils'
import { DocView } from './doc-view'
import { InfiniteCanvas } from './canvas'
import { PdfDropzone } from './pdf-dropzone'
import { usePinchZoom } from '@/hooks/use-pinch-zoom'
import { useTransientHud } from '@/hooks/use-transient-hud'


/**
 * Does this pdf-kind page still hold an un-converted source document?
 *
 * A .docx opens as a pdf-kind page (open-file.ts), and so does anything else
 * to-pdf.ts can render, so the page's file is whatever was uploaded until the
 * first open converts it. attachPdfToPage stamps `fileMime: 'application/pdf'`
 * on the page once it has — that stamp, not the file name (which keeps its
 * original extension), is what stops this from repeating forever.
 *
 * The `.pdf` name check covers pages stored before fileMime was recorded:
 * without it a real PDF with no mime would be sent to convertToPdf, which
 * refuses `.pdf` and would surface a spurious error.
 */
function needsPdfConversion(fileName?: string, fileMime?: string): boolean {
  if (fileMime === 'application/pdf') return false
  const ext = fileName ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase() : ''
  if (ext === '.pdf') return false
  return (CONVERTIBLE as readonly string[]).includes(ext)
}

type PdfDoc = {
  numPages: number
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number }
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
  }>
  getOutline: () => Promise<any[] | null>
  getDestination: (id: string) => Promise<any[] | null>
  getPageIndex: (dest: any) => Promise<number>
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
      data-pdf-page-num={n}
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
      <span className="pointer-events-none absolute bottom-1.5 right-2 z-20 rounded-md bg-black/35 px-1.5 py-0.5 text-ui-2xs font-medium text-white/90 backdrop-blur-sm">
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
    const host = readerRef.current?.querySelector<HTMLElement>('[data-pdf-page-num]')
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
  const fileMime = meta?.fileMime
  useEffect(() => {
    const metaFileUrl = meta?.fileUrl
    if (!metaFileUrl) {
      setHydrated(true)
      return
    }
    let dead = false
    if (metaFileUrl.startsWith('opfs:')) {
      const fileId = metaFileUrl.slice('opfs:'.length)
      void (async () => {
        try {
          const blob = await getFile(fileId)
          if (!blob || dead) return
          // A .docx opens as a pdf-kind page (see open-file.ts), so on first
          // open the bytes here are still the Word file. Hand it to the same
          // attach pipeline a dropped .docx already uses: it converts, stores
          // the PDF durably and repoints this page's fileUrl at it, so later
          // opens — and other devices — find a real PDF with nothing to redo.
          // (Repointing fileUrl re-runs this effect; the guard is false the
          // second time round because attachPdfToPage stamps fileMime.)
          if (needsPdfConversion(fileName, fileMime)) {
            try {
              const stored = await attachPdfToPage(
                pageId,
                new File([blob], fileName ?? 'document', { type: fileMime || blob.type }),
                setConverting
              )
              if (!dead) setLocal(stored)
            } catch (err) {
              if (!dead) toast.error(err instanceof Error ? err.message : 'Could not convert this document to PDF.')
            }
            return
          }
          setLocal({ url: URL.createObjectURL(blob), name: fileName ?? 'document.pdf', mime: blob.type || 'application/pdf', fileId })
        } finally {
          if (!dead) setHydrated(true)
        }
      })()
      return () => {
        dead = true
      }
    }
    // Not an opfs: reference — this device doesn't own the source file
    // (e.g. a board rendering a presented pdf-kind page). Resolve the
    // shareable URL session-upload.ts stamped instead — same fallback
    // components/objects/file-view.tsx already uses for file objects.
    void import('@/lib/data/session-upload')
      .then(({ resolveSharedFile }) => resolveSharedFile(metaFileUrl))
      .then((url) => {
        if (!dead) setSharedUrl(url)
      })
      .finally(() => {
        if (!dead) setHydrated(true)
      })
    return () => {
      dead = true
    }
  }, [meta?.fileUrl, fileName])
  const fileUrl = local?.url ?? sharedUrl

  const [tocEntries, setTocEntries] = useState<{ pageNum: number; title: string; level: number }[]>([])

  useEffect(() => {
    if (!doc) {
      setTocEntries([])
      return
    }
    let dead = false
    void (async () => {
      try {
        const outline = await doc.getOutline()
        if (!outline || outline.length === 0) {
          if (!dead) setTocEntries([])
          return
        }
        const entries: { pageNum: number; title: string; level: number }[] = []
        const processItems = async (items: any[], level = 0) => {
          for (const item of items) {
            let pageIndex = -1
            if (typeof item.dest === 'string') {
              const dest = await doc.getDestination(item.dest)
              if (dest) pageIndex = await doc.getPageIndex(dest[0])
            } else if (Array.isArray(item.dest)) {
              pageIndex = await doc.getPageIndex(item.dest[0])
            }
            if (pageIndex >= 0 && pageIndex < doc.numPages) {
              entries.push({ pageNum: pageIndex + 1, title: item.title, level })
            }
            if (item.items && item.items.length > 0) {
              await processItems(item.items, level + 1)
            }
          }
        }
        await processItems(outline)
        if (!dead) setTocEntries(entries)
      } catch {
        if (!dead) setTocEntries([])
      }
    })()
    return () => {
      dead = true
    }
  }, [doc])

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
      scrollToPage: (pageNum: number) => scrollToPage(pageNum),
    })
    return () => usePdfDockStore.getState().set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, current, notesOpen, linked, zoom, fileUrl, meta?.fileName, naturalW, naturalH, pageNaturalH, viewW, viewH])

  // The outline is a left-rail SECTION now (components/toc-panel.tsx), not a
  // second column this view draws beside the sidebar.
  useEffect(() => {
    useTocStore.getState().set(
      tocEntries.length > 0
        ? {
            entries: tocEntries.map((e) => ({
              index: e.pageNum,
              title: e.title,
              level: e.level ?? 0,
              locator: `p.${e.pageNum}`,
            })),
            current,
            goTo: (pageNum: number) => scrollToPage(pageNum),
          }
        : null
    )
    return () => useTocStore.getState().set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tocEntries, current])

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

  const scrollToPage = (pageNum: number) => {
    const el = readerRef.current
    if (!el) return
    const host = el.querySelector<HTMLElement>(`[data-pdf-page-num="${pageNum}"]`)
    if (host) {
      host.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setCurrent(pageNum)
    }
  }

  // ── Reading position ──────────────────────────────────────────────────────
  // Where you were in a PDF is part of the page, not of this component: a
  // reader that always reopens at page 1 makes a long document unusable.
  //
  // It is stored as {page, offset-within-that-page} rather than a scrollTop,
  // because scrollTop is meaningless the moment the zoom or the window size
  // changes — the same pixel lands on a different page. Page + fraction is
  // stable across both.

  /** Read the live position off the DOM: the topmost page still crossing the
   *  viewport top, and how far into it we are. */
  const readScrollPos = useCallback((): { page: number; offset: number } | null => {
    const el = readerRef.current
    if (!el) return null
    const hosts = el.querySelectorAll<HTMLElement>('[data-pdf-page-num]')
    const top = el.getBoundingClientRect().top
    let best: { page: number; offset: number } | null = null
    for (const host of Array.from(hosts)) {
      const r = host.getBoundingClientRect()
      if (r.height <= 0) continue
      if (r.top - top <= 1) best = {
        page: Number(host.dataset.pdfPageNum),
        offset: Math.min(1, Math.max(0, (top - r.top) / r.height)),
      }
      else break // hosts are in document order; the first one below the fold ends it
    }
    return best
  }, [])

  // Persist on a debounce while scrolling (and once on unmount, so closing the
  // tab straight after a scroll still records where you were).
  const savedPosRef = useRef<{ page: number; offset: number } | null>(null)
  useEffect(() => {
    const el = readerRef.current
    if (!el || !doc) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const save = () => {
      timer = null
      const pos = readScrollPos()
      if (!pos) return
      const prev = savedPosRef.current
      if (prev && prev.page === pos.page && Math.abs(prev.offset - pos.offset) < 0.01) return
      savedPosRef.current = pos
      useWorkspaceStore.getState().updatePageMeta(pageId, { pdfScroll: pos })
    }
    const onScroll = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 300)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (timer) clearTimeout(timer)
      save()
    }
  }, [doc, pageId, readScrollPos])

  // Restore once per opened document. Waits for the target page host to have
  // real height — pages are virtualised and start at an assumed aspect ratio,
  // so scrolling before layout settles lands in the wrong place.
  const restoredRef = useRef<string | null>(null)
  useEffect(() => {
    if (!doc) return
    const saved = findPageMeta(useWorkspaceStore.getState().nodes, pageId)?.pdfScroll
    if (!saved || saved.page <= 1 && saved.offset === 0) {
      restoredRef.current = pageId
      return
    }
    if (restoredRef.current === pageId) return
    restoredRef.current = pageId
    let tries = 0
    const attempt = () => {
      const el = readerRef.current
      const host = el?.querySelector<HTMLElement>(`[data-pdf-page-num="${saved.page}"]`)
      if (el && host && host.offsetHeight > 0) {
        // offsetTop/offsetHeight are LAYOUT metrics — unaffected by the
        // contentRef `transform: scale()` zoom — while scrollTop lives in
        // scaled space, so the target has to be multiplied back up.
        el.scrollTop = (host.offsetTop + host.offsetHeight * saved.offset) * zoom
        setCurrent(saved.page)
        return
      }
      if (tries++ < 40) requestAnimationFrame(attempt)
    }
    requestAnimationFrame(attempt)
    // `zoom` is read inside attempt() but deliberately not a dependency:
    // restoredRef makes this run exactly once per opened document, and
    // re-running it on a later zoom change would yank the reader back to the
    // saved spot mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageId])

  const reader = (
    <div className="relative flex h-full w-full min-w-0 flex-1 overflow-hidden">
      <div
        ref={readerRef}
        className="relative h-full min-w-0 flex-1 overflow-y-auto bg-muted/40 px-3 pb-4 pt-[104px] sm:px-6"
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
            <span className="animate-in fade-in-0 zoom-in-95 rounded-lg bg-card px-3 py-1.5 text-ui-sm font-semibold shadow duration-150">
              Drop to open
            </span>
          </div>
        )}
        {converting ? (
          <div className="flex h-full flex-col items-center justify-center">
            <BounceLoader size={200} label={converting} />
          </div>
        ) : !doc ? (
          <PdfDropzone onFiles={(f) => void attach(f[0])} openingLabel={fileUrl ? 'Opening…' : undefined} />
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
                    <span className="pointer-events-none absolute left-3 top-2 z-10 text-ui-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Notes · page {current}
                    </span>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-ui-sm text-muted-foreground">
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
        <div className="glass pointer-events-none absolute bottom-4 right-4 z-30 rounded-full px-3 py-1 font-mono text-ui-xs text-muted-foreground">
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
