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

/** Chaikin corner-cutting — each pass replaces every corner with two points
 *  at 1/4 and 3/4 of its edges, turning a jittery polyline silky. */
function chaikin(points: number[][], iterations: number, closed: boolean): number[][] {
  let pts = points
  for (let it = 0; it < iterations; it++) {
    const out: number[][] = []
    const n = pts.length
    if (!closed) out.push(pts[0])
    const last = closed ? n : n - 1
    for (let i = 0; i < last; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    if (!closed) out.push(pts[n - 1])
    pts = out
  }
  return pts
}

/** Snap each segment of an open polyline to the nearest 15° while keeping
 *  its length — a rough Z becomes crisp, near-axis lines go truly straight. */
function snapAngles(corners: number[][]): number[][] {
  const out: number[][] = [corners[0]]
  for (let i = 1; i < corners.length; i++) {
    const [px, py] = out[i - 1]
    const dx = corners[i][0] - corners[i - 1][0]
    const dy = corners[i][1] - corners[i - 1][1]
    const len = Math.hypot(dx, dy)
    const step = Math.PI / 12
    const ang = Math.round(Math.atan2(dy, dx) / step) * step
    out.push([px + Math.cos(ang) * len, py + Math.sin(ang) * len])
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

/** How far a point run bows away from its chord, relative to chord length. */
function segmentDeviation(points: number[][]): { dev: number; chord: number } {
  const [sx, sy] = points[0]
  const [ex, ey] = points[points.length - 1]
  const chord = Math.hypot(ex - sx, ey - sy) || 1
  let dev = 0
  for (const [x, y] of points) {
    const d = Math.abs((ey - sy) * x - (ex - sx) * y + ex * sy - ey * sx) / chord
    if (d > dev) dev = d
  }
  return { dev, chord }
}

/** The Shaper tool: whatever is drawn comes out cleaned up — PER SEGMENT.
 *  Corners split the stroke; each piece that hugs its chord becomes a truly
 *  straight edge, each piece that bows away keeps its curve but loses the
 *  jitter. So a "D" gets one straight side and one smooth arc, a rough
 *  triangle gets three straight edges, a hyperbola just flows. Circles and
 *  rects still snap perfect. Unlike the pen, this ALWAYS upgrades. */
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
  const corners = rdpIndices(pts, 0, pts.length - 1, diag * 0.05)

  let allStraight = true
  const out: number[][] = [pts[corners[0]]]
  for (let c = 0; c < corners.length - 1; c++) {
    const seg = pts.slice(corners[c], corners[c + 1] + 1)
    const { dev, chord } = segmentDeviation(seg)
    if (dev < Math.max(chord * 0.05, 4) || seg.length < 4) {
      // Hugs the chord → a perfectly straight edge.
      out.push(seg[seg.length - 1])
    } else {
      // Bows away → keep the curve, lose the wobble. Chaikin preserves the
      // segment's endpoints, so straight and curved pieces stay connected.
      allStraight = false
      const light = simplify(seg, Math.max(diag * 0.012, 2))
      out.push(...chaikin(light, 2, false).slice(1))
    }
  }

  if (closed) {
    // Drop the duplicated closing point; polygon geometry closes itself.
    return { kind: 'polygon', points: out.slice(0, -1), ...base }
  }
  // A pure polyline additionally snaps its edges to 15° steps (crisp Z's);
  // anything containing a curve keeps its exact corner positions.
  return { kind: 'stroke', points: allStraight ? snapAngles(out) : out, ...base }
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
