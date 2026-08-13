// Named page-size presets offered when creating a doc page (see
// components/workspace/add-page-dialog.tsx). Reuses the same CSS-px
// dimensions doc-view.tsx and the PPT export path already use, so a chosen
// preset lines up exactly with what the sheet — and the exported PDF —
// actually render at.

import { SHEET_W, SHEET_H, SLIDE_W, SLIDE_H, LETTER_W, LETTER_H } from './frames'

export { LETTER_W, LETTER_H }

export type DocPageSizeId = 'a4' | 'letter' | 'ppt'

export interface DocPageSize {
  id: DocPageSizeId
  label: string
  w: number
  h: number
  /** PPT slides are inherently landscape — no portrait/landscape toggle. */
  fixedOrientation?: boolean
}

export const DOC_PAGE_PRESETS: DocPageSize[] = [
  { id: 'a4', label: 'A4', w: SHEET_W, h: SHEET_H },
  { id: 'letter', label: 'Letter', w: LETTER_W, h: LETTER_H },
  { id: 'ppt', label: 'PPT (16:9)', w: SLIDE_W, h: SLIDE_H, fixedOrientation: true },
]

export type Orientation = 'portrait' | 'landscape'

/** Resolve a preset + orientation to the actual {w,h} a new doc's sheets
 *  should start at — swapping the preset's stored (portrait) dimensions for
 *  landscape ones when asked. */
export function resolveDocPageSize(preset: DocPageSize, orientation: Orientation): { w: number; h: number } {
  const landscape = orientation === 'landscape'
  const portraitW = Math.min(preset.w, preset.h)
  const portraitH = Math.max(preset.w, preset.h)
  return landscape ? { w: portraitH, h: portraitW } : { w: portraitW, h: portraitH }
}
