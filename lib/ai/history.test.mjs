// The assistant remembering what was just said.
//
// Every /api/ai request was independent: the panel kept the whole thread in
// lib/store/ai-chat.ts and persisted it, but sent only `prompt` and
// `pageContext`. So "now add a graph to that" arrived with no referent — the
// model had never seen "that" — and answered as if it were a first message.
//
// The fix folds the recent tail of the thread into the user prompt. These
// tests pin the two properties that make that safe:
//   1. the transcript is framed as CONTEXT, never as a question to re-answer;
//   2. routing still classifies the NEW prompt alone, so an earlier turn
//      cannot drag a follow-up into the wrong lane.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const routeSrc = readFileSync(join(root, 'app/api/ai/route.ts'), 'utf8')

// withHistory is module-private, so exercise it the way the route does:
// re-export it through a tiny entry that bundles the real file.
const dir = mkdtempSync(join(tmpdir(), 'simblip-ai-history-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')
writeFileSync(entry, `
export { classifyIntent } from '@/lib/ai/route-intent'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`, '--external:react'], { cwd: root, stdio: 'pipe' })
const { classifyIntent } = await import(bundle)

test('the route accepts a history field and feeds it to both lanes', () => {
  assert.match(routeSrc, /history:\s*z\s*\n?\s*\.array/,
    'the request schema must accept history or the panel cannot send it')
  assert.match(routeSrc, /const userPrompt = withHistory\(/,
    'userPrompt is what both generateSimScript and explain receive — history must be folded in there, once, or the two lanes drift')
})

test('history is optional, so a first turn and old clients still work', () => {
  const m = routeSrc.match(/history: z[\s\S]*?\.optional\(\),/)
  assert.ok(m, 'history must be .optional() — the first message of a thread has none')
})

test('routing classifies the new prompt, not the transcript', () => {
  // If the transcript were classified, this follow-up would inherit the
  // previous turn's lane. Guard the real risk directly: a build-verb
  // follow-up after a derivation must still route to the canvas.
  assert.equal(classifyIntent('now simulate it'), 'simulate')
  assert.match(routeSrc, /classifyIntent\(parsed\.data\.prompt\)/,
    'must classify the RAW prompt; classifying the folded transcript lets an earlier turn hijack the lane')
})

test('the panel sends settled turns only, read fresh at send time', () => {
  const panel = readFileSync(join(root, 'components/workspace/ai-panel.tsx'), 'utf8')
  assert.match(panel, /history:\s*useAiChat\s*\n?\s*\.getState\(\)/,
    'must read the store at send time — a render closure drops the newest turn, which is the one follow-ups refer to')
  assert.match(panel, /t\.status === 'ok'/, 'a failed or in-flight turn is not usable context')
  assert.match(panel, /t\.id !== turnId/, 'the in-flight turn must not be sent as its own history')
})

test('the transcript is labelled as context, not as questions to answer', () => {
  assert.match(routeSrc, /do NOT answer these again/,
    'without explicit framing the model re-answers the previous question or blends it with the new one')
  assert.match(routeSrc, /NEW REQUEST:/, 'the actual request must be clearly separated from the transcript')
})

test('history is bounded in both turns and length', () => {
  assert.match(routeSrc, /const HISTORY_TURNS = \d+/)
  assert.match(routeSrc, /const HISTORY_CHARS = \d+/)
  assert.match(routeSrc, /\.max\(20\)/,
    'the schema must cap history — this text is re-sent on every request and the prompt budget is ~1k tokens')
})
