// BM25 over lesson sections — retrieval with no embedding model (0 MB RAM).
export interface Doc { id: string; title: string; text: string; lessonId?: string; sectionId?: string }

const tok = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, ' ').match(/[a-z0-9]+/g) ?? []

export function bm25(docs: Doc[], query: string, k = 5): { doc: Doc; score: number }[] {
  const q = [...new Set(tok(query))]
  if (!q.length || !docs.length) return []
  const bags = docs.map((d) => tok(d.title + ' ' + d.title + ' ' + d.text)) // title counts double
  const avg = bags.reduce((a, b) => a + b.length, 0) / docs.length || 1
  const df = new Map<string, number>()
  for (const b of bags) for (const t of new Set(b)) df.set(t, (df.get(t) ?? 0) + 1)
  return docs
    .map((doc, i) => {
      const b = bags[i]
      let score = 0
      for (const t of q) {
        const f = b.filter((x) => x === t).length
        if (!f) continue
        const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5))
        score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * b.length) / avg))
      }
      return { doc, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}
