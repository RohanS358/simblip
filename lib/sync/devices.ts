'use client'

// Device presence — powers the cloud icon's "sync with another device" list
// (components/workspace/sync-status.tsx). A device is "online" if its
// simblip_devices row was touched in the last FRESH_WINDOW_MS; each open tab
// re-touches its own row on a timer so the row goes stale within a couple of
// minutes of the tab closing, no explicit sign-off needed.

import { create } from 'zustand'
import { getAccessToken, useAuthStore } from '@/lib/auth/store'
import * as db from '@/lib/data/db'

const DEVICE_ID_KEY = 'simblip-device-id'
const HEARTBEAT_MS = 15_000 // 15 seconds for fast presence responsiveness
export const FRESH_WINDOW_MS = 3 * 60_000 // 3 minutes online window

export interface DeviceRow {
  id: string
  owner_id: string
  label: string
  last_seen_at: string
}

export function deviceId(): string {
  if (typeof window === 'undefined') return 'server'
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

/** Best-effort "Chrome on Mac"-style label — cosmetic only, never parsed. */
function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Browser'
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

async function touch(ownerId: string, institutionId: string) {
  if (db.dbMode === 'cloud') {
    const token = getAccessToken()
    const res = await fetch('/api/pg/simblip_devices', {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
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
    if (!res.ok) throw new Error(`Touch failed ${res.status}`)
  } else {
    await db.insert<db.Row>('devices', {
      id: deviceId(),
      owner_id: ownerId,
      institution_id: institutionId,
      label: deviceLabel(),
      last_seen_at: new Date().toISOString(),
    })
  }
}

interface DevicesState {
  others: DeviceRow[]
  lastRefreshedAt: number | null
}

export const useDevicesStore = create<DevicesState>(() => ({ others: [], lastRefreshedAt: null }))

export async function refreshDevices(explicitOwnerId?: string) {
  const profile = useAuthStore.getState().profile
  const ownerId = explicitOwnerId ?? profile?.id
  if (!ownerId) return

  try {
    let rows: DeviceRow[] = []
    if (db.dbMode === 'cloud') {
      const token = getAccessToken()
      const res = await fetch(`/api/pg/simblip_devices?owner_id=eq.${ownerId}&select=id,owner_id,label,last_seen_at`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (res.ok) {
        rows = (await res.json()) as DeviceRow[]
      }
    } else {
      rows = (await db.list<db.Row>('devices', { owner_id: ownerId })) as unknown as DeviceRow[]
    }
    const cutoff = Date.now() - FRESH_WINDOW_MS
    const self = deviceId()
    useDevicesStore.setState({
      others: rows.filter((r) => r.id !== self && Date.parse(r.last_seen_at) >= cutoff),
      lastRefreshedAt: Date.now(),
    })
  } catch (err) {
    console.warn('[devices] Presence refresh failed:', err)
  }
}

export async function performHeartbeat() {
  const profile = useAuthStore.getState().profile
  if (!profile || profile.role === 'board') return
  try {
    await touch(profile.id, profile.institution_id)
    await refreshDevices(profile.id)
    const { pullPendingFiles } = await import('@/lib/sync/device-file-sync')
    await pullPendingFiles()
  } catch (err) {
    console.warn('[devices] Heartbeat tick failed:', err)
  }
}

let started = false

/** Start the heartbeat + presence poll. Idempotent, follows sign-in state. */
export function startDevicePresence() {
  if (started || typeof window === 'undefined') return
  started = true

  let timer: ReturnType<typeof setInterval> | null = null

  const follow = () => {
    const profile = useAuthStore.getState().profile
    if (profile && profile.role !== 'board') {
      if (!timer) {
        void performHeartbeat()
        timer = setInterval(() => void performHeartbeat(), HEARTBEAT_MS)
      }
    } else if (timer) {
      clearInterval(timer)
      timer = null
      useDevicesStore.setState({ others: [], lastRefreshedAt: null })
    }
  }

  follow()
  useAuthStore.subscribe(follow)
}

