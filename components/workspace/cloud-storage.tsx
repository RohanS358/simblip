'use client'

// Settings → Storage → Cloud: the account's 150 MB project quota and what uses
// it. Everything shown comes from the server (/api/storage/usage) — the
// client never computes its own total. Actions only ever remove CLOUD copies
// or change what syncs; the one action that deletes the last copy of a file
// says so and asks first. Nothing is removed automatically to make room.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cloud, CloudDownload, CloudOff, HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/lib/auth/store'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { cloudConfigured } from '@/lib/data/db'
import { PROJECT_QUOTA_BYTES, QUOTA_WARN_RATIO, fmtBytes } from '@/lib/storage/quota'
import {
  deleteFiles,
  downloadFromCloud,
  fetchCloudUsage,
  hasLocalCopy,
  setSyncEnabled,
  type CloudUsage,
} from '@/lib/storage/manager'
import { contentIdsOf, setPageSyncMode, syncedFileIds } from '@/lib/sync/page-sync'
import { holdFilesBack, retryQuotaBlockedUploads, useFileSyncStore } from '@/lib/sync/device-file-sync'
import { clearCloudData, syncNow, useSyncStore, type CloudClearType } from '@/lib/sync/cloud'
import type { PageNode } from '@/lib/scene/types'

const CLEARABLE: { type: CloudClearType; cat: keyof CloudUsage['categories']; label: string }[] = [
  { type: 'pages', cat: 'pages', label: 'Pages & documents' },
  { type: 'files', cat: 'files', label: 'Backed-up files' },
  { type: 'account', cat: 'account', label: 'Calendar & notes' },
]

const CATEGORIES: { key: keyof CloudUsage['categories']; label: string; color: string }[] = [
  { key: 'pages', label: 'Pages & documents', color: 'var(--chart-2)' },
  { key: 'files', label: 'Backed-up files', color: 'var(--chart-1)' },
  { key: 'account', label: 'Calendar & notes', color: 'var(--chart-4)' },
  { key: 'tree', label: 'Notebook structure', color: 'var(--chart-3)' },
]

export function CloudStorageSection() {
  const signedIn = useAuthStore((s) => s.status === 'authed')
  const nodes = useWorkspaceStore((s) => s.nodes)
  const filesBlocked = useFileSyncStore((s) => s.quotaBlocked)
  const phase = useSyncStore((s) => s.phase)
  const [usage, setUsage] = useState<CloudUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [local, setLocal] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [clearSel, setClearSel] = useState<CloudClearType[]>([])
  const [clearing, setClearing] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const u = await fetchCloudUsage().catch(() => null)
    setUsage(u)
    setLoading(false)
    if (u) {
      const entries = await Promise.all(u.files.map(async (f) => [f.id, await hasLocalCopy(f.id)] as const))
      setLocal(Object.fromEntries(entries))
    }
  }, [])

  useEffect(() => {
    if (signedIn && cloudConfigured) void reload()
    else setLoading(false)
  }, [signedIn, reload])

  // content id → the page (tree node) it belongs to, for naming big rows
  const pageOf = useMemo(() => {
    const map = new Map<string, PageNode>()
    for (const n of Object.values(nodes)) if (n.kind === 'page') for (const cid of contentIdsOf(n)) map.set(cid, n)
    return map
  }, [nodes])
  const viaFullPage = useMemo(() => syncedFileIds(nodes), [nodes])

  if (!cloudConfigured) {
    return <p className="text-ui-sm text-muted-foreground">This installation stores everything on this device only.</p>
  }
  if (!signedIn) return <p className="text-ui-sm text-muted-foreground">Sign in to see your cloud storage.</p>
  if (loading && !usage) {
    return (
      <p className="flex items-center gap-2 text-ui-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking cloud storage…
      </p>
    )
  }
  if (!usage) {
    return (
      <div className="flex items-center justify-between gap-2 text-ui-sm text-muted-foreground">
        Couldn’t reach cloud storage. Your work is safe on this device.
        <Button size="sm" variant="outline" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    )
  }

  const limit = usage.limit || PROJECT_QUOTA_BYTES
  const ratio = usage.used / limit
  const tone = ratio >= 1 ? 'rose' : ratio >= QUOTA_WARN_RATIO ? 'amber' : 'mint'
  const files = showAll ? usage.files : usage.files.slice(0, 8)

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id)
    try {
      await fn()
      toast.success(ok)
      await reload()
      await retryQuotaBlockedUploads()
      void syncNow()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That didn’t work — nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  const clearCloud = async () => {
    const names = CLEARABLE.filter((c) => clearSel.includes(c.type)).map((c) => c.label.toLowerCase())
    if (
      !confirm(
        `Clear ${names.join(', ')} from the cloud?\n\nThis removes them from the cloud and from your other devices' cloud copy. Everything on THIS device stays. From now on only new and changed items sync.`
      )
    )
      return
    setClearing(true)
    try {
      await clearCloudData(clearSel)
      if (clearSel.includes('files')) await holdFilesBack(useAuthStore.getState().profile?.id ?? '')
      setClearSel([])
      toast.success('Cloud storage cleared. Only new changes will sync.')
      await reload()
      void syncNow()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Couldn’t clear the cloud — nothing was changed.')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-ui-sm font-medium">Cloud storage</span>
          <span className="text-ui-sm tabular-nums">
            <span className="font-semibold">{fmtBytes(usage.used)}</span>
            <span className="text-muted-foreground"> of {fmtBytes(limit)}</span>
          </span>
        </div>
        {/* Stacked by category so the bar itself answers "what's using it". */}
        <div
          className="flex h-2.5 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-label="Cloud storage used"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={usage.used}
          aria-valuetext={`${fmtBytes(usage.used)} of ${fmtBytes(limit)}`}
        >
          {CATEGORIES.map((c) => (
            <div key={c.key} style={{ width: `${(usage.categories[c.key] / limit) * 100}%`, background: c.color }} />
          ))}
        </div>
        <div className="flex items-center justify-between text-ui-xs text-muted-foreground">
          <span>{fmtBytes(Math.max(0, limit - usage.used))} free</span>
          <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => void reload()}>
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} /> Refresh
          </button>
        </div>
        {(tone !== 'mint' || filesBlocked || phase === 'quota') && (
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-ui-xs leading-relaxed',
              tone === 'rose' || filesBlocked || phase === 'quota'
                ? 'border-[var(--accent-rose)]/40 bg-[var(--accent-rose)]/10'
                : 'border-[var(--accent-amber)]/40 bg-[var(--accent-amber)]/10'
            )}
            role="status"
          >
            {tone === 'rose' || filesBlocked || phase === 'quota'
              ? 'Cloud storage is full. New changes are saved on this device and upload once there is room. '
              : 'Cloud storage is almost full. '}
            Free space by removing cloud copies of large files (they stay on this device) or keeping big pages on
            this device only.
          </div>
        )}
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {CATEGORIES.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-ui-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="flex-1 truncate text-muted-foreground">{c.label}</span>
            <span className="tabular-nums">{fmtBytes(usage.categories[c.key])}</span>
          </li>
        ))}
      </ul>

      {usage.files.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Files in the cloud</h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {files.map((f) => {
              const here = local[f.id]
              const pinnedByPage = viaFullPage.has(f.id)
              return (
                <li key={f.id} className="flex min-h-11 items-center gap-2 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ui-sm" title={f.name}>
                      {f.name}
                    </p>
                    <p className="flex items-center gap-1 text-ui-2xs text-muted-foreground">
                      {here ? <HardDrive className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                      {fmtBytes(f.size)} · {here ? 'also on this device' : 'cloud only'}
                    </p>
                  </div>
                  {busy === f.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : here ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 gap-1.5 text-ui-xs"
                      title="Remove the cloud copy. The file stays on this device."
                      onClick={() => {
                        if (pinnedByPage) {
                          toast.message('A page backs this file up', {
                            description: 'Set that page’s Cloud sync to “Sync content” to stop backing up its files.',
                          })
                          return
                        }
                        void act(f.id, () => setSyncEnabled(f.id, false), `Removed cloud copy of “${f.name}”`)
                      }}
                    >
                      <CloudOff className="h-3.5 w-3.5" /> Keep local
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 gap-1.5 text-ui-xs"
                        onClick={() =>
                          void act(
                            f.id,
                            async () => {
                              if (!(await downloadFromCloud(f.id))) throw new Error('Download failed — try again.')
                            },
                            `Downloaded “${f.name}”`
                          )
                        }
                      >
                        <CloudDownload className="h-3.5 w-3.5" /> Download
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${f.name} from the cloud`}
                        onClick={() => {
                          if (
                            confirm(
                              `“${f.name}” is not on this device. Deleting it from the cloud removes the last copy this device can reach. Delete?`
                            )
                          )
                            void act(f.id, () => deleteFiles([f.id]), `Deleted “${f.name}”`)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          {usage.files.length > 8 && (
            <button
              type="button"
              className="text-ui-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? 'Show fewer' : `Show all ${usage.files.length}`}
            </button>
          )}
        </section>
      )}

      {usage.largestPages.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Largest pages</h4>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {usage.largestPages.slice(0, 5).map((p) => {
              const page = pageOf.get(p.id)
              return (
                <li key={p.id} className="flex min-h-11 items-center gap-2 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-ui-sm">{page?.name ?? 'Page from another device'}</span>
                  <span className="text-ui-2xs tabular-nums text-muted-foreground">{fmtBytes(p.size)}</span>
                  {page && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 gap-1.5 text-ui-xs"
                      title="Stop syncing this page. It stays on this device and disappears from your other devices."
                      onClick={() => {
                        if (
                          confirm(
                            `Keep “${page.name}” on this device only? Its cloud copy is removed and it will no longer appear on your other devices. Nothing is deleted here.`
                          )
                        )
                          void act(p.id, () => setPageSyncMode(page.id, 'local'), `“${page.name}” is now kept on this device`)
                      }}
                    >
                      <CloudOff className="h-3.5 w-3.5" /> Keep local
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2 rounded-lg border border-[var(--accent-rose)]/30 p-3">
        <h4 className="text-ui-xs font-medium uppercase tracking-wide text-muted-foreground">Clear cloud storage</h4>
        <p className="text-ui-xs text-muted-foreground">
          Removes the chosen cloud data. Nothing on this device is deleted, and afterwards only new or changed items
          sync. Your notebook structure is kept.
        </p>
        {CLEARABLE.map((c) => (
          <label key={c.type} className="flex min-h-9 items-center gap-2 text-ui-sm">
            <input
              type="checkbox"
              checked={clearSel.includes(c.type)}
              onChange={(e) => setClearSel((v) => (e.target.checked ? [...v, c.type] : v.filter((t) => t !== c.type)))}
            />
            <span className="flex-1">{c.label}</span>
            <span className="text-ui-xs tabular-nums text-muted-foreground">{fmtBytes(usage.categories[c.cat])}</span>
          </label>
        ))}
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          disabled={clearSel.length === 0 || clearing}
          onClick={() => void clearCloud()}
        >
          {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Clear selected
        </Button>
      </section>
    </div>
  )
}
