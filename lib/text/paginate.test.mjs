// Run: node lib/text/paginate.test.mjs
import assert from 'node:assert'
import { paginate } from './paginate.mjs'

const H = 1000 // content height
const GAP = 200 // bottom margin + sheet gap + top margin
const opts = { contentHeight: H, gapHeight: GAP }

/** Blocks stacked contiguously from y=0, each `height` tall. */
const stack = (heights, extra = {}) => {
  let top = 0
  return heights.map((height, i) => {
    const b = { top, height, ...(extra[i] ?? {}) }
    top += height
    return b
  })
}

/** Line boxes for a block of `n` equal lines filling `height`. */
const lines = (n, height) =>
  Array.from({ length: n }, (_, i) => ({ top: (i * height) / n, height: height / n }))

// ── everything fits on one page ──────────────────────────────────────────
{
  const { breaks, pageCount } = paginate(stack([100, 200, 300]), opts)
  assert.deepStrictEqual(breaks, [])
  assert.strictEqual(pageCount, 1)
}

// ── an unsplittable block moves whole to page 2 ──────────────────────────
{
  // 900 fills most of page 1; the 300-tall image cannot split.
  const blocks = stack([900, 300])
  const { breaks, pageCount } = paginate(blocks, opts)
  assert.strictEqual(breaks.length, 1)
  assert.deepStrictEqual({ block: breaks[0].block, line: breaks[0].line }, { block: 1, line: 0 })
  // Block 1 sits naturally at y=900 and must land at the page-2 content top,
  // which is one stride (1200) down.
  assert.strictEqual(breaks[0].spacer, 1200 - 900)
  assert.strictEqual(pageCount, 2)
}

// ── a paragraph splits at the first overflowing line ─────────────────────
{
  // 800 used, then a 400-tall 10-line paragraph: lines are 40px, so lines
  // 0..4 fit (800+200=1000) and line 5 (at y 800+200=1000) is the first over.
  const blocks = stack([800, 400])
  blocks[1].lines = lines(10, 400)
  const { breaks, pageCount } = paginate(blocks, opts)
  assert.strictEqual(breaks.length, 1)
  assert.strictEqual(breaks[0].block, 1)
  assert.strictEqual(breaks[0].line, 5)
  // The break point is natural y 800 + 200 = 1000 → jumps to 1200.
  assert.strictEqual(breaks[0].spacer, 200)
  assert.strictEqual(pageCount, 2)
}

// ── keepTogether forbids the split, so the block moves whole ─────────────
{
  const blocks = stack([800, 400])
  blocks[1].lines = lines(10, 400)
  blocks[1].keepTogether = true
  const { breaks } = paginate(blocks, opts)
  assert.deepStrictEqual({ block: breaks[0].block, line: breaks[0].line }, { block: 1, line: 0 })
  assert.strictEqual(breaks[0].spacer, 1200 - 800)
}

// ── keepTogether loses to a block taller than a whole page ───────────────
{
  const blocks = stack([100, 1500])
  blocks[1].lines = lines(15, 1500) // 100px lines
  blocks[1].keepTogether = true
  const { breaks, pageCount } = paginate(blocks, opts)
  // Page 1 holds y 100..1000 → lines 0..8; line 9 (natural y 100+900=1000) cuts.
  assert.strictEqual(breaks[0].block, 1)
  assert.strictEqual(breaks[0].line, 9)
  assert.strictEqual(pageCount, 2)
}

// ── keepWithNext drags the heading down with its paragraph ───────────────
{
  // heading at 900..960 (fits), paragraph 960..1400 (overflows, unsplittable)
  const blocks = stack([900, 60, 440])
  blocks[1].keepWithNext = true
  const { breaks } = paginate(blocks, opts)
  assert.strictEqual(breaks.length, 1)
  assert.strictEqual(breaks[0].block, 1, 'break moved up to the heading')
  assert.strictEqual(breaks[0].spacer, 1200 - 900)
}

// ── exact fit does not break ─────────────────────────────────────────────
{
  const { breaks, pageCount } = paginate(stack([600, 400]), opts)
  assert.deepStrictEqual(breaks, [])
  assert.strictEqual(pageCount, 1)
}

// ── the block starting exactly at the boundary goes to the next page ─────
{
  const { breaks } = paginate(stack([1000, 50]), opts)
  assert.deepStrictEqual({ block: breaks[0].block, line: breaks[0].line }, { block: 1, line: 0 })
  assert.strictEqual(breaks[0].spacer, 200)
}

// ── an explicit page break always cuts ───────────────────────────────────
{
  const blocks = stack([100, 10, 100])
  blocks[1].breakBefore = true
  const { breaks, pageCount } = paginate(blocks, opts)
  assert.strictEqual(breaks.length, 1)
  assert.deepStrictEqual({ block: breaks[0].block, line: breaks[0].line }, { block: 1, line: 0 })
  assert.strictEqual(breaks[0].spacer, 1200 - 100)
  assert.strictEqual(pageCount, 2)
}

// ── several pages in a row keep landing on content tops ──────────────────
{
  // Six 400-tall unsplittable blocks: 2 per page (800 of 1000), so pages at
  // blocks 2 and 4.
  const { breaks, pageCount } = paginate(stack([400, 400, 400, 400, 400, 400]), opts)
  assert.deepStrictEqual(breaks.map((b) => b.block), [2, 4])
  assert.strictEqual(pageCount, 3)
  // Effective top of block 2 = 800 + spacer0 must equal 1200.
  assert.strictEqual(800 + breaks[0].spacer, 1200)
  // Block 4 natural 1600, shifted by both spacers, must equal 2400.
  assert.strictEqual(1600 + breaks[0].spacer + breaks[1].spacer, 2400)
}

// ── a single block several pages tall gets cut repeatedly ────────────────
{
  const blocks = stack([2500])
  blocks[0].lines = lines(25, 2500) // 100px lines
  const { breaks, pageCount } = paginate(blocks, opts)
  assert.deepStrictEqual(breaks.map((b) => b.line), [10, 20])
  assert.strictEqual(pageCount, 3)
}

// ── a table is unsplittable, so it moves whole ───────────────────────────
// Regression: an imported .docx table straddling a page boundary used to be
// "split" at a row, because getClientRects() over a table returns one rect per
// ROW and those look like line boxes. The spacer realising that split has no
// valid slot in a table (see lineBoxes in pagination-plugin.ts), so the rows
// past the boundary stayed put and hung off the bottom of the sheet. The
// plugin now reports no lines for a table; this pins the resulting behaviour.
{
  // 21 lines of prose, then a 484-tall table that crosses the boundary.
  const blocks = stack([672, 484, 96])
  // No `lines` on the table: that is what the plugin now measures for one.
  const { breaks, pageCount } = paginate(blocks, opts)
  assert.strictEqual(breaks.length, 1)
  assert.deepStrictEqual(
    { block: breaks[0].block, line: breaks[0].line },
    { block: 1, line: 0 },
    'the whole table moves rather than splitting at a row'
  )
  // It must land exactly on page 2's content top, not merely somewhere lower.
  assert.strictEqual(672 + breaks[0].spacer, H + GAP)
  assert.strictEqual(pageCount, 2)
}

// ── an oversized unsplittable block is still placed, not dropped ─────────
// A table taller than a whole page cannot be split by a spacer either. It
// still has to land on a real page and the sheets still have to exist under
// it, even though it overflows its own sheet.
{
  const blocks = stack([100, 1500])
  const { breaks, pageCount } = paginate(blocks, opts)
  assert.deepStrictEqual({ block: breaks[0].block, line: breaks[0].line }, { block: 1, line: 0 })
  assert.strictEqual(100 + breaks[0].spacer, H + GAP, 'lands on page 2 content top')
  assert.ok(pageCount >= 2, 'sheets exist under the oversized block')
}

// ── a bulleted list splits BETWEEN items ─────────────────────────────────
// Regression: <ul> holds <li><p>text</p></li>, so a range over it reports each
// item's own block box AS WELL AS its text line — four single-line items came
// back as EIGHT "lines" at eight distinct tops. paginate() then cut at one of
// the phantom tops, and the spacer realising that cut was anchored inside an
// item's paragraph, where it pushes the text after it down but leaves the <li>
// (marker and first line) on the page above. lineBoxes() now drops rects that
// coincide with a descendant block's border box, so the list reports its four
// REAL lines and the cut lands on an item boundary.
{
  // 800 used, then a 4-item list, 100 per item, crossing the boundary at 1000.
  const blocks = stack([800, 400])
  blocks[1].lines = lines(4, 400) // the four real items, NOT eight phantoms
  const { breaks, pageCount } = paginate(blocks, opts)
  assert.strictEqual(breaks.length, 1)
  assert.strictEqual(breaks[0].block, 1)
  // Items start at natural y 800/900/1000/1100; the first to overflow is #2.
  assert.strictEqual(breaks[0].line, 2, 'cuts at an item, not mid-item')
  // That item must land exactly on page 2's content top.
  assert.strictEqual(800 + 200 + breaks[0].spacer, H + GAP)
  assert.strictEqual(pageCount, 2)
}

// ── a list too tall for one page keeps cutting at item boundaries ────────
{
  const blocks = stack([2000])
  blocks[0].lines = lines(20, 2000) // 20 items, 100 each
  const { breaks, pageCount } = paginate(blocks, opts)
  // Every break must land on a whole item, never between one item's own rects.
  assert.ok(breaks.every((b) => Number.isInteger(b.line) && b.line > 0))
  assert.deepStrictEqual(breaks.map((b) => b.line), [10])
  assert.strictEqual(pageCount, 2)
}

// ── degenerate input ─────────────────────────────────────────────────────
assert.deepStrictEqual(paginate([], opts), { breaks: [], pageCount: 1 })
assert.deepStrictEqual(paginate(stack([100]), { contentHeight: 0, gapHeight: 0 }), {
  breaks: [],
  pageCount: 1,
})

console.log('paginate: all checks passed')
