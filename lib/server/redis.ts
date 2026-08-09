// Shared Redis clients for board-live pub/sub and device presence.
// REDIS_URL points at the free-tier Redis Cloud instance (30MB, no
// persistence, 30 connections max) — the binding constraint is connections,
// not memory, so this module holds exactly ONE publisher and ONE subscriber
// per warm instance, stashed on globalThis and reused across every board
// session and every caller on that instance (never one pair per session).
//
// Nothing durable lives here: pub/sub messages aren't stored, and presence
// keys are TTL'd. A Redis restart losing everything is expected and fine.

import Redis from 'ioredis'

export const redisConfigured = Boolean(process.env.REDIS_URL)

interface RedisBridge {
  pub: Redis | null
  sub: Redis | null
}

const g = globalThis as unknown as { __redisBridge?: RedisBridge }
const bridge: RedisBridge = (g.__redisBridge ??= { pub: null, sub: null })

function makeClient(): Redis {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is not configured')
  return new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  })
}

/** The single shared publisher for this instance. */
export function getRedisPub(): Redis {
  if (!bridge.pub) bridge.pub = makeClient()
  return bridge.pub
}

/** The single shared subscriber for this instance. Callers multiplex
 *  channels/sessions over this one connection via message filtering, never
 *  by opening additional subscriber connections. */
export function getRedisSub(): Redis {
  if (!bridge.sub) bridge.sub = makeClient()
  return bridge.sub
}
