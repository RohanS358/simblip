'use client'

// Turns an AI answer (the same Markdown explain.ts produces) into a slide
// deck: one array of SceneObjects per slide, the exact shape
// pptx-export.ts's exportPptx() and AddPageDialog's createPptx() already
// consume — an AI-authored deck is not a new document kind, it is a
// pptx-kind page seeded through the SAME path a hand-picked template uses
// (slideTitle comes from lib/scene/page-templates.ts; headings and body are
// styled here instead — a generated deck is never hand-tuned afterwards, so
// it needs slide-sized type rather than those templates' document defaults),
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

import { str, type SceneObject } from '@/lib/scene/types'
import { baseObject } from '@/lib/scene/factory'
import { migrateLegacyMarkdown, serialize } from '@/lib/text/marks'
import { slideTitle } from '@/lib/scene/page-templates'
import type { AnswerBlock } from './explain'

/** Body copy on a slide, sized to be read from across a room.
 *
 *  slideBody() (page-templates.ts) is deliberately NOT reused here: it leaves
 *  text at the default ~15px, which is document size. That is correct for the
 *  hand-built templates it serves — the user types into those and picks their
 *  own sizes — but an AI deck is generated whole and never hand-styled, so
 *  15px body on a 960x540 slide came out as an unreadable grey wall.
 *
 *  Markdown syntax is converted rather than passed through: the slide
 *  renderer draws MARKS, not markdown, so a generated deck showed raw "- "
 *  hyphens and literal "**Definition**" asterisks. Lists become bullet
 *  glyphs (nesting preserved as indentation) and inline emphasis becomes
 *  real mark ranges via migrateLegacyMarkdown. */
const BODY_SIZE = 'l' // 20px — see TEXT_SIZES in lib/text/marks.ts

/** Section heading on an AI slide. slideHeading() (page-templates.ts) also
 *  uses 'l' — the same 20px the body now uses — so heading and body differed
 *  only by weight and the slide read as one undifferentiated block. 'xl'
 *  (28px) restores the rank. Not changed in page-templates itself: the
 *  hand-built templates pair 'l' headings with 15px body, where it is
 *  already correctly ranked. */
function aiSlideHeading(text: string): SceneObject {
  const obj = baseObject('text', { x: 60, y: 50 })
  obj.size = { w: 840, h: 60 }
  obj.parameters.text = str(
    serialize({
      text,
      marks: [
        { start: 0, end: text.length, kind: 'bold' },
        { start: 0, end: text.length, kind: 'size', value: 'xl' },
      ],
    })
  )
  return obj
}

/**
 * Drop a self-numbered "Slide 3:" prefix.
 *
 * Asked for slides, the model numbers its own headings. On a real slide that
 * prefix is noise, and it goes stale the moment a long section splits into a
 * "(continued)" slide — the deck then shows "Slide 4:" on two slides running.
 *
 * Measured escapes this must cover (all seen from the real model): a bare
 * "## Slide 5" with no colon, a bolded "## **Slide 2: Setup**", and a "###"
 * sub-heading or a bold body line carrying the same prefix. Leading emphasis
 * is unwrapped first so the number is reachable, and a prefix with no title
 * after it leaves an empty string for the caller to fall back on.
 */
function stripSlideNumber(raw: string): string {
  const inner = /^\s*\*\*(.+?)\*\*\s*$/.exec(raw.trim())
  const text = (inner ? inner[1] : raw).trim()
  return text
    .replace(/^slide\s*\d+\s*(?:[:.–—-]\s*)?/i, '')
    // The model writes its sub-headings as "### Given:" — a trailing colon
    // reads as an unfinished sentence once the line is a slide title.
    .replace(/\s*:\s*$/, '')
    .trim()
}

/**
 * Drop an emphasis marker that has no partner on its line.
 *
 * migrateLegacyMarkdown pairs `**` WITHIN a line, so an orphan survives it as
 * literal text. Both sources are real: generation that hit its token limit
 * mid-emphasis ("- **Stopband:** … \( f_{"), and emphasis that opens on one
 * line and closes on the next. Either printed a bare ** on the slide.
 *
 * Runs BEFORE the conversion, never after — removing characters afterwards
 * would shift every mark offset and mis-bold the rest of the line.
 *
 * ponytail: a line holding BOTH a valid pair and an orphan loses its emphasis
 * entirely rather than the orphan alone, since an odd count cannot say which
 * marker is the stray one. Deliberate: dropped bold is invisible to a reader,
 * a literal ** on a projected slide is not. Pair them positionally only if
 * mixed lines turn out to be common.
 */
function stripOrphanEmphasis(text: string): string {
  return text
    .split('\n')
    .map((line) => ((line.match(/\*\*/g) ?? []).length % 2 === 0 ? line : line.replace(/\*\*/g, '')))
    .join('\n')
}

function bulletify(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Only #/## start a new slide (splitSections), so a deeper heading
      // reached the body verbatim and rendered as literal "### Graphs of...".
      // Keep it as a line, but as emphasis rather than as syntax.
      const sub = /^\s*#{3,6}\s+(.*)$/.exec(line)
      if (sub) {
        const label = stripSlideNumber(sub[1])
        return label ? `**${label}**` : ''
      }
      // A bold line the model used as a pseudo-heading carries the same
      // self-numbering ("**Slide 6: Bold body line**").
      const boldLead = /^\s*\*\*\s*slide\s*\d+\s*[:.–—-]?\s*(.*?)\s*\*\*\s*$/i.exec(line)
      if (boldLead) return boldLead[1] ? `**${boldLead[1]}**` : ''
      const m = /^(\s*)[-*+]\s+(.*)$/.exec(line)
      if (!m) return line
      // Nested items get a lighter glyph so a sub-point reads as subordinate
      // rather than as a sibling of the point above it.
      const glyph = m[1].length >= 2 ? '‣' : '•'
      return `${m[1]}${glyph} ${m[2]}`
    })
    .join('\n')
}

/** Body starts just under the heading (which occupies y 50..110), not at the
 *  template's 140/150 — the extra gap left a visible band of dead space
 *  between title and first bullet while content still ran out the bottom. */
function aiSlideBody(text: string, y = 126): SceneObject {
  // migrateLegacyMarkdown turns **bold**/*italic* into real mark ranges —
  // the same converter the notebook uses for legacy content. Without it the
  // model's "**Definition**: ..." showed the asterisks literally on the
  // slide, since the slide renderer draws marks, not markdown.
  // migrateLegacyMarkdown pairs emphasis markers WITHIN a line, so an
  // orphan survives it as literal text: generation that hit its token limit
  // mid-emphasis ("**Stopband:** ... \( f_{") or emphasis opened on one line
  // and closed on the next both printed a bare ** on the slide. Anything
  // still unpaired after conversion is a leftover marker, not content.
  const { text: body, marks } = migrateLegacyMarkdown(stripOrphanEmphasis(bulletify(text)))
  const obj = baseObject('text', { x: 60, y })
  obj.size = { w: 840, h: 540 - y - 40 }
  obj.parameters.text = str(
    serialize({
      text: body,
      marks: [...marks, { start: 0, end: body.length, kind: 'size', value: BODY_SIZE }],
    })
  )
  return obj
}

/** Inline display maths as $...$ text — a Formula object has no pptx
 *  equivalent (see exportPptx's own doc comment) and would silently vanish
 *  from an exported file; plain text with the notebook's own $...$ syntax
 *  survives export as a readable line even though it won't render as KaTeX
 *  inside PowerPoint itself. In-app Present mode uses the same text
 *  renderer as the notebook, so it DOES render there. */
function inlineFormula(latex: string): string {
  return `$${latex}$`
}

// How much body text fits before the fixed-height slide box starts clipping.
// Calibrated for BODY_SIZE (20px, not the default 15px): a wider glyph
// fits fewer characters per line and fewer lines in the same box. Estimating
// too high is what makes text run off the bottom of a fixed-size slide.
//   840px wide / ~11px average advance at 20px  ≈ 76 chars, take 70 for safety
//   350px tall / ~30px line-height at 20px      ≈ 11 lines, take 10
const CHARS_PER_LINE = 70
const LINES_PER_SLIDE = 10

interface Section {
  heading: string
  lines: string[]
}

/** Split raw answer Markdown into heading-led sections. Text before the
 *  first heading becomes a section with no heading (folded into slide 1's
 *  body under a generic title) rather than dropped. */
function splitSections(markdown: string): Section[] {
  const sections: Section[] = [{ heading: '', lines: [] }]
  // The nearest #/## above the current line, so a ### sub-section can say
  // which part of the answer it belongs to.
  let parent = ''
  for (const raw of markdown.split('\n')) {
    // Levels 3 and 4 both split: the pendulum answer put its "Given/To Find"
    // at ### and its numbered derivation steps at ####, so stopping at ###
    // left all four steps crushed into one "To Find" body.
    const h = /^(#{1,4})\s+(.*)$/.exec(raw)
    if (h) {
      // "## Slide 5" with no title after the number strips to nothing; the
      // section survives on its body, and gets the "Notes" fallback below.
      const label = stripSlideNumber(h[2])
      if (h[1].length <= 2) {
        parent = label
        sections.push({ heading: label, lines: [] })
      } else {
        // A ### sub-section is its own slide. Measured on a real pendulum
        // answer, the model wrote four "### Step N:" sub-sections under one
        // "## Derivation"; folding them into the body split that section by
        // LINE COUNT instead, giving four slides all titled "Derivation
        // (continued)" when the natural break was already in the source.
        // The parent stays as a prefix so a bare "Step 2" still says what of.
        sections.push({ heading: parent && label ? `${parent} — ${label}` : label || parent, lines: [] })
      }
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

  // The model reliably opens an answer with its own H1 ("# States of Matter")
  // before the first real section. That is the document's title, not a
  // section: emitted as a slide it renders as a heading-only slide directly
  // after the title slide — two title slides in a row. Promote it to BE the
  // deck's headline (it is better written than the raw prompt) and drop it
  // from the section list, but only when it carries no body of its own.
  const lead = sections[0]
  const leadIsTitle = lead?.heading && lead.lines.every((l) => l.trim() === '')
  const headline = leadIsTitle ? lead.heading : title
  const body = leadIsTitle ? sections.slice(1) : sections

  const slides: SceneObject[][] = [
    [slideTitle(headline.length > 90 ? headline.slice(0, 87) + '…' : headline)],
  ]

  for (const section of body) {
    // Section carries no useful heading (the answer opened with prose, not
    // a "Given:"-style header) — fold it under the title slide as a body.
    const bodyLines = section.lines.filter((l) => l.trim() !== '')
    if (!section.heading && bodyLines.length === 0) continue
    const heading = section.heading || 'Notes'

    // A heading with nothing under it is one slide, not a slide plus an
    // empty one: the do/while below always runs at least once, so letting it
    // run on an empty body emitted a blank body box AND a duplicate heading
    // slide from the trailing `if` — a blank slide mid-deck in Present mode.
    if (bodyLines.length === 0) {
      slides.push([aiSlideHeading(heading)])
      continue
    }

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
      slides.push([aiSlideHeading(label), aiSlideBody(chunk)])
      start = end
      part++
    } while (start < bodyLines.length)
  }

  return slides
}

/**
 * A name for the deck's page in the sidebar.
 *
 * The raw prompt makes a poor document name — a deck showed up as "make me
 * slides on different states of matter and their related gr…", which is the
 * request, not the subject. The answer's own H1 is already a written title,
 * so prefer it and fall back to the prompt with the request verb stripped.
 */
export function deckTitle(markdown: string, prompt: string): string {
  const h1 = /^#\s+(.+)$/m.exec(markdown.trim())
  if (h1) return h1[1].trim().slice(0, 60)
  const bare = prompt
    .replace(/^\s*(?:please\s+)?(?:can you\s+)?(?:make|create|build|generate|give)\s+(?:me\s+)?(?:some\s+|a\s+|an\s+)?(?:slides?|deck|presentation|powerpoint|pptx?)\s*(?:on|about|for|covering)?\s*/i, '')
    .trim()
  const name = bare || prompt.trim()
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 60)
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
