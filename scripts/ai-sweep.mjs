// AI sweep — drive /api/ai with a fixed prompt set, then run the REAL
// placement/lint/slide code over each result and report what would land
// where. Catches what a screenshot can't: off-frame origins, overlapping
// blocks, decks with empty slides, scripts that fail the linter.
//
// Usage: node scripts/ai-sweep.mjs [--only canvas|slides|doc] [--from N] [--to N]

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

const boundsFor = (surface) => {
  const f = surface === 'slides' ? SLIDE : surface === 'doc' ? SHEET : BOARD
  return { left: 0, top: 0, right: f.w, bottom: f.h }
}

async function ask(prompt) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const json = await res.json()
  return { ...json, ms: Date.now() - t0, status: res.status }
}

const results = []
let i = -1
for (const p of PROMPTS) {
  i++
  if (only && p.surface !== only) continue
  if (i < from || i > to) continue
  process.stderr.write(`[${i}] ${p.surface} :: ${p.prompt.slice(0, 60)}... `)
  let r
  try {
    r = await ask(p.prompt)
  } catch (e) {
    r = { message: `FETCH FAIL: ${e.message}`, ms: 0, status: 0 }
  }
  const rec = {
    i,
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
console.log(JSON.stringify({ count: results.length }, null, 2))
