'use client'

// Header tab strip — every open board/doc/PDF is a tab, browser-style.
// Click focuses, × closes, the split icon adds the tab as a new pane (up to 4).
// Scrolls horizontally when crowded, so it degrades gracefully on tablets.

import { Columns2, FileText, Layout, BookOpen, Image as ImageIcon, Sheet, Presentation, Globe, X } from 'lucide-react'
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
  web: Globe,
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
  const panes = useWorkspaceStore((s) => s.panes)
  const nodes = useWorkspaceStore((s) => s.nodes)
  const setActivePage = useWorkspaceStore((s) => s.setActivePage)
  const closeTab = useWorkspaceStore((s) => s.closeTab)
  const addPane = useWorkspaceStore((s) => s.addPane)
  const removePane = useWorkspaceStore((s) => s.removePane)

  const paneCount = panes.length
  const atMaxPanes = paneCount >= 4

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
          // A tab is "in a pane" if it appears somewhere in the panes array.
          const paneIdx = panes.indexOf(id)
          const inPane = paneIdx !== -1
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
                  : 'bg-muted/60 text-muted-foreground hover:bg-accent/70 hover:text-foreground'
              )}
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-1.5"
                title={meta.name}
                onClick={() => setActivePage(id)}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', inPane && paneCount > 1 && 'text-[var(--accent-blue)]')} />
                <span className="truncate">{meta.name}</span>
              </button>
              {/* Add-to-pane button: opens this tab in a new split pane (up to 4).
                  Shows pane count badge when multiple panes are open.
                  Disabled (muted, no-op) when already at 4 panes. */}
              <button
                type="button"
                aria-label={
                  atMaxPanes
                    ? 'Maximum 4 panes open'
                    : inPane && paneCount > 1
                      ? `In pane ${paneIdx + 1} of ${paneCount} — close pane`
                      : 'Open in new pane'
                }
                title={
                  atMaxPanes
                    ? 'Maximum 4 panes'
                    : inPane && paneCount > 1
                      ? `Pane ${paneIdx + 1} — click to close`
                      : 'Open beside'
                }
                className={cn(
                  'hidden rounded p-0.5 hover:bg-background/60 md:group-hover:flex [@media(pointer:coarse)]:flex items-center gap-0.5',
                  inPane && paneCount > 1 ? 'flex text-[var(--accent-blue)]' : 'text-muted-foreground',
                  atMaxPanes && 'opacity-40 cursor-not-allowed'
                )}
                onClick={() => {
                  if (atMaxPanes) return
                  if (inPane && paneCount > 1) {
                    removePane(paneIdx)
                  } else {
                    addPane(id)
                  }
                }}
              >
                <Columns2 className="h-3 w-3" />
                {paneCount > 1 && inPane && (
                  <span className="text-[0.625rem] font-semibold leading-none">{paneIdx + 1}</span>
                )}
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
