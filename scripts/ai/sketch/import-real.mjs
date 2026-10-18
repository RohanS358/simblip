// Turn an export from the app (Pen settings → Saved corrections → Export) into a
// shard directory the rest of the pipeline reads, exactly like the synthetic one
// but with source "real".
//
//   npm run sketch:import-real -- --in ~/Downloads/simblip-corrections-2026-10-20.jsonl --out data/sketch/real
//
// Every record is validated against the shared schema. One person is one
// writer, so these start as held-out TEST data (split "test"): a model never
// trains on the people it is later measured on. Create a train/val split only on
// purpose, by writer, once more than one person has contributed.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parseShard } from '../../../lib/sketch/dataset.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const inputs = (arg('in') ?? '').split(',').filter(Boolean)
const out = resolve(arg('out', 'data/sketch/real'))
if (!inputs.length) {
  console.error('usage: sketch:import-real -- --in <file.jsonl[,file2.jsonl]> [--out data/sketch/real]')
  process.exit(1)
}

const seen = new Set()
const samples = []
for (const f of inputs) {
  for (const s of parseShard(readFileSync(resolve(f), 'utf8'))) {
    if (s.source !== 'real') throw new Error(`${f}: ${s.id} has source "${s.source}", expected "real"`)
    if (seen.has(s.id)) continue // the same export imported twice must not double-count
    seen.add(s.id)
    samples.push(s)
  }
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const bySplit = {}
for (const s of samples) (bySplit[s.split] ??= []).push(s)
const shards = []
for (const [split, rows] of Object.entries(bySplit)) {
  const file = `${split}-0000.jsonl.gz`
  const bytes = gzipSync(Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'), { level: 9 })
  writeFileSync(join(out, file), bytes)
  shards.push({ file, split, count: rows.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
const count = (key) => samples.reduce((m, s) => ((m[key(s)] = (m[key(s)] ?? 0) + 1), m), {})
writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify({
  name: 'real-local',
  notice: 'REAL strokes confirmed or corrected by the people who drew them, collected locally. Report separately from synthetic data.',
  source: ['real'],
  licence: 'contributed by the person who drew them, on their own device; not uploaded or shared',
  total: samples.length,
  counts: { cls: count((s) => s.cls), device: count((s) => s.device), split: count((s) => s.split) },
  writers: new Set(samples.map((s) => s.writer)).size,
  shards,
}, null, 2) + '\n')
console.log(`imported ${samples.length} real samples (${new Set(samples.map((s) => s.writer)).size} writer) into ${out}`)
