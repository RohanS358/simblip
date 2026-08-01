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

// getComputedStyle resolves var()/color-mix() fine, but modern Chromium hands
// the result back in whatever CSS Color 4 function produced it — oklch(), for
// a design system built on oklch(). THREE.Color.setStyle only recognizes
// rgb/hsl/hex; anything else silently no-ops (a console warning, no throw),
// leaving the color at its default black. Every themed 3D color was quietly
// collapsing to black — bounce the resolved string through a 1×1 canvas
// instead: fillStyle accepts any CSS color the browser understands, and
// getImageData reads back the actual painted pixel, sidestepping string
// parsing entirely regardless of which color function was involved.
let swatchCtx: CanvasRenderingContext2D | null = null
function getSwatch(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!swatchCtx) {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    swatchCtx = canvas.getContext('2d', { willReadFrequently: true })
  }
  return swatchCtx
}

/** Resolves any CSS color expression (var(--x), oklch(), color-mix()…) to a
 *  concrete THREE.Color via the browser's computed style. */
export function resolveThemeColor(cssColor: string, fallback = '#888888'): THREE.Color {
  const el = getProbe()
  const ctx = getSwatch()
  const c = new THREE.Color()
  if (!el || !ctx) return c.set(fallback)
  el.style.color = cssColor
  const resolved = getComputedStyle(el).color
  try {
    ctx.fillStyle = resolved || fallback
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
  } catch {
    c.set(fallback)
  }
  return c
}

// ── Fixed app palette ───────────────────────────────────────────────────────
// Only these four colors are used anywhere in the 3D theming — deliberately
// hardcoded (not var(--chart-N)) so nothing else in the design system can
// pull the ramps off-palette. Ordered dark → light.
export const PALETTE = {
  deepViolet: '#321E48',
  slateBlue: '#43637E',
  teal: '#65DCD5',
  paleMint: '#D9FFF4',
} as const

const PALETTE_STOPS = [PALETTE.deepViolet, PALETTE.slateBlue, PALETTE.teal, PALETTE.paleMint]

/** Sample the ramp at t in [0,1] (e.g. a normalized height/magnitude). */
export function sampleHeightRamp(ramp: THREE.Color[], t: number): THREE.Color {
  if (ramp.length === 0) return new THREE.Color('#888888')
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  const pos = clamped * (ramp.length - 1)
  const i = Math.floor(pos)
  if (i >= ramp.length - 1) return ramp[ramp.length - 1]
  return ramp[i].clone().lerp(ramp[i + 1], pos - i)
}

/** Sequential low→high ramp built ONLY from the four fixed palette colors
 *  (deep violet → slate blue → teal → pale mint), finely subdivided via
 *  sampleHeightRamp so height fields still read smoothly. Replaces the old
 *  var(--chart-1)/var(--card) mix — nothing here depends on the app theme. */
export function buildHeightRamp(): THREE.Color[] {
  const base = PALETTE_STOPS.map((hex) => resolveThemeColor(hex))
  const STEPS = 6
  return Array.from({ length: STEPS }, (_, i) => sampleHeightRamp(base, i / (STEPS - 1)))
}

/** Re-resolves the height ramp whenever the viewer's theme changes. */
export function useHeightRamp(): THREE.Color[] {
  const { resolvedTheme } = useTheme()
  const [ramp, setRamp] = useState<THREE.Color[]>(() => buildHeightRamp())
  useEffect(() => setRamp(buildHeightRamp()), [resolvedTheme])
  return ramp
}

// Spectrum ramp — same four fixed colors, used as-is (no dilution toward
// --card) for surfaces that want the full violet → mint range directly.
const SPECTRUM_STOPS = PALETTE_STOPS

/** Low→high ramp across the full fixed palette (violet → blue → teal →
 *  mint) for surfaces where a single-hue ramp reads as flat/washed-out — a
 *  static height-field plot benefits from real color contrast to show
 *  curvature, the way buildHeightRamp's sequential-dataviz convention
 *  doesn't need to for a bars/lines chart. */
export function buildSpectrumRamp(): THREE.Color[] {
  return SPECTRUM_STOPS.map((v) => resolveThemeColor(v))
}

/** Re-resolves the spectrum ramp whenever the viewer's theme changes. */
export function useSpectrumRamp(): THREE.Color[] {
  const { resolvedTheme } = useTheme()
  const [ramp, setRamp] = useState<THREE.Color[]>(() => buildSpectrumRamp())
  useEffect(() => setRamp(buildSpectrumRamp()), [resolvedTheme])
  return ramp
}

/** Re-resolves a single CSS color whenever the viewer's theme changes. */
export function useThemeColor(cssColor: string, fallback = '#888888'): THREE.Color {
  const { resolvedTheme } = useTheme()
  return useMemo(() => resolveThemeColor(cssColor, fallback), [cssColor, fallback, resolvedTheme])
}