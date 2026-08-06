'use client'

// Cloud sync indicator. Also the single place that boots the sync engine —
// mounting the shell is what turns syncing on.

import { useEffect } from 'react'
import { Cloud, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { startSync, syncConfigured, useSyncStore } from '@/lib/sync/cloud'
import { useAuthStore } from '@/lib/auth/store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function SyncStatus() {
  const phase = useSyncStore((s) => s.phase)
  const lastError = useSyncStore((s) => s.lastError)
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt)
  // Identity comes from the platform auth store — the engine follows it.
  const signedIn = useAuthStore((s) => s.status === 'authed')
  const profileId = useAuthStore((s) => s.profile?.id)

  useEffect(() => {
    startSync()
  }, [])

  // File storage bootstrap: retry any upload that didn't finish last
  // session, and — once, per user — migrate PDFs still sitting in the old
  // IndexedDB cache onto OPFS + manifest (lib/storage/migrate-session-files.ts).
  // Needs a real profile id (the manifest's ownerId), so it waits for
  // sign-in instead of running at the same unconditional mount startSync() does.
  useEffect(() => {
    if (!profileId) return
    void import('@/lib/storage/manager').then(({ retrySyncQueue }) => retrySyncQueue())
    void import('@/lib/storage/migrate-session-files').then(({ migrateSessionFilesToOpfs }) =>
      migrateSessionFilesToOpfs(profileId)
    )
  }, [profileId])

  const view = !syncConfigured
    ? { icon: CloudOff, cls: 'text-muted-foreground/60', label: 'Local mode — notebooks live in this browser. Configure the cloud database to sync.' }
    : !signedIn || phase === 'offline'
      ? { icon: CloudOff, cls: 'text-muted-foreground/60', label: 'Not syncing — notebooks stay in this browser until your session is active.' }
      : phase === 'syncing'
      ? { icon: RefreshCw, cls: 'animate-spin text-[var(--accent-blue)]', label: 'Syncing…' }
      : phase === 'error'
        ? { icon: TriangleAlert, cls: 'text-[var(--accent-rose)]', label: `Sync error — changes kept locally and retried. ${lastError ?? ''}` }
        : {
            icon: Cloud,
            cls: 'text-[var(--accent-mint)]',
            label: lastSyncedAt ? `Synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : 'Synced',
          }

  const Icon = view.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={view.label} className="rounded-lg p-1.5">
          <Icon className={cn('h-4 w-4', view.cls)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 text-xs">
        {view.label}
      </TooltipContent>
    </Tooltip>
  )
}
