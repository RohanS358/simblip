// Score the CURRENT SketchNet on third-party symbol crops that were imported by import-external.mjs.
// Frozen test = a dataset's own Test split (never trained on). Reported per class and per domain, never pooled with
// synthetic numbers.
//
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/eval-external.mjs \
//        [--dir data/sketch/external] [--split test] [--model sketchnet-v1] [--ref data/sketch/synthetic-photo-8]
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createSketchNet } from '../../../lib/sketch/sketchnet.ts'
import { tierOf } from '../../../lib/sketch/neural-pick.ts'
import { parseShard } from '../../../lib/sketch/dataset.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const dir = resolve(arg('dir', 'data/sketch/external'))
const split = arg('split', 'test')
const model = arg('model', 'sketchnet-v1')
const b = readFileSync(resolve(`public/models/${model}.bin`))
const net = createSketchNet(JSON.parse(readFileSync(resolve(`public/models/${model}.json`), 'utf8')), b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

const load = (d, only) => readdirSync(d).filter((f) => f.startsWith(`${only}-`) && f.endsWith('.jsonl.gz')).flatMap((f) => parseShard(gunzipSync(readFileSync(join(d, f))).toString('utf8')))

function score(samples, label) {
  const per = {}, conf = {}
  let ok = 0, ok3 = 0, sure = 0, sureOk = 0
  for (const s of samples) {
    const p = net.predict(s.strokes.map((st) => st.map(([x, y]) => [x, y])))
    const row = (per[s.cls] ??= { n: 0, ok: 0 })
    row.n++
    if (p.cls === s.cls) { row.ok++; ok++ } else { const k = `${s.cls}→${p.cls}`; conf[k] = (conf[k] ?? 0) + 1 }
    if (p.top.slice(0, 3).some((t) => t.cls === s.cls)) ok3++
    if (tierOf({ p: p.conf, margin: p.conf - (p.top[1]?.conf ?? 0), logit: p.logit }) === 'sure') { sure++; if (p.cls === s.cls) sureOk++ }
  }
  const n = samples.length
  console.log(`\n${label}: ${n} crops — top-1 ${((100 * ok) / n).toFixed(1)}%, top-3 ${((100 * ok3) / n).toFixed(1)}%; called "sure" on ${sure} (${((100 * sure) / n).toFixed(0)}%), right on ${sure ? ((100 * sureOk) / sure).toFixed(1) : '-'}% of those`)
  for (const [c, r] of Object.entries(per).sort()) console.log(`  ${c.padEnd(11)} ${String(r.ok).padStart(4)}/${String(r.n).padEnd(4)} ${((100 * r.ok) / r.n).toFixed(1).padStart(5)}%`)
  const top = Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (top.length) console.log('  main confusions: ' + top.map(([k, v]) => `${k}×${v}`).join('  '))
  return { n, top1: ok / n, per }
}

const all = load(dir, split)
const domains = [...new Set(all.map((s) => s.meta?.domain ?? '?'))]
console.log(`model ${model}; ${dir}; split "${split}"`)
for (const d of domains) score(all.filter((s) => (s.meta?.domain ?? '?') === d), `${d} (third-party, real drawings)`)
const ref = arg('ref')
if (ref) score(load(resolve(ref), 'test').slice(0, 3000), `${ref} test (SYNTHETIC reference, not comparable)`)
