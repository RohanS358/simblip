// A page, told to the model the way a person would tell it — not a dump of objects.
//
// What used to be sent was a line per object ("mvj6i7by647z7r slider "vxs" at (230,257) 240x80 …"): ids, coordinates, sizes.
// A model has to work out from that what the page is ABOUT, what the slider does, what the graph plots. This builds that
// understanding first — a short account of what the page is, what is on it grouped by role (explanation, formulas,
// simulation, controls, graphs…), how the parts relate (this slider drives that variable, this graph plots that body) and
// what the student has selected — and spends a fixed character budget on what matters for the QUESTION being asked.
//
// Long material (a PDF, a document, a deck) cannot all be sent. It is split into passages, ranked against the question
// (BM25, lexical.ts), and the best are sent whole with an outline of the rest — so the model sees where everything is and
// reads in full only what it needs. Pure and synchronous: no model call, no network, same input → same text.

import type { PageDoc, SceneObject } from '@/lib/scene/types'
import { readSheet } from '@/lib/lesson/page-read'
import { bm25, clip, passages, sentenceList } from './lexical'
import type { DocSummary } from './summary'

export interface BriefItem {
  kind: 'text' | 'formula' | 'table' | 'graph' | 'figure' | 'lab'
  text: string
  /** "p. 12", "slide 3" — where it came from, so an answer can point back. */
  locator?: string
  live?: boolean
  ids?: string[]
}

export interface BriefInput {
  title: string
  kind: string
  doc?: PageDoc
  /** Already-read content (a document, slides, PDF). Used instead of reading `doc`'s objects. */
  items?: BriefItem[]
  selection?: string[]
  question?: string
  /** Characters the whole brief may take. */
  budget?: number
  /** A model-written map of a very long document (lib/ai/brief/summary.ts), when one has been made. */
  summary?: DocSummary
}

export interface Brief {
  text: string
  /** id → what a person calls it. Used to turn ids in the model's reply back into words. */
  names: Record<string, string>
  stats: { items: number; shown: number; summarised: number; chars: number }
}

export const DEFAULT_BUDGET = 6_000

const KIND_WORDS: Record<string, string> = {
  board: 'an open board (free canvas)',
  doc: 'a document',
  pptx: 'a slide deck',
  pdf: 'a PDF',
  xlsx: 'a spreadsheet',
  image: 'an image',
  web: 'a web page',
  course: 'a course lesson',
}

const BEHAVIOUR_WORDS: Record<string, string> = {
  rigidBody: 'moves under physics',
  staticBody: 'fixed in place',
  spring: 'a spring',
  rope: 'a rope',
  rod: 'a rigid rod',
  damper: 'a damper',
}

const cleanText = (t: string) => t.replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim()

const num = (o: SceneObject, name: string): number | null => {
  const p = o.parameters[name]
  return p && p.kind === 'number' ? p.value : null
}
const str = (o: SceneObject, name: string): string => {
  const p = o.parameters[name]
  if (!p) return ''
  return p.kind === 'string' ? p.value : p.kind === 'number' ? (p.expr || String(p.value)) : String(p.value)
}

const kindOf = (o: SceneObject) => (o.geometry.kind === 'symbol' && o.geometry.symbol ? o.geometry.symbol : o.geometry.kind)

/** What to call an object: its name when it has a real one, otherwise its kind. */
export function labelOf(o: SceneObject): string {
  const k = kindOf(o)
  const n = o.name?.trim()
  return n && n.toLowerCase() !== k ? n : k
}

export function namesOf(doc: PageDoc | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of Object.values(doc?.objects ?? {})) out[o.id] = labelOf(o)
  return out
}

const VALUE_PARAMS = ['resistance', 'capacitance', 'inductance', 'voltage', 'current', 'frequency', 'gain', 'mass', 'value']

/** One part in words: "ball (circle “Ball”, moves under physics)". */
function partPhrase(o: SceneObject): string {
  const k = kindOf(o)
  const bits: string[] = []
  const label = labelOf(o)
  const roles = o.behaviors.filter((b) => b.enabled).map((b) => BEHAVIOUR_WORDS[b.type] ?? b.type)
  if (o.geometry.kind === 'symbol') {
    const vals = VALUE_PARAMS.map((n) => [n, num(o, n)] as const).filter(([, v]) => v !== null).slice(0, 2).map(([n, v]) => `${n} ${v}`)
    if (vals.length) bits.push(vals.join(', '))
  }
  const mass = o.behaviors.find((b) => b.type === 'rigidBody' && b.params.mass?.kind === 'number')?.params.mass
  if (mass && mass.kind === 'number') bits.push(`mass ${mass.value}`)
  if (roles.length) bits.push(roles.join(', '))
  const head = `${label === k ? k : `${k} “${label}”`} [${o.id}]`
  return bits.length ? `${head} (${bits.join('; ')})` : head
}

interface Entry {
  key: string
  /** The full account. */
  full: string
  /** A single line, used when there is no room for `full`. */
  short: string
  order: number
  score: number
  must?: boolean
  /** Section it is printed under. */
  section: string
}

const SECTIONS = ['Explanation', 'Formulas', 'Simulation', 'Controls', 'Graphs and tables', 'Interactive labs', 'Other'] as const

/** The sliders and buttons (readSheet skips them), described by what they drive. */
function controlsOf(doc: PageDoc, names: Record<string, string>): { text: string; ids: string[] }[] {
  const out: { text: string; ids: string[] }[] = []
  for (const o of Object.values(doc.objects)) {
    if (o.geometry.kind === 'slider') {
      const label = str(o, 'label') || o.name || 'slider'
      const min = str(o, 'min'), max = str(o, 'max'), value = str(o, 'value')
      const param = str(o, 'targetParamName')
      const targetId = str(o, 'targetObjectId')
      const target = targetId && names[targetId] ? `${param || 'a value'} of “${names[targetId]}”` : param ? `the variable ${param}` : 'something on the page'
      out.push({ text: `slider “${label}” [${o.id}] from ${min || '?'} to ${max || '?'}, now ${value || '?'}, sets ${target}`, ids: [o.id] })
    } else if (o.geometry.kind === 'button') {
      out.push({ text: `button “${str(o, 'label') || o.name || 'button'}” [${o.id}]`, ids: [o.id] })
    }
  }
  return out
}

/** A graph or table in words: what it plots and where its data comes from. */
function plotPhrase(o: SceneObject, names: Record<string, string>): string {
  const k = o.geometry.kind
  const label = labelOf(o)
  if (k === 'graph') {
    const src = str(o, 'sourceId')
    const ch = str(o, 'yChannels')
    const from = src && names[src] ? ` of “${names[src]}”` : ''
    return `graph${label !== 'graph' ? ` “${label}”` : ''} plotting ${ch || 'a measured quantity'}${from} over time`
  }
  if (k === 'chart') return `${str(o, 'chartType') || 'chart'}${label !== 'chart' ? ` “${label}”` : ''}`
  const headers = str(o, 'headers')
  return `table${label !== 'table' ? ` “${label}”` : ''}${headers ? ` with columns ${headers}` : ''}`
}

const SECTION_OF: Record<BriefItem['kind'], (typeof SECTIONS)[number]> = {
  text: 'Explanation',
  formula: 'Formulas',
  figure: 'Simulation',
  graph: 'Graphs and tables',
  table: 'Graphs and tables',
  lab: 'Interactive labs',
}

/** What the page is about, from its own words: a bold lead-in ("**Projectile motion.**"), else the first heading-like line. */
const GENERIC = /^(?:untitled|new page|page\s*\d*|this page|welcome|key points?|summary|note|notes|given|what we are given)$/i

function topicOf(items: BriefItem[], title: string, raw: string[] = []): string {
  // The page's own name is the best statement of what it is about ("Lesson: Net Present Value Calculation").
  const named = title.replace(/^lesson:\s*/i, '').trim()
  if (named && !GENERIC.test(named)) return named
  // Otherwise its own words: a bold lead-in ("**Projectile motion.**"), else the first heading-like line. The raw text still has
  // its marks; the read items have them cleaned away.
  for (const t of [...raw, ...items.filter((i) => i.kind === 'text').map((i) => i.text)]) {
    const bold = /\*\*([^*]{3,60})\*\*/.exec(t)
    if (bold && !GENERIC.test(bold[1].replace(/[.:]+$/, ''))) return bold[1].replace(/[.:]+$/, '')
  }
  const lead = items.find((i) => i.kind === 'text' && i.text.length < 90 && !/[.!?]$/.test(i.text) && !GENERIC.test(cleanText(i.text)))
  return lead ? cleanText(lead.text) : title
}

const LIVE = (live?: boolean) => (live ? ' It is live: pressing play runs it.' : '')

function entriesFromBoard(doc: PageDoc, names: Record<string, string>, selection: Set<string>): { entries: Entry[]; items: BriefItem[] } {
  const items = readSheet('page', doc)
  const entries: Entry[] = []
  items.forEach((it, i) => {
    const ids = it.ids
    const sel = ids.some((id) => selection.has(id))
    const objs = ids.map((id) => doc.objects[id]).filter(Boolean)
    let full = ''
    let short = ''
    if (it.kind === 'text') {
      const t = cleanText(it.text)
      full = t
      short = clip(t, 110)
    } else if (it.kind === 'formula') {
      full = `${it.text}`
      short = clip(it.text, 90)
    } else if (it.kind === 'figure') {
      const parts = objs.map(partPhrase)
      const kinds = new Set(objs.map(kindOf))
      const circuit = [...kinds].some((k) => /resistor|capacitor|inductor|battery|diode|transistor|op-amp|source|ground|gate/.test(String(k)))
      full = `${circuit ? 'circuit' : 'scene'} made of ${parts.join('; ')}.${LIVE(it.live)}`
      short = `${circuit ? 'circuit' : 'scene'} of ${objs.length} parts (${[...new Set(objs.map(labelOf))].slice(0, 4).join(', ')})${it.live ? ', live' : ''}`
    } else if (it.kind === 'graph' || it.kind === 'table') {
      full = objs.map((o) => plotPhrase(o, names)).join('; ')
      short = full
    } else {
      full = `${objs.map((o) => `${o.geometry.kind} “${labelOf(o)}”: ${clip(str(o, 'engine') || str(o, 'algo') || str(o, 'source'), 160)}`).join('; ')}`
      short = clip(full, 100)
    }
    if (!full) return
    if (it.kind !== 'figure') { const tag = ` [${ids.join(', ')}]`; full += tag; short += tag }
    entries.push({ key: `i${i}`, full, short, order: i, score: 0, must: sel, section: SECTION_OF[it.kind] })
  })
  // Single objects readSheet does not call a figure (a cash-flow diagram, a 3-D surface, a picture, a code cell) still matter.
  const covered = new Set(items.flatMap((i) => i.ids))
  const LONE = new Set(['cashflow', 'surface3d', 'picture', 'code'])
  for (const o of Object.values(doc.objects)) {
    if (covered.has(o.id) || !LONE.has(o.geometry.kind)) continue
    const what = o.geometry.kind === 'cashflow' ? `cash-flow diagram${str(o, 'spec') ? `: ${clip(str(o, 'spec'), 260)}` : ''}` : o.geometry.kind === 'surface3d' ? `3-D surface ${clip(str(o, 'equation'), 120)}` : o.geometry.kind === 'code' ? `code cell: ${clip(str(o, 'source'), 200)}` : `picture “${labelOf(o)}”`
    entries.push({ key: `l${o.id}`, full: `${what} [${o.id}]`, short: `${what.split(':')[0]} [${o.id}]`, order: entries.length, score: 0, section: 'Simulation' })
  }
  const base = entries.length
  controlsOf(doc, names).forEach((c, j) => {
    entries.push({ key: `c${j}`, full: c.text, short: c.text, order: base + j, score: 1, must: true, section: 'Controls' })
  })
  return { entries, items: items.map((it) => ({ kind: it.kind, text: it.text, ids: it.ids, live: it.live })) }
}

/** Long material: passages with locators, outline-able. */
function entriesFromItems(items: BriefItem[]): Entry[] {
  const out: Entry[] = []
  let order = 0
  items.forEach((it, i) => {
    const where = it.locator ? `${it.locator}: ` : ''
    const parts = it.kind === 'text' ? passages(cleanText(it.text), 600) : [cleanText(it.text)]
    parts.forEach((p, j) => {
      if (!p) return
      const lead = sentenceList(p)[0] ?? p
      out.push({ key: `p${i}.${j}`, full: `${where}${p}`, short: `${where}${clip(lead, 100)}`, order: order++, score: 0, section: SECTION_OF[it.kind] })
    })
  })
  return out
}

/** Choose what fits. Must-haves first, then by relevance, whole where it fits and one line where it does not. */
function spend(entries: Entry[], budget: number, question: string): { chosen: Map<string, 'full' | 'short'>; hidden: number } {
  const scores = bm25(question, entries.map((e) => e.full))
  entries.forEach((e, i) => { e.score = (e.score || 0) + scores[i] })
  const chosen = new Map<string, 'full' | 'short'>()
  let left = budget
  const take = (e: Entry, how: 'full' | 'short') => {
    const cost = (how === 'full' ? e.full : e.short).length + 4
    if (cost > left && !e.must) return false
    chosen.set(e.key, how)
    left -= cost
    return true
  }
  for (const e of entries.filter((e) => e.must)) take(e, 'full')
  // Relevance order; with no question (or no overlap) fall back to reading order so the page is covered from the top.
  const anyScore = entries.some((e) => e.score > 0)
  const ranked = [...entries].filter((e) => !e.must).sort((a, b) => (anyScore ? b.score - a.score : a.order - b.order) || a.order - b.order)
  // Most of the room goes to whole passages of the best matches; the rest of the page is kept as one-liners so it is still findable.
  const wholeBudget = left * 0.75
  let spent = 0
  for (const e of ranked) {
    if (chosen.has(e.key)) continue
    const len = e.full.length + 4
    if (spent + len <= wholeBudget && (!anyScore || e.score > 0 || entries.length <= 12)) { if (take(e, 'full')) spent += len }
  }
  for (const e of ranked) {
    if (chosen.has(e.key) || !e.short) continue
    if (!take(e, 'short')) break
  }
  return { chosen, hidden: entries.filter((e) => !chosen.has(e.key)).length }
}

export function briefPage(input: BriefInput): Brief {
  const budget = input.budget ?? DEFAULT_BUDGET
  const selection = new Set(input.selection ?? [])
  const doc = input.doc
  const names = namesOf(doc)
  const question = input.question ?? ''

  let entries: Entry[]
  let items: BriefItem[]
  if (input.items) {
    items = input.items
    entries = entriesFromItems(items)
  } else if (doc) {
    const r = entriesFromBoard(doc, names, selection)
    entries = r.entries
    items = r.items
  } else {
    return { text: '', names, stats: { items: 0, shown: 0, summarised: 0, chars: 0 } }
  }

  const head: string[] = []
  head.push(`Page: “${input.title}” — ${KIND_WORDS[input.kind] ?? input.kind}.`)
  const raw = Object.values(doc?.objects ?? {}).filter((o) => o.geometry.kind === 'note' || o.geometry.kind === 'text').map((o) => str(o, 'text'))
  const topic = topicOf(items, input.title, raw)
  if (topic && topic !== input.title) head.push(`About: ${topic}.`)
  if (doc && doc.variables.length) head.push(`Variables the simulation uses: ${doc.variables.map((v) => `${v.name} = ${v.expr}`).join(', ')}.`)
  if (selection.size && doc) {
    const sel = [...selection].map((id) => doc.objects[id]).filter(Boolean).map(partPhrase)
    if (sel.length) head.push(`The student has selected: ${sel.join('; ')}. A request about “it” or “this” means this.`)
  }

  // A long document's map stands in for the one-line outline: it says what each stretch is about, not just how it opens.
  const map: string[] = []
  const sum = input.items ? input.summary : undefined
  if (sum) {
    if (sum.overview) head.push(`Overview: ${sum.overview}`)
    const room = Math.min(1_800, Math.floor(budget * 0.25))
    let used = 0
    const step = Math.max(1, Math.ceil((sum.groups.reduce((n, g) => n + g.gist.length + 14, 0)) / room))
    sum.groups.forEach((g, i) => {
      if (i % step !== 0 || used > room) return
      const a = items[g.from]?.locator, b = items[g.to]?.locator
      const where = a && b && a !== b ? `${a}–${b}` : (a ?? `part ${i + 1}`)
      const line = `- ${where}: ${g.gist}`
      used += line.length + 1
      map.push(line)
    })
    for (const e of entries) e.short = ''
  }

  const headText = head.join('\n')
  const mapText = map.length ? `Section map:\n${map.join('\n')}` : ''
  const { chosen, hidden } = spend(entries, Math.max(400, budget - headText.length - mapText.length - 200), question)

  const bySection = new Map<string, Entry[]>()
  for (const e of entries.filter((e) => chosen.has(e.key)).sort((a, b) => a.order - b.order)) {
    const list = bySection.get(e.section) ?? []
    list.push(e)
    bySection.set(e.section, list)
  }
  const body: string[] = mapText ? [mapText] : []
  for (const sec of SECTIONS) {
    const list = bySection.get(sec)
    if (!list?.length) continue
    body.push(`${sec}:`)
    for (const e of list) body.push(`- ${chosen.get(e.key) === 'full' ? e.full : e.short}`)
  }
  if (hidden > 0) body.push(`(${hidden} more passage${hidden === 1 ? '' : 's'} not shown — ask about a specific part to see it.)`)

  const text = [headText, ...body].join('\n')
  return { text, names, stats: { items: entries.length, shown: chosen.size, summarised: [...chosen.values()].filter((v) => v === 'short').length, chars: text.length } }
}
