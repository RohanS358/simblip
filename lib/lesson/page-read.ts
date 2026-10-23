// Read a page the way a teacher would before teaching from it: every piece of content, in reading order, with what it
// says. Boards give notes, formulas, tables, graphs and the clusters of parts that form a figure; documents add their
// flowing text. Pure — the caller supplies the documents.

import { buildDigest } from '@/lib/ai/page-context'
import { parseDoc, type PmNode } from '@/lib/text/pm'
import type { PageDoc, SceneObject } from '@/lib/scene/types'
import { plain } from './from-course'

export type ItemKind = 'text' | 'formula' | 'table' | 'graph' | 'figure' | 'lab'
export interface PageItem {
  kind: ItemKind
  /** Objects to bring into view while this is explained. Empty for flowing document text. */
  ids: string[]
  /** The sheet/slide the objects are on. */
  pageId: string
  /** What the item says (text), or the digest lines that describe it (a figure). */
  text: string
  /** A figure that contains a running simulation. */
  live?: boolean
}
export interface PageReading { title: string; kind: string; items: PageItem[] }

const str = (o: SceneObject, name: string): string => {
  const p = o.parameters[name]
  return p && p.kind === 'string' ? p.value : ''
}
const clean = (t: string) => plain(t.replace(/^#{1,6}\s*/gm, '').replace(/[*_`]/g, '')).replace(/\s+/g, ' ').trim()

const TEXTY = new Set(['note', 'text'])
const SKIP = new Set(['stroke', 'picture', 'image', 'button', 'slider', 'toggle'])

/** Reading order: bands of 120 px top to bottom, left to right inside a band. */
const inReadingOrder = <T extends { y: number; x: number }>(items: T[]): T[] => [...items].sort((a, b) => Math.floor(a.y / 120) - Math.floor(b.y / 120) || a.x - b.x)

/** Group parts that sit near each other into one figure (a circuit is one thing, not twelve). */
function clusters(objs: SceneObject[], gap = 70): SceneObject[][] {
  const parent = objs.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const near = (a: SceneObject, b: SceneObject) =>
    a.position.x - gap < b.position.x + b.size.w && b.position.x - gap < a.position.x + a.size.w && a.position.y - gap < b.position.y + b.size.h && b.position.y - gap < a.position.y + a.size.h
  for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) if (near(objs[i], objs[j])) parent[find(i)] = find(j)
  const groups = new Map<number, SceneObject[]>()
  objs.forEach((o, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), o]))
  return [...groups.values()]
}

/** Flowing document text, block by block (headings keep their words, lists become lines). */
export function flowBlocks(flow: string | undefined): string[] {
  if (!flow) return []
  let doc
  try { doc = parseDoc(flow) } catch { return [] }
  const textOf = (n: PmNode): string => (n.type === 'text' ? n.text ?? '' : (n.content ?? []).map(textOf).join(n.type === 'paragraph' || n.type === 'heading' ? '' : ' '))
  const out: string[] = []
  const walk = (nodes: PmNode[]) => {
    for (const n of nodes) {
      if (['paragraph', 'heading', 'codeBlock'].includes(n.type)) { const t = clean(textOf(n)); if (t) out.push(t) }
      else if (n.content) walk(n.content)
    }
  }
  walk(doc.content)
  return out
}

export function readSheet(pageId: string, doc: PageDoc): PageItem[] {
  const objs = Object.values(doc.objects)
  const items: (PageItem & { x: number; y: number })[] = []
  const rest: SceneObject[] = []
  for (const o of objs) {
    const k = o.geometry.kind
    if (TEXTY.has(k)) {
      const t = clean(str(o, 'text'))
      if (t) items.push({ kind: 'text', ids: [o.id], pageId, text: t, x: o.position.x, y: o.position.y })
    } else if (k === 'formula') {
      const l = str(o, 'latex').trim()
      if (l) items.push({ kind: 'formula', ids: [o.id], pageId, text: l, x: o.position.x, y: o.position.y })
    } else if (k === 'table') items.push({ kind: 'table', ids: [o.id], pageId, text: buildDigest({ objects: { [o.id]: o }, variables: [] }).text, x: o.position.x, y: o.position.y })
    else if (k === 'graph' || k === 'chart') items.push({ kind: 'graph', ids: [o.id], pageId, text: buildDigest({ objects: { [o.id]: o }, variables: [] }).text, x: o.position.x, y: o.position.y })
    else if (k === 'steplab' || k === 'dsa') items.push({ kind: 'lab', ids: [o.id], pageId, text: buildDigest({ objects: { [o.id]: o }, variables: [] }).text, x: o.position.x, y: o.position.y })
    else if (!SKIP.has(k)) rest.push(o)
  }
  for (const group of clusters(rest)) {
    // A lone decorative shape is not a figure; parts that DO something (a behaviour) or several parts together are.
    if (group.length < 2 && !group[0].behaviors.length) continue
    const sub = Object.fromEntries(group.map((o) => [o.id, o]))
    const x = Math.min(...group.map((o) => o.position.x)), y = Math.min(...group.map((o) => o.position.y))
    items.push({ kind: 'figure', ids: group.map((o) => o.id), pageId, text: buildDigest({ objects: sub, variables: doc.variables }).text, live: group.some((o) => o.behaviors.length > 0), x, y })
  }
  return inReadingOrder(items).map(({ x: _x, y: _y, ...it }) => (void _x, void _y, it))
}

export function readPage(input: { title: string; kind: string; sheets: { pageId: string; doc: PageDoc }[]; flow?: string; flowPageId?: string }): PageReading {
  const items: PageItem[] = flowBlocks(input.flow).map((t) => ({ kind: 'text' as const, ids: [], pageId: input.flowPageId ?? input.sheets[0]?.pageId ?? '', text: t }))
  for (const s of input.sheets) items.push(...readSheet(s.pageId, s.doc))
  return { title: input.title, kind: input.kind, items }
}
