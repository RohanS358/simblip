// Where each class's pins fall, as fractions of the drawn symbol's bounding
// box, measured from real glyph output. scripts/ai/sketch/calibrate-pins.mjs
// writes the result into lib/sketch/pins.ts; pins.test checks the two agree, so
// editing a glyph without re-running the script fails a test instead of silently
// mis-wiring circuits.

import { GLYPHS, PIN_FRAME } from './glyphs'
import { makeRng } from './rng'
import { WAVE1_CLASSES, type Wave1Class } from './classes'

const clamp = (x: number) => +Math.min(1, Math.max(0, x)).toFixed(3)

export function measurePins(samples = 60): Record<Wave1Class, Array<{ name: string; u: number; v: number }>> {
  const out = {} as Record<Wave1Class, Array<{ name: string; u: number; v: number }>>
  for (const cls of WAVE1_CLASSES) {
    const acc = PIN_FRAME[cls].map(() => [0, 0])
    for (let i = 0; i < samples; i++) {
      const g = GLYPHS[cls](makeRng(9000 + i))
      const pts = g.strokes.flatMap((s) => s.pts)
      const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]))
      const y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]))
      PIN_FRAME[cls].forEach((pin, k) => {
        acc[k][0] += (pin.x - x0) / Math.max(x1 - x0, 1e-6)
        acc[k][1] += (pin.y - y0) / Math.max(y1 - y0, 1e-6)
      })
    }
    out[cls] = PIN_FRAME[cls].map((pin, k) => ({ name: pin.name, u: clamp(acc[k][0] / samples), v: clamp(acc[k][1] / samples) }))
  }
  return out
}
