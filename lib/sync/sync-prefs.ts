'use client'

// Global sync preferences — per-account category-level rules for which file
// types should sync across devices automatically, without requiring a manual
// per-page/per-file toggle.
//
// Three tiers of sync opt-in, any one saying "yes" is sufficient (OR'd):
//   1. Global category prefs (this module)
//   2. Folder-level toggle (FolderNode.syncEnabled in lib/scene/types.ts)
//   3. Individual page/file toggle (PageNode.syncEnabled, manifest syncEnabled)
//
// Default: everything OFF — identical to pre-feature behavior.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'
import type { PageKind } from '@/lib/scene/types'

export type SyncCategory = 'documents' | 'presentations' | 'spreadsheets' | 'images' | 'boards' | 'other'

export interface SyncPreferences {
  /** Master switch — OFF = no global category rules apply (default). */
  globalSync: boolean
  /** Per-category overrides — when globalSync is ON, which categories sync. */
  categories: Record<SyncCategory, boolean>
}

const DEFAULT_PREFS: SyncPreferences = {
  globalSync: false,
  categories: {
    documents: false,
    presentations: false,
    spreadsheets: false,
    images: false,
    boards: false,
    other: false,
  },
}

interface SyncPrefsState extends SyncPreferences {
  setSyncPrefs: (patch: Partial<SyncPreferences>) => void
  setCategoryEnabled: (cat: SyncCategory, enabled: boolean) => void
}

export const useSyncPrefsStore = create<SyncPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      setSyncPrefs: (patch) =>
        set((s) => ({
          ...s,
          ...patch,
          categories: patch.categories ? { ...s.categories, ...patch.categories } : s.categories,
        })),
      setCategoryEnabled: (cat, enabled) =>
        set((s) => ({
          categories: { ...s.categories, [cat]: enabled },
        })),
    }),
    { name: 'simblip-sync-prefs', storage: scopedJSONStorage }
  )
)

/** Classify a MIME type (and optional filename) into a sync category. Mirrors
 *  the logic in components/workspace/storage-panel.tsx's categoryOf(). */
export function categoryOfMime(mime: string, name = ''): SyncCategory {
  if (mime.startsWith('image/')) return 'images'
  if (mime.includes('spreadsheet') || /\.xlsx?$/i.test(name) || /\.csv$/i.test(name)) return 'spreadsheets'
  if (mime.includes('presentation') || /\.pptx?$/i.test(name)) return 'presentations'
  if (mime.includes('pdf') || mime.includes('document') || mime.startsWith('text/') || /\.docx?$|\.md$|\.txt$/i.test(name))
    return 'documents'
  return 'other'
}

/** Map a PageKind to a sync category. */
export function categoryOfPageKind(kind: PageKind | undefined): SyncCategory {
  switch (kind) {
    case 'pdf':
      return 'documents'
    case 'doc':
      return 'documents'
    case 'pptx':
      return 'presentations'
    case 'xlsx':
      return 'spreadsheets'
    case 'image':
      return 'images'
    case 'web':
      return 'other'
    case 'board':
    case undefined:
      return 'boards'
    default:
      return 'other'
  }
}

/** Should this page sync based on the global category prefs? Does NOT check
 *  the page's own syncEnabled or folder ancestry — callers OR those in. */
export function globalPrefAllowsPage(kind: PageKind | undefined): boolean {
  const { globalSync, categories } = useSyncPrefsStore.getState()
  if (!globalSync) return false
  return categories[categoryOfPageKind(kind)] === true
}

/** Should this file sync based on the global category prefs? Does NOT check
 *  the file's own syncEnabled — callers OR that in. */
export function globalPrefAllowsFile(mime: string, name = ''): boolean {
  const { globalSync, categories } = useSyncPrefsStore.getState()
  if (!globalSync) return false
  return categories[categoryOfMime(mime, name)] === true
}
