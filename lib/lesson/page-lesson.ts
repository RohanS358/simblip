// "Teach me whatever is in this page": the open page becomes a tour. Each thing on it is brought into view and
// explained, in reading order. The page is the source of truth — the explanation may only say what the content says
// or directly implies, so a model can phrase it but cannot invent what is on the page.

import { speakable } from '@/lib/tts/speakable'
import { sentences } from './from-course'
import type { Llm } from './director'
import type { PageItem, PageReading } from './page-read'
import { storyboardSchema, type Beat, type Storyboard } from './storyboard'

const MAX_ITEMS = 40
const BATCH = 8

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

export async function explainItems(llm: Llm, items: PageItem[], signal?: AbortSignal): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  for (let at = 0; at < items.length; at += BATCH) {
    if (signal?.aborted) break
    const batch = items.slice(at, at + BATCH)
    const body = batch.map((it, k) => `#${at + k} [${it.kind}] ${clip(it.text.replace(/\s+/g, ' '), 600)}`).join('\n')
    try {
      const reply = await llm.complete(SYSTEM, body, { signal })
      const lines = (JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? '') as { lines?: { i: number; text: string }[] }).lines ?? []
      for (const l of lines) if (Number.isInteger(l.i) && at <= l.i && l.i < at + batch.length && String(l.text ?? '').trim().length >= 3) out.set(l.i, String(l.text).trim())
    } catch { /* those items fall back to their own words */ }
  }
  return out
}

/** Spoken beats for one explanation: short sentences, so each is a comfortable breath. */
const saysOf = (text: string): Beat[] => {
  const ss = sentences(text)
  const out: string[] = []
  for (const s of ss.length ? ss : [text]) out.push(s)
  return out.slice(0, 4).map((t) => ({ t: 'say', text: t.slice(0, 400) }) as Beat)
}

export function pageStoryboard(reading: PageReading, explanations: Map<number, string>): Storyboard {
  const items = reading.items.slice(0, MAX_ITEMS)
  const beats: Beat[] = [{ t: 'title', text: `Walking through ${reading.title}`.slice(0, 118), sub: `${items.length} thing${items.length === 1 ? '' : 's'} on this page` }]
  items.forEach((it, i) => {
    if (it.ids.length) beats.push({ t: 'focus', ids: it.ids.slice(0, 60), pageId: it.pageId })
    const said = saysOf(explanations.get(i) ?? fallbackLine(it))
    beats.push(said[0])
    // A figure that is running: let the student watch it while the rest is said.
    if (it.kind === 'figure' && it.live) beats.push({ t: 'run', seconds: 4 })
    beats.push(...said.slice(1))
  })
  beats.push({ t: 'say', text: 'That is everything on this page. Ask me about any part of it and I will go through it again.' })
  return storyboardSchema.parse({ title: `Tour of ${reading.title}`.slice(0, 158), source: 'page-tour', beats })
}
