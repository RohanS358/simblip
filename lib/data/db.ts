'use client'

// The platform data layer. Every enterprise collection (rooms, shares,
// library, assignments, board sessions…) goes through this one API so the
// whole app is backend-agnostic:
//
//   cloud — the app's own Postgres gateway (/api/pg, db/schema.sql) over
//           fetch. Requests carry the signed-in user's JWT so institution
//           scoping is enforced server-side, not just in the client.
//   local — a localStorage database (one JSON array per table) with
//           BroadcastChannel change events. This is demo/dev mode: the whole
//           enterprise feature set works in a single browser with zero infra.
//
// Rows use snake_case keys in BOTH modes so shapes match the SQL schema
// exactly and no mapping layer is needed.

export const cloudConfigured = process.env.NEXT_PUBLIC_CLOUD === '1'
export const dbMode: 'cloud' | 'local' = cloudConfigured ? 'cloud' : 'local'
export const getDbMode = (): 'cloud' | 'local' => dbMode

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

// ── Cloud backend (/api/pg gateway → Postgres) ──────────────────────────────

async function restFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const res = await fetch(`/api/pg/${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`Cloud db ${res.status}: ${await res.text()}`)
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
  if (dbMode === 'cloud' || typeof window === 'undefined') return
  if (localStorage.getItem(LS_PREFIX + table) === null) writeTable(table, rows)
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function list<T extends Row>(table: string, eq?: Eq, cols = '*'): Promise<T[]> {
  if (dbMode === 'cloud') {
    const q = eqQuery(eq)
    // `cols` trims heavy jsonb columns off hot paths (e.g. the board's
    // fast remote poll only needs `remote`, not the page snapshots).
    const res = await restFetch(`simblip_${table}?select=${cols}${q ? `&${q}` : ''}`)
    return (await res.json()) as T[]
  }
  return readTable(table).filter((r) => matches(r, eq)) as T[]
}

// Tables whose SQL shape uses a composite primary key: the local backend
// still synthesizes an `id` (its API needs one), but it must never reach
// PostgREST — the column doesn't exist there.
const SYNTHETIC_ID_TABLES = new Set(['room_members'])

export async function insert<T extends Row>(table: string, rows: T | T[]): Promise<void> {
  const batch = Array.isArray(rows) ? rows : [rows]
  if (batch.length === 0) return
  if (dbMode === 'cloud') {
    const payload = SYNTHETIC_ID_TABLES.has(table)
      ? batch.map(({ id: _id, ...rest }) => rest)
      : batch
    await restFetch(`simblip_${table}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload),
    })
    return
  }
  const existing = readTable(table).filter((r) => !batch.some((b) => b.id === r.id))
  writeTable(table, [...existing, ...batch])
}

export async function update(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  if (dbMode === 'cloud') {
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
  if (dbMode === 'cloud') {
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
  if (dbMode === 'cloud' && !pollers.has(table)) {
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
