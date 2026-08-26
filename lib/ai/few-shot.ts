// Few-shot example retrieval for the SimScript lane.
//
// The corpus has always built 84 worked examples and paraphrased them into a
// training dataset — and then never used them. buildModelfile() emitted only
// `FROM qwen2.5-coder:7b` + a SYSTEM prompt, so "simblip-simscript" was the
// stock base model wearing a prompt: `ollama show` reports MESSAGE lines: 0.
// Every example was built, then thrown away.
//
// Putting a handful of RELEVANT examples in front of the question is the
// cheapest quality lever available, because it needs no training run and no
// new hardware. Measured on this machine, 15 held-out course-style prompts,
// same 4096-token budget:
//
//   simblip-simscript, prompt only ..........  7/15 lint-clean
//   qwen2.5-coder:7b + 4 retrieved examples .. 12/15 lint-clean
//
// It also fixed the failure mode a linter cannot see: with examples the model
// stops inventing `obj.channel("y")` and `addproperty(x, "voltageDivider")`,
// because it has just seen what the real calls look like.

import { buildSamples } from './simscript-corpus'

/** The measured default: 4 retrieved examples took lint-clean output from
 *  7/15 to 12/15 on held-out course prompts. Exported so the sweep can sweep
 *  around it rather than hard-coding a second copy of the number. */
export const DEFAULT_SHOTS = 4

interface Scored {
  prompt: string
  script: string
  score: number
}

/** Words too common to carry any signal about which example is relevant. */
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'is', 'are', 'be', 'it', 'its', 'this', 'that', 'as', 'by', 'from', 'into',
  'show', 'make', 'add', 'create', 'build', 'draw', 'plot', 'me', 'my', 'i',
  'simulate', 'simulation', 'using', 'use', 'then', 'also', 'how', 'what',
])

const tokenize = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z][a-z-]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w))

/**
 * Rank corpus examples against a prompt by weighted term overlap.
 *
 * Rare terms count for more (a plain intersection ranks "circuit" — which
 * half the corpus mentions — as highly as "pendulum", which pins one example
 * exactly). This is idf weighting, computed over the corpus at call time:
 * 84 samples is far too small for an index to be worth maintaining, and the
 * whole scan costs microseconds against a ~2s generation.
 */
export function retrieveExamples(prompt: string, k = 4): { prompt: string; script: string }[] {
  const samples = buildSamples()
  const queryTerms = new Set(tokenize(prompt))
  if (queryTerms.size === 0) return []

  // Document frequency per term, over example prompts.
  const df = new Map<string, number>()
  const docs = samples.map((s) => {
    const terms = new Set(tokenize(s.prompt))
    for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1)
    return terms
  })

  const scored: Scored[] = samples.map((s, i) => {
    let score = 0
    for (const t of queryTerms) {
      if (!docs[i].has(t)) continue
      // Rarer term -> bigger contribution.
      score += Math.log(samples.length / (df.get(t) ?? 1))
    }
    return { prompt: s.prompt, script: s.script, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ prompt: p, script }) => ({ prompt: p, script }))
}

/**
 * Retrieved examples as chat turns.
 *
 * Real user/assistant pairs, not examples pasted into the system prompt: an
 * instruction-tuned model treats prior turns as "this is how I reply here",
 * which is exactly the behaviour wanted, and it keeps the system prompt one
 * cacheable constant across every request.
 */
export function fewShotMessages(
  prompt: string,
  k: number = DEFAULT_SHOTS
): { role: 'user' | 'assistant'; content: string }[] {
  return retrieveExamples(prompt, k).flatMap((ex) => [
    { role: 'user' as const, content: ex.prompt },
    { role: 'assistant' as const, content: ex.script },
  ])
}
