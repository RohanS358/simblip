// Sketch recognition: a freehand stroke becomes a circle, rectangle, line,
// spring (zigzag) or polygon. Recognition only upgrades GEOMETRY — physical
// meaning still comes from attaching behaviors, so a wrong guess costs the
// user nothing (docs/architecture.md: draw → convert → simulate).

export interface Recognition {
  kind: 'circle' | 'rect' | 'line' | 'polygon' | 'spring' | 'stroke'
  /** points relative to bbox min (for polygon/line/spring/stroke) */
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

// Edges leaning within ~25° of an axis snap fully horizontal/vertical;
// steeper diagonals stay exactly as drawn (just straight).
const AXIS_SNAP = Math.tan((25 * Math.PI) / 180)

/** Straighten a corner run: every edge becomes a dead-straight segment,
 *  and near-axis edges route like wires (true horizontal/vertical) — so
 *  rough staircases become perfect steps and ladders while deliberate
 *  diagonals keep their slope. No curves, ever. */
function straighten(corners: number[][]): number[][] {
  const out: number[][] = [corners[0]]
  for (let i = 1; i < corners.length; i++) {
    const [px, py] = out[i - 1]
    const dx = corners[i][0] - corners[i - 1][0]
    const dy = corners[i][1] - corners[i - 1][1]
    if (Math.abs(dy) <= Math.abs(dx) * AXIS_SNAP) out.push([px + dx, py])
    else if (Math.abs(dx) <= Math.abs(dy) * AXIS_SNAP) out.push([px, py + dy])
    else out.push([px + dx, py + dy])
  }
  return out
}

/** RDP that returns the INDICES of the kept vertices, so segments between
 *  corners can be pulled back out of the original point run. */
function rdpIndices(points: number[][], a: number, b: number, epsilon: number): number[] {
  if (b - a < 2) return [a, b]
  const [sx, sy] = points[a]
  const [ex, ey] = points[b]
  const dx = ex - sx
  const dy = ey - sy
  const len = Math.hypot(dx, dy) || 1
  let maxDist = 0
  let index = a
  for (let i = a + 1; i < b; i++) {
    const d = Math.abs(dy * points[i][0] - dx * points[i][1] + ex * sy - ey * sx) / len
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    const left = rdpIndices(points, a, index, epsilon)
    const right = rdpIndices(points, index, b, epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [a, b]
}

/** The Shaper tool: straight lines only, no curve smoothing. The stroke is
 *  reduced to its corners and every edge comes out dead straight — a
 *  three-sided rectangle is three crisp segments, zigzags stay zigzags,
 *  near-axis edges snap fully horizontal/vertical for perfect wire steps.
 *  Circles and rects still snap perfect. Unlike the pen, ALWAYS upgrades. */
export function beautify(raw: number[][]): Recognition {
  const rec = recognize(raw)
  if (rec.kind === 'circle' || rec.kind === 'rect' || rec.kind === 'line' || raw.length < 6)
    return rec
  const { minX, minY, w, h } = bbox(raw)
  const rel = raw.map(([x, y]) => [x - minX, y - minY])
  const diag = Math.hypot(w, h)
  const base = { w, h, x: minX, y: minY }
  const start = rel[0]
  const end = rel[rel.length - 1]
  const closed = Math.hypot(end[0] - start[0], end[1] - start[1]) < Math.max(diag * 0.22, 24)

  const pts = closed ? [...rel, [...start]] : rel
  const idx = rdpIndices(pts, 0, pts.length - 1, diag * 0.04)
  const corners = straighten(idx.map((i) => pts[i]))

  if (closed) {
    // Drop the duplicated closing point; polygon geometry closes itself.
    return { kind: 'polygon', points: corners.slice(0, -1), ...base }
  }
  return { kind: 'stroke', points: corners, ...base }
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

    // Spring: many perpendicular oscillations along the main axis.
    const ux = (end[0] - start[0]) / chord
    const uy = (end[1] - start[1]) / chord
    let reversals = 0
    let prevSign = 0
    for (const [x, y] of rel) {
      const perp = -uy * (x - start[0]) + ux * (y - start[1])
      const sign = perp > 4 ? 1 : perp < -4 ? -1 : 0
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) reversals++
      if (sign !== 0) prevSign = sign
    }
    if (reversals >= 4) {
      return { kind: 'spring', points: [start, end], ...base }
    }
    return fallback
  }

  // Closed shapes — circle: radial distance from centroid is nearly constant.
  const cx = rel.reduce((s, p) => s + p[0], 0) / rel.length
  const cy = rel.reduce((s, p) => s + p[1], 0) / rel.length
  const radii = rel.map(([x, y]) => Math.hypot(x - cx, y - cy))
  const mean = radii.reduce((s, r) => s + r, 0) / radii.length
  const variance = radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length
  const aspect = w / h
  if (Math.sqrt(variance) / mean < 0.16 && aspect > 0.65 && aspect < 1.55) {
    return { kind: 'circle', points: [], ...base }
  }

  // Rect: simplified outline has ~4 corners and fills its bbox.
  const simple = simplify([...rel, rel[0]], diag * 0.04)
  const corners = simple.length - 1
  if (corners >= 3 && corners <= 5) {
    // shoelace area vs bbox area
    let area = 0
    for (let i = 0; i < simple.length - 1; i++) {
      area += simple[i][0] * simple[i + 1][1] - simple[i + 1][0] * simple[i][1]
    }
    area = Math.abs(area) / 2
    if (corners === 4 && area / (w * h) > 0.75) {
      return { kind: 'rect', points: [], ...base }
    }
  }

  // Anything else closed is a polygon with a real collision mesh.
  const poly = simplify([...rel, rel[0]], Math.max(diag * 0.02, 3)).slice(0, -1)
  if (poly.length >= 3) {
    return { kind: 'polygon', points: poly, ...base }
  }
  return fallback
}
