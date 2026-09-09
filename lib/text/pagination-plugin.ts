// The bridge between the live DOM and lib/text/paginate.mjs.
//
// Measures the flowing body's top-level blocks, asks paginate() where the page
// boundaries fall, and injects a spacer widget at each one so the text that
// follows lands inside the next sheet's content area. Re-runs on every
// document change and on container resize; nothing is measured during a
// keystroke's own transaction (see the rAF batching below), so typing stays
// at the editor's normal cost.
//
// Two kinds of spacer, because a break can land in two kinds of place:
//
//   BETWEEN blocks   → a block-level widget, plain vertical space.
//   INSIDE a block   → an inline widget with `display:block`. Placed at the
//     position where an overflowing LINE starts, it takes its own line box
//     and pushes the rest of the paragraph down — which is exactly a
//     mid-paragraph page break, and is why a long paragraph continues onto
//     the next page instead of jumping to it whole.
//
// Line positions come from Range.getClientRects(), which returns one rect per
// line box for an inline range. That single call is the whole line-measuring
// story — there is no per-character probing anywhere in this file.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { paginate, type Break } from './paginate.mjs'
import { formatOf } from './extensions'

export interface PageGeometry {
  /** Page height minus top and bottom margins. */
  contentHeight: number
  /** Bottom margin + inter-sheet gap + next top margin — all the dead space
   *  a spacer has to jump over to reach the next content area. */
  gapHeight: number
  /** The CSS scale the body's wrapper is rendered at — below 1 whenever the
   *  sheets are clamped to a narrow viewport.
   *
   *  Every number above is in PAGE pixels (96dpi, the space SHEET_W/H live
   *  in), but getBoundingClientRect answers in SCREEN pixels, which are the
   *  page ones multiplied by this. Dividing the measurements back out is what
   *  keeps pagination correct on a phone; the two spaces coincide at scale 1,
   *  which is exactly why this was invisible on a desktop pane. */
  scale: number
}

export const paginationKey = new PluginKey<DecorationSet>('pagination')

/** Everything the plugin needs from its host, read fresh on each pass so a
 *  page-size or margin change takes effect without rebuilding the editor. */
export interface PaginationOptions {
  geometry: () => PageGeometry
  /** Reports how many sheets the body now needs (so DocView can append them)
   *  and which top-level block each page starts at — the latter is what
   *  .docx export uses to put Word's page breaks where ours are. */
  onPaginate: (result: { pageCount: number; startBlocks: number[] }) => void
}

interface Measured {
  top: number
  height: number
  keepWithNext?: boolean
  keepTogether?: boolean
  breakBefore?: boolean
  lines?: { top: number; height: number }[]
  /** Viewport y (at measure time) of each line's middle — see lineBoxes. */
  liveTops?: number[]
  /** ProseMirror position of the block's start, for mapping breaks back. */
  pos: number
}

/** Line boxes of a textblock in NATURAL coordinates — y relative to the
 *  block's own top, as the paragraph would wrap with NO page spacers in it.
 *
 *  Measured with this block's own spacers momentarily hidden, which is the
 *  only way to get a stable answer. A mid-paragraph spacer is a block-level
 *  element, so it FORCES a line break where it sits: measuring around it
 *  yields a different set of lines than the unbroken paragraph has, the next
 *  pass computes a break one line off, that changes the lines again, and the
 *  two states alternate forever — a live-locked editor, which is what a
 *  paragraph longer than a page used to do. Hiding them costs two forced
 *  reflows on at most one block per page, and makes paginate()'s input a
 *  fixed point of its own output.
 *
 *  Returns undefined for a block with nothing to split (an image, a table, a
 *  page break), which paginate() treats as unsplittable. */
function lineBoxes(
  view: EditorView,
  el: HTMLElement,
  scale: number,
  innerBreaks: { line: number; spacer: number }[]
): { lines: { top: number; height: number }[]; liveTops: number[] } | undefined {
  if (!el.firstChild) return undefined
  const spacers = [...el.querySelectorAll<HTMLElement>('.doc-page-spacer')]
  const restore = spacers.map((sp) => sp.style.display)
  for (const sp of spacers) sp.style.display = 'none'

  let rects: DOMRect[] = []
  let base = 0
  try {
    const range = view.dom.ownerDocument.createRange()
    range.selectNodeContents(el)
    // Reading getClientRects() here is the forced reflow that applies the
    // display:none above.
    rects = Array.from(range.getClientRects()).filter((r) => r.height > 0)
    base = el.getBoundingClientRect().top
    range.detach?.()
  } catch {
    return undefined
  } finally {
    spacers.forEach((sp, i) => {
      sp.style.display = restore[i]
    })
  }
  if (rects.length < 2) return undefined

  // Rects can arrive out of order and can overlap (nested inline elements
  // report their own box as well as the line's). Collapse to distinct lines
  // by top edge, which is what "one rect per line" means in practice.
  const byTop = new Map<number, { top: number; height: number }>()
  for (const r of rects) {
    const top = Math.round((r.top - base) / scale)
    const prev = byTop.get(top)
    const height = r.height / scale
    if (!prev || height > prev.height) byTop.set(top, { top, height })
  }
  const lines = [...byTop.values()].sort((a, b) => a.top - b.top)
  if (lines.length < 2) return undefined

  // Viewport y of each line's middle in the LIVE (spacered) layout, which is
  // the space posAtCoords hit-tests in. A spacer only translates everything
  // below it, so mapping natural → live is a running sum, not a re-measure.
  const sorted = [...innerBreaks].sort((a, b) => a.line - b.line)
  const liveTops = lines.map((l, i) => {
    const shift = sorted.reduce((acc, b) => (b.line <= i ? acc + b.spacer : acc), 0)
    return base + (l.top + shift + l.height / 2) * scale
  })
  return { lines, liveTops }
}

/** Reads the natural geometry of every top-level block. `shiftBefore` undoes
 *  the spacers already in the DOM from the previous pass — paginate() works
 *  in spacer-free coordinates (see its header). */
function measure(view: EditorView, prev: Break[], scale: number): Measured[] {
  const out: Measured[] = []
  const doc = view.state.doc
  const containerTop = view.dom.getBoundingClientRect().top
  // Cumulative spacer height injected before each block index last pass.
  const shiftAt: number[] = []
  {
    let acc = 0
    let bi = 0
    const sorted = [...prev].sort((a, b) => a.block - b.block || a.line - b.line)
    for (let i = 0; i < doc.childCount; i++) {
      while (bi < sorted.length && sorted[bi].block < i) acc += sorted[bi++].spacer
      shiftAt[i] = acc
      // A break INSIDE block i shifts everything after it, but not its own top.
      while (bi < sorted.length && sorted[bi].block === i) acc += sorted[bi++].spacer
    }
  }

  let pos = 0
  doc.forEach((node, offset, index) => {
    pos = offset
    const el = view.nodeDOM(offset) as HTMLElement | null
    if (!el || !(el instanceof HTMLElement)) return
    const rect = el.getBoundingClientRect()
    const fmt = formatOf({ type: node.type.name, attrs: node.attrs })
    // The block's own inner spacers are subtracted inside lineBoxes(), and
    // the ones before it by shiftAt — so `top`, `height` and every line are
    // in the spacer-free coordinates paginate() documents.
    const innerBreaks = prev.filter((b) => b.block === index && b.line > 0)
    const innerSpacers = innerBreaks.reduce((acc, b) => acc + b.spacer, 0)
    const measuredLines = lineBoxes(view, el, scale, innerBreaks)
    out.push({
      // BORDER box, not margin box, and screen → page pixels (see
      // PageGeometry.scale). Deliberately excluding the vertical margins is
      // what suppresses space-before at the top of a page and space-after at
      // the bottom, exactly as a word processor does: a page that begins with
      // a heading starts at the margin, not 20px below it. Nothing is lost by
      // it — the following block's own top already sits past this one's
      // trailing space, so the fitting test still sees the real gap.
      top: (rect.top - containerTop) / scale - shiftAt[index],
      height: rect.height / scale - innerSpacers,
      keepWithNext: fmt.keepWithNext,
      keepTogether: fmt.keepTogether,
      breakBefore: node.type.name === 'pageBreak',
      lines: measuredLines?.lines,
      liveTops: measuredLines?.liveTops,
      pos: offset,
    })
  })
  void pos
  return out
}

/** Maps a break onto the ProseMirror position its spacer is anchored at, and
 *  builds the decoration. A line break inside a block resolves through
 *  posAtCoords, which is ProseMirror's own hit-test — no offset arithmetic. */
function decorationFor(view: EditorView, br: Break, blocks: Measured[]): Decoration | null {
  const block = blocks[br.block]
  if (!block) return null

  if (br.line === 0) {
    return Decoration.widget(block.pos, () => spacerEl(br.spacer, 'block'), {
      side: -1,
      key: `pb-${br.block}-0-${br.spacer}`,
    })
  }

  const el = view.nodeDOM(block.pos) as HTMLElement | null
  const y = block.liveTops?.[br.line]
  if (!el || y === undefined) return null
  const at = view.posAtCoords({ left: el.getBoundingClientRect().left + 1, top: y })
  if (!at) return null
  return Decoration.widget(at.pos, () => spacerEl(br.spacer, 'inline'), {
    side: -1,
    key: `pb-${br.block}-${br.line}-${br.spacer}`,
  })
}

function spacerEl(height: number, mode: 'block' | 'inline'): HTMLElement {
  const el = document.createElement('span')
  el.className = 'doc-page-spacer'
  el.setAttribute('aria-hidden', 'true')
  el.contentEditable = 'false'
  el.style.display = 'block'
  el.style.height = `${height}px`
  el.style.pointerEvents = 'none'
  if (mode === 'inline') el.style.width = '100%'
  return el
}

export function paginationPlugin({ geometry, onPaginate }: PaginationOptions) {
  let breaks: Break[] = []
  let scheduled = 0
  let lastKey = ''
  // Every answer produced since the last real change. Applying decorations
  // re-triggers this pass, so the pass has to be a fixed point — and while
  // measure() is now spacer-independent (see lineBoxes), a two-state cycle
  // would freeze the editor outright rather than merely looking wrong. This
  // is the backstop that makes that impossible: revisiting an answer means
  // the search is going in circles, so stop and keep what is on screen.
  // ponytail: a Set of JSON keys, fine at one entry per page; if pagination
  // ever gets more states than that, hash them.
  let seen = new Set<string>()

  const run = (view: EditorView) => {
    const geo = geometry()
    if (!(geo.contentHeight > 0)) return
    const blocks = measure(view, breaks, geo.scale || 1)
    const result = paginate(blocks, geo)
    // The geometry is part of the key: a page-size, margin or scale change
    // legitimately produces a different answer, and without it an answer
    // already seen under the OLD geometry would suppress the new one.
    const key = JSON.stringify([geo.contentHeight, geo.gapHeight, geo.scale, result.breaks])
    if (key === lastKey) return
    if (seen.has(key)) return
    seen.add(key)
    lastKey = key
    breaks = result.breaks
    onPaginate({
      pageCount: result.pageCount,
      // A break that falls INSIDE a block cannot be expressed as "this page
      // starts at block n", so it is not reported — Word simply repaginates
      // that one boundary itself.
      startBlocks: result.breaks.filter((b) => b.line === 0).map((b) => b.block),
    })

    const decos: Decoration[] = []
    for (const br of result.breaks) {
      const d = decorationFor(view, br, blocks)
      if (d) decos.push(d)
    }
    view.dispatch(view.state.tr.setMeta(paginationKey, DecorationSet.create(view.state.doc, decos)))
  }

  const schedule = (view: EditorView) => {
    if (scheduled) return
    scheduled = requestAnimationFrame(() => {
      scheduled = 0
      if (view.isDestroyed) return
      run(view)
    })
  }

  return new Plugin<DecorationSet>({
    key: paginationKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, value) => tr.getMeta(paginationKey) ?? value.map(tr.mapping, tr.doc),
    },
    props: {
      decorations: (state) => paginationKey.getState(state),
    },
    view: (view) => {
      const ro = new ResizeObserver(() => {
        // A width change re-wraps every line, so every previous answer is void.
        lastKey = ''
        seen = new Set()
        schedule(view)
      })
      ro.observe(view.dom)
      schedule(view)
      return {
        update: (_view, prevState) => {
          // A real edit invalidates the search, not just the last answer.
          if (!prevState.doc.eq(view.state.doc)) {
            lastKey = ''
            seen = new Set()
          }
          schedule(view)
        },
        destroy: () => {
          ro.disconnect()
          if (scheduled) cancelAnimationFrame(scheduled)
        },
      }
    },
  })
}

/** The Tiptap wrapper. A real Extension, not a bare object literal — Tiptap
 *  reads `config`, `name` and the storage/command hooks off every entry in
 *  `extensions`, and a plain object silently produces an editor that never
 *  finishes initialising. */
export const PaginationExtension = Extension.create<PaginationOptions>({
  name: 'pagination',
  addOptions() {
    return {
      geometry: () => ({ contentHeight: 0, gapHeight: 0, scale: 1 }),
      onPaginate: () => {},
    }
  },
  addProseMirrorPlugins() {
    return [paginationPlugin(this.options)]
  },
})
