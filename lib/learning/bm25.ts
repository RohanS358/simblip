// BM25 over lesson sections — retrieval with no embedding model (0 MB RAM).
export interface Doc { id: string; title: string; text: string; lessonId?: string; sectionId?: string }

// Apostrophes vanish ("Ohm's" → "ohms") and a trailing plural s is dropped
// ("resistors" → "resistor"), so a student's wording still finds the lesson title.
const stem = (t: string) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t)
const tok = (s: string) => (s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/['’]/g, '').match(/[a-z0-9]+/g) ?? []).map(stem)

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

/** Words that name a KIND of result, not the topic: "Kendall's theorem" is about Kendall, and sharing the
 *  word "theorem" with the central limit theorem is not a match. */
const GENERIC = new Set(['theorem', 'law', 'rule', 'principle', 'method', 'algorithm', 'basic', 'introduction', 'intro', 'concept', 'lesson', 'topic', 'about', 'how', 'what', 'works', 'work', 'the', 'and', 'of', 'in', 'to', 'for', 'with', 'me', 'us', 'explain', 'using', 'a', 'an', 'is', 'are'])

/** Does `text` actually cover what the query is ABOUT? Every distinctive word must appear; a query made only of
 *  generic words falls back to "most of them". Used to refuse a lesson that merely shares a filler word. */
export function covers(query: string, text: string): boolean {
  const have = new Set(tok(text))
  const words = [...new Set(tok(query))]
  const key = words.filter((w) => !GENERIC.has(w))
  if (key.length) return key.every((w) => have.has(w))
  return words.length > 0 && words.filter((w) => have.has(w)).length >= Math.ceil(words.length * 0.6)
}
