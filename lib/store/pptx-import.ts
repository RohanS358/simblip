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
import { serialize, type Mark, type MarkKind } from '@/lib/text/marks'

// Slide XML coordinates are EMUs (914400 per inch); a 960px-wide slide at
// PPT_W_IN=10in (pptx-export.ts) matches a standard 10in-wide 16:9 deck.
const EMU_PER_PX = 9525 // 914400 / 96dpi
const PT_TO_PX = 96 / 72 // OOXML font sizes are in points (sz="2400" = 24pt, hundredths of a point)

function emuToPx(v: string | null): number {
  return v ? Math.round(Number(v) / EMU_PER_PX) : 0
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

/** <a:srgbClr val="RRGGBB"/> or <a:schemeClr val="..."/> (falls back to a
 *  reasonable default since resolving a theme's actual scheme colors would
 *  need parsing ppt/theme/theme1.xml too — out of scope for a best-effort
 *  importer). Returns a CSS hex string or null if no fill is specified. */
function solidFillColor(container: Element | null): string | null {
  const fill = firstChild(container, 'a:solidFill')
  if (!fill) return null
  const srgb = firstChild(fill, 'a:srgbClr')
  if (srgb) return `#${srgb.getAttribute('val')}`
  const scheme = firstChild(fill, 'a:schemeClr')
  if (scheme) {
    const val = scheme.getAttribute('val')
    // Reasonable stand-ins for the common scheme slots — real theme
    // resolution would read ppt/theme/theme1.xml's <a:clrScheme>.
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
    return val ? (SCHEME_FALLBACK[val] ?? '#808080') : null
  }
  return null
}

// ── Text: <a:p> paragraphs -> {text, marks} + bullet-prefix reconstruction ─

const BULLET_MARK_KINDS: MarkKind[] = ['bold', 'italic', 'underline', 'strike']

function runMarks(rPr: Element | null, start: number, end: number): Mark[] {
  if (!rPr || end <= start) return []
  const marks: Mark[] = []
  if (rPr.getAttribute('b') === '1') marks.push({ start, end, kind: 'bold' })
  if (rPr.getAttribute('i') === '1') marks.push({ start, end, kind: 'italic' })
  const u = rPr.getAttribute('u')
  if (u && u !== 'none') marks.push({ start, end, kind: 'underline' })
  const sz = rPr.getAttribute('sz') // hundredths of a point
  if (sz) {
    const px = Math.round((Number(sz) / 100) * PT_TO_PX)
    if (Number.isFinite(px) && px > 0) marks.push({ start, end, kind: 'size', value: String(px) })
  }
  const color = solidFillColor(rPr)
  if (color) marks.push({ start, end, kind: 'color', value: color })
  return marks
}

/** One paragraph -> its plain text (with a reconstructed "- "/"1. " bullet
 *  prefix per the app's existing literal-prefix convention, see
 *  components/objects/text.tsx's BLOCK_PREFIX) + marks at the right
 *  offsets (shifted past the prefix). */
function paragraphToLine(p: Element): { text: string; marks: Mark[] } {
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
    marks.push(...runMarks(firstChild(r, 'a:rPr'), start, text.length))
  }
  return { text, marks }
}

function shapeText(sp: Element): { text: string; marks: Mark[] } | null {
  const txBody = firstChild(sp, 'p:txBody')
  if (!txBody) return null
  const paragraphs = directChildren(txBody, 'a:p')
  if (paragraphs.length === 0) return null
  let text = ''
  const marks: Mark[] = []
  paragraphs.forEach((p, i) => {
    if (i > 0) text += '\n'
    const line = paragraphToLine(p)
    const offset = text.length
    text += line.text
    marks.push(...line.marks.map((m) => ({ ...m, start: m.start + offset, end: m.end + offset })))
  })
  return text.trim().length > 0 ? { text, marks } : null
}

// ── Shape geometry: position/size + fill/border ────────────────────────────

function shapeBox(sp: Element): { x: number; y: number; w: number; h: number } {
  const xfrm = firstChild(sp, 'a:xfrm')
  const off = firstChild(xfrm, 'a:off')
  const ext = firstChild(xfrm, 'a:ext')
  return {
    x: emuToPx(off?.getAttribute('x') ?? null) || 40,
    y: emuToPx(off?.getAttribute('y') ?? null) || 40,
    w: emuToPx(ext?.getAttribute('cx') ?? null) || 320,
    h: emuToPx(ext?.getAttribute('cy') ?? null) || 48,
  }
}

function shapeFillAndBorder(sp: Element): { fillColor?: string; strokeColor?: string; strokeWidth?: number } {
  const spPr = firstChild(sp, 'p:spPr')
  const fillColor = solidFillColor(spPr) ?? undefined
  const ln = firstChild(spPr, 'a:ln')
  const strokeColor = solidFillColor(ln) ?? undefined
  const w = ln?.getAttribute('w') // EMUs
  const strokeWidth = w ? Math.max(0.5, Math.round((Number(w) / EMU_PER_PX) * 10) / 10) : undefined
  return { fillColor, strokeColor, strokeWidth }
}

/** <a:prstGeom prst="..."/> — mapped onto SIMBLIP's 3 real geometry kinds
 *  (rect/circle/polygon); anything unrecognized defaults to rect, since a
 *  labeled box is a closer visual match than dropping the shape entirely. */
function geometryKindOf(sp: Element): 'rect' | 'circle' {
  const prst = firstChild(firstChild(sp, 'p:spPr'), 'a:prstGeom')?.getAttribute('prst')
  return prst === 'ellipse' ? 'circle' : 'rect'
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

/** Slide background: <p:bg><p:bgPr><a:solidFill>. */
function slideBackground(doc: Document): string | undefined {
  const bg = doc.getElementsByTagName('p:bg')[0]
  const bgPr = firstChild(bg ?? null, 'p:bgPr')
  return solidFillColor(bgPr) ?? undefined
}

async function pictureObject(
  pic: Element,
  zip: JSZip,
  assets: SlideAssets,
  ownerId: string
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

  const box = shapeBox(pic)
  const obj = baseObject('picture', { x: box.x, y: box.y })
  obj.size = { w: box.w, h: box.h }
  obj.geometry.src = `opfs:${fileId}`
  return obj
}

async function shapesToObjects(
  xml: string,
  zip: JSZip,
  assets: SlideAssets,
  ownerId: string
): Promise<{ objects: SceneObject[]; background?: string }> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const spTree = doc.getElementsByTagName('p:spTree')[0]
  if (!spTree) return { objects: [] }
  const objects: SceneObject[] = []

  for (const child of Array.from(spTree.children)) {
    if (child.tagName === 'p:pic') {
      const obj = await pictureObject(child, zip, assets, ownerId)
      if (obj) objects.push(obj)
      continue
    }
    if (child.tagName !== 'p:sp') continue
    const box = shapeBox(child)
    const line = shapeText(child)
    const { fillColor, strokeColor, strokeWidth } = shapeFillAndBorder(child)
    const hasVisibleShape = !!(fillColor || strokeColor)

    if (line) {
      const obj = baseObject('text', { x: box.x, y: box.y })
      obj.size = { w: box.w, h: box.h }
      obj.parameters.text = str(serialize({ text: line.text, marks: line.marks }))
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
        if (fillColor) shape.metadata.fillColor = fillColor
        if (strokeColor) shape.metadata.strokeColor = strokeColor
        if (strokeWidth) shape.metadata.strokeWidth = strokeWidth
        objects.push(shape)
      }
    } else if (hasVisibleShape) {
      const shape = baseObject(geometryKindOf(child), { x: box.x, y: box.y })
      shape.size = { w: box.w, h: box.h }
      if (fillColor) shape.metadata.fillColor = fillColor
      if (strokeColor) shape.metadata.strokeColor = strokeColor
      if (strokeWidth) shape.metadata.strokeWidth = strokeWidth
      objects.push(shape)
    }
  }

  return { objects, background: slideBackground(doc) }
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

  const results: ImportedSlide[] = []
  for (const name of slideFiles) {
    const slideName = name.slice(name.lastIndexOf('/') + 1, -4) // "slide1"
    const [xml, assets] = await Promise.all([zip.files[name].async('text'), loadSlideRels(zip, slideName)])
    const { objects, background } = await shapesToObjects(xml, zip, assets, ownerId)
    results.push({ objects, background })
  }
  return results
}
