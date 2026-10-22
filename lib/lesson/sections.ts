// A lesson's board is a sequence of SECTIONS, one per idea, laid out top to bottom
// like the pages of a notebook. Nothing is ever cleared: the camera moves to the
// new section and the older ones stay where they were, so the student can read
// back through them at any time. Pure geometry — no store, no DOM.

export interface Section {
  id: string
  title: string
  /** Every canvas object that belongs to this section (scene, heading, equations). */
  ids: string[]
  /** Storyboard beat that opened it. */
  beat: number
  /** The "Key points" block beside it, and what it says so far. */
  notes?: string
  bullets?: string[]
  /** Formulas taught in this section, with what each says in words. */
  formulas?: { latex: string; text?: string }[]
  /** Words introduced here ("current — the flow of charge …"). */
  definitions?: { term: string; meaning: string }[]
  /** Predictions asked here, with the answer. */
  checks?: { q: string; a: string }[]
  /** The closing summary section (never itself summarised). */
  summary?: boolean
  /** Drawn in answer to a student's question, between the sections of the lesson proper. */
  aside?: boolean
  /** The one formula card holding every formula taught here, one per line. */
  formulaBox?: string
  /** How the section is laid out: title, then content beside a diagram ('split'), or title and a full-width diagram ('full'). */
  layout?: 'split' | 'full'
}

export interface Box { x: number; y: number; w: number; h: number }
type Placed = { position: { x: number; y: number }; size: { w: number; h: number } }

/** Space left between one section and the next. */
export const SECTION_GAP = 140

export function boxOf(objs: Placed[]): Box | null {
  if (!objs.length) return null
  const x1 = Math.min(...objs.map((o) => o.position.x)), y1 = Math.min(...objs.map((o) => o.position.y))
  const x2 = Math.max(...objs.map((o) => o.position.x + o.size.w)), y2 = Math.max(...objs.map((o) => o.position.y + o.size.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** Where the next section starts: below everything already on the page, left-aligned with it. */
export function nextOrigin(objs: Placed[], fallback: { x: number; y: number }): { x: number; y: number } {
  const b = boxOf(objs)
  return b ? { x: b.x, y: b.y + b.h + SECTION_GAP } : fallback
}

/** The section a beat belongs to: the latest one opened at or before it. */
export function sectionAt(sections: Section[], beat: number): Section | null {
  let found: Section | null = null
  for (const s of sections) if (s.beat <= beat) found = s
  return found
}

/** Title for a section opened at `beat`: the chapter card before it, else "Part N". */
export function sectionTitle(beats: { t: string; text?: string }[], beat: number, n: number): string {
  for (let i = Math.min(beat, beats.length - 1); i >= 0; i--) if (beats[i].t === 'title' && beats[i].text) return beats[i].text as string
  return `Part ${n}`
}

// ── study notes ─────────────────────────────────────────────────────────────
// Each section carries a "Key points" block on the board, written as the teacher speaks: one bullet
// per thing she says, so when the lesson ends the board reads like a set of slides a student can
// revise from. Pure text — the stage writes it into a text object.

/** The study-note form of a spoken line: its first sentence, kept short. null = not worth a bullet. */
export function bulletFor(spoken: string): string | null {
  const first = spoken.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)[0] ?? ''
  if (first.length < 24) return null
  if (/^(let'?s|now|so|okay|ok|watch|look|press|try|here)\b/i.test(first) && first.length < 48) return null
  if (first.length <= 150) return first
  // too long to be a bullet: cut at the last natural pause, else at a word
  const head = first.slice(0, 148)
  const pause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(' — '))
  return (pause > 60 ? head.slice(0, pause) : head.slice(0, head.lastIndexOf(' '))) + '…'
}

/** The block's markdown: key points, then the words introduced in the section. */
export function notesMarkdown(bullets: string[], definitions: { term: string; meaning: string }[] = []): string {
  const words = definitions.length ? `\n\n**Words to know**\n\n${definitions.map((d) => `- **${d.term}** — ${d.meaning}`).join('\n')}` : ''
  return `**Key points**\n\n${bullets.map((b) => `- ${b}`).join('\n')}${words}`
}

/** A definition hiding in a spoken sentence — "…is called the resistance", "Current is the flow of…" — or null.
 *  Deliberately conservative: a wrong glossary entry teaches the wrong thing. */
export function definitionFrom(sentence: string): { term: string; meaning: string } | null {
  const s = sentence.replace(/\s+/g, ' ').trim()
  if (s.length < 30 || s.length > 220) return null
  const clean = (t: string) => t.replace(/^(the|a|an)\s+/i, '').trim()
  const named = /\b(?:is|are|we)?\s*(?:called|known as|named|call it)\s+(?:the\s+)?([A-Za-z][A-Za-z -]{1,28}?)(?=[.,;:)]|$)/i.exec(s)
  if (named && !/\b(it|this|that|they|these)\b/i.test(named[1])) return { term: clean(named[1]), meaning: s }
  const is = /^(?:The |A |An )?([A-Z][a-z]+(?: [a-z]+){0,2}) (?:is|are) (?:the|a|an) (.{14,})$/.exec(s)
  if (is && !/^(This|That|These|Those|There|Here|What|Which|It|Everything|Something|Nothing|Anything|Each|Every|Both|Most|Some|Many|Another|Other|One|Two|All)\b/i.test(is[1]) && !/\b(that|which|who|follows)\b/i.test(is[1]) && is[1].split(' ').length <= 2) return { term: is[1].toLowerCase(), meaning: s }
  return null
}

export interface Summary {
  title: string
  parts: { n: number; title: string; points: string[]; checks: { q: string; a: string }[] }[]
  formulas: { latex: string; text?: string; section: string }[]
  glossary: { term: string; meaning: string }[]
}

/** A section's key points as study notes: the "Check:" lines live under *Check yourself* instead. */
export const keyPoints = (s: { bullets?: string[] }): string[] => (s.bullets ?? []).filter((b) => !b.startsWith('Check: '))

/** Everything the lesson taught, gathered from its sections: the print view shows it all, the board's
 *  closing summary the first few points of each. */
export function buildSummary(title: string, sections: Section[]): Summary {
  const seen = new Set<string>()
  const glossary: Summary['glossary'] = []
  sections = sections.filter((s) => !s.summary)
  for (const s of sections) for (const d of s.definitions ?? []) if (!seen.has(d.term.toLowerCase())) { seen.add(d.term.toLowerCase()); glossary.push(d) }
  return {
    title,
    parts: sections
      .filter((s) => keyPoints(s).length + (s.checks?.length ?? 0) > 0)
      .map((s, i) => ({ n: i + 1, title: s.title, points: keyPoints(s), checks: s.checks ?? [] })),
    formulas: sections.flatMap((s) => (s.formulas ?? []).map((f) => ({ ...f, section: s.title }))),
    glossary: glossary.sort((a, b) => a.term.localeCompare(b.term)),
  }
}

/** The closing summary's text block on the board: each section's first few points. */
export function summaryMarkdown(sum: Summary, perSection = 3): string {
  return sum.parts.map((p) => `**${p.n}. ${p.title}**\n\n${p.points.slice(0, perSection).map((b) => `- ${b}`).join('\n')}`).join('\n\n')
}
export const glossaryMarkdown = (sum: Summary): string => (sum.glossary.length ? `**Words to remember**\n\n${sum.glossary.map((d) => `- **${d.term}** — ${d.meaning}`).join('\n')}` : '')

/** Height of the notes block for `width` px of text (about 52 characters a line at that width). */
export function notesHeight(bullets: string[], width = 400, definitions: { term: string; meaning: string }[] = []): number {
  const perLine = Math.max(24, Math.floor(width / 7.6))
  const all = [...bullets, ...definitions.map((d) => `${d.term} — ${d.meaning}`)]
  const lines = all.reduce((n, b) => n + Math.ceil((b.length + 2) / perLine), 0)
  return Math.round(64 + lines * 25 + all.length * 9 + (definitions.length ? 56 : 0))
}

/** The full study notes as Markdown — everything in the print view, for copying into another app. */
export function studyMarkdown(title: string, sections: Section[]): string {
  const sum = buildSummary(title, sections)
  const body = sections.filter((s) => !s.summary && (keyPoints(s).length + (s.checks?.length ?? 0) > 0)).map((s, i) => {
    const out = [`## ${i + 1}. ${s.title}`, ...keyPoints(s).map((b) => `- ${b}`)]
    if (s.definitions?.length) out.push('', '**Words to know**', ...s.definitions.map((d) => `- **${d.term}** — ${d.meaning}`))
    if (s.formulas?.length) out.push('', '**Formulas**', ...s.formulas.map((f) => `- $${f.latex}$${f.text ? ` — ${f.text}` : ''}`))
    if (s.checks?.length) out.push('', '**Check yourself**', ...s.checks.map((c) => `- ${c.q}\n  - Answer: ${c.a}`))
    return out.join('\n')
  })
  const tail = [
    sum.formulas.length ? `## Formula sheet\n\n${sum.formulas.map((f) => `- $${f.latex}$${f.text ? ` — ${f.text}` : ''}`).join('\n')}` : '',
    sum.glossary.length ? `## Glossary\n\n${sum.glossary.map((d) => `- **${d.term}** — ${d.meaning}`).join('\n')}` : '',
  ].filter(Boolean)
  return [`# ${title}`, ...body, ...tail].join('\n\n')
}


// ── how a section is laid out ───────────────────────────────────────────────
// Every section is written on the board in one of two arrangements:
//
//   split   the TITLE across the top; below it the CONTENT (key points, words) on the left and the
//           DIAGRAM on the right
//   full    the TITLE across the top; below it the DIAGRAM, centred, across the whole width
//
// A section with something to read — or a formula to write — gets `split`; one that is only a picture gets `full`.

export type Layout = 'split' | 'full'
/** Width of the slide the layouts are drawn on. */
export const SLIDE_W = 1000
/** Width of the content column in a split layout, and the gap before the diagram. */
export const CONTENT_W = 400
export const COLUMN_GAP = 40
/** Space the title takes before the body starts. */
export const TITLE_H = 64

/** Which layout a section gets: split when the beats that follow its scene (until the next scene
 *  opens a section) have anything to read — narration, a pointed-at part, a formula explained, an animated sweep. */
export function layoutOf(beats: { t: string; text?: string; clear?: boolean }[], sceneBeat: number): Layout {
  for (let i = sceneBeat + 1; i < beats.length; i++) {
    const b = beats[i]
    // A chapter card does not end the section: a chapter that only talks (and writes formulas) over the
    // picture already on the board belongs to that picture's section. Only a new scene starts another.
    if (b.t === 'scene' && b.clear !== false) break
    if (b.t === 'say' || b.t === 'equation' || (b.t !== 'run' && b.t !== 'scene' && b.t !== 'title' && !!b.text)) return 'split'
  }
  return 'full'
}

/** Top-left for a diagram `w` px wide in a section whose title sits at `at`. */
export function diagramOrigin(layout: Layout, at: { x: number; y: number }, w: number): { x: number; y: number } {
  const y = at.y + TITLE_H
  return layout === 'split' ? { x: at.x + CONTENT_W + COLUMN_GAP, y } : { x: at.x + Math.max(0, (SLIDE_W - w) / 2), y }
}
/** Top-left of the content column. */
export const contentOrigin = (at: { x: number; y: number }) => ({ x: at.x, y: at.y + TITLE_H })
