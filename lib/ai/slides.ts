'use client'

// Turns an AI answer (the same Markdown explain.ts produces) into a slide
// deck: one array of SceneObjects per slide, the exact shape
// pptx-export.ts's exportPptx() and AddPageDialog's createPptx() already
// consume — an AI-authored deck is not a new document kind, it is a
// pptx-kind page seeded through the SAME path a hand-picked template uses
// (see slideTitle/slideHeading/slideBody in lib/scene/page-templates.ts),
// so it renders, edits and exports identically to one you built by hand.
//
// SPLITTING RULE: a Markdown heading (#/##) starts a new slide — this is
// exactly the structure EXPLAIN_SYSTEM_PROMPT already asks the model to
// produce for a derivation/note ("Given:" / "To Find:" / "Derivation:" as
// headings), so no new prompt behaviour is required, only a new consumer of
// the same answer.blocks the notebook path already gets.
//
// A body that would overflow the fixed 540px-tall slide is split across
// CONTINUED slides rather than shrunk to fit — shrinking silently produces
// unreadable slides; splitting keeps every line at a size a room can read.

import type { SceneObject } from '@/lib/scene/types'
import { slideBody, slideHeading, slideTitle } from '@/lib/scene/page-templates'
import type { AnswerBlock } from './explain'

/** Inline display maths as $...$ text — a Formula object has no pptx
 *  equivalent (see exportPptx's own doc comment) and would silently vanish
 *  from an exported file; plain text with the notebook's own $...$ syntax
 *  survives export as a readable line even though it won't render as KaTeX
 *  inside PowerPoint itself. In-app Present mode uses the same text
 *  renderer as the notebook, so it DOES render there. */
function inlineFormula(latex: string): string {
  return `$${latex}$`
}

/** ~85 characters/line at the slide body's width, ~24px/line — how many
 *  lines fit before the box (440px tall, see slideBody) starts clipping. */
const CHARS_PER_LINE = 85
const LINES_PER_SLIDE = 16

interface Section {
  heading: string
  lines: string[]
}

/** Split raw answer Markdown into heading-led sections. Text before the
 *  first heading becomes a section with no heading (folded into slide 1's
 *  body under a generic title) rather than dropped. */
function splitSections(markdown: string): Section[] {
  const sections: Section[] = [{ heading: '', lines: [] }]
  for (const raw of markdown.split('\n')) {
    const h = /^(#{1,2})\s+(.*)$/.exec(raw)
    if (h) {
      sections.push({ heading: h[2].trim(), lines: [] })
    } else {
      sections[sections.length - 1].lines.push(raw)
    }
  }
  return sections.filter((s) => s.heading || s.lines.some((l) => l.trim()))
}

/** How many wrapped lines a block of body text will actually take. */
function wrappedLineCount(lines: string[]): number {
  return lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / CHARS_PER_LINE)), 0)
}

/**
 * Convert an explain-lane answer into slide content — one SceneObject[] per
 * slide, ready for addDocSheet()+addObject() (see AddPageDialog.createPptx,
 * the exact pattern this mirrors) or an existing pptx page's next sheet.
 *
 * `title` becomes slide 1's headline (the question itself, trimmed) so a
 * deck opens on what it's answering, not mid-derivation.
 */
export function answerToSlides(markdown: string, title: string): SceneObject[][] {
  const clean = markdown
    // Formula blocks a caller already split out (toAnswerBlocks) arrive
    // back as inline $...$ so a heading-only line isn't lost between them.
    .trim()
  const sections = splitSections(clean)
  const slides: SceneObject[][] = [[slideTitle(title.length > 90 ? title.slice(0, 87) + '…' : title)]]

  for (const section of sections) {
    // Section carries no useful heading (the answer opened with prose, not
    // a "Given:"-style header) — fold it under the title slide as a body.
    const bodyLines = section.lines.filter((l) => l.trim() !== '')
    if (!section.heading && bodyLines.length === 0) continue
    const heading = section.heading || 'Notes'

    // Long section: split across CONTINUED slides rather than shrink text
    // or let it run off the fixed-height slide box.
    let start = 0
    let part = 0
    do {
      let end = start
      let lines = 0
      while (end < bodyLines.length && lines + wrappedLineCount([bodyLines[end]]) <= LINES_PER_SLIDE) {
        lines += wrappedLineCount([bodyLines[end]])
        end++
      }
      // A single line alone already exceeds the budget — take it anyway
      // rather than looping forever on an empty slide.
      if (end === start) end = Math.min(start + 1, bodyLines.length)
      const chunk = bodyLines.slice(start, end).join('\n')
      const label = part === 0 ? heading : `${heading} (continued)`
      slides.push([slideHeading(label), slideBody(chunk)])
      start = end
      part++
    } while (start < bodyLines.length)

    if (bodyLines.length === 0) slides.push([slideHeading(heading)])
  }

  return slides
}

/** Same conversion, but starting from the pre-split blocks explain.ts
 *  already produced (toAnswerBlocks) — used when a Formula block exists,
 *  so its LaTeX round-trips through inlineFormula() instead of being
 *  re-matched from the display-math regex a second time. */
export function blocksToSlides(blocks: AnswerBlock[], title: string): SceneObject[][] {
  const markdown = blocks
    .map((b) => (b.kind === 'formula' ? inlineFormula(b.content) : b.content))
    .join('\n\n')
  return answerToSlides(markdown, title)
}
