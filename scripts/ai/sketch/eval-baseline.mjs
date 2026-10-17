// Score the EXISTING recogniser (feature extraction + CART decision tree from
// lib/sketch/features.ts) on the sketch dataset. This is the number SketchNet
// has to beat — and it is reported per source, never pooled.
//
//   npm run sketch:baseline -- --train data/sketch/synthetic --test data/sketch/synthetic [--real data/sketch/real]
//
// SYNTHETIC results measure how well a method learns the generator's world.
// Only REAL results say anything about people; with no real data the report
// says so instead of printing a number that looks like one.

import { features, trainTree, classify } from '../../../lib/sketch/features.ts'
import { groupOf, iterDirs } from './dataset.mjs'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const trainDirs = arg('train', 'data/sketch/synthetic').split(',')
const testDirs = [...new Set([...arg('test', arg('train', 'data/sketch/synthetic')).split(','), ...(arg('real') ? [arg('real')] : [])])]
const perClass = Number(arg('per-class', 100)) // the tree's trainer is O(n²); keep it modest

const featuresOf = (s) => features(s.strokes.map((st) => st.map(([x, y]) => [x, y])))

// a balanced, deterministic training subset, streamed
const seen = {}
const rows = []
const trainGroups = new Set()
for (const s of iterDirs(trainDirs, { splits: ['train'] })) {
  trainGroups.add(groupOf(s))
  seen[s.cls] = (seen[s.cls] ?? 0) + 1
  if (seen[s.cls] <= perClass) rows.push({ x: featuresOf(s), y: s.cls })
}
const tree = trainTree(rows)
console.log(`baseline: CART on ${rows.length} samples (${Object.keys(seen).length} labels, <=${perClass}/class), trained on ${[...trainGroups].join('+')}
`)

// test + real: streamed, score as we go, keep only tallies
const stats = {}
const writerSplit = new Map()
for (const s of iterDirs(testDirs, { splits: ['test', 'val'] })) {
  const prev = writerSplit.get(s.writer)
  if (prev && prev !== s.split) throw new Error(`writer ${s.writer} appears in both ${prev} and ${s.split}`)
  writerSplit.set(s.writer, s.split)
  const g = groupOf(s)
  // synthetic is scored on its TEST split only; real data on val+test (it is small)
  if (g === 'synthetic' && s.split !== 'test') continue
  const st = (stats[g] ??= { n: 0, hit: 0, top3: 0, per: {}, confuse: {} })
  const guess = classify(tree, featuresOf(s)).classes
  const p = (st.per[s.cls] ??= { n: 0, ok: 0 })
  st.n++
  p.n++
  if (guess[0] === s.cls) { st.hit++; p.ok++ } else { const k = `${s.cls} -> ${guess[0]}`; st.confuse[k] = (st.confuse[k] ?? 0) + 1 }
  if (guess.slice(0, 3).includes(s.cls)) st.top3++
}

const report = (name, st) => {
  console.log(`${name}  n=${st.n}  top-1 ${(100 * st.hit / st.n).toFixed(1)}%  top-3 ${(100 * st.top3 / st.n).toFixed(1)}%`)
  const worst = Object.entries(st.per).map(([c, v]) => [c, v.ok / v.n, v.n]).sort((a, b) => a[1] - b[1]).slice(0, 6)
  console.log('  weakest:', worst.map(([c, r, n]) => `${c} ${(100 * r).toFixed(0)}% (n=${n})`).join(', '))
  console.log('  top confusions:', Object.entries(st.confuse).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} x${v}`).join(', '))
}

console.log('-- SYNTHETIC (generated hands; not real-world validation) --')
if (stats.synthetic) report('synthetic / test (unseen synthetic writers)', stats.synthetic)
else console.log('  no synthetic test data')

console.log('\n-- REAL (people) --')
if (stats.real) report('real / writer-independent', stats.real)
else console.log('  no real data yet. Nothing here may be quoted as a real accuracy. Collect with /train; consent text in docs/ai/sketch-consent.md.')
