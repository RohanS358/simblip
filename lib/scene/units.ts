'use client'

// Length units. The page is measured in CENTIMETRES: 10 px = 1 cm.
//
// Everything the user reads or types — object position and size in the
// Inspector, positions and speeds on a graph — goes through here, so there is
// exactly one place that knows the scale. Object geometry stays in pixels
// internally (the canvas, hit-testing and the physics engine all work in
// pixels); this is purely the boundary where pixels become a human unit.

/** The scale of the whole app: 10 px = 1 cm. */
export const PX_PER_CM = 10

/** 1 m = 100 cm = 1000 px. Physics reports SI internally at this scale. */
export const PX_PER_M = PX_PER_CM * 100

export const pxToCm = (px: number): number => px / PX_PER_CM
export const cmToPx = (cm: number): number => cm * PX_PER_CM

/** Round-tripped display value — avoids 3.0000000000000004 in an input. */
export const pxToCmRounded = (px: number): number => Math.round((px / PX_PER_CM) * 1000) / 1000

// ── Office document units ────────────────────────────────────────────────
// A different space entirely from the canvas centimetres above, and they must
// not be confused: PAGE pixels are CSS px at 96 dpi, which is what SHEET_W/H
// in lib/scene/frames.ts are and therefore what the doc/pptx layout works in.
// OOXML measures the same lengths three other ways at once:
//
//   twips  1/1440 inch  — .docx paragraph indents, spacing, page margins
//   EMU    1/914400 in  — DrawingML positions and sizes (both formats)
//   points 1/72 inch    — font sizes (.docx stores half-points, so /2 first)
//
// These live here rather than inside each importer so the two file formats
// cannot drift apart on the arithmetic.

export const PAGE_DPI = 96
const TWIPS_PER_INCH = 1440
const EMU_PER_INCH = 914400
const POINTS_PER_INCH = 72

export const twipsToPx = (twips: number): number => (twips / TWIPS_PER_INCH) * PAGE_DPI
export const pxToTwips = (px: number): number => Math.round((px / PAGE_DPI) * TWIPS_PER_INCH)

export const emuToPx = (emu: number): number => (emu / EMU_PER_INCH) * PAGE_DPI
export const pxToEmu = (px: number): number => Math.round((px / PAGE_DPI) * EMU_PER_INCH)

export const ptToPx = (pt: number): number => (pt / POINTS_PER_INCH) * PAGE_DPI
export const pxToPt = (px: number): number => (px / PAGE_DPI) * POINTS_PER_INCH
/** .docx stores font size in HALF-points (<w:sz w:val="24"/> is 12pt). */
export const halfPtToPx = (halfPt: number): number => ptToPx(halfPt / 2)
