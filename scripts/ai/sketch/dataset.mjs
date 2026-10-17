// Read sketch shards from any number of directories into one list of samples.
//
// This is the seam where real data joins the pipeline: a directory of
// `*.jsonl.gz` shards, any `source`. Synthetic and real shards are loaded by
// the same code; what differs is only how results are REPORTED — always
// grouped by `groupOf`, never pooled.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { parseShard } from '../../../lib/sketch/dataset.ts'

/** The reporting group of a sample. Synthetic positives and negatives are one world. */
export const groupOf = (s) => (s.source === 'synthetic' || s.source === 'synthetic-negative' ? 'synthetic' : s.source)

/**
 * Stream samples from `dir`, one shard in memory at a time — the full synthetic
 * set is too big to hold as objects. `splits` filters by shard name prefix
 * (train/val/test), so reading the test split never touches the train shards.
 * Each shard's sha256 is checked against MANIFEST.json when one exists.
 */
export function* iterDir(dir, { splits } = {}) {
  const root = resolve(dir)
  if (!existsSync(root)) return
  let manifest = null
  if (existsSync(join(root, 'MANIFEST.json'))) manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json'), 'utf8'))
  for (const f of readdirSync(root).filter((f) => f.endsWith('.jsonl.gz')).sort()) {
    if (splits && !splits.some((sp) => f.startsWith(`${sp}-`))) continue
    const bytes = readFileSync(join(root, f))
    const want = manifest?.shards?.find((s) => s.file === f)?.sha256
    if (want && createHash('sha256').update(bytes).digest('hex') !== want) {
      throw new Error(`${join(root, f)} does not match MANIFEST.json — the shard changed after it was written`)
    }
    yield* parseShard(gunzipSync(bytes).toString())
  }
}

/** Everything in `dir` at once — fine for small sets, use iterDir for the big ones. */
export function loadDir(dir, opts) {
  return [...iterDir(dir, opts)]
}

export function* iterDirs(dirs, opts) {
  for (const d of dirs) yield* iterDir(d, opts)
}

export function loadDirs(dirs, opts) {
  return dirs.flatMap((d) => loadDir(d, opts))
}

/** { group: { train: [], val: [], test: [] } } */
export function byGroupAndSplit(samples) {
  const out = {}
  for (const s of samples) ((out[groupOf(s)] ??= { train: [], val: [], test: [] })[s.split]).push(s)
  return out
}

/** A writer must live in exactly one split. Throws if the data breaks that. */
export function assertWriterDisjoint(samples) {
  const seen = new Map()
  for (const s of samples) {
    const prev = seen.get(s.writer)
    if (prev && prev !== s.split) throw new Error(`writer ${s.writer} appears in both ${prev} and ${s.split}`)
    seen.set(s.writer, s.split)
  }
}
