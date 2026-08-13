'use client'

// Institution Library — a Canva-style asset panel. Search, categories,
// favorites, one-click insertion (always a clone), and publishing for
// teachers/admins. Students browse approved assets read-only.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import {
  BadgeCheck,
  FileText,
  LibraryBig,
  Loader2,
  Search,
  Shapes,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import {
  favoriteIds,
  listAssets,
  publishAsset,
  removeAsset,
  setApproved,
  subscribeLibrary,
  toggleFavorite,
} from '@/lib/data/library'
import { LIBRARY_CATEGORIES, type LibraryAssetRow } from '@/lib/data/types'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { importPageDoc, insertObjects } from '@/lib/store/import-page'
import type { PageDoc, SceneObject } from '@/lib/scene/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** World-space point currently at the middle of the canvas viewport. */
function viewCenter(pageId: string): { x: number; y: number } {
  const v = useDocStore.getState().viewports[pageId] ?? { x: 0, y: 0, zoom: 1 }
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  return { x: (w / 2 - v.x) / v.zoom - 120, y: (h / 2 - v.y) / v.zoom - 80 }
}

export function PublishDialog({
  open,
  onOpenChange,
  pageId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  pageId: string | null
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<string>('general')
  const [tags, setTags] = useState('')
  const [scope, setScope] = useState<'page' | 'selection'>('page')
  const [busy, setBusy] = useState(false)
  const selection = useDocStore((s) => s.selection)

  const publish = async () => {
    if (!pageId || !title.trim()) return
    const page = useDocStore.getState().pages[pageId]
    if (!page) return
    setBusy(true)
    try {
      if (scope === 'selection' && selection.length > 0) {
        const objects = selection.map((id) => page.objects[id]).filter(Boolean) as SceneObject[]
        await publishAsset({
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          kind: 'objects',
          content: objects,
        })
      } else {
        // Full bundle: a published doc/PDF keeps its kind, sheets and file
        // refs, so inserting it from the library recreates the real thing.
        const { bundlePage } = await import('@/lib/store/page-bundle')
        await publishAsset({
          title: title.trim(),
          description: description.trim() || undefined,
          category,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          kind: 'page',
          content: bundlePage(pageId),
        })
      }
      toast.success(`“${title.trim()}” published to the institution library`)
      onOpenChange(false)
      setTitle('')
      setDescription('')
      setTags('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Publishing failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to library</DialogTitle>
          <DialogDescription>
            Colleagues get their own copies — your original stays yours.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[0.75rem]">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Spring–mass lab template" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[0.75rem]">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this asset for?"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[0.75rem]">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIBRARY_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c.replace('-', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[0.75rem]">What to publish</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as 'page' | 'selection')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">Whole page</SelectItem>
                  <SelectItem value="selection" disabled={selection.length === 0}>
                    Selection ({selection.length})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[0.75rem]">Tags (comma separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="oscillation, lab, week-3" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void publish()} disabled={busy || !title.trim() || !pageId}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LibraryPanel({
  open,
  onClose,
  pageId,
  inline = false,
}: {
  open: boolean
  onClose: () => void
  pageId: string | null
  /** Rendered inside the notebook sidebar (no floating chrome of its own). */
  inline?: boolean
}) {
  const motion = useSpring()
  const profile = useAuthStore((s) => s.profile)
  const [assets, setAssets] = useState<LibraryAssetRow[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [favs, setFavs] = useState<Set<string>>(new Set())
  const [publishOpen, setPublishOpen] = useState(false)

  const refresh = useCallback(() => void listAssets().then(setAssets).catch(() => {}), [])

  useEffect(() => {
    if (!open) return
    refresh()
    if (profile) setFavs(favoriteIds(profile.id))
    return subscribeLibrary(refresh)
  }, [open, profile, refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets
      .filter((a) => !category || a.category === category)
      .filter(
        (a) =>
          !q ||
          a.title.toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q) ||
          a.tags.some((t) => t.toLowerCase().includes(q))
      )
      .sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)))
  }, [assets, query, category, favs])

  const insert = (asset: LibraryAssetRow) => {
    if (asset.kind === 'page') {
      const id = importPageDoc({
        notebookName: 'Library imports',
        notebookEmoji: '📚',
        sectionName: asset.category,
        pageName: asset.title,
        content: asset.content as PageDoc,
        activate: true,
      })
      useWorkspaceStore.getState().setActivePage(id)
      toast.success(`“${asset.title}” added as a new page`)
    } else {
      if (!pageId) {
        toast.error('Open a page first to insert components.')
        return
      }
      insertObjects(pageId, asset.content as SceneObject[], viewCenter(pageId))
      toast.success(`“${asset.title}” inserted`)
    }
  }

  if (!open || !profile) return null
  const canPublish = can(profile.role, 'publish-library')
  const canApprove = can(profile.role, 'approve-library')

  return (
    <fm.aside
      initial={inline ? false : { x: 16, opacity: 0 }}
      animate={inline ? undefined : { x: 0, opacity: 1 }}
      transition={motion}
      className={
        inline
          ? 'flex h-full min-h-0 w-full flex-col'
          : 'glass z-30 m-3 flex w-80 flex-col rounded-2xl'
      }
      aria-label="Institution library"
    >
      {/* Sticky Header: Library Title, Search Bar & Category Filters */}
      <div className="sticky top-0 z-20 shrink-0 bg-card/80 backdrop-blur-xl supports-[backdrop-filter]:bg-card/60 pb-2 pt-1 border-b border-border/50">
        <div className="flex items-center gap-2 px-3.5 pb-2 pt-2">
          <LibraryBig className="h-4 w-4 text-[var(--accent-blue)]" />
          <span className="flex-1 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Institution Library
          </span>
          {canPublish && (
            <button
              type="button"
              aria-label="Publish current page to library"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setPublishOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Close library"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search assets…"
              className="h-8 pl-8 text-[0.78125rem]"
            />
          </div>
          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto">
            <button
              type="button"
              className={cn(
                'shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium transition-colors',
                category === null ? 'bg-foreground text-background font-semibold' : 'bg-accent text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setCategory(null)}
            >
              All
            </button>
            {LIBRARY_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium capitalize transition-colors',
                  category === c ? 'bg-foreground text-background font-semibold' : 'bg-accent text-muted-foreground hover:text-foreground'
                )}
                onClick={() => setCategory(category === c ? null : c)}
              >
                {c.replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {filtered.length === 0 && (
          <p className="px-2 py-8 text-center text-[0.75rem] leading-relaxed text-muted-foreground">
            {assets.length === 0
              ? canPublish
                ? 'The library is empty. Publish a page to start your institution’s collection.'
                : 'No approved assets yet — check back soon.'
              : 'Nothing matches your search.'}
          </p>
        )}
        {filtered.map((a) => {
          const objectCount =
            a.kind === 'page'
              ? Object.keys((a.content as PageDoc).objects).length
              : (a.content as SceneObject[]).length
          return (
            <div key={a.id} className="group rounded-xl border border-border/60 p-2.5 transition-colors hover:border-border">
              <div className="flex items-start gap-2">
                {a.kind === 'page' ? (
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
                ) : (
                  <Shapes className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-violet)]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-[0.8125rem] font-semibold">
                    {a.title}
                    {a.approved && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent-mint)]" />}
                  </p>
                  {a.description && (
                    <p className="line-clamp-2 text-[0.71875rem] leading-snug text-muted-foreground">{a.description}</p>
                  )}
                  <p className="mt-0.5 text-[0.65625rem] text-muted-foreground">
                    {a.uploader_name} · {objectCount} object{objectCount === 1 ? '' : 's'} ·{' '}
                    <span className="capitalize">{a.category.replace('-', ' ')}</span>
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={favs.has(a.id) ? 'Unfavorite' : 'Favorite'}
                  className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-amber)]"
                  onClick={() => profile && setFavs(new Set(toggleFavorite(profile.id, a.id)))}
                >
                  <Star className={cn('h-3.5 w-3.5', favs.has(a.id) && 'fill-[var(--accent-amber)] text-[var(--accent-amber)]')} />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <Button size="sm" className="h-6 px-2 text-[0.6875rem]" onClick={() => insert(a)}>
                  {a.kind === 'page' ? 'Add as page' : 'Insert'}
                </Button>
                {canApprove && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[0.6875rem]"
                    onClick={() => void setApproved(a.id, !a.approved)}
                  >
                    {a.approved ? 'Unapprove' : 'Approve for students'}
                  </Button>
                )}
                {(a.uploader_id === profile.id || canApprove) && (
                  <button
                    type="button"
                    aria-label="Delete asset"
                    className="ml-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-[var(--accent-rose)] group-hover:opacity-100"
                    onClick={() => void removeAsset(a.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} pageId={pageId} />
    </fm.aside>
  )
}
