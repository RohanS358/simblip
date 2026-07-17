'use client'

// Renders one open page by its kind: infinite Board, paged Doc, or PDF/PPT
// reader. Shared by the desktop split panes and the mobile shell so every
// surface shows the same thing the same way.

import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { InfiniteCanvas } from './canvas'
import { DocView } from './doc-view'
import { PdfView } from './pdf-view'

export function PageView({ pageId }: { pageId: string }) {
  const kind = useWorkspaceStore((s) => findPageMeta(s.notebooks, pageId)?.kind ?? 'board')
  if (kind === 'doc') return <DocView pageId={pageId} />
  if (kind === 'pdf') return <PdfView pageId={pageId} />
  return <InfiniteCanvas key={pageId} pageId={pageId} />
}
