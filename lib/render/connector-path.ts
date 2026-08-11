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

/** Orthogonal elbow path for the connector tool: draws through every
 *  stored bend point in order. Empty bends = same L-shape as 'wire'. */
export function connectorElbowPath(
  x1: number,
  y1: number,
  bends: number[][],
  x2: number,
  y2: number
): string {
  const pts = [[x1, y1], ...bends, [x2, y2]]
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ')
}
