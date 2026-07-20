// Ink rendering: raw pointer points → a filled variable-width outline via
// perfect-freehand (the tldraw/Excalidraw approach). Width follows the
// pressure recorded per point directly — real hardware pressure when the
// device reports it, otherwise the flat value canvas.tsx records for
// mouse/touch. perfect-freehand's own velocity-based pressure simulation is
// intentionally left off: its running average takes 50-100px to converge,
// so short strokes never reach the configured thickness before you lift,
// and the flat end cap then reads as a sudden thick blob.
//
// Points are stored as [x, y, pressure?] — physics, recognition and circuit
// code all read only [0]/[1], so the third element rides along untouched.

import { getStroke } from 'perfect-freehand'
import { penPrefs } from '@/lib/store/preferences'

export function inkPath(
  points: number[][],
  opts: {
    size?: number
    thinning?: number
    smoothing?: number
    streamline?: number
    last?: boolean
    dotSize?: number
  } = {}
): string {
  if (points.length === 0) return ''
  // Feel comes from the user's pen settings. `streamline` is the one that
  // makes writing feel laggy when it's high — it averages the input, so the
  // ink trails the hand. Smoothing only rounds the finished outline.
  const pen = penPrefs()
  const size = opts.size ?? pen.size
  const outline = getStroke(points, {
    size: size,
    thinning: opts.thinning ?? pen.sensitivity,
    smoothing: opts.smoothing ?? pen.smoothing,
    streamline: opts.streamline ?? pen.streamline,
    simulatePressure: false,
    last: opts.last ?? true,
    // No taper regardless of style: a nonzero taper measures back from the
    // stroke's END, and while a stroke is still live (`last: false`) that
    // end is wherever the pen currently is — a moving target on every
    // pointermove. That traps the trailing ~30px behind your pen in a
    // permanent thin-to-a-point taper the whole time you're writing; it
    // only fills in once the geometry stops changing on pen-up. Flat caps
    // avoid that entirely, at the cost of `style.taper` not doing anything.
    start: { taper: 0 },
    end: { taper: 0 },
  })
  
  if (outline.length < 3) {
    if (points.length > 0) {
      const [x, y] = points[0]
      const r = (size * (opts.dotSize ?? pen.dotSize ?? 1)) / 2
      // Draw a perfect circle for a dot
      return `M ${x - r} ${y} A ${r} ${r} 0 1 0 ${x + r} ${y} A ${r} ${r} 0 1 0 ${x - r} ${y} Z`
    }
    return ''
  }
  
  // Closed midpoint-quadratic loop around the outline.
  let d = `M ${outline[0][0].toFixed(2)} ${outline[0][1].toFixed(2)} Q`
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    d += ` ${x0.toFixed(2)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)} ${((y0 + y1) / 2).toFixed(2)}`
  }
  return d + ' Z'
}
