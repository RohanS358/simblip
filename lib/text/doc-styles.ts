// Named paragraph styles for the Word-style flowing body of a `doc` page.
//
// Word's central formatting idea (and §34 of the design brief): a paragraph
// says `style = "Heading1"` rather than carrying a dozen explicit properties.
// Restyling a document then means editing one row of this table instead of
// every paragraph in it.
//
// Resolution order, cheapest to most specific:
//
//   DEFAULT_PARAGRAPH  →  DOC_STYLES[style]  →  the paragraph's own attrs
//
// So an attr the author set by hand always wins, a style fills in what they
// did not set, and DEFAULT_PARAGRAPH backstops both. `resolveStyle` below is
// the ONE place that order is implemented — the pagination pass, the renderer
// and the .docx exporter all call it rather than each re-deriving it.
//
// Sizes are px at 96dpi, matching lib/scene/frames.ts (SHEET_W/H are A4 at
// 96dpi) so that nothing in the layout path ever converts units. `spaceBefore`
// /`spaceAfter` are px of vertical margin; `lineHeight` is unitless.

export interface ParagraphFormat {
  align: 'left' | 'center' | 'right' | 'justify'
  /** Indents in px from the content-area edges (§12). */
  indentLeft: number
  indentRight: number
  /** Extra indent applied to the first line only; negative = hanging. */
  indentFirstLine: number
  spaceBefore: number
  spaceAfter: number
  lineHeight: number
  /** Pagination hints (§21). `keepWithNext` glues a heading to the paragraph
   *  under it; `keepTogether` forbids splitting the block across a page. */
  keepWithNext: boolean
  keepTogether: boolean
}

/** Character-level defaults a style also carries. Applied as CSS on the block,
 *  so an explicit textStyle mark on a run still overrides them. */
export interface StyleFormat extends ParagraphFormat {
  fontSize: number
  fontWeight: number
  fontFamily?: string
  color?: string
}

export const DEFAULT_PARAGRAPH: ParagraphFormat = {
  align: 'left',
  indentLeft: 0,
  indentRight: 0,
  indentFirstLine: 0,
  spaceBefore: 0,
  spaceAfter: 8,
  lineHeight: 1.5,
  keepWithNext: false,
  keepTogether: false,
}

const NORMAL: StyleFormat = { ...DEFAULT_PARAGRAPH, fontSize: 16, fontWeight: 400 }

/** The style table. Deliberately small — these are the styles a student
 *  actually applies, not Word's full 300-entry latent list. A .docx importing
 *  an unknown pStyle falls back to Normal plus whatever direct formatting the
 *  run carried, which is what Word itself does for a missing style. */
export const DOC_STYLES: Record<string, StyleFormat> = {
  Normal: NORMAL,
  Title: { ...NORMAL, fontSize: 40, fontWeight: 700, spaceAfter: 16, keepWithNext: true, keepTogether: true },
  Heading1: { ...NORMAL, fontSize: 30, fontWeight: 700, spaceBefore: 20, spaceAfter: 10, keepWithNext: true, keepTogether: true },
  Heading2: { ...NORMAL, fontSize: 24, fontWeight: 600, spaceBefore: 16, spaceAfter: 8, keepWithNext: true, keepTogether: true },
  Heading3: { ...NORMAL, fontSize: 19, fontWeight: 600, spaceBefore: 14, spaceAfter: 6, keepWithNext: true, keepTogether: true },
  Quote: { ...NORMAL, indentLeft: 32, indentRight: 32, spaceBefore: 8, spaceAfter: 8 },
  Caption: { ...NORMAL, fontSize: 13, align: 'center', spaceAfter: 12, color: 'var(--muted-foreground)' },
}

export const STYLE_IDS = Object.keys(DOC_STYLES)

/** Which style a heading node of the given level means. Headings are a real
 *  ProseMirror node type (StarterKit's), NOT a paragraph carrying a style
 *  attr — so the two have to agree, and this is where they meet. */
export function styleForHeading(level: number): string {
  return `Heading${Math.min(3, Math.max(1, level))}`
}

/** The resolution order described in this file's header. `attrs` is the raw
 *  ProseMirror attrs object; unset attrs are null/undefined and fall through. */
export function resolveStyle(
  styleId: string | null | undefined,
  attrs: Record<string, unknown> | null | undefined
): StyleFormat {
  const base = DOC_STYLES[styleId ?? ''] ?? DOC_STYLES.Normal
  if (!attrs) return base
  const out = { ...base }
  for (const key of Object.keys(base) as (keyof StyleFormat)[]) {
    const v = attrs[key]
    if (v !== null && v !== undefined) (out as Record<string, unknown>)[key] = v
  }
  return out
}
