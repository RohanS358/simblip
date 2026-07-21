'use client'

// Published by Sidebar's phone bottom-bar variant (sidebar.tsx), read by
// CanvasControls so the drawing-tool dock can always clear it — whether the
// bar is just the rail (collapsed) or rail+open panel (expanded, taller).
// Same "written by one, read by another" shape as usePdfDockStore/
// useDockRect. Height is 0 whenever the phone bar isn't mounted (desktop,
// tablet), so readers don't need to separately check device/viewport.

import { create } from 'zustand'

interface MobileNavBarStore {
  height: number
  setHeight: (height: number) => void
}

export const useMobileNavBarStore = create<MobileNavBarStore>((set) => ({
  height: 0,
  setHeight: (height) => set({ height }),
}))
