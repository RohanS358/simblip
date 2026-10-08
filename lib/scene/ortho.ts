// Clean-up for Shift+pen orthogonal routes: pin the two ends to their snap
// targets without ever leaving a diagonal, and drop zero-length / collinear
// corners so the stored polyline is a minimal set of true 90° elbows.

export type P = [number, number]

const EPS = 0.01

/** Drop duplicate points, then merge collinear runs (axis-aligned input). */
export function simplifyOrtho(pts: P[]): P[] {
  const out: P[] = []
  for (const p of pts) {
    const l = out[out.length - 1]
    if (!l || Math.abs(l[0] - p[0]) > EPS || Math.abs(l[1] - p[1]) > EPS) out.push([p[0], p[1]])
  }
  for (let i = 1; i < out.length - 1; ) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]]
    const flat = (Math.abs(a[0] - b[0]) < EPS && Math.abs(b[0] - c[0]) < EPS) ||
      (Math.abs(a[1] - b[1]) < EPS && Math.abs(b[1] - c[1]) < EPS)
    if (flat) out.splice(i, 1)
    else i++
  }
  return out
}

/** Axis-lock `corners` (first segment's axis wins, then alternate), then move
 *  the ends onto `s` / `e` (snap targets, may be null) keeping every segment
 *  horizontal or vertical. */
export function finalizeOrtho(corners: P[], s: P | null, e: P | null): P[] {
  let pts = simplifyOrtho(corners)
  if (pts.length < 2) return pts
  // Force exact axis alignment (live routing can leave sub-pixel drift).
  let h = Math.abs(pts[1][0] - pts[0][0]) >= Math.abs(pts[1][1] - pts[0][1])
  for (let i = 1; i < pts.length; i++, h = !h) {
    if (h) pts[i][1] = pts[i - 1][1]
    else pts[i][0] = pts[i - 1][0]
  }
  const n = pts.length
  const firstH = Math.abs(pts[1][1] - pts[0][1]) < EPS
  const lastH = Math.abs(pts[n - 1][1] - pts[n - 2][1]) < EPS
  if (n === 2 && s && e) {
    // One straight run between two snapped ends: add an elbow if misaligned.
    const aligned = firstH ? Math.abs(s[1] - e[1]) < EPS : Math.abs(s[0] - e[0]) < EPS
    pts = aligned ? [s, e] : firstH ? [s, [e[0], s[1]], e] : [s, [s[0], e[1]], e]
  } else {
    if (s) {
      pts[0] = [s[0], s[1]]
      if (firstH) pts[1][1] = s[1]
      else pts[1][0] = s[0]
    }
    if (e) {
      pts[n - 1] = [e[0], e[1]]
      if (lastH) pts[n - 2][1] = e[1]
      else pts[n - 2][0] = e[0]
    }
  }
  return simplifyOrtho(pts)
}

/** Densify (~8px) so the ink renderer's smoothing hugs the straight runs. */
export function densify(pts: P[], pressure = 0.5): number[][] {
  const dense: number[][] = [[pts[0][0], pts[0][1], pressure]]
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8))
    for (let k = 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, pressure])
  }
  return dense
}
