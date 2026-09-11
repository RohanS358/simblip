'use client'

// Renders one open page by its kind: infinite Board, paged Doc, PDF reader,
// image, spreadsheet, or presentation. Shared by the desktop split panes and
// the mobile shell so every surface shows the same thing the same way.

import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { InfiniteCanvas } from './canvas'
import { DocView } from './doc-view'
import { PdfView } from './pdf-view'
import { ImageView } from './image-view'
import { XlsxView } from './xlsx-view'
import { PresentationView } from './presentation-view'
import { WebView } from './web-view'
import { CourseView } from './course-view'

export function PageView({ pageId }: { pageId: string }) {
  const kind = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId)?.pageKind ?? 'board')
  if (kind === 'doc') return <DocView key={pageId} pageId={pageId} />
  if (kind === 'pdf') return <PdfView key={pageId} pageId={pageId} />
  if (kind === 'image') return <ImageView key={pageId} pageId={pageId} />
  if (kind === 'xlsx') return <XlsxView key={pageId} pageId={pageId} />
  if (kind === 'pptx') return <PresentationView key={pageId} pageId={pageId} />
  if (kind === 'web') return <WebView key={pageId} pageId={pageId} />
  if (kind === 'course') return <CourseView key={pageId} pageId={pageId} />
  return <InfiniteCanvas key={pageId} pageId={pageId} />
}

