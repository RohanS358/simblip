// Where a flowing document breaks into pages (§20-22 of the design brief).
//
// The one piece of real layout algorithm in the doc engine. Everything else
// about line breaking, wrapping and paragraph height is the browser's job —
// this function is handed the RESULT of that (block geometry measured off the
// live DOM) and decides only where the page boundaries fall.
//
// ── The model ────────────────────────────────────────────────────────────
// The body is ONE continuous ProseMirror column. It is not sliced into a DOM
// container per page; instead a spacer of the right height is injected at each
// break so the content that follows lands inside the next sheet's content
// area. That keeps editing, the cursor, selection and undo entirely
// ProseMirror's — nothing is ever moved between containers.
//
// So the output here is a list of breaks, each with the spacer height that
// realises it.
//
// ── Coordinates ──────────────────────────────────────────────────────────
// Input geometry is NATURAL: the y positions blocks would have with no
// spacers at all. The caller measures the live (spacered) DOM and subtracts
// the spacer heights it injected, which it knows because it injected them.
// Working in natural coordinates is what makes this function pure, stable
// across re-runs, and testable without a DOM.
//
// Run: node lib/text/paginate.test.mjs

/**
 * @typedef {{top: number, height: number}} LineBox
 *   One line box inside a block, y relative to the block's own top. The caller
 *   gets these free from Range.getClientRects(), which returns exactly one
 *   rect per line — no per-character measuring.
 *
 * @typedef {Object} BlockMetrics
 * @property {number} top      natural y of the block's top (margin box)
 * @property {number} height   natural height of the block (margin box)
 * @property {boolean} [keepWithNext]  don't leave this block orphaned at a
 *   page bottom — a heading glued to the paragraph under it (§21)
 * @property {boolean} [keepTogether]  never split this block across pages
 * @property {boolean} [breakBefore]   an explicit page break (§22)
 * @property {LineBox[]} [lines]  line boxes, for mid-block splitting. A block
 *   with none (an image, a table, a component) can only move as a whole.
 *
 * @typedef {Object} Break
 * @property {number} block    index of the block the break falls at/inside
 * @property {number} line     line index within that block, or 0 for a break
 *   BEFORE the whole block
 * @property {number} spacer   px of vertical space to inject at that point
 *
 * @typedef {Object} Pagination
 * @property {Break[]} breaks
 * @property {number} pageCount
 */

/**
 * @param {BlockMetrics[]} blocks
 * @param {{contentHeight: number, gapHeight: number}} opts
 *   contentHeight = page height minus top and bottom margins.
 *   gapHeight = bottom margin + inter-sheet gap + next top margin, i.e. all
 *   the dead vertical space a spacer has to jump over.
 * @returns {Pagination}
 */
export function paginate(blocks, { contentHeight, gapHeight }) {
  /** @type {Break[]} */
  const breaks = []
  if (!Array.isArray(blocks) || blocks.length === 0 || !(contentHeight > 0)) {
    return { breaks, pageCount: 1 }
  }

  const pageStride = contentHeight + gapHeight
  let pageIdx = 0
  // Total spacer height injected so far. Effective y = natural y + shift.
  let shift = 0
  // Natural y at which the CURRENT page's content area ends.
  let pageBottom = contentHeight
  // Natural y at which the current page's content area starts.
  let pageTop = 0

  /** Records a break at natural y `at`, opening a new page there. */
  const cut = (block, line, at) => {
    // Land `at` exactly on the next page's content top.
    const spacer = Math.max(0, (pageIdx + 1) * pageStride - at - shift)
    breaks.push({ block, line, spacer })
    shift += spacer
    pageIdx += 1
    pageTop = at
    pageBottom = at + contentHeight
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const bottom = b.top + b.height

    if (b.breakBefore && i > 0) {
      cut(i, 0, b.top)
      continue
    }
    if (bottom <= pageBottom) continue

    // The block starts past the page bottom already (its predecessor filled
    // the page exactly) — it simply belongs to the next page.
    if (b.top >= pageBottom) {
      cut(i, 0, b.top)
      continue
    }

    // It straddles the boundary. Prefer splitting it at a line, because that
    // is what a word processor does and it avoids a ragged half-empty page.
    const lines = b.lines ?? []
    const oversized = b.height > contentHeight
    // keepTogether loses to physics: a block taller than a whole page has to
    // split somewhere or it can never be shown.
    const maySplit = lines.length > 1 && (!b.keepTogether || oversized)

    if (maySplit) {
      let cutLine = -1
      for (let l = 1; l < lines.length; l++) {
        if (b.top + lines[l].top + lines[l].height > pageBottom) {
          cutLine = l
          break
        }
      }
      // Also guard the case where line 0 itself overflows: then there is no
      // usable split and the whole block moves.
      if (cutLine > 0) {
        cut(i, cutLine, b.top + lines[cutLine].top)
        // The remainder of this block may still overflow the NEW page (a
        // block several pages tall). Keep cutting it.
        for (let l = cutLine + 1; l < lines.length; l++) {
          if (b.top + lines[l].top + lines[l].height > pageBottom) {
            cut(i, l, b.top + lines[l].top)
          }
        }
        continue
      }
    }

    // Move the whole block. If the block(s) immediately above asked to stay
    // with it, drag them along too — that is `keepWithNext` (§21), and it is
    // resolved by walking backwards from the break, never forwards.
    let at = i
    while (at > 0 && blocks[at - 1].keepWithNext && blocks[at - 1].top > pageTop) at--
    cut(at, 0, blocks[at].top)
    // Dragging predecessors along means blocks at..i now sit on a fresh page
    // and have to be re-examined against it — otherwise a heading pulled down
    // by keepWithNext could leave the paragraph it was glued to unchecked.
    // Only rewind when we actually moved the break; rewinding to `i` itself
    // would re-cut the same block forever.
    if (at < i) i = at - 1
  }

  // A final unsplittable block taller than one page still needs the sheets to
  // exist under it.
  const last = blocks[blocks.length - 1]
  const usedOnLastPage = last.top + last.height - pageTop
  const extra = Math.max(0, Math.ceil(usedOnLastPage / contentHeight) - 1)

  return { breaks, pageCount: pageIdx + 1 + extra }
}
