'use client'

// Lazy page loading.
//
// Opening a page hydrates it from the archive; the page you left is NOT thrown
// away immediately — it lingers in memory so that switching back is instant,
// undo history and all. lib/store/page-cache.ts owns that policy: a 3-minute
// grace period, cut short the moment the tab is under memory or CPU pressure.
//
// Pages outside the notebook tree — a board session's temporary copy, say —
// are never touched, because those routes don't mount this hook.

import { useEffect } from 'react'
import { useDocStore } from '@/lib/store/document'
import { useRuntimeStore, stop } from '@/lib/physics/world'
import { setActivePage, setLivePages, stopPageCache } from '@/lib/store/page-cache'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'

export function useLazyActivePage(activePageId: string | null) {
  useEffect(() => {
    if (!activePageId) return

    // A simulation belongs to the page it was started on — leaving that page
    // must tear it down, or its rAF loop would keep writing transforms to
    // elements that no longer exist.
    if (useRuntimeStore.getState().mode !== 'edit') stop()

    useDocStore.getState().loadPage(activePageId) // from the archive, or fresh
    setActivePage(activePageId) // starts the previous page's grace clock
  }, [activePageId])

  // Everything visible beyond the active page — the split pane, a doc's
  // sheets, PDF note sheets — must be immune to cache eviction while shown.
  useEffect(() => {
    const compute = () => {
      const s = useWorkspaceStore.getState()
      const ids = new Set<string>()
      for (const pageId of [s.activePageId, s.primaryPageId, s.splitPageId]) {
        if (!pageId) continue
        ids.add(pageId)
        const meta = findPageMeta(s.notebooks, pageId)
        for (const sheet of meta?.docPages ?? []) ids.add(sheet)
        for (const note of meta?.notesPages ?? []) if (note) ids.add(note)
        // A PDF's on-page ink canvases are on screen the whole time the
        // reader is — evicting one mid-read blanks ink and text that was
        // just drawn (it survives in the archive, but the mounted canvas
        // never reloads it until refocused). They must be pinned too.
        for (const annot of meta?.annotPages ?? []) if (annot) ids.add(annot)
        if (meta?.notesDocId) ids.add(meta.notesDocId)
      }
      if (s.activeSheetId) ids.add(s.activeSheetId)
      setLivePages([...ids])
    }
    compute()
    return useWorkspaceStore.subscribe(compute)
  }, [])

  // Leaving the workspace entirely: stop sweeping.
  useEffect(() => stopPageCache, [])
}
