// A contact sheet of generated samples, to LOOK at — the fastest way to catch a
// glyph that doesn't read as its class or a corruption that is too gentle or
// too brutal.
//
//   npm run sketch:preview -- --dir data/sketch/synthetic --per 6
//
// Writes <dir>/../preview.html. One row per class; each cell is a sample,
// coloured by device, stroke starts marked with a dot.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { parseShard } from '../../../lib/sketch/dataset.ts'
import { ALL_LABELS } from '../../../lib/sketch/classes.ts'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d }
const dir = resolve(arg('dir', 'data/sketch/synthetic'))
const per = Number(arg('per', 6))
const split = arg('split', 'train')

const files = readdirSync(dir).filter((f) => f.startsWith(split) && f.endsWith('.jsonl.gz'))
const byCls = {}
for (const f of files) {
  for (const s of parseShard(gunzipSync(readFileSync(join(dir, f))).toString())) {
    ;(byCls[s.cls] ??= []).push(s)
  }
}

const COLOR = { mouse: '#2563eb', touchpad: '#7c3aed', finger: '#ea580c', pen: '#16a34a' }
const CELL = 130

function svg(s) {
  const all = s.strokes.flat()
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  const w = Math.max(Math.max(...xs) - x0, 1), h = Math.max(Math.max(...ys) - y0, 1)
  const k = (CELL - 16) / Math.max(w, h)
  const T = ([x, y]) => `${((x - x0) * k + (CELL - w * k) / 2).toFixed(1)},${((y - y0) * k + (CELL - h * k) / 2).toFixed(1)}`
  const paths = s.strokes.map((st) => `<polyline fill="none" stroke="${COLOR[s.device]}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" points="${st.map(T).join(' ')}"/><circle r="2.4" fill="${COLOR[s.device]}" cx="${T(st[0]).split(',')[0]}" cy="${T(st[0]).split(',')[1]}"/>`)
  return `<svg width="${CELL}" height="${CELL}" viewBox="0 0 ${CELL} ${CELL}">${paths.join('')}</svg>`
}

// every `step`th sample so the row mixes writers and devices
const rows = ALL_LABELS.map((cls) => {
  const list = byCls[cls] ?? []
  const step = Math.max(1, Math.floor(list.length / per))
  const picks = Array.from({ length: per }, (_, i) => list[i * step]).filter(Boolean)
  return `<tr><th>${cls}</th>${picks.map((s) => `<td title="${s.device} · pose ${s.pose} · ${s.meta?.variant ?? ''}">${svg(s)}<div>${s.device} ${s.pose}°</div></td>`).join('')}</tr>`
})

const legend = Object.entries(COLOR).map(([d, c]) => `<span style="color:${c}">● ${d}</span>`).join(' &nbsp; ')
writeFileSync(join(dir, '..', 'preview.html'), `<!doctype html><meta charset="utf-8"><title>Sketch samples — SYNTHETIC</title>
<style>body{font:13px system-ui;margin:16px;background:#fff;color:#111}th{text-align:right;padding-right:10px;white-space:nowrap}td{border:1px solid #ddd;text-align:center;font-size:10px;color:#666}</style>
<h3>Synthetic samples (${split}) — generated hands, not real people</h3><p>${legend}</p><table>${rows.join('')}</table>`)
console.log(`wrote ${join(dir, '..', 'preview.html')}`)
