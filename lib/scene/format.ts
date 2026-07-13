'use client'

// One number formatter for every readout in the app — graph measurements,
// calculus values, force-tracer labels, variable values. Driven by the Math
// settings, so a class can dial precision and notation once and have every
// panel agree.

import { mathPrefs } from '@/lib/store/preferences'

/** Units that are ANGLES — the only channels affected by the deg/rad setting. */
const ANGLE_CHANNELS = new Set(['angle'])

export const CHANNEL_UNITS: Record<string, string> = {
  x: 'cm',
  y: 'cm',
  vx: 'cm/s',
  vy: 'cm/s',
  speed: 'cm/s',
  angle: 'rad',
  omega: 'rad/s',
  ke: 'J',
  temp: '°C',
  V: 'V',
  I: 'A',
  P: 'W',
  torque: 'N·m',
  level: '',
  value: '',
}

/** Format a bare number under the current Math settings. */
export function fmtNum(v: number): string {
  const p = mathPrefs()
  if (!Number.isFinite(v)) return '—'
  if (Math.abs(v) < p.zeroThreshold) return '0'

  const a = Math.abs(v)
  let out: string

  if (p.numberStyle === 'sci') {
    out = v.toExponential(p.precision)
  } else if (p.numberStyle === 'eng') {
    // Engineering notation: exponent locked to a multiple of 3.
    const exp3 = Math.floor(Math.log10(a) / 3) * 3
    out = `${(v / 10 ** exp3).toFixed(p.precision)}e${exp3}`
  } else if (p.numberStyle === 'auto' && (a >= 1e5 || a < 1e-3)) {
    out = v.toExponential(p.precision)
  } else {
    out = v.toFixed(p.precision)
    if (p.groupDigits) {
      const [i, f] = out.split('.')
      out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '')
    }
  }
  return out
}

/**
 * Format a value from a named channel: applies the deg/rad setting to angles
 * and appends the unit when Math settings ask for it.
 */
export function fmtChannel(channel: string, v: number): string {
  const p = mathPrefs()
  let value = v
  let unit = CHANNEL_UNITS[channel] ?? ''

  if (ANGLE_CHANNELS.has(channel) && p.angleUnit === 'deg') {
    value = (v * 180) / Math.PI
    unit = '°'
  }
  const text = fmtNum(value)
  return p.showUnits && unit ? `${text} ${unit}` : text
}
