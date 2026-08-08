'use client'

// File-bytes transfer between two of the same account's devices, triggered
// by clicking a device in the cloud icon's popover
// (components/workspace/sync-status.tsx). Notebook/page text already syncs
// continuously via lib/sync/cloud.ts's Postgres channel — this module only
// moves the thing that doesn't: local file bytes (images/PDFs/etc, OPFS +
// lib/storage/manifest.ts) not yet present on the target device.
//
// Flow, entirely reusing the single-file upload/fetch/delete routes that
// already exist for the presentation-upload use case:
//   1. sender uploads every local file to Blob via manager.ts's
//      uploadToCloud() (writes a simblip_file_manifest row).
//   2. sender PATCHes the target's simblip_devices.pending_pull with those
//      file ids.
//   3. target device (on its own presence tick, or immediately if this tab
//      IS the target and the user is looking at it) pulls each id via
//      manager.ts's getFile() — which already fetches from Blob, writes
//      OPFS + local manifest, and clears pending_pull once done.
//   4. target deletes each Blob copy via the existing
//      DELETE /api/storage/[id] and clears its own pending_pull.
//
// "Not yet on the target" is judged by the SENDER's own manifest only (was
// this file ever confirmed pulled by anyone) — there's no per-device
// registry of which device has which file, so a device that already has a
// file just re-receives and overwrites it harmlessly (OPFS + manifest
// writes are idempotent).

import { getAccessToken, useAuthStore } from '@/lib/auth/store'
import * as manifest from '@/lib/storage/manifest'
import { getFile, uploadToCloud } from '@/lib/storage/manager'
import type { DeviceRow } from '@/lib/sync/devices'

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

/** Push every local file this account has to `target` via Blob. Called when
 *  the user clicks a device in the cloud icon's popover. */
export async function pushFilesToDevice(target: DeviceRow, onProgress?: (done: number, total: number) => void) {
  const profile = useAuthStore.getState().profile
  if (!profile) return
  const entries = await manifest.listByOwner(profile.id)
  if (entries.length === 0) return

  for (let i = 0; i < entries.length; i++) {
    await uploadToCloud(entries[i])
    onProgress?.(i + 1, entries.length)
  }

  const fresh = await manifest.listByOwner(profile.id)
  const ids = fresh.filter((e) => e.cloudBackedUp).map((e) => e.id)
  await rest(`simblip_devices?id=eq.${target.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ pending_pull: ids }),
  })
}

/** Pull whatever's been pushed to THIS device, then clean up the Blob
 *  copies. Safe to call repeatedly (e.g. every presence tick) — a no-op
 *  once pending_pull is empty. */
export async function pullPendingFiles(): Promise<number> {
  const profile = useAuthStore.getState().profile
  if (!profile) return 0
  const { deviceId } = await import('@/lib/sync/devices')
  const res = await rest(`simblip_devices?id=eq.${deviceId()}&select=id,pending_pull`)
  const [row] = (await res.json()) as { id: string; pending_pull: string[] }[]
  const ids = row?.pending_pull ?? []
  if (ids.length === 0) return 0

  const token = getAccessToken()
  for (const id of ids) {
    const blob = await getFile(id) // reseeds OPFS + local manifest as a side effect
    if (!blob) continue
    if (token) {
      // Best-effort: a failed delete here leaves a small Blob leftover under
      // the 1GB budget rather than losing the file — acceptable, and the
      // next successful device sync for this id will retry the delete since
      // the manifest row (and thus the id) is unaffected either way.
      await fetch(`/api/storage/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(
        () => {}
      )
    }
  }
  await rest(`simblip_devices?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ pending_pull: [] }) })
  return ids.length
}
