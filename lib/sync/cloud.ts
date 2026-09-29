'use client'

// Notebook cloud sync — offline-first, automatic, quota-aware.
//
// WHAT syncs (see lib/sync/page-sync.ts for the per-page modes):
//   mandatory — the notebook tree, every page's content unless the user kept
//               that page local, and account data (calendar events, to-dos,
//               sticky notes). Small, essential, on by default.
//   optional  — file bytes (PDF/PPTX/image sources): only when opted in,
//               handled by lib/sync/device-file-sync.ts + /api/storage.
//   local     — device prefs, input settings, caches: never leave the device.
//
// HOW (all through /api/sync, one transaction per push on the server):
//   • Every local change lands in the local archive immediately (page-archive
//     — localStorage cache + IndexedDB durable tier) and its id joins a
//     PERSISTED dirty set, so a closed tab, crash or offline spell never
//     loses a pending change.
//   • Pushes are incremental: only dirty pages, only if their content
//     fingerprint changed since the last successful push, in size-bounded
//     batches.
//   • Each row carries the server revision the edit was based on. A stale base
//     is a conflict: page content keeps the local edit and saves the other
//     device's version as a clearly named copy — nothing is overwritten
//     silently. The tree and the calendar are merged three-way against the
//     last agreed copy (lib/sync/merge.ts), so additions and deletions from
//     both devices survive.
//   • Pulls are incremental (server-clock cursor) and run on sign-in, on
//     focus, on reconnect and every minute while visible.
//   • Failures retry with exponential backoff; going offline just leaves
//     changes queued ('pending'); hitting the 150 MB quota stops pushing and
//     says so ('quota') without discarding anything.

import { create } from 'zustand'
import { toast } from 'sonner'
import { useDocStore } from '@/lib/store/document'
import * as archive from '@/lib/store/page-archive'
import { drainPageDeletions, onPageDeleted, requeuePageDeletions, pendingPageDeletions } from '@/lib/store/deleted-pages'
import { stripWebCache, useWorkspaceStore } from '@/lib/store/workspace'
import { useNotesGallery, type GalleryEvent, type GalleryNote, type GalleryTodo } from '@/lib/store/notes-gallery'
import { migrateNotebooksToNodes } from '@/lib/store/migrate-tree'
import type { Node, PageNode } from '@/lib/scene/types'
import { getAccessToken, useAuthStore } from '@/lib/auth/store'
import { cloudConfigured } from '@/lib/data/db'
import { onReconnect } from '@/lib/sync/connectivity'
import { contentIdsOf, stampSyncedContent, syncedContentIds } from '@/lib/sync/page-sync'
import { splitPulledTree } from '@/lib/sync/tree-visibility'
import { canonicalJSON, fingerprint, mergeById, threeWayMerge } from '@/lib/sync/merge'
import { PROJECT_QUOTA_BYTES, jsonBytes } from '@/lib/storage/quota'

export const syncConfigured = cloudConfigured

export type SyncPhase =
  | 'offline' // signed out / not configured
  | 'paused' // user paused sync on this device
  | 'pending' // changes queued, no connection
  | 'syncing'
  | 'synced'
  | 'error' // retrying with backoff
  | 'quota' // cloud storage full — nothing more uploads until space is freed

interface SyncState {
  phase: SyncPhase
  lastError: string | null
  lastSyncedAt: number | null
  /** Changes waiting to reach the cloud (pages + tree + account data). */
  pending: number
  /** Server-reported usage from the last push (never computed client-side). */
  usage: { used: number; limit: number } | null
  /** Conflicts resolved by keeping both copies, this session. */
  conflictsKept: number
  paused: boolean
}

const PAUSE_KEY = 'simblip-sync-paused' // device-local on purpose

export const useSyncStore = create<SyncState>(() => ({
  phase: 'offline',
  lastError: null,
  lastSyncedAt: null,
  pending: 0,
  usage: null,
  conflictsKept: 0,
  paused: typeof window !== 'undefined' && localStorage.getItem(PAUSE_KEY) === '1',
}))

const setPhase = (phase: SyncPhase, lastError: string | null = null) =>
  useSyncStore.setState({ phase, lastError, ...(phase === 'synced' ? { lastSyncedAt: Date.now() } : {}) })

export function workspaceId(): string | null {
  return useAuthStore.getState().profile?.id ?? null
}

// ── Persisted per-user sync ledger ──────────────────────────────────────────

interface Ledger {
  /** server-clock cursor for incremental pulls */
  since: string | null
  after: string
  /** server rev each page's local copy is based on */
  revs: Record<string, number>
  /** fingerprint of what we last pushed / pulled, per page */
  prints: Record<string, string>
  treeRev: number | null
  kvRevs: Record<string, number>
  dirty: string[]
  treeDirty: boolean
  kvDirty: string[]
  /** pages refused as too large; retried only when their content changes */
  tooLarge: Record<string, string>
}

const emptyLedger = (): Ledger => ({
  since: null,
  after: '',
  revs: {},
  prints: {},
  treeRev: null,
  kvRevs: {},
  dirty: [],
  treeDirty: false,
  kvDirty: [],
  tooLarge: {},
})

const ledgerKey = (ws: string) => `simblip-sync-ledger:${ws}`
const baseKey = (ws: string, part: string) => `simblip-sync-base:${ws}:${part}`

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full. The base copies are an optimisation (without one the
    // merge degrades to an additive union — never lossy), and the ledger is
    // rebuilt from a full pull, so dropping the write loses no user data.
  }
}

// ── Tree / account-data normalisation ───────────────────────────────────────

/** A node as it travels: no per-device web caches, no wire-only stamp. */
function wireNode(n: Node): Node {
  if (n.kind !== 'page') return n
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { syncedContent: _s, ...rest } = n as PageNode
  return stripWebCache({ [n.id]: rest as Node })[n.id]
}
const nodeEq = (a: Node, b: Node) => canonicalJSON(wireNode(a)) === canonicalJSON(wireNode(b))

/** The account data that syncs. Image notes are files (bytes in OPFS) and
 *  stay on the device that has them. */
interface GalleryKv {
  notes: GalleryNote[]
  todos: GalleryTodo[]
  events: GalleryEvent[]
  eventColors: string[]
}
const GALLERY_KEY = 'gallery'

function galleryKv(): GalleryKv {
  const s = useNotesGallery.getState()
  return {
    notes: s.notes.filter((n) => n.kind === 'sticky'),
    todos: s.todos,
    events: s.events.filter((e) => !e.holiday),
    eventColors: s.eventColors,
  }
}

function mergeGallery(base: GalleryKv | null, local: GalleryKv, remote: GalleryKv): GalleryKv {
  return {
    notes: mergeById(base?.notes ?? null, local.notes, remote.notes ?? []),
    todos: mergeById(base?.todos ?? null, local.todos, remote.todos ?? []),
    events: mergeById(base?.events ?? null, local.events, remote.events ?? []),
    eventColors: [...new Set([...(local.eventColors ?? []), ...(remote.eventColors ?? [])])].slice(-12),
  }
}

// ── REST ────────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>
  ) {
    super(`Sync ${status}: ${String(body.error ?? '')}`)
  }
}

async function api<T>(init: RequestInit & { query?: string } = {}): Promise<T> {
  const token = getAccessToken()
  const res = await fetch(`/api/sync${init.query ?? ''}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    throw new HttpError(res.status, body)
  }
  return (await res.json()) as T
}

interface PullResponse {
  now: string
  after: string
  more: boolean
  workspace: { tree: unknown; rev: number } | null
  pages: { id: string; content: unknown; viewport: unknown; rev: number }[]
  kv: { key: string; value: unknown; rev: number }[]
  serverPages: Record<string, number>
}

interface PushResponse {
  workspace: { rev: number } | { conflict: { tree: unknown; rev: number } } | null
  revs: Record<string, number>
  conflicts: { id: string; content: unknown; viewport: unknown; rev: number }[]
  kv: Record<string, number>
  kvConflicts: { key: string; value: unknown; rev: number }[]
  usage: { used: number; limit: number }
}

// ── Engine ──────────────────────────────────────────────────────────────────

let started = false
let activeUser: string | null = null
let ledger: Ledger = emptyLedger()
/** true while we apply remote data, so our own store writes aren't mistaken
 *  for user edits and echoed straight back to the server */
let applyingRemote = false
let kick: (() => void) | null = null
let pullNow: (() => Promise<void>) | null = null

const saveLedger = () => {
  if (!activeUser) return
  writeJSON(ledgerKey(activeUser), ledger)
  useSyncStore.setState({
    pending: ledger.dirty.length + (ledger.treeDirty ? 1 : 0) + ledger.kvDirty.length + pendingPageDeletions().length,
  })
}

/** The whole tree this device carries: what it shows plus what it only holds
 *  for other devices (lib/sync/tree-visibility.ts). */
const fullTree = (): Record<string, Node> => {
  const { nodes, hiddenNodes } = useWorkspaceStore.getState()
  return { ...hiddenNodes, ...nodes }
}

const pagePrint = (content: unknown, viewport: unknown) => fingerprint([content, viewport ?? null])

/** Pause/resume sync on THIS device. Changes keep queueing while paused. */
export function setSyncPaused(paused: boolean): void {
  try {
    if (paused) localStorage.setItem(PAUSE_KEY, '1')
    else localStorage.removeItem(PAUSE_KEY)
  } catch {
    /* preference only */
  }
  useSyncStore.setState({ paused })
  if (paused) setPhase('paused')
  else kick?.()
}

/** Run a pull + push right now (Sync status "Sync now"). */
export async function syncNow(): Promise<void> {
  await pullNow?.()
  kick?.()
}

/** Owner page (tree node) of a content id — itself, or the page whose
 *  satellite canvas (sheet, slide, PDF notes/ink) it is. */
function ownerPageOf(nodes: Record<string, Node>, contentId: string): PageNode | null {
  const direct = nodes[contentId]
  if (direct?.kind === 'page') return direct
  for (const n of Object.values(nodes)) {
    if (n.kind === 'page' && contentIdsOf(n).includes(contentId)) return n
  }
  return null
}

/** Nothing on it worth a copy: no objects and no body text. Forking a blank
 *  page against a real one only litters the tree with "(other device's
 *  version)" duplicates — the real one just wins. */
const isBlankContent = (c: unknown): boolean => {
  const p = c as { objects?: Record<string, unknown>; flow?: string } | null
  return !p || (Object.keys(p.objects ?? {}).length === 0 && !(p.flow ?? '').includes('"text"'))
}

/** Keep BOTH versions of a page edited on two devices: the local edit stays
 *  where it is; the other device's version becomes a new page next to it. */
function keepConflictCopy(contentId: string, remoteContent: unknown): void {
  const ws = useWorkspaceStore.getState()
  const owner = ownerPageOf(ws.nodes, contentId)
  const parentId = owner?.parentId ?? Object.values(ws.nodes).find((n) => n.kind === 'folder' && !n.parentId)?.id
  if (!parentId) return
  const label = owner?.name ?? 'Page'
  const sheetNote = owner && owner.id !== contentId ? ' sheet' : ''
  const copyId = ws.addPageIn(parentId, `${label}${sheetNote} (other device's version)`, 'board', false)
  archive.writePage(copyId, remoteContent as never)
  ledger.dirty = [...new Set([...ledger.dirty, copyId])]
  useSyncStore.setState((s) => ({ conflictsKept: s.conflictsKept + 1 }))
  toast.message('Edited on two devices — both versions kept', {
    description: `The other device's version of “${label}” is saved as a separate page.`,
  })
}

/** Adopt a tree: merged three-way against the last agreed copy, then split
 *  into shown/hidden for this device. Returns true if local had changes the
 *  remote lacks (so the merged tree must be pushed back). */
function applyTree(ws: string, remoteRaw: unknown, rev: number): boolean {
  const remote = migrateNotebooksToNodes(remoteRaw) ?? ((remoteRaw ?? {}) as Record<string, Node>)
  const base = readJSON<Record<string, Node>>(baseKey(ws, 'tree'))
  const local = fullTree()
  const merged = threeWayMerge(base, local, remote, nodeEq)
  // Per-device web caches survive the merge on the device that has them.
  for (const [id, n] of Object.entries(merged)) {
    const mine = local[id] as PageNode | undefined
    if (n.kind === 'page' && mine?.kind === 'page' && (mine.webCachedHtml || mine.webCachedText)) {
      merged[id] = { ...n, webCachedHtml: mine.webCachedHtml, webCachedText: mine.webCachedText } as Node
    }
    // Keep the remote stamp for visibility decisions.
    const r = remote[id] as PageNode | undefined
    if (n.kind === 'page' && r?.kind === 'page' && r.syncedContent !== undefined) {
      merged[id] = { ...merged[id], syncedContent: r.syncedContent } as Node
    }
  }
  const ws0 = useWorkspaceStore.getState()
  const split = splitPulledTree(merged, ws0.nodes, ws0.cloudNodeIds)
  // A page that WAS visible and is now hidden means its owner switched it to
  // "keep local" elsewhere; its cloud rows are gone, so drop the mirror here.
  for (const id of Object.keys(split.hiddenNodes)) {
    if (ws0.nodes[id] && archive.hasPage(id)) archive.dropPage(id)
  }
  applyingRemote = true
  try {
    useWorkspaceStore.setState({ nodes: split.nodes, hiddenNodes: split.hiddenNodes, cloudNodeIds: split.cloudNodeIds })
    useWorkspaceStore.getState().pruneMissingPages()
  } finally {
    applyingRemote = false
  }
  writeJSON(baseKey(ws, 'tree'), remote)
  ledger.treeRev = rev
  const ids = new Set([...Object.keys(merged), ...Object.keys(remote)])
  for (const id of ids) {
    const m = merged[id]
    const r = remote[id]
    if (!m || !r || !nodeEq(m, r)) return true
  }
  return false
}

function applyGallery(ws: string, remote: GalleryKv, rev: number): boolean {
  const base = readJSON<GalleryKv>(baseKey(ws, `kv:${GALLERY_KEY}`))
  const local = galleryKv()
  const merged = mergeGallery(base, local, remote)
  applyingRemote = true
  try {
    useNotesGallery.setState((s) => ({
      // image notes are this device's own and pass through untouched
      notes: [...merged.notes, ...s.notes.filter((n) => n.kind !== 'sticky')],
      todos: merged.todos,
      events: merged.events,
      eventColors: merged.eventColors,
    }))
  } finally {
    applyingRemote = false
  }
  writeJSON(baseKey(ws, `kv:${GALLERY_KEY}`), remote)
  ledger.kvRevs[GALLERY_KEY] = rev
  return canonicalJSON(merged) !== canonicalJSON(mergeGallery(null, remote, remote))
}

export function startSync() {
  if (started || !syncConfigured || typeof window === 'undefined') return
  started = true

  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing = false
  let failures = 0
  /** server said sync isn't provisioned (503): no pulls until this time */
  let unavailableUntil = 0

  const schedule = (ms = 2000) => {
    saveLedger()
    if (!activeUser) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), ms)
  }
  kick = () => schedule(0)

  const markDirty = (ids: Iterable<string>) => {
    const set = new Set(ledger.dirty)
    for (const id of ids) set.add(id)
    ledger.dirty = [...set]
  }

  const onFailure = (err: unknown) => {
    if (err instanceof HttpError && err.status === 413 && err.body.error === 'quota_exceeded') {
      useSyncStore.setState({
        usage: { used: Number(err.body.used ?? 0), limit: Number(err.body.limit ?? PROJECT_QUOTA_BYTES) },
      })
      setPhase('quota', 'Cloud storage is full. Your changes are saved on this device.')
      return // no auto-retry: only freeing space or a smaller edit helps
    }
    if (!navigator.onLine) {
      setPhase('pending')
      return // onReconnect resumes
    }
    if (err instanceof HttpError && err.status === 503) {
      // Server not set up for sync yet (migration missing): check back
      // rarely instead of retrying on the usual backoff ladder.
      setPhase('error', 'Cloud sync is not set up on this server yet. Your work is saved on this device.')
      unavailableUntil = Date.now() + 5 * 60_000
      schedule(5 * 60_000)
      return
    }
    failures++
    setPhase('error', err instanceof Error ? err.message : String(err))
    schedule(Math.min(60_000, 2000 * 2 ** failures))
  }

  const flush = async (): Promise<void> => {
    timer = null
    const ws = activeUser
    if (!ws) return
    if (useSyncStore.getState().paused) {
      setPhase('paused')
      return
    }
    if (!navigator.onLine) {
      setPhase('pending')
      return
    }
    if (flushing) {
      schedule()
      return
    }
    flushing = true
    const deletes = drainPageDeletions()
    try {
      setPhase('syncing')
      const tree = fullTree()
      const allowed = syncedContentIds(tree)
      const { pages: resident, viewports } = useDocStore.getState()

      // Collect dirty pages whose content actually changed since last push.
      type Row = { id: string; content: unknown; viewport: unknown; baseRev: number | null; print: string; bytes: number }
      const rows: Row[] = []
      const clean: string[] = []
      for (const id of ledger.dirty) {
        if (!allowed.has(id)) {
          clean.push(id) // kept local (or deleted): nothing to push
          continue
        }
        const content = resident[id] ?? archive.readPage(id) ?? (await archive.readPageDurable(id))
        if (!content) {
          clean.push(id)
          continue
        }
        const viewport = viewports[id] ?? null
        const print = pagePrint(content, viewport)
        if (ledger.prints[id] === print && ledger.revs[id] !== undefined) {
          clean.push(id)
          continue
        }
        if (ledger.tooLarge[id] === print) continue // unchanged since refused
        rows.push({ id, content, viewport, baseRev: ledger.revs[id] ?? null, print, bytes: jsonBytes(content) })
      }
      ledger.dirty = ledger.dirty.filter((id) => !clean.includes(id))

      // Size-bounded batches: ≤ 50 rows / ~8 MB each. The first batch also
      // carries the tree, account data and deletions.
      const batches: Row[][] = []
      let cur: Row[] = []
      let curBytes = 0
      for (const r of rows) {
        if (cur.length > 0 && (cur.length >= 50 || curBytes + r.bytes > 8 * 1024 * 1024)) {
          batches.push(cur)
          cur = []
          curBytes = 0
        }
        cur.push(r)
        curBytes += r.bytes
      }
      if (cur.length > 0 || batches.length === 0) batches.push(cur)

      let pushTree = ledger.treeDirty
      let pushKv = ledger.kvDirty.includes(GALLERY_KEY)
      let pendingDeletes = deletes
      for (const batch of batches) {
        if (batch.length === 0 && !pushTree && !pushKv && pendingDeletes.length === 0) continue
        const treeForPush = pushTree
          ? Object.fromEntries(Object.entries(stampSyncedContent(tree)).map(([id, n]) => [id, stripWebCache({ [id]: n })[id]]))
          : null
        const kvValue = pushKv ? galleryKv() : null
        let res: PushResponse
        try {
          res = await api<PushResponse>({
            method: 'POST',
            body: JSON.stringify({
              deletes: pendingDeletes,
              workspace: treeForPush ? { tree: treeForPush, baseRev: ledger.treeRev } : undefined,
              pages: batch.map((r) => ({ id: r.id, content: r.content, viewport: r.viewport, baseRev: r.baseRev })),
              kv: kvValue ? [{ key: GALLERY_KEY, value: kvValue, baseRev: ledger.kvRevs[GALLERY_KEY] ?? null }] : [],
            }),
          })
        } catch (err) {
          // One oversized page must not block everything else behind it.
          if (err instanceof HttpError && err.status === 413 && err.body.error === 'row_too_large') {
            const bad = batch.find((r) => r.id === err.body.id)
            if (bad) {
              ledger.tooLarge[bad.id] = bad.print
              toast.error('A page is too large to sync', {
                description: 'It stays safe on this device. Large images belong in files, not on the page.',
              })
              schedule(0)
              return
            }
          }
          throw err
        }
        pendingDeletes = []
        // Page results
        for (const r of batch) {
          const rev = res.revs[r.id]
          if (rev === undefined) continue
          ledger.revs[r.id] = rev
          ledger.prints[r.id] = r.print
          delete ledger.tooLarge[r.id]
          if (pagePrint(useDocStore.getState().pages[r.id] ?? r.content, useDocStore.getState().viewports[r.id] ?? null) === r.print) {
            ledger.dirty = ledger.dirty.filter((id) => id !== r.id)
          }
        }
        for (const c of res.conflicts) {
          // Keep both: the other device's version becomes its own page, then
          // this device's edit is written on top of the server's rev.
          if (!isBlankContent(c.content)) keepConflictCopy(c.id, c.content)
          ledger.revs[c.id] = c.rev
        }
        // Tree result
        if (res.workspace && 'conflict' in res.workspace) {
          // Someone else moved the tree on: merge theirs with ours and push
          // the merged tree based on their rev.
          const localChanges = applyTree(ws, res.workspace.conflict.tree, res.workspace.conflict.rev)
          ledger.treeDirty = localChanges
        } else if (res.workspace) {
          ledger.treeRev = res.workspace.rev
          writeJSON(baseKey(ws, 'tree'), treeForPush)
          ledger.treeDirty = false
        }
        pushTree = false
        // Account data result
        if (kvValue) {
          const kc = res.kvConflicts.find((k) => k.key === GALLERY_KEY)
          if (kc) {
            const changed = applyGallery(ws, kc.value as GalleryKv, kc.rev)
            if (!changed) ledger.kvDirty = ledger.kvDirty.filter((k) => k !== GALLERY_KEY)
          } else if (res.kv[GALLERY_KEY] !== undefined) {
            ledger.kvRevs[GALLERY_KEY] = res.kv[GALLERY_KEY]
            writeJSON(baseKey(ws, `kv:${GALLERY_KEY}`), kvValue)
            ledger.kvDirty = ledger.kvDirty.filter((k) => k !== GALLERY_KEY)
          }
          pushKv = false
        }
        useSyncStore.setState({ usage: res.usage })
        saveLedger()
      }
      failures = 0
      const more = ledger.dirty.some((id) => !ledger.tooLarge[id]) || ledger.treeDirty || ledger.kvDirty.length > 0
      if (more) schedule(0)
      else setPhase('synced')
    } catch (err) {
      requeuePageDeletions(deletes)
      onFailure(err)
    } finally {
      flushing = false
      saveLedger()
    }
  }

  /** Incremental pull: everything changed on the server since our cursor. */
  const pull = async (ws: string): Promise<void> => {
    let firstSync = ledger.since === null
    for (let guard = 0; guard < 50; guard++) {
      const qs = new URLSearchParams()
      if (ledger.since) qs.set('since', ledger.since)
      if (ledger.after) qs.set('after', ledger.after)
      const res = await api<PullResponse>({ query: `?${qs}` })
      if (activeUser !== ws) return // signed out / switched account mid-pull

      if (res.workspace && res.workspace.rev !== ledger.treeRev) {
        if (applyTree(ws, res.workspace.tree, res.workspace.rev)) ledger.treeDirty = true
      }

      const dirty = new Set(ledger.dirty)
      const resident = useDocStore.getState().pages
      const reopen: Record<string, unknown> = {}
      const vps: Record<string, unknown> = {}
      for (const row of res.pages) {
        if (ledger.revs[row.id] === row.rev) continue
        const remotePrint = pagePrint(row.content, row.viewport)
        const local = resident[row.id] ?? archive.readPage(row.id)
        // Conflicts are about CONTENT: a different scroll position/zoom on the
        // two devices is not a reason to fork a page.
        const differs = local ? fingerprint(local) !== fingerprint(row.content) : false
        const unpushedLocal =
          differs &&
          !isBlankContent(local) &&
          (dirty.has(row.id) || (firstSync && ledger.prints[row.id] === undefined))
        if (unpushedLocal) {
          // Both sides moved: keep ours in place, theirs as a copy, and push
          // ours on top of their rev.
          if (!isBlankContent(row.content)) keepConflictCopy(row.id, row.content)
          ledger.revs[row.id] = row.rev
          dirty.add(row.id)
          continue
        }
        archive.writePage(row.id, row.content as never)
        if (resident[row.id]) reopen[row.id] = row.content
        if (row.viewport) vps[row.id] = row.viewport
        ledger.revs[row.id] = row.rev
        ledger.prints[row.id] = remotePrint
      }
      ledger.dirty = [...dirty]
      if (Object.keys(reopen).length > 0 || Object.keys(vps).length > 0) {
        applyingRemote = true
        try {
          useDocStore.setState((st) => ({
            pages: { ...st.pages, ...(reopen as typeof st.pages) },
            viewports: { ...st.viewports, ...(vps as typeof st.viewports) },
          }))
          for (const id of Object.keys(reopen)) useDocStore.getState().ensurePage(id)
        } finally {
          applyingRemote = false
        }
      }

      // Rows the server no longer holds (deleted or made local elsewhere):
      // forget their rev so a later push recreates rather than conflicts.
      // Local content is never deleted here.
      for (const id of Object.keys(ledger.revs)) {
        if (res.serverPages[id] === undefined && !res.pages.some((p) => p.id === id)) {
          delete ledger.revs[id]
          delete ledger.prints[id]
        }
      }

      for (const row of res.kv) {
        if (row.key !== GALLERY_KEY || ledger.kvRevs[row.key] === row.rev) continue
        if (applyGallery(ws, row.value as GalleryKv, row.rev) && !ledger.kvDirty.includes(GALLERY_KEY)) {
          ledger.kvDirty.push(GALLERY_KEY)
        }
      }

      ledger.since = res.now
      ledger.after = res.after
      saveLedger()
      if (!res.more) break
      firstSync = false
    }
  }

  const reconcile = async (ws: string) => {
    setPhase('syncing')
    const stored = readJSON<Ledger>(ledgerKey(ws))
    ledger = { ...emptyLedger(), ...stored }
    const firstSync = !stored
    try {
      await pull(ws)
      if (firstSync) {
        // First time this device syncs this account: offer everything it has.
        // Pages the pull just delivered have matching prints and are skipped;
        // pages already on the server with identical content are adopted
        // server-side without a write.
        const tree = fullTree()
        const allowed = syncedContentIds(tree)
        const local = await archive.archivedPageIdsDurable()
        markDirty([...Object.keys(useDocStore.getState().pages), ...local].filter((id) => allowed.has(id)))
        ledger.treeDirty = true
        if (useNotesGallery.getState().events.length + useNotesGallery.getState().todos.length > 0) {
          ledger.kvDirty = [...new Set([...ledger.kvDirty, GALLERY_KEY])]
        }
      }
      schedule(0)
    } catch (err) {
      onFailure(err)
    }
  }

  pullNow = async () => {
    const ws = activeUser
    if (!ws || useSyncStore.getState().paused || !navigator.onLine || Date.now() < unavailableUntil) return
    try {
      await pull(ws)
      if (ledger.treeDirty || ledger.dirty.length > 0 || ledger.kvDirty.length > 0) schedule(0)
      else if (useSyncStore.getState().phase !== 'quota') setPhase('synced')
    } catch (err) {
      onFailure(err)
    }
  }

  // ── Change feeds ──
  useDocStore.subscribe((s, prev) => {
    if (s.pages === prev.pages || applyingRemote || !activeUser) return
    // ONLY content changes mark a page dirty. A page disappearing from the
    // map means "closed to save memory" (lazy loading), not "deleted" — real
    // deletions arrive through the explicit queue (deleted-pages.ts).
    const changed: string[] = []
    for (const id of Object.keys(s.pages)) if (s.pages[id] !== prev.pages[id]) changed.push(id)
    if (changed.length === 0) return
    markDirty(changed)
    schedule()
  })

  useWorkspaceStore.subscribe((s, prev) => {
    if (s.nodes === prev.nodes || applyingRemote || !activeUser) return
    ledger.treeDirty = true
    // A page that just became syncable (e.g. switched back from "keep
    // local") needs its content pushed, not just its node.
    const before = syncedContentIds({ ...prev.hiddenNodes, ...prev.nodes })
    const after = syncedContentIds({ ...s.hiddenNodes, ...s.nodes })
    const newly = [...after].filter((id) => !before.has(id))
    if (newly.length > 0) markDirty(newly)
    schedule()
  })

  useNotesGallery.subscribe((s, prev) => {
    if (applyingRemote || !activeUser) return
    if (s.notes === prev.notes && s.todos === prev.todos && s.events === prev.events && s.eventColors === prev.eventColors) return
    if (!ledger.kvDirty.includes(GALLERY_KEY)) ledger.kvDirty.push(GALLERY_KEY)
    schedule()
  })

  onPageDeleted(() => schedule())

  onReconnect(() => {
    failures = 0
    void pullNow?.().then(() => schedule(0))
  })
  window.addEventListener('offline', () => {
    if (activeUser && !useSyncStore.getState().paused) setPhase('pending')
  })

  // Leaving the page: push immediately rather than waiting out the debounce.
  // (Anything that doesn't make it is still in the persisted dirty set.)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (timer) void flush()
    } else {
      void pullNow?.()
    }
  })
  window.addEventListener('focus', () => void pullNow?.())
  setInterval(() => {
    if (document.visibilityState === 'visible') void pullNow?.()
  }, 60_000)

  // The platform auth store is the single source of identity — boards don't
  // sync notebooks (their pages are temporary presentation copies).
  const follow = () => {
    const profile = useAuthStore.getState().profile
    const ws = profile && profile.role !== 'board' ? profile.id : null
    if (ws && ws !== activeUser) {
      activeUser = ws
      void reconcile(ws)
    } else if (!ws && activeUser) {
      saveLedger()
      activeUser = null
      ledger = emptyLedger()
      setPhase('offline')
    }
  }
  follow()
  useAuthStore.subscribe(follow)
}
