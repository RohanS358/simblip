'use client'

// The one shared taxonomy behind the left rail — desktop's collapsed icon
// strip, tablet's rail-triggered sheet, and phone's grouped drawer all read
// from this same list, so "Notebook / Components / Tools / Library /
// Properties" is one concept a user learns once, not three different menus
// that happen to cover similar ground (see docs/ui-simplification-plan.md
// §4/§6). Properties joined the rail when the right-side Inspector dock
// retired — one panel system, one home.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BookOpen, BrainCircuit, FolderUp, LibraryBig, Shapes, SlidersHorizontal, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useWorkspaceStore } from '@/lib/store/workspace'

export type SidebarSectionId = 'notebook' | 'assistant' | 'components' | 'tools' | 'uploads' | 'library' | 'properties'

export interface SidebarSectionMeta {
  id: SidebarSectionId
  label: string
  icon: LucideIcon
}

export const SIDEBAR_SECTIONS: SidebarSectionMeta[] = [
  { id: 'notebook', label: 'Notebook', icon: BookOpen },
  // Second, right after Notebook: describing a scene is a primary way to
  // work here, not an accessory tucked at the bottom.
  { id: 'assistant', label: 'Assistant', icon: BrainCircuit },
  { id: 'components', label: 'Components', icon: Shapes },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'uploads', label: 'Uploads', icon: FolderUp },
  { id: 'library', label: 'Library', icon: LibraryBig },
  { id: 'properties', label: 'Properties', icon: SlidersHorizontal },
]

/** Which section the open pane shows — shared state (not Sidebar-local) so
 *  actions elsewhere (the dock's Properties action, the context menu) can
 *  land the user on a specific section. */
export const useSidebarSection = create<{
  section: SidebarSectionId
  setSection: (id: SidebarSectionId) => void
}>()(
  persist(
    (set) => ({
      section: 'notebook',
      setSection: (id) => set({ section: id }),
    }),
    { name: 'simblip-sidebar-section-v2' }
  )
)

/** Open the Properties surface, wherever it lives on this device: the left
 *  panel's Properties section on desktop/tablet, the dedicated inspector
 *  drawer on a phone. */
export function openProperties() {
  if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
    const ws = useWorkspaceStore.getState()
    if (!ws.inspectorOpen) ws.togglePanel('inspector')
    return
  }
  useSidebarSection.getState().setSection('properties')
  useWorkspaceStore.setState({ sidebarOpen: true })
}
