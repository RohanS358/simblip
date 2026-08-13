'use client'

// LEGACY PATH. Importing a .docx no longer creates a Document page — it
// resolves to the 'pdf' kind now and is rendered by to-pdf.ts's docx-preview
// conversion instead (see components/workspace/open-file.ts for why). This
// importer is still reached by doc-view.tsx's first-open effect, for doc
// pages created back when .docx did open as one, and its docx-export.ts
// inverse is still Document's live "Export .docx".
//
// .docx -> SceneObject[], for doc-view.tsx's first-open import (a Document
// page created from an uploaded Word file). A .docx is a zip of OOXML —
// this reads word/document.xml's paragraphs (<w:p>, text runs in <w:t>)
// into one `text` scene object per paragraph, stacked top-to-bottom on a
// single sheet — the inverse of docx-export.ts's paragraphsOf, which reads
// text objects back out in the same y-sorted order.
//
// Best-effort only: paragraph text and order carry over; styling, tables,
// images, headers/footers, and multi-column layout do not (see the
// file-viewers design spec's explicit scope cut).

import JSZip from 'jszip'
import { baseObject } from '@/lib/scene/factory'
import { str, type SceneObject } from '@/lib/scene/types'
import { SHEET_W } from '@/lib/scene/frames'

const LINE_H = 28 // px between stacked paragraphs, matches text's default 48px box minus padding feel
const SHEET_MARGIN = 47 // px of margin on each side of the A4 sheet
const SHEET_W_PADDED = SHEET_W - SHEET_MARGIN * 2

function paragraphText(p: Element): string {
  return Array.from(p.getElementsByTagName('w:t'))
    .map((t) => t.textContent ?? '')
    .join('')
}

/** Returns one SceneObject[] per sheet — paragraphs are packed onto sheets
 *  at a fixed count each, since a real docx has no fixed page breaks a DOM
 *  walk alone can resolve reliably (that requires full layout, which this
 *  bespoke parser doesn't do). */
export async function importDocx(blob: Blob): Promise<SceneObject[][]> {
  const zip = await JSZip.loadAsync(blob)
  const docXml = zip.files['word/document.xml']
  if (!docXml) throw new Error('Not a valid .docx file.')
  const xml = await docXml.async('text')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const paragraphs = Array.from(doc.getElementsByTagName('w:p'))
    .map(paragraphText)
    .filter((t) => t.length > 0)

  if (paragraphs.length === 0) return [[]]

  const PARAS_PER_SHEET = 20
  const sheets: SceneObject[][] = []
  for (let i = 0; i < paragraphs.length; i += PARAS_PER_SHEET) {
    const chunk = paragraphs.slice(i, i + PARAS_PER_SHEET)
    const objects: SceneObject[] = chunk.map((text, j) => {
      const obj = baseObject('text', { x: 40, y: 40 + j * LINE_H })
      obj.size = { w: SHEET_W_PADDED, h: LINE_H }
      obj.parameters.text = str(text)
      return obj
    })
    sheets.push(objects)
  }
  return sheets
}
