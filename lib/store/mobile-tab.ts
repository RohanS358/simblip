'use client'

// Which bottom-tab destination is active — Home, Notebooks, Assignments,
// Shared, and More all live in-place inside MobileShell now; this store
// just tracks which one is showing.
//
// Persisted so reopening the app lands where you left it rather than always
// resetting to Home. MobileShell's own `view` (the drill-down stack: folder
// → editor) persists alongside it in the same key — the two are read
// together on mount, since the tab-change effect there resets `view` to that
// tab's root and would otherwise immediately undo a restored view.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'

export type MobileTab = 'home' | 'notebooks' | 'assignments' | 'shared' | 'more'

/** The drill-down position inside the active tab. Mirrors MobileShell's own
 *  `View` type; kept here so it persists next to the tab it belongs to. */
export type MobileView =
  | { kind: 'home' }
  | { kind: 'notebook'; id: string }
  | { kind: 'folder'; id: string }
  | { kind: 'assignments' }
  | { kind: 'editor' }

export const useMobileTabStore = create<{
  tab: MobileTab
  setTab: (t: MobileTab) => void
  /** Last drill-down position, written by MobileShell on every navigation. */
  view: MobileView
  setView: (v: MobileView) => void
  /** False until the persisted value has been read back. MobileShell waits
   *  for this before restoring, so the first paint doesn't flash Home and
   *  then jump — and so the tab-change effect can tell "the user just tapped
   *  a tab" from "we're rehydrating". */
  hydrated: boolean
}>()(
  persist(
    (set) => ({
      tab: 'home',
      setTab: (tab) => set({ tab }),
      view: { kind: 'home' },
      setView: (view) => set({ view }),
      hydrated: false,
    }),
    {
      name: 'simblip-mobile-tab',
      // Per-user, like every other notebook store: several accounts can share
      // one machine (teacher, student, a room board), and restoring the
      // previous user's open page after a switch would be a privacy leak, not
      // a convenience. Also means rehydrateUserStores() below re-reads it at
      // login rather than leaving the pre-login default in place.
      storage: scopedJSONStorage,
      // `hydrated` is a runtime flag about this session, never a stored value.
      partialize: ({ tab, view }) => ({ tab, view }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true
      },
    }
  )
)
