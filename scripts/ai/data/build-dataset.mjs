// Build the fine-tuning set: recipes → run in the REAL app → score → keep the good.
//
//   node scripts/ai/data/build-dataset.mjs --n 4000 --seed 1 --out .cache/data
//
// Writes train.jsonl / eval.jsonl (chat format) and report.json. Nothing enters
// the set unless it lints, runs stably, and scores well — so the model can only
// be taught things that work and look right.

import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { generate, explainSample, cardsSample, rng } from './recipes.mjs'
import { makeEvaluator } from '../quality/evaluate.mjs'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1] }
const N = Number(arg('n', 400))
const SEED = Number(arg('seed', 1))
const OUT = arg('out', '.cache/data')
const CAP = Number(arg("cap", 4))
const MIN = { function: 0.9, looks: Number(arg('looks', 0.8)), teaches: Number(arg('teaches', 0.7)) }

/** What the fine-tuned model is told. The language is in its WEIGHTS, so the
 *  1,000-token card the base model needs is replaced by one line — which is most
 *  of the latency saved on a CPU, where reading the prompt is the wait. */
export const SYSTEM = 'You write SimScript for SIMBLIP. Reply with SimScript code only.'
/** The tutor lane: same model, different job, equally short instructions. */
export const TUTOR = 'You are SIMBLIP\'s friendly engineering tutor. Explain simply, with the real numbers, in short Markdown. For flash cards reply with one JSON object per line: {"front": ..., "back": ...}.'

const ev = await makeEvaluator()
const rows = generate(N, SEED)
const seen = new Map() // script hash → how many prompts already use it
const kept = []
const stats = {}
let t0 = Date.now()
for (const [i, row] of rows.entries()) {
  const h = createHash('sha1').update(row.script).digest('hex')
  const s = (stats[row.recipe] ??= { n: 0, ok: 0, dup: 0, looks: 0, teaches: 0, fn: 0, fails: {} })
  s.n++
  if ((seen.get(h) ?? 0) >= CAP) { s.dup++; continue } // a scene may be asked for in several voices
  const { score } = ev(row.script)
  s.looks += score.looks; s.teaches += score.teaches; s.fn += score.function
  const why = score.valid === 0 ? 'invalid' : score.function < MIN.function ? 'function' : score.looks < MIN.looks ? 'looks' : score.teaches < MIN.teaches ? 'teaches' : null
  if (why) { s.fails[why] = (s.fails[why] ?? 0) + 1; if ((s.fails[why] === 1) && process.env.VERBOSE) console.log(`✖ ${row.recipe} ${why}: ${score.issues.slice(0, 4).join(' | ')}`); continue }
  seen.set(h, (seen.get(h) ?? 0) + 1); s.ok++
  kept.push({ ...row, score: score.total })
  if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${N} (${kept.length} kept, ${((Date.now() - t0) / 1000).toFixed(0)}s)`)
}
const chat = (r) => JSON.stringify({ recipe: r.recipe, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: r.prompt }, { role: 'assistant', content: r.script }] })
// Hold out whole parameter draws, not phrasings of the same scene: split by script hash.
const isEval = (r) => parseInt(createHash('sha1').update(r.script).digest('hex').slice(0, 4), 16) % 20 === 0
// Tutor material from the SAME verified scenes. Held out together with them.
const tr = rng(SEED + 99)
const tutor = []
for (const k of kept) {
  if (tr.chance(0.3)) { const e = explainSample(tr, k.recipe, k.script); if (e) tutor.push({ recipe: `tutor:${k.recipe}`, hash: k.script, kind: 'explain', ...e }) }
  if (tr.chance(0.12)) { const c = cardsSample(tr, k.recipe, k.script); if (c) tutor.push({ recipe: `tutor:${k.recipe}`, hash: k.script, kind: 'cards', ...c }) }
}
const tchat = (t) => JSON.stringify({ recipe: t.recipe, kind: t.kind, messages: [{ role: 'system', content: TUTOR }, { role: 'user', content: t.prompt }, { role: 'assistant', content: t.answer }] })
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/train.jsonl`, [...kept.filter((r) => !isEval(r)).map(chat), ...tutor.filter((t) => !isEval({ script: t.hash })).map(tchat)].join('\n') + '\n')
writeFileSync(`${OUT}/eval.jsonl`, kept.filter(isEval).map(chat).join('\n') + '\n')
writeFileSync(`${OUT}/eval-tutor.jsonl`, tutor.filter((t) => isEval({ script: t.hash })).map(tchat).join('\n') + '\n')
writeFileSync(`${OUT}/report.json`, JSON.stringify({ n: N, kept: kept.length, min: MIN, stats }, null, 1))
console.log(`\nkept ${kept.length}/${N}  (train ${kept.filter((r) => !isEval(r)).length}, eval ${kept.filter(isEval).length})`)
console.log('recipe'.padEnd(16), 'n'.padStart(4), 'kept'.padStart(5), ' fn  looks teach  fails')
for (const [k, s] of Object.entries(stats)) console.log(k.padEnd(16), String(s.n).padStart(4), String(s.ok).padStart(5), (s.fn / Math.max(1, s.n - s.dup)).toFixed(2), (s.looks / Math.max(1, s.n - s.dup)).toFixed(2), (s.teaches / Math.max(1, s.n - s.dup)).toFixed(2), JSON.stringify(s.fails))
process.exit(0)
