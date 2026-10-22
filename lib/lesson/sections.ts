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
  return first.length > 150 ? first.slice(0, first.lastIndexOf(' ', 147)) + '…' : first
}

/** The block's markdown: a heading and the bullets. */
export const notesMarkdown = (bullets: string[]): string => `**Key points**\n\n${bullets.map((b) => `- ${b}`).join('\n')}`

/** Height of the notes block for `width` px of text (about 52 characters a line at that width). */
export function notesHeight(bullets: string[], width = 400): number {
  const perLine = Math.max(24, Math.floor(width / 7.6))
  const lines = bullets.reduce((n, b) => n + Math.ceil((b.length + 2) / perLine), 0)
  return Math.round(64 + lines * 25 + bullets.length * 9)
}
