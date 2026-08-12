// Shared connector drawing: the same path generator renders a spring in edit
// mode and while its endpoints are being dragged around by the physics world.

export function connectorPath(
  render: string | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux

  if (render === 'spring') {
    const coils = Math.max(6, Math.min(14, Math.round(len / 22)))
    const lead = Math.min(14, len * 0.12)
    const amp = 9
    let d = `M ${x1} ${y1} L ${x1 + ux * lead} ${y1 + uy * lead}`
    const innerLen = len - lead * 2
    for (let i = 0; i < coils; i++) {
      const t0 = lead + (innerLen * (i + 0.5)) / coils
      const side = i % 2 === 0 ? 1 : -1
      d += ` L ${x1 + ux * t0 + px * amp * side} ${y1 + uy * t0 + py * amp * side}`
    }
    d += ` L ${x1 + ux * (len - lead)} ${y1 + uy * (len - lead)} L ${x2} ${y2}`
    return d
  }

  if (render === 'damper') {
    const mid = len / 2
    const box = Math.min(26, len * 0.3)
    const amp = 8
    const a = (t: number) => `${x1 + ux * t} ${y1 + uy * t}`
    const o = (t: number, s: number) => `${x1 + ux * t + px * amp * s} ${y1 + uy * t + py * amp * s}`
    return (
      `M ${a(0)} L ${a(mid - box / 2)}` +
      ` M ${o(mid - box / 2, 1)} L ${o(mid - box / 2, -1)}` + // piston plate
      ` M ${o(mid + box / 2, 1)} L ${o(mid - box / 2, 1)} M ${o(mid + box / 2, -1)} L ${o(mid - box / 2, -1)}` + // cylinder
      ` M ${a(mid + box / 2)} L ${a(len)}`
    )
  }

  if (render === 'rope') {
    // gentle sag perpendicular to the chord
    const sag = Math.min(18, len * 0.08)
    return `M ${x1} ${y1} Q ${x1 + dx / 2 + px * sag} ${y1 + dy / 2 + py * sag} ${x2} ${y2}`
  }

  if (render === 'wire') {
    // Manhattan routing (L-shape): Horizontal first, then vertical
    return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`
  }

  return `M ${x1} ${y1} L ${x2} ${y2}`
}

/** Single source of truth for the connector's full point list (endpoints +
 *  bends, with the default-corner fallback when there are no stored bends).
 *  `connectorElbowPath`, geometry.tsx's hit-strips, and canvas.tsx's drag
 *  handler all consume this so the corner rule can never drift between them.
 *  Callers must pass `a`/`bends`/`b` all in the SAME coordinate space —
 *  object-local everywhere in this codebase (metadata.bends is local). */
export function connectorPoints(a: number[], bends: number[][], b: number[]): number[][] {
  const mid = bends.length > 0 ? bends : [[b[0], a[1]]]
  return [a, ...mid, b]
}

/**
 * Re-fit a connector's bends after one of its endpoints moved.
 *
 * Bends are stored object-LOCAL, so when an anchored endpoint moves the
 * connector's bounding box (and therefore its origin) changes and every bend
 * has to be rebased by the same delta, or it silently drifts. Rebasing alone
 * isn't enough though: a bend that was a right angle for the OLD endpoint
 * leaves a diagonal segment once the endpoint moves, which is what made
 * connectors "straighten" on drag.
 *
 * So each bend is also snapped back onto the orthogonal grid implied by its
 * neighbours — a bend that shared an axis with the endpoint keeps sharing it.
 * The result stays H/V-only for the common one- and two-bend routes the
 * connector tool produces, and never invents bends the user didn't draw.
 *
 * All arguments and the result are in the connector's LOCAL space.
 */
export function refitBends(a: number[], bends: number[][], b: number[]): number[][] {
  if (bends.length === 0) return bends

  const out = bends.map((p) => [p[0], p[1]])
  // Walk the chain, keeping each joint square with the point before it. The
  // segment INTO a bend alternates axis with the segment out of it, so fixing
  // one coordinate per bend is enough to keep every segment axis-aligned.
  for (let i = 0; i < out.length; i++) {
    const prev = i === 0 ? a : out[i - 1]
    const next = i === out.length - 1 ? b : out[i + 1]
    // Which axis did this bend turn on originally? Preserve that choice, so a
    // route the user shaped as "along x, then y" still reads that way.
    const wasVerticalIn = Math.abs(bends[i][0] - (i === 0 ? a[0] : bends[i - 1][0])) < 0.5
    if (wasVerticalIn) {
      // Came in vertically → share x with the previous point, y with the next.
      out[i][0] = prev[0]
      out[i][1] = next[1]
    } else {
      // Came in horizontally → share y with the previous point, x with the next.
      out[i][1] = prev[1]
      out[i][0] = next[0]
    }
  }
  return out
}

/** Orthogonal elbow path for the connector tool: draws through every
 *  stored bend point in order. Empty bends = same L-shape as 'wire'. */
export function connectorElbowPath(
  x1: number,
  y1: number,
  bends: number[][],
  x2: number,
  y2: number
): string {
  const pts = connectorPoints([x1, y1], bends, [x2, y2])
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
}
