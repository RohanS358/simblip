'use client'

// Which bottom-tab destination is active — Home, Notebooks, Assignments,
// Shared, and More all live in-place inside MobileShell now; this store
// just tracks which one is showing.

import { create } from 'zustand'

export type MobileTab = 'home' | 'notebooks' | 'assignments' | 'shared' | 'more'

export const useMobileTabStore = create<{ tab: MobileTab; setTab: (t: MobileTab) => void }>((set) => ({
  tab: 'home',
  setTab: (tab) => set({ tab }),
}))
