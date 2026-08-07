'use client'

// Slide object trees (SceneObject[], keyed by a presentation page's
// docPages ids — see presentation-view.tsx) -> a real .pptx, via pptxgenjs.
// Round-trips what pptx-import.ts now extracts: text (real per-run bold/
// italic/color/size via lib/text/marks.ts's mark ranges, bullets via the
// app's literal "- "/"1. " line-prefix convention), rect/circle shapes
// (fillColor/strokeColor/strokeWidth metadata), pictures (re-fetched from
// OPFS and inlined as base64), and slide backgrounds (sheetColors).
//
// Best-effort, not pixel-perfect: polygons, and any other canvas object
// kind (formula, graph, symbol, …) have no pptx equivalent and are skipped
// — they stay on the canvas but don't appear in the exported file.

import { getFile } from '@/lib/storage/manager'
import type { SceneObject } from '@/lib/scene/types'
import { parse, runsForLine, resolveSizePx, type Mark } from '@/lib/text/marks'

export const PPT_W_IN = 10 // matches presentation-view's 16:9 slide, in inches
export const PPT_H_IN = 5.625
const PX_PER_IN = 96 // CSS px, matches pptx-import.ts's EMU_PER_PX basis

const inches = (px: number) => px / PX_PER_IN
const toHex = (color: string) => (color.startsWith('#') ? color.slice(1) : color)

const BLOCK_PREFIX = /^(?: {8})*(?:-\s+|\d+\.\s+)/

function marksToTextProps(text: string, marks: Mark[]): { text: string; options: Record<string, unknown> }[] {
  const lines = text.split('\n')
  const runs: { text: string; options: Record<string, unknown> }[] = []
  let offset = 0
  lines.forEach((line, i) => {
    if (i > 0) runs.push({ text: '', options: { breakLine: true } })
    // Strip the app's literal bullet-prefix convention back into a real
    // pptxgenjs bullet option instead of leaving "- "/"1. " as visible text.
    const prefixMatch = line.match(BLOCK_PREFIX)
    const isBullet = !!prefixMatch
    const body = prefixMatch ? line.slice(prefixMatch[0].length) : line
    const bodyStart = offset + (prefixMatch ? prefixMatch[0].length : 0)

    for (const run of runsForLine(body, marks, bodyStart)) {
      if (!run.text) continue
      const options: Record<string, unknown> = { breakLine: false }
      if (isBullet) options.bullet = true
      for (const m of run.marks) {
        if (m.kind === 'bold') options.bold = true
        if (m.kind === 'italic') options.italic = true
        if (m.kind === 'underline') options.underline = true
        if (m.kind === 'strike') options.strike = true
        if (m.kind === 'size' && m.value) options.fontSize = Math.round(resolveSizePx(m.value) * (72 / 96))
        if (m.kind === 'color' && m.value?.startsWith('#')) options.color = toHex(m.value)
      }
      runs.push({ text: run.text, options })
    }
    offset += line.length + 1
  })
  return runs
}

async function pictureToBase64(src: string): Promise<string | null> {
  const fileId = src.startsWith('opfs:') ? src.slice('opfs:'.length) : null
  if (!fileId) return null
  const blob = await getFile(fileId)
  if (!blob) return null
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

export async function exportPptx(
  slides: Record<string, SceneObject>[],
  backgrounds?: (string | undefined)[]
): Promise<Blob> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'SIMBLIP', width: PPT_W_IN, height: PPT_H_IN })
  pptx.layout = 'SIMBLIP'

  for (let i = 0; i < slides.length; i++) {
    const objects = slides[i]
    const slide = pptx.addSlide()
    const bg = backgrounds?.[i]
    if (bg) slide.background = { color: toHex(bg) }

    for (const obj of Object.values(objects).sort((a, b) => a.z - b.z)) {
      const x = inches(obj.position.x)
      const y = inches(obj.position.y)
      const w = inches(obj.size.w)
      const h = inches(obj.size.h)

      if (obj.geometry.kind === 'picture' && obj.geometry.src) {
        const data = await pictureToBase64(obj.geometry.src)
        if (data) slide.addImage({ data, x, y, w, h })
        continue
      }

      if (obj.geometry.kind === 'rect' || obj.geometry.kind === 'circle') {
        const fillColor = obj.metadata.fillColor as string | undefined
        const strokeColor = obj.metadata.strokeColor as string | undefined
        const strokeWidth = obj.metadata.strokeWidth as number | undefined
        const cornerRadius = obj.metadata.cornerRadius as number | undefined
        const opacity = obj.metadata.opacity as number | undefined
        if (fillColor || strokeColor) {
          slide.addShape(obj.geometry.kind === 'circle' ? 'ellipse' : 'rect', {
            x,
            y,
            w,
            h,
            // pptxgenjs transparency is 0-100 where 100 is fully transparent
            // — inverse of this app's opacity metadata (100 = fully opaque).
            fill: fillColor
              ? { color: toHex(fillColor), transparency: opacity !== undefined ? 100 - opacity : undefined }
              : { type: 'none' },
            line: strokeColor ? { color: toHex(strokeColor), width: strokeWidth ?? 1 } : { type: 'none' },
            rectRadius: obj.geometry.kind === 'rect' && cornerRadius ? inches(cornerRadius) : undefined,
          })
        }
        continue
      }

      if (obj.geometry.kind !== 'text' && obj.geometry.kind !== 'note') continue
      const rawText = obj.parameters.text
      const raw = rawText?.kind === 'string' ? rawText.value : ''
      if (!raw) continue
      const { text, marks } = parse(raw)
      if (!text) continue
      const runs = marksToTextProps(text, marks)
      slide.addText(runs as never, { x, y, w, h, fontSize: 14, valign: 'top' })
    }
  }

  const out = await pptx.write({ outputType: 'blob' })
  return out as Blob
}
