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
export type PenStyle = 'ink' | 'marker' | 'highlighter' | 'technical'

export interface PenPrefs {
  /** perfect-freehand `smoothing`: how much the outline is rounded. */
  smoothing: number
  /** perfect-freehand `streamline`: how much the input is lagged/averaged.
   *  This is the one that makes writing feel "sticky" when it's too high. */
  streamline: number
  /** How strongly width follows pressure/velocity (perfect-freehand thinning). */
  sensitivity: number
  size: number
  color: string
  style: PenStyle
  /** Scribble-to-erase: 0 = must scribble hard and long before anything is
   *  deleted, 1 = a light scratch is enough. Higher is easier to trigger. */
  scribbleSensitivity: number
}

export interface NotebookPrefs {
  scrollAxis: ScrollAxis
  grid: GridType
  /** Whole-UI scale: panels, docks, inspector. 1 = default. */
  uiScale: number
  dock: DockSide
}

/** How the whole UI moves. See lib/motion.ts. */
export type MotionStyle = 'bouncy' | 'smooth' | 'none'

export interface AppearancePrefs {
  motion: MotionStyle
  /** Touch devices: lift the selected object out of the canvas while its
   *  properties are open, so you can see what your edits do to it. */
  focusOnEdit: boolean
}

export const DEFAULT_APPEARANCE: AppearancePrefs = { motion: 'bouncy', focusOnEdit: true }

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
  size: 5,
  color: 'var(--foreground)',
  style: 'ink',
  scribbleSensitivity: 0.5,
}

export const DEFAULT_NOTEBOOK: NotebookPrefs = {
  scrollAxis: 'free',
  grid: 'dots',
  uiScale: 1,
  dock: 'bottom',
}

/** Per-style overrides applied on top of the sliders. */
export const PEN_STYLES: Record<PenStyle, { label: string; opacity: number; taper: boolean }> = {
  ink: { label: 'Ink', opacity: 1, taper: true },
  marker: { label: 'Marker', opacity: 1, taper: false },
  highlighter: { label: 'Highlighter', opacity: 0.35, taper: false },
  technical: { label: 'Technical', opacity: 1, taper: false },
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
      setPen: (p) => set((s) => ({ pen: { ...s.pen, ...p } })),
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
    { name: 'simblip-preferences' } // device-wide, not per user
  )
)

/** Non-reactive reads for hot paths (these run per pointer event / per frame). */
export const penPrefs = (): PenPrefs => usePrefs.getState().pen
export const mathPrefs = (): MathPrefs => usePrefs.getState().math
