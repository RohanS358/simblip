'use client'

// WebGL materials can't consume the design system's CSS custom properties
// (oklch(), color-mix()) the way SVG/DOM can — a THREE.Color needs a
// concrete RGB. Resolving through a hidden probe element lets the browser's
// own CSS engine do the oklch math instead of us reimplementing it, and it
// stays correct across theme changes for free.

import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import * as THREE from 'three'

let probe: HTMLSpanElement | null = null
function getProbe(): HTMLSpanElement | null {
  if (typeof document === 'undefined') return null
  if (!probe) {
    probe = document.createElement('span')
    probe.style.position = 'fixed'
    probe.style.opacity = '0'
    probe.style.pointerEvents = 'none'
    document.body.appendChild(probe)
  }
  return probe
}

/** Resolves any CSS color expression (var(--x), oklch(), color-mix()…) to a
 *  concrete THREE.Color via the browser's computed style. */
export function resolveThemeColor(cssColor: string, fallback = '#888888'): THREE.Color {
  const el = getProbe()
  if (!el) return new THREE.Color(fallback)
  el.style.color = cssColor
  const rgb = getComputedStyle(el).color
  const c = new THREE.Color()
  try {
    c.setStyle(rgb || fallback)
  } catch {
    c.set(fallback)
  }
  return c
}

const RAMP_STOPS = [15, 30, 45, 60, 80, 100]

/** Sequential light→dark ramp seeded from the design system's series-1 hue,
 *  receding toward the card surface at the low end (dataviz: "sequential =
 *  one hue, light→dark, lightest step recedes toward the surface"). Built
 *  from the same color-mix(in oklch, var(--hue) N%, var(--surface)) pattern
 *  already used for tinting in components/objects/geometry.tsx, so it tracks
 *  the app's own theme instead of a hardcoded palette. */
export function buildHeightRamp(hueVar = '--chart-1', surfaceVar = '--card'): THREE.Color[] {
  return RAMP_STOPS.map((pct) => resolveThemeColor(`color-mix(in oklch, var(${hueVar}) ${pct}%, var(${surfaceVar}))`))
}

/** Sample the ramp at t in [0,1] (e.g. a normalized height/magnitude). */
export function sampleHeightRamp(ramp: THREE.Color[], t: number): THREE.Color {
  if (ramp.length === 0) return new THREE.Color('#888888')
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  const pos = clamped * (ramp.length - 1)
  const i = Math.floor(pos)
  if (i >= ramp.length - 1) return ramp[ramp.length - 1]
  return ramp[i].clone().lerp(ramp[i + 1], pos - i)
}

/** Re-resolves the height ramp whenever the viewer's theme changes. */
export function useHeightRamp(hueVar = '--chart-1', surfaceVar = '--card'): THREE.Color[] {
  const { resolvedTheme } = useTheme()
  const [ramp, setRamp] = useState<THREE.Color[]>(() => buildHeightRamp(hueVar, surfaceVar))
  useEffect(() => setRamp(buildHeightRamp(hueVar, surfaceVar)), [hueVar, surfaceVar, resolvedTheme])
  return ramp
}

/** Re-resolves a single CSS color whenever the viewer's theme changes. */
export function useThemeColor(cssColor: string, fallback = '#888888'): THREE.Color {
  const { resolvedTheme } = useTheme()
  return useMemo(() => resolveThemeColor(cssColor, fallback), [cssColor, fallback, resolvedTheme])
}
