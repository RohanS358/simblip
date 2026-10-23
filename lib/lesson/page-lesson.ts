// "Teach me whatever is in this page": the open page becomes a tour. Each thing on it is brought into view and
// explained, in reading order. The page is the source of truth — the explanation may only say what the content says
// or directly implies, so a model can phrase it but cannot invent what is on the page.

import { speakable } from '@/lib/tts/speakable'
import { lintSimScript } from '@/lib/ai/simscript-lint'
import { sentences } from './from-course'
import { conceptDiagram, type Llm, type Runner } from './director'
import { circuitRecipe } from './recipes'
import { cashflowRecipe } from './cashflow-recipe'
import { extractJson } from './plan'
import type { PageItem, PageReading } from './page-read'
import { storyboardSchema, type Beat, type Storyboard } from './storyboard'

const MAX_ITEMS = 60
const BATCH = 8
const DETAIL_BATCH = 3
const MAX_PICTURES = 14

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t)

/** What to say when no model can phrase it: read the content itself, or name what it is. Always grounded, never empty. */
export function fallbackLine(item: PageItem): string {
  switch (item.kind) {
    case 'text': return sentences(item.text).slice(0, 2).join(' ') || item.text
    case 'formula': return `This formula says: ${speakable(item.text)}.`
    case 'table': return 'This is a table of values.'
    case 'graph': return 'This graph plots how a quantity changes.'
    case 'lab': return 'This is a step-by-step simulator: it walks through the process one stage at a time.'
    case 'figure': return `This is a simulation made of ${Math.max(1, item.ids.length)} part${item.ids.length === 1 ? '' : 's'}.${item.live ? ' Press play to watch it run.' : ''}`
  }
}

const SYSTEM = `You are a patient teacher walking a student through a page they are looking at. You are given the page's items in reading order. For EACH item, write what the student should understand from it: 1 to 3 short spoken sentences, at most 25 words each, plain English. Say what it is and what it means. Use ONLY what the item says or directly shows — never add facts that are not on the page. For a simulation, say what it shows and what to watch. Reply with JSON only: {"lines":[{"i":<item number>,"text":"..."}]}, one entry per item.`

const DETAIL_SYSTEM = `You are a patient teacher walking a student through a page they are looking at. You are given the page's items in reading order. Teach EACH item properly:
- "text": 3 to 6 spoken sentences, at most 28 words each, plain English. Say what it is, define every term the first time it appears, explain WHY it is true or why it matters, and give one everyday example or work a number through. Use ONLY what the item says or directly implies — never add facts that are not on the page.
- "picture": ONE sentence describing a diagram or simulation that would make the idea click, with concrete values (a circuit with its values, a ball thrown at 20 m/s at 40 degrees, a cash-flow timeline with its amounts, a block diagram of how the ideas connect). Draw the IDEA behind the item (the physics, the circuit, the process) — never the page itself or its buttons. Give one for every item about an idea, process or quantity; leave it out only for headings and plain lists of names.
Reply with JSON only: {"lines":[{"i":<item number>,"text":"...","picture":"..."}]}, one entry per item.`

export interface ExplainOpts {
  /** "To the point": the short explanation, no pictures. Taught in full otherwise. */
  brief?: boolean
  /** Filled with a picture to draw for each item that merits one (item number → one-sentence description). */
  pictures?: Map<number, string>
  onProgress?: (done: number, total: number) => void
}

export async function explainItems(llm: Llm, items: PageItem[], signal?: AbortSignal, opts: ExplainOpts = {}): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const size = opts.brief ? BATCH : DETAIL_BATCH
  for (let at = 0; at < items.length; at += size) {
    if (signal?.aborted) break
    opts.onProgress?.(at, items.length)
    const batch = items.slice(at, at + size)
    const body = batch.map((it, k) => `#${at + k} [${it.kind}] ${clip(it.text.replace(/\s+/g, ' '), opts.brief ? 600 : 1500)}`).join('\n')
    try {
      const reply = await llm.complete(opts.brief ? SYSTEM : DETAIL_SYSTEM, body, { signal })
      // extractJson, not JSON.parse: a model slips (a stray quote before a key, a dangling comma, fences) and a whole batch is lost over it.
      const lines = (extractJson(reply) as { lines?: { i: number | string; text: string; picture?: string }[] }).lines ?? []
      for (const l of lines) {
        const i = Number(l.i)
        if (!Number.isInteger(i) || i < at || i >= at + batch.length || String(l.text ?? '').trim().length < 3) continue
        out.set(i, String(l.text).trim())
        if (!opts.brief && opts.pictures && typeof l.picture === 'string' && l.picture.trim().length >= 8) opts.pictures.set(i, l.picture.trim().slice(0, 240))
      }
    } catch { /* those items fall back to their own words */ }
  }
  return out
}

export interface Picture { script: string; caption: string }

/** Draw each requested picture: an exact recipe, else the scene model; verified by running it; a concept diagram when it will not run. */
export async function illustrate(d: { llm: Llm; runner: Runner; signal?: AbortSignal; onProgress?: (m: string) => void }, pictures: Map<number, string>): Promise<Map<number, Picture>> {
  const out = new Map<number, Picture>()
  for (const [i, desc] of pictures) {
    if (d.signal?.aborted || out.size >= MAX_PICTURES) break
    d.onProgress?.(`Drawing picture ${out.size + 1}…`)
    let script: string | null = null
    try {
      const lint = lintSimScript(circuitRecipe(desc) ?? cashflowRecipe(desc) ?? (await d.llm.script(desc, d.signal)))
      if (lint.ok && (await d.runner.ground(lint.cleaned)).ok) script = lint.cleaned
    } catch { /* fall back to a diagram */ }
    script ??= await conceptDiagram({ llm: d.llm, runner: d.runner, level: 'basic', signal: d.signal }, { heading: desc.slice(0, 70), say: [desc] })
    if (script) out.set(i, { script, caption: desc.slice(0, 200) })
  }
  return out
}

/** Spoken beats for one explanation: short sentences, so each is a comfortable breath. */
const saysOf = (text: string, max = 8): Beat[] => {
  const ss = sentences(text)
  const out: string[] = []
  for (const s of ss.length ? ss : [text]) out.push(s)
  return out.slice(0, max).map((t) => ({ t: 'say', text: t.slice(0, 400) }) as Beat)
}

export function pageStoryboard(reading: PageReading, explanations: Map<number, string>, pictures: Map<number, Picture> = new Map(), opts: { brief?: boolean } = {}): Storyboard {
  const items = reading.items.slice(0, MAX_ITEMS)
  const beats: Beat[] = [{ t: 'title', text: `Walking through ${reading.title}`.slice(0, 118), sub: `${items.length} thing${items.length === 1 ? '' : 's'} on this page` }]
  let turned = 0
  items.forEach((it, i) => {
    if (it.pdfPage && it.pdfPage !== turned) { turned = it.pdfPage; beats.push({ t: 'page', n: it.pdfPage }) }
    if (it.ids.length) beats.push({ t: 'focus', ids: it.ids.slice(0, 60), pageId: it.pageId })
    const said = saysOf(explanations.get(i) ?? fallbackLine(it), opts.brief ? 4 : 8)
    beats.push(said[0])
    // The picture is drawn onto the page while the next sentences are said, so the words and the drawing arrive together.
    const pic = pictures.get(i)
    if (pic) beats.push({ t: 'scene', script: pic.script, clear: false, caption: pic.caption })
    // A figure that is running: let the student watch it while the rest is said.
    if (it.kind === 'figure' && it.live) beats.push({ t: 'run', seconds: 4 })
    beats.push(...said.slice(1))
    if (pic && /\bsimulation|circuit|ball|spring|pendulum|wave|lens|mass\b/i.test(pic.caption)) beats.push({ t: 'run', seconds: 4 })
  })
  beats.push({ t: 'say', text: 'That is everything on this page. Ask me about any part of it and I will go through it again.' })
  return storyboardSchema.parse({ title: `Tour of ${reading.title}`.slice(0, 158), source: 'page-tour', beats })
}
