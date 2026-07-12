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
import { setActivePage, stopPageCache } from '@/lib/store/page-cache'

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

  // Leaving the workspace entirely: stop sweeping.
  useEffect(() => stopPageCache, [])
}
