'use client'

// Device presence — powers the cloud icon's "sync with another device" list
// (components/workspace/sync-status.tsx). A device is "online" if its
// simblip_devices row was touched in the last FRESH_WINDOW_MS; each open tab
// re-touches its own row on a timer so the row goes stale within a couple of
// minutes of the tab closing, no explicit sign-off needed.
//
// This is presence only — actually moving files between two devices once
// they've found each other is lib/sync/device-file-sync.ts.

import { create } from 'zustand'
import { getAccessToken, useAuthStore } from '@/lib/auth/store'
import { syncConfigured } from '@/lib/sync/cloud'

const DEVICE_ID_KEY = 'simblip-device-id'
const HEARTBEAT_MS = 60_000
export const FRESH_WINDOW_MS = 3 * 60_000

export interface DeviceRow {
  id: string
  owner_id: string
  label: string
  last_seen_at: string
}

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

/** Best-effort "Chrome on Mac"-style label — cosmetic only, never parsed. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

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
  if (!res.ok) throw new Error(`Devices ${res.status}: ${await res.text()}`)
  return res
}

async function touch(ownerId: string, institutionId: string) {
  await rest('simblip_devices', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([
      {
        id: deviceId(),
        owner_id: ownerId,
        institution_id: institutionId,
        label: deviceLabel(),
        last_seen_at: new Date().toISOString(),
      },
    ]),
  })
}

interface DevicesState {
  others: DeviceRow[]
}

export const useDevicesStore = create<DevicesState>(() => ({ others: [] }))

async function refresh(ownerId: string) {
  const res = await rest(`simblip_devices?owner_id=eq.${ownerId}&select=id,owner_id,label,last_seen_at`)
  const rows = (await res.json()) as DeviceRow[]
  const cutoff = Date.now() - FRESH_WINDOW_MS
  const self = deviceId()
  useDevicesStore.setState({
    others: rows.filter((r) => r.id !== self && Date.parse(r.last_seen_at) >= cutoff),
  })
}

let started = false

/** Start the heartbeat + presence poll. Idempotent, follows sign-in state
 *  the same way lib/sync/cloud.ts's startSync() does. Safe to call whether
 *  or not cloud is configured — it's a no-op otherwise. */
export function startDevicePresence() {
  if (started || !syncConfigured || typeof window === 'undefined') return
  started = true

  let timer: ReturnType<typeof setInterval> | null = null

  const tick = () => {
    const profile = useAuthStore.getState().profile
    if (!profile || profile.role === 'board') return
    void touch(profile.id, profile.institution_id).catch(() => {})
    void refresh(profile.id).catch(() => {})
    void import('@/lib/sync/device-file-sync').then(({ pullPendingFiles }) => pullPendingFiles()).catch(() => {})
  }

  const follow = () => {
    const profile = useAuthStore.getState().profile
    if (profile && profile.role !== 'board') {
      if (!timer) {
        tick()
        timer = setInterval(tick, HEARTBEAT_MS)
      }
    } else if (timer) {
      clearInterval(timer)
      timer = null
      useDevicesStore.setState({ others: [] })
    }
  }
  follow()
  useAuthStore.subscribe(follow)
}
