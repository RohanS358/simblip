'use client'

// Which bottom-tab destination is active, shared between MobileShell
// (Home/Notebooks live here) and any PageShell-based route (Assignments
// lives there) — so the same tab bar reads as one persistent piece of UI
// across a real page navigation, not two disconnected copies.

import { create } from 'zustand'

export type MobileTab = 'home' | 'notebooks' | 'assignments' | 'more'

export const useMobileTabStore = create<{ tab: MobileTab; setTab: (t: MobileTab) => void }>((set) => ({
  tab: 'home',
  setTab: (tab) => set({ tab }),
}))
