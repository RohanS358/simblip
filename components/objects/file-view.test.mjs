// Regression tests for the FileView floating action bar and the XLSX grid's
// icon sprite — GitHub #2 and #6.
//
// Both bugs were invisible to the type checker and to every existing test:
// one was a CSS anchor typo, the other a vendored asset that was simply never
// copied into the repo. They are checked here by reading the real source and
// the real file tree, so neither can silently come back.
//
// Run directly:  node components/objects/file-view.test.mjs

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')

// ── #2: the floating action bar must be centred ───────────────────────────
//
// It read `absolute right-1/2 ... -translate-x-1/2`, which anchors the bar's
// RIGHT edge to the midpoint and then shifts it a further half-width left —
// so it rendered a full half-width off-centre (and clipped, on mobile).
// `left-1/2` + `-translate-x-1/2` is the correct centring pair.
{
  const src = readFileSync(path.join(__dirname, 'file-view.tsx'), 'utf8')

  // NB: pick the FLOATING bar specifically. The exit-fullscreen bar above it
  // is also `glass-strong absolute ... -translate-x-1/2`, and matching that one
  // instead made this assertion vacuously pass while the real bar was broken.
  const bars = src
    .split('\n')
    .filter((l) => l.includes('glass-strong') && l.includes('-translate-x-1/2') && l.includes('absolute'))
  assert.ok(bars.length >= 1, 'could not find any centred glass bar')
  const bar = bars.find((l) => l.includes('pointer-events-auto') && l.includes('gap-1 '))
  assert.ok(bar, 'could not find the floating action bar className')

  assert.ok(
    bar.includes('left-1/2'),
    'action bar must anchor with left-1/2 to be centred'
  )
  assert.ok(
    !bar.includes('right-1/2'),
    'right-1/2 + -translate-x-1/2 puts the bar a half-width left of centre (GitHub #2)'
  )

  // ── #2: fullscreen must work where there is no element Fullscreen API ──
  // iOS Safari exposes it on <video> only, so `box.requestFullscreen?.()`
  // was a silent no-op on iPhone/iPad and nothing ever zoomed.
  assert.ok(
    src.includes("typeof box.requestFullscreen === 'function'"),
    'fullscreen must feature-detect requestFullscreen before calling it'
  )
  assert.ok(
    src.includes('setCssFs(true)'),
    'a CSS-overlay fallback must exist for browsers without the Fullscreen API'
  )
  // And the fallback must be escapable, or mobile users are trapped.
  assert.ok(
    src.includes('setCssFs(false)'),
    'the CSS fullscreen fallback must be exitable'
  )
}

// ── #6: the XLSX toolbar icon sprite must exist ───────────────────────────
//
// public/vendor/x-data-spreadsheet/ was populated by hand with the .css and
// .js only. The stylesheet references an SVG sprite by hash filename that was
// never copied, so every toolbar icon 404'd and the toolbar rendered as an
// empty strip ("none of the action items are showing up").
{
  const vendor = path.join(ROOT, 'public', 'vendor', 'x-data-spreadsheet')
  const css = readFileSync(path.join(vendor, 'xspreadsheet.css'), 'utf8')

  const refs = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) =>
    m[1].replace(/["']/g, '').trim()
  )
  assert.ok(refs.length > 0, 'expected the vendored CSS to reference at least one asset')

  for (const ref of refs) {
    if (/^(data:|https?:|\/\/)/.test(ref)) continue // inline or remote, nothing to vendor
    const asset = path.join(vendor, ref)
    assert.ok(
      existsSync(asset),
      `vendored CSS references ${ref}, which is missing from public/vendor/x-data-spreadsheet/ ` +
        `— every toolbar icon 404s without it (GitHub #6)`
    )
  }

  // The sprite is positioned by 18px background-position steps, so its box has
  // to cover every cell the stylesheet addresses or the last icons render blank.
  const sprite = refs.find((r) => r.endsWith('.svg'))
  if (sprite) {
    const svg = readFileSync(path.join(vendor, sprite), 'utf8')
    const dims = svg.match(/width="(\d+)"\s+height="(\d+)"/)
    assert.ok(dims, 'sprite must declare explicit width/height')
    const [w, h] = [Number(dims[1]), Number(dims[2])]

    let maxL = 0
    let maxT = 0
    for (const m of css.matchAll(/left:\s*(-?\d+)px/g)) maxL = Math.max(maxL, -Number(m[1]))
    for (const m of css.matchAll(/top:\s*(-?\d+)px/g)) maxT = Math.max(maxT, -Number(m[1]))

    assert.ok(w >= maxL + 18, `sprite is ${w}px wide but the CSS addresses up to ${maxL + 18}px`)
    assert.ok(h >= maxT + 18, `sprite is ${h}px tall but the CSS addresses up to ${maxT + 18}px`)
  }
}

console.log('file-view / xlsx sprite regression tests passed')
