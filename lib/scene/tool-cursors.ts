// Custom pointer cursors per tool — a pen nib for drawing, a shape corner for
// placing, an eraser for erasing, etc. Encoded as inline SVG data-URIs so no
// asset files or network requests are involved; each is tuned to point its
// "business end" (nib tip, crosshair center) at the actual hotspot pixel.
import type { Tool } from '@/lib/store/document'

function svgCursor(svg: string, hotspotX: number, hotspotY: number): string {
  return `url('data:image/svg+xml;utf8,${svg}') ${hotspotX} ${hotspotY}, auto`
}

// Angled nib, tip at bottom-left — matches how a pen is actually held.
const PEN_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<g transform="rotate(-45 14 14)">` +
    `<path d="M13 4 L19 10 L9 24 L5 24 L5 20 Z" fill="%23ffffff" stroke="%23222222" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M9 24 L5 20 L7 18 L11 22 Z" fill="%23222222"/>` +
    `</g></svg>`,
  6,
  22
)

// Same nib, tinted for shaper (beautify) mode so it's visually distinct.
const SHAPER_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<g transform="rotate(-45 14 14)">` +
    `<path d="M13 4 L19 10 L9 24 L5 24 L5 20 Z" fill="%23e8ecff" stroke="%234f5bd5" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<path d="M9 24 L5 20 L7 18 L11 22 Z" fill="%234f5bd5"/>` +
    `</g></svg>`,
  6,
  22
)

// Chunky rounded block — reads as "eraser", hotspot at its center.
const ERASER_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<rect x="4" y="8" width="16" height="10" rx="3" transform="rotate(-20 12 13)" fill="%23ffb4c6" stroke="%23a13a55" stroke-width="1.5"/>` +
    `</svg>`,
  12,
  13
)

// Fine crosshair for precise placement (shapes, lines, measurement).
const CROSSHAIR_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">` +
    `<circle cx="11" cy="11" r="6" fill="none" stroke="%23222222" stroke-width="1.25"/>` +
    `<line x1="11" y1="0" x2="11" y2="6" stroke="%23222222" stroke-width="1.25"/>` +
    `<line x1="11" y1="16" x2="11" y2="22" stroke="%23222222" stroke-width="1.25"/>` +
    `<line x1="0" y1="11" x2="6" y2="11" stroke="%23222222" stroke-width="1.25"/>` +
    `<line x1="16" y1="11" x2="22" y2="11" stroke="%23222222" stroke-width="1.25"/>` +
    `</svg>`,
  11,
  11
)

// Loop selector for lasso — a small dashed oval next to the arrow tip.
const LASSO_CURSOR = svgCursor(
  `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="24" viewBox="0 0 26 24">` +
    `<path d="M2 2 L2 16 L7 13 L10 20 L13 18.5 L10 12 L16 12 Z" fill="%23ffffff" stroke="%23222222" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<ellipse cx="18" cy="8" rx="6" ry="4.5" fill="none" stroke="%23222222" stroke-width="1.25" stroke-dasharray="2.5 2"/>` +
    `</svg>`,
  2,
  2
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
    case 'select':
      return 'default'
    case 'circle':
    case 'rect':
    case 'line':
    case 'connector':
    case 'measurement':
    case 'shape':
      return CROSSHAIR_CURSOR
    default:
      // Placing components/text/notes etc. — keep the light "drop something" hint.
      return 'copy'
  }
}
