// word/document.xml → a ProseMirror document.
//
// The mapping half of .docx import, kept apart from the zip/OPFS half in
// docx-import.ts so it is a pure function of some XML strings and can be run
// — and tested — outside a browser.
//
// This replaces an importer that read <w:t> text and nothing else, dropping
// it 20 paragraphs to a page as absolutely-positioned text boxes. A Word file
// IS a flowing document, and now so is the page it opens into, so the two
// models finally line up: paragraph → paragraph, run → marked text, list →
// list, table → table, and the layout is recomputed rather than transcribed.
//
// Reference: ECMA-376 Part 1, §17 (WordprocessingML).
//
// What is deliberately NOT mapped:
//   • floating (<wp:anchor>) images keep their INLINE reading position rather
//     than becoming free-floating objects. Which page a Word anchor lands on
//     is a result of Word's own layout, which we do not have and cannot infer
//     from the file; putting the image where the text puts it is the only
//     answer that is right by construction. Dragging it out onto the page
//     afterwards is one gesture.
//   • fields, footnotes, comments, revision marks, drawing canvases.

import type { PmDoc, PmMark, PmNode } from '@/lib/text/pm'
import { twipsToPx, halfPtToPx, emuToPx } from '@/lib/scene/units'
import { styleForHeading, DOC_STYLES } from '@/lib/text/doc-styles'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export interface DocxSection {
  /** Page size in page px, orientation already applied. */
  page?: { w: number; h: number }
  margins?: { top: number; right: number; bottom: number; left: number }
}

export interface DocxImage {
  /** Stored source for the image node — `opfs:<fileId>` in the app. */
  src: string
}

export interface DocxMapOptions {
  /** XML → Document. The browser passes DOMParser; the test passes a shim. */
  parse: (xml: string) => Document
  /** Relationship id → a stored image, or null to drop it. */
  image?: (relId: string) => DocxImage | null
}

export interface DocxMapResult {
  doc: PmDoc
  section: DocxSection
}

// ── small XML helpers ────────────────────────────────────────────────────
// getElementsByTagNameNS everywhere: a .docx may or may not use the `w:`
// prefix, and matching on the literal prefix is how importers quietly break
// on files from anything but Word.

const kids = (el: Element | null, name: string): Element[] =>
  el ? [...el.childNodes].filter((n): n is Element => n.nodeType === 1 && localName(n as Element) === name) : []

const kid = (el: Element | null, name: string): Element | null => kids(el, name)[0] ?? null

const localName = (el: Element): string => el.localName ?? el.nodeName.replace(/^.*:/, '')

const attr = (el: Element | null, name: string): string | null =>
  el ? (el.getAttributeNS?.(W, name) ?? el.getAttribute(`w:${name}`) ?? el.getAttribute(name)) : null

const num = (el: Element | null, name: string): number | null => {
  const v = attr(el, name)
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** An OOXML on/off attribute: the element's presence means true unless it
 *  carries w:val="0"/"false" — the trap that makes <w:b w:val="0"/> bold. */
const onOff = (el: Element | null): boolean => {
  if (!el) return false
  const v = attr(el, 'val')
  return v !== '0' && v !== 'false' && v !== 'off'
}

// ── run properties → ProseMirror marks ───────────────────────────────────

function runMarks(rPr: Element | null): PmMark[] {
  if (!rPr) return []
  const marks: PmMark[] = []
  if (onOff(kid(rPr, 'b'))) marks.push({ type: 'bold' })
  if (onOff(kid(rPr, 'i'))) marks.push({ type: 'italic' })
  if (onOff(kid(rPr, 'strike'))) marks.push({ type: 'strike' })
  // <w:u> carries the LINE STYLE in w:val; "none" is the off switch, and the
  // usual on/off reading would turn "single" into false.
  const u = kid(rPr, 'u')
  if (u && attr(u, 'val') !== 'none') marks.push({ type: 'underline' })
  if (kid(rPr, 'highlight')) marks.push({ type: 'highlight' })

  const style: Record<string, string> = {}
  const color = attr(kid(rPr, 'color'), 'val')
  // "auto" means "whatever the theme says", which is our default foreground —
  // writing it as a literal colour would freeze black text into dark mode.
  if (color && color !== 'auto' && /^[0-9a-fA-F]{6}$/.test(color)) style.color = `#${color}`
  const sz = num(kid(rPr, 'sz'), 'val')
  if (sz) style.fontSize = `${Math.round(halfPtToPx(sz) * 10) / 10}px`
  const font = attr(kid(rPr, 'rFonts'), 'ascii')
  if (font) style.fontFamily = font
  if (Object.keys(style).length) marks.push({ type: 'textStyle', attrs: style })
  return marks
}

// ── paragraph properties → ProseMirror attrs ─────────────────────────────

const ALIGN: Record<string, string> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }

interface ParaProps {
  attrs: Record<string, unknown>
  styleId: string | null
  list: { level: number; ordered: boolean } | null
  breakBefore: boolean
}

function paraProps(pPr: Element | null, numFmt: (numId: string, ilvl: number) => boolean): ParaProps {
  const attrs: Record<string, unknown> = {}
  if (!pPr) return { attrs, styleId: null, list: null, breakBefore: false }

  const styleId = attr(kid(pPr, 'pStyle'), 'val')
  const jc = attr(kid(pPr, 'jc'), 'val')
  if (jc && ALIGN[jc]) attrs.align = ALIGN[jc]

  const ind = kid(pPr, 'ind')
  if (ind) {
    const left = num(ind, 'left') ?? num(ind, 'start')
    const right = num(ind, 'right') ?? num(ind, 'end')
    const first = num(ind, 'firstLine')
    const hanging = num(ind, 'hanging')
    if (left) attrs.indentLeft = Math.round(twipsToPx(left))
    if (right) attrs.indentRight = Math.round(twipsToPx(right))
    // A hanging indent is a NEGATIVE first-line indent — the same thing CSS
    // text-indent already expresses, so no separate concept is needed.
    if (hanging) attrs.indentFirstLine = -Math.round(twipsToPx(hanging))
    else if (first) attrs.indentFirstLine = Math.round(twipsToPx(first))
  }

  const spacing = kid(pPr, 'spacing')
  if (spacing) {
    const before = num(spacing, 'before')
    const after = num(spacing, 'after')
    if (before !== null) attrs.spaceBefore = Math.round(twipsToPx(before))
    if (after !== null) attrs.spaceAfter = Math.round(twipsToPx(after))
    const line = num(spacing, 'line')
    // w:lineRule="auto" makes w:line a multiple in 240ths; the exact/atLeast
    // rules make it twips, which we convert to a ratio against the body size.
    if (line) {
      const rule = attr(spacing, 'lineRule')
      attrs.lineHeight =
        rule === 'exact' || rule === 'atLeast'
          ? Math.round((twipsToPx(line) / 16) * 100) / 100
          : Math.round((line / 240) * 100) / 100
    }
  }

  if (onOff(kid(pPr, 'keepNext'))) attrs.keepWithNext = true
  if (onOff(kid(pPr, 'keepLines'))) attrs.keepTogether = true

  const numPr = kid(pPr, 'numPr')
  const numId = attr(kid(numPr, 'numId'), 'val')
  const ilvl = num(kid(numPr, 'ilvl'), 'val') ?? 0
  const list = numId && numId !== '0' ? { level: ilvl, ordered: numFmt(numId, ilvl) } : null

  return { attrs, styleId, list, breakBefore: onOff(kid(pPr, 'pageBreakBefore')) }
}

// ── numbering.xml: is this list ordered or bulleted? ─────────────────────

function numberingLookup(numbering: Document | null): (numId: string, ilvl: number) => boolean {
  if (!numbering) return () => false
  const root = numbering.documentElement
  const abstractFor = new Map<string, string>()
  for (const n of kids(root, 'num')) {
    const id = attr(n, 'numId')
    const abs = attr(kid(n, 'abstractNumId'), 'val')
    if (id && abs) abstractFor.set(id, abs)
  }
  const fmt = new Map<string, string>()
  for (const a of kids(root, 'abstractNum')) {
    const absId = attr(a, 'abstractNumId')
    for (const lvl of kids(a, 'lvl')) {
      const i = attr(lvl, 'ilvl')
      const f = attr(kid(lvl, 'numFmt'), 'val')
      if (absId !== null && i !== null && f) fmt.set(`${absId}:${i}`, f)
    }
  }
  return (numId, ilvl) => {
    const abs = abstractFor.get(numId)
    if (abs === undefined) return false
    const f = fmt.get(`${abs}:${ilvl}`) ?? fmt.get(`${abs}:0`)
    // Everything that is not an explicit bullet (decimal, lowerRoman,
    // upperLetter…) numbers, so ordered is the safer default of the two.
    return f !== undefined && f !== 'bullet' && f !== 'none'
  }
}

// ── inline content ───────────────────────────────────────────────────────

/** A paragraph's runs, flattened. Splits at explicit page breaks: each entry
 *  after the first begins a new paragraph on a new page. */
function runsOf(p: Element, opts: DocxMapOptions): { content: PmNode[]; page: boolean }[] {
  const out: { content: PmNode[]; page: boolean }[] = [{ content: [], page: false }]
  const push = (n: PmNode) => out[out.length - 1].content.push(n)

  const walk = (parent: Element) => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType !== 1) continue
      const el = node as Element
      const name = localName(el)
      // Hyperlinks and smart-tag wrappers hold runs; recurse rather than
      // special-casing each container.
      if (name === 'hyperlink' || name === 'smartTag' || name === 'sdt' || name === 'sdtContent') {
        walk(el)
        continue
      }
      if (name !== 'r') continue
      const marks = runMarks(kid(el, 'rPr'))
      for (const child of [...el.childNodes]) {
        if (child.nodeType !== 1) continue
        const c = child as Element
        switch (localName(c)) {
          case 't': {
            const text = c.textContent ?? ''
            if (text) push(marks.length ? { type: 'text', text, marks } : { type: 'text', text })
            break
          }
          case 'tab':
            push({ type: 'text', text: '\t' })
            break
          case 'br':
            if (attr(c, 'type') === 'page') out.push({ content: [], page: true })
            else push({ type: 'hardBreak' })
            break
          case 'drawing':
          case 'pict': {
            const img = imageOf(c, opts)
            if (img) push(img)
            break
          }
        }
      }
    }
  }
  walk(p)
  return out
}

/** A <w:drawing> → a docImage node, inline or anchored alike. */
function imageOf(drawing: Element, opts: DocxMapOptions): PmNode | null {
  if (!opts.image) return null
  const blips = drawing.getElementsByTagName('*')
  let relId: string | null = null
  for (const el of [...blips]) {
    if (localName(el) === 'blip') {
      relId = el.getAttribute('r:embed') ?? el.getAttribute('embed')
      break
    }
  }
  if (!relId) return null
  const img = opts.image(relId)
  if (!img) return null
  // <wp:extent> is the drawing's DISPLAY size (what Word shows), not the
  // image's intrinsic pixel size — which is the one worth keeping, since a
  // 4000px photo scaled to 3 inches in Word must arrive scaled to 3 inches
  // here too. Present on both <wp:inline> and <wp:anchor>.
  let ext: Element | null = null
  for (const el of [...drawing.getElementsByTagName('*')]) {
    if (localName(el) === 'extent') {
      ext = el
      break
    }
  }
  const cx = Number(ext?.getAttribute('cx') ?? 0)
  const cy = Number(ext?.getAttribute('cy') ?? 0)
  const attrs: Record<string, unknown> = { src: img.src }
  if (cx > 0 && cy > 0) {
    attrs.width = Math.round(emuToPx(cx))
    attrs.height = Math.round(emuToPx(cy))
  }
  return { type: 'docImage', attrs }
}

// ── blocks ───────────────────────────────────────────────────────────────

interface Flat {
  node: PmNode
  list: { level: number; ordered: boolean } | null
}

function paragraphNodes(p: Element, opts: DocxMapOptions, numFmt: (n: string, i: number) => boolean): Flat[] {
  const props = paraProps(kid(p, 'pPr'), numFmt)
  const chunks = runsOf(p, opts)
  const out: Flat[] = []

  if (props.breakBefore) out.push({ node: { type: 'pageBreak' }, list: null })

  chunks.forEach((chunk, i) => {
    if (i > 0) out.push({ node: { type: 'pageBreak' }, list: null })
    // A <w:br w:type="page"/> usually sits alone in its own paragraph, which
    // splits into an empty chunk on each side of the break. Those are an
    // artefact of the split, not blank lines the author typed — a paragraph
    // that was NOT split keeps its emptiness, because there it is deliberate.
    if (chunks.length > 1 && chunk.content.length === 0) return
    const heading = headingLevel(props.styleId)
    const attrs = { ...props.attrs }
    // A style we have no definition for adds nothing but noise, and Word
    // sprinkles built-ins like ListParagraph over content whose formatting we
    // already reproduce structurally.
    if (props.styleId && !heading && props.styleId in DOC_STYLES) attrs.style = props.styleId
    const node: PmNode = heading
      ? { type: 'heading', attrs: { ...attrs, level: heading, style: styleForHeading(heading) } }
      : { type: 'paragraph', attrs }
    // ProseMirror omits `content` on an empty textblock rather than carrying
    // an empty array — matching that keeps documents comparable.
    if (chunk.content.length) node.content = chunk.content
    if (!Object.keys(node.attrs ?? {}).length) delete node.attrs
    out.push({ node, list: props.list })
  })
  return out
}

/** "Heading2" / "berschrift2" / "Title" → the level this becomes, or 0. */
function headingLevel(styleId: string | null): number {
  if (!styleId) return 0
  if (/^title$/i.test(styleId)) return 1
  const m = styleId.match(/(\d)\s*$/)
  return /heading|title|berschrift|titre|ttulo/i.test(styleId) && m ? Math.min(3, Number(m[1])) : 0
}

const LIST_NODE = { bullet: 'bulletList', ordered: 'orderedList' } as const

/** Groups a maximal run of consecutive list paragraphs of one kind into a
 *  real nested list, exactly as lib/text/pm.ts does for the legacy model:
 *  a deeper item nests inside the previous one, a shallower one closes out. */
function buildList(items: Flat[], from: number): { node: PmNode; next: number } {
  const base = items[from].list!
  const kind = base.ordered ? 'ordered' : 'bullet'
  const listItems: PmNode[] = []
  let i = from

  while (i < items.length && items[i].list && items[i].list!.level >= base.level) {
    const cur = items[i].list!
    if (cur.level > base.level) {
      if (listItems.length === 0) listItems.push({ type: 'listItem', content: [{ type: 'paragraph' }] })
      const nested = buildList(items, i)
      const host = listItems[listItems.length - 1]
      host.content = [...(host.content ?? []), nested.node]
      i = nested.next
      continue
    }
    // A change of kind at the SAME level ends this list and starts another —
    // Word writes bulleted and numbered runs as separate numIds.
    if (cur.ordered !== base.ordered) break
    listItems.push({ type: 'listItem', content: [items[i].node] })
    i++
  }
  return { node: { type: LIST_NODE[kind], content: listItems }, next: i }
}

function tableNode(tbl: Element, opts: DocxMapOptions, numFmt: (n: string, i: number) => boolean): PmNode {
  const rows: PmNode[] = []
  for (const tr of kids(tbl, 'tr')) {
    const cells: PmNode[] = []
    for (const tc of kids(tr, 'tc')) {
      const content = blocksOf(tc, opts, numFmt)
      const tcPr = kid(tc, 'tcPr')
      const span = num(kid(tcPr, 'gridSpan'), 'val')
      const attrs: Record<string, unknown> = {}
      if (span && span > 1) attrs.colspan = span
      cells.push({
        type: 'tableCell',
        ...(Object.keys(attrs).length ? { attrs } : {}),
        // A ProseMirror table cell may never be empty.
        content: content.length ? content : [{ type: 'paragraph' }],
      })
    }
    if (cells.length) rows.push({ type: 'tableRow', content: cells })
  }
  return rows.length ? { type: 'table', content: rows } : { type: 'paragraph' }
}

/** Block children of a body or a table cell, with list runs collapsed. */
function blocksOf(parent: Element, opts: DocxMapOptions, numFmt: (n: string, i: number) => boolean): PmNode[] {
  const flat: Flat[] = []
  for (const node of [...parent.childNodes]) {
    if (node.nodeType !== 1) continue
    const el = node as Element
    const name = localName(el)
    if (name === 'p') flat.push(...paragraphNodes(el, opts, numFmt))
    else if (name === 'tbl') flat.push({ node: tableNode(el, opts, numFmt), list: null })
  }

  const out: PmNode[] = []
  let i = 0
  while (i < flat.length) {
    if (flat[i].list) {
      const { node, next } = buildList(flat, i)
      out.push(node)
      i = next
      continue
    }
    out.push(flat[i].node)
    i++
  }
  return out
}

// ── section properties ───────────────────────────────────────────────────

function sectionOf(body: Element): DocxSection {
  const sectPr = kid(body, 'sectPr')
  if (!sectPr) return {}
  const out: DocxSection = {}
  const pgSz = kid(sectPr, 'pgSz')
  const w = num(pgSz, 'w')
  const h = num(pgSz, 'h')
  if (w && h) {
    // w:orient is advisory; Word also swaps w/h itself. Trusting the numbers
    // and only using orient to correct a disagreement avoids double-rotating.
    const landscape = attr(pgSz, 'orient') === 'landscape'
    const [pw, ph] = landscape && h > w ? [h, w] : [w, h]
    out.page = { w: Math.round(twipsToPx(pw)), h: Math.round(twipsToPx(ph)) }
  }
  const pgMar = kid(sectPr, 'pgMar')
  if (pgMar) {
    out.margins = {
      top: Math.round(twipsToPx(num(pgMar, 'top') ?? 1440)),
      right: Math.round(twipsToPx(num(pgMar, 'right') ?? 1440)),
      bottom: Math.round(twipsToPx(num(pgMar, 'bottom') ?? 1440)),
      left: Math.round(twipsToPx(num(pgMar, 'left') ?? 1440)),
    }
  }
  return out
}

// ── entry point ──────────────────────────────────────────────────────────

export function mapDocxDocument(
  xml: { document: string; numbering?: string },
  opts: DocxMapOptions
): DocxMapResult {
  const doc = opts.parse(xml.document)
  const body = kid(doc.documentElement, 'body')
  if (!body) return { doc: { type: 'doc', content: [{ type: 'paragraph' }] }, section: {} }

  const numFmt = numberingLookup(xml.numbering ? opts.parse(xml.numbering) : null)
  const content = blocksOf(body, opts, numFmt)
  // A ProseMirror document may never be empty.
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { doc: { type: 'doc', content }, section: sectionOf(body) }
}
