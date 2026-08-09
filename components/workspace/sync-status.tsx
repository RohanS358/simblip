'use client'

// Cloud sync indicator & device-to-device sync popover.
// Mounting the shell boots both cloud notebook sync and device presence.

import { useEffect, useState } from 'react'
import { Cloud, CloudOff, RefreshCw, TriangleAlert, Laptop, ArrowRightLeft, Loader2, RotateCw } from 'lucide-react'
import { startSync, syncConfigured, useSyncStore } from '@/lib/sync/cloud'
import { startDevicePresence, useDevicesStore, refreshDevices, performHeartbeat, type DeviceRow } from '@/lib/sync/devices'
import { pushFilesToDevice, startFileSync } from '@/lib/sync/device-file-sync'
import { useAuthStore } from '@/lib/auth/store'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function SyncStatus() {
  const phase = useSyncStore((s) => s.phase)
  const lastError = useSyncStore((s) => s.lastError)
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt)
  const signedIn = useAuthStore((s) => s.status === 'authed')
  const profileId = useAuthStore((s) => s.profile?.id)

  const others = useDevicesStore((s) => s.others)
  const [syncingTargetId, setSyncingTargetId] = useState<string | null>(null)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    startSync()
    startDevicePresence()
    startFileSync()
  }, [])

  useEffect(() => {
    if (!profileId) return
    void import('@/lib/storage/migrate-session-files').then(({ migrateSessionFilesToOpfs }) =>
      migrateSessionFilesToOpfs(profileId)
    )
  }, [profileId])

  const handleManualRefresh = async () => {
    setRefreshing(true)
    try {
      await performHeartbeat()
    } finally {
      setRefreshing(false)
    }
  }

  const handlePushToDevice = async (device: DeviceRow) => {
    setSyncingTargetId(device.id)
    setSyncProgress(null)
    try {
      await pushFilesToDevice(device, (done, total) => {
        setSyncProgress({ done, total })
      })
      toast.success(`Files synced to ${device.label}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncingTargetId(null)
      setSyncProgress(null)
    }
  }

  const view = !syncConfigured
    ? { icon: CloudOff, cls: 'text-muted-foreground/60', label: 'Local mode — data stays on this device.' }
    : !signedIn || phase === 'offline'
      ? { icon: CloudOff, cls: 'text-muted-foreground/60', label: 'Not syncing — sign in to sync.' }
      : phase === 'syncing'
      ? { icon: RefreshCw, cls: 'animate-spin text-[var(--accent-blue)]', label: 'Syncing…' }
      : phase === 'error'
        ? { icon: TriangleAlert, cls: 'text-[var(--accent-rose)]', label: `Sync error — ${lastError ?? ''}` }
        : {
            icon: Cloud,
            cls: 'text-[var(--accent-mint)]',
            label: lastSyncedAt ? `Synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Synced',
          }

  const Icon = view.icon

  return (
    <Popover onOpenChange={(open) => { if (open) void handleManualRefresh() }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={view.label}
          className="group relative rounded-lg p-1.5 hover:bg-accent/60 transition-colors"
        >
          <Icon className={cn('h-4 w-4 transition-colors', view.cls)} />
          {others.length > 0 && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--accent-mint)] ring-2 ring-background" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent side="bottom" align="end" className="w-80 p-3 space-y-3">
        <div className="flex items-center gap-2 border-b border-border/60 pb-2.5">
          <Icon className={cn('h-4 w-4 shrink-0', view.cls)} />
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] font-medium leading-none text-foreground">{view.label}</p>
            <p className="mt-1 text-[0.6875rem] text-muted-foreground">
              Storage budget: 1GB • Local-first storage
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[0.75rem] font-semibold text-foreground">Active Online Devices</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Refresh active devices"
                onClick={() => void handleManualRefresh()}
                disabled={refreshing}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                <RotateCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              </button>
              <span className="text-[0.6875rem] font-mono text-muted-foreground">{others.length} online</span>
            </div>
          </div>

          {others.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 p-3 text-center">
              <Laptop className="mx-auto h-5 w-5 text-muted-foreground/50" />
              <p className="mt-1.5 text-[0.75rem] font-medium text-foreground">No other active devices</p>
              <p className="mt-0.5 text-[0.6875rem] text-muted-foreground leading-normal">
                Make sure SIMBLIP is open on your second device and signed in to the same account.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
              {others.map((device) => {
                const isSyncing = syncingTargetId === device.id
                return (
                  <div
                    key={device.id}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-card/60 p-2 text-[0.78125rem]"
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="font-medium truncate text-foreground">{device.label}</p>
                      <p className="text-[0.6875rem] text-muted-foreground">Online now</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSyncing || syncingTargetId !== null}
                      onClick={() => void handlePushToDevice(device)}
                      className="h-7 text-[0.6875rem] gap-1 shrink-0"
                    >
                      {isSyncing ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {syncProgress ? `${syncProgress.done}/${syncProgress.total}` : 'Syncing'}
                        </>
                      ) : (
                        <>
                          <ArrowRightLeft className="h-3 w-3" />
                          Sync files
                        </>
                      )}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <p className="text-[0.6875rem] text-muted-foreground leading-normal pt-1 border-t border-border/40">
          Files are pushed to cloud storage temporarily and deleted immediately after the receiving device downloads them.
        </p>
      </PopoverContent>
    </Popover>
  )
}


