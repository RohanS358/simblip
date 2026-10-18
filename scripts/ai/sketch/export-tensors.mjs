// Turn sketch shards into the flat binary arrays the Python trainer reads.
//
//   npm run sketch:export -- --src data/sketch/synthetic --out D:/simblip-ml/data/synthetic-s1
//
// Runs lib/sketch/preprocess.ts — the same code the browser uses — so there is
// no second implementation to drift. Output per split ({train,val,test}):
//   <split>.img.u8   N x 2 x 32 x 32  uint8 (value/255)
//   <split>.seq.f32  N x 64 x 4       float32 little-endian
//   <split>.cls.u8   N                label index into meta.labels
//   <split>.pose.u8  N                0..3 = 0/90/180/270; 255 = no pose (unknown)
//   <split>.dev.u8   N                index into meta.devices
//   <split>.grp.u8   N                index into meta.groups (synthetic / real / public)
// plus meta.json. Real shards exported later use the same layout.

import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { preprocess, IMG, SEQ_LEN, SEQ_DIM, PREPROCESS_VERSION } from '../../../lib/sketch/preprocess.ts'
import { ALL_LABELS, CLASS_LIST_VERSION, UNKNOWN_CLASS } from '../../../lib/sketch/classes.ts'
import { DEVICES } from '../../../lib/sketch/dataset.ts'
import { groupOf, iterDirs } from './dataset.mjs'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const srcs = arg('src', 'data/sketch/synthetic').split(',')
const out = resolve(arg('out', 'D:/simblip-ml/data/synthetic-s1'))
mkdirSync(out, { recursive: true })

const GROUPS = ['synthetic', 'real', 'public']
const POSES = [0, 90, 180, 270]
const fds = {}
const counts = { train: 0, val: 0, test: 0 }
const open = (split, ext) => (fds[`${split}.${ext}`] ??= openSync(join(out, `${split}.${ext}`), 'w'))
const t0 = Date.now()
const buf = { train: [], val: [], test: [] }

function flush(split) {
  const rows = buf[split]
  if (!rows.length) return
  const n = rows.length
  const img = Buffer.alloc(n * 2 * IMG * IMG)
  const seq = Buffer.alloc(n * SEQ_LEN * SEQ_DIM * 4)
  const cls = Buffer.alloc(n), pose = Buffer.alloc(n), dev = Buffer.alloc(n), grp = Buffer.alloc(n)
  rows.forEach((r, i) => {
    for (let k = 0; k < r.t.img.length; k++) img[i * 2 * IMG * IMG + k] = Math.round(r.t.img[k] * 255)
    Buffer.from(r.t.seq.buffer, r.t.seq.byteOffset, r.t.seq.byteLength).copy(seq, i * SEQ_LEN * SEQ_DIM * 4)
    cls[i] = ALL_LABELS.indexOf(r.s.cls)
    pose[i] = r.s.cls === UNKNOWN_CLASS ? 255 : POSES.indexOf(r.s.pose)
    dev[i] = DEVICES.indexOf(r.s.device)
    grp[i] = GROUPS.indexOf(groupOf(r.s))
  })
  writeSync(open(split, 'img.u8'), img)
  writeSync(open(split, 'seq.f32'), seq)
  writeSync(open(split, 'cls.u8'), cls)
  writeSync(open(split, 'pose.u8'), pose)
  writeSync(open(split, 'dev.u8'), dev)
  writeSync(open(split, 'grp.u8'), grp)
  counts[split] += n
  buf[split] = []
}

for (const s of iterDirs(srcs)) {
  buf[s.split].push({ s, t: preprocess(s.strokes) })
  if (buf[s.split].length >= 4000) flush(s.split)
}
for (const k of Object.keys(buf)) flush(k)
Object.values(fds).forEach(closeSync)

const manifests = srcs.map((d) => { try { return JSON.parse(readFileSync(join(resolve(d), 'MANIFEST.json'), 'utf8')).name } catch { return d } })
writeFileSync(join(out, 'meta.json'), JSON.stringify({
  preprocessVersion: PREPROCESS_VERSION, classListVersion: CLASS_LIST_VERSION,
  labels: ALL_LABELS, devices: DEVICES, groups: GROUPS, poses: POSES,
  img: [2, IMG, IMG], seq: [SEQ_LEN, SEQ_DIM], counts, sources: manifests,
}, null, 2) + '\n')
console.log(`exported ${JSON.stringify(counts)} to ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
