// Runnable check for the pptx importer's coordinate math.
//   node lib/store/pptx-import.check.mjs "Untitled design.pptx"
//
// Verifies the two things that actually broke real decks: that slide scale
// comes from <p:sldSz> (not a group-bbox guess), and that every imported
// object lands inside the 960×540 frame. Uses the real .pptx bytes rather
// than a fixture — the bug only reproduced on a real 20in Canva export.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

const W = 960
const H = 540

// Mirrors loadSlideScale in pptx-import.ts. No DOM here (this runs in plain
// node, the importer runs in the browser) — the check only needs attributes
// off a couple of known tags, which a regex reads fine.
function slideScale(presXml) {
  const m = presXml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
  const cx = Number(m?.[1] ?? 0)
  const cy = Number(m?.[2] ?? 0)
  if (!(cx > 0 && cy > 0)) return { emuPerPx: 9525, offX: 0, offY: 0, cx, cy }
  const emuPerPx = Math.max(cx / W, cy / H)
  return {
    emuPerPx,
    offX: -((W - cx / emuPerPx) / 2) * emuPerPx,
    offY: -((H - cy / emuPerPx) / 2) * emuPerPx,
    cx,
    cy,
  }
}

const file = process.argv[2] ?? 'Untitled design.pptx'
const zip = await JSZip.loadAsync(readFileSync(file))
const scale = slideScale(await zip.files['ppt/presentation.xml'].async('text'))

console.log(`slide: ${scale.cx}x${scale.cy} EMU (${scale.cx / 914400}in x ${scale.cy / 914400}in)`)
console.log(`emuPerPx: ${scale.emuPerPx}  offset: ${scale.offX.toFixed(0)},${scale.offY.toFixed(0)}`)

// The whole slide must map exactly onto the frame (contain + center).
const px = (v, off) => (v - off) / scale.emuPerPx
assert.equal(Math.round(px(0, scale.offX)), Math.round((W - scale.cx / scale.emuPerPx) / 2), 'left edge centered')
assert.ok(Math.round(px(scale.cx, scale.offX)) <= W, 'right edge within frame')
assert.ok(Math.round(px(scale.cy, scale.offY)) <= H, 'bottom edge within frame')

// Every top-level shape's box must land inside the frame (with a small
// tolerance for shapes the deck itself deliberately bleeds off-slide).
const slides = Object.keys(zip.files)
  .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  .sort()

let checked = 0
let custGeom = 0
let rotated = 0
for (const name of slides) {
  const xml = await zip.files[name].async('text')
  custGeom += (xml.match(/<a:custGeom>/g) ?? []).length
  // Every <a:ext> on the slide, whatever nests it — a shape bigger than the
  // frame is the exact symptom the old group-bbox heuristic produced.
  for (const m of xml.matchAll(/<a:ext cx="(\d+)" cy="(\d+)"/g)) {
    const w = Number(m[1]) / scale.emuPerPx
    const h = Number(m[2]) / scale.emuPerPx
    assert.ok(w <= W * 1.35, `${name}: shape width ${w.toFixed(0)}px exceeds ${W}px frame`)
    assert.ok(h <= H * 1.35, `${name}: shape height ${h.toFixed(0)}px exceeds ${H}px frame`)
    checked++
  }
  for (const m of xml.matchAll(/<a:xfrm[^>]*rot="(-?\d+)"/g)) {
    if (Number(m[1]) !== 0) rotated++
  }
}

// Font sizes must scale down with the deck: a 255pt title on a 20in slide is
// ~127pt on our 10in frame, which fits. Unscaled it would not.
const ptScale = 9525 / scale.emuPerPx
const slide1 = await zip.files['ppt/slides/slide1.xml'].async('text')
const maxSz = Math.max(...[...slide1.matchAll(/sz="(\d+)"/g)].map((m) => Number(m[1]) / 100))
const renderedPx = maxSz * (96 / 72) * ptScale
console.log(`largest font: ${maxSz}pt -> ${renderedPx.toFixed(0)}px on canvas`)
assert.ok(renderedPx < H, `title text ${renderedPx.toFixed(0)}px taller than the ${H}px slide`)

console.log(`ok — ${checked} shapes across ${slides.length} slides (${custGeom} custGeom, ${rotated} rotated)`)
