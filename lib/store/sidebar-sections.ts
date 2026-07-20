// The one shared taxonomy behind the left rail — desktop's collapsed icon
// strip, tablet's rail-triggered sheet, and phone's grouped drawer all read
// from this same list, so "Notebook / Components / Tools / Library" is one
// concept a user learns once, not three different menus that happen to
// cover similar ground (see docs/ui-simplification-plan.md §4/§6).

import { BookOpen, LibraryBig, Shapes, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SidebarSectionId = 'notebook' | 'components' | 'tools' | 'library'

export interface SidebarSectionMeta {
  id: SidebarSectionId
  label: string
  icon: LucideIcon
}

export const SIDEBAR_SECTIONS: SidebarSectionMeta[] = [
  { id: 'notebook', label: 'Notebook', icon: BookOpen },
  { id: 'components', label: 'Components', icon: Shapes },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'library', label: 'Library', icon: LibraryBig },
]
