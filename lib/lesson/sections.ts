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
