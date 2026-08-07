'use client'

// Doc page sheets (SceneObject[], keyed by docPages ids) -> a real .docx,
// for doc-view.tsx's "Export as .docx" action — same scope/limits as
// pptx-export.ts: only `text`/`note` geometry round-trips as paragraphs
// (one per sheet, in position order top-to-bottom). A shape/graph/formula
// dropped onto a sheet from SIMBLIP's own canvas tools stays on the canvas
// when exported, since the `docx` library has no equivalent for this app's
// bespoke object types. This is the text-content complement to the
// existing exportPdf (which rasterizes the sheet as an image instead).

import { Document, Packer, Paragraph, TextRun, PageBreak } from 'docx'
import type { SceneObject } from '@/lib/scene/types'

function paragraphsOf(objects: Record<string, SceneObject>): Paragraph[] {
  const textObjects = Object.values(objects)
    .filter((o) => o.geometry.kind === 'text' || o.geometry.kind === 'note')
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const paragraphs = textObjects.map((obj) => {
    const text = obj.parameters.text
    const value = text?.kind === 'string' ? text.value : ''
    return new Paragraph({ children: [new TextRun(value)] })
  })
  return paragraphs.length ? paragraphs : [new Paragraph({ children: [] })]
}

export async function exportDocx(sheets: Record<string, SceneObject>[]): Promise<Blob> {
  const children: Paragraph[] = []
  sheets.forEach((objects, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }))
    children.push(...paragraphsOf(objects))
  })
  const doc = new Document({ sections: [{ children }] })
  return Packer.toBlob(doc)
}
