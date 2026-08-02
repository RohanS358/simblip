// Cross-instance broadcast bus for board-live WebSocket connections.
//
// Two separate Postgres connections, deliberately not shared:
//   publish (NOTIFY) rides the existing pooled q() from lib/server/pg.ts —
//     a single statement, no session affinity needed.
//   subscribe (LISTEN) needs one dedicated, long-lived connection per warm
//     instance, opened against DATABASE_URL_DIRECT (a direct/unpooled
//     connection string) — LISTEN cannot survive a transaction-mode pooler
//     (e.g. Neon's/Supabase's PgBouncer endpoint), which is what
//     DATABASE_URL points at (see docs/deployment-cost-plan.md §2.2).
//
// Fan-out has two paths:
//   1. Local, synchronous: any socket registered on THIS instance for the
//      event's session gets it directly, no Postgres round-trip, no size
//      limit — this covers same-instance peers (Fluid Compute reuses warm
//      instances, so a single classroom's traffic often lands together).
//   2. Cross-instance, via NOTIFY: serialized and broadcast to every other
//      instance's listener, EXCEPT when the payload exceeds Postgres's
//      8000-byte NOTIFY limit — then a minimal {sessionId, type:'resync'}
//      goes out instead, and receivers re-pull full state over REST.

import { Client } from 'pg'
import { q } from './pg'
import type { BoardLiveServerMsg } from '@/lib/data/board-live-types'

const CHANNEL = 'simblip_board_live'
const NOTIFY_BYTE_LIMIT = 7800

export interface LocalSocket {
  sessionId: string
  send: (data: string) => void
}

interface Bridge {
  listener: Client | null
  connecting: Promise<void> | null
  sockets: Map<string, Set<LocalSocket>>
}

// Stashed on globalThis, not a module-scope `let`: next dev's Fast Refresh
// can re-evaluate this module on each request, and a bare module-scope
// singleton would get silently re-created, leaking one LISTEN connection
// per reload. In production, module scope is already reused per warm
// instance, so this is just a slightly more defensive version of the same
// lazy-singleton pattern.
const g = globalThis as unknown as { __boardLiveBridge?: Bridge }
const bridge: Bridge = (g.__boardLiveBridge ??= { listener: null, connecting: null, sockets: new Map() })

function localSocketsFor(sessionId: string): Set<LocalSocket> {
  let set = bridge.sockets.get(sessionId)
  if (!set) {
    set = new Set()
    bridge.sockets.set(sessionId, set)
  }
  return set
}

export function registerSocket(socket: LocalSocket): () => void {
  const set = localSocketsFor(socket.sessionId)
  set.add(socket)
  return () => {
    set.delete(socket)
    if (set.size === 0) bridge.sockets.delete(socket.sessionId)
  }
}

function fanOutLocal(sessionId: string, evt: BoardLiveServerMsg, exclude?: LocalSocket) {
  const set = bridge.sockets.get(sessionId)
  if (!set) return
  const data = JSON.stringify(evt)
  for (const socket of set) {
    if (socket === exclude) continue
    socket.send(data)
  }
}

async function ensureListener(): Promise<void> {
  if (bridge.listener) return
  if (bridge.connecting) return bridge.connecting
  const directUrl = process.env.DATABASE_URL_DIRECT
  if (!directUrl) {
    throw new Error('DATABASE_URL_DIRECT is not configured — required for board-live LISTEN/NOTIFY')
  }
  bridge.connecting = (async () => {
    const client = new Client({
      connectionString: directUrl,
      ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
      keepAlive: true,
    })
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return
      try {
        const { sessionId, evt } = JSON.parse(msg.payload) as { sessionId: string; evt: BoardLiveServerMsg }
        fanOutLocal(sessionId, evt)
      } catch {
        /* malformed notify payload — ignore */
      }
    })
    const reset = () => {
      if (bridge.listener === client) bridge.listener = null
    }
    client.on('error', reset)
    client.on('end', reset)
    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
    bridge.listener = client
  })()
  try {
    await bridge.connecting
  } finally {
    bridge.connecting = null
  }
}

/** Broadcast an event to every socket subscribed to a session — local
 *  instance synchronously, other instances via NOTIFY (or a `resync` signal
 *  if the payload is too large for NOTIFY's 8KB cap). */
export async function publish(sessionId: string, evt: BoardLiveServerMsg, exclude?: LocalSocket): Promise<void> {
  fanOutLocal(sessionId, evt, exclude)
  const payload = JSON.stringify({ sessionId, evt })
  const outgoing = Buffer.byteLength(payload, 'utf8') > NOTIFY_BYTE_LIMIT
    ? JSON.stringify({ sessionId, evt: { type: 'resync' } as BoardLiveServerMsg })
    : payload
  await q('select pg_notify($1, $2)', [CHANNEL, outgoing])
}

/** Call once per WS connection before registering the socket, so the
 *  instance is guaranteed subscribed before it starts relying on NOTIFY. */
export const ensureBoardLiveListener = ensureListener
