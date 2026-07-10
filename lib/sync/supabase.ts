'use client'

// Cloud sync + auth: Supabase with Google sign-in.
//
// Offline-first. Without NEXT_PUBLIC_SUPABASE_URL/ANON_KEY the module is
// dormant and SIMBLIP persists to localStorage only (offline mode). With
// credentials, the model is per-USER: sign in with Google and your
// notebooks live under your account — sign in anywhere to get them back.
//
//   sign-in → pull that user's workspace; if the cloud copy is newer than
//             anything this browser has synced for that user, adopt it;
//             otherwise publish local state.
//   change  → notebooks tree and dirty pages debounce-push (2 s).
//   delete  → pages removed locally are removed remotely.
//   signed out → nothing syncs; the app is plain offline/local.
//
// Row security: workspace id IS the auth user id, enforced by RLS
// (supabase/schema.sql). Conflicts are last-write-wins per row.

import { create } from 'zustand'

import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { getAccessToken, useAuthStore } from '@/lib/auth/store'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const syncConfigured = Boolean(URL_ && KEY)

export type SyncPhase = 'offline' | 'syncing' | 'synced' | 'error'

export interface SyncUser {
  id: string
  email: string
  name: string
  avatarUrl: string
}

interface SyncState {
  phase: SyncPhase
  lastError: string | null
  lastSyncedAt: number | null
  user: SyncUser | null
}

export const useSyncStore = create<SyncState>(() => ({
  phase: 'offline',
  lastError: null,
  lastSyncedAt: null,
  user: null,
}))

const setPhase = (phase: SyncPhase, lastError: string | null = null) =>
  useSyncStore.setState({ phase, lastError, ...(phase === 'synced' ? { lastSyncedAt: Date.now() } : {}) })

// ── Identity ────────────────────────────────────────────────────────────────
// Authentication is mandatory: the workspace id IS the signed-in profile id,
// and the RLS policies only let a user touch their own workspace row.

/** newest remote updated_at we've applied/produced, per user */
const seenKey = (ws: string) => `simblip-sync-seen:${ws}`

export function workspaceId(): string | null {
  return useAuthStore.getState().profile?.id ?? null
}

// ── REST helpers ────────────────────────────────────────────────────────────

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY!,
      // The user's JWT, so RLS scopes every row to the signed-in profile.
      Authorization: `Bearer ${getAccessToken() ?? KEY}`,
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
  const qWs = `id=eq.${encodeURIComponent(ws)}`
  const qPg = `workspace_id=eq.${encodeURIComponent(ws)}`
  const [wsRes, pgRes] = await Promise.all([
    rest(`simblip_workspaces?select=notebooks,updated_at&${qWs}`),
    rest(`simblip_pages?select=id,content,viewport,updated_at&${qPg}`),
  ])
  const wsData = await wsRes.json()
  const pgData = await pgRes.json()
  
  if (!wsData || wsData.length === 0) return null
  const pages = pgData ?? []
  const newest = Math.max(
    Date.parse(wsData[0].updated_at),
    ...pages.map((r: any) => Date.parse(r.updated_at))
  )
  return { notebooks: wsData[0].notebooks, pages, newest }
}

async function pushWorkspace(ws: string) {
  const { notebooks } = useWorkspaceStore.getState()
  const institution = useAuthStore.getState().profile?.institution_id
  await upsert('simblip_workspaces', [
    { id: ws, institution_id: institution, notebooks, updated_at: new Date().toISOString() },
  ])
}

async function pushPages(ws: string, pageIds: string[]) {
  const { pages, viewports } = useDocStore.getState()
  const institution = useAuthStore.getState().profile?.institution_id
  const rows = pageIds
    .filter((id) => pages[id])
    .map((id) => ({
      id,
      workspace_id: ws,
      institution_id: institution,
      content: pages[id],
      viewport: viewports[id] ?? null,
      updated_at: new Date().toISOString(),
    }))
  if (rows.length === 0) return
  await upsert('simblip_pages', rows)
}

async function deletePages(ws: string, ids: string[]) {
  for (const id of ids) {
    const qId = `id=eq.${encodeURIComponent(id)}`
    const qWs = `workspace_id=eq.${encodeURIComponent(ws)}`
    await rest(`simblip_pages?${qId}&${qWs}`, { method: 'DELETE' })
  }
}

// ── Engine ──────────────────────────────────────────────────────────────────

let started = false
let activeUser: string | null = null

export function startSync() {
  if (started || !syncConfigured || typeof window === 'undefined') return
  const ws = workspaceId()
  if (!ws) return // not signed in yet; the shell retries after auth
  started = true

  const dirtyPages = new Set<string>()
  const deletedPages = new Set<string>()
  let workspaceDirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing = false

  const flush = async () => {
    timer = null
    const ws = activeUser
    if (!ws) return // signed out: keep the dirty sets for the next sign-in
    if (flushing) {
      schedule()
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
      localStorage.setItem(seenKey(ws), String(Date.now()))
      setPhase('synced')
    } catch (err) {
      pageBatch.forEach((id) => dirtyPages.add(id))
      delBatch.forEach((id) => deletedPages.add(id))
      workspaceDirty ||= wsBatch
      setPhase('error', err instanceof Error ? err.message : String(err))
    } finally {
      flushing = false
    }
  }

  const schedule = () => {
    if (!activeUser) return
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

  // Sign-in reconcile: adopt the user's cloud copy if it's newer than
  // anything this browser has synced for them; otherwise publish local.
  const reconcile = async (ws: string) => {
    setPhase('syncing')
    try {
      const remote = await pull(ws)
      const seen = Number(localStorage.getItem(seenKey(ws)) ?? 0)
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
        localStorage.setItem(seenKey(ws), String(remote.newest))
      } else {
        // First device for this account, or we're ahead: publish everything.
        workspaceDirty = true
        Object.keys(useDocStore.getState().pages).forEach((id) => dirtyPages.add(id))
        schedule()
        setPhase('synced')
      }
    } catch (err) {
      setPhase('error', err instanceof Error ? err.message : String(err))
    }
  }

  useAuthStore.subscribe((s, prev) => {
    const u = s.profile
    useSyncStore.setState({
      user: u
        ? {
            id: u.id,
            email: u.email ?? '',
            name: u.full_name ?? u.email ?? 'Account',
            avatarUrl: u.avatar_url ?? '',
          }
        : null,
    })
    if (u && u.id !== activeUser) {
      activeUser = u.id
      void reconcile(u.id)
    } else if (!u) {
      activeUser = null
      setPhase('offline')
    }
  })
}
