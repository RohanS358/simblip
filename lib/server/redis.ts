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

// --- Small read-through cache for the /api/pg gateway (app/api/pg/[table]/route.ts) ---
// Only for tables explicitly allowlisted there. Reuses the shared pub
// connection — one more command type on a connection already open, not a
// new one, given the 30-connection ceiling this file's header describes.

const CACHE_TTL_SECONDS = 30

/**
 * Tables whose rows are SHARED across everyone in a tenant rather than owned
 * by one user. These must be cached and invalidated per-institution: keyed
 * per-user, an admin editing the institution or a room's membership would
 * invalidate only their OWN cached copy, leaving every other member of the
 * tenant served stale data until the TTL expired.
 */
const TENANT_SCOPED_CACHE = new Set(['institutions', 'room_members'])

/**
 * The identity a cache entry belongs to: the tenant for shared tables, the
 * user for owned ones. Callers pass both and this picks — so the choice is
 * made in exactly one place and read and invalidation can never disagree.
 */
const scopeOf = (table: string, userId: string, inst: string | null): string =>
  TENANT_SCOPED_CACHE.has(table) ? `inst:${inst ?? 'none'}` : userId

/** Every key this scope has cached for this table, so invalidation can DEL
 *  them without SCAN/KEYS (same lazy-index pattern app/api/devices/route.ts
 *  already uses for presence pruning). */
function indexKey(table: string, scope: string): string {
  return `pgcache:${table}:${scope}:__keys`
}

export async function cacheGet(
  table: string,
  userId: string,
  queryString: string,
  inst: string | null = null
): Promise<string | null> {
  const redis = getRedisPub()
  return redis.get(`pgcache:${table}:${scopeOf(table, userId, inst)}:${queryString}`)
}

export async function cacheSet(
  table: string,
  userId: string,
  queryString: string,
  value: string,
  inst: string | null = null
): Promise<void> {
  const redis = getRedisPub()
  const scope = scopeOf(table, userId, inst)
  const key = `pgcache:${table}:${scope}:${queryString}`
  await Promise.all([
    redis.set(key, value, 'EX', CACHE_TTL_SECONDS),
    redis.sadd(indexKey(table, scope), key),
  ])
}

/** Drop every cached response for this scope+table — called after any
 *  write, since a 30s-stale row is fine but serving one from before the
 *  write would look like data loss. */
export async function cacheInvalidate(
  table: string,
  userId: string,
  inst: string | null = null
): Promise<void> {
  const redis = getRedisPub()
  const idx = indexKey(table, scopeOf(table, userId, inst))
  const keys = await redis.smembers(idx)
  if (keys.length > 0) await redis.del(...keys)
  await redis.del(idx)
}
