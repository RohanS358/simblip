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
import { createClient } from '@supabase/supabase-js'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = URL_ && KEY ? createClient(URL_, KEY) : null
export const syncConfigured = Boolean(supabase)

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

// ── Auth actions (used by the header account button) ────────────────────────
// Plain Supabase email auth — no external OAuth provider to configure.
// Both return an error message for the form, or null on success.

export async function signInWithEmail(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sync is not configured.'
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error ? error.message : null
}

export async function signUpWithEmail(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Sync is not configured.'
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) return error.message
  // With "Confirm email" enabled there's no session yet — tell the user.
  if (!data.session) return 'Check your inbox to confirm the address, then sign in.'
  return null
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
}

// ── Pull / push (rows keyed by the auth user id) ────────────────────────────

const seenKey = (ws: string) => `simblip-sync-seen-${ws}`

async function pull(ws: string) {
  const [wsRes, pgRes] = await Promise.all([
    supabase!.from('simblip_workspaces').select('notebooks,updated_at').eq('id', ws),
    supabase!.from('simblip_pages').select('id,content,viewport,updated_at').eq('workspace_id', ws),
  ])
  if (wsRes.error) throw new Error(wsRes.error.message)
  if (pgRes.error) throw new Error(pgRes.error.message)
  if (!wsRes.data || wsRes.data.length === 0) return null
  const pages = pgRes.data ?? []
  const newest = Math.max(
    Date.parse(wsRes.data[0].updated_at),
    ...pages.map((r) => Date.parse(r.updated_at))
  )
  return { notebooks: wsRes.data[0].notebooks, pages, newest }
}

async function pushWorkspace(ws: string) {
  const { notebooks } = useWorkspaceStore.getState()
  const { error } = await supabase!
    .from('simblip_workspaces')
    .upsert([{ id: ws, notebooks, updated_at: new Date().toISOString() }])
  if (error) throw new Error(error.message)
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
  if (rows.length === 0) return
  // Composite key: a page id can exist under many accounts; conflicts are
  // resolved only within this user's workspace.
  const { error } = await supabase!.from('simblip_pages').upsert(rows, { onConflict: 'workspace_id,id' })
  if (error) throw new Error(error.message)
}

async function deletePages(ws: string, ids: string[]) {
  for (const id of ids) {
    const { error } = await supabase!
      .from('simblip_pages')
      .delete()
      .eq('id', id)
      .eq('workspace_id', ws)
    if (error) throw new Error(error.message)
  }
}

// ── Engine ──────────────────────────────────────────────────────────────────

let started = false
let activeUser: string | null = null

export function startSync() {
  if (started || !supabase || typeof window === 'undefined') return
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
        setPhase('synced')
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

  supabase.auth.onAuthStateChange((_event, session) => {
    const u = session?.user ?? null
    useSyncStore.setState({
      user: u
        ? {
            id: u.id,
            email: u.email ?? '',
            name: (u.user_metadata?.full_name as string) ?? u.email ?? 'Account',
            avatarUrl: (u.user_metadata?.avatar_url as string) ?? '',
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
