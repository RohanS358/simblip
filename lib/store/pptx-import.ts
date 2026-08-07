'use client'

// .pptx -> SceneObject[] per slide, for presentation-view.tsx's first-open
// import. A real OOXML-to-canvas compiler: shapes (with fill/border color),
// pictures (extracted from the pptx zip and re-stored via lib/storage/
// manager.ts), text (per-run bold/italic/color/size/font, bullets), and
// slide backgrounds all round-trip into SIMBLIP's own object model —
// lib/scene/types.ts's 'picture' geometry kind, geometry.tsx's fillColor/
// strokeColor/strokeWidth metadata, and lib/text/marks.ts's real mark-range
// text format, respectively.
//
// Best-effort, not pixel-perfect: gradients, patterns, tables, charts,
// SmartArt, animations, and transitions do not round-trip (see the
// file-viewers design spec's explicit scope cut) — but plain shapes,
// pictures, styled text, bullets, and backgrounds now do.

import JSZip from 'jszip'
import { baseObject } from '@/lib/scene/factory'
import { str, type SceneObject } from '@/lib/scene/types'
import { serialize, parse, resolveSizePx, type Mark, type MarkKind } from '@/lib/text/marks'

// Slide XML coordinates are EMUs (914400 per inch). SIMBLIP's own slide
// canvas is a FIXED 960×540px frame (PPT_W_IN×PPT_H_IN in pptx-export.ts,
// 10in×5.625in at 96dpi) regardless of what size the source deck actually
// declares — PowerPoint's current default is 13.333×7.5in widescreen, and
// plenty of real decks are the older 10×7.5in 4:3. Importing with a FIXED
// EMU-per-px divisor (assuming every deck matches SIMBLIP's own 960×540)
// silently mispositioned/mis-scaled everything whenever the source deck's
// real size differed — the actual cause of "positions are all wrong".
// EMU_PER_PX_X/Y below are computed per-deck from the real <p:sldSz> in
// ppt/presentation.xml (loadSlideSize), so every position/size scales to
// fit the fixed 960×540 target frame no matter the source aspect ratio.
const SIMBLIP_SLIDE_W_PX = 960
const SIMBLIP_SLIDE_H_PX = 540
const PT_TO_PX = 96 / 72 // OOXML font sizes are in points (sz="2400" = 24pt, hundredths of a point)

interface SlideScale {
  emuPerPxX: number
  emuPerPxY: number
}

const DEFAULT_SLIDE_SCALE: SlideScale = { emuPerPxX: 9525, emuPerPxY: 9525 } // 914400 / 96dpi, matches a 10in×5.625in deck

/** <p:sldSz cx="..." cy="..."/> from ppt/presentation.xml, in EMUs — the
 *  source deck's real slide dimensions. Falls back to DEFAULT_SLIDE_SCALE
 *  (assumes a 10in×5.625in deck, SIMBLIP's own canonical size) if missing. */
async function loadSlideScale(zip: JSZip): Promise<SlideScale> {
  const file = zip.files['ppt/presentation.xml']
  if (!file) return DEFAULT_SLIDE_SCALE
  const xml = await file.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const sldSz = doc.getElementsByTagName('p:sldSz')[0]
  const cx = Number(sldSz?.getAttribute('cx'))
  const cy = Number(sldSz?.getAttribute('cy'))
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return DEFAULT_SLIDE_SCALE
  return { emuPerPxX: cx / SIMBLIP_SLIDE_W_PX, emuPerPxY: cy / SIMBLIP_SLIDE_H_PX }
}

/** Point sizes (fonts, line thickness) are ABSOLUTE physical measurements
 *  in OOXML — a 24pt title is 24pt regardless of slide size, unlike shape
 *  positions which are already slide-relative. But SIMBLIP forces every
 *  deck onto the SAME fixed 960×540px frame, so a deck physically larger
 *  than our canonical 10×5.625in (e.g. 13.333×7.5in widescreen) has its
 *  geometry shrunk to fit — point sizes must shrink by that same factor or
 *  text ends up relatively too big for its now-smaller box (text not
 *  fitting). Uses the Y axis: point size is fundamentally a vertical/line
 *  measure, and X/Y scale can differ when the source aspect ratio isn't
 *  exactly SIMBLIP's 16:9. */
function ptScaleFactor(scale: SlideScale): number {
  return DEFAULT_SLIDE_SCALE.emuPerPxY / scale.emuPerPxY
}

// ── XML helpers ──────────────────────────────────────────────────────────

function firstChild(el: Element | null, tag: string): Element | null {
  return el ? (el.getElementsByTagName(tag)[0] ?? null) : null
}

/** Only DIRECT children matching tag — getElementsByTagName is recursive,
 *  which wrongly reaches into a nested group/table when we want just this
 *  element's own immediate structure (e.g. a shape's own <a:r> runs, not a
 *  nested text box's). */
function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag)
}

/** Real <a:clrScheme> from ppt/theme/theme1.xml, keyed by the same scheme
 *  slot names solidFillColor's SCHEME_FALLBACK guesses at — dk1/lt1/dk2/lt2/
 *  accent1-6/hlink/folHlink. Falls back to an empty map (callers keep using
 *  SCHEME_FALLBACK) if the theme file is missing or malformed. */
async function loadTheme(zip: JSZip): Promise<Record<string, string>> {
  const themeFile = zip.files['ppt/theme/theme1.xml']
  if (!themeFile) return {}
  const xml = await themeFile.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const clrScheme = doc.getElementsByTagName('a:clrScheme')[0]
  if (!clrScheme) return {}
  const result: Record<string, string> = {}
  for (const child of Array.from(clrScheme.children)) {
    const slot = child.tagName.replace('a:', '')
    const srgb = firstChild(child, 'a:srgbClr')
    const sysClr = firstChild(child, 'a:sysClr')
    const val = srgb?.getAttribute('val') ?? sysClr?.getAttribute('lastClr')
    if (val) result[slot] = `#${val}`
  }
  return result
}

/** A fill node's own color — <a:solidFill> children read the same way
 *  solidFillColor reads a container's <a:solidFill> child, just one level
 *  shallower (the node passed in already IS the <a:solidFill>, not its
 *  parent). <a:gradFill>/<a:noFill>/other fill kinds return undefined —
 *  gradients aren't reproducible as a single flat background color. */
function fillNodeColor(fillNode: Element, theme: Record<string, string>): string | undefined {
  if (fillNode.tagName !== 'a:solidFill') return undefined
  const srgb = firstChild(fillNode, 'a:srgbClr')
  if (srgb) return `#${srgb.getAttribute('val')}`
  const scheme = firstChild(fillNode, 'a:schemeClr')
  const val = scheme?.getAttribute('val')
  return val ? theme[val] : undefined
}

/** ppt/theme/theme1.xml's <a:bgFillStyleLst> — the indexed (1-based) fill
 *  list a slide/layout/master <p:bgRef idx="N"> points into. Most real
 *  PowerPoint templates set their background this way (a theme-level fill
 *  reference) rather than a literal <p:bgPr><a:solidFill> on every slide,
 *  so resolving only the latter silently lost the deck's real background
 *  on nearly every real-world template. */
async function loadBgFillStyles(zip: JSZip, theme: Record<string, string>): Promise<(string | undefined)[]> {
  const themeFile = zip.files['ppt/theme/theme1.xml']
  if (!themeFile) return []
  const xml = await themeFile.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const lst = doc.getElementsByTagName('a:bgFillStyleLst')[0]
  if (!lst) return []
  return Array.from(lst.children).map((fill) => fillNodeColor(fill, theme))
}

/** <p:bgRef idx="N"><a:schemeClr .../></p:bgRef> — the common real-world
 *  background pattern: a theme fill-list index plus a scheme color that
 *  tints it. Falls back to the schemeClr's own direct resolution if the
 *  fill-list lookup comes up empty (some decks reference an index but the
 *  color that actually matters is the schemeClr override inside bgRef). */
function bgRefColor(bgRef: Element | null, bgFillStyles: (string | undefined)[], theme: Record<string, string>): string | undefined {
  if (!bgRef) return undefined
  // <p:bgRef idx="N"> selects which fill STYLE the theme's bgFillStyleLst
  // defines (solid/gradient/pattern) — the actual COLOR for this specific
  // background is bgRef's own <a:schemeClr> child, which overrides
  // whatever placeholder color the theme's abstract fill definition used.
  // Checking the fill-list first (as an earlier version of this code did)
  // resolved the theme's generic/placeholder color instead of the color
  // this particular background reference actually specifies — silently
  // wrong or missing backgrounds on most real bgRef-based templates.
  const scheme = firstChild(bgRef, 'a:schemeClr')
  const val = scheme?.getAttribute('val')
  if (val && theme[val]) return theme[val]
  const idx = Number(bgRef.getAttribute('idx'))
  return Number.isFinite(idx) && idx >= 1 && idx <= bgFillStyles.length ? bgFillStyles[idx - 1] : undefined
}

/** <a:srgbClr val="RRGGBB"/> or <a:schemeClr val="..."/>. Scheme colors
 *  resolve against the deck's real theme when passed; a hardcoded guess
 *  table covers slots the theme lookup misses (theme.xml absent/malformed).
 *  Returns a CSS hex string or null if no fill is specified. */
function solidFillColor(container: Element | null, theme: Record<string, string> = {}): string | null {
  const fill = firstChild(container, 'a:solidFill')
  if (!fill) return null
  const srgb = firstChild(fill, 'a:srgbClr')
  if (srgb) return `#${srgb.getAttribute('val')}`
  const scheme = firstChild(fill, 'a:schemeClr')
  if (scheme) {
    const val = scheme.getAttribute('val')
    if (!val) return null
    if (theme[val]) return theme[val]
    const SCHEME_FALLBACK: Record<string, string> = {
      dk1: '#000000',
      lt1: '#ffffff',
      dk2: '#44546a',
      lt2: '#e7e6e6',
      accent1: '#4472c4',
      accent2: '#ed7d31',
      accent3: '#a5a5a5',
      accent4: '#ffc000',
      accent5: '#5b9bd5',
      accent6: '#70ad47',
    }
    return SCHEME_FALLBACK[val] ?? '#808080'
  }
  return null
}

// ── Text: <a:p> paragraphs -> {text, marks} + bullet-prefix reconstruction ─

const BULLET_MARK_KINDS: MarkKind[] = ['bold', 'italic', 'underline', 'strike']

function runMarks(rPr: Element | null, start: number, end: number, theme: Record<string, string>, scale: SlideScale): Mark[] {
  if (!rPr || end <= start) return []
  const marks: Mark[] = []
  if (rPr.getAttribute('b') === '1') marks.push({ start, end, kind: 'bold' })
  if (rPr.getAttribute('i') === '1') marks.push({ start, end, kind: 'italic' })
  const u = rPr.getAttribute('u')
  if (u && u !== 'none') marks.push({ start, end, kind: 'underline' })
  const sz = rPr.getAttribute('sz') // hundredths of a point
  if (sz) {
    const px = Math.round((Number(sz) / 100) * PT_TO_PX * ptScaleFactor(scale))
    if (Number.isFinite(px) && px > 0) marks.push({ start, end, kind: 'size', value: String(px) })
  }
  const color = solidFillColor(rPr, theme)
  if (color) marks.push({ start, end, kind: 'color', value: color })
  return marks
}

/** One paragraph -> its plain text (with a reconstructed "- "/"1. " bullet
 *  prefix per the app's existing literal-prefix convention, see
 *  components/objects/text.tsx's BLOCK_PREFIX) + marks at the right
 *  offsets (shifted past the prefix). */
function paragraphToLine(p: Element, theme: Record<string, string>, scale: SlideScale): { text: string; marks: Mark[] } {
  const pPr = firstChild(p, 'a:pPr')
  const buChar = firstChild(pPr, 'a:buChar')
  const buAutoNum = firstChild(pPr, 'a:buAutoNum')
  const buNone = firstChild(pPr, 'a:buNone')
  const lvl = Number(pPr?.getAttribute('lvl') ?? '0')
  const indent = '        '.repeat(Math.min(4, lvl)) // INDENT_UNIT is 8 spaces/level (lib/text/marks.ts)
  const prefix = buNone ? '' : buAutoNum ? '1. ' : buChar ? '- ' : ''

  let text = indent + prefix
  const marks: Mark[] = []
  for (const r of directChildren(p, 'a:r')) {
    const t = firstChild(r, 'a:t')?.textContent ?? ''
    if (!t) continue
    const start = text.length
    text += t
    marks.push(...runMarks(firstChild(r, 'a:rPr'), start, text.length, theme, scale))
  }
  return { text, marks }
}

const ALGN_TO_ALIGN: Record<string, 'left' | 'center' | 'right'> = { l: 'left', ctr: 'center', r: 'right', just: 'left' }
const ANCHOR_TO_VALIGN: Record<string, 'top' | 'middle' | 'bottom'> = { t: 'top', ctr: 'middle', b: 'bottom' }

function shapeText(
  sp: Element,
  theme: Record<string, string>,
  placeholderStyles: Map<string, { color?: string; sizePx?: number }>,
  scale: SlideScale
): { text: string; marks: Mark[]; align?: 'left' | 'center' | 'right'; verticalAlign?: 'top' | 'middle' | 'bottom' } | null {
  const txBody = firstChild(sp, 'p:txBody')
  if (!txBody) return null
  const paragraphs = directChildren(txBody, 'a:p')
  if (paragraphs.length === 0) return null
  let text = ''
  const marks: Mark[] = []
  paragraphs.forEach((p, i) => {
    if (i > 0) text += '\n'
    const line = paragraphToLine(p, theme, scale)
    const offset = text.length
    text += line.text
    marks.push(...line.marks.map((m) => ({ ...m, start: m.start + offset, end: m.end + offset })))
  })
  if (text.trim().length === 0) return null

  // A run with no explicit color/size inherits from its placeholder's
  // definition in the slide layout (and from there the slide master) —
  // real PowerPoint behavior for title/body text, which is why most real
  // decks carry no per-run styling at all.
  const ph = sp.getElementsByTagName('p:ph')[0]
  const phKey = ph ? `${ph.getAttribute('type') ?? 'body'}:${ph.getAttribute('idx') ?? '0'}` : undefined
  const phStyle = phKey ? placeholderStyles.get(phKey) : undefined
  if (phStyle) {
    const hasColor = marks.some((m) => m.kind === 'color')
    const hasSize = marks.some((m) => m.kind === 'size')
    if (!hasColor && phStyle.color) marks.push({ start: 0, end: text.length, kind: 'color', value: phStyle.color })
    if (!hasSize && phStyle.sizePx) marks.push({ start: 0, end: text.length, kind: 'size', value: String(phStyle.sizePx) })
  }

  // Horizontal alignment is per-paragraph in OOXML (<a:pPr algn="...">) but
  // SIMBLIP's text object aligns the whole box — the first paragraph's
  // value wins, matching how a title/body placeholder sets it once.
  // Vertical alignment is the shape's own <a:bodyPr anchor="...">.
  const firstAlgn = firstChild(paragraphs[0], 'a:pPr')?.getAttribute('algn')
  const align = firstAlgn ? ALGN_TO_ALIGN[firstAlgn] : undefined
  const anchor = firstChild(txBody, 'a:bodyPr')?.getAttribute('anchor')
  const verticalAlign = anchor ? ANCHOR_TO_VALIGN[anchor] : undefined

  return { text, marks, align, verticalAlign }
}

// ── Shape geometry: position/size + fill/border ────────────────────────────

/** A shape/picture's own <a:xfrm><a:off>/<a:ext>, still in raw EMUs (not yet
 *  converted to px) — the value needed BEFORE composing through any parent
 *  group's transform. Falls back to a nonzero default box only once fully
 *  resolved (groupTransform below), not here, since a group-nested child's
 *  raw 0,0 is often legitimately its correct group-relative position. */
function rawOffExt(sp: Element): { x: number; y: number; w: number; h: number } | null {
  const xfrm = firstChild(sp, 'a:xfrm')
  const off = firstChild(xfrm, 'a:off')
  const ext = firstChild(xfrm, 'a:ext')
  if (!off || !ext) return null
  return {
    x: Number(off.getAttribute('x') ?? 0),
    y: Number(off.getAttribute('y') ?? 0),
    w: Number(ext.getAttribute('cx') ?? 0),
    h: Number(ext.getAttribute('cy') ?? 0),
  }
}

/** A <p:grpSp>'s own composed EMU-space transform: on-slide position/size
 *  (<a:off>/<a:ext>, same space as its parent) plus the "child coordinate
 *  space" (<a:chOff>/<a:chExt>) each child's own off/ext is expressed in —
 *  which can differ from the group's actual on-slide size if it was
 *  resized after grouping. A child's true position is groupOff + (childOff
 *  - chOff) * (groupExt / chExt). Nested groups compose by chaining this
 *  mapping — see groupChildToSlideEmu. */
interface GroupXfrm {
  offX: number
  offY: number
  extW: number
  extH: number
  chOffX: number
  chOffY: number
  chExtW: number
  chExtH: number
}

function groupXfrmOf(grpSp: Element): GroupXfrm | null {
  const xfrm = firstChild(firstChild(grpSp, 'p:grpSpPr'), 'a:xfrm')
  const off = firstChild(xfrm, 'a:off')
  const ext = firstChild(xfrm, 'a:ext')
  const chOff = firstChild(xfrm, 'a:chOff')
  const chExt = firstChild(xfrm, 'a:chExt')
  if (!off || !ext) return null
  return {
    offX: Number(off.getAttribute('x') ?? 0),
    offY: Number(off.getAttribute('y') ?? 0),
    extW: Number(ext.getAttribute('cx') ?? 0),
    extH: Number(ext.getAttribute('cy') ?? 0),
    chOffX: Number(chOff?.getAttribute('x') ?? off.getAttribute('x') ?? 0),
    chOffY: Number(chOff?.getAttribute('y') ?? off.getAttribute('y') ?? 0),
    chExtW: Number(chExt?.getAttribute('cx') ?? ext.getAttribute('cx') ?? 0),
    chExtH: Number(chExt?.getAttribute('cy') ?? ext.getAttribute('cy') ?? 0),
  }
}

/** Maps one shape's raw (childOff/childExt-space) EMU box through a chain
 *  of ancestor group transforms (outermost first) into slide-absolute
 *  EMUs. Empty chain = already slide-absolute (top-level shape). */
function mapThroughGroups(
  box: { x: number; y: number; w: number; h: number },
  groupChain: GroupXfrm[]
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = box
  for (const g of groupChain) {
    const sx = g.chExtW !== 0 ? g.extW / g.chExtW : 1
    const sy = g.chExtH !== 0 ? g.extH / g.chExtH : 1
    x = g.offX + (x - g.chOffX) * sx
    y = g.offY + (y - g.chOffY) * sy
    w = w * sx
    h = h * sy
  }
  return { x, y, w, h }
}

function shapeBox(sp: Element, scale: SlideScale, groupChain: GroupXfrm[] = []): { x: number; y: number; w: number; h: number } {
  const raw = rawOffExt(sp)
  if (!raw) return { x: 40, y: 40, w: 320, h: 48 }
  const abs = mapThroughGroups(raw, groupChain)
  return {
    x: Math.round(abs.x / scale.emuPerPxX) || 40,
    y: Math.round(abs.y / scale.emuPerPxY) || 40,
    w: Math.round(abs.w / scale.emuPerPxX) || 320,
    h: Math.round(abs.h / scale.emuPerPxY) || 48,
  }
}

function shapeFillAndBorder(
  sp: Element,
  theme: Record<string, string>,
  scale: SlideScale
): { fillColor?: string; strokeColor?: string; strokeWidth?: number } {
  const spPr = firstChild(sp, 'p:spPr')
  // <a:noFill/> is an explicit "definitely no fill" distinct from "no fill
  // specified" — both currently produce no fill (no fallback-fill logic
  // exists), but keeping the distinction explicit avoids a future fallback
  // misfiring on shapes that were deliberately made transparent.
  const explicitNoFill = firstChild(spPr, 'a:noFill') !== null
  const fillColor = explicitNoFill ? undefined : (solidFillColor(spPr, theme) ?? undefined)
  const ln = firstChild(spPr, 'a:ln')
  const lineNoFill = firstChild(ln, 'a:noFill') !== null
  const strokeColor = lineNoFill ? undefined : (solidFillColor(ln, theme) ?? undefined)
  const w = ln?.getAttribute('w') // EMUs
  // Border thickness is a fixed physical measurement, same as font size —
  // scale it the same way (ptScaleFactor) so a deck forced to shrink/grow
  // to fit SIMBLIP's fixed 960×540 frame doesn't end up with relatively
  // too-thick or too-thin borders.
  const strokeWidth = w
    ? Math.max(0.5, Math.round((Number(w) / DEFAULT_SLIDE_SCALE.emuPerPxX) * ptScaleFactor(scale) * 10) / 10)
    : undefined
  return { fillColor, strokeColor, strokeWidth }
}

/** <a:prstGeom prst="..."/> — mapped onto SIMBLIP's 3 real geometry kinds
 *  (rect/circle/polygon); anything unrecognized defaults to rect, since a
 *  labeled box is a closer visual match than dropping the shape entirely.
 *  Points are relative to the shape's own bbox, matching how 'polygon'
 *  geometry.points are interpreted elsewhere in the app (relative to
 *  position, within size). */
function geometryKindOf(sp: Element): 'rect' | 'circle' | 'polygon' {
  const prst = firstChild(firstChild(sp, 'p:spPr'), 'a:prstGeom')?.getAttribute('prst')
  if (prst === 'ellipse') return 'circle'
  if (prst === 'triangle') return 'polygon'
  if (prst === 'rightArrow' || prst === 'leftArrow' || prst === 'upArrow' || prst === 'downArrow') return 'polygon'
  return 'rect'
}

/** Unit-bbox point sets (0-1 range, scaled by box w/h at call site) for the
 *  polygon prst shapes geometryKindOf recognizes. */
const PRST_POLYGON_POINTS: Record<string, number[][]> = {
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  rightArrow: [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]],
  leftArrow: [[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]],
  upArrow: [[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]],
  downArrow: [[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]],
}

// ── Per-slide extraction ────────────────────────────────────────────────────

interface SlideAssets {
  /** relationship id ("rId3") -> zip path ("ppt/media/image1.png") for this slide. */
  rels: Map<string, string>
}

async function loadSlideRels(zip: JSZip, slideName: string): Promise<SlideAssets> {
  const relsPath = `ppt/slides/_rels/${slideName}.rels`
  const rels = new Map<string, string>()
  const relsFile = zip.files[relsPath]
  if (!relsFile) return { rels }
  const xml = await relsFile.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id && target) rels.set(id, target.replace(/^\.\.\//, 'ppt/'))
  }
  return { rels }
}

/** A slide run with no explicit color/size inherits from its placeholder's
 *  definition in the slide LAYOUT, and from there the slide MASTER if the
 *  layout also has none — real PowerPoint behavior for title/body text,
 *  which is why most real decks have no per-run styling at all. Returns a
 *  map from "<type>:<idx>" (matching a slide shape's <p:ph type idx>) to
 *  the resolved color/size, checked layout-first then master. */
/** A slide's layout path (from its own .rels) and that layout's master path
 *  (from the layout's .rels) — the inheritance chain every slide-level
 *  "falls back to the layout, then the master" lookup needs (placeholder
 *  text styling, and now slide background). */
async function resolveLayoutMasterPaths(
  zip: JSZip,
  slideName: string
): Promise<{ layoutTarget?: string; masterTarget?: string }> {
  const slideRelsPath = `ppt/slides/_rels/${slideName}.rels`
  const slideRelsFile = zip.files[slideRelsPath]
  if (!slideRelsFile) return {}
  const relsXml = await slideRelsFile.async('text')
  const relsDoc = new DOMParser().parseFromString(relsXml, 'application/xml')
  const layoutRel = Array.from(relsDoc.getElementsByTagName('Relationship')).find((r) =>
    (r.getAttribute('Type') ?? '').endsWith('/slideLayout')
  )
  const layoutTarget = layoutRel?.getAttribute('Target')?.replace(/^\.\.\//, 'ppt/')
  if (!layoutTarget || !zip.files[layoutTarget]) return {}

  const layoutName = layoutTarget.slice(layoutTarget.lastIndexOf('/') + 1)
  const layoutRelsPath = `ppt/slideLayouts/_rels/${layoutName}.rels`
  const layoutRelsFile = zip.files[layoutRelsPath]
  if (!layoutRelsFile) return { layoutTarget }
  const layoutRelsXml = await layoutRelsFile.async('text')
  const layoutRelsDoc = new DOMParser().parseFromString(layoutRelsXml, 'application/xml')
  const masterRel = Array.from(layoutRelsDoc.getElementsByTagName('Relationship')).find((r) =>
    (r.getAttribute('Type') ?? '').endsWith('/slideMaster')
  )
  const masterTarget = masterRel?.getAttribute('Target')?.replace(/^\.\.\//, 'ppt/')
  return { layoutTarget, masterTarget }
}

async function loadPlaceholderStyles(
  zip: JSZip,
  slideName: string,
  theme: Record<string, string>,
  scale: SlideScale
): Promise<Map<string, { color?: string; sizePx?: number }>> {
  const result = new Map<string, { color?: string; sizePx?: number }>()
  const { layoutTarget, masterTarget } = await resolveLayoutMasterPaths(zip, slideName)
  if (!layoutTarget) return result

  const readPlaceholders = async (path: string) => {
    const file = zip.files[path]
    if (!file) return
    const xml = await file.async('text')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    for (const sp of Array.from(doc.getElementsByTagName('p:sp'))) {
      const ph = sp.getElementsByTagName('p:ph')[0]
      if (!ph) continue
      const key = `${ph.getAttribute('type') ?? 'body'}:${ph.getAttribute('idx') ?? '0'}`
      if (result.has(key)) continue // slide layout wins over master — first pass through wins
      const rPr = sp.getElementsByTagName('a:defRPr')[0] ?? sp.getElementsByTagName('a:rPr')[0] ?? null
      const color = solidFillColor(rPr, theme) ?? undefined
      const sz = rPr?.getAttribute('sz')
      const sizePx = sz ? Math.round((Number(sz) / 100) * PT_TO_PX * ptScaleFactor(scale)) : undefined
      result.set(key, { color, sizePx })
    }
  }

  await readPlaceholders(layoutTarget)
  if (masterTarget) await readPlaceholders(masterTarget)

  return result
}

/** Slide background: <p:bg><p:bgPr><a:solidFill>, checked on the slide
 *  itself first, then its layout, then the layout's master — most real
 *  decks set the background once on the layout/master and never repeat it
 *  per-slide, so slide-only lookup silently lost the deck's real
 *  background on every slide that didn't override it. */
/** A <p:bg> can set its color either directly (<p:bgPr><a:solidFill>) or by
 *  reference into the theme's fill list (<p:bgRef idx="N">) — the latter is
 *  how most real PowerPoint templates actually do it, so both are checked. */
function bgColorOf(doc: Document, bgFillStyles: (string | undefined)[], theme: Record<string, string>): string | undefined {
  const bg = doc.getElementsByTagName('p:bg')[0] ?? null
  const direct = solidFillColor(firstChild(bg, 'p:bgPr'), theme)
  if (direct) return direct
  return bgRefColor(firstChild(bg, 'p:bgRef'), bgFillStyles, theme)
}

async function slideBackground(
  doc: Document,
  zip: JSZip,
  slideName: string,
  theme: Record<string, string>,
  bgFillStyles: (string | undefined)[]
): Promise<string | undefined> {
  const own = bgColorOf(doc, bgFillStyles, theme)
  if (own) return own

  const { layoutTarget, masterTarget } = await resolveLayoutMasterPaths(zip, slideName)
  for (const path of [layoutTarget, masterTarget]) {
    if (!path) continue
    const file = zip.files[path]
    if (!file) continue
    const xml = await file.async('text')
    const inheritedDoc = new DOMParser().parseFromString(xml, 'application/xml')
    const bg = bgColorOf(inheritedDoc, bgFillStyles, theme)
    if (bg) return bg
  }
  return undefined
}

async function pictureObject(
  pic: Element,
  zip: JSZip,
  assets: SlideAssets,
  ownerId: string,
  scale: SlideScale,
  groupChain: GroupXfrm[] = []
): Promise<SceneObject | null> {
  const blipFill = firstChild(pic, 'p:blipFill')
  const blip = firstChild(blipFill, 'a:blip')
  // r:embed's namespace URI is fixed by the OOXML spec regardless of which
  // local prefix a given file declares for it — getAttributeNS is the
  // spec-correct lookup. Falls back to the (near-universal) literal "r:embed"
  // attribute name in case a slide's DOMParser namespace resolution comes up
  // empty for any reason — cheap insurance, not the primary path.
  const rId =
    blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ??
    blip?.getAttribute('r:embed') ??
    undefined
  const target = rId ? assets.rels.get(rId) : undefined
  const zipEntry = target ? zip.files[target] : undefined
  if (!zipEntry) return null

  const { putFile } = await import('@/lib/storage/manager')
  const ext = target!.slice(target!.lastIndexOf('.')).toLowerCase()
  const mime =
    { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp' }[
      ext
    ] ?? 'image/png'
  const bytes = await zipEntry.async('blob')
  const fileId = await putFile(bytes, target!.split('/').pop() ?? 'image', mime, ownerId)

  const box = shapeBox(pic, scale, groupChain)
  const obj = baseObject('picture', { x: box.x, y: box.y })
  obj.size = { w: box.w, h: box.h }
  obj.geometry.src = `opfs:${fileId}`
  return obj
}

async function shapesToObjects(
  xml: string,
  zip: JSZip,
  assets: SlideAssets,
  ownerId: string,
  slideName: string,
  theme: Record<string, string>,
  scale: SlideScale,
  bgFillStyles: (string | undefined)[]
): Promise<{ objects: SceneObject[]; background?: string }> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const spTree = doc.getElementsByTagName('p:spTree')[0]
  if (!spTree) return { objects: [] }
  const objects: SceneObject[] = []
  const placeholderStyles = await loadPlaceholderStyles(zip, slideName, theme, scale)

  const applyPolygonPoints = (shape: SceneObject, sp: Element, box: { w: number; h: number }) => {
    if (shape.geometry.kind !== 'polygon') return
    const prst = firstChild(firstChild(sp, 'p:spPr'), 'a:prstGeom')?.getAttribute('prst')
    const unitPoints = prst ? PRST_POLYGON_POINTS[prst] : undefined
    if (unitPoints) shape.geometry.points = unitPoints.map(([ux, uy]) => [ux * box.w, uy * box.h])
  }

  // PowerPoint groups (<p:grpSp>) nest shapes/pictures under their own
  // composed transform (see mapThroughGroups) — a slide's real content
  // isn't only spTree's DIRECT children, and a picture inside any group
  // (very common: a photo grouped with a caption, or anything copy-pasted
  // in as a group) was previously invisible to this importer entirely,
  // since only top-level children were ever scanned.
  const walkChildren = async (parent: Element, groupChain: GroupXfrm[]) => {
    for (const child of Array.from(parent.children)) {
      if (child.tagName === 'p:grpSp') {
        const gx = groupXfrmOf(child)
        const nextChain = gx ? [...groupChain, gx] : groupChain
        await walkChildren(child, nextChain)
        continue
      }
      if (child.tagName === 'p:pic') {
        const obj = await pictureObject(child, zip, assets, ownerId, scale, groupChain)
        if (obj) objects.push(obj)
        continue
      }
      if (child.tagName !== 'p:sp') continue
      const box = shapeBox(child, scale, groupChain)
      const line = shapeText(child, theme, placeholderStyles, scale)
      const { fillColor, strokeColor, strokeWidth } = shapeFillAndBorder(child, theme, scale)
      const hasVisibleShape = !!(fillColor || strokeColor)

      if (line) {
        const obj = baseObject('text', { x: box.x, y: box.y })
        obj.size = { w: box.w, h: box.h }
        obj.parameters.text = str(serialize({ text: line.text, marks: line.marks }))
        if (line.align) obj.metadata.align = line.align
        if (line.verticalAlign) obj.metadata.verticalAlign = line.verticalAlign
        objects.push(obj)
        // A text box that ALSO has an explicit fill/border (a filled
        // rectangle with a caption, common in title/callout shapes) gets a
        // companion shape object behind it, since SIMBLIP's text object has
        // no fill/border of its own — matches what the slide visually shows
        // even though it's two SceneObjects instead of PowerPoint's one.
        if (hasVisibleShape) {
          const shape = baseObject(geometryKindOf(child), { x: box.x, y: box.y })
          shape.size = { w: box.w, h: box.h }
          shape.z = obj.z - 1
          applyPolygonPoints(shape, child, box)
          if (fillColor) shape.metadata.fillColor = fillColor
          if (strokeColor) shape.metadata.strokeColor = strokeColor
          if (strokeWidth) shape.metadata.strokeWidth = strokeWidth
          objects.push(shape)
        }
      } else if (hasVisibleShape) {
        const shape = baseObject(geometryKindOf(child), { x: box.x, y: box.y })
        shape.size = { w: box.w, h: box.h }
        applyPolygonPoints(shape, child, box)
        if (fillColor) shape.metadata.fillColor = fillColor
        if (strokeColor) shape.metadata.strokeColor = strokeColor
        if (strokeWidth) shape.metadata.strokeWidth = strokeWidth
        objects.push(shape)
      }
    }
  }

  await walkChildren(spTree, [])

  return { objects, background: await slideBackground(doc, zip, slideName, theme, bgFillStyles) }
}

/** Text/note boxes import at PowerPoint's stored width, which can be
 *  narrower than SIMBLIP's own font stack renders the same text at —
 *  height self-corrects on first mount (text.tsx's grow-only fit()), but
 *  width does not. Widen any box whose longest unbroken word doesn't fit
 *  its stored width, using canvas measureText (no DOM mount required, so
 *  this can run right after import instead of waiting for first render). */
function widenNarrowTextBoxes(objects: SceneObject[]): void {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  for (const obj of objects) {
    if (obj.geometry.kind !== 'text' && obj.geometry.kind !== 'note') continue
    const raw = obj.parameters.text
    const rawText = raw?.kind === 'string' ? raw.value : ''
    if (!rawText) continue
    const { text, marks } = parse(rawText)
    const words = text.replace(/\n/g, ' ').split(' ').filter(Boolean)
    if (words.length === 0) continue
    // Measure at the LARGEST size mark actually present (a title's size
    // mark, if any) — using a hardcoded default here would under-widen any
    // box whose text imported at a larger size than the app default,
    // reintroducing the same clipping this pass exists to fix.
    const sizeMarks = marks.filter((m) => m.kind === 'size' && m.value)
    const fontPx = sizeMarks.length > 0 ? Math.max(...sizeMarks.map((m) => resolveSizePx(m.value!))) : 14
    ctx.font = `${fontPx}px sans-serif`
    const longestWordPx = Math.max(...words.map((w) => ctx.measureText(w).width))
    const minWidth = Math.ceil(longestWordPx) + 24 // padX, matches note.tsx's own padY-style content padding
    if (obj.size.w < minWidth) obj.size = { ...obj.size, w: minWidth }
  }
}

export interface ImportedSlide {
  objects: SceneObject[]
  background?: string
}

/** Returns one ImportedSlide per slide, in deck order. `ownerId` is needed
 *  to store extracted picture bytes via lib/storage/manager.ts's putFile. */
export async function importPptx(blob: Blob, ownerId: string): Promise<ImportedSlide[]> {
  const zip = await JSZip.loadAsync(blob)
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      return na - nb
    })
  if (slideFiles.length === 0) throw new Error('No slides found in this presentation.')

  const [theme, scale] = await Promise.all([loadTheme(zip), loadSlideScale(zip)])
  const bgFillStyles = await loadBgFillStyles(zip, theme)
  const results: ImportedSlide[] = []
  for (const name of slideFiles) {
    const slideName = name.slice(name.lastIndexOf('/') + 1, -4) // "slide1"
    const [xml, assets] = await Promise.all([zip.files[name].async('text'), loadSlideRels(zip, slideName)])
    const { objects, background } = await shapesToObjects(xml, zip, assets, ownerId, slideName, theme, scale, bgFillStyles)
    widenNarrowTextBoxes(objects)
    results.push({ objects, background })
  }
  return results
}
