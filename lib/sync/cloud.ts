'use client'

// Notebook cloud sync: the app's own Postgres gateway (/api/pg) over fetch.
//
// Offline-first. Without NEXT_PUBLIC_CLOUD=1 the module is dormant and
// SIMBLIP persists to localStorage only (local demo mode). With a cloud
// deployment, the model is per-USER and driven by the platform auth store
// (lib/auth/store.ts — JWT password sessions against /api/auth):
//
//   sign-in → pull that user's workspace; if the cloud copy is newer than
//             anything this browser has synced for that user, adopt it;
//             otherwise publish local state.
//   change  → notebooks tree and dirty pages debounce-push (2 s).
//   delete  → pages removed locally are removed remotely.
//   signed out → nothing syncs; the app is plain offline/local.
//
// Row security: workspace id IS the auth user id, enforced by the gateway
// (app/api/pg, db/schema.sql). Conflicts are last-write-wins per row.

import { create } from 'zustand'
import { useDocStore } from '@/lib/store/document'
import * as archive from '@/lib/store/page-archive'
import {
  drainPageDeletions,
  onPageDeleted,
  requeuePageDeletions,
} from '@/lib/store/deleted-pages'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { migrateNotebooksToNodes } from '@/lib/store/migrate-tree'
import type { Node } from '@/lib/scene/types'
import { getAccessToken, useAuthStore } from '@/lib/auth/store'
import { cloudConfigured } from '@/lib/data/db'
import { onReconnect } from '@/lib/sync/connectivity'

export const syncConfigured = cloudConfigured

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
// Authentication is mandatory: the workspace id IS the signed-in profile id.

/** newest remote updated_at we've applied/produced, per user */
const seenKey = (ws: string) => `simblip-sync-seen:${ws}`

export function workspaceId(): string | null {
  return useAuthStore.getState().profile?.id ?? null
}

// ── REST helpers ────────────────────────────────────────────────────────────

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const res = await fetch(`/api/pg/${path}`, {
    ...init,
    headers: {
      // The user's JWT, so the gateway scopes every row to the signed-in profile.
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`Sync ${res.status}: ${await res.text()}`)
  return res
}

const upsert = (table: string, rows: unknown) =>
  rest(table, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })

// ── Pull / push ─────────────────────────────────────────────────────────────

async function pull(ws: string, sinceMs: number) {
  // Pages haven't changed remotely since our last sync are already reflected
  // in the local archive — refetching them would re-download the full
  // (potentially hundreds-of-KB, image-bearing) content column for every
  // page in the workspace on every sign-in/reconcile. Filtering to rows
  // touched after our last-seen timestamp keeps this to just what's new.
  const since = new Date(sinceMs).toISOString()
  const [wsRes, pgRes] = await Promise.all([
    // Column is still literally named `notebooks` in Postgres (db/schema.sql)
    // — only the in-memory field was renamed to `nodes`, see lib/scene/types.ts.
    rest(`simblip_workspaces?id=eq.${ws}&select=notebooks,updated_at`),
    rest(`simblip_pages?workspace_id=eq.${ws}&updated_at=gt.${since}&select=id,content,viewport,updated_at`),
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
  return { nodes: wsRows[0].notebooks, pages: pgRows, newest }
}

async function pushWorkspace(ws: string) {
  const { nodes } = useWorkspaceStore.getState()
  const institution = useAuthStore.getState().profile?.institution_id ?? 'inst-platform'
  await upsert('simblip_workspaces', [
    // `notebooks` here is the DB column name, not the old field name — see
    // the comment on pull() above.
    { id: ws, institution_id: institution, notebooks: nodes, updated_at: new Date().toISOString() },
  ])
}

async function pushPages(ws: string, pageIds: string[]) {
  const { pages, viewports } = useDocStore.getState()
  const institution = useAuthStore.getState().profile?.institution_id ?? 'inst-platform'
  const rows = pageIds
    .map((id) => {
      // A page edited and then closed is no longer in memory — read its
      // content back from the archive so the last edits still reach the
      // cloud. Without this, switching pages within the 2 s debounce would
      // quietly drop the change.
      const content = pages[id] ?? archive.readPage(id)
      if (!content) return null
      return {
        id,
        workspace_id: ws,
        institution_id: institution,
        content,
        viewport: viewports[id] ?? null,
        updated_at: new Date().toISOString(),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
  if (rows.length > 0) await upsert('simblip_pages', rows)
}

const deletePages = (ws: string, ids: string[]) =>
  Promise.all(
    ids.map((id) => rest(`simblip_pages?id=eq.${id}&workspace_id=eq.${ws}`, { method: 'DELETE' }))
  )

// ── Engine ──────────────────────────────────────────────────────────────────

let started = false
let activeUser: string | null = null

export function startSync() {
  if (started || !syncConfigured || typeof window === 'undefined') return
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
      schedule() // a push is in flight; run again after
      return
    }
    flushing = true
    setPhase('syncing')
    const pageBatch = [...dirtyPages]
    const delBatch = [...deletedPages, ...drainPageDeletions()]
    const wsBatch = workspaceDirty
    dirtyPages.clear()
    deletedPages.clear()
    workspaceDirty = false
    try {
      // Workspace row must exist before pages reference it; deletes touch a
      // disjoint id set so they can run alongside the push instead of after.
      const delPromise = delBatch.length > 0 ? deletePages(ws, delBatch) : Promise.resolve()
      if (wsBatch || pageBatch.length > 0) await pushWorkspace(ws)
      await Promise.all([pushPages(ws, pageBatch), delPromise])
      localStorage.setItem(seenKey(ws), String(Date.now()))
      setPhase('synced')
    } catch (err) {
      // Re-queue so nothing is lost; next change retries.
      pageBatch.forEach((id) => dirtyPages.add(id))
      requeuePageDeletions(delBatch)
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
    // ONLY content changes mark a page dirty. A page disappearing from the
    // map now means "closed to save memory" (lazy loading), NOT "deleted" —
    // inferring deletion from absence here would wipe the notebook from the
    // cloud every time the user switched page. Real deletions arrive through
    // the explicit queue below.
    for (const id of Object.keys(s.pages)) {
      if (s.pages[id] !== prev.pages[id]) dirtyPages.add(id)
    }
    if (dirtyPages.size > 0) schedule()
  })

  onPageDeleted(schedule)

  // A failed flush() re-queues its batch (see the catch above) but nothing
  // else pokes schedule() again until the next unrelated edit — without
  // this, one offline edit followed by silence leaves phase:'error' forever
  // even after connectivity returns. Retry immediately rather than waiting
  // out the 2s debounce, since there's no reason to delay once the network
  // is confirmed back (flush()'s own `flushing` guard still protects against
  // overlap with an in-progress push).
  onReconnect(() => void flush())

  useWorkspaceStore.subscribe((s, prev) => {
    if (s.nodes === prev.nodes) return
    workspaceDirty = true
    schedule()
  })

  // Sign-in reconcile: adopt the user's cloud copy if it's newer than
  // anything this browser has synced for them; otherwise publish local.
  const reconcile = async (ws: string) => {
    setPhase('syncing')
    try {
      const seen = Number(localStorage.getItem(seenKey(ws)) ?? 0)
      const remote = await pull(ws, seen)
      if (remote && remote.newest > seen) {
        // A cloud pull writes `nodes` directly via setState, bypassing
        // zustand's persist/rehydrate lifecycle entirely (this IS that
        // lifecycle's network equivalent) — so the legacy-shape migration
        // has to run here too, not just in workspace.ts's
        // onRehydrateStorage. migrateNotebooksToNodes returns null if the
        // remote data is already in the new Record shape (an old account
        // still on the array shape is the only case that needs migrating).
        const migrated = migrateNotebooksToNodes(remote.nodes) ?? (remote.nodes as Record<string, Node>)
        useWorkspaceStore.setState({ nodes: migrated })
        // Land the pulled content in the ARCHIVE, not in memory — pulling a
        // whole notebook into the store would undo the lazy loading. Only
        // the page the user opens is hydrated (doc store ensurePage reads
        // the archive). The one exception is a page that's already open: it
        // must be refreshed in place, or the canvas would keep showing stale
        // content until the next switch.
        const resident = useDocStore.getState().pages
        const reopen: Record<string, unknown> = {}
        const viewports: Record<string, unknown> = {}
        for (const row of remote.pages) {
          archive.writePage(row.id, row.content as never)
          if (resident[row.id]) reopen[row.id] = row.content
          if (row.viewport) viewports[row.id] = row.viewport
        }
        useDocStore.setState(
          (st) =>
            ({
              pages: { ...st.pages, ...reopen },
              viewports: { ...st.viewports, ...viewports },
            }) as never
        )
        for (const id of Object.keys(reopen)) useDocStore.getState().ensurePage(id)
        localStorage.setItem(seenKey(ws), String(remote.newest))
        setPhase('synced')
      } else {
        // First device for this account, or we're ahead: publish everything.
        // Every page the user HAS — not just the one that happens to be open
        // — which now means asking the archive, since memory holds only the
        // active page.
        workspaceDirty = true
        const all = new Set([
          ...Object.keys(useDocStore.getState().pages),
          ...archive.archivedPageIds(),
        ])
        all.forEach((id) => dirtyPages.add(id))
        schedule()
        setPhase('synced')
      }
    } catch (err) {
      setPhase('error', err instanceof Error ? err.message : String(err))
    }
  }

  // The platform auth store is the single source of identity — boards don't
  // sync notebooks (their pages are temporary presentation copies).
  const follow = () => {
    const profile = useAuthStore.getState().profile
    const ws = profile && profile.role !== 'board' ? profile.id : null
    if (ws && ws !== activeUser) {
      activeUser = ws
      void reconcile(ws)
    } else if (!ws && activeUser) {
      activeUser = null
      setPhase('offline')
    }
  }
  follow()
  useAuthStore.subscribe(follow)
}
