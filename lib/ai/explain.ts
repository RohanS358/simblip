// The explain lane: derivations, numericals and short notes.
//
// SimScript builds scenes, so the old pipeline had to answer EVERY question
// in create() calls. Asked to "derive Gauss's law" the model invented
// create("shape") and derived nothing; asked to convert 173.625 to binary it
// emitted decNumber.toString(2), which SimScript cannot even run. Measured on
// the course's own 100 questions: 44 derivations, 37 numericals, 19 notes.
//
// Freed from SimScript the SAME local 7B does the work correctly — verified
// on this machine: 173 -> 10101101, back EMF = 210 V, a real Gauss's law
// derivation. The fix was never a better model, it was letting the answer be
// prose.
//
// Output lands in the notebook as text/note/formula objects, so an answer is
// an ordinary editable page — not a chat bubble that vanishes.

import { EXPLAIN_TOKENS, type SimScriptGenerator } from './generate'

/** What the notebook's text renderer actually supports, and nothing else.
 *  Block prefixes come from BLOCK_PREFIX_RE (lib/text/marks.ts); inline maths
 *  is `$...$` (lib/text/render.ts). Display maths is a Formula object, which
 *  the writer emits separately — telling the model to use $$...$$ inside a
 *  text block would render as literal dollar signs. */
export const EXPLAIN_SYSTEM_PROMPT = `You are an engineering tutor inside SIMBLIP, a Nepali university engineering notebook. You answer coursework questions: derivations, numericals, and short notes.

FORMAT
- Plain Markdown. Headings with #/##, bullets with "- ", numbered steps with "1. ".
- Inline maths in single dollars: $E = mc^2$. Never use $$ ... $$ — display equations go on their own line as a single dollar expression.
- Use real symbols where they read better: Ω μ ε λ ω π ∮ ∇ ⇒ °.

HOW TO ANSWER
- DERIVATION: state what is given and what is to be found, then derive step by step. Every step must follow from the one above it. Box the result by ending with a line "**Result:** <expression>".
- NUMERICAL: list the given values with units, write the formula symbolically, substitute numbers, then compute. Carry units through. End with "**Answer:** <value with unit>".
- SHORT NOTE: a tight definition first, then the physical meaning, then where it matters in practice. Use a bullet list when comparing things.

YOU ARE INSIDE A SIMULATOR
- SIMBLIP's canvas runs the simulation itself — real mechanics, circuits, optics and waves, with live graphs and sliders. When a question asks for a simulation, a SEPARATE lane builds that scene on the canvas alongside your answer. You do not build it and you do not describe how to build it.
- Never answer with runnable code in another language. No Python, no numpy/matplotlib/scipy, no MATLAB, no JavaScript — a student here cannot run it and does not need to. Writing "import matplotlib" as the answer to "simulate a pendulum" teaches a workaround for a problem this product does not have.
- Write the physics instead: the equation of motion, what each term means, what the graph beside you will show, and which parameter is worth varying. That is the part the scene cannot say for itself.

RULES
- Show every step. A skipped step is the thing the student needed.
- Keep units in every substitution, and state assumptions you had to make.
- Do not invent values that were not given. If something essential is missing, say so and solve symbolically.
- No preamble, no "Sure!", no closing pleasantries. Start with the answer content.`

/** A section of a generated answer, ready to become one notebook object. */
export interface AnswerBlock {
  kind: 'text' | 'formula'
  /** Markdown for `text`; LaTeX for `formula`. */
  content: string
}

/** Lines that are a single display equation and nothing else. These become
 *  Formula objects (real KaTeX, display size) instead of inline text maths. */
const DISPLAY_MATH_RE = /^\s*\$([^$\n]+)\$\s*$/

/**
 * Split a Markdown answer into notebook blocks.
 *
 * A standalone equation line becomes a Formula object; everything else
 * accumulates into text blocks. This is what makes an answer feel like a
 * page rather than a wall of text — the equations are real rendered maths
 * the student can click and edit.
 */
export function toAnswerBlocks(markdown: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = []
  let buffer: string[] = []

  const flush = () => {
    const text = buffer.join('\n').trim()
    if (text) blocks.push({ kind: 'text', content: text })
    buffer = []
  }

  for (const line of markdown.split('\n')) {
    const math = DISPLAY_MATH_RE.exec(line)
    // A short expression reads better inline; only a substantial one earns
    // its own Formula card, or a three-term derivation becomes a stack of
    // tiny boxes.
    if (math && math[1].trim().length >= 12) {
      flush()
      blocks.push({ kind: 'formula', content: math[1].trim() })
    } else {
      buffer.push(line)
    }
  }
  flush()
  return blocks
}

/**
 * Normalise a raw answer into what the notebook can actually render.
 *
 * The delimiter rewrite is the load-bearing part. Every instruction-tuned
 * model reaches for LaTeX's own `\(...\)` and `\[...\]` no matter what the
 * prompt asks for — measured on this machine, one answer came back with 25
 * `\(` and 28 `$`: zero. The notebook's text renderer only recognises
 * `$...$` (MATH_RE in lib/text/render.ts), so every equation would have
 * rendered as literal backslashes and parens.
 *
 * Fixing it in code rather than in the prompt is deliberate: this is a purely
 * mechanical mapping, so it is exact, free, and cannot regress the way a
 * prompt instruction does when the model is swapped.
 */
export function cleanAnswer(raw: string): string {
  return raw
    .replace(/```(?:markdown|md|latex|text)?\n?/g, '')
    .replace(/^\s*(?:sure|certainly|of course|here(?:'s| is))\b[^\n]*\n+/i, '')
    // Display maths first: \[ x \] and $$ x $$ become a lone $x$ on its own
    // line, which toAnswerBlocks() then promotes to a real Formula object.
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, e) => `\n$${collapse(e)}$\n`)
    .replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_, e) => `\n$${collapse(e)}$\n`)
    // Inline maths.
    .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, e) => `$${collapse(e)}$`)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** KaTeX handles a newline inside an expression badly, and an inline run must
 *  stay on one line for MATH_RE to match it at all. */
const collapse = (expr: string): string => expr.replace(/\s*\n\s*/g, ' ').trim()

/**
 * Answer blocks as SimScript.
 *
 * Placing them this way rather than writing objects directly is deliberate:
 * it keeps the AI on exactly one path onto the canvas — the same verified
 * executeSimScript() a hand-typed script goes through — so an answer cannot
 * create anything a user could not have typed themselves.
 *
 * Blocks stack down the page, each sized to its own content, so a long
 * derivation reads as a column of notes rather than one clipped box.
 */
/** Column width of a placed answer — callers lay things out beside it. */
export const ANSWER_WIDTH = 520

/** Height of one block at the given width — the single source both
 *  blocksToSimScript() (layout) and answerColumnSize() (centering the
 *  finished column on the viewport) advance by, so the two can never
 *  disagree about how tall a block is. */
function blockHeight(b: AnswerBlock): number {
  return b.kind === 'formula'
    ? formulaHeight(b.content)
    : Math.max(56, b.content.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 92)), 0) * 22 + 24)
}

export function blocksToSimScript(blocks: AnswerBlock[], width = ANSWER_WIDTH): string {
  const lines: string[] = []
  let y = 0
  blocks.forEach((b, i) => {
    // Height is estimated, not the factory's flat 96: a fraction, a stack or
    // a \\begin{aligned} block is far taller than one line, and a fixed 96
    // dropped the next block straight on top of it. Over-estimating is safe
    // here (the card centres its content); under-estimating overlaps.
    const h = blockHeight(b)
    // x: 1, not 0 — executeSimScript()'s "unplaced card" auto-layout
    // (lib/scene/simscript.ts) treats x:0 AND y:0 together as "never
    // positioned" and is free to shove that card down to dodge whatever
    // else is already on the page. Every block here genuinely IS placed
    // (this whole column is laid out on purpose), but the very first one
    // always has y:0 too, so on a page that already has content it got
    // silently relocated out from under the caller's own centering —
    // pulling the whole answer far off the point it was just centered on.
    // A 1px nudge is invisible and reads as "explicit" to that check.
    if (b.kind === 'formula') {
      lines.push(
        `var f${i} = create("formula", { x: 1, y: ${y}, width: ${width}, height: ${h}, latex: ${js(b.content)} });`
      )
    } else {
      lines.push(`var t${i} = create("text", { x: 1, y: ${y}, width: ${width}, height: ${h}, text: ${js(b.content)} });`)
    }
    y += h + 12
  })
  return lines.join('\n')
}

/** Total size of the column blocksToSimScript() lays out — what a caller
 *  needs to CENTER the finished column on a point, since every block's
 *  position is written relative to (0,0), not to its own center. */
export function answerColumnSize(blocks: AnswerBlock[], width = ANSWER_WIDTH): { w: number; h: number } {
  if (blocks.length === 0) return { w: width, h: 0 }
  const h = blocks.reduce((y, b) => y + blockHeight(b) + 12, 0) - 12
  return { w: width, h }
}

/** Rough rendered height of a display-mode expression, in px.
 *
 *  KaTeX's real height is only knowable after typesetting, which cannot
 *  happen here (this runs before the object exists). Calibrated against
 *  actual .katex-display heights measured in-browser: a bare expression
 *  renders at ~38px, one \frac (nested or not) at ~47-50px regardless of
 *  how many \frac/\left( it contains — KaTeX reuses vertical space for
 *  nested tall elements rather than stacking their heights. The old
 *  per-occurrence multiplier (+16px per \frac, uncapped contribution)
 *  overshot every real case 1.6-2x (a single \frac measured 78px estimated
 *  vs 38-47px actual), leaving the card looming over content half its size. */
function formulaHeight(latex: string): number {
  // Explicit row breaks in aligned/gathered/matrix environments.
  const rows = (latex.match(/\\\\/g) ?? []).length + 1
  // Any fraction/root/big-operator adds one fixed step, not one per
  // occurrence — nesting doesn't stack height the way side-by-side rows do.
  const hasTall = /\\(frac|dfrac|binom|int|oint|sum|prod|sqrt)\b/.test(latex)
  const perRow = 30 + (hasTall ? 18 : 0)
  return Math.max(44, rows * perRow + 20)
}

/** A JS string literal safe to paste into generated SimScript. */
const js = (v: string) => JSON.stringify(v)

export interface ExplainResult {
  /** The full Markdown answer. */
  markdown: string
  /** The same answer split into notebook objects. */
  blocks: AnswerBlock[]
  backend: string
}

/**
 * Answer a coursework question as prose.
 *
 * No verify/repair loop, unlike the SimScript lane. There is nothing
 * statically checkable about a derivation — a linter cannot tell a correct
 * integration from a wrong one — so spending a second model round on it would
 * buy nothing. The SimScript loop exists because verification there is free
 * and exact; here it would be neither.
 */
export async function explain(
  question: string,
  opts: {
    generator: SimScriptGenerator
    onToken?: (chunk: string) => void
    systemPrompt?: string
  }
): Promise<ExplainResult> {
  const raw = await opts.generator.generate(
    opts.systemPrompt ?? EXPLAIN_SYSTEM_PROMPT,
    question,
    opts.onToken,
    undefined,
    // A derivation is far longer than a scene, and the SimScript-sized
    // default silently cut answers mid-word — see EXPLAIN_TOKENS.
    EXPLAIN_TOKENS
  )
  const markdown = cleanAnswer(raw)
  return { markdown, blocks: toAnswerBlocks(markdown), backend: opts.generator.name }
}
