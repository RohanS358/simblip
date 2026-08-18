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

import type { SimScriptGenerator } from './generate'

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
export function blocksToSimScript(blocks: AnswerBlock[], width = 520): string {
  const lines: string[] = []
  let y = 0
  blocks.forEach((b, i) => {
    if (b.kind === 'formula') {
      lines.push(`var f${i} = create("formula", { x: 0, y: ${y}, width: ${width}, latex: ${js(b.content)} });`)
      y += 96
    } else {
      // ~92 characters per line at this width, plus one line per hard break.
      const rows = b.content.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 92)), 0)
      const h = Math.max(56, rows * 22 + 24)
      lines.push(`var t${i} = create("text", { x: 0, y: ${y}, width: ${width}, height: ${h}, text: ${js(b.content)} });`)
      y += h + 12
    }
  })
  return lines.join('\n')
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
    opts.onToken
  )
  const markdown = cleanAnswer(raw)
  return { markdown, blocks: toAnswerBlocks(markdown), backend: opts.generator.name }
}
