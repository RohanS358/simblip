'use client'

// Global search & command palette (Ctrl/Cmd+K). Searches pages, notebooks
// and library assets; exposes quick actions and role-aware navigation.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen,
  ClipboardList,
  FileText,
  LibraryBig,
  Moon,
  NotebookPen,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useWorkspaceStore } from '@/lib/store/workspace'
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
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const notebooks = useWorkspaceStore((s) => s.notebooks)
  const profile = useAuthStore((s) => s.profile)
  const [assets, setAssets] = useState<LibraryAssetRow[]>([])

  useEffect(() => {
    if (open) void listAssets().then(setAssets).catch(() => setAssets([]))
  }, [open])

  const pages = useMemo(
    () =>
      notebooks.flatMap((nb) =>
        nb.sections.flatMap((sec) =>
          sec.pages.map((p) => ({ ...p, path: `${nb.name} / ${sec.name}` }))
        )
      ),
    [notebooks]
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
      <CommandInput placeholder="Search pages, library, actions…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

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
                <span className="ml-auto truncate text-[11px] text-muted-foreground">{p.path}</span>
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
                <span className="ml-auto text-[11px] text-muted-foreground">{a.category}</span>
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
                const ws = useWorkspaceStore.getState()
                const id = ws.addNotebook()
                const sec = ws.addSection(id, 'Section 1')
                ws.addPage(id, sec, 'Page 1')
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
          <CommandItem
            value="toggle theme dark light"
            onSelect={() => run(() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'))}
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            Toggle theme
          </CommandItem>
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
