// Ink engine: raw pointer points → a filled variable-width outline path.
//
// Hand-rolled (perfect-freehand removed — its render-time streamline lag,
// taper-at-the-live-tip trap and pressure-sim convergence were the "cooked"
// feel). The pipeline is four small deterministic stages, so live ink and
// committed ink are always pixel-identical:
//
//   1. stabilise — exponential follow ("stability"): the ink trails the
//      pointer like a pulled string, eating hand jitter. The final point is
//      always snapped back to the true pointer position, so the tip never
//      feels laggy while writing and the stroke ends where the pen lifted.
//   2. resample  — uniform spacing along the path, scaled to the stroke's
//      own length, so outline quality doesn't depend on pointer event rate,
//      writing speed or zoom level.
//   3. smooth    — 1-2-1 binomial passes over positions and pressure
//      ("smoothness"): rounds the outline without dragging the ink.
//   4. outline   — per-point radius from pressure ("sensitivity"), offset
//      left/right along the normals, round end caps, closed
//      midpoint-quadratic loop.
//
// Pressure is normalised so 0.5 = exactly the configured thickness. A mouse
// or finger (canvas.tsx records them flat at 0.5) therefore always draws at
// full thickness no matter the sensitivity setting — real stylus pressure
// widens/narrows around it. That invariant is what keeps the pen from
// collapsing to a hairline or ballooning on non-stylus input.
//
// Points are stored as [x, y, pressure?] — physics, recognition and circuit
// code all read only [0]/[1], so the third element rides along untouched.

import { penPrefs } from '@/lib/store/preferences'

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Segments per round end cap — enough that the quadratic loop reads as a circle. */
const CAP_STEPS = 7
/** Resample budget: very long strokes widen their spacing instead of exploding. */
const MAX_POINTS = 2048

/** A perfect circle for taps (the dot on an "i"). */
function dotPath(x: number, y: number, r: number): string {
  return `M ${(x - r).toFixed(2)} ${y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(x + r).toFixed(2)} ${y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(x - r).toFixed(2)} ${y.toFixed(2)} Z`
}

export function inkPath(
  points: number[][],
  opts: {
    size?: number
    thinning?: number
    smoothing?: number
    streamline?: number
    /** Kept for API compatibility. The outline is cap-stable — the live tip
     *  renders exactly like a finished stroke — so `last` no longer changes
     *  the geometry (the old renderer needed it to dodge taper artifacts). */
    last?: boolean
    dotSize?: number
  } = {}
): string {
  if (!points || points.length === 0) return ''
  const pen = penPrefs()
  const size = clamp(opts.size ?? pen.size, 0.1, 64)
  const thinning = clamp(opts.thinning ?? pen.sensitivity, 0, 1)
  const smoothing = clamp(opts.smoothing ?? pen.smoothing, 0, 1)
  const streamline = clamp(opts.streamline ?? pen.streamline, 0, 0.95)

  // ── sanitise ──────────────────────────────────────────────────────────
  // Drop non-finite points outright; missing/zero pressure reads as the
  // neutral 0.5 (full thickness) rather than "no pressure at all".
  const xs: number[] = []
  const ys: number[] = []
  const ps: number[] = []
  for (const pt of points) {
    const x = pt[0]
    const y = pt[1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const p = pt.length > 2 && Number.isFinite(pt[2]) && pt[2] > 0 ? clamp(pt[2], 0.05, 1) : 0.5
    xs.push(x)
    ys.push(y)
    ps.push(p)
  }
  if (xs.length === 0) return ''

  let rawLen = 0
  for (let i = 1; i < xs.length; i++) rawLen += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])

  // A tap — or a stroke shorter than its own width — is a dot.
  if (xs.length < 2 || rawLen < Math.max(1, size * 0.25)) {
    return dotPath(xs[0], ys[0], (size * (opts.dotSize ?? pen.dotSize ?? 1)) / 2)
  }

  // ── 1. stabilise ──────────────────────────────────────────────────────
  // Exponential follow toward each input point. 0.85 caps the drag so even
  // maximum stability can never freeze the ink entirely.
  const tipX = xs[xs.length - 1]
  const tipY = ys[ys.length - 1]
  const tipP = ps[ps.length - 1]
  if (streamline > 0) {
    const follow = 1 - streamline * 0.85
    let sx = xs[0]
    let sy = ys[0]
    for (let i = 1; i < xs.length; i++) {
      sx += (xs[i] - sx) * follow
      sy += (ys[i] - sy) * follow
      xs[i] = sx
      ys[i] = sy
    }
    // Glue the tip back to the real pointer: no perceived lag while writing,
    // and committed strokes end exactly where the pen lifted.
    if (Math.hypot(tipX - xs[xs.length - 1], tipY - ys[ys.length - 1]) > 0.01) {
      xs.push(tipX)
      ys.push(tipY)
      ps.push(tipP)
    }
  }

  // ── 2. resample ───────────────────────────────────────────────────────
  let total = 0
  for (let i = 1; i < xs.length; i++) total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
  const spacing = clamp(Math.max(total / MAX_POINTS, size * 0.15), 0.3, 6)
  const rx: number[] = [xs[0]]
  const ry: number[] = [ys[0]]
  const rp: number[] = [ps[0]]
  let need = spacing
  let ax = xs[0]
  let ay = ys[0]
  let ap = ps[0]
  for (let i = 1; i < xs.length; i++) {
    const bx = xs[i]
    const by = ys[i]
    const bp = ps[i]
    let seg = Math.hypot(bx - ax, by - ay)
    while (seg >= need && seg > 1e-6) {
      const t = need / seg
      ax += (bx - ax) * t
      ay += (by - ay) * t
      ap += (bp - ap) * t
      rx.push(ax)
      ry.push(ay)
      rp.push(ap)
      seg = Math.hypot(bx - ax, by - ay)
      need = spacing
    }
    need -= seg
    ax = bx
    ay = by
    ap = bp
  }
  // The true endpoint always survives resampling.
  if (Math.hypot(ax - rx[rx.length - 1], ay - ry[ry.length - 1]) > 0.01) {
    rx.push(ax)
    ry.push(ay)
    rp.push(ap)
  }
  const n = rx.length
  if (n < 2) return dotPath(rx[0], ry[0], (size * (opts.dotSize ?? pen.dotSize ?? 1)) / 2)

  // ── 3. smooth ─────────────────────────────────────────────────────────
  // Binomial 1-2-1 passes with pinned endpoints. Because the points are
  // already uniformly spaced this rounds corners evenly instead of chewing
  // through fast strokes harder than slow ones.
  const passes = Math.round(smoothing * 4)
  for (let pass = 0; pass < passes; pass++) {
    let px = rx[0]
    let py = ry[0]
    let pp = rp[0]
    for (let i = 1; i < n - 1; i++) {
      const cx = rx[i]
      const cy = ry[i]
      const cp = rp[i]
      rx[i] = (px + 2 * cx + rx[i + 1]) * 0.25
      ry[i] = (py + 2 * cy + ry[i + 1]) * 0.25
      rp[i] = (pp + 2 * cp + rp[i + 1]) * 0.25
      px = cx
      py = cy
      pp = cp
    }
  }

  // ── 4. outline ────────────────────────────────────────────────────────
  // Radius per point: pressure 0.5 → exactly size/2; thinning scales the
  // swing around it. Floor at 6% so heavy thinning yields a hairline, never
  // a vanishing or inverted outline.
  const rr = new Array<number>(n)
  const minR = size * 0.06
  for (let i = 0; i < n; i++) {
    rr[i] = Math.max(minR, (size / 2) * (1 - thinning + thinning * 2 * rp[i]))
  }

  const left = new Array<number>(n * 2)
  const right = new Array<number>(n * 2)
  let tx = 1
  let ty = 0
  let t0x = 1
  let t0y = 0
  for (let i = 0; i < n; i++) {
    const dx = rx[Math.min(n - 1, i + 1)] - rx[Math.max(0, i - 1)]
    const dy = ry[Math.min(n - 1, i + 1)] - ry[Math.max(0, i - 1)]
    const d = Math.hypot(dx, dy)
    if (d > 1e-6) {
      tx = dx / d
      ty = dy / d
    } // else: reuse the previous tangent — never a NaN normal
    if (i === 0) {
      t0x = tx
      t0y = ty
    }
    const nx = -ty
    const ny = tx
    const r = rr[i]
    left[i * 2] = rx[i] + nx * r
    left[i * 2 + 1] = ry[i] + ny * r
    right[i * 2] = rx[i] - nx * r
    right[i * 2 + 1] = ry[i] - ny * r
  }

  // Contour: left side forward → round end cap → right side backward →
  // round start cap. Filled with the default nonzero rule, so the sharp-fold
  // self-intersections of an offset outline stay invisible.
  const contour: number[] = []
  for (let i = 0; i < n * 2; i++) contour.push(left[i])
  const enx = -ty
  const eny = tx
  const er = rr[n - 1]
  for (let k = 1; k < CAP_STEPS; k++) {
    const a = (Math.PI * k) / CAP_STEPS
    const c = Math.cos(a)
    const s = Math.sin(a)
    contour.push(rx[n - 1] + (enx * c + tx * s) * er, ry[n - 1] + (eny * c + ty * s) * er)
  }
  for (let i = n - 1; i >= 0; i--) contour.push(right[i * 2], right[i * 2 + 1])
  const snx = -t0y
  const sny = t0x
  const sr = rr[0]
  for (let k = 1; k < CAP_STEPS; k++) {
    const a = (Math.PI * k) / CAP_STEPS
    const c = Math.cos(a)
    const s = Math.sin(a)
    contour.push(rx[0] + (-snx * c - t0x * s) * sr, ry[0] + (-sny * c - t0y * s) * sr)
  }

  // Closed midpoint-quadratic loop around the contour.
  const m = contour.length / 2
  let d = `M ${contour[0].toFixed(2)} ${contour[1].toFixed(2)} Q`
  for (let i = 0; i < m; i++) {
    const x0 = contour[i * 2]
    const y0 = contour[i * 2 + 1]
    const j = ((i + 1) % m) * 2
    d += ` ${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + contour[j]) / 2).toFixed(2)} ${((y0 + contour[j + 1]) / 2).toFixed(2)}`
  }
  return d + ' Z'
}
