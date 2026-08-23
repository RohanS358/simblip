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
 *
 * Tenant scoping is also where the load win actually comes from. `buildWhere`
 * gives every member of an institution the SAME rows for the same query, so
 * one shared entry serves the whole classroom: 40 students polling
 * `assignments` every 4s (lib/data/db.ts POLL_MS) collapse from 600
 * Postgres queries a minute to two.
 */
const TENANT_SCOPED_CACHE = new Set([
  'institutions',
  'room_members',
  // Read by every admin screen and scoped by institution, not by owner —
  // keyed per-user it was one identical copy per admin, and one admin's
  // edit left the others reading a stale roster.
  'profiles',
  // Classroom collections: written by one teacher, polled by every student
  // in the tenant. These are the tables the 4s poller hammers hardest.
  'shares',
  'assignments',
  'submissions',
  'announcements',
  'rooms',
  'boards',
  'library_assets',
])

/**
 * The identity a cache entry belongs to: the tenant for shared tables, the
 * user for owned ones. Callers pass both and this picks — so the choice is
 * made in exactly one place and read and invalidation can never disagree.
 */
export const isTenantScopedCache = (table: string): boolean => TENANT_SCOPED_CACHE.has(table)

export const scopeOf = (table: string, userId: string, inst: string | null): string =>
  isTenantScopedCache(table) ? `inst:${inst ?? 'none'}` : userId

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
  const idx = indexKey(table, scope)
  await Promise.all([
    redis.set(key, value, 'EX', CACHE_TTL_SECONDS),
    redis.sadd(idx, key),
    // The index set had no expiry of its own: entries inside it expire, the
    // member names don't, so a scope that reads many distinct query strings
    // and never writes grew a set that only ever got bigger — a slow leak
    // against a 30MB budget. Refreshed on every SADD at twice the entry TTL,
    // the index always outlives its newest member and still dies on its own.
    redis.expire(idx, CACHE_TTL_SECONDS * 2),
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

// --- Privileged-identity cache -------------------------------------------
// /api/pg re-reads role/active/institution from Postgres on EVERY request
// from a privileged caller, so a revoked admin can't keep using a 30-day
// token. Correct, but it means the classroom display — role `board`, polling
// board_sessions about once a second — buys a profiles SELECT with every
// remote-control tick, on the one path that must stay fast.
//
// 15s is the whole trade: revocation lands within 15s instead of instantly,
// against 30 days before this check existed at all. Cached under the user id
// only, never the token, so re-issuing a token can't refresh a stale answer.

const IDENTITY_TTL_SECONDS = 15

export interface CachedIdentity {
  role: string
  active: boolean
  institution_id: string | null
}

export async function identityGet(userId: string): Promise<CachedIdentity | null> {
  const raw = await getRedisPub().get(`pgidentity:${userId}`)
  return raw ? (JSON.parse(raw) as CachedIdentity) : null
}

export async function identitySet(userId: string, row: CachedIdentity): Promise<void> {
  await getRedisPub().set(`pgidentity:${userId}`, JSON.stringify(row), 'EX', IDENTITY_TTL_SECONDS)
}

/** Called when a profile is written, so a demotion or deactivation takes
 *  effect on the next request rather than waiting out the TTL. */
export async function identityInvalidate(userId: string): Promise<void> {
  await getRedisPub().del(`pgidentity:${userId}`)
}
