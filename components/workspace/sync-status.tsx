'use client'

// Cloud sync indicator. Also the single place that boots the sync engine —
// mounting the shell is what turns syncing on.

import { useEffect } from 'react'
import { Cloud, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { startSync, syncConfigured, useSyncStore } from '@/lib/sync/supabase'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function SyncStatus() {
  const phase = useSyncStore((s) => s.phase)
  const lastError = useSyncStore((s) => s.lastError)
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt)

  useEffect(() => {
    startSync()
  }, [])

  const user = useSyncStore((s) => s.user)

  const view = !syncConfigured
    ? { icon: CloudOff, cls: 'text-muted-foreground/60', label: 'Offline mode — notebooks live in this browser. Add Supabase keys to sync.' }
    : !user
      ? { icon: CloudOff, cls: 'text-muted-foreground/60', label: 'Not signed in — notebooks stay in this browser. Sign in to sync across devices.' }
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
        <span aria-label={view.label} className="rounded-lg p-1.5">
          <Icon className={cn('h-4 w-4', view.cls)} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64 text-xs">
        {view.label}
      </TooltipContent>
    </Tooltip>
  )
}
