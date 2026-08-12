// Custom pointer cursors per tool — a pen nib for drawing, an eraser for
// erasing, a crosshair for placing. Encoded as inline SVG data-URIs so no
// asset files or network requests are involved.
//
// Three things every cursor here has to get right, all of which the earlier
// hand-rolled set got wrong:
//
//  1. HOTSPOT. The declared hotspot must land on the drawn "business end"
//     (nib tip, crosshair centre). Geometry is authored tip-first and the
//     hotspot is derived from named constants, not eyeballed after the fact.
//  2. CONTRAST. The canvas has light AND dark themes plus arbitrary user ink
//     underneath, so a flat black glyph disappears. Every shape carries a
//     contrasting outline, so it reads on any background without needing to
//     know the theme.
//  3. FALLBACK. If a data-URI ever fails to parse, the browser silently uses
//     the keyword after the comma. That keyword must be the closest native
//     cursor ('crosshair' for precision tools), never 'auto' — which yields a
//     plain arrow and makes a broken cursor look intentional.
import type { Tool } from '@/lib/store/document'

/**
 * Build a `cursor` value from a complete <svg> string.
 *
 * Three characters MUST be escaped in an unencoded `utf8,` data-URI or the
 * whole rule is dropped silently — and a dropped rule just falls back to the
 * keyword, so the bug looks like "the cursor is ugly" rather than "the cursor
 * failed to parse":
 *   #  starts a URL fragment       (every hex color)
 *   %  starts a percent-escape     (feDropShadow's width="200%")
 *   "  ends the url("…") wrapper   (every SVG attribute)
 * `%` has to be replaced FIRST, or it would re-escape the escapes it creates.
 */
function svgCursor(svg: string, hotspotX: number, hotspotY: number, fallback: string): string {
  const safe = svg
    .replace(/\n\s*/g, '')
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/"/g, "'")
  return `url("data:image/svg+xml;utf8,${safe}") ${hotspotX} ${hotspotY}, ${fallback}`
}

/** Outline + fill pair that stays legible on any background. */
const INK = '#1a1a1a'
const PAPER = '#ffffff'

/**
 * A soft dark halo under a light glyph (and vice versa). Cursors sit on top of
 * user content of unknown color; without this a white nib vanishes on white
 * paper and a dark one vanishes on dark themes.
 */
const SHADOW =
  '<filter id="s" x="-50%" y="-50%" width="200%" height="200%">' +
  '<feDropShadow dx="0" dy="0.5" stdDeviation="0.75" flood-color="#000" flood-opacity="0.45"/>' +
  '</filter>'

// ── Pen ─────────────────────────────────────────────────────────────────────
// A fountain pen held at ~45°, tip at the bottom-left. What makes this read as
// a PEN rather than a generic slanted box, in order of importance:
//   - the nib TAPERS to a point (a cone, not a cut-off parallelogram),
//   - it has the characteristic slit + breather hole down its centre,
//   - a metal collar separates nib from barrel,
//   - the barrel is a long parallel body, wider than the nib, with a cap band.
// Everything is authored along a 45° axis with the point at (3,27), so the
// hotspot is literally the drawn tip.
const PEN_TIP_X = 3
const PEN_TIP_Y = 27

const penSvg = (accent: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
  SHADOW +
  `<g filter="url(#s)" stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">` +
  // Barrel — wide enough to read as a pen body rather than a spike.
  `<path d="M15.4 13.2 L23.8 4.8 L29 10 L20.6 18.4 Z" fill="${PAPER}" stroke-width="1.15"/>` +
  // Cap band, the detail that separates "pen" from "stick".
  `<path d="M21.6 6.9 L26.9 12.2" stroke-width="1.15"/>` +
  // Metal collar between barrel and nib.
  `<path d="M13.3 15.3 L15.4 13.2 L20.6 18.4 L18.5 20.5 Z" fill="#c2c8d2" stroke-width="1.05"/>` +
  // Nib — PALE, so the dark slit and ink tip stay visible inside it. Filling
  // this dark made the whole nib a solid black spike that read as a blade.
  `<path d="M13.3 15.3 L18.5 20.5 L3 27 Z" fill="${PAPER}" stroke-width="1.05"/>` +
  // Slit down the nib's centreline, ending at the tip.
  `<path d="M15.1 17.1 L6.2 24.9" stroke="${INK}" stroke-width="0.85"/>` +
  // Breather hole.
  `<circle cx="14.9" cy="16.9" r="0.85" fill="${INK}" stroke="none"/>` +
  // Inked point: the only dark mass, right at the hotspot, so the cursor
  // reads as "this is where ink lands".
  `<path d="M7.4 23.6 L9.6 25.8 L3 27 Z" fill="${accent}" stroke="${accent}" stroke-width="0.9"/>` +
  `</g></svg>`

const PEN_CURSOR = svgCursor(penSvg(INK), PEN_TIP_X, PEN_TIP_Y, 'crosshair')

// Shaper = the same nib, tinted, so "beautify mode" is unmistakable at a
// glance without changing the shape you aim with.
const SHAPER_CURSOR = svgCursor(penSvg('#4f5bd5'), PEN_TIP_X, PEN_TIP_Y, 'crosshair')

// ── Eraser ──────────────────────────────────────────────────────────────────
// A block eraser seen at an angle, hotspot on the working (lower-left) face
// rather than the centre — you erase with the edge you can see.
const ERASER_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    SHADOW +
    `<g filter="url(#s)" transform="rotate(-35 14 14)">` +
    `<rect x="5" y="9" width="18" height="11" rx="2.5" fill="${PAPER}" stroke="${INK}" stroke-width="1.25"/>` +
    // the "used" half, so it reads as an eraser and not a plain box
    `<path d="M5 14.5 h18 v3 a2.5 2.5 0 0 1 -2.5 2.5 h-13 a2.5 2.5 0 0 1 -2.5 -2.5 Z" fill="#ff9db4" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>` +
    `</g></svg>`,
  9,
  17,
  'cell'
)

// ── Crosshair ───────────────────────────────────────────────────────────────
// Precision placement. A centre gap keeps the exact target pixel visible
// instead of covering it with ink — the whole point of a crosshair.
const CROSSHAIR_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">` +
    SHADOW +
    `<g filter="url(#s)" stroke-linecap="round">` +
    // White underlay makes the hairlines readable on dark backgrounds too.
    `<g stroke="${PAPER}" stroke-width="3.25">` +
    `<line x1="13" y1="1" x2="13" y2="9"/><line x1="13" y1="17" x2="13" y2="25"/>` +
    `<line x1="1" y1="13" x2="9" y2="13"/><line x1="17" y1="13" x2="25" y2="13"/>` +
    `</g>` +
    `<g stroke="${INK}" stroke-width="1.35">` +
    `<line x1="13" y1="1" x2="13" y2="9"/><line x1="13" y1="17" x2="13" y2="25"/>` +
    `<line x1="1" y1="13" x2="9" y2="13"/><line x1="17" y1="13" x2="25" y2="13"/>` +
    `</g>` +
    `<circle cx="13" cy="13" r="1.15" fill="${INK}" stroke="${PAPER}" stroke-width="0.75"/>` +
    `</g></svg>`,
  13,
  13,
  'crosshair'
)

// ── Lasso ───────────────────────────────────────────────────────────────────
// Arrow tip at (2,2) so the hotspot is the tip, with a dashed loop trailing
// off to the lower right where it can't cover what you're selecting.
const LASSO_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    SHADOW +
    `<g filter="url(#s)">` +
    `<path d="M2 2 L2 17 L6.5 13.2 L9.6 20.5 L12.9 19.1 L9.9 12 L16.5 12 Z" fill="${PAPER}" stroke="${INK}" stroke-width="1.25" stroke-linejoin="round"/>` +
    // The loop needs a light underlay of its own: a lone dark dashed ellipse
    // all but vanished against a dark canvas, since only the arrow carried a
    // white body to sit against.
    `<ellipse cx="19.5" cy="19.5" rx="7" ry="5" fill="none" stroke="${PAPER}" stroke-width="2.75"/>` +
    `<ellipse cx="19.5" cy="19.5" rx="7" ry="5" fill="none" stroke="${INK}" stroke-width="1.25" stroke-dasharray="2.5 2.25"/>` +
    `</g></svg>`,
  2,
  2,
  'crosshair'
)

// ── Text ────────────────────────────────────────────────────────────────────
// A proper I-beam with serifs, hotspot dead centre — the native `text` cursor
// is fine, but placing a NEW text box wants the "insert here" reading.
const TEXT_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="26" viewBox="0 0 20 26">` +
    SHADOW +
    `<g filter="url(#s)" stroke-linecap="round">` +
    `<g stroke="${PAPER}" stroke-width="3.5">` +
    `<line x1="10" y1="4" x2="10" y2="22"/>` +
    `<line x1="6.5" y1="4" x2="13.5" y2="4"/><line x1="6.5" y1="22" x2="13.5" y2="22"/>` +
    `</g>` +
    `<g stroke="${INK}" stroke-width="1.5">` +
    `<line x1="10" y1="4" x2="10" y2="22"/>` +
    `<line x1="6.5" y1="4" x2="13.5" y2="4"/><line x1="6.5" y1="22" x2="13.5" y2="22"/>` +
    `</g></g></svg>`,
  10,
  13,
  'text'
)

// ── Placement ───────────────────────────────────────────────────────────────
// Crosshair plus a small "+" badge: precise about WHERE, explicit that a new
// object appears. Replaces the old bare `copy`, whose OS glyph implies
// duplicating an existing thing rather than creating one.
const PLACE_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    SHADOW +
    `<g filter="url(#s)" stroke-linecap="round">` +
    `<g stroke="${PAPER}" stroke-width="3.25">` +
    `<line x1="11" y1="1" x2="11" y2="7"/><line x1="11" y1="15" x2="11" y2="21"/>` +
    `<line x1="1" y1="11" x2="7" y2="11"/><line x1="15" y1="11" x2="21" y2="11"/>` +
    `</g>` +
    `<g stroke="${INK}" stroke-width="1.35">` +
    `<line x1="11" y1="1" x2="11" y2="7"/><line x1="11" y1="15" x2="11" y2="21"/>` +
    `<line x1="1" y1="11" x2="7" y2="11"/><line x1="15" y1="11" x2="21" y2="11"/>` +
    `</g>` +
    `<circle cx="21" cy="21" r="6" fill="${PAPER}" stroke="${INK}" stroke-width="1.4"/>` +
    `<g stroke="${INK}" stroke-width="1.6"><line x1="21" y1="18" x2="21" y2="24"/><line x1="18" y1="21" x2="24" y2="21"/></g>` +
    `</g></svg>`,
  11,
  11,
  'crosshair'
)

/** Resolves the CSS `cursor` value for the active tool. */
export function cursorForTool(tool: Tool): string {
  switch (tool) {
    case 'pen':
      return PEN_CURSOR
    case 'shaper':
      return SHAPER_CURSOR
    case 'eraser':
      return ERASER_CURSOR
    case 'lasso':
      return LASSO_CURSOR
    case 'text':
      return TEXT_CURSOR
    case 'select':
      return 'default'
    case 'circle':
    case 'rect':
    case 'line':
    case 'measurement':
    case 'shape':
      return CROSSHAIR_CURSOR
    default:
      // Placing components/notes/etc.
      return PLACE_CURSOR
  }
}
