// Custom sketch components: teach SIMBLIP your own symbols. A template is a
// normalized point cloud captured from example strokes plus the component id
// it should spawn; held pen doodles are matched with a $P-style greedy cloud
// distance (rotation-sensitive on purpose — schematic symbols have an
// orientation). Templates persist per browser in localStorage.

export interface CustomSketchTemplate {
  id: string
  name: string
  /** palette component id this sketch spawns (lib/scene/factory COMPONENTS) */
  componentId: string
  /** normalized cloud: N points, centroid at origin, unit scale */
  cloud: number[][]
}

const KEY = 'simblip-custom-sketches'
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

/** Resample → translate centroid to origin → scale to unit extent. */
export function normalizeCloud(raw: number[][]): number[][] {
  const pts = resample(raw, N)
  const cx = pts.reduce((s, p) => s + p[0], 0) / N
  const cy = pts.reduce((s, p) => s + p[1], 0) / N
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

export function listCustomTemplates(): CustomSketchTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as CustomSketchTemplate[]
  } catch {
    return []
  }
}

/** Save one example stroke as (another) template for a component. More
 *  examples per symbol = better recall; each is stored separately. */
export function addCustomTemplate(name: string, componentId: string, rawPoints: number[][]): void {
  const all = listCustomTemplates()
  all.push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name,
    componentId,
    cloud: normalizeCloud(rawPoints),
  })
  localStorage.setItem(KEY, JSON.stringify(all))
}

export function removeCustomTemplate(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(listCustomTemplates().filter((t) => t.id !== id)))
}

/** Best template match for a drawn stroke, or null when nothing is close. */
export function matchCustomSketch(
  rawPoints: number[][]
): { componentId: string; name: string; score: number } | null {
  const templates = listCustomTemplates()
  if (templates.length === 0) return null
  const cloud = normalizeCloud(rawPoints)
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
