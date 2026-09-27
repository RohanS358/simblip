// word/document.xml → a ProseMirror document.
//
// The mapping half of .docx import, kept apart from the zip/OPFS half in
// docx-import.ts so it is a pure function of some XML strings and can be run
// — and tested — outside a browser.
//
// A Word file IS a flowing document, and so is the page it opens into, so
// the two models line up: paragraph → paragraph, run → marked text, list →
// list, table → table, and the layout is recomputed rather than transcribed.
//
// Reference: ECMA-376 Part 1, §17 (WordprocessingML) and §22.1 (Office Math).
//
// Mapped:
//   • styles.xml — headings are found by style NAME / outline level (a file
//     from a localized or non-Word editor rarely has styleId "Heading1"),
//     and character/paragraph styles contribute their bold/italic/colour…
//   • hyperlinks (external), sub/superscript, highlight, Symbol-font Greek
//   • tracked insertions, field results and content controls (a TOC lives in
//     one) — their text is part of the document as displayed
//   • images, including ones wrapped in <mc:AlternateContent>, and the text
//     of text boxes (after the paragraph that anchors them)
//   • equations (OMML) → readable inline text with real super/subscripts
//   • tables with horizontal AND vertical merges, column widths, header rows
//   • list numbering that continues across interrupting paragraphs, in the
//     file's own style (1. / a. / i. / A. / I.)
//
// Deliberately NOT mapped:
//   • floating (<wp:anchor>) images keep their INLINE reading position rather
//     than becoming free-floating objects. Which page a Word anchor lands on
//     is a result of Word's own layout, which we do not have and cannot infer
//     from the file; putting the image where the text puts it is the only
//     answer that is right by construction.
//   • footnotes, comments, deleted revisions, headers/footers.

import type { PmDoc, PmMark, PmNode } from '@/lib/text/pm'
import { twipsToPx, halfPtToPx, emuToPx } from '@/lib/scene/units'
import { styleForHeading, DOC_STYLES } from '@/lib/text/doc-styles'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

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
  /** Relationship id → an external hyperlink target, or null. */
  link?: (relId: string) => string | null
}

export interface DocxMapResult {
  doc: PmDoc
  section: DocxSection
}

// ── small XML helpers ────────────────────────────────────────────────────
// Match on localName everywhere: a .docx may or may not use the `w:`
// prefix, and matching on the literal prefix is how importers quietly break
// on files from anything but Word.

const localName = (el: Element): string => el.localName ?? el.nodeName.replace(/^.*:/, '')

const kids = (el: Element | null, name: string): Element[] =>
  el ? [...el.childNodes].filter((n): n is Element => n.nodeType === 1 && localName(n as Element) === name) : []

const kid = (el: Element | null, name: string): Element | null => kids(el, name)[0] ?? null

const elements = (el: Element): Element[] => [...el.childNodes].filter((n): n is Element => n.nodeType === 1)

const attr = (el: Element | null, name: string): string | null =>
  el ? (el.getAttributeNS?.(W, name) || el.getAttribute(`w:${name}`) || el.getAttribute(name) || null) : null

const mattr = (el: Element | null, name: string): string | null =>
  el ? (el.getAttributeNS?.(M, name) || el.getAttribute(`m:${name}`) || el.getAttribute(name) || null) : null

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

function descendant(el: Element, name: string): Element | null {
  for (const d of [...el.getElementsByTagName('*')]) if (localName(d) === name) return d
  return null
}

// ── styles.xml ───────────────────────────────────────────────────────────

interface StyleDef {
  id: string
  name: string
  type: string
  basedOn: string | null
  isDefault: boolean
  pPr: Element | null
  rPr: Element | null
}

type Styles = Map<string, StyleDef>

function styleTable(doc: Document | null): Styles {
  const out: Styles = new Map()
  if (!doc) return out
  for (const s of kids(doc.documentElement, 'style')) {
    const id = attr(s, 'styleId')
    if (!id) continue
    out.set(id, {
      id,
      name: (attr(kid(s, 'name'), 'val') ?? id).toLowerCase(),
      type: attr(s, 'type') ?? 'paragraph',
      basedOn: attr(kid(s, 'basedOn'), 'val'),
      isDefault: ['1', 'true', 'on'].includes(attr(s, 'default') ?? ''),
      pPr: kid(s, 'pPr'),
      rPr: kid(s, 'rPr'),
    })
  }
  return out
}

/** The style and everything it's based on, most-basic first. */
function styleChain(styles: Styles, id: string | null): StyleDef[] {
  const out: StyleDef[] = []
  let cur = id
  for (let i = 0; cur && i < 12; i++) {
    const s = styles.get(cur)
    if (!s || out.includes(s)) break
    out.unshift(s)
    cur = s.basedOn
  }
  return out
}

/** "Heading 2" / "Title" / an outline level → the heading level, or 0. */
function headingLevel(styles: Styles, styleId: string | null, pPr: Element | null): number {
  const own = num(kid(pPr, 'outlineLvl'), 'val')
  if (own !== null && own < 9) return Math.min(3, own + 1)
  for (const s of styleChain(styles, styleId).reverse()) {
    if (s.name === 'title') return 1
    const m = s.name.match(/^heading\s*(\d)$/)
    if (m) return Math.min(3, Math.max(1, Number(m[1])))
    const lvl = num(kid(s.pPr, 'outlineLvl'), 'val')
    if (lvl !== null && lvl < 9) return Math.min(3, lvl + 1)
  }
  // No styles.xml (or an unnamed style): fall back to the id itself —
  // "Heading2", German "berschrift2", French "Titre2"…
  if (!styleId) return 0
  if (/^title$/i.test(styleId)) return 1
  const m = styleId.match(/(\d)\s*$/)
  return /heading|title|berschrift|titre|ttulo/i.test(styleId) && m ? Math.min(3, Number(m[1])) : 0
}

// ── run properties ───────────────────────────────────────────────────────
// Read into a plain object first so style layers can be MERGED (direct
// formatting overrides a character style, which overrides a paragraph
// style) — with explicit `false` able to switch an inherited bold off.

interface RunProps {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  underline?: boolean
  highlight?: boolean
  script?: 'sup' | 'sub' | null
  color?: string | null
  size?: string
  font?: string
}

function readRunProps(rPr: Element | null): RunProps {
  const p: RunProps = {}
  if (!rPr) return p
  const b = kid(rPr, 'b')
  if (b) p.bold = onOff(b)
  const i = kid(rPr, 'i')
  if (i) p.italic = onOff(i)
  const st = kid(rPr, 'strike') ?? kid(rPr, 'dstrike')
  if (st) p.strike = onOff(st)
  // <w:u> carries the LINE STYLE in w:val; "none" is the off switch, and the
  // usual on/off reading would turn "single" into false.
  const u = kid(rPr, 'u')
  if (u) p.underline = attr(u, 'val') !== 'none'
  const hl = kid(rPr, 'highlight')
  if (hl) p.highlight = attr(hl, 'val') !== 'none'
  const va = attr(kid(rPr, 'vertAlign'), 'val')
  if (va) p.script = va === 'superscript' ? 'sup' : va === 'subscript' ? 'sub' : null
  const color = attr(kid(rPr, 'color'), 'val')
  // "auto" means "whatever the theme says", which is our default foreground —
  // writing it as a literal colour would freeze black text into dark mode.
  if (color) p.color = color !== 'auto' && /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : null
  const sz = num(kid(rPr, 'sz'), 'val')
  if (sz) p.size = `${Math.round(halfPtToPx(sz) * 10) / 10}px`
  const fonts = kid(rPr, 'rFonts')
  const font = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? attr(fonts, 'cs')
  if (font) p.font = font
  return p
}

const styleRunProps = (styles: Styles, id: string | null): RunProps =>
  styleChain(styles, id)
    .filter((s) => !s.isDefault)
    .reduce<RunProps>((acc, s) => ({ ...acc, ...readRunProps(s.rPr) }), {})

function marksOf(p: RunProps, href: string | null): PmMark[] {
  const marks: PmMark[] = []
  if (p.bold) marks.push({ type: 'bold' })
  if (p.italic) marks.push({ type: 'italic' })
  if (p.strike) marks.push({ type: 'strike' })
  if (p.underline) marks.push({ type: 'underline' })
  if (p.highlight) marks.push({ type: 'highlight' })
  if (p.script === 'sup') marks.push({ type: 'superscript' })
  if (p.script === 'sub') marks.push({ type: 'subscript' })
  if (href) marks.push({ type: 'link', attrs: { href } })
  const style: Record<string, string> = {}
  if (p.color) style.color = p.color
  if (p.size) style.fontSize = p.size
  if (p.font && !/^symbol$/i.test(p.font)) style.fontFamily = p.font
  if (Object.keys(style).length) marks.push({ type: 'textStyle', attrs: style })
  return marks
}

// The Symbol font puts Greek (and maths) on ASCII code points — an old .docx
// that typed "a" in Symbol means α. Without this, equations read as Latin.
const SYMBOL_GREEK = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'
const SYMBOL_greek = 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'
const SYMBOL_MISC: Record<number, string> = {
  0xa3: '≤', 0xa5: '∞', 0xac: '←', 0xad: '↑', 0xae: '→', 0xaf: '↓', 0xb0: '°', 0xb1: '±', 0xb3: '≥',
  0xb4: '×', 0xb5: '∝', 0xb6: '∂', 0xb7: '•', 0xb8: '÷', 0xb9: '≠', 0xba: '≡', 0xbb: '≈', 0xc5: '⊕',
  0xd1: '∇', 0xd5: '∏', 0xd6: '√', 0xd7: '⋅', 0xdb: '⇔', 0xde: '⇒', 0xe5: '∑', 0xf2: '∫', 0x22: '∀', 0x24: '∃',
}

function symbolChar(code: number): string {
  const c = code >= 0xf000 ? code - 0xf000 : code
  if (c >= 65 && c <= 90) return SYMBOL_GREEK[c - 65]
  if (c >= 97 && c <= 122) return SYMBOL_greek[c - 97]
  return SYMBOL_MISC[c] ?? String.fromCharCode(c)
}

const symbolText = (t: string) => [...t].map((ch) => symbolChar(ch.charCodeAt(0))).join('')

// ── paragraph properties → ProseMirror attrs ─────────────────────────────

const ALIGN: Record<string, string> = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }

interface ListRef {
  level: number
  ordered: boolean
  numId: string
  fmt: string
  start: number
}

interface ParaProps {
  attrs: Record<string, unknown>
  styleId: string | null
  list: ListRef | null
  breakBefore: boolean
  heading: number
}

function paraProps(pPr: Element | null, ctx: Ctx): ParaProps {
  const attrs: Record<string, unknown> = {}
  const styleId = attr(kid(pPr, 'pStyle'), 'val')
  const heading = headingLevel(ctx.styles, styleId, pPr)
  if (!pPr) return { attrs, styleId: null, list: null, breakBefore: false, heading }

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

  // Numbering: the paragraph's own <w:numPr>, else one its style carries
  // (common for "List Number"-style paragraphs). A numbered heading style
  // stays a heading — we don't turn a document's chapters into a list.
  let numPr = kid(pPr, 'numPr')
  if (!numPr && !heading) for (const s of styleChain(ctx.styles, styleId).reverse()) if ((numPr = kid(s.pPr, 'numPr'))) break
  const numId = attr(kid(numPr, 'numId'), 'val')
  const ilvl = num(kid(numPr, 'ilvl'), 'val') ?? 0
  const list = numId && numId !== '0' && !heading ? { level: ilvl, numId, ...ctx.numFmt(numId, ilvl) } : null

  return { attrs, styleId, list, breakBefore: onOff(kid(pPr, 'pageBreakBefore')), heading }
}

// ── numbering.xml ────────────────────────────────────────────────────────

interface NumFmt {
  ordered: boolean
  fmt: string
  start: number
}

function numberingLookup(numbering: Document | null): (numId: string, ilvl: number) => NumFmt {
  // Missing numbering.xml: still a list, bulleted (the safer visual guess).
  if (!numbering) return () => ({ ordered: false, fmt: 'bullet', start: 1 })
  const root = numbering.documentElement
  const abstractFor = new Map<string, string>()
  const startOverride = new Map<string, number>()
  for (const n of kids(root, 'num')) {
    const id = attr(n, 'numId')
    const abs = attr(kid(n, 'abstractNumId'), 'val')
    if (id && abs) abstractFor.set(id, abs)
    for (const o of kids(n, 'lvlOverride')) {
      const s = num(kid(o, 'startOverride'), 'val')
      if (id && s !== null) startOverride.set(`${id}:${attr(o, 'ilvl')}`, s)
    }
  }
  const lvls = new Map<string, { fmt: string; start: number }>()
  for (const a of kids(root, 'abstractNum')) {
    const absId = attr(a, 'abstractNumId')
    for (const lvl of kids(a, 'lvl')) {
      const i = attr(lvl, 'ilvl')
      const f = attr(kid(lvl, 'numFmt'), 'val') ?? 'decimal'
      if (absId !== null && i !== null) lvls.set(`${absId}:${i}`, { fmt: f, start: num(kid(lvl, 'start'), 'val') ?? 1 })
    }
  }
  return (numId, ilvl) => {
    const abs = abstractFor.get(numId)
    const l = abs === undefined ? undefined : (lvls.get(`${abs}:${ilvl}`) ?? lvls.get(`${abs}:0`))
    if (!l) return { ordered: false, fmt: 'bullet', start: 1 }
    // Everything that is not an explicit bullet (decimal, lowerRoman,
    // upperLetter…) numbers, so ordered is the safer default of the two.
    return {
      ordered: l.fmt !== 'bullet' && l.fmt !== 'none',
      fmt: l.fmt,
      start: startOverride.get(`${numId}:${ilvl}`) ?? l.start,
    }
  }
}

const OL_TYPE: Record<string, string> = { lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I' }

// ── context ──────────────────────────────────────────────────────────────

interface Ctx {
  opts: DocxMapOptions
  styles: Styles
  numFmt: (numId: string, ilvl: number) => NumFmt
  /** numId → running counter per level, shared across the whole document so
   *  a list interrupted by an answer paragraph resumes at 2, not 1. */
  counters: Map<string, number[]>
}

// ── equations (OMML) ─────────────────────────────────────────────────────
// Office Math → linear text with REAL super/subscript marks: x² stays x²,
// not "x2". Nested scripts fall back to ^( ) / _( ) since a mark can't nest.

interface Seg {
  text: string
  script: 'sup' | 'sub' | null
  italic?: boolean
}

function segText(segs: Seg[]): string {
  return segs.map((s) => s.text).join('')
}

function omml(el: Element, script: Seg['script']): Seg[] {
  const sub = (name: string, sc: Seg['script'] = script) => {
    const k = kid(el, name)
    return k ? ommlChildren(k, sc) : []
  }
  const inScript = (name: string, sc: 'sup' | 'sub'): Seg[] => {
    if (script === null) return sub(name, sc)
    // Already in a script: can't nest the mark — spell it out.
    const inner = segText(sub(name, script))
    return inner ? [{ text: `${sc === 'sup' ? '^' : '_'}(${inner})`, script }] : []
  }
  const wrap = (segs: Seg[]): Seg[] =>
    segText(segs).length > 1 ? [{ text: '(', script }, ...segs, { text: ')', script }] : segs
  const lit = (text: string): Seg => ({ text, script })

  switch (localName(el)) {
    case 'r': {
      let text = ''
      for (const c of elements(el)) if (localName(c) === 't') text += c.textContent ?? ''
      // Word shows single-letter variables italic unless styled plain.
      const plain = mattr(descendant(el, 'sty') ?? null, 'val') === 'p'
      return text ? [{ text, script, italic: !plain && /^[A-Za-z]$/.test(text) }] : []
    }
    case 'f': {
      const n = sub('num')
      const d = sub('den')
      return [...wrap(n), lit('/'), ...wrap(d)]
    }
    case 'sSup':
      return [...sub('e'), ...inScript('sup', 'sup')]
    case 'sSub':
      return [...sub('e'), ...inScript('sub', 'sub')]
    case 'sSubSup':
      return [...sub('e'), ...inScript('sub', 'sub'), ...inScript('sup', 'sup')]
    case 'sPre':
      return [...inScript('sub', 'sub'), ...inScript('sup', 'sup'), ...sub('e')]
    case 'rad': {
      const deg = sub('deg')
      const degSegs = segText(deg) ? inScript('deg', 'sup') : []
      return [...degSegs, lit('√'), ...wrap(sub('e'))]
    }
    case 'd': {
      const pr = kid(el, 'dPr')
      const beg = mattr(kid(pr, 'begChr'), 'val') ?? '('
      const end = mattr(kid(pr, 'endChr'), 'val') ?? ')'
      const sep = mattr(kid(pr, 'sepChr'), 'val') ?? '|'
      const parts = kids(el, 'e').map((e) => ommlChildren(e, script))
      const out: Seg[] = [lit(beg)]
      parts.forEach((p, i) => {
        if (i > 0) out.push(lit(sep))
        out.push(...p)
      })
      out.push(lit(end))
      return out
    }
    case 'nary': {
      const chr = mattr(kid(kid(el, 'naryPr'), 'chr'), 'val') ?? '∫'
      return [lit(chr), ...inScript('sub', 'sub'), ...inScript('sup', 'sup'), lit(' '), ...sub('e')]
    }
    case 'func':
      return [...sub('fName'), lit(' '), ...sub('e')]
    case 'acc': {
      const chr = mattr(kid(kid(el, 'accPr'), 'chr'), 'val') ?? '̂'
      return [...sub('e'), lit(chr)]
    }
    case 'bar':
      return [...sub('e'), lit('̅')]
    case 'limLow':
      return [...sub('e'), ...inScript('lim', 'sub')]
    case 'limUp':
      return [...sub('e'), ...inScript('lim', 'sup')]
    case 'eqArr':
      return kids(el, 'e').flatMap((e, i) => [...(i ? [lit(';  ')] : []), ...ommlChildren(e, script)])
    case 'm':
      return [
        lit('['),
        ...kids(el, 'mr').flatMap((r, i) => [
          ...(i ? [lit('; ')] : []),
          ...kids(r, 'e').flatMap((e, j) => [...(j ? [lit(', ')] : []), ...ommlChildren(e, script)]),
        ]),
        lit(']'),
      ]
    // property blocks carry no content
    case 'rPr':
    case 'ctrlPr':
    case 'fPr':
    case 'sSupPr':
    case 'sSubPr':
    case 'sSubSupPr':
    case 'radPr':
    case 'dPr':
    case 'naryPr':
    case 'funcPr':
    case 'accPr':
    case 'barPr':
    case 'oMathParaPr':
      return []
    default:
      return ommlChildren(el, script)
  }
}

function ommlChildren(el: Element, script: Seg['script']): Seg[] {
  return elements(el).flatMap((c) => omml(c, script))
}

function mathNodes(el: Element, base: RunProps): PmNode[] {
  const segs = omml(el, null)
  const out: PmNode[] = []
  for (const s of segs) {
    if (!s.text) continue
    const marks = marksOf({ ...base, italic: s.italic || base.italic, script: s.script }, null)
    const prev = out[out.length - 1]
    // Merge neighbours with identical marks so "x+1" isn't five nodes.
    if (prev && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) prev.text = (prev.text ?? '') + s.text
    else out.push(marks.length ? { type: 'text', text: s.text, marks } : { type: 'text', text: s.text })
  }
  return out
}

// ── inline content ───────────────────────────────────────────────────────

interface Chunk {
  content: PmNode[]
  page: boolean
}

/** A paragraph's runs, flattened. Splits at explicit page breaks: each entry
 *  after the first begins a new paragraph on a new page. `extra` collects
 *  block content found inline (text-box paragraphs). */
function runsOf(p: Element, ctx: Ctx, paraBase: RunProps, extra: Flat[]): Chunk[] {
  const out: Chunk[] = [{ content: [], page: false }]
  const push = (n: PmNode) => out[out.length - 1].content.push(n)

  const runChild = (c: Element, props: RunProps, href: string | null, symbolFont: boolean) => {
    const marks = marksOf(props, href)
    const text = (t: string) => {
      if (!t) return
      const value = symbolFont ? symbolText(t) : t
      push(marks.length ? { type: 'text', text: value, marks } : { type: 'text', text: value })
    }
    switch (localName(c)) {
      case 't':
        text(c.textContent ?? '')
        break
      case 'tab':
        text('\t')
        break
      case 'noBreakHyphen':
        text('‑')
        break
      case 'softHyphen':
        text('­')
        break
      case 'sym': {
        const code = parseInt(attr(c, 'char') ?? '', 16)
        if (Number.isFinite(code)) {
          const font = attr(c, 'font') ?? ''
          text(/symbol/i.test(font) ? symbolChar(code) : String.fromCharCode(code >= 0xf000 ? code - 0xf000 : code))
        }
        break
      }
      case 'br':
        if (attr(c, 'type') === 'page') out.push({ content: [], page: true })
        else push({ type: 'hardBreak' })
        break
      case 'cr':
        push({ type: 'hardBreak' })
        break
      case 'AlternateContent': {
        // Newer content with a legacy fallback: take the modern branch only,
        // or the image/text box would arrive twice.
        const branch = kid(c, 'Choice') ?? kid(c, 'Fallback')
        if (branch) for (const g of elements(branch)) runChild(g, props, href, symbolFont)
        break
      }
      case 'drawing':
      case 'pict':
      case 'object': {
        const img = imageOf(c, ctx.opts)
        if (img) push(img)
        const box = descendant(c, 'txbxContent')
        if (box) extra.push(...blockFlats(box, ctx))
        break
      }
    }
  }

  const walk = (parent: Element, href: string | null) => {
    for (const el of elements(parent)) {
      const name = localName(el)
      switch (name) {
        case 'hyperlink': {
          const rid = el.getAttribute('r:id') ?? el.getAttribute('id')
          const target = rid && ctx.opts.link ? ctx.opts.link(rid) : null
          walk(el, target && /^(https?:|mailto:)/i.test(target) ? target : href)
          continue
        }
        // Containers whose text is part of the displayed document: smart
        // tags, content controls, tracked INSERTIONS, moved-to text and
        // simple fields (their result runs). Deletions are simply skipped.
        case 'smartTag':
        case 'sdt':
        case 'sdtContent':
        case 'ins':
        case 'moveTo':
        case 'fldSimple':
        case 'customXml':
        case 'bdo':
        case 'dir':
          walk(el, href)
          continue
        case 'oMath':
        case 'oMathPara':
          for (const n of mathNodes(el, paraBase)) push(n)
          continue
        case 'r': {
          const rPr = kid(el, 'rPr')
          const props = {
            ...paraBase,
            ...styleRunProps(ctx.styles, attr(kid(rPr, 'rStyle'), 'val')),
            ...readRunProps(rPr),
          }
          // A hyperlink run usually carries the "Hyperlink" character style
          // (blue + underline) — the link mark already renders as a link.
          if (href) {
            delete props.color
            delete props.underline
          }
          const symbolFont = /^symbol$/i.test(props.font ?? '')
          for (const c of elements(el)) runChild(c, props, href, symbolFont)
          continue
        }
      }
    }
  }
  walk(p, null)
  return out
}

/** A <w:drawing> → a docImage node, inline or anchored alike. */
function imageOf(drawing: Element, opts: DocxMapOptions): PmNode | null {
  if (!opts.image) return null
  let relId: string | null = null
  for (const el of [...drawing.getElementsByTagName('*')]) {
    const n = localName(el)
    if (n === 'blip') relId = el.getAttribute('r:embed') ?? el.getAttribute('embed')
    else if (n === 'imagedata') relId = el.getAttribute('r:id') ?? el.getAttribute('id') // VML (legacy <w:pict>)
    if (relId) break
  }
  if (!relId) return null
  const img = opts.image(relId)
  if (!img) return null
  // <wp:extent> is the drawing's DISPLAY size (what Word shows), not the
  // image's intrinsic pixel size — which is the one worth keeping, since a
  // 4000px photo scaled to 3 inches in Word must arrive scaled to 3 inches
  // here too. Present on both <wp:inline> and <wp:anchor>.
  const ext = descendant(drawing, 'extent')
  const cx = Number(ext?.getAttribute('cx') ?? 0)
  const cy = Number(ext?.getAttribute('cy') ?? 0)
  const attrs: Record<string, unknown> = { src: img.src }
  if (cx > 0 && cy > 0) {
    attrs.width = Math.round(emuToPx(cx))
    attrs.height = Math.round(emuToPx(cy))
  }
  const alt = descendant(drawing, 'docPr')?.getAttribute('descr')
  if (alt) attrs.alt = alt
  return { type: 'docImage', attrs }
}

// ── blocks ───────────────────────────────────────────────────────────────

interface Flat {
  node: PmNode
  list: ListRef | null
}

function paragraphNodes(p: Element, ctx: Ctx): Flat[] {
  const pPr = kid(p, 'pPr')
  const props = paraProps(pPr, ctx)
  // A heading's look comes from OUR heading style; for body text the
  // paragraph style's run formatting (e.g. a bold "Question" style) is part
  // of how the text looks, so it becomes marks. The default ("Normal")
  // style is skipped: that's our body style, and pinning its 11pt onto
  // every run would freeze the whole document's size.
  const paraBase = props.heading ? {} : styleRunProps(ctx.styles, props.styleId)
  const extra: Flat[] = []
  const chunks = runsOf(p, ctx, paraBase, extra)
  const out: Flat[] = []

  if (props.breakBefore) out.push({ node: { type: 'pageBreak' }, list: null })

  chunks.forEach((chunk, i) => {
    if (i > 0) out.push({ node: { type: 'pageBreak' }, list: null })
    // A <w:br w:type="page"/> usually sits alone in its own paragraph, which
    // splits into an empty chunk on each side of the break. Those are an
    // artefact of the split, not blank lines the author typed — a paragraph
    // that was NOT split keeps its emptiness, because there it is deliberate.
    if (chunks.length > 1 && chunk.content.length === 0) return
    const attrs = { ...props.attrs }
    // A style we have no definition for adds nothing but noise, and Word
    // sprinkles built-ins like ListParagraph over content whose formatting we
    // already reproduce structurally.
    if (props.styleId && !props.heading && props.styleId in DOC_STYLES) attrs.style = props.styleId
    const node: PmNode = props.heading
      ? { type: 'heading', attrs: { ...attrs, level: props.heading, style: styleForHeading(props.heading) } }
      : { type: 'paragraph', attrs }
    // ProseMirror omits `content` on an empty textblock rather than carrying
    // an empty array — matching that keeps documents comparable.
    if (chunk.content.length) node.content = chunk.content
    if (!Object.keys(node.attrs ?? {}).length) delete node.attrs
    out.push({ node, list: props.list })
  })
  out.push(...extra)
  return out
}

const LIST_NODE = { bullet: 'bulletList', ordered: 'orderedList' } as const

/** The number this item gets, advancing the document-wide counter. */
function nextNumber(ctx: Ctx, l: ListRef): number {
  const c = ctx.counters.get(l.numId) ?? []
  c[l.level] = c[l.level] === undefined ? l.start : c[l.level] + 1
  c.length = l.level + 1 // deeper levels restart under a new parent
  ctx.counters.set(l.numId, c)
  return c[l.level]
}

/** Groups a maximal run of consecutive list paragraphs of one kind into a
 *  real nested list: a deeper item nests inside the previous one, a
 *  shallower one closes out. */
function buildList(items: Flat[], from: number, ctx: Ctx): { node: PmNode; next: number } {
  const base = items[from].list!
  const kind = base.ordered ? 'ordered' : 'bullet'
  const listItems: PmNode[] = []
  let first: number | null = null
  let i = from

  while (i < items.length && items[i].list && items[i].list!.level >= base.level) {
    const cur = items[i].list!
    if (cur.level > base.level) {
      if (listItems.length === 0) listItems.push({ type: 'listItem', content: [{ type: 'paragraph' }] })
      const nested = buildList(items, i, ctx)
      const host = listItems[listItems.length - 1]
      host.content = [...(host.content ?? []), nested.node]
      i = nested.next
      continue
    }
    // A change of kind, or of list instance, at the SAME level ends this
    // list and starts another — Word writes separate lists as separate numIds.
    if (cur.ordered !== base.ordered || cur.numId !== base.numId) break
    const n = nextNumber(ctx, cur)
    if (first === null) first = n
    listItems.push({ type: 'listItem', content: [items[i].node] })
    i++
  }
  const node: PmNode = { type: LIST_NODE[kind], content: listItems }
  if (kind === 'ordered') {
    const attrs: Record<string, unknown> = {}
    if (first !== null && first !== 1) attrs.start = first
    if (OL_TYPE[base.fmt]) attrs.type = OL_TYPE[base.fmt]
    if (Object.keys(attrs).length) node.attrs = attrs
  }
  return { node, next: i }
}

function tableNode(tbl: Element, ctx: Ctx): PmNode {
  const grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => Math.round(twipsToPx(num(g, 'w') ?? 0)))
  const rows: PmNode[] = []
  // Which cell currently occupies each grid column — a vMerge "continue"
  // cell extends the one above instead of becoming a blank duplicate.
  const above = new Map<number, PmNode>()

  for (const tr of kids(tbl, 'tr')) {
    const trPr = kid(tr, 'trPr')
    const header = onOff(kid(trPr, 'tblHeader'))
    let col = num(kid(trPr, 'gridBefore'), 'val') ?? 0
    const cells: PmNode[] = []
    for (const tc of kids(tr, 'tc')) {
      const tcPr = kid(tc, 'tcPr')
      const span = Math.max(1, num(kid(tcPr, 'gridSpan'), 'val') ?? 1)
      const vMerge = kid(tcPr, 'vMerge')
      const continues = vMerge !== null && attr(vMerge, 'val') !== 'restart'
      const host = continues ? above.get(col) : undefined
      if (host) {
        host.attrs = { ...(host.attrs ?? {}), rowspan: Number(host.attrs?.rowspan ?? 1) + 1 }
        col += span
        continue
      }
      const content = blocksOf(tc, ctx)
      const attrs: Record<string, unknown> = {}
      if (span > 1) attrs.colspan = span
      const widths = grid.slice(col, col + span)
      if (widths.length === span && widths.every((w) => w > 0)) attrs.colwidth = widths
      const cell: PmNode = {
        type: header ? 'tableHeader' : 'tableCell',
        ...(Object.keys(attrs).length ? { attrs } : {}),
        // A ProseMirror table cell may never be empty.
        content: content.length ? content : [{ type: 'paragraph' }],
      }
      cells.push(cell)
      for (let k = col; k < col + span; k++) above.set(k, cell)
      col += span
    }
    if (cells.length) rows.push({ type: 'tableRow', content: cells })
  }
  return rows.length ? { type: 'table', content: rows } : { type: 'paragraph' }
}

/** Block children as flat entries (lists not yet grouped). */
function blockFlats(parent: Element, ctx: Ctx): Flat[] {
  const flat: Flat[] = []
  for (const el of elements(parent)) {
    const name = localName(el)
    if (name === 'p') flat.push(...paragraphNodes(el, ctx))
    else if (name === 'tbl') flat.push({ node: tableNode(el, ctx), list: null })
    // Block-level content controls (a table of contents, a cover page),
    // tracked insertions of whole paragraphs, custom XML wrappers.
    else if (name === 'sdt') flat.push(...blockFlats(kid(el, 'sdtContent') ?? el, ctx))
    else if (name === 'ins' || name === 'moveTo' || name === 'customXml' || name === 'sdtContent')
      flat.push(...blockFlats(el, ctx))
  }
  return flat
}

/** Block children of a body or a table cell, with list runs collapsed. */
function blocksOf(parent: Element, ctx: Ctx): PmNode[] {
  const flat = blockFlats(parent, ctx)
  const out: PmNode[] = []
  let i = 0
  while (i < flat.length) {
    if (flat[i].list) {
      const { node, next } = buildList(flat, i, ctx)
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
  xml: { document: string; numbering?: string; styles?: string },
  opts: DocxMapOptions
): DocxMapResult {
  const doc = opts.parse(xml.document)
  const body = kid(doc.documentElement, 'body')
  if (!body) return { doc: { type: 'doc', content: [{ type: 'paragraph' }] }, section: {} }

  const ctx: Ctx = {
    opts,
    styles: styleTable(xml.styles ? opts.parse(xml.styles) : null),
    numFmt: numberingLookup(xml.numbering ? opts.parse(xml.numbering) : null),
    counters: new Map(),
  }
  const content = blocksOf(body, ctx)
  // A ProseMirror document may never be empty.
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { doc: { type: 'doc', content }, section: sectionOf(body) }
}
