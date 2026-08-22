'use client'

// Institution Library — a Canva-style asset panel. Search, categories,
// favorites, one-click insertion (always a clone), and publishing for
// teachers/admins. Students browse approved assets read-only.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import {
  BadgeCheck,
  Check,
  FileText,
  LibraryBig,
  Loader2,
  Search,
  Shapes,
  SlidersHorizontal,
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
import { PanelHeader } from './panel-header'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
            <Label className="text-ui-sm">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Spring–mass lab template" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-ui-sm">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this asset for?"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-ui-sm">Category</Label>
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
              <Label className="text-ui-sm">What to publish</Label>
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
            <Label className="text-ui-sm">Tags (comma separated)</Label>
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
  /** Empty = no filter (everything shows). Multi-select, so several
   *  subjects can be on at once — the old single-select row could only ever
   *  narrow to one. */
  const [cats, setCats] = useState<Set<string>>(new Set())
  const [favs, setFavs] = useState<Set<string>>(new Set())
  const [publishOpen, setPublishOpen] = useState(false)

  const refresh = useCallback(() => void listAssets().then(setAssets).catch(() => {}), [])

  useEffect(() => {
    if (!open) return
    refresh()
    if (profile) setFavs(favoriteIds(profile.id))
    return subscribeLibrary(refresh)
  }, [open, profile, refresh])

  /** Search applied, category NOT — the counts beside each checkbox have to
   *  reflect what ticking that box would actually reveal. */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets.filter(
      (a) =>
        !q ||
        a.title.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [assets, query])

  const filtered = useMemo(() => {
    return searched
      .filter((a) => cats.size === 0 || cats.has(a.category))
      .sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)))
  }, [searched, cats, favs])

  /** Categories that actually occur, canonical ones first. Older rows can
   *  hold a value outside LIBRARY_CATEGORIES, and a checkbox that can never
   *  match anything is worse than no checkbox. */
  const presentCategories = useMemo(() => {
    const present = new Set(assets.map((a) => a.category).filter(Boolean))
    const canonical = LIBRARY_CATEGORIES.filter((c) => present.has(c))
    const extra = [...present].filter((c) => !LIBRARY_CATEGORIES.includes(c as never)).sort()
    return [...canonical, ...extra]
  }, [assets])

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
      <PanelHeader
        icon={LibraryBig}
        title="Library"
        actions={
          <>
            {canPublish && (
              <button
                type="button"
                aria-label="Publish current page to library"
                className="rounded-md p-1 text-muted-foreground transition-[color,background-color,transform] duration-150 ease-strong hover:bg-accent hover:text-foreground active:scale-90"
                onClick={() => setPublishOpen(true)}
              >
                <Upload className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Close library"
              className="rounded-md p-1 text-muted-foreground transition-[color,background-color,transform] duration-150 ease-strong hover:bg-accent hover:text-foreground active:scale-90"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search assets…"
              className="h-8 pl-8 text-ui-sm"
            />
          </div>
          {/* Eight categories never fit a ~240px panel, so the old row scrolled
              sideways — the options past the third were invisible until you
              dragged. A popover shows all of them at once, and being
              multi-select means you can watch two subjects rather than
              flipping between them. */}
          <div className="flex items-center gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-1 text-ui-xs transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.97]',
                    cats.size > 0
                      ? 'border-[var(--accent-blue)]/40 bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)] text-foreground'
                      : 'border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <SlidersHorizontal className="h-3 w-3 shrink-0" />
                  {cats.size === 0 ? 'All subjects' : `${cats.size} selected`}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-52 p-1">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-ui-2xs font-medium text-muted-foreground">Subjects</span>
                  {cats.size > 0 && (
                    <button
                      type="button"
                      className="text-ui-2xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                      onClick={() => setCats(new Set())}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {presentCategories.map((c) => {
                  const on = cats.has(c)
                  // Count from the SEARCH-filtered set, not the raw list, so a
                  // number here always matches what selecting it would show.
                  const n = searched.filter((a) => a.category === c).length
                  return (
                    <button
                      key={c}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() =>
                        setCats((prev) => {
                          const next = new Set(prev)
                          if (next.has(c)) next.delete(c)
                          else next.add(c)
                          return next
                        })
                      }
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-ui-xs transition-colors duration-150 hover:bg-accent"
                    >
                      <span
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-150',
                          on
                            ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                            : 'border-border'
                        )}
                      >
                        {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate capitalize">{c.replace('-', ' ')}</span>
                      <span className="shrink-0 text-ui-2xs tabular-nums text-muted-foreground">{n}</span>
                    </button>
                  )
                })}
              </PopoverContent>
            </Popover>
            {/* Active subjects stay visible outside the popover, each one its
                own remove target — otherwise a filter you set two minutes ago
                silently explains an empty list. */}
            {[...cats].map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Remove ${c.replace('-', ' ')} filter`}
                onClick={() =>
                  setCats((prev) => {
                    const next = new Set(prev)
                    next.delete(c)
                    return next
                  })
                }
                className="group flex shrink-0 items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-ui-2xs capitalize text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                {c.replace('-', ' ')}
                <X className="h-2.5 w-2.5 opacity-50 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </>
      </PanelHeader>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <p className="text-ui-sm leading-relaxed text-muted-foreground">
              {assets.length === 0
                ? canPublish
                  ? 'The library is empty. Publish a page to start your institution’s collection.'
                  : 'No approved assets yet — check back soon.'
                : cats.size > 0 && !query.trim()
                  ? 'Nothing in the subjects you picked.'
                  : 'Nothing matches your search.'}
            </p>
            {/* A filter set earlier is the usual reason an established library
                looks empty — offer the way out rather than just reporting it. */}
            {assets.length > 0 && cats.size > 0 && (
              <button
                type="button"
                onClick={() => setCats(new Set())}
                className="rounded-md border border-border/60 px-2.5 py-1 text-ui-xs text-muted-foreground transition-[color,background-color,transform] duration-150 ease-strong hover:bg-accent hover:text-foreground active:scale-[0.97]"
              >
                Clear subject filter
              </button>
            )}
          </div>
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
                  <p className="flex items-center gap-1 truncate text-ui-sm font-medium text-foreground">
                    {a.title}
                    {a.approved && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-[var(--accent-mint)]" />}
                  </p>
                  {a.description && (
                    <p className="line-clamp-2 text-ui-xs leading-snug text-muted-foreground">{a.description}</p>
                  )}
                  <p className="mt-0.5 text-ui-2xs text-muted-foreground">
                    {a.uploader_name} · {objectCount} object{objectCount === 1 ? '' : 's'}
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
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 px-2 text-ui-xs font-medium"
                  onClick={() => insert(a)}
                >
                  {a.kind === 'page' ? 'Add as page' : 'Insert'}
                </Button>
                {canApprove && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-ui-xs font-normal text-muted-foreground hover:text-foreground"
                    onClick={() => void setApproved(a.id, !a.approved)}
                  >
                    {a.approved ? 'Unapprove' : 'Approve'}
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
