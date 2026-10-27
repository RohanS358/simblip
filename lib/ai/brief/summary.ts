'use client'

// A model-written map of a very long document, made once and remembered.
//
// Retrieval (page-brief.ts) finds the passages a question needs, but with 300 pages the model still cannot see what the rest of
// the document is about or where things are. This reads the document in sections, has the model say what each is about in a
// sentence or two, then writes a short overview from those — map-reduce. The result is cached under a hash of the text, so a
// document is summarised once per device however many questions are asked, and a changed document gets a new key.
//
// It runs in the BACKGROUND: the question that triggers it is answered at once from retrieval alone, and the next one has the
// map. A model that is unavailable, or a run that is cancelled, costs nothing but the map.

import { create } from 'zustand'
import type { Llm } from '@/lib/lesson/director'
import type { BriefItem } from './page-brief'
import { clip, sentenceList } from './lexical'

/** Below this much text, retrieval alone is enough and no model time is spent. */
export const LONG_CHARS = 20_000
const GROUP_CHARS = 3_000
/** At most this many sections are summarised (about 240k characters): the rest is still found by retrieval. */
const MAX_GROUPS = 80
const STORE = 'simblip.docsummary.'
const INDEX = 'simblip.docsummary.index'
const KEEP = 12

export interface SummaryGroup {
  /** Item indexes, inclusive. */
  from: number
  to: number
  gist: string
}
export interface DocSummary {
  key: string
  overview: string
  groups: SummaryGroup[]
}

export const totalChars = (items: BriefItem[]) => items.reduce((n, i) => n + i.text.length, 0)

/** FNV-1a over the text: cheap, stable, and enough to tell one document from another. */
export function hashItems(items: BriefItem[]): string {
  let h = 0x811c9dc5
  for (const it of items) {
    const s = `${it.kind}|${it.text}`
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  }
  return `${items.length}-${(h >>> 0).toString(36)}`
}

/** Consecutive items gathered into sections of about GROUP_CHARS. */
export function groupItems(items: BriefItem[], size = GROUP_CHARS): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = []
  let cur: { from: number; to: number; text: string } | null = null
  items.forEach((it, i) => {
    if (cur && cur.text.length + it.text.length > size) { out.push(cur); cur = null }
    if (!cur) cur = { from: i, to: i, text: '' }
    cur.to = i
    cur.text += `${it.locator ? `[${it.locator}] ` : ''}${it.text}\n`
  })
  if (cur) out.push(cur)
  return out
}

// ── cache ───────────────────────────────────────────────────────────────────

const mem = new Map<string, DocSummary>()

export function cachedSummary(key: string): DocSummary | undefined {
  const hit = mem.get(key)
  if (hit) return hit
  try {
    const raw = localStorage.getItem(STORE + key)
    if (!raw) return undefined
    const s = JSON.parse(raw) as DocSummary
    if (s?.key === key && s.groups?.length) { mem.set(key, s); return s }
  } catch { /* private mode, or a corrupt entry */ }
  return undefined
}

function remember(s: DocSummary) {
  mem.set(s.key, s)
  try {
    const order: string[] = JSON.parse(localStorage.getItem(INDEX) ?? '[]').filter((k: string) => k !== s.key)
    order.push(s.key)
    while (order.length > KEEP) localStorage.removeItem(STORE + order.shift())
    localStorage.setItem(STORE + s.key, JSON.stringify(s))
    localStorage.setItem(INDEX, JSON.stringify(order))
  } catch { /* storage full or unavailable: the in-memory copy still serves this session */ }
}

// ── making one ──────────────────────────────────────────────────────────────

const GIST_SYSTEM = 'You summarise one section of a long document for a study assistant. Reply with plain text only: at most two sentences (35 words) saying what this section covers. Keep the key terms, names and numbers. Do not add anything that is not in the section.'
const OVERVIEW_SYSTEM = 'You are given one-line summaries of consecutive sections of a document. Write a plain-text overview of 3 to 5 sentences (90 words at most): what the document is about and how it is organised. Use only what the summaries say.'

/** The model's reply, made safe to store: no markdown, no thinking, bounded. */
const tidy = (t: string, n: number) => clip(t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim(), n)

export async function summariseDocument(items: BriefItem[], llm: Llm, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<DocSummary> {
  const key = hashItems(items)
  const groups = groupItems(items).slice(0, MAX_GROUPS)
  const out: SummaryGroup[] = []
  for (let i = 0; i < groups.length; i++) {
    if (opts.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    opts.onProgress?.(i, groups.length)
    const g = groups[i]
    let gist = ''
    try {
      gist = tidy(await llm.complete(GIST_SYSTEM, clip(g.text, 3_400), { signal: opts.signal }), 260)
    } catch (e) {
      if (opts.signal?.aborted) throw e
    }
    // A model that fails or says nothing leaves the section's own opening: the map is never blank.
    out.push({ from: g.from, to: g.to, gist: gist || clip(sentenceList(g.text.replace(/\[[^\]]*\]\s*/g, '')).slice(0, 2).join(' '), 200) })
  }
  let overview = ''
  try {
    overview = tidy(await llm.complete(OVERVIEW_SYSTEM, out.map((g, i) => `${i + 1}. ${g.gist}`).join('\n'), { signal: opts.signal }), 600)
  } catch (e) {
    if (opts.signal?.aborted) throw e
  }
  opts.onProgress?.(groups.length, groups.length)
  const summary: DocSummary = { key, overview, groups: out }
  remember(summary)
  return summary
}

// ── running it in the background ────────────────────────────────────────────

export interface SummaryJob { key: string; state: 'running' | 'done' | 'failed'; done: number; total: number }
export const useSummaryJob = create<{ job: SummaryJob | null; set: (j: SummaryJob | null) => void }>((set) => ({ job: null, set: (job) => set({ job }) }))

let running: { key: string; ac: AbortController } | null = null

/** The map for this document if there is one; otherwise start making it (once) and return undefined for now. */
export function ensureSummary(items: BriefItem[], getLlm: () => Llm): DocSummary | undefined {
  if (totalChars(items) < LONG_CHARS) return undefined
  const key = hashItems(items)
  const hit = cachedSummary(key)
  if (hit) return hit
  if (running?.key === key) return undefined
  running?.ac.abort()
  const ac = new AbortController()
  running = { key, ac }
  const total = Math.min(MAX_GROUPS, groupItems(items).length)
  useSummaryJob.getState().set({ key, state: 'running', done: 0, total })
  void summariseDocument(items, getLlm(), { signal: ac.signal, onProgress: (done, t) => useSummaryJob.getState().set({ key, state: 'running', done, total: t }) })
    .then(() => useSummaryJob.getState().set({ key, state: 'done', done: total, total }))
    .catch(() => { if (!ac.signal.aborted) useSummaryJob.getState().set({ key, state: 'failed', done: 0, total }) })
    .finally(() => { if (running?.ac === ac) running = null })
  return undefined
}

/** Cache lookup only — never starts work. */
export const summaryFor = (items: BriefItem[]): DocSummary | undefined => (totalChars(items) < LONG_CHARS ? undefined : cachedSummary(hashItems(items)))
