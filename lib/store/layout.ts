'use client'

// Dock layout — which side each workspace panel lives on, whether panels
// sharing a side are merged into tabs or stacked as a split, and the split
// ratio. Device-level like preferences: persisted in plain localStorage.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PanelId = 'pages' | 'inspector'
export type Side = 'left' | 'right'

interface LayoutState {
  sides: Record<PanelId, Side>
  /** vertical order when two panels share a side */
  order: PanelId[]
  /** true = tabs (merged), false = stacked split */
  merged: boolean
  activeTab: PanelId
  /** height fraction of the first stacked panel */
  split: number
  moveSide: (id: PanelId, side: Side) => void
  toggleMerged: () => void
  setActiveTab: (id: PanelId) => void
  setSplit: (f: number) => void
  swapOrder: () => void
}

export const useLayout = create<LayoutState>()(
  persist(
    (set) => ({
      sides: { pages: 'left', inspector: 'right' },
      order: ['pages', 'inspector'],
      merged: false,
      activeTab: 'pages',
      split: 0.5,
      moveSide: (id, side) =>
        set((s) => ({ sides: { ...s.sides, [id]: side }, activeTab: id })),
      toggleMerged: () => set((s) => ({ merged: !s.merged })),
      setActiveTab: (id) => set({ activeTab: id }),
      setSplit: (f) => set({ split: Math.min(0.85, Math.max(0.15, f)) }),
      swapOrder: () => set((s) => ({ order: [...s.order].reverse() })),
    }),
    { name: 'simblip-layout' }
  )
)
