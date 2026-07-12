// Sketch recognition: a freehand stroke becomes a circle, oval, square,
// rectangle, a regular 3–8-gon (triangle…octagon) or a line. Recognition
// only upgrades GEOMETRY — physical meaning still comes from attaching
// behaviors, so a wrong guess costs the user nothing (docs/architecture.md:
// draw → convert → simulate). Irregular closed doodles stay ink; only clean
// regular polygons snap. Zigzags are NOT force-converted into springs — a
// spring comes from the palette, or from a behavior you attach yourself.

export interface Recognition {
  kind: 'circle' | 'rect' | 'line' | 'polygon' | 'stroke'
  /** points relative to bbox min (for polygon/line/stroke) */
  points: number[][]
  w: number
  h: number
  x: number
  y: number
}

function bbox(points: number[][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) }
}

/** Ramer–Douglas–Peucker simplification. */
export function simplify(points: number[][], epsilon: number): number[][] {
  if (points.length < 3) return points
  const [sx, sy] = points[0]
  const [ex, ey] = points[points.length - 1]
  let maxDist = 0
  let index = 0
  const dx = ex - sx
  const dy = ey - sy
  const len = Math.hypot(dx, dy) || 1
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dy * points[i][0] - dx * points[i][1] + ex * sy - ey * sx) / len
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, index + 1), epsilon)
    const right = simplify(points.slice(index), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [points[0], points[points.length - 1]]
}

export function recognize(raw: number[][]): Recognition {
  const { minX, minY, w, h } = bbox(raw)
  // Pressure (a third component, when present) survives into the stroke
  // fallback so committed ink renders with the same widths as the preview.
  const rel = raw.map(([x, y, p]) =>
    p === undefined ? [x - minX, y - minY] : [x - minX, y - minY, p]
  )
  const diag = Math.hypot(w, h)
  const base: Omit<Recognition, 'kind' | 'points'> = { w, h, x: minX, y: minY }
  const fallback: Recognition = { kind: 'stroke', points: rel, ...base }
  if (raw.length < 6) {
    // A short flick is a line.
    return raw.length >= 2
      ? { kind: 'line', points: [rel[0], rel[rel.length - 1]], ...base }
      : fallback
  }

  const start = rel[0]
  const end = rel[rel.length - 1]
  const closed = Math.hypot(end[0] - start[0], end[1] - start[1]) < Math.max(diag * 0.22, 24)

  if (!closed) {
    // Line: low deviation from the chord.
    const chord = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    let maxDev = 0
    for (const [x, y] of rel) {
      const d =
        Math.abs(
          (end[1] - start[1]) * x - (end[0] - start[0]) * y + end[0] * start[1] - end[1] * start[0]
        ) / chord
      if (d > maxDev) maxDev = d
    }
    if (maxDev < Math.max(chord * 0.06, 6)) {
      return { kind: 'line', points: [start, end], ...base }
    }

    // An open curve that isn't a straight line stays exactly as drawn.
    return fallback
  }

  // Closed shapes. Corner analysis runs FIRST: a clean pentagon…octagon has
  // low radial variance too, so testing circle-ness first would swallow it.
  const cx = rel.reduce((s, p) => s + p[0], 0) / rel.length
  const cy = rel.reduce((s, p) => s + p[1], 0) / rel.length
  const closedPts = [...rel, rel[0]]
  // RDP degenerates on a closed loop (the chord start→end has zero length,
  // every distance reads 0) — split at the point farthest from the seam and
  // simplify each half instead.
  let far = 1
  let farD = 0
  for (let i = 1; i < closedPts.length - 1; i++) {
    const d = Math.hypot(closedPts[i][0] - closedPts[0][0], closedPts[i][1] - closedPts[0][1])
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const simple = [
    ...simplify(closedPts.slice(0, far + 1), diag * 0.04).slice(0, -1),
    ...simplify(closedPts.slice(far), diag * 0.04),
  ]
  // Keep only vertices where the outline genuinely turns — the stroke seam
  // and RDP chatter on smooth arcs drop out; a circle keeps none.
  const sharp = sharpCorners(closedPts, simple)
  const corners = sharp.length
  const aspect = w / h

  if (corners >= 3 && corners <= 8) {
    if (corners === 4) {
      // shoelace area vs bbox area: filled bbox = axis-ish rectangle…
      let area = 0
      for (let i = 0; i < sharp.length; i++) {
        const [x0, y0] = sharp[i]
        const [x1, y1] = sharp[(i + 1) % sharp.length]
        area += x0 * y1 - x1 * y0
      }
      if (Math.abs(area) / 2 / (w * h) > 0.75) {
        if (aspect > 0.82 && aspect < 1.22) {
          // Near-equal sides → perfect square.
          const side = (w + h) / 2
          return { kind: 'rect', points: [], w: side, h: side, x: minX + (w - side) / 2, y: minY + (h - side) / 2 }
        }
        return { kind: 'rect', points: [], ...base }
      }
      // …otherwise a rotated 4-gon (diamond) falls through to the snap below.
    }
    // Snap to the polygon the user ACTUALLY drew: keep the detected corners
    // exactly where they are and just straighten the edges between them — a
    // ramp-shaped triangle stays that ramp (same place, proportions and
    // orientation), never an idealized regular n-gon.
    return { kind: 'polygon', points: sharp.map(([x, y]) => [x, y]), ...base }
  }

  // Circle/oval: radial distance from the centroid, each axis normalized by
  // the bbox, is nearly constant for any ellipse.
  const radii = rel.map(([x, y]) => Math.hypot((x - cx) / w, (y - cy) / h))
  const mean = radii.reduce((s, r) => s + r, 0) / radii.length
  const variance = radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length
  if (Math.sqrt(variance) / mean < 0.14) {
    if (aspect > 0.82 && aspect < 1.22) {
      // Near-round → perfect circle (square bbox, averaged diameter).
      const d = (w + h) / 2
      return { kind: 'circle', points: [], w: d, h: d, x: minX + (w - d) / 2, y: minY + (h - d) / 2 }
    }
    return { kind: 'circle', points: [], ...base } // oval: ellipse in its bbox
  }

  // Anything else closed stays exactly the ink that was drawn.
  return fallback
}

/** The subset of simplified vertices where the drawn outline really turns
 *  (local direction change over a small window beats ~31°). Separates real
 *  n-gon corners from a smooth circle RDP happens to chop into segments —
 *  a circle spreads its turning evenly, so no single spot passes. */
function sharpCorners(closedPts: number[][], simple: number[][]): number[][] {
  const n = closedPts.length
  const win = Math.max(2, Math.round(n * 0.03))
  const out: number[][] = []
  let j = 0
  for (let i = 0; i < simple.length - 1; i++) {
    const c = simple[i]
    while (j < n && (closedPts[j][0] !== c[0] || closedPts[j][1] !== c[1])) j++
    if (j >= n) break
    const a = closedPts[(j - win + n) % n]
    const b = closedPts[j]
    const d = closedPts[(j + win) % n]
    const t0 = Math.atan2(b[1] - a[1], b[0] - a[0])
    const t1 = Math.atan2(d[1] - b[1], d[0] - b[0])
    let turn = Math.abs(t1 - t0)
    if (turn > Math.PI) turn = 2 * Math.PI - turn
    if (turn > 0.55) out.push(c)
  }
  return out
}

/** Vertices of a regular n-gon inscribed in a w×h box (points relative to
 *  the box origin). `phase` rotates the first vertex; default: apex on top. */
export function regularPolygonPoints(n: number, w: number, h: number, phase = -Math.PI / 2): number[][] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (i * 2 * Math.PI) / n
    return [w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]
  })
}
