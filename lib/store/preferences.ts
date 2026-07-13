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
}

export interface NotebookPrefs {
  scrollAxis: ScrollAxis
  grid: GridType
  /** Whole-UI scale: panels, docks, inspector. 1 = default. */
  uiScale: number
  dock: DockSide
}

interface PrefsState {
  pen: PenPrefs
  notebook: NotebookPrefs
  setPen: (p: Partial<PenPrefs>) => void
  setNotebook: (p: Partial<NotebookPrefs>) => void
  reset: () => void
}

export const DEFAULT_PEN: PenPrefs = {
  smoothing: 0.35, // was 0.55 — noticeably less mushy
  streamline: 0.28, // was 0.5 — the ink now keeps up with the hand
  sensitivity: 0.55,
  size: 5,
  color: 'var(--foreground)',
  style: 'ink',
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
      setPen: (p) => set((s) => ({ pen: { ...s.pen, ...p } })),
      setNotebook: (p) => set((s) => ({ notebook: { ...s.notebook, ...p } })),
      reset: () => set({ pen: { ...DEFAULT_PEN }, notebook: { ...DEFAULT_NOTEBOOK } }),
    }),
    { name: 'simblip-preferences' } // device-wide, not per user
  )
)

/** Non-reactive read for hot paths (the ink renderer runs per pointer event). */
export const penPrefs = (): PenPrefs => usePrefs.getState().pen
