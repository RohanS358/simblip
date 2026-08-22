'use client'

// Global search & command palette (Ctrl/Cmd+K). Searches pages, notebooks,
// library assets AND the whole component palette — picking a component drops
// it straight onto the open page. Also exposes quick actions and role-aware
// navigation. The canvas "/" menu searches the same registry.

import { useNav } from '@/lib/use-nav'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ClipboardList,
  FileText,
  LibraryBig,
  Moon,
  NotebookPen,
  Plus,
  Settings,
  Shapes,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { isDarkTheme } from '@/components/theme-provider'
import { useWorkspaceStore, childrenOf, descendantsOf } from '@/lib/store/workspace'
import { searchInsertables, insertAt, viewportCenter } from '@/lib/scene/insertables'
import { useAuthStore } from '@/lib/auth/store'
import { listAssets } from '@/lib/data/library'
import { importPageDoc } from '@/lib/store/import-page'
import type { LibraryAssetRow } from '@/lib/data/types'
import type { PageDoc } from '@/lib/scene/types'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
  onOpenLibrary,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings?: () => void
  onOpenLibrary?: () => void
}) {
  const router = useNav()
  const { resolvedTheme, setTheme } = useTheme()
  const nodes = useWorkspaceStore((s) => s.nodes)
  const profile = useAuthStore((s) => s.profile)
  const [assets, setAssets] = useState<LibraryAssetRow[]>([])
  const [query, setQuery] = useState('')
  const activePageId = useWorkspaceStore((s) => s.activePageId)
  // Components only make sense with a page open to drop them onto.
  const components = useMemo(
    () => (activePageId ? searchInsertables(query, query.trim() ? 8 : 6) : []),
    [query, activePageId]
  )

  useEffect(() => {
    if (open) void listAssets().then(setAssets).catch(() => setAssets([]))
  }, [open])

  const pages = useMemo(
    () =>
      childrenOf(nodes, null).flatMap((nb) =>
        descendantsOf(nodes, nb.id)
          .filter((n) => n.kind === 'page')
          .map((p) => {
            // Breadcrumb of every ancestor folder's name, root notebook
            // first — works for arbitrary depth, not just notebook/section.
            const trail: string[] = []
            for (let cur = nodes[p.parentId ?? '']; cur; cur = nodes[cur.parentId ?? '']) trail.unshift(cur.name)
            return { ...p, path: trail.join(' / ') }
          })
      ),
    [nodes]
  )

  const run = useCallback(
    (fn: () => void) => {
      onOpenChange(false)
      fn()
    },
    [onOpenChange]
  )

  const isStaff = profile?.role === 'teacher' || profile?.role === 'admin'

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette" description="Search pages, assets and actions">
      <CommandInput
        placeholder="Search components, pages, library, actions…"
        aria-label="Search components, pages, library, actions"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {components.length > 0 && (
          <CommandGroup heading="Insert">
            {components.map((it) => (
              <CommandItem
                key={it.id}
                value={`insert ${it.label} ${it.group} ${it.keywords}`}
                onSelect={() =>
                  run(() => {
                    if (!activePageId) return
                    insertAt(activePageId, it, viewportCenter(activePageId))
                    router.push('/notebook')
                  })
                }
              >
                <Shapes className="h-4 w-4" />
                <span className="truncate">{it.label}</span>
                <span className="ml-auto text-ui-xs text-muted-foreground">{it.group}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {pages.length > 0 && (
          <CommandGroup heading="Pages">
            {pages.slice(0, 12).map((p) => (
              <CommandItem
                key={p.id}
                value={`page ${p.name} ${p.path}`}
                onSelect={() =>
                  run(() => {
                    useWorkspaceStore.getState().setActivePage(p.id)
                    router.push('/notebook')
                  })
                }
              >
                <FileText className="h-4 w-4" />
                <span className="truncate">{p.name}</span>
                <span className="ml-auto truncate text-ui-xs text-muted-foreground">{p.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {assets.length > 0 && (
          <CommandGroup heading="Library">
            {assets.slice(0, 8).map((a) => (
              <CommandItem
                key={a.id}
                value={`library ${a.title} ${a.category} ${a.tags.join(' ')}`}
                onSelect={() =>
                  run(() => {
                    if (a.kind === 'page') {
                      importPageDoc({
                        notebookName: 'Library imports',
                        notebookEmoji: '📚',
                        sectionName: a.category,
                        pageName: a.title,
                        content: a.content as PageDoc,
                        activate: true,
                      })
                      router.push('/notebook')
                    } else {
                      onOpenLibrary?.()
                    }
                  })
                }
              >
                <LibraryBig className="h-4 w-4" />
                <span className="truncate">{a.title}</span>
                <span className="ml-auto text-ui-xs text-muted-foreground">{a.category}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="new notebook create"
            onSelect={() =>
              run(() => {
                useWorkspaceStore.getState().addNotebook()
              })
            }
          >
            <Plus className="h-4 w-4" /> New notebook
          </CommandItem>
          {onOpenLibrary && (
            <CommandItem value="open library browse assets" onSelect={() => run(() => onOpenLibrary())}>
              <LibraryBig className="h-4 w-4" /> Open library
            </CommandItem>
          )}
          {onOpenSettings && (
            <CommandItem value="open settings preferences" onSelect={() => run(() => onOpenSettings())}>
              <Settings className="h-4 w-4" /> Settings
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem value="go notebook workspace" onSelect={() => run(() => router.push('/notebook'))}>
            <NotebookPen className="h-4 w-4" /> Notebook
          </CommandItem>
          <CommandItem value="go assignments homework" onSelect={() => run(() => router.push('/assignments'))}>
            <ClipboardList className="h-4 w-4" /> Assignments
          </CommandItem>
          {isStaff && profile?.role === 'admin' && (
            <CommandItem value="go admin console institution" onSelect={() => run(() => router.push('/admin'))}>
              <ShieldCheck className="h-4 w-4" /> Admin console
            </CommandItem>
          )}
          <CommandItem value="go landing home" onSelect={() => run(() => router.push('/'))}>
            <BookOpen className="h-4 w-4" /> About SIMBLIP
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
