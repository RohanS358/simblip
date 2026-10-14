// Score generated scripts with the real app: node scripts/ai/eval/score-jsonl.mjs out.jsonl [--label name]
// Prints the four families and the pass rates that matter, plus the worst offenders.
import { readFileSync, writeFileSync } from 'node:fs'
import { makeEvaluator } from '../quality/evaluate.mjs'
const file = process.argv[2]
const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const ev = await makeEvaluator()
const rs = rows.map((r) => ({ ...r, ...ev(r.script).score }))
const mean = (k) => (rs.reduce((a, r) => a + r[k], 0) / rs.length)
const pct = (f) => `${Math.round((100 * rs.filter(f).length) / rs.length)}%`
console.log(`\n${file}  (${rs.length} scripts)`)
console.log(`valid ${pct((r) => r.valid === 1)} | runs-stably ${pct((r) => r.valid === 1 && r.function >= 0.9)} | good-looking(≥.8) ${pct((r) => r.valid === 1 && r.looks >= 0.8)} | teaches(≥.7) ${pct((r) => r.valid === 1 && r.teaches >= 0.7)} | ALL ${pct((r) => r.valid === 1 && r.function >= 0.9 && r.looks >= 0.8 && r.teaches >= 0.7)}`)
console.log(`mean score ${mean('total').toFixed(1)}  function ${mean('function').toFixed(2)} looks ${mean('looks').toFixed(2)} teaches ${mean('teaches').toFixed(2)}`)
const by = {}
for (const r of rs) { const k = r.recipe ?? '-'; (by[k] ??= []).push(r) }
for (const [k, v] of Object.entries(by)) console.log(' ', k.padEnd(16), String(v.length).padStart(3), 'mean', (v.reduce((a, r) => a + r.total, 0) / v.length).toFixed(1), 'valid', Math.round((100 * v.filter((r) => r.valid).length) / v.length) + '%')
const worst = [...rs].sort((a, b) => a.total - b.total).slice(0, 5)
for (const w of worst) console.log('\n  ✖', w.total, JSON.stringify(w.prompt).slice(0, 90), '\n    ', w.issues.slice(0, 4).join(' | '))
writeFileSync(file.replace(/\.jsonl$/, '.scored.json'), JSON.stringify(rs.map(({ prompt, recipe, total, valid, function: f, looks, teaches, issues }) => ({ prompt, recipe, total, valid, f, looks, teaches, issues })), null, 1))
process.exit(0)
