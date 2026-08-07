'use client'

// Header tab strip — every open board/doc/PDF is a tab, browser-style.
// Click focuses, × closes, the split icon opens a tab beside the current one.
// Scrolls horizontally when crowded, so it degrades gracefully on tablets.

import { Columns2, FileText, Layout, BookOpen, Image as ImageIcon, Sheet, Presentation, X } from 'lucide-react'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import type { PageKind } from '@/lib/scene/types'
import { PageControlsMenu } from './page-controls-menu'
import { cn } from '@/lib/utils'

export const KIND_ICON: Record<PageKind, typeof Layout> = {
  board: Layout,
  doc: FileText,
  pdf: BookOpen,
  image: ImageIcon,
  xlsx: Sheet,
  pptx: Presentation,
}

export function TabsBar({
  pageId = null,
  showTransport = false,
}: {
  /** The focused content page — fed to the controls menu's Transport. */
  pageId?: string | null
  showTransport?: boolean
}) {
  const openTabs = useWorkspaceStore((s) => s.openTabs)
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  const splitPageId = useWorkspaceStore((s) => s.splitPageId)
  const nodes = useWorkspaceStore((s) => s.nodes)
  const setActivePage = useWorkspaceStore((s) => s.setActivePage)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const openSplit = useWorkspaceStore((s) => s.openSplit)
  const closeSplit = useWorkspaceStore((s) => s.closeSplit)

  // Pinned outside the scrollable tab strip so it never scrolls away with
  // the tabs — always reachable at the right edge.
  const controls = <PageControlsMenu pageId={pageId} showTransport={showTransport} />

  if (openTabs.length === 0)
    return (
      <div className="flex min-w-0 flex-1 items-center justify-end">
        {controls}
      </div>
    )

  return (
    <div className="relative flex min-w-0 flex-1 items-center overflow-hidden">
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 pr-3">
        {openTabs.map((id) => {
          const meta = findPageMeta(nodes, id)
          if (!meta) return null
          const Icon = KIND_ICON[meta.pageKind ?? 'board']
          const active = id === activePageId
          const inSplit = id === splitPageId
          return (
            <div
              key={id}
              // Obsidian-style snap assist: drag a tab over the canvas and drop
              // it on the left or right half to split. The shell renders the
              // drop zones (it owns the canvas area).
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-simblip-tab', id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              className={cn(
                'group flex max-w-44 shrink-0 cursor-grab items-center gap-1 rounded-lg px-2 py-1 text-[0.75rem] transition-colors',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5"
                title={meta.name}
                onClick={() => setActivePage(id)}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', inSplit && 'text-[var(--accent-blue)]')} />
                <span className="truncate">{meta.name}</span>
              </button>
              <button
                type="button"
                aria-label={inSplit ? 'Close split' : 'Open in split screen'}
                title={inSplit ? 'Close split' : 'Open in split screen'}
                className={cn(
                  'hidden rounded p-0.5 hover:bg-background/60 md:group-hover:block [@media(pointer:coarse)]:block',
                  inSplit ? 'block text-[var(--accent-blue)]' : 'text-muted-foreground'
                )}
                onClick={() => (inSplit ? closeSplit('primary') : openSplit(id))}
              >
                <Columns2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Close tab"
                className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-background/60 hover:text-foreground group-hover:opacity-100"
                onClick={() => closeTab(id)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>
      {controls && (
        <div className="relative z-10 flex shrink-0 items-center bg-background pl-1.5 shadow-[-12px_0_16px_-4px_rgba(0,0,0,0.12)] dark:shadow-[-12px_0_16px_-4px_rgba(0,0,0,0.5)] [clip-path:inset(0_0_0_-20px)]">
          {controls}
        </div>
      )}
    </div>
  )
}
