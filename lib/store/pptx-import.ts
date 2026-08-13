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
import { num, str, type SceneObject } from '@/lib/scene/types'
import { serialize, parse, resolveSizePx, type Mark, type MarkKind } from '@/lib/text/marks'
import { SLIDE_W, SLIDE_H } from '@/lib/scene/frames'

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
const SIMBLIP_SLIDE_W_PX = SLIDE_W
const SIMBLIP_SLIDE_H_PX = SLIDE_H
const PT_TO_PX = 96 / 72 // OOXML font sizes are in points (sz="2400" = 24pt, hundredths of a point)

interface SlideScale {
  emuPerPxX: number
  emuPerPxY: number
  /** EMU offset to subtract from slide-space X/Y before dividing. Non-zero
   *  only for letterboxing: when the deck's aspect ratio doesn't match
   *  SIMBLIP's 16:9, the content is centered in the fixed frame rather than
   *  stretched, so these carry the (negative) centering offset. */
  slideOffsetX: number
  slideOffsetY: number
}

/** 96dpi: 914400 EMU/inch ÷ 96 px/inch. The scale a deck that is exactly
 *  SIMBLIP's own canonical 10in×5.625in would import at — the reference
 *  point ptScaleFactor measures a deck's physical size against. */
const EMU_PER_PX_96DPI = 9525

const DEFAULT_SLIDE_SCALE: SlideScale = {
  emuPerPxX: EMU_PER_PX_96DPI,
  emuPerPxY: EMU_PER_PX_96DPI,
  slideOffsetX: 0,
  slideOffsetY: 0,
}

/** The deck's real slide size from <p:sldSz> in ppt/presentation.xml, mapped
 *  onto SIMBLIP's fixed 960×540 frame.
 *
 *  <p:sldSz> is authoritative and is the ONLY thing that defines slide-space:
 *  every <a:off>/<a:ext> in every slide is expressed in that coordinate
 *  system, by spec. An earlier version of this function tried to be clever —
 *  scanning slides for the largest <p:grpSp> and using ITS bounding box as
 *  the viewport, on the theory that portrait Canva/Figma exports hide a 16:9
 *  content block inside a translated group. That heuristic is wrong on
 *  ordinary decks and was the actual cause of "the pptx is scaled so much
 *  things don't fit": on any deck whose biggest group is merely a decorative
 *  cluster rather than a full-bleed content frame, it picked that cluster's
 *  box (a few million EMU) as the whole slide, so every object imported
 *  several times too large and offset by the cluster's origin. Canva's
 *  default 1920×1080px export (18288000×10287000 EMU = 20in×11.25in) hit
 *  this on every slide.
 *
 *  Aspect-ratio mismatch is handled by COVER + centering (fill the whole
 *  960×540 frame, crop whichever axis overflows), not CONTAIN + letterbox.
 *  A portrait/tall deck (e.g. a 20x22.5in Canva "custom size" export) under
 *  CONTAIN scales to fit its far-taller height, landing far narrower than
 *  960px wide — a big, obviously-wrong blank margin on both sides, the
 *  actual "why does the deck look tiny" bug. COVER instead scales to fill
 *  960px width (the CONSTRAINING axis for a portrait deck) and lets the
 *  excess height bleed off the top/bottom edges symmetrically, same as
 *  PowerPoint's own "crop to fit" custom-slide-size behavior — matching
 *  what the deck's own aspect ratio actually needs instead of forcing empty
 *  space onto a device that's fundamentally a fixed 16:9 stage. A normal
 *  16:9 or 4:3 deck's CONTAIN and COVER math coincide/nearly coincide with
 *  ordinary content margins, so this doesn't regress the common case.
 *  Uniform X/Y scale means circles stay circles either way. */
async function loadSlideScale(zip: JSZip): Promise<SlideScale> {
  const presFile = zip.files['ppt/presentation.xml']
  if (!presFile) return DEFAULT_SLIDE_SCALE

  const xml = await presFile.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const sldSz = doc.getElementsByTagName('p:sldSz')[0]
  const slideW = Number(sldSz?.getAttribute('cx') ?? 0)
  const slideH = Number(sldSz?.getAttribute('cy') ?? 0)
  if (!(slideW > 0 && slideH > 0)) return DEFAULT_SLIDE_SCALE

  // COVER: the smaller of the two required divisors, so the frame is
  // completely filled on the constraining axis and the other axis overflows.
  const emuPerPx = Math.min(slideW / SIMBLIP_SLIDE_W_PX, slideH / SIMBLIP_SLIDE_H_PX)

  // Center the overflow. A portrait deck scaled to fill 960px wide is
  // TALLER than 540px, so it gets a negative Y offset (shifting content up
  // so the crop is centered top/bottom, not anchored to the top edge).
  const renderedW = slideW / emuPerPx
  const renderedH = slideH / emuPerPx
  const slideOffsetX = -((SIMBLIP_SLIDE_W_PX - renderedW) / 2) * emuPerPx
  const slideOffsetY = -((SIMBLIP_SLIDE_H_PX - renderedH) / 2) * emuPerPx

  return { emuPerPxX: emuPerPx, emuPerPxY: emuPerPx, slideOffsetX, slideOffsetY }
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

// Real PowerPoint's own single-spacing pitch is 1.2× the font size — NOT
// the browser's `line-height: normal` (~1.15-1.5 depending on font/engine)
// and NOT a bare 1:1 reading of <a:spcPct>. <a:spcPct val="100000"/> (100%)
// therefore means CSS line-height 1.2, not 1.0; a val of "150000" means
// 1.8, not 1.5. Getting this wrong was the actual cause of imported text
// visibly overlapping/colliding with the shape below it: SIMBLIP's text
// object always fell back to a generic 1.625 multiplier (text.tsx) because
// <a:lnSpc> was never read at all, so a deck authored with PowerPoint's
// tight ~1.2 single-spacing imported at 1.625x — noticeably taller line
// boxes that run the text past the bottom of its own (correctly-sized) box
// and into whatever shape sits below it on the slide.
const PPT_SINGLE_SPACING = 1.2

/** <a:lnSpc><a:spcPct val="N"/></a:lnSpc> (percentage, in 1000ths) or
 *  <a:spcPts val="N"/> (exact points, in hundredths) -> a CSS line-height
 *  MULTIPLIER (unitless, relative to the paragraph's own font size) —
 *  SIMBLIP's text object only has one box-level multiplier (metadata.
 *  lineHeight), not true per-paragraph spacing, so this is read once from
 *  the FIRST paragraph that declares it, same simplification already used
 *  for horizontal align. `fontPx` is the resolved font size (already run
 *  through ptScaleFactor, same as runMarks' own `sz` conversion) that
 *  exact-pt spacing needs to convert into a multiplier — spcPts is an
 *  absolute physical height, so it must go through the SAME ptScaleFactor
 *  as fontPx before dividing, or the ratio is wrong on every deck whose
 *  physical size differs from SIMBLIP's own canonical 10x5.625in (i.e.
 *  nearly every real deck). */
function lineSpacingMultiplier(pPr: Element | null, fontPx: number, scale: SlideScale): number | undefined {
  const lnSpc = firstChild(pPr, 'a:lnSpc')
  if (!lnSpc) return undefined
  const pct = firstChild(lnSpc, 'a:spcPct')?.getAttribute('val')
  if (pct) {
    const frac = Number(pct) / 100000
    return Number.isFinite(frac) && frac > 0 ? frac * PPT_SINGLE_SPACING : undefined
  }
  const pts = firstChild(lnSpc, 'a:spcPts')?.getAttribute('val')
  if (pts && fontPx > 0) {
    const pt = Number(pts) / 100
    const px = pt * PT_TO_PX * ptScaleFactor(scale)
    return Number.isFinite(px) && px > 0 ? px / fontPx : undefined
  }
  return undefined
}

function shapeText(
  sp: Element,
  theme: Record<string, string>,
  placeholderStyles: Map<string, { color?: string; sizePx?: number }>,
  scale: SlideScale
): {
  text: string
  marks: Mark[]
  align?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
} | null {
  const txBody = firstChild(sp, 'p:txBody')
  if (!txBody) return null
  const paragraphs = directChildren(txBody, 'a:p')
  if (paragraphs.length === 0) return null

  // <a:normAutofit fontScale="62500"/> — PowerPoint's own "shrink text on
  // overflow", stored as the percentage (in 1000ths) it already decided the
  // text must shrink by to fit its box. The stored `sz` values are the
  // UNSHRUNK sizes, so ignoring this renders text far larger than the deck
  // actually displays it — a direct cause of text overflowing its shape.
  const autofit = firstChild(firstChild(txBody, 'a:bodyPr'), 'a:normAutofit')
  const fontScaleAttr = autofit?.getAttribute('fontScale')
  const fontScale = fontScaleAttr ? Number(fontScaleAttr) / 100000 : 1
  const effScale: SlideScale =
    Number.isFinite(fontScale) && fontScale > 0 && fontScale !== 1
      ? { ...scale, emuPerPxY: scale.emuPerPxY / fontScale }
      : scale

  let text = ''
  const marks: Mark[] = []
  paragraphs.forEach((p, i) => {
    if (i > 0) text += '\n'
    const line = paragraphToLine(p, theme, effScale)
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

  // The font size lineSpacingMultiplier needs to turn an exact-point
  // <a:spcPts> into a relative multiplier — whatever size actually applies
  // to the first paragraph's own text: its own size mark if present, else
  // the placeholder-inherited size, else SIMBLIP's own text-object default
  // (TEXT_SIZES.m, lib/text/marks.ts) so an unstyled deck still gets a
  // sane (not zero/NaN) conversion.
  const firstSizeMark = marks.find((m) => m.kind === 'size' && m.start === 0)
  const fontPx = firstSizeMark ? Number(firstSizeMark.value) : (phStyle?.sizePx ?? 15)
  const lineHeight = lineSpacingMultiplier(firstChild(paragraphs[0], 'a:pPr'), fontPx, effScale)

  return { text, marks, align, verticalAlign, lineHeight }
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
 *  of ancestor group transforms (applied innermost-first, since raw coords
 *  live in the immediate parent's child space) into slide-absolute EMUs.
 *  Empty chain = already slide-absolute (top-level shape). */
function mapThroughGroups(
  box: { x: number; y: number; w: number; h: number },
  groupChain: GroupXfrm[]
): { x: number; y: number; w: number; h: number } {
  let { x, y, w, h } = box
  for (let i = groupChain.length - 1; i >= 0; i--) {
    const g = groupChain[i]
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
  // Subtract the slide-space content-area origin so that objects placed
  // inside a translated top-level group map to canvas (0,0) correctly.
  const canvasX = Math.round((abs.x - scale.slideOffsetX) / scale.emuPerPxX)
  const canvasY = Math.round((abs.y - scale.slideOffsetY) / scale.emuPerPxY)
  const w = Math.round(abs.w / scale.emuPerPxX)
  const h = Math.round(abs.h / scale.emuPerPxY)
  // w/h=0 is NOT clamped here: a straight connector is legitimately
  // zero-height (horizontal) or zero-width (vertical) in OOXML — the actual
  // angle comes from rotation/flip, not the box. Callers that need a
  // never-zero box (rect/circle/picture) clamp themselves; clamping here
  // corrupted every horizontal/vertical pptx line into a diagonal.
  return {
    x: Number.isFinite(canvasX) ? canvasX : 40,
    y: Number.isFinite(canvasY) ? canvasY : 40,
    w: Number.isFinite(w) ? w : 320,
    h: Number.isFinite(h) ? h : 48,
  }
}

function shapeFillAndBorder(
  sp: Element,
  theme: Record<string, string>,
  scale: SlideScale
): { fillColor?: string; strokeColor?: string; strokeWidth?: number } {
  const spPr = firstChild(sp, 'p:spPr')
  // spPr's OWN <a:solidFill>/<a:noFill> must be read as a DIRECT child, not
  // via firstChild's recursive getElementsByTagName — a shape with a
  // stroke-only border (no shape fill, common: Canva's bordered "pill"
  // labels) still has a real <a:solidFill> nested inside its <a:ln>, and
  // the recursive search found THAT instead, so every stroke-only shape
  // rendered with a solid fill in the border's own color — a plain
  // transparent-with-outline pill imported as an opaque colored box. Same
  // bug class the custGeom parser was already hardened against (commit
  // e8f37ba) for the same underlying reason: firstChild digs through
  // descendants indiscriminately, and <a:ln> is a descendant of <a:spPr>.
  const spPrOwnFill = spPr ? directChildren(spPr, 'a:solidFill')[0] : undefined
  const spPrOwnNoFill = spPr ? directChildren(spPr, 'a:noFill')[0] : undefined
  // <a:noFill/> is an explicit "definitely no fill" distinct from "no fill
  // specified" — both currently produce no fill (no fallback-fill logic
  // exists), but keeping the distinction explicit avoids a future fallback
  // misfiring on shapes that were deliberately made transparent.
  const explicitNoFill = spPrOwnNoFill !== undefined
  const fillColor = explicitNoFill || !spPrOwnFill ? undefined : (fillNodeColor(spPrOwnFill, theme) ?? undefined)
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

/** Unit-bbox point sets (0-1 range, scaled by box w/h at call site) for the
 *  polygon prst shapes geometryKindOf recognizes. */
export const PRST_POLYGON_POINTS: Record<string, number[][]> = {
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  rtTriangle: [[0, 0], [0, 1], [1, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  parallelogram: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]],
  trapezoid: [[0.25, 0], [0.75, 0], [1, 1], [0, 1]],
  pentagon: [[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]],
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  octagon: [[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]],
  star5: [
    [0.5, 0], [0.62, 0.35], [1, 0.35], [0.69, 0.57], [0.81, 0.91],
    [0.5, 0.7], [0.19, 0.91], [0.31, 0.57], [0, 0.35], [0.38, 0.35],
  ],
  rightArrow: [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]],
  leftArrow: [[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]],
  upArrow: [[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]],
  downArrow: [[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]],
}

/** <a:prstGeom prst="..."/> — mapped onto SIMBLIP's real geometry kinds
 *  (rect/circle/polygon/line); anything unrecognized defaults to rect, since
 *  a labeled box is a closer visual match than dropping the shape entirely.
 *  Points are relative to the shape's own bbox, matching how 'polygon'
 *  geometry.points are interpreted elsewhere in the app (relative to
 *  position, within size).
 *
 *  <a:custGeom> (a freeform path) maps to 'polygon' when its path CLOSES
 *  (<a:close/> present) — custGeom is what every design tool that isn't
 *  PowerPoint itself emits for anything that isn't a plain box, so treating
 *  it as an unrecognized 'rect' silently squared off a large share of
 *  real-world decks' artwork. An UNCLOSED path (no <a:close/>) is not a
 *  filled shape at all — real decks (Canva templates especially) use these
 *  for decorative accent lines/underlines/corner-brackets, stroke-only, no
 *  fill. Rendering that as 'polygon' auto-closes it into a filled/stroked
 *  wedge that was never in the original slide, so it maps to 'line' instead
 *  (a raw open polyline) to match what actually shows. */
const LINE_PRSTS = new Set([
  'line', 'straightConnector1',
  'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5',
  'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5',
])

function geometryKindOf(sp: Element): 'rect' | 'circle' | 'polygon' | 'line' {
  const spPr = firstChild(sp, 'p:spPr')
  if (firstChild(spPr, 'a:custGeom')) return custGeomPath(sp)?.closed ? 'polygon' : 'line'
  const prst = firstChild(spPr, 'a:prstGeom')?.getAttribute('prst')
  if (prst === 'ellipse' || prst === 'circle') return 'circle'
  if (prst && LINE_PRSTS.has(prst)) return 'line'
  if (prst && PRST_POLYGON_POINTS[prst]) return 'polygon'
  return 'rect'
}

/** <a:custGeom><a:pathLst><a:path w= h=> — a freeform outline in the path's
 *  OWN coordinate space (w/h, not EMUs), which we normalize to the shape's
 *  bbox. Curves (cubicBezTo/quadBezTo/arcTo) are approximated by their end
 *  points: SIMBLIP's 'polygon'/'line' geometry is point-list only, so a
 *  rounded outline imports as a straight-edged one rather than not at all.
 *
 *  Returns unit-space (0-1) points plus whether the path actually closed —
 *  the caller scales points by the shape's px box, matching
 *  PRST_POLYGON_POINTS' convention, and uses `closed` to pick polygon
 *  (filled ring) vs line (open stroke) geometry. */
function custGeomPath(sp: Element): { points: number[][]; closed: boolean } | undefined {
  // Walk down by DIRECT children — firstChild() is recursive, so on a shape
  // it could otherwise pick up a descendant's custGeom instead of its own.
  const spPr = directChildren(sp, 'p:spPr')[0]
  const custGeom = spPr ? directChildren(spPr, 'a:custGeom')[0] : undefined
  const pathLst = custGeom ? directChildren(custGeom, 'a:pathLst')[0] : undefined
  const path = pathLst ? directChildren(pathLst, 'a:path')[0] : undefined
  if (!path) return undefined
  const pathW = Number(path.getAttribute('w') ?? 0)
  const pathH = Number(path.getAttribute('h') ?? 0)
  if (!(pathW > 0 && pathH > 0)) return undefined

  const points: number[][] = []
  const pushPt = (pt: Element | null) => {
    if (!pt) return
    const x = Number(pt.getAttribute('x') ?? NaN)
    const y = Number(pt.getAttribute('y') ?? NaN)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    // Clamp to the declared path box. Points may legitimately sit slightly
    // outside it (a stroke drawn past the edge), but geometry.points are
    // interpreted relative to the object's own size — an unclamped outlier
    // would paint across the rest of the slide.
    points.push([Math.min(1, Math.max(0, x / pathW)), Math.min(1, Math.max(0, y / pathH))])
  }

  // Only the FIRST subpath is taken — polygon/line geometry is a single
  // ring/polyline, so a multi-subpath shape (a donut, a glyph with holes)
  // imports as its outer contour.
  for (const cmd of Array.from(path.children)) {
    switch (cmd.tagName) {
      case 'a:moveTo':
        if (points.length > 0) return { points, closed: false } // second subpath starts — stop
        pushPt(firstChild(cmd, 'a:pt'))
        break
      case 'a:lnTo':
        pushPt(firstChild(cmd, 'a:pt'))
        break
      case 'a:cubicBezTo':
      case 'a:quadBezTo': {
        // Approximate by the curve's end point (the last <a:pt> child).
        const pts = directChildren(cmd, 'a:pt')
        pushPt(pts[pts.length - 1] ?? null)
        break
      }
      case 'a:close':
        return { points, closed: true }
      default:
        break // arcTo and others: no reliable end point without full math
    }
  }
  return { points, closed: false }
}

/** The unit-space outline for whatever geometry a shape declares — custGeom
 *  path first, then the preset table. Undefined for shapes that aren't
 *  polygons/lines (rect/circle need no point list). */
function polygonUnitPoints(sp: Element): number[][] | undefined {
  const custom = custGeomPath(sp)
  if (custom && custom.points.length >= 2) return custom.points
  const prst = firstChild(firstChild(sp, 'p:spPr'), 'a:prstGeom')?.getAttribute('prst')
  return prst ? PRST_POLYGON_POINTS[prst] : undefined
}

/** <a:xfrm rot="..."> is in 60000ths of a degree, clockwise — the same
 *  direction as SceneObject.rotation's CSS `rotate(Ndeg)`, so it passes
 *  through as a plain division. */
function shapeRotation(sp: Element): number {
  const rot = firstChild(sp, 'a:xfrm')?.getAttribute('rot')
  if (!rot) return 0
  const deg = Number(rot) / 60000
  if (!Number.isFinite(deg)) return 0
  // Normalize to (-180, 180] so the inspector shows a sane number.
  const norm = ((deg % 360) + 360) % 360
  return Math.round((norm > 180 ? norm - 360 : norm) * 10) / 10
}

/** <a:xfrm flipH="1"/flipV="1"> — mirrors the shape WITHIN its own box,
 *  applied before rotation (OOXML order, matched by canvas.tsx's transform:
 *  `scale(...) rotate(...)`, CSS right-to-left). Stored on metadata since
 *  SceneObject has no dedicated flip field; canvas.tsx reads it generically
 *  for every geometry kind so background art (the common case: a full-bleed
 *  picture shape flipped to vary a template) renders un-mirrored instead of
 *  silently ignoring the flip. */
function shapeFlip(sp: Element): { flipH?: true; flipV?: true } {
  const xfrm = firstChild(sp, 'a:xfrm')
  const result: { flipH?: true; flipV?: true } = {}
  if (xfrm?.getAttribute('flipH') === 'true' || xfrm?.getAttribute('flipH') === '1') result.flipH = true
  if (xfrm?.getAttribute('flipV') === 'true' || xfrm?.getAttribute('flipV') === '1') result.flipV = true
  return result
}

/** A <p:graphicFrame>'s own position/size — under <p:xfrm> directly (not
 *  <p:spPr><a:xfrm> like a shape/picture), so it needs its own box reader
 *  rather than reusing shapeBox. Tables (the only graphicFrame content this
 *  importer handles) are placed exactly like everything else: mapped
 *  through any ancestor group chain, then the deck's slide scale. */
function graphicFrameBox(gf: Element, scale: SlideScale, groupChain: GroupXfrm[]): { x: number; y: number; w: number; h: number } {
  const xfrm = firstChild(gf, 'p:xfrm')
  const off = firstChild(xfrm, 'a:off')
  const ext = firstChild(xfrm, 'a:ext')
  if (!off || !ext) return { x: 40, y: 40, w: 320, h: 200 }
  const raw = {
    x: Number(off.getAttribute('x') ?? 0),
    y: Number(off.getAttribute('y') ?? 0),
    w: Number(ext.getAttribute('cx') ?? 0),
    h: Number(ext.getAttribute('cy') ?? 0),
  }
  const abs = mapThroughGroups(raw, groupChain)
  const canvasX = Math.round((abs.x - scale.slideOffsetX) / scale.emuPerPxX)
  const canvasY = Math.round((abs.y - scale.slideOffsetY) / scale.emuPerPxY)
  const w = Math.round(abs.w / scale.emuPerPxX)
  const h = Math.round(abs.h / scale.emuPerPxY)
  return {
    x: Number.isFinite(canvasX) ? canvasX : 40,
    y: Number.isFinite(canvasY) ? canvasY : 40,
    w: w > 0 ? w : 320,
    h: h > 0 ? h : 200,
  }
}

/** <a:tbl><a:tblGrid><a:gridCol>...</a:tblGrid><a:tr><a:tc><a:txBody>... —
 *  a real OOXML table, mapped onto SIMBLIP's 'gridtable' geometry (an
 *  editable rows×cols string grid). Only each cell's plain concatenated
 *  text survives (no per-run formatting, no cell fill/merge/span) — losing
 *  a table ENTIRELY on import (the prior behavior: <p:graphicFrame> wasn't
 *  even recognized by walkChildren) is a worse outcome than a plain-text
 *  table for the exact same reason a preset-shape default beats dropping an
 *  unrecognized shape. */
function tableObject(gf: Element, scale: SlideScale, groupChain: GroupXfrm[]): SceneObject | null {
  const tbl = firstChild(firstChild(firstChild(gf, 'a:graphic'), 'a:graphicData'), 'a:tbl')
  if (!tbl) return null
  const gridCols = directChildren(firstChild(tbl, 'a:tblGrid') as Element, 'a:gridCol')
  const rows = directChildren(tbl, 'a:tr')
  if (rows.length === 0) return null

  const cells: string[][] = rows.map((tr) =>
    directChildren(tr, 'a:tc').map((tc) => {
      const txBody = firstChild(tc, 'a:txBody')
      const paragraphs = txBody ? directChildren(txBody, 'a:p') : []
      return paragraphs
        .map((p) => directChildren(p, 'a:r').map((r) => firstChild(r, 'a:t')?.textContent ?? '').join(''))
        .join('\n')
    })
  )
  const colCount = Math.max(gridCols.length, ...cells.map((r) => r.length), 1)
  // Ragged rows (a cell spanned/merged in the source) padded to the grid
  // width — gridtable expects every row the same length.
  for (const row of cells) while (row.length < colCount) row.push('')

  const box = graphicFrameBox(gf, scale, groupChain)
  const obj = baseObject('gridtable', { x: box.x, y: box.y })
  obj.size = { w: box.w, h: box.h }
  obj.parameters.rows = num(rows.length)
  obj.parameters.cols = num(colCount)
  obj.parameters.cells = str(JSON.stringify(cells))
  obj.parameters.transparent = num(0)
  return obj
}

// ── Per-slide extraction ────────────────────────────────────────────────────

interface SlideAssets {
  /** relationship id ("rId3") -> zip path ("ppt/media/image1.png") for this slide. */
  rels: Map<string, string>
}

async function loadSlideRels(zip: JSZip, slideName: string): Promise<SlideAssets> {
  const rels = new Map<string, string>()
  const relsFiles = [
    `ppt/slides/_rels/${slideName}.xml.rels`,
    `ppt/slides/_rels/${slideName}.rels`,
  ]
  let relsFile: JSZip.JSZipObject | undefined
  for (const p of relsFiles) {
    if (zip.files[p]) {
      relsFile = zip.files[p]
      break
    }
  }
  if (!relsFile) return { rels }
  const xml = await relsFile.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  for (const rel of Array.from(doc.getElementsByTagName('Relationship'))) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id && target) {
      let resolved = target
      if (target.startsWith('../')) {
        resolved = 'ppt/' + target.slice(3)
      } else if (!target.startsWith('/') && !target.startsWith('ppt/')) {
        resolved = 'ppt/slides/' + target
      } else if (target.startsWith('/')) {
        resolved = target.slice(1)
      }
      rels.set(id, resolved)
    }
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
  const slideRelsFiles = [
    `ppt/slides/_rels/${slideName}.xml.rels`,
    `ppt/slides/_rels/${slideName}.rels`,
  ]
  let slideRelsFile: JSZip.JSZipObject | undefined
  for (const p of slideRelsFiles) {
    if (zip.files[p]) {
      slideRelsFile = zip.files[p]
      break
    }
  }
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

/** <a:blipFill><a:stretch><a:fillRect l= t= r= b=/> — the crop/zoom applied
 *  when an image fills a shape "cover"-style: each side is an inset as a
 *  PERCENTAGE (in 1000ths, so 100000 = 100%) of the shape's own box,
 *  negative meaning the image extends PAST that edge (zoomed in / cropped),
 *  positive meaning letterboxing (image smaller than the box on that side).
 *  Very common on Canva background/photo shapes (crop-to-fill), and
 *  previously ignored entirely — the image just stretched into the shape's
 *  bbox via CSS object-fit:fill, which visibly distorts/mis-frames any photo
 *  that wasn't cropped 1:1 with its shape's aspect ratio. Returns undefined
 *  for the (very common) identity rect l=t=r=b=0, so callers can skip
 *  passing any crop metadata for the common case. */
function fillRectOf(blipFill: Element | null): { l: number; t: number; r: number; b: number } | undefined {
  const fillRect = firstChild(firstChild(blipFill, 'a:stretch'), 'a:fillRect')
  if (!fillRect) return undefined
  const l = Number(fillRect.getAttribute('l') ?? 0) / 100000
  const t = Number(fillRect.getAttribute('t') ?? 0) / 100000
  const r = Number(fillRect.getAttribute('r') ?? 0) / 100000
  const b = Number(fillRect.getAttribute('b') ?? 0) / 100000
  if (l === 0 && t === 0 && r === 0 && b === 0) return undefined
  return { l, t, r, b }
}

/** Resolves a <a:blip> element (found under either a <p:pic>'s own
 *  <p:blipFill> or a plain shape's <p:spPr><a:blipFill> — Canva-exported
 *  decks commonly use the latter: a picture as a shape's FILL rather than
 *  a dedicated <p:pic> element, which the old <p:pic>-only lookup never
 *  saw at all) into stored bytes, writing them to OPFS and returning the
 *  opfs: src string. Null if there's no resolvable embedded image (e.g. a
 *  linked-not-embedded r:link image, out of scope — no local bytes exist
 *  for those without a network fetch). */
async function blipToOpfsSrc(
  blipFill: Element | null,
  zip: JSZip,
  assets: SlideAssets,
  ownerId: string
): Promise<string | null> {
  const blip = firstChild(blipFill, 'a:blip')
  const rId =
    blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') ??
    blip?.getAttribute('r:embed') ??
    undefined
  const target = rId ? assets.rels.get(rId) : undefined
  if (!target) return null

  let zipEntry = zip.files[target]
  if (!zipEntry) {
    const filename = target.split('/').pop()?.toLowerCase()
    if (filename) {
      const match = Object.keys(zip.files).find(
        (k) => k.toLowerCase().endsWith('/' + filename) || k.toLowerCase() === filename
      )
      if (match) zipEntry = zip.files[match]
    }
  }
  if (!zipEntry) return null

  const { putFile } = await import('@/lib/storage/manager')
  const ext = target.slice(target.lastIndexOf('.')).toLowerCase()
  const mime =
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.m4v': 'video/mp4',
      '.avi': 'video/x-msvideo',
    }[ext] ?? (ext.includes('mp4') || ext.includes('video') ? 'video/mp4' : 'image/png')
  const bytes = await zipEntry.async('blob')
  const fileId = await putFile(bytes, target.split('/').pop() ?? 'image', mime, ownerId)
  return `opfs:${fileId}`
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
  const src = await blipToOpfsSrc(blipFill, zip, assets, ownerId)
  if (!src) return null

  const box = shapeBox(pic, scale, groupChain)
  const obj = baseObject('picture', { x: box.x, y: box.y })
  obj.size = { w: box.w > 0 ? box.w : 320, h: box.h > 0 ? box.h : 48 }
  obj.geometry.src = src
  obj.rotation = shapeRotation(pic)
  Object.assign(obj.metadata, shapeFlip(pic))
  const fillRect = fillRectOf(blipFill)
  if (fillRect) obj.metadata.fillRect = fillRect
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

  // rect/circle/polygon need a non-zero box to render at all; 'line' does
  // not — a zero-height/width line is a legitimate horizontal/vertical
  // connector, and clamping it produces a diagonal instead.
  const shapeSize = (kind: ReturnType<typeof geometryKindOf>, box: { w: number; h: number }) =>
    kind === 'line' ? { w: box.w, h: box.h } : { w: box.w > 0 ? box.w : 320, h: box.h > 0 ? box.h : 48 }

  const applyPolygonPoints = (shape: SceneObject, sp: Element, box: { w: number; h: number }) => {
    if (shape.geometry.kind !== 'polygon' && shape.geometry.kind !== 'line') return
    const unitPoints = polygonUnitPoints(sp)
    const minPoints = shape.geometry.kind === 'line' ? 2 : 3
    if (unitPoints && unitPoints.length >= minPoints) {
      shape.geometry.points = unitPoints.map(([ux, uy]) => [ux * box.w, uy * box.h])
    } else if (shape.geometry.kind === 'polygon') {
      // A polygon with no resolvable outline would render as nothing at all
      // (geometry.tsx needs >=3 points) — fall back to the full bbox so the
      // shape's fill/border still shows.
      shape.geometry.kind = 'rect'
    } else {
      // An open custGeom path with <2 usable points has nothing to draw —
      // default to a straight diagonal across its own bbox rather than
      // vanishing outright, matching the "shape still shows" fallback above.
      shape.geometry.points = [[0, 0], [box.w, box.h]]
    }
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
      if (child.tagName === 'p:graphicFrame') {
        const obj = tableObject(child, scale, groupChain)
        if (obj) objects.push(obj)
        continue
      }
      if (child.tagName !== 'p:sp') continue

      // Canva-exported decks (and some PowerPoint shapes) commonly use a
      // picture as a shape's FILL (<p:spPr><a:blipFill>) instead of a
      // dedicated <p:pic> element — invisible to the p:pic-only check
      // above, which is why images from these decks imported as nothing
      // at all. Any text on the shape still layers on top as usual.
      const spPr = firstChild(child, 'p:spPr')
      const shapeBlipFill = firstChild(spPr, 'a:blipFill')
      if (shapeBlipFill) {
        const src = await blipToOpfsSrc(shapeBlipFill, zip, assets, ownerId)
        if (src) {
          const box = shapeBox(child, scale, groupChain)
          const rotation = shapeRotation(child)
          const pictureObj = baseObject('picture', { x: box.x, y: box.y })
          pictureObj.size = { w: box.w, h: box.h }
          pictureObj.geometry.src = src
          pictureObj.rotation = rotation
          Object.assign(pictureObj.metadata, shapeFlip(child))
          const fillRect = fillRectOf(shapeBlipFill)
          if (fillRect) pictureObj.metadata.fillRect = fillRect
          objects.push(pictureObj)
          const line = shapeText(child, theme, placeholderStyles, scale)
          if (line) {
            const textObj = baseObject('text', { x: box.x, y: box.y })
            textObj.size = { w: box.w, h: box.h }
            textObj.parameters.text = str(serialize({ text: line.text, marks: line.marks }))
            textObj.rotation = rotation
            if (line.align) textObj.metadata.align = line.align
            if (line.verticalAlign) textObj.metadata.verticalAlign = line.verticalAlign
            if (line.lineHeight) textObj.metadata.lineHeight = line.lineHeight
            objects.push(textObj)
          }
          continue
        }
      }

      const box = shapeBox(child, scale, groupChain)
      const rotation = shapeRotation(child)
      const line = shapeText(child, theme, placeholderStyles, scale)
      const { fillColor, strokeColor, strokeWidth } = shapeFillAndBorder(child, theme, scale)
      const hasVisibleShape = !!(fillColor || strokeColor)

      if (line) {
        const obj = baseObject('text', { x: box.x, y: box.y })
        obj.size = { w: box.w, h: box.h }
        obj.parameters.text = str(serialize({ text: line.text, marks: line.marks }))
        obj.rotation = rotation
        if (line.align) obj.metadata.align = line.align
        if (line.verticalAlign) obj.metadata.verticalAlign = line.verticalAlign
        if (line.lineHeight) obj.metadata.lineHeight = line.lineHeight
        objects.push(obj)
        // A text box that ALSO has an explicit fill/border (a filled
        // rectangle with a caption, common in title/callout shapes) gets a
        // companion shape object behind it, since SIMBLIP's text object has
        // no fill/border of its own — matches what the slide visually shows
        // even though it's two SceneObjects instead of PowerPoint's one.
        if (hasVisibleShape) {
          const kind = geometryKindOf(child)
          const shape = baseObject(kind, { x: box.x, y: box.y })
          shape.size = shapeSize(kind, box)
          shape.z = obj.z - 1
          shape.rotation = rotation
          applyPolygonPoints(shape, child, box)
          if (fillColor) shape.metadata.fillColor = fillColor
          if (strokeColor) shape.metadata.strokeColor = strokeColor
          if (strokeWidth) shape.metadata.strokeWidth = strokeWidth
          Object.assign(shape.metadata, shapeFlip(child))
          objects.push(shape)
        }
      } else if (hasVisibleShape) {
        const kind = geometryKindOf(child)
        const shape = baseObject(kind, { x: box.x, y: box.y })
        shape.size = shapeSize(kind, box)
        shape.rotation = rotation
        applyPolygonPoints(shape, child, box)
        if (fillColor) shape.metadata.fillColor = fillColor
        if (strokeColor) shape.metadata.strokeColor = strokeColor
        if (strokeWidth) shape.metadata.strokeWidth = strokeWidth
        Object.assign(shape.metadata, shapeFlip(child))
        objects.push(shape)
      }
    }
  }

  const bg = doc.getElementsByTagName('p:bg')[0] ?? null
  const bgBlipFill = firstChild(firstChild(bg, 'p:bgPr'), 'a:blipFill')
  if (bgBlipFill) {
    const bgSrc = await blipToOpfsSrc(bgBlipFill, zip, assets, ownerId)
    if (bgSrc) {
      // The background fills the SLIDE, which after letterboxing may be
      // inset from the 960×540 frame — reuse the same offset/scale mapping
      // every other object goes through so it lines up with them.
      const bgX = Math.round(-scale.slideOffsetX / scale.emuPerPxX)
      const bgY = Math.round(-scale.slideOffsetY / scale.emuPerPxY)
      const bgPic = baseObject('picture', { x: bgX, y: bgY })
      bgPic.size = {
        w: SIMBLIP_SLIDE_W_PX - 2 * bgX,
        h: SIMBLIP_SLIDE_H_PX - 2 * bgY,
      }
      bgPic.geometry.src = bgSrc
      bgPic.z = -9999
      objects.push(bgPic)
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
