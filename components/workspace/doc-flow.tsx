'use client'

// The Word-style flowing body of a doc page.
//
// A doc page has TWO independent layers stacked on the same sheets:
//
//   object layer  — the existing per-sheet InfiniteCanvas. Absolutely
//                   positioned images, drawings, graphs, SimScript, DSA,
//                   simulations. Free, untethered, and NEVER moved by text.
//   flow layer    — this file. One continuous ProseMirror column spanning
//                   every sheet, wrapping and repaginating as you type, with
//                   no text box to draw first.
//
// That split is deliberate and is the whole design: Word's ease for prose,
// the notebook's freedom for everything else. Text reflowing must never
// relocate a component the author placed by hand, so the flow knows nothing
// about objects and objects know nothing about the flow.
//
// ── How it is drawn ──────────────────────────────────────────────────────
// The column is ONE element overlaying the sheet stack, not one container per
// page. Page boundaries are produced by spacer widgets injected by
// lib/text/pagination-plugin.ts, sized so the text after each break lands
// inside the next sheet's content area. Nothing is ever moved between DOM
// containers, so the cursor, selection, undo and IME are ProseMirror's
// unmodified behaviour.
//
// ── How it is layered ────────────────────────────────────────────────────
// z-index 1 here vs. z-index 2 on each sheet's canvas wrapper: the flow paints
// above the sheet's paper background and below the objects, so an image placed
// over a paragraph covers it, as it would in Word. Clicks are the mirror image
// — the canvas hands empty space back (its `clickThrough` prop) so a click on
// blank paper puts a caret here.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { docExtensions } from '@/lib/text/extensions'
import { PaginationExtension, type PageGeometry } from '@/lib/text/pagination-plugin'
import { parseDoc, serializeDoc, type PmDoc } from '@/lib/text/pm'
import { useDocStore } from '@/lib/store/document'
import { useActiveTextEditor } from '@/lib/store/text-editor'
import { cn } from '@/lib/utils'

/** 1 inch at 96dpi on every side — Word's "Normal" margins, and the reason
 *  SHEET_W/H are kept in 96dpi px in lib/scene/frames.ts. */
export const DOC_MARGINS = { top: 96, right: 96, bottom: 96, left: 96 }

/** Where the live layout engine broke each page, as top-level block indices,
 *  per doc page id. Published by the body and read imperatively by .docx
 *  export, which needs to put Word's page breaks where ours are but has no
 *  handle on the editor. A plain module Map rather than a store: nothing
 *  RENDERS from it, so a subscription would only cost re-renders. */
const pageBreakStarts = new Map<string, number[]>()

export const flowPageStarts = (pageId: string): number[] => pageBreakStarts.get(pageId) ?? []

export interface DocMargins {
  top: number
  right: number
  bottom: number
  left: number
}

interface Frame {
  /** Offset of sheet 0 within the doc's content column, unscaled layout px. */
  left: number
  top: number
  /** The sheet's TRUE page size in page px (before any narrow-screen clamp). */
  pageW: number
  pageH: number
  /** rendered width / pageW — the same visual downscale a clamped Sheet
   *  applies to its own canvas, so the body shrinks with the paper instead of
   *  overflowing it on a phone. */
  scale: number
  /** Vertical space between two sheets, converted into page px. */
  gap: number
}

export function DocFlow({
  pageId,
  containerRef,
  sheetIds,
  margins = DOC_MARGINS,
  editable = true,
  onPageCount,
}: {
  /** The DOC page's own content id — its flow lives at
   *  useDocStore.pages[pageId].flow, an id otherwise unused by a doc page
   *  (the sheets are separate content pages under `docPages`). */
  pageId: string
  /** The element the sheets are laid out in; the overlay positions itself
   *  against it and measures the sheets inside it. */
  containerRef: React.RefObject<HTMLDivElement | null>
  sheetIds: string[]
  margins?: DocMargins
  editable?: boolean
  /** How many sheets the body now needs. DocView appends to reach it. */
  onPageCount?: (count: number) => void
}) {
  const setFlow = useDocStore((s) => s.setFlow)
  const ensurePage = useDocStore((s) => s.ensurePage)
  const registerEditor = useActiveTextEditor((s) => s.set)
  const clearEditor = useActiveTextEditor((s) => s.clear)
  // The bridge is keyed by object id; the body is not an object, so it takes
  // a namespaced key that can never collide with one.
  const editorKey = `flow:${pageId}`
  const [frame, setFrame] = useState<Frame | null>(null)
  const [focused, setFocused] = useState(false)
  // React attaches a PARENT's ref after its children's layout effects have
  // already run, so containerRef.current is still null on this component's
  // first layout pass — measuring there and giving up would leave the body
  // permanently unrendered. Flipping a state flag after mount forces one more
  // render, by which point the parent's ref is definitely attached.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Read ONCE, imperatively: subscribing to `flow` and feeding it back as
  // editor content would reset the document (and the caret) on every
  // keystroke this editor itself caused. Same guard as TiptapArea.
  //
  // Only what is ALREADY resident is read here — bringing the page in from
  // the archive is a store write, and doing that during render (which is when
  // a useMemo body runs) updates every other component subscribed to the doc
  // store mid-render. The effect below does the loading and hands the content
  // over once.
  const initial = useMemo(
    () => parseDoc(useDocStore.getState().pages[pageId]?.flow ?? ''),
    [pageId]
  )
  const loadedRef = useRef<string | null>(null)

  // ── Geometry ───────────────────────────────────────────────────────────
  // Measured off the live sheets rather than recomputed from the store: the
  // sheets are flex children inside a `w-fit` column with their own
  // max-width clamp, so their real position is something only layout knows.
  // offsetTop/offsetLeft (not getBoundingClientRect) because the container
  // carries the doc's zoom transform and these stay in unscaled layout px.
  const geometryRef = useRef<PageGeometry>({ contentHeight: 0, gapHeight: 0, scale: 1 })
  const measure = useCallback(() => {
    const host = containerRef.current
    if (!host) return
    const sheets = host.querySelectorAll<HTMLElement>('[data-sheet]')
    const first = sheets[0]
    if (!first) return
    // The sheet's aspectRatio is set from its TRUE size, so height/width
    // recovers the scale without reaching into DocView's own state.
    const pageW = Number(first.dataset.pageW) || first.offsetWidth
    const pageH = Number(first.dataset.pageH) || first.offsetHeight
    const scale = first.offsetWidth / pageW || 1
    const second = sheets[1]
    const gapPx = second ? second.offsetTop - first.offsetTop - first.offsetHeight : 16
    const next: Frame = {
      left: first.offsetLeft,
      top: first.offsetTop,
      pageW,
      pageH,
      scale,
      gap: gapPx / scale,
    }
    setFrame((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.pageW === next.pageW &&
      prev.pageH === next.pageH &&
      prev.scale === next.scale &&
      prev.gap === next.gap
        ? prev
        : next
    )
  }, [containerRef])

  useLayoutEffect(() => {
    measure()
    const host = containerRef.current
    if (!host) return
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    for (const el of host.querySelectorAll('[data-sheet]')) ro.observe(el)
    return () => ro.disconnect()
  }, [measure, containerRef, sheetIds.length, mounted])

  geometryRef.current = frame
    ? {
        contentHeight: Math.max(0, frame.pageH - margins.top - margins.bottom),
        gapHeight: margins.bottom + frame.gap + margins.top,
        scale: frame.scale,
      }
    : { contentHeight: 0, gapHeight: 0, scale: 1 }

  // Latest callback without rebuilding the editor.
  const pageCountRef = useRef(onPageCount)
  pageCountRef.current = onPageCount

  const editor = useEditor(
    {
      extensions: [
        ...docExtensions({ placeholder: 'Start writing…' }),
        // Geometry is read through refs on every pass, so a page-size or
        // margin change takes effect without rebuilding the editor.
        PaginationExtension.configure({
          geometry: () => geometryRef.current,
          onPaginate: ({ pageCount, startBlocks }: { pageCount: number; startBlocks: number[] }) => {
            pageBreakStarts.set(pageId, startBlocks)
            pageCountRef.current?.(pageCount)
          },
        }),
      ],
      content: initial as unknown as Record<string, unknown>,
      editable,
      immediatelyRender: false,
      onUpdate: ({ editor: ed }) => {
        setFlow(pageId, serializeDoc(ed.getJSON() as unknown as PmDoc))
      },
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
    [pageId]
  )

  // Bring the page in from the archive and, if that produced content the
  // editor was created without, install it. Once per page: a later run would
  // overwrite whatever the author has typed since.
  useEffect(() => {
    if (!editor || loadedRef.current === pageId) return
    loadedRef.current = pageId
    ensurePage(pageId)
    const stored = useDocStore.getState().pages[pageId]?.flow
    if (stored && stored !== serializeDoc(editor.getJSON() as unknown as PmDoc)) {
      editor.commands.setContent(parseDoc(stored) as unknown as Record<string, unknown>, {
        emitUpdate: false,
      })
    }
  }, [editor, ensurePage, pageId])

  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editor, editable])

  // Page geometry changed (the pane was resized, the sheets got clamped, the
  // margins were edited). The pagination plugin re-runs on document changes
  // and on its own element resizing, and neither of those happens here — the
  // body's LAYOUT width is unchanged, only the scale it is painted at — so it
  // has to be nudged explicitly.
  useEffect(() => {
    if (!editor || !frame) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, frame])

  // Publish to the same handle the inspector's text controls already use, so
  // bold/size/colour/alignment work on the body with no new wiring — but only
  // while the body actually holds focus, or it would steal the panel from a
  // selected text object on the canvas.
  useEffect(() => {
    if (!focused || !editor) return
    registerEditor(editorKey, editor as Editor)
    return () => clearEditor(editorKey)
  }, [focused, editor, editorKey, registerEditor, clearEditor])

  // Images in the body carry `opfs:<fileId>` in data-src, which no browser
  // can fetch — resolve each one to a blob URL once it appears. See DocImage
  // in lib/text/extensions.ts for why this is not a React NodeView.
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    const urls: string[] = []
    const resolve = async () => {
      const pending = [...editor.view.dom.querySelectorAll<HTMLImageElement>('img[data-src]')].filter(
        (img) => !img.src && img.dataset.src?.startsWith('opfs:')
      )
      if (pending.length === 0) return
      const { getFile } = await import('@/lib/storage/manager')
      for (const img of pending) {
        const blob = await getFile(img.dataset.src!.slice('opfs:'.length))
        if (cancelled) return
        if (!blob) continue
        const url = URL.createObjectURL(blob)
        urls.push(url)
        img.src = url
      }
    }
    void resolve()
    editor.on('update', resolve)
    return () => {
      cancelled = true
      editor.off('update', resolve)
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [editor])

  if (!frame) return null

  return (
    <div
      className="absolute"
      style={{
        left: frame.left,
        top: frame.top,
        width: frame.pageW,
        transform: frame.scale === 1 ? undefined : `scale(${frame.scale})`,
        transformOrigin: 'top left',
        // Above the sheets' paper, below their canvases (which sit at z-2).
        zIndex: 1,
        // Only the writing column takes clicks; the rest of the sheet has to
        // stay available to the canvas above and the page chrome below.
        pointerEvents: 'none',
      }}
    >
      <div
        className="tiptap-editor doc-flow pointer-events-auto"
        style={{
          marginLeft: margins.left,
          marginTop: margins.top,
          width: Math.max(0, frame.pageW - margins.left - margins.right),
          // A full page's worth of clickable body from the start: without it
          // an empty document is one line tall and there is nothing to click
          // on the rest of the paper, which is exactly the "no text box to
          // draw first" promise this layer exists to keep.
          minHeight: geometryRef.current.contentHeight,
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}


// ── Capture ──────────────────────────────────────────────────────────────
// PDF export rasterizes each [data-sheet] element on its own, but the body is
// ONE column overlaying the whole stack — so from a single sheet's point of
// view the text is not inside it and would export blank.
//
// The fix is a clone per sheet, clipped to that sheet's content area and
// scrolled to that sheet's slice of the column. It works because pagination
// has already guaranteed where the slices fall: page i's content begins at
// exactly `i * (contentHeight + gapHeight)` in column coordinates — that is
// the invariant cut() maintains in lib/text/paginate.mjs — so the offset is
// arithmetic rather than another measurement pass.

/**
 * Temporarily paints the flowing body inside each sheet so a per-sheet
 * rasterizer sees it. Returns the undo function; ALWAYS call it, including on
 * failure, or the document is left with duplicated static copies of its text.
 */
export function cloneFlowIntoSheets(container: HTMLElement, margins: DocMargins = DOC_MARGINS): () => void {
  const column = container.querySelector<HTMLElement>('.doc-flow')
  const wrapper = column?.parentElement
  if (!column || !wrapper) return () => {}

  const sheets = [...container.querySelectorAll<HTMLElement>('[data-sheet]')]
  const first = sheets[0]
  if (!first) return () => {}
  const pageH = Number(first.dataset.pageH) || first.offsetHeight
  const second = sheets[1]
  const scale = first.offsetWidth / (Number(first.dataset.pageW) || first.offsetWidth) || 1
  const gapPx = second ? (second.offsetTop - first.offsetTop - first.offsetHeight) / scale : 16
  const contentHeight = Math.max(0, pageH - margins.top - margins.bottom)
  const stride = contentHeight + margins.bottom + gapPx + margins.top

  const added: HTMLElement[] = []
  sheets.forEach((sheet, i) => {
    // The sheet's inner true-pixel box — the same coordinate space the sheet's
    // own canvas lives in, so page px mean the same thing here as in the
    // column. Identified by the transform the Sheet applies to it.
    const inner = sheet.querySelector<HTMLElement>('[data-sheet-inner]') ?? sheet.firstElementChild?.firstElementChild
    if (!(inner instanceof HTMLElement)) return
    const clip = document.createElement('div')
    clip.dataset.flowCapture = 'true'
    clip.style.cssText = `position:absolute;left:${margins.left}px;top:${margins.top}px;width:${column.offsetWidth}px;height:${contentHeight}px;overflow:hidden;pointer-events:none;z-index:1`
    const clone = column.cloneNode(true) as HTMLElement
    clone.style.margin = '0'
    clone.style.position = 'relative'
    clone.style.top = `${-i * stride}px`
    // A cloned contenteditable would still be focusable and would carry the
    // caret/selection styling into the export.
    for (const el of clone.querySelectorAll('[contenteditable]')) el.removeAttribute('contenteditable')
    clip.appendChild(clone)
    inner.appendChild(clip)
    added.push(clip)
  })

  const prevVisibility = wrapper.style.visibility
  wrapper.style.visibility = 'hidden'
  return () => {
    for (const el of added) el.remove()
    wrapper.style.visibility = prevVisibility
  }
}
