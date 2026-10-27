// Cheap relevance: which passages of a long page or document matter for THIS question. BM25 over words — no model, no
// embeddings, no download — so it runs in the browser in a millisecond and gives the same answer every time.

const STOP = new Set(
  'a an and are as at be but by for from has have how i if in into is it its me my of on or so than that the their them then there these they this to was we what when where which who why will with you your do does did can could should would about explain tell show give please'.split(' ')
)

export const words = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9α-ωµ°]+(?:['.][a-z0-9]+)*/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w))

/** A light stem: enough that "resistors" finds "resistor" and "falling" finds "fall". */
const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, (m) => (w.length - m.length >= 3 ? '' : m))

const terms = (text: string) => words(text).map(stem)

/** Score each chunk against the query. Higher is more relevant; 0 means no shared word at all. */
export function bm25(query: string, chunks: string[], k1 = 1.4, b = 0.75): number[] {
  const q = [...new Set(terms(query))]
  if (q.length === 0 || chunks.length === 0) return chunks.map(() => 0)
  const docs = chunks.map(terms)
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  return docs.map((d) => {
    const tf = new Map<string, number>()
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
    let score = 0
    for (const t of q) {
      const f = tf.get(t)
      if (!f) continue
      const n = df.get(t) ?? 0
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)))
    }
    return score
  })
}

/** Sentences, keeping the punctuation, so a passage can be cut on a boundary instead of mid-word. */
export const sentenceList = (text: string): string[] => text.replace(/\s+/g, ' ').trim().match(/[^.!?]+(?:[.!?]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? []

/** Cut to about `n` characters on a sentence (or at least a word) boundary. */
export function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  let out = ''
  for (const s of sentenceList(t)) {
    if ((out + ' ' + s).length > n) break
    out = out ? `${out} ${s}` : s
  }
  if (out.length >= n * 0.5) return `${out} …`
  return `${t.slice(0, n).replace(/\s+\S*$/, '')} …`
}

/** Split long text into passages of about `size` characters on sentence boundaries. */
export function passages(text: string, size = 600): string[] {
  const out: string[] = []
  let cur = ''
  for (const s of sentenceList(text)) {
    if (cur && (cur + ' ' + s).length > size) { out.push(cur); cur = s } else cur = cur ? `${cur} ${s}` : s
  }
  if (cur) out.push(cur)
  return out
}
