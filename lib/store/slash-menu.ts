'use client'

// Bridges a tap on the mobile/tablet toolbar's "Insert" button (toolbar.tsx)
// to the desktop slash-menu already living inside InfiniteCanvas
// (components/workspace/canvas.tsx) — same "written by one, read by
// another" shape as usePdfDockStore. A touch device has no physical "/" key,
// so this is just a request queue of one: "open the slash menu for this
// page," picked up by whichever mounted InfiniteCanvas instance is both
// active and matches the page.

import { create } from 'zustand'

interface SlashMenuRequest {
  pageId: string
  /** Distinguishes repeat requests for the SAME page — a state value alone
   *  wouldn't change (and therefore wouldn't re-fire an effect) if the user
   *  closes the menu and immediately taps the button again for that page. */
  token: number
}

interface SlashMenuStore {
  request: SlashMenuRequest | null
  open: (pageId: string) => void
  clear: () => void
}

export const useSlashMenuStore = create<SlashMenuStore>((set) => ({
  request: null,
  open: (pageId) => set({ request: { pageId, token: Date.now() } }),
  clear: () => set({ request: null }),
}))
