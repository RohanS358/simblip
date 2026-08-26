// AI sweep — drive /api/ai with a fixed prompt set, then run the REAL
// placement/lint/slide code over each result and report what would land
// where. Catches what a screenshot can't: off-frame origins, overlapping
// blocks, decks with empty slides, scripts that fail the linter.
//
// Usage: node scripts/ai-sweep.mjs [--only canvas|slides|doc] [--from N] [--to N]
//                                 [--models a,b] [--shots 0,2,4]
//
// --models and --shots turn this from a regression run into a TUNING run: the
// same prompts against every combination, so "is a 3b with more examples as
// good as a 7b with four?" becomes a number instead of an argument. That is
// the question worth answering, because prefill dominates the cost here — a
// scene is ~300 output tokens against a system prompt plus k full example
// scripts of input, so k and the parameter count are the two real dials.
//
//   node scripts/ai-sweep.mjs --models qwen2.5-coder:7b,qwen2.5-coder:3b --shots 0,4,8
//
// Every request sets nocache, or the second configuration would be served the
// first one's answers and every comparison would read as a tie.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { PROMPTS } from './ai-sweep-prompts.mjs'

const BASE = process.env.SWEEP_BASE || 'http://localhost:3000'
const OUT = process.env.SWEEP_OUT || '.sweep'
mkdirSync(OUT, { recursive: true })

const SLIDE = { w: 960, h: 540 }
const SHEET = { w: 794, h: 1123 }
const BOARD = { w: 1200, h: 800 }

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const from = args.includes('--from') ? +args[args.indexOf('--from') + 1] : 0
const to = args.includes('--to') ? +args[args.indexOf('--to') + 1] : 1e9
const list = (flag) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1].split(',').map((s) => s.trim()) : [null]
// `null` means "whatever the server is configured for" — the default run is
// exactly the single-configuration sweep this script has always been.
const MODELS = list('--models')
const SHOTS = list('--shots').map((v) => (v === null ? null : Number(v)))

const boundsFor = (surface) => {
  const f = surface === 'slides' ? SLIDE : surface === 'doc' ? SHEET : BOARD
  return { left: 0, top: 0, right: f.w, bottom: f.h }
}

async function ask(prompt, model, shots) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      nocache: true,
      ...(model === null ? {} : { model }),
      ...(shots === null ? {} : { shots }),
    }),
  })
  const json = await res.json()
  return { ...json, ms: Date.now() - t0, status: res.status }
}

const results = []
for (const model of MODELS) {
  for (const shots of SHOTS) {
    const config = [model ?? 'default', shots === null ? 'default' : `k=${shots}`].join(' ')
    let i = -1
    for (const p of PROMPTS) {
      i++
      if (only && p.surface !== only) continue
      if (i < from || i > to) continue
      process.stderr.write(`[${config}] [${i}] ${p.surface} :: ${p.prompt.slice(0, 50)}... `)
      let r
      try {
        r = await ask(p.prompt, model, shots)
      } catch (e) {
        r = { message: `FETCH FAIL: ${e.message}`, ms: 0, status: 0 }
      }
      const rec = {
        i,
        config,
        model,
        shots,
        surface: p.surface,
        prompt: p.prompt,
        ms: r.ms,
        status: r.status,
        message: r.message,
        hasAnswer: !!r.answer,
        blockCount: r.blocks?.length ?? 0,
        hasScript: !!r.script,
        answer: r.answer,
        blocks: r.blocks,
        script: r.script,
      }
      results.push(rec)
      writeFileSync(`${OUT}/raw.json`, JSON.stringify(results, null, 2))
      process.stderr.write(`${r.ms}ms blocks=${rec.blockCount} script=${rec.hasScript}\n`)
    }
  }
}
console.log(JSON.stringify({ count: results.length, configs: results.length ? [...new Set(results.map((r) => r.config))] : [] }, null, 2))
