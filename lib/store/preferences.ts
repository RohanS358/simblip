'use client'

// Editor preferences — pen feel and notebook layout.
//
// These belong to the DEVICE, not the account: how much smoothing your hand
// wants, which way you scroll, how big the UI should be. So they persist in
// plain localStorage (not the per-user scoped storage) and are shared by every
// account that signs in on this browser.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ScrollAxis = 'free' | 'vertical' | 'horizontal'
export type GridType = 'dots' | 'lines' | 'graph' | 'none'
export type DockSide = 'bottom' | 'top' | 'left' | 'right'
export type PenStyle = 'ink' | 'pen' | 'highlighter'

export interface PenPrefs {
  /** Smoothness: how much the finished outline is rounded (0 keeps every
   *  wobble, 1 gives clean flowing curves). */
  smoothing: number
  /** Stability: how much the ink trails the hand to steady it. The tip stays
   *  glued to the pointer (see components/objects/ink.ts), so high values
   *  steady the line without the old "sticky" lag. */
  streamline: number
  /** Sensitivity: how strongly width follows stylus pressure. Flat styles
   *  (pen, highlighter) ignore it entirely. */
  sensitivity: number
  size: number
  color: string
  style: PenStyle
  /** User-added colours, shown after the basic palette in pen settings. */
  customColors: string[]
  /** Scribble-to-erase: 0 = must scribble hard and long before anything is
   *  deleted, 1 = a light scratch is enough. Higher is easier to trigger. */
  scribbleSensitivity: number
  /** Multiplier for dot size when drawing a single point (a tap). */
  dotSize: number
}

export interface NotebookPrefs {
  scrollAxis: ScrollAxis
  grid: GridType
  /** Interface UI scale: panels, docks, inspector chrome. 1 = default. */
  uiScale: number
  /**
   * Components UI scale: text and chrome inside canvas objects (tables,
   * formulas, graphs, notes, labs, …) and the floating calculator. 1 = default.
   * Independent of canvas zoom and of Interface UI.
   */
  componentScale: number
  dock: DockSide
  /** Grid cell size in canvas pixels. Default 40. Range 16–80. */
  gridSize: number
  /** Disable double-tap-to-zoom on the canvas. */
  disableDoubleTapZoom: boolean
  /** Freeze the canvas zoom level so pinch/scroll cannot change it. */
  lockZoom: boolean
  /** Panel text size (docked panels only — the canvas keeps its own zoom). */
  panelFontScale: number
  /** Panel text spacing/airiness. 1 = default. */
  panelSpacing: number
}

/** How the whole UI moves. See lib/motion.ts. */
export type MotionStyle = 'bouncy' | 'smooth' | 'none'

/** UI tint — resolves to the matching --accent-* variable per theme. */
export type AccentName = 'blue' | 'violet' | 'mint' | 'amber' | 'rose'

export interface AppearancePrefs {
  motion: MotionStyle
  /** Touch devices: lift the selected object out of the canvas while its
   *  properties are open, so you can see what your edits do to it. */
  focusOnEdit: boolean
  /** The interface tint: selection, buttons, active states. */
  accent: AccentName
}

export const DEFAULT_APPEARANCE: AppearancePrefs = { motion: 'bouncy', focusOnEdit: true, accent: 'blue' }

export type AngleUnit = 'deg' | 'rad'
export type NumberStyle = 'auto' | 'fixed' | 'sci' | 'eng'

export interface MathPrefs {
  /** Digits after the decimal point in every readout. */
  precision: number
  /** auto = switch to exponent for very large/small; fixed = never; sci/eng = always. */
  numberStyle: NumberStyle
  /** Angles shown in degrees or radians (channels stay SI internally). */
  angleUnit: AngleUnit
  /** Show the unit next to every value (12.4 cm/s vs 12.4). */
  showUnits: boolean
  /** Thousands separators — nice for money, noisy for physics. */
  groupDigits: boolean
  /** Anything closer to zero than this reads as exactly 0, so a value that is
   *  really 1e-17 from floating-point error doesn't look like a signal. */
  zeroThreshold: number
}

interface PrefsState {
  pen: PenPrefs
  notebook: NotebookPrefs
  math: MathPrefs
  appearance: AppearancePrefs
  setPen: (p: Partial<PenPrefs>) => void
  setNotebook: (p: Partial<NotebookPrefs>) => void
  setMath: (p: Partial<MathPrefs>) => void
  setAppearance: (p: Partial<AppearancePrefs>) => void
  reset: () => void
}

export const DEFAULT_MATH: MathPrefs = {
  precision: 3,
  numberStyle: 'auto',
  angleUnit: 'deg',
  showUnits: true,
  groupDigits: false,
  zeroThreshold: 1e-9,
}

export const DEFAULT_PEN: PenPrefs = {
  smoothing: 0.35, // was 0.55 — noticeably less mushy
  streamline: 0.28, // was 0.5 — the ink now keeps up with the hand
  sensitivity: 0.55,
  size: 2.5, // a pen, not a marker
  color: 'var(--foreground)',
  style: 'ink',
  customColors: [],
  scribbleSensitivity: 0.5,
  dotSize: 2.0,
}

export const DEFAULT_NOTEBOOK: NotebookPrefs = {
  scrollAxis: 'free',
  grid: 'dots',
  uiScale: 1,
  componentScale: 1,
  dock: 'bottom',
  gridSize: 40,
  disableDoubleTapZoom: false,
  lockZoom: false,
  panelFontScale: 1,
  panelSpacing: 1,
}

/** Per-style overrides applied on top of the sliders. `pressure: false`
 *  means the stroke is drawn flat at the base thickness — the sensitivity
 *  slider only applies to pressure styles. (Old stored styles 'marker' and
 *  'technical' migrate to 'pen'; committed strokes carrying those names
 *  still render via the `?? 1` opacity fallbacks at the call sites.) */
export const PEN_STYLES: Record<PenStyle, { label: string; opacity: number; pressure: boolean }> = {
  ink: { label: 'Ink', opacity: 1, pressure: true },
  pen: { label: 'Pen', opacity: 1, pressure: false },
  highlighter: { label: 'Highlighter', opacity: 0.35, pressure: false },
}

export const PEN_COLORS = [
  'var(--foreground)',
  'var(--accent-blue)',
  'var(--accent-mint)',
  'var(--accent-amber)',
  'var(--accent-rose)',
  'var(--accent-violet)',
]

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      pen: { ...DEFAULT_PEN },
      notebook: { ...DEFAULT_NOTEBOOK },
      math: { ...DEFAULT_MATH },
      appearance: { ...DEFAULT_APPEARANCE },
      setPen: (p) =>
        set((s) => ({
          pen: {
            ...s.pen,
            ...p,
            // The thickness slider's full travel is 0.5–16 — clamp instead of
            // silently snapping back mid-drag.
            ...(p.size !== undefined ? { size: Math.min(16, Math.max(0.5, p.size)) } : {}),
          },
        })),
      setNotebook: (p) => set((s) => ({ notebook: { ...s.notebook, ...p } })),
      setMath: (p) => set((s) => ({ math: { ...s.math, ...p } })),
      setAppearance: (p) => set((s) => ({ appearance: { ...s.appearance, ...p } })),
      reset: () =>
        set({
          pen: { ...DEFAULT_PEN },
          notebook: { ...DEFAULT_NOTEBOOK },
          math: { ...DEFAULT_MATH },
          appearance: { ...DEFAULT_APPEARANCE },
        }),
    }),
    {
      name: 'simblip-preferences', // device-wide, not per user
      version: 2,
      // Sanitise whatever localStorage hands back: clamp every pen number
      // into its slider range (NaN/out-of-range values from older builds
      // made the ink renderer misbehave) and map retired styles onto the
      // current set.
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Record<string, unknown>
        const pen = (s.pen ?? {}) as Record<string, unknown>
        const num = (v: unknown, d: number, lo: number, hi: number) =>
          typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
        const style = pen.style as string
        s.pen = {
          ...DEFAULT_PEN,
          ...pen,
          smoothing: num(pen.smoothing, DEFAULT_PEN.smoothing, 0, 1),
          streamline: num(pen.streamline, DEFAULT_PEN.streamline, 0, 0.9),
          sensitivity: num(pen.sensitivity, DEFAULT_PEN.sensitivity, 0, 1),
          size: num(pen.size, DEFAULT_PEN.size, 0.5, 16),
          dotSize: num(pen.dotSize, DEFAULT_PEN.dotSize, 0.5, 5),
          scribbleSensitivity: num(pen.scribbleSensitivity, DEFAULT_PEN.scribbleSensitivity, 0, 1),
          style: style in PEN_STYLES ? style : style === 'marker' || style === 'technical' ? 'pen' : 'ink',
          color: typeof pen.color === 'string' ? pen.color : DEFAULT_PEN.color,
          customColors: Array.isArray(pen.customColors)
            ? pen.customColors.filter((c): c is string => typeof c === 'string').slice(0, 12)
            : [],
        }
        return s as unknown as PrefsState
      },
    }
  )
)

/** Non-reactive reads for hot paths (these run per pointer event / per frame). */
export const penPrefs = (): PenPrefs => usePrefs.getState().pen
export const mathPrefs = (): MathPrefs => usePrefs.getState().math
