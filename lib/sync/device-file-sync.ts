'use client'

// Cloud copies of opted-in FILE bytes (images, PDFs, PPTX sources…).
//
// Page content and the tree sync automatically (lib/sync/cloud.ts). File
// bytes are the large, optional tier: a file uploads only when the user opted
// it in — on the file itself, through a page/folder set to "Sync with files",
// or through a category in Sync settings — and its cloud copy then STAYS
// (counted against the 150 MB project quota) so any device can download it
// on demand. Turning sync off removes the cloud copy; the local copy is never
// touched.
//
//   1. startFileSync() uploads every opted-in local file that has no cloud
//      copy yet (debounced), retrying after reconnect. A full quota stops the
//      loop and is reported — never retried in a tight loop.
//   2. pushFilesToDevice() additionally asks an online device to PREFETCH
//      those files now (simblip_devices.pending_pull), so they're there
//      before the user opens them offline.
//   3. pullPendingFiles() downloads prefetch requests. It no longer deletes
//      the cloud copy afterwards: that copy is the user's chosen backup.

import { getAccessToken, useAuthStore } from '@/lib/auth/store'
import * as manifest from '@/lib/storage/manifest'
import type { FileManifestEntry } from '@/lib/storage/manifest-types'
import { create } from 'zustand'
import { getFile, uploadToCloud, UploadError } from '@/lib/storage/manager'
import { onReconnect } from '@/lib/sync/connectivity'
import { useDevicesStore, type DeviceRow } from '@/lib/sync/devices'
import { syncedFileIds } from '@/lib/sync/page-sync'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { globalPrefAllowsFile } from '@/lib/sync/sync-prefs'

const AUTO_SYNC_DEBOUNCE_MS = 10_000

/** Set when an upload was refused because the project quota is full. */
export const useFileSyncStore = create<{ quotaBlocked: boolean }>(() => ({ quotaBlocked: false }))

/** Re-arm files refused for quota (after the user freed space). */
export async function retryQuotaBlockedUploads(): Promise<void> {
  const profile = useAuthStore.getState().profile
  if (!profile) return
  for (const e of await manifest.listByOwner(profile.id)) {
    if (e.syncError === 'quota') await manifest.putEntry({ ...e, syncStatus: 'local-only', syncError: undefined })
  }
}

/** File ids reachable from a sync-enabled page, as of right now. */
const fromSyncedPages = (): Set<string> => syncedFileIds(useWorkspaceStore.getState().nodes)

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const res = await fetch(`/api/pg/${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`Device sync ${res.status}: ${await res.text()}`)
  return res
}

const allowedFile = (viaPage: Set<string>) => (e: FileManifestEntry) =>
  e.syncEnabled === true || viaPage.has(e.id) || globalPrefAllowsFile(e.mime, e.name)

/** Upload every opted-in file that has no cloud copy yet. Sequential (large
 *  bodies) and stops at the first quota refusal — the rest can't fit either,
 *  and the UI reports it. A file refused for quota is retried only when the
 *  user acts (frees space / toggles), not on every tick. */
export async function uploadOptedIn(ownerId: string, onProgress?: (done: number, total: number) => void) {
  const viaPage = fromSyncedPages()
  const entries = (await manifest.listByOwner(ownerId)).filter(
    (e) =>
      allowedFile(viaPage)(e) &&
      (e.syncStatus === 'local-only' || (e.syncStatus === 'sync-failed' && e.syncError !== 'quota'))
  )
  for (let i = 0; i < entries.length; i++) {
    try {
      await uploadToCloud(entries[i])
    } catch (err) {
      if (err instanceof UploadError && err.reason === 'quota') {
        useFileSyncStore.setState({ quotaBlocked: true })
        return
      }
    }
    onProgress?.(i + 1, entries.length)
  }
  useFileSyncStore.setState({ quotaBlocked: false })
}

/** Push this account's files to `target` via Blob. `syncStatus` records
 *  whether a file has ever reached Blob at all, not whether THIS target has
 *  it — there's no per-device registry (see manifest-types.ts). So a file
 *  already `cloudBackedUp` is queued into pending_pull directly (cheap: just
 *  its id), while only files never uploaded anywhere (`local-only` /
 *  `sync-failed`) pay the actual uploadToCloud() bytes cost. This is what
 *  keeps a first-time device pairing from re-uploading bytes that already
 *  exist in Blob just because a different device pulled them first. */
export async function pushFilesToDevice(target: DeviceRow, onProgress?: (done: number, total: number) => void) {
  const profile = useAuthStore.getState().profile
  if (!profile) return
  const entries = await manifest.listByOwner(profile.id)
  // Opt-in only: a file's bytes leave this device solely when the user turned
  // sync on for it (right-click → Sync across devices), either on the file
  // itself or on a page that references it. Default-off, so the manifest row
  // still travels — the other device knows the file exists and shows it as
  // not-downloaded — while the bytes stay put unless asked for.
  //
  // The page-derived half is recomputed here rather than stamped onto the
  // manifest at toggle time, so an image dropped onto an already-synced page
  // is covered without anyone re-toggling anything.
  const viaPage = fromSyncedPages()
  const allowed = allowedFile(viaPage)
  await uploadOptedIn(profile.id, onProgress)

  const fresh = await manifest.listByOwner(profile.id)
  const ids = fresh.filter((e) => allowed(e) && e.cloudBackedUp).map((e) => e.id)
  if (ids.length === 0) return
  await rest(`simblip_devices?id=eq.${target.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ pending_pull: ids }),
  })
}

/** Pull whatever's been pushed to THIS device, then clean up the Blob
 *  copies. Safe to call repeatedly (e.g. every presence tick) — a no-op
 *  once pending_pull is empty.
 *
 *  pending_pull is cleared BEFORE the pull/delete loop runs, not after: this
 *  used to clear at the end, so a heartbeat tick that threw partway through
 *  (a flaky DELETE, a dropped connection) left the row's pending_pull
 *  pointing at ids that were already pulled+deleted. The next tick 15s later
 *  re-ran the same ids — re-pulling (harmless, already in OPFS) but
 *  re-issuing a DELETE for an already-deleted Blob object every 15s forever,
 *  which is what a stuck sync looked like: a spamming DELETE loop that never
 *  let the tick finish quickly enough for anything else to load. Clearing
 *  first means a mid-loop failure just drops that one pull for good instead
 *  of retrying it forever — acceptable, since the source file still exists
 *  in the sender's own manifest for the next real push. */
export async function pullPendingFiles(): Promise<number> {
  const profile = useAuthStore.getState().profile
  if (!profile) return 0
  const { deviceId } = await import('@/lib/sync/devices')
  const res = await rest(`simblip_devices?id=eq.${deviceId()}&select=id,pending_pull`)
  const [row] = (await res.json()) as { id: string; pending_pull: string[] }[]
  const ids = row?.pending_pull ?? []
  if (ids.length === 0) return 0

  await rest(`simblip_devices?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ pending_pull: [] }) })

  for (const id of ids) await getFile(id) // reseeds OPFS + local manifest as a side effect
  return ids.length
}

let autoSyncStarted = false

/** Auto-push changed files ~10s after the last one settles, instead of only
 *  on a manual "Sync files" click — same debounced-dirty-set shape as
 *  lib/sync/cloud.ts's startSync(), watching the file manifest instead of
 *  the doc store. Pushes to every currently-online device (device sync has
 *  no single "the" target the way page sync has no target at all). */
export function startFileSync() {
  if (autoSyncStarted || typeof window === 'undefined') return
  autoSyncStarted = true

  let timer: ReturnType<typeof setTimeout> | null = null

  // Auto-triggered pushes are fire-and-forget (no button UI waiting on
  // them), so catch here — pushFilesToDevice() itself stays un-caught for
  // the manual "Sync files" button, which already surfaces failures via its
  // own try/catch + toast in sync-status.tsx.
  let running = false
  const runNow = async () => {
    const profile = useAuthStore.getState().profile
    if (!profile || running) return
    running = true
    try {
      // Durable cloud copies first — independent of whether any other
      // device is online right now.
      await uploadOptedIn(profile.id)
      for (const device of useDevicesStore.getState().others) {
        await pushFilesToDevice(device).catch((err) => console.warn('[device-file-sync] prefetch failed:', err))
      }
    } catch (err) {
      console.warn('[device-file-sync] upload failed:', err)
    } finally {
      running = false
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void runNow()
    }, AUTO_SYNC_DEBOUNCE_MS)
  }

  manifest.onManifestChange((entry) => {
    // Only a file freshly needing upload should re-arm the timer — ignore
    // uploadToCloud()'s own 'uploading'/'synced' writes, which would
    // otherwise keep resetting the debounce while a push is already running.
    if (entry.syncStatus !== 'local-only' && entry.syncStatus !== 'sync-failed') return
    // Sync is opt-in — a local-only file neither enabled directly nor pulled
    // in by a synced page should never wake the pusher (pushFilesToDevice
    // filters it out anyway; this just avoids the pointless debounce + round
    // trip).
    if (
      entry.syncEnabled !== true &&
      !fromSyncedPages().has(entry.id) &&
      !globalPrefAllowsFile(entry.mime, entry.name)
    )
      return
    if (!useAuthStore.getState().profile) return
    schedule()
  })

  // A failed auto-push (offline) just leaves manifest entries at
  // 'sync-failed'/'local-only' with no further edit to re-arm the debounce —
  // resume immediately once the network is confirmed back, same as
  // lib/sync/cloud.ts's reconnect handling.
  onReconnect(() => {
    if (useAuthStore.getState().profile) void runNow()
  })
  // Files opted in on a previous visit that never finished uploading.
  setTimeout(() => void runNow(), 15_000)
}
