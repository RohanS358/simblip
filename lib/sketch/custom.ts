// Custom sketch components: teach SIMBLIP your own symbols. A template is a
// normalized point cloud captured from example strokes plus the component id
// it should spawn; held pen doodles are matched with a $P-style greedy cloud
// distance (rotation-sensitive on purpose — schematic symbols have an
// orientation).
//
// STORAGE: templates are precious crowd-sourced training data. They ride the
// platform data layer (lib/data/db) — in cloud mode they live in the GLOBAL
// simblip_sketch_templates table, so every example anyone saves on /train
// improves recognition for every user of the app; in demo mode they persist
// in this browser. Matching stays synchronous via an in-memory cache that
// syncs in the background (pre-cloud localStorage examples migrate over).

import * as db from '@/lib/data/db'
import { useAuthStore } from '@/lib/auth/store'

export interface CustomSketchTemplate {
  id: string
  name: string
  /** palette component id this sketch spawns (lib/scene/factory COMPONENTS) */
  componentId: string
  /** normalized cloud: N points, centroid at origin, unit scale */
  cloud: number[][]
}

interface TemplateRow extends db.Row {
  name: string
  component_id: string
  cloud: number[][]
  contributor?: string | null
}

const KEY = 'simblip-custom-sketches' // legacy per-browser store (migrated)
const N = 32
/** Greedy cloud distance below which a match is accepted (empirical). */
const THRESHOLD = 0.28

function resample(pts: number[][], n: number): number[][] {
  const path: number[][] = pts.map(([x, y]) => [x, y])
  let total = 0
  for (let i = 1; i < path.length; i++)
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  if (total === 0) return Array.from({ length: n }, () => [path[0][0], path[0][1]])
  const step = total / (n - 1)
  const out: number[][] = [[path[0][0], path[0][1]]]
  let acc = 0
  for (let i = 1; i < path.length && out.length < n; i++) {
    let [px, py] = path[i - 1]
    const [qx, qy] = path[i]
    let d = Math.hypot(qx - px, qy - py)
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d
      const nx = px + t * (qx - px)
      const ny = py + t * (qy - py)
      out.push([nx, ny])
      px = nx
      py = ny
      d = Math.hypot(qx - px, qy - py)
      acc = 0
    }
    acc += d
  }
  while (out.length < n) out.push([...out[out.length - 1]])
  return out
}

/** IMAGE-style cloud: strokes are resampled SEPARATELY (sample budget split
 *  by arc length) so no phantom bridge points appear between pen lifts. The
 *  cloud then represents the resulting picture — stroke count, order and
 *  direction all stop mattering, like recognizing the drawn image itself. */
function resampleStrokes(strokes: number[][][], n: number): number[][] {
  const real = strokes.filter((st) => st.length > 0)
  if (real.length === 0) return []
  const lens = real.map((st) => {
    let l = 0
    for (let i = 1; i < st.length; i++)
      l += Math.hypot(st[i][0] - st[i - 1][0], st[i][1] - st[i - 1][1])
    return l
  })
  const total = lens.reduce((a, b) => a + b, 0) || 1
  const out: number[][] = []
  real.forEach((st, i) => {
    const quota = Math.max(2, Math.round((n * lens[i]) / total))
    out.push(...resample(st, quota))
  })
  return out
}

/** Resample → translate centroid to origin → scale to unit extent. */
export function normalizeCloud(rawStrokes: number[][][]): number[][] {
  const pts = resampleStrokes(rawStrokes, N)
  if (pts.length === 0) return []
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
  let ext = 0
  for (const [x, y] of pts) ext = Math.max(ext, Math.abs(x - cx), Math.abs(y - cy))
  ext = ext || 1
  return pts.map(([x, y]) => [(x - cx) / ext, (y - cy) / ext])
}

/** Greedy bidirectional cloud match (Vatavu's $P, simplified). */
function cloudDistance(a: number[][], b: number[][]): number {
  const one = (from: number[][], to: number[][]): number => {
    const used = new Array(to.length).fill(false)
    let sum = 0
    for (let i = 0; i < from.length; i++) {
      let best = -1
      let bestD = Infinity
      for (let j = 0; j < to.length; j++) {
        if (used[j]) continue
        const d = Math.hypot(from[i][0] - to[j][0], from[i][1] - to[j][1])
        if (d < bestD) {
          bestD = d
          best = j
        }
      }
      if (best >= 0) used[best] = true
      sum += bestD
    }
    return sum / from.length
  }
  return Math.min(one(a, b), one(b, a))
}

let cache: CustomSketchTemplate[] = []
let syncStarted = false

/** Pull the shared template library into the matcher's cache. Also migrates
 *  any pre-cloud localStorage examples up into the shared store once. */
export async function syncCustomTemplates(): Promise<void> {
  try {
    const legacy = JSON.parse(localStorage.getItem(KEY) ?? '[]') as CustomSketchTemplate[]
    if (legacy.length > 0) {
      await db.insert(
        'sketch_templates',
        legacy.map((t) => ({
          id: db.newId(),
          name: t.name,
          component_id: t.componentId,
          cloud: t.cloud,
          contributor: null,
        }))
      )
      localStorage.removeItem(KEY)
    }
  } catch {
    /* nothing to migrate */
  }
  try {
    const rows = await db.list<TemplateRow>('sketch_templates')
    cache = rows.map((r) => ({ id: r.id, name: r.name, componentId: r.component_id, cloud: r.cloud }))
  } catch {
    /* offline or table missing — keep whatever the cache holds */
  }
}

function ensureSync() {
  if (syncStarted) return
  syncStarted = true
  void syncCustomTemplates()
}

export function listCustomTemplates(): CustomSketchTemplate[] {
  ensureSync()
  return cache
}

/** Save one example as (another) template for a component. Lands in the
 *  shared library so everyone's recognition improves; the local cache is
 *  updated optimistically so it matches immediately. */
export function addCustomTemplate(name: string, componentId: string, rawStrokes: number[][][]): void {
  const tpl: CustomSketchTemplate = {
    id: db.newId(),
    name,
    componentId,
    cloud: normalizeCloud(rawStrokes),
  }
  cache = [...cache, tpl]
  void db
    .insert('sketch_templates', {
      id: tpl.id,
      name,
      component_id: componentId,
      cloud: tpl.cloud,
      contributor: useAuthStore.getState().profile?.full_name ?? null,
    })
    .catch(() => {
      /* offline — the optimistic cache still works this session */
    })
}

export function removeCustomTemplate(id: string): void {
  cache = cache.filter((t) => t.id !== id)
  void db.removeById('sketch_templates', id).catch(() => {})
}

/** Best template match for a drawn stroke, or null when nothing is close. */
export function matchCustomSketch(
  rawStrokes: number[][][]
): { componentId: string; name: string; score: number } | null {
  ensureSync()
  const templates = cache
  if (templates.length === 0) return null
  const cloud = normalizeCloud(rawStrokes)
  if (cloud.length === 0) return null
  let best: CustomSketchTemplate | null = null
  let bestD = Infinity
  for (const t of templates) {
    const d = cloudDistance(cloud, t.cloud)
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return best && bestD < THRESHOLD
    ? { componentId: best.componentId, name: best.name, score: 1 - bestD }
    : null
}
