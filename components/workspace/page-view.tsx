'use client'

// Renders one open page by its kind: infinite Board, paged Doc, or PDF/PPT
// reader. Shared by the desktop split panes and the mobile shell so every
// surface shows the same thing the same way.

import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { InfiniteCanvas } from './canvas'
import { DocView } from './doc-view'
import { PdfView } from './pdf-view'

export function PageView({ pageId }: { pageId: string }) {
  const kind = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId)?.pageKind ?? 'board')
  // Keyed by pageId like InfiniteCanvas below: without it, switching tabs
  // updates props on the SAME DocView/PdfView instance instead of
  // remounting — their scroll position and zoom (both plain useState, tied
  // to the DOM node/instance, not to pageId) would carry over from
  // whichever page was open before, landing the new page's content
  // somewhere off-screen instead of at its own default view.
  if (kind === 'doc') return <DocView key={pageId} pageId={pageId} />
  if (kind === 'pdf') return <PdfView key={pageId} pageId={pageId} />
  return <InfiniteCanvas key={pageId} pageId={pageId} />
}
