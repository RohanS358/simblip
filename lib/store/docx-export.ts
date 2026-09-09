'use client'

// A doc page → a .docx file.
//
// The inverse of lib/store/docx-map.ts, and the mirror image of what this
// file used to be: it read `text`/`note` SceneObjects, sorted them by y, and
// wrote one bare paragraph per object with the raw stored value as its text —
// which, after the ProseMirror migration, meant exporting literal JSON. Now
// the page HAS a document (its flowing body), so exporting one is a
// structural walk rather than a reconstruction.
//
// The two layers of a doc page leave by different routes:
//
//   the flowing body  → real Word paragraphs, runs, marks, lists, tables,
//                       inline images and section properties.
//   free objects      → one flattened image per page, anchored to that page
//                       and placed BEHIND the text, at the page position the
//                       objects occupy here. Word has no idea what a live
//                       circuit or a graph is, and a picture in the right
//                       place beats a component silently dropped. The caller
//                       rasterizes (it owns the DOM); this file only places.
//
// Page breaks are emitted at the boundaries our own layout engine computed,
// so Word's repagination starts from the same page structure rather than
// reflowing the document into a different shape on open.

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  HorizontalPositionRelativeFrom,
  VerticalPositionRelativeFrom,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx'
import { parseDoc, type PmDoc, type PmMark, type PmNode } from '@/lib/text/pm'
import { pxToTwips, pxToPt } from '@/lib/scene/units'
import { formatOf } from '@/lib/text/extensions'
import { SHEET_W, SHEET_H } from '@/lib/scene/frames'

/** A flattened picture of one page's free objects, from the caller's
 *  rasterizer, plus the index of the top-level body block that page starts
 *  at (from the live pagination) so it can be anchored there. */
export interface PageOverlay {
  png: ArrayBuffer
  /** Top-level block index this page begins at; 0 for the first page. */
  atBlock: number
  width: number
  height: number
}

export interface DocxExportInput {
  /** The page's flowing body, in any stored generation (parseDoc handles it). */
  flow?: string
  /** Page size in page px. Defaults to A4. */
  page?: { w: number; h: number }
  margins?: { top: number; right: number; bottom: number; left: number }
  /** Top-level block indices at which our layout engine broke the page. */
  breaks?: number[]
  overlays?: PageOverlay[]
  /** opfs:<id> → PNG/JPEG bytes, resolved by the caller (this file has no
   *  business touching storage). */
  images?: Map<string, ArrayBuffer>
  /** PageNode.docHeaderText/docFooterText — a plain-text line repeated on
   *  every page. */
  headerText?: string
  footerText?: string
  headerFooterSkipFirst?: boolean
  /** PageNode.docShowPageNumbers — "N of M" appended to the footer line. */
  showPageNumbers?: boolean
}

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const

const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]

// ── marks → run options ──────────────────────────────────────────────────

// The docx types are deeply readonly, so these builders accumulate into a
// mutable bag and cast once at the end rather than rebuilding an object per
// mark.
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function runOptions(marks: PmMark[] | undefined): IRunOptions {
  const out: Mutable<IRunOptions> = {}
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        out.bold = true
        break
      case 'italic':
        out.italics = true
        break
      case 'underline':
        out.underline = {}
        break
      case 'strike':
        out.strike = true
        break
      case 'highlight':
        out.highlight = 'yellow'
        break
      case 'textStyle': {
        const a = m.attrs ?? {}
        // Word wants a bare RRGGBB, and only accepts a literal colour — a CSS
        // variable or a named colour would be written through verbatim and
        // render as black.
        if (typeof a.color === 'string' && /^#?[0-9a-fA-F]{6}$/.test(a.color))
          out.color = a.color.replace('#', '')
        if (typeof a.fontSize === 'string') {
          const px = parseFloat(a.fontSize)
          // Half-points, hence the doubling.
          if (Number.isFinite(px)) out.size = Math.round(pxToPt(px) * 2)
        }
        if (typeof a.fontFamily === 'string') out.font = a.fontFamily.split(',')[0].replace(/["']/g, '').trim()
        if (a.fontWeight != null && Number(a.fontWeight) >= 600) out.bold = true
        break
      }
    }
  }
  return out
}

function inlineRuns(nodes: PmNode[] | undefined, input: DocxExportInput): (TextRun | ImageRun)[] {
  const out: (TextRun | ImageRun)[] = []
  for (const node of nodes ?? []) {
    if (node.type === 'text' && node.text) {
      out.push(new TextRun({ ...runOptions(node.marks), text: node.text }))
    } else if (node.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }))
    } else if (node.type === 'docImage') {
      const src = node.attrs?.src
      const data = typeof src === 'string' ? input.images?.get(src) : undefined
      if (!data) continue
      out.push(
        new ImageRun({
          type: 'png',
          data,
          transformation: {
            width: Number(node.attrs?.width) || 200,
            height: Number(node.attrs?.height) || 150,
          },
        })
      )
    }
  }
  return out
}

// ── blocks ───────────────────────────────────────────────────────────────

function paragraphOptions(node: PmNode): IParagraphOptions {
  const fmt = formatOf({ type: node.type, attrs: node.attrs ?? null })
  const attrs = node.attrs ?? {}
  const opts: Mutable<IParagraphOptions> = {
    alignment: ALIGN[fmt.align],
    spacing: { before: pxToTwips(fmt.spaceBefore), after: pxToTwips(fmt.spaceAfter), line: Math.round(fmt.lineHeight * 240), lineRule: 'auto' },
    keepNext: fmt.keepWithNext || undefined,
    keepLines: fmt.keepTogether || undefined,
  }
  if (fmt.indentLeft || fmt.indentRight || fmt.indentFirstLine) {
    opts.indent = {
      left: fmt.indentLeft ? pxToTwips(fmt.indentLeft) : undefined,
      right: fmt.indentRight ? pxToTwips(fmt.indentRight) : undefined,
      // Word splits what CSS text-indent expresses in one signed number.
      ...(fmt.indentFirstLine < 0
        ? { hanging: pxToTwips(-fmt.indentFirstLine) }
        : fmt.indentFirstLine > 0
          ? { firstLine: pxToTwips(fmt.indentFirstLine) }
          : {}),
    }
  }
  if (node.type === 'heading') opts.heading = HEADING[Math.min(3, Number(attrs.level ?? 1)) - 1]
  if (fmt.borderColor) {
    const edge = { style: BorderStyle.SINGLE, color: fmt.borderColor.replace('#', ''), size: 12, space: 4 }
    opts.border = { top: edge, bottom: edge, left: edge, right: edge }
  }
  return opts
}

/** A list, flattened into the numbered/bulleted paragraphs Word actually
 *  stores — WordprocessingML has no nested list ELEMENT, only paragraphs that
 *  reference a numbering definition at a level. */
function listParagraphs(node: PmNode, level: number, input: DocxExportInput): Paragraph[] {
  const ordered = node.type === 'orderedList'
  const out: Paragraph[] = []
  for (const item of node.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        out.push(...listParagraphs(child, level + 1, input))
        continue
      }
      out.push(
        new Paragraph({
          ...paragraphOptions(child),
          ...(ordered
            ? { numbering: { reference: 'simblip-ordered', level: Math.min(8, level) } }
            : { bullet: { level: Math.min(8, level) } }),
          children: inlineRuns(child.content, input),
        })
      )
    }
  }
  return out
}

function tableOf(node: PmNode, input: DocxExportInput): Table {
  const rows = (node.content ?? []).map(
    (row) =>
      new TableRow({
        children: (row.content ?? []).map(
          (cell) =>
            new TableCell({
              columnSpan: Number(cell.attrs?.colspan) || undefined,
              children: blockParagraphs(cell.content ?? [], input),
            })
        ),
      })
  )
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

function blockParagraphs(nodes: PmNode[], input: DocxExportInput): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const node of nodes) {
    switch (node.type) {
      case 'bulletList':
      case 'orderedList':
        out.push(...listParagraphs(node, 0, input))
        break
      case 'table':
        out.push(tableOf(node, input))
        // Word merges two adjacent tables into one; an empty paragraph
        // between them is the standard separator.
        out.push(new Paragraph({}))
        break
      case 'blockquote':
        out.push(...blockParagraphs(node.content ?? [], input))
        break
      case 'horizontalRule':
        out.push(new Paragraph({ thematicBreak: true }))
        break
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }))
        break
      default:
        out.push(new Paragraph({ ...paragraphOptions(node), children: inlineRuns(node.content, input) }))
    }
  }
  return out
}

// ── entry point ──────────────────────────────────────────────────────────

export async function exportDocx(input: DocxExportInput): Promise<Blob> {
  const doc: PmDoc = parseDoc(input.flow ?? '')
  const page = input.page ?? { w: SHEET_W, h: SHEET_H }
  const margins = input.margins ?? { top: 96, right: 96, bottom: 96, left: 96 }
  const breaks = new Set(input.breaks ?? [])
  const overlayAt = new Map((input.overlays ?? []).map((o) => [o.atBlock, o]))

  const children: (Paragraph | Table)[] = []
  ;(doc.content ?? []).forEach((node, i) => {
    // Our own page boundary. Emitting it explicitly is what keeps Word's
    // repagination aligned with the pages the author actually saw.
    if (i > 0 && breaks.has(i) && node.type !== 'pageBreak') {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
    const overlay = overlayAt.get(i)
    if (overlay) {
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: overlay.png,
              transformation: { width: overlay.width, height: overlay.height },
              floating: {
                horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
                verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
                behindDocument: true,
              },
            }),
          ],
        })
      )
    }
    children.push(...blockParagraphs([node], input))
  })
  if (children.length === 0) children.push(new Paragraph({}))

  // A plain repeated line — see PageNode.docHeaderText's own comment for why
  // this stays one TextRun rather than a full editable header region.
  const footerRun: TextRun[] = []
  if (input.showPageNumbers) {
    footerRun.push(
      new TextRun({ children: [PageNumber.CURRENT] }),
      new TextRun(' of '),
      new TextRun({ children: [PageNumber.TOTAL_PAGES] })
    )
  }
  if (input.footerText) {
    if (footerRun.length) footerRun.push(new TextRun('   ·   '))
    footerRun.push(new TextRun(input.footerText))
  }
  const header = input.headerText
    ? new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(input.headerText)] })] })
    : undefined
  const footer = footerRun.length
    ? new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: footerRun })] })
    : undefined
  // titlePage activates the `first` slot as a DISTINCT page — omitting it,
  // Word ignores `first` and repeats `default` everywhere, which is the
  // opposite of what "skip on first page" asked for.
  const skipFirst = input.headerFooterSkipFirst && (header || footer)

  const out = new Document({
    numbering: {
      config: [
        {
          reference: 'simblip-ordered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: 'decimal' as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: pxToTwips(page.w), height: pxToTwips(page.h) },
            margin: {
              top: pxToTwips(margins.top),
              right: pxToTwips(margins.right),
              bottom: pxToTwips(margins.bottom),
              left: pxToTwips(margins.left),
            },
          },
          titlePage: !!skipFirst,
        },
        headers: header
          ? { default: header, ...(skipFirst ? { first: new Header({ children: [new Paragraph({})] }) } : {}) }
          : undefined,
        footers: footer
          ? { default: footer, ...(skipFirst ? { first: new Footer({ children: [new Paragraph({})] }) } : {}) }
          : undefined,
        children,
      },
    ],
  })
  return Packer.toBlob(out)
}
