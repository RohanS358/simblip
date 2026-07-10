'use client'

// The platform data layer. Every enterprise collection (rooms, shares,
// library, assignments, board sessions…) goes through this one API so the
// whole app is backend-agnostic:
//
//   cloud — Supabase PostgREST over fetch (zero dependencies), rows guarded
//           by the RLS policies in supabase/schema.sql. Requests carry the
//           signed-in user's JWT so institution scoping is enforced
//           server-side, not just in the client.
//   local — a localStorage database (one JSON array per table) with
//           BroadcastChannel change events. This is demo/dev mode: the whole
//           enterprise feature set works in a single browser with zero infra.
//
// Rows use snake_case keys in BOTH modes so shapes match the SQL schema
// exactly and no mapping layer is needed.

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const cloudConfigured = Boolean(URL_ && KEY)
export type DbMode = 'cloud' | 'local'

const MODE_KEY = 'simblip-db-mode'

export function setDbMode(mode: DbMode) {
  if (typeof window === 'undefined') return
  localStorage.setItem(MODE_KEY, mode)
}

export function clearDbMode() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(MODE_KEY)
}

export function getDbMode(): DbMode {
  if (!cloudConfigured) return 'local'
  if (typeof window === 'undefined') return 'cloud'
  return localStorage.getItem(MODE_KEY) === 'local' ? 'local' : 'cloud'
}

export interface Row {
  id: string
  [key: string]: unknown
}

export type Eq = Record<string, string | number | boolean | null>

// ── Auth token wiring (set by the auth store; avoids a circular import) ─────

let getToken: () => string | null = () => null
export function registerTokenSource(fn: () => string | null) {
  getToken = fn
}

// ── Cloud backend (PostgREST) ───────────────────────────────────────────────

async function restFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY!,
      Authorization: `Bearer ${token ?? KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res
}

const eqQuery = (eq?: Eq) =>
  eq
    ? Object.entries(eq)
        .map(([k, v]) => `${k}=${v === null ? 'is.null' : `eq.${encodeURIComponent(String(v))}`}`)
        .join('&')
    : ''

// ── Local backend (localStorage + BroadcastChannel) ─────────────────────────

const LS_PREFIX = 'simblip-db:'
const CHANNEL = 'simblip-db-changes'

const channel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel(CHANNEL)
    : null

function readTable(table: string): Row[] {
  try {
    return JSON.parse(localStorage.getItem(LS_PREFIX + table) ?? '[]') as Row[]
  } catch {
    return []
  }
}

function writeTable(table: string, rows: Row[]) {
  localStorage.setItem(LS_PREFIX + table, JSON.stringify(rows))
  channel?.postMessage({ table })
  emitLocal(table)
}

const matches = (row: Row, eq?: Eq) =>
  !eq || Object.entries(eq).every(([k, v]) => (v === null ? row[k] == null : row[k] === v))

/** Seed a local table once (no-op if it already exists or in cloud mode). */
export function seedTable(table: string, rows: Row[]) {
  if (getDbMode() === 'cloud' || typeof window === 'undefined') return
  if (localStorage.getItem(LS_PREFIX + table) === null) writeTable(table, rows)
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function list<T extends Row>(table: string, eq?: Eq): Promise<T[]> {
  if (getDbMode() === 'cloud') {
    const q = eqQuery(eq)
    const res = await restFetch(`simblip_${table}?select=*${q ? `&${q}` : ''}`)
    return (await res.json()) as T[]
  }
  return readTable(table).filter((r) => matches(r, eq)) as T[]
}

export async function insert<T extends Row>(table: string, rows: T | T[]): Promise<void> {
  const batch = Array.isArray(rows) ? rows : [rows]
  if (batch.length === 0) return
  if (getDbMode() === 'cloud') {
    await restFetch(`simblip_${table}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    })
    return
  }
  const existing = readTable(table).filter((r) => !batch.some((b) => b.id === r.id))
  writeTable(table, [...existing, ...batch])
}

export async function update(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  if (getDbMode() === 'cloud') {
    await restFetch(`simblip_${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })
    return
  }
  writeTable(
    table,
    readTable(table).map((r) => (r.id === id ? { ...r, ...patch } : r))
  )
}

export async function removeWhere(table: string, eq: Eq): Promise<void> {
  if (getDbMode() === 'cloud') {
    await restFetch(`simblip_${table}?${eqQuery(eq)}`, { method: 'DELETE' })
    return
  }
  writeTable(table, readTable(table).filter((r) => !matches(r, eq)))
}

export const removeById = (table: string, id: string) => removeWhere(table, { id })

// ── Change subscriptions ────────────────────────────────────────────────────
// local: instant, via BroadcastChannel (cross-tab) + same-tab emitter.
// cloud: 4-second polling while at least one subscriber is mounted.

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

function emitLocal(table: string) {
  listeners.get(table)?.forEach((fn) => fn())
}

channel?.addEventListener('message', (e: MessageEvent) => {
  const table = (e.data as { table?: string })?.table
  if (table) emitLocal(table)
})

if (typeof window !== 'undefined') {
  // storage events cover browsers without BroadcastChannel and hard cases
  window.addEventListener('storage', (e) => {
    if (e.key?.startsWith(LS_PREFIX)) emitLocal(e.key.slice(LS_PREFIX.length))
  })
}

const POLL_MS = 4000
const pollers = new Map<string, ReturnType<typeof setInterval>>()

export function subscribe(table: string, fn: Listener): () => void {
  let set = listeners.get(table)
  if (!set) {
    set = new Set()
    listeners.set(table, set)
  }
  set.add(fn)
  if (getDbMode() === 'cloud' && !pollers.has(table)) {
    pollers.set(table, setInterval(() => emitLocal(table), POLL_MS))
  }
  return () => {
    set.delete(fn)
    if (set.size === 0) {
      const p = pollers.get(table)
      if (p) {
        clearInterval(p)
        pollers.delete(table)
      }
    }
  }
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
