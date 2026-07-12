// Discriminative sketch recognition.
//
// Schematic symbols are mostly the SAME shape: two horizontal leads and a
// body of similar size. A whole-shape cloud distance averages over every
// point, so the identical leads dominate the score and the small unique part
// — a zigzag, two plates, an arrowhead — barely moves it. Two fixes here:
//
//   1. stripLeads()  removes the shared structure, keeping only the body,
//      so what's left IS the distinguishing part.
//   2. features() + a CART decision tree ask discriminating QUESTIONS
//      ("does it reverse direction 4+ times?" → resistor) instead of
//      averaging. The tree narrows to a few candidates; the cloud distance
//      on the body then picks between them.

export type StrokeSet = number[][][]

// ── Geometry helpers ────────────────────────────────────────────────────────

const bboxOf = (pts: number[][]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y)
    x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  return { x0, y0, x1, y1, w: Math.max(x1 - x0, 1e-6), h: Math.max(y1 - y0, 1e-6) }
}

const pathLen = (st: number[][]) => {
  let l = 0
  for (let i = 1; i < st.length; i++) l += Math.hypot(st[i][0] - st[i - 1][0], st[i][1] - st[i - 1][1])
  return l
}

/** Center on the bbox and scale so the longer side is 1 — keeps strokes apart. */
export function normalizeStrokes(strokes: StrokeSet): StrokeSet {
  const all = strokes.flat()
  if (all.length === 0) return []
  const b = bboxOf(all)
  const s = 1 / Math.max(b.w, b.h)
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  return strokes.map((st) => st.map(([x, y]) => [(x - cx) * s, (y - cy) * s]))
}

/**
 * Remove the connecting leads — the part every symbol shares. Ink is binned
 * into vertical columns; a column carrying only a thin horizontal line near
 * the vertical centre is lead, not body. Contiguous lead columns are trimmed
 * from the left and right ends, then the remainder is re-normalized so the
 * BODY fills the frame. A resistor's zigzag and a capacitor's two plates
 * then occupy the whole descriptor instead of a third of it.
 */
export function stripLeads(strokes: StrokeSet): StrokeSet {
  const all = strokes.flat()
  if (all.length < 8) return strokes
  const b = bboxOf(all)
  const COLS = 24
  const spread = new Array(COLS).fill(0)
  const has = new Array(COLS).fill(false)
  const lo = new Array(COLS).fill(Infinity)
  const hi = new Array(COLS).fill(-Infinity)
  for (const [x, y] of all) {
    const c = Math.min(COLS - 1, Math.max(0, Math.floor(((x - b.x0) / b.w) * COLS)))
    has[c] = true
    lo[c] = Math.min(lo[c], y)
    hi[c] = Math.max(hi[c], y)
  }
  for (let c = 0; c < COLS; c++) spread[c] = has[c] ? (hi[c] - lo[c]) / b.h : 0

  // A column is "lead" when its ink barely spreads vertically (a flat wire).
  const LEAD = 0.12
  let left = 0
  while (left < COLS && (!has[left] || spread[left] < LEAD)) left++
  let right = COLS - 1
  while (right >= 0 && (!has[right] || spread[right] < LEAD)) right--
  if (right - left < 2) return strokes // all lead-ish (a plain wire) — keep as is

  const xa = b.x0 + (left / COLS) * b.w
  const xb = b.x0 + ((right + 1) / COLS) * b.w
  const out: StrokeSet = []
  for (const st of strokes) {
    let run: number[][] = []
    for (const p of st) {
      if (p[0] >= xa && p[0] <= xb) run.push(p)
      else if (run.length > 1) {
        out.push(run)
        run = []
      } else run = []
    }
    if (run.length > 1) out.push(run)
  }
  return out.length > 0 ? normalizeStrokes(out) : strokes
}

// ── Feature vector ──────────────────────────────────────────────────────────
// Every feature is scale/translation invariant and answers ONE question a
// human would ask to tell two symbols apart.

export const FEATURE_NAMES = [
  'strokes', // how many separate pen strokes
  'aspect', // body width / height
  'inkRatio', // ink length / bbox diagonal — how densely packed
  'corners', // sharp direction changes (RDP vertices)
  'reversals', // zigzag count along the main axis → resistor
  'circularity', // 1 = perfect circle → bulb, source
  'vertBars', // near-vertical segments → capacitor plates, battery
  'horizBars', // near-horizontal segments → ground rungs
  'diagonals', // ~45° segments → diode arrow, BJT
  'crossings', // stroke–stroke intersections → transistor, XOR
  'symV', // left/right mirror symmetry
  'symH', // top/bottom mirror symmetry
  'closed', // fraction of strokes that close on themselves
  'endpoints', // free stroke ends
] as const

export type Features = number[]

function resample(st: number[][], n: number): number[][] {
  const total = pathLen(st)
  if (total <= 0 || st.length < 2) return st.slice(0, 1)
  const step = total / (n - 1)
  const out: number[][] = [st[0]]
  let acc = 0
  for (let i = 1; i < st.length && out.length < n; i++) {
    let [px, py] = st[i - 1]
    const [qx, qy] = st[i]
    let d = Math.hypot(qx - px, qy - py)
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d
      px += t * (qx - px)
      py += t * (qy - py)
      out.push([px, py])
      d = Math.hypot(qx - px, qy - py)
      acc = 0
    }
    acc += d
  }
  return out
}

const segIntersect = (a: number[], b: number[], c: number[], d: number[]) => {
  const cross = (o: number[], p: number[], q: number[]) =>
    (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

export function features(strokes: StrokeSet): Features {
  const S = normalizeStrokes(strokes).filter((st) => st.length > 1)
  const all = S.flat()
  if (all.length < 3) return new Array(FEATURE_NAMES.length).fill(0)
  const b = bboxOf(all)
  const diag = Math.hypot(b.w, b.h) || 1
  const ink = S.reduce((s, st) => s + pathLen(st), 0)

  // Segment orientation census over resampled strokes (stable at any speed).
  let vert = 0
  let horiz = 0
  let diagN = 0
  let corners = 0
  let reversals = 0
  let prevDirX = 0
  for (const st of S) {
    const r = resample(st, Math.max(4, Math.min(40, Math.round(pathLen(st) / 0.05))))
    let prevAng: number | null = null
    for (let i = 1; i < r.length; i++) {
      const dx = r[i][0] - r[i - 1][0]
      const dy = r[i][1] - r[i - 1][1]
      const len = Math.hypot(dx, dy)
      if (len < 1e-4) continue
      const ang = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) % 180
      if (ang > 65 && ang < 115) vert++
      else if (ang < 25 || ang > 155) horiz++
      else diagN++
      if (prevAng !== null) {
        let turn = Math.abs(ang - prevAng)
        if (turn > 90) turn = 180 - turn
        if (turn > 40) corners++
      }
      prevAng = ang
      // zigzag: sign flips of the vertical direction (resistor, spring)
      const sy = dy > 0.02 ? 1 : dy < -0.02 ? -1 : 0
      if (sy !== 0 && prevDirX !== 0 && sy !== prevDirX) reversals++
      if (sy !== 0) prevDirX = sy
    }
  }
  const segs = Math.max(1, vert + horiz + diagN)

  // circularity: constant radius from the centroid
  const cx = all.reduce((s, p) => s + p[0], 0) / all.length
  const cy = all.reduce((s, p) => s + p[1], 0) / all.length
  const radii = all.map(([x, y]) => Math.hypot(x - cx, y - cy))
  const meanR = radii.reduce((s, r) => s + r, 0) / radii.length || 1
  const varR = Math.sqrt(radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length)
  const circularity = Math.max(0, 1 - varR / meanR)

  // mirror symmetry: how well the point set maps onto its reflection
  const grid = (flipX: boolean, flipY: boolean) => {
    const K = 12
    const A = new Set<number>()
    const B = new Set<number>()
    for (const [x, y] of all) {
      const gx = Math.min(K - 1, Math.max(0, Math.floor(((x - b.x0) / b.w) * K)))
      const gy = Math.min(K - 1, Math.max(0, Math.floor(((y - b.y0) / b.h) * K)))
      A.add(gy * K + gx)
      const fx = flipX ? K - 1 - gx : gx
      const fy = flipY ? K - 1 - gy : gy
      B.add(fy * K + fx)
    }
    let hit = 0
    for (const k of A) if (B.has(k)) hit++
    return A.size ? hit / A.size : 0
  }

  // stroke–stroke crossings (transistors, XOR gates, coils)
  let crossings = 0
  for (let i = 0; i < S.length; i++)
    for (let j = i + 1; j < S.length; j++) {
      const a = resample(S[i], 16)
      const c = resample(S[j], 16)
      for (let p = 1; p < a.length; p++)
        for (let q = 1; q < c.length; q++)
          if (segIntersect(a[p - 1], a[p], c[q - 1], c[q])) crossings++
    }

  const closed =
    S.filter((st) => {
      const g = Math.hypot(st[0][0] - st[st.length - 1][0], st[0][1] - st[st.length - 1][1])
      return g < 0.18
    }).length / S.length

  return [
    S.length,
    b.w / b.h,
    ink / diag,
    corners,
    reversals,
    circularity,
    vert / segs,
    horiz / segs,
    diagN / segs,
    Math.min(crossings, 12),
    grid(true, false),
    grid(false, true),
    closed,
    S.length * 2 - 2 * S.filter((st) => {
      const g = Math.hypot(st[0][0] - st[st.length - 1][0], st[0][1] - st[st.length - 1][1])
      return g < 0.18
    }).length,
  ]
}

// ── CART decision tree ──────────────────────────────────────────────────────
// Learned from the labelled training examples. Each split is a question about
// ONE feature, chosen to separate the classes best (lowest Gini impurity).
// The tree narrows a sketch to a handful of candidates; a body-focused cloud
// distance then decides between them. Trees are cheap to train (rebuilt on
// every library sync) and, unlike a flat nearest-neighbour, they explain
// themselves — /train can show you the exact question path.

export interface TreeNode {
  /** leaf: class counts */
  counts?: Record<string, number>
  /** branch */
  f?: number
  thr?: number
  left?: TreeNode
  right?: TreeNode
}

export interface Sample {
  x: Features
  y: string // component id
}

const gini = (counts: Record<string, number>, n: number) => {
  let s = 1
  for (const k in counts) s -= (counts[k] / n) ** 2
  return s
}

const tally = (rows: Sample[]) => {
  const c: Record<string, number> = {}
  for (const r of rows) c[r.y] = (c[r.y] ?? 0) + 1
  return c
}

export function trainTree(rows: Sample[], depth = 0): TreeNode {
  const counts = tally(rows)
  const classes = Object.keys(counts)
  if (classes.length <= 1 || depth >= 8 || rows.length < 2) return { counts }

  let best: { f: number; thr: number; gain: number; l: Sample[]; r: Sample[] } | null = null
  const parent = gini(counts, rows.length)
  for (let f = 0; f < FEATURE_NAMES.length; f++) {
    const vals = [...new Set(rows.map((r) => r.x[f]))].sort((a, b) => a - b)
    for (let k = 0; k < vals.length - 1; k++) {
      const thr = (vals[k] + vals[k + 1]) / 2
      const l = rows.filter((r) => r.x[f] <= thr)
      const r = rows.filter((r) => r.x[f] > thr)
      if (l.length === 0 || r.length === 0) continue
      const g =
        parent -
        (l.length / rows.length) * gini(tally(l), l.length) -
        (r.length / rows.length) * gini(tally(r), r.length)
      if (!best || g > best.gain) best = { f, thr, gain: g, l, r }
    }
  }
  if (!best || best.gain <= 1e-9) return { counts }
  return {
    f: best.f,
    thr: best.thr,
    left: trainTree(best.l, depth + 1),
    right: trainTree(best.r, depth + 1),
  }
}

/** Candidate classes for a sketch, best first, plus the questions asked. */
export function classify(tree: TreeNode, x: Features): { classes: string[]; path: string[] } {
  const path: string[] = []
  let node: TreeNode | undefined = tree
  while (node && node.f !== undefined && node.left && node.right) {
    const f: number = node.f
    const thr: number = node.thr as number
    const goLeft: boolean = x[f] <= thr
    path.push(`${FEATURE_NAMES[f]} ${goLeft ? '≤' : '>'} ${thr.toFixed(2)}`)
    node = goLeft ? node.left : node.right
  }
  const counts = node?.counts ?? {}
  const classes = Object.keys(counts).sort((a, b) => counts[b] - counts[a])
  return { classes, path }
}
