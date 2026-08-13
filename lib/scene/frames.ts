// The fixed frames page content is authored against.
//
// A slide's or sheet's objects are positioned in a coordinate space of a
// KNOWN size — a deck slide is always 960×540, a doc sheet always A4 at
// ~96dpi — and every surface that shows one (the presentation stage, the
// Present overlay, the rail tiles, thumbnails, the file-view preview, the
// PDF/PPTX exporters) has to agree on those numbers or content lands at the
// wrong scale. They lived in five places before this file: doc-view.tsx
// (SHEET_W/H), to-pdf.ts (PPT_W/H), file-view.tsx and page-thumbnail.tsx
// (private copies), plus bare 960/540 literals scattered through
// presentation-view.tsx.
//
// This module has no imports on purpose. The copies existed partly because
// the constants lived in COMPONENT files, so importing them from
// lib/scene/doc-page-sizes.ts or another component risked cycles (doc-view →
// doc-sorter → page-thumbnail was a real one). A leaf module in lib/ can be
// imported from anywhere.

/** Deck slide, CSS px. 16:9 — matches pptx-export.ts's 10in × 5.625in layout
 *  and the frame pptx-import.ts maps imported slide XML onto. */
export const SLIDE_W = 960
export const SLIDE_H = 540

/** Doc sheet, CSS px. A4 at ~96dpi. */
export const SHEET_W = 794
export const SHEET_H = 1123

/** Letter, CSS px. 8.5in × 11in @ 96dpi. */
export const LETTER_W = 816
export const LETTER_H = 1056
