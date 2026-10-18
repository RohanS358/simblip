// Course lesson → Storyboard. Deterministic: the authored lesson is the source of
// truth (prose, live figures, derivations, prediction questions), the storyboard
// is just its performance order. No model involved, so it cannot invent content.

import type { CourseDoc, CourseFigure, CourseSection } from '@/lib/store/course'
import { storyboardSchema, type Beat, type Storyboard } from './storyboard'

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

/** Restricted lesson HTML → plain speakable text. Maths in <i>/<sub> reads as plain letters. */
export function plain(html: string): string {
  return html
    .replace(/<\/(p|li|div|h\d)>/gi, '. ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim()
}

/** Split into sentences without breaking on "e.g." / "i.e." / decimals / "R.". */
export function sentences(text: string): string[] {
  return text
    .replace(/\b(e\.g|i\.e|vs|approx|Fig|etc)\./gi, '$1\u0000')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((x) => x.replace(/\u0000/g, '.').trim())
    .filter((x) => x.length > 1)
}

/** A narration beat is spoken aloud: cut a very long sentence at a clause boundary. */
function clip(sentence: string, maxChars = 380): string {
  if (sentence.length <= maxChars) return sentence
  const cut = sentence.slice(0, maxChars)
  const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' — '))
  return (at > 120 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '))) + '.'
}

/** Group sentences into narration beats of ≤ ~38 words so each is a comfortable breath. */
function chunk(text: string, maxSentences: number): string[] {
  const out: string[] = []
  let cur: string[] = []
  const flush = () => { if (cur.length) out.push(cur.join(' ')); cur = [] }
  for (const s of sentences(text).slice(0, maxSentences).map((x) => clip(x))) {
    if (cur.length && cur.join(' ').split(' ').length + s.split(' ').length > 38) flush()
    cur.push(s)
    if (cur.length === 2) flush()
  }
  flush()
  return out
}

const sceneOf = (f: CourseFigure): Beat[] => [
  { t: 'scene', script: f.script, caption: plain(f.caption), clear: true },
  ...(f.note ? chunk(plain(f.note), 1).map((text) => ({ t: 'say', text }) as Beat) : []),
]

export interface FromCourseOptions {
  /** Narrated sentences kept from each section's body (default 3 — it is a film, not the reader). */
  bodySentences?: number
  /** Hard cap on total beats so a long lesson stays a few minutes. */
  maxBeats?: number
}

function sectionBeats(s: CourseSection, o: Required<FromCourseOptions>): Beat[] {
  const beats: Beat[] = [{ t: 'title', text: s.title, sub: s.eyebrow }]
  if (s.body) for (const text of chunk(plain(s.body), o.bodySentences)) beats.push({ t: 'say', text })
  for (const f of s.figures ?? []) if (!f.locked) beats.push(...sceneOf(f))
  for (const st of [...(s.derivation ?? []), ...(s.worked ?? [])]) {
    if (st.math) beats.push({ t: 'equation', latex: st.math, text: clip(chunk(plain(st.why), 2).join(' '), 400) })
    else for (const text of chunk(plain(st.why), 1)) beats.push({ t: 'say', text })
  }
  const qs = s.questions ?? (s.question ? [s.question] : [])
  qs.forEach((q, i) => {
    const correct = q.choices.findIndex((c) => c.correct)
    if (correct < 0 || q.responses.length !== q.choices.length) return
    beats.push({
      t: 'predict',
      id: `${s.id}#${q.id ?? i}`,
      prompt: plain(q.prompt),
      choices: q.choices.map((c) => plain(c.text)),
      correct,
      responses: q.responses.map((r) => plain(`${r.title}. ${r.body}`)),
      demo: q.verify?.script,
    })
  })
  if (s.after) for (const text of chunk(plain(s.after), 2)) beats.push({ t: 'say', text })
  return beats
}

export function storyboardFromCourse(doc: CourseDoc, source: string, opts: FromCourseOptions = {}): Storyboard {
  const o = { bodySentences: opts.bodySentences ?? 3, maxBeats: opts.maxBeats ?? 120 }
  const beats: Beat[] = [{ t: 'title', text: doc.title, sub: doc.kicker ?? doc.subtitle }]
  for (const s of doc.sections) {
    // Problem sets are practice for the reader, not for a film.
    if (/^problems?$/i.test(s.id)) continue
    const sb = sectionBeats(s, o)
    // Never cut a section in the middle of a prediction: stop BEFORE a section that would overflow.
    if (beats.length + sb.length > o.maxBeats) break
    beats.push(...sb)
  }
  return storyboardSchema.parse({ title: doc.title, source, beats })
}
