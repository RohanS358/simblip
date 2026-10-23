// Turn third-party circuit-symbol IMAGE datasets into SIMBLIP sample shards (source "public").
//
// The recogniser reads pen strokes. A raster crop becomes strokes the way a photographed diagram does: through
// the REAL photo pipeline (threshold → thin → trace, lib/sketch/photo), so the training sample is what the
// reader will really see. Nothing under data/sketch is touched except the new directory named by --out.
//
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/import-external.mjs \
//        --cktcom F:/simblip-datasets/cktcom/CktComDb-v1.o/CktComDb-v1.o --components "F:/simblip-datasets/ccd/Circuit and Component Dataset/comp" --out data/sketch/external
//
// Datasets (see docs/ai/external-datasets.md for licence status and class maps):
//   cktcomdb    CktComDb v1, ORIGINAL images only (the "a" and "oa" folders are augmentations of the same drawings,
//               so using them as well would double-count and leak across its own Train/Test split). The provided
//               Train/Test split is kept: Test is the frozen evaluation set and is never exported as train.
//   components  "Circuit and Component Dataset" components_all: no writer or split information, so it is TRAIN-ONLY
//               and is never used for evaluation.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
const bmp = createRequire(import.meta.url)('bmp-js')
import { photoToInk } from '../../../lib/sketch/photo/index.ts'
import { ALL_LABELS, CLASS_LIST_VERSION } from '../../../lib/sketch/classes.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const out = resolve(arg('out', 'data/sketch/external'))
if (existsSync(out) && readdirSync(out).length) { console.error(`${out} already has files; refusing to overwrite. Choose a new --out.`); process.exit(1) }
mkdirSync(out, { recursive: true })

/** CktComDb folder number → our class. null = a symbol we have no class for (reported, not imported). */
const CKTCOM = {
  1: 'ac-source', 2: 'ammeter', 3: 'and-gate', 4: 'capacitor', 5: 'battery', 6: 'gnd', 7: 'inductor', 8: 'nand-gate', 9: 'nor-gate', 10: 'not-gate',
  11: 'bjt', 12: 'or-gate', 13: 'diode', 14: 'bjt', 15: null /* circled +/- DC source */, 16: 'resistor', 17: 'switch', 18: null /* transformer */, 19: 'voltmeter', 20: null /* zener */,
}
const COMPONENTS = { '0_diode': 'diode', '1_resistor': 'resistor', '2_inductor': 'inductor', '3_capacitor': 'capacitor', '4_DC_power': null }

const withTime = (strokes) => {
  let t = 0
  return strokes.map((s) => {
    const o = []
    for (let i = 0; i < s.length; i++) {
      if (i) t += Math.max(1, Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]) / 0.5)
      o.push([s[i][0], s[i][1], Math.round(t)])
    }
    t += 150
    return o
  })
}
const toImage = async (file) => {
  if (/\.bmp$/i.test(file)) {
    // sharp cannot read BMP; bmp-js gives ABGR, which is flattened onto white
    const b = bmp.decode(readFileSync(file))
    const d = new Uint8ClampedArray(b.width * b.height * 4)
    for (let i = 0; i < b.width * b.height; i++) { d[i * 4] = b.data[i * 4 + 3]; d[i * 4 + 1] = b.data[i * 4 + 2]; d[i * 4 + 2] = b.data[i * 4 + 1]; d[i * 4 + 3] = 255 }
    return { data: d, width: b.width, height: b.height }
  }
  const { data, info } = await sharp(file).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
}

const t0 = Date.now()
let done = 0
const trainSeen = { cktcomdb: 0, components: 0 }
const rows = { train: [], val: [], test: [] }
const stats = {}
const bump = (ds, split, cls, k) => { const s = ((stats[ds] ??= {})[`${split}/${cls}`] ??= { read: 0, traced: 0, empty: 0 }); s[k]++ }

async function one(ds, file, cls, split, idx, meta) {
  bump(ds, split, cls, 'read')
  if (++done % 200 === 0) console.log(`${done} crops, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  const r = photoToInk(await toImage(file))
  if ('error' in r || r.ink.strokes.length === 0) return bump(ds, split, cls, 'empty')
  const strokes = withTime(r.ink.strokes.map((s) => s.pts.map(([x, y]) => [x, y])))
  // every 7th training crop is held out for model selection (cktcomdb: these are ORIGINAL drawings, never an augmented copy of one)
  if (split === 'train' && ++trainSeen[ds] % 7 === 0) split = 'val'
  rows[split].push({
    id: `${ds}-${split}-${idx}`, cls, pose: 0, strokes, source: 'public',
    // no writer ids exist in either dataset: one writer id per dataset+split, so a split can never mix by "writer"
    writer: `${ds}-${split}`, device: 'pen', split,
    meta: { dataset: ds, domain: ds === 'cktcomdb' ? 'scan-hand' : 'digital-hand', poseKnown: false, ...meta },
  })
  bump(ds, split, cls, 'traced')
}

const skipped = {}
const cktcom = arg('cktcom')
if (cktcom) {
  for (const split of ['Train', 'Test']) {
    for (let c = 1; c <= 20; c++) {
      const dir = join(cktcom, split, String(c).padStart(2, '0'))
      for (const f of readdirSync(dir).sort()) {
        const cls = CKTCOM[c]
        if (!cls) { skipped[`cktcomdb folder ${c}`] = (skipped[`cktcomdb folder ${c}`] ?? 0) + 1; continue }
        await one('cktcomdb', join(dir, f), cls, split.toLowerCase(), `${c}-${f.replace(/\.\w+$/, '')}`, { folder: c })
      }
    }
  }
}
const comps = arg('components')
if (comps) {
  for (const d of readdirSync(comps).sort()) {
    const key = d.replace(/_[HV]_white$/, '')
    const cls = COMPONENTS[key]
    if (!cls) { skipped[`components ${key}`] = (skipped[`components ${key}`] ?? 0) + readdirSync(join(comps, d)).length; continue }
    for (const f of readdirSync(join(comps, d)).sort()) await one('components', join(comps, d, f), cls, 'train', `${d}-${f.replace(/\.\w+$/, '')}`, { orient: d.includes('_V_') ? 'V' : 'H' })
  }
}

const shards = []
const count = (key) => Object.values(rows).flat().reduce((m, s) => ((m[key(s)] = (m[key(s)] ?? 0) + 1), m), {})
for (const [split, list] of Object.entries(rows)) {
  if (!list.length) continue
  const file = `${split}-0000.jsonl.gz`
  const bytes = gzipSync(Buffer.from(list.map((r) => JSON.stringify(r)).join('\n') + '\n'), { level: 9 })
  writeFileSync(join(out, file), bytes)
  shards.push({ file, split, count: list.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
writeFileSync(join(out, 'MANIFEST.json'), JSON.stringify({
  name: 'external-public',
  notice: 'THIRD-PARTY hand-drawn symbol images traced to strokes by the SIMBLIP photo pipeline. Report separately from synthetic and from locally collected real data. Licence of each dataset: docs/ai/external-datasets.md (unconfirmed for CktComDb and the Circuit and Component Dataset).',
  source: ['public'], classListVersion: CLASS_LIST_VERSION, labels: ALL_LABELS,
  total: Object.values(rows).flat().length,
  counts: { dataset: count((s) => s.meta.dataset), split: count((s) => `${s.meta.dataset}/${s.split}`), cls: count((s) => `${s.meta.dataset}/${s.split}/${s.cls}`) },
  skippedNoClass: skipped, stats, splitRule: 'cktcomdb: the dataset\'s own Train/Test (originals only). components: train only', shards,
}, null, 2) + '\n')
console.log(`wrote ${Object.values(rows).flat().length} samples to ${out}; no class for:`, skipped)
