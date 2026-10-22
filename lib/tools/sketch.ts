'use client'

// sketch.* — read a hand-drawn or photographed diagram, and build it. The reading is the same one the Done
// button and the "Read as circuit" button use (lib/sketch), so what the tutor says it read is what the
// student sees in the preview.

import { z } from 'zod'
import { useDocStore } from '@/lib/store/document'
import { readSketchAsync, readPhotoAsync } from '@/lib/sketch/read-client'
import { connectedInk, type ReadResult } from '@/lib/sketch/read-sketch'
import { decodePicture } from '@/lib/sketch/photo/picture'
import { applyCircuit, applyMech } from '@/lib/sketch/apply'
import { describeReading } from '@/lib/sketch/teach'
import { defineTool, fail, ok, type ToolContext, type ToolResult } from './types'
import { registerTool } from './registry'

const noPage = () => fail('No page is open. Open a notebook page first.')

interface Found {
  res: ReadResult
  what: string
}

/** Read the picture `object` (a photo), or else the ink on the page (the selection if there is one, else the newest sketch). */
async function readTarget(ctx: ToolContext, object?: string): Promise<Found | ToolResult> {
  if (!ctx.pageId) return noPage()
  const st = useDocStore.getState()
  const page = st.pages[ctx.pageId]
  if (!page) return noPage()
  if (object) {
    const o = page.objects[object]
    if (!o || o.geometry.kind !== 'picture' || !o.geometry.src) return fail(`"${object}" is not a picture on this page. Use scene.describe to see ids.`)
    const img = await decodePicture(o.geometry.src)
    if (!img) return fail('I could not open that picture.')
    const res = await readPhotoAsync(ctx.pageId, img, { x: o.position.x, y: o.position.y, k: o.size.w / img.width })
    return { res, what: 'the picture' }
  }
  const ink = Object.values(page.objects)
    .filter((o) => (o.geometry.kind === 'stroke' || o.geometry.kind === 'line') && o.behaviors.length === 0)
    .map((o) => ({ id: o.id, z: o.z, pts: (o.geometry.points ?? [[0, 0], [o.size.w, 0]]).map(([x, y]) => [x + o.position.x, y + o.position.y]) }))
  const picked = st.selection.length ? ink.filter((s) => st.selection.includes(s.id)) : ink
  if (picked.length === 0) return fail('There is no hand-drawn ink on this page to read. Draw a circuit, or pass the id of a picture.')
  const strokes = picked.map(({ id, pts }) => ({ id, pts }))
  // with a selection, the selection IS the drawing; otherwise the newest stroke names which sketch
  const newest = picked.reduce((a, b) => (b.z > a.z ? b : a))
  const cluster = st.selection.length ? strokes : connectedInk(strokes, newest.id, 120)
  const res = await readSketchAsync(ctx.pageId, cluster, newest.id)
  return { res, what: st.selection.length ? 'the selected ink' : 'the newest sketch' }
}

const isFound = (x: Found | ToolResult): x is Found => 'res' in x

const input = z.object({
  object: z.string().optional().describe('id of a picture on the page to read (a photo of a diagram); omit to read the ink'),
})

export const sketchRecognize = registerTool(
  defineTool({
    name: 'sketch.recognize',
    summary: 'Read a drawn or photographed diagram and say what it contains',
    help:
      'Reads the ink on the page (or the picture with the given id) as a circuit, a mechanics scene or an optics bench. Returns what was read, the parts it is unsure of, and questions worth asking the student (open circuit, no source, direction of a diode). Changes nothing.',
    effect: 'read',
    keywords: ['what did you read', 'recognise', 'recognize', 'read my drawing', 'read my sketch', 'read this diagram', 'photo of', 'my circuit drawing', 'what have i drawn'],
    input,
    async run({ object }, ctx) {
      const f = await readTarget(ctx, object)
      if (!isFound(f)) return f
      const d = describeReading(f.res)
      const lines = [d.read, ...(d.unsure.length ? [`Unsure of: ${d.unsure.join('; ')}.`] : []), ...d.moves.slice(0, 4)]
      return ok(`From ${f.what}: ${lines.join(' ')}`, { kind: d.kind, read: d.read, unsure: d.unsure, questions: d.moves })
    },
  })
)

export const sketchToScene = registerTool(
  defineTool({
    name: 'sketch.to_scene',
    summary: 'Turn a drawn or photographed diagram into a live simulation',
    help:
      'Reads the diagram as sketch.recognize does, and if the reading is a whole circuit, mechanics scene or optics bench, builds it on the page in one undo step (the ink it replaces comes back on undo). Refuses a reading that is only a guess; ask the student first, or have them press Done drawing to correct it in the preview.',
    effect: 'write',
    keywords: ['make it live', 'turn my drawing into', 'simulate my drawing', 'simulate this circuit', 'build from my sketch', 'convert my sketch', 'run my circuit'],
    input,
    async run({ object }, ctx) {
      const f = await readTarget(ctx, object)
      if (!isFound(f)) return f
      const { res } = f
      const d = describeReading(res)
      if (res.kind === 'fail') return fail(`Not built — ${res.failure.message}`)
      if (res.kind === 'symbol') {
        return fail(`Not built — I found only one symbol, not a circuit (${d.read}). Add the rest of the circuit, or place it with scene.add.`)
      }
      const weak = res.kind === 'circuit' ? res.ghost.result.parts.filter((p) => p.conf < 0.5) : []
      if (weak.length) return fail(`Not built — I am unsure of ${weak.length} part${weak.length === 1 ? '' : 's'} (${d.unsure.join('; ')}). Have the student check the preview first.`)
      const out = res.kind === 'circuit' ? applyCircuit(res.ghost) : applyMech(res.ghost)
      if (!out.ok) return fail(`Not built — ${out.failure.detail}`)
      return ok([d.read, out.message, ...d.moves.slice(0, 3)].join(' '), { built: out.built.length, problem: out.problem, questions: d.moves })
    },
  })
)
