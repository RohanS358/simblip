'use client'

// Cloud sync: Supabase (PostgREST over fetch — zero dependencies).
//
// Offline-first by design. Without NEXT_PUBLIC_SUPABASE_URL/ANON_KEY the
// module is dormant and SIMBLIP keeps persisting to localStorage exactly as
// before (that IS offline mode). With credentials present:
//
//   boot   → pull the workspace; if the cloud copy is newer than anything
//            this browser has synced, adopt it; otherwise push local state.
//   change → notebooks tree and dirty pages are debounce-pushed (2 s).
//   delete → pages removed locally are removed remotely.
//
// Conflict policy is last-write-wins per row, which is right for a
// single-user notebook synced across devices. Schema: supabase/schema.sql.

import { create } from 'zustand'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { uid } from '@/lib/scene/types'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const syncConfigured = Boolean(URL_ && KEY)

export type SyncPhase = 'offline' | 'syncing' | 'synced' | 'error'

interface SyncState {
  phase: SyncPhase
  lastError: string | null
  lastSyncedAt: number | null
}

export const useSyncStore = create<SyncState>(() => ({
  phase: 'offline',
  lastError: null,
  lastSyncedAt: null,
}))

const setPhase = (phase: SyncPhase, lastError: string | null = null) =>
  useSyncStore.setState({ phase, lastError, ...(phase === 'synced' ? { lastSyncedAt: Date.now() } : {}) })

// ── Identity ────────────────────────────────────────────────────────────────
// No auth yet: a stable per-user workspace id minted on first run. Signing
// in later just means replacing this with the Supabase auth user id.

const WS_KEY = 'simblip-sync-workspace'
const SEEN_KEY = 'simblip-sync-seen' // newest remote updated_at we've applied/produced

export function workspaceId(): string {
  let id = localStorage.getItem(WS_KEY)
  if (!id) {
    id = uid()
    localStorage.setItem(WS_KEY, id)
  }
  return id
}

// ── REST helpers ────────────────────────────────────────────────────────────

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY!,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res
}

const upsert = (table: string, rows: unknown) =>
  rest(table, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })

// ── Pull / push ─────────────────────────────────────────────────────────────

async function pull(ws: string) {
  const [wsRes, pgRes] = await Promise.all([
    rest(`simblip_workspaces?id=eq.${ws}&select=notebooks,updated_at`),
    rest(`simblip_pages?workspace_id=eq.${ws}&select=id,content,viewport,updated_at`),
  ])
  const wsRows = (await wsRes.json()) as { notebooks: unknown; updated_at: string }[]
  const pgRows = (await pgRes.json()) as {
    id: string
    content: unknown
    viewport: unknown
    updated_at: string
  }[]
  if (wsRows.length === 0) return null
  const newest = Math.max(
    Date.parse(wsRows[0].updated_at),
    ...pgRows.map((r) => Date.parse(r.updated_at))
  )
  return { notebooks: wsRows[0].notebooks, pages: pgRows, newest }
}

async function pushWorkspace(ws: string) {
  const { notebooks } = useWorkspaceStore.getState()
  await upsert('simblip_workspaces', [{ id: ws, notebooks, updated_at: new Date().toISOString() }])
}

async function pushPages(ws: string, pageIds: string[]) {
  const { pages, viewports } = useDocStore.getState()
  const rows = pageIds
    .filter((id) => pages[id])
    .map((id) => ({
      id,
      workspace_id: ws,
      content: pages[id],
      viewport: viewports[id] ?? null,
      updated_at: new Date().toISOString(),
    }))
  if (rows.length > 0) await upsert('simblip_pages', rows)
}

const deletePages = (ws: string, ids: string[]) =>
  Promise.all(
    ids.map((id) => rest(`simblip_pages?id=eq.${id}&workspace_id=eq.${ws}`, { method: 'DELETE' }))
  )

// ── Engine ──────────────────────────────────────────────────────────────────

let started = false

export function startSync() {
  if (started || !syncConfigured || typeof window === 'undefined') return
  started = true
  const ws = workspaceId()

  const dirtyPages = new Set<string>()
  const deletedPages = new Set<string>()
  let workspaceDirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing = false

  const flush = async () => {
    timer = null
    if (flushing) {
      schedule() // a push is in flight; run again after
      return
    }
    flushing = true
    setPhase('syncing')
    const pageBatch = [...dirtyPages]
    const delBatch = [...deletedPages]
    const wsBatch = workspaceDirty
    dirtyPages.clear()
    deletedPages.clear()
    workspaceDirty = false
    try {
      // Workspace row must exist before pages reference it.
      if (wsBatch || pageBatch.length > 0) await pushWorkspace(ws)
      await pushPages(ws, pageBatch)
      if (delBatch.length > 0) await deletePages(ws, delBatch)
      localStorage.setItem(SEEN_KEY, String(Date.now()))
      setPhase('synced')
    } catch (err) {
      // Re-queue so nothing is lost; next change retries.
      pageBatch.forEach((id) => dirtyPages.add(id))
      delBatch.forEach((id) => deletedPages.add(id))
      workspaceDirty ||= wsBatch
      setPhase('error', err instanceof Error ? err.message : String(err))
    } finally {
      flushing = false
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 2000)
  }

  useDocStore.subscribe((s, prev) => {
    if (s.pages === prev.pages) return
    for (const id of Object.keys(s.pages)) {
      if (s.pages[id] !== prev.pages[id]) dirtyPages.add(id)
    }
    for (const id of Object.keys(prev.pages)) {
      if (!s.pages[id]) {
        dirtyPages.delete(id)
        deletedPages.add(id)
      }
    }
    schedule()
  })

  useWorkspaceStore.subscribe((s, prev) => {
    if (s.notebooks === prev.notebooks) return
    workspaceDirty = true
    schedule()
  })

  // Boot reconcile: adopt the cloud copy only if it's newer than anything
  // this browser has synced before — otherwise our local state wins.
  ;(async () => {
    setPhase('syncing')
    try {
      const remote = await pull(ws)
      const seen = Number(localStorage.getItem(SEEN_KEY) ?? 0)
      if (remote && remote.newest > seen) {
        useWorkspaceStore.setState({ notebooks: remote.notebooks as never })
        useDocStore.setState((s) => {
          const pages = { ...s.pages }
          const viewports = { ...s.viewports }
          for (const row of remote.pages) {
            pages[row.id] = row.content as never
            if (row.viewport) viewports[row.id] = row.viewport as never
          }
          return { pages, viewports }
        })
        localStorage.setItem(SEEN_KEY, String(remote.newest))
      } else {
        // First device, or we're already ahead: publish everything local.
        workspaceDirty = true
        Object.keys(useDocStore.getState().pages).forEach((id) => dirtyPages.add(id))
        schedule()
      }
      setPhase('synced')
    } catch (err) {
      setPhase('error', err instanceof Error ? err.message : String(err))
    }
  })()
}
