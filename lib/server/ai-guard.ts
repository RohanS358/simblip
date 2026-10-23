// Who may call /api/ai, how often, and with which model.
//
// /api/ai used to answer anyone: no session check, no rate limit, and a client-chosen `model` passed on to
// OpenRouter with the SERVER's key. Anyone on the internet could spend the quota or tie the route up for
// minutes (maxDuration is 300 s). This module is the missing gate. It is pure apart from the optional Redis
// counter, so it is unit-tested without a server (lib/server/ai-guard.test.mjs).
//
//   • Cloud deployment (DATABASE_URL set): a valid ACCESS token is required, the same one /api/pg uses.
//   • Local deployment (no database): the accounts live in the browser and the server cannot tell users apart,
//     so only requests that reach it as localhost are served. Set AI_ALLOW_ANONYMOUS=1 to open it up on
//     purpose (a trusted LAN, a demo).
//   • Per caller: AI_RATE_PER_MIN (default 20) and AI_RATE_PER_HOUR (default 300) requests, and
//     AI_MAX_CONCURRENT (default 2) in flight. Counted in Redis when REDIS_URL is set (so every instance
//     shares the count), in memory otherwise.
//   • `model`: on a cloud deployment only AI_MODEL_ALLOWLIST (comma-separated) and the configured default
//     are honoured; anything else falls back to the default. Admins may choose any.

import { bearerClaims } from './auth'

export interface AiCaller {
  id: string
  role: string
}

export type AiAuth = { ok: true; caller: AiCaller } | { ok: false; status: 401 | 403; error: string }

type Env = Record<string, string | undefined>

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

const num = (v: string | undefined, d: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d
}

export interface AiLimits {
  perMinute: number
  perHour: number
  maxConcurrent: number
}

export const aiLimits = (env: Env = process.env): AiLimits => ({
  perMinute: num(env.AI_RATE_PER_MIN, 20),
  perHour: num(env.AI_RATE_PER_HOUR, 300),
  maxConcurrent: num(env.AI_MAX_CONCURRENT, 2),
})

/** A request that reached this server as localhost, and was not forwarded from elsewhere. */
export function isLoopbackRequest(req: Request): boolean {
  let host = req.headers.get('host') ?? ''
  if (!host) {
    try {
      host = new URL(req.url).host
    } catch {
      return false
    }
  }
  host = host.replace(/:\d+$/, '').toLowerCase()
  if (!LOOPBACK_HOSTS.has(host)) return false
  const fwd = req.headers.get('x-forwarded-for')
  return !fwd || fwd.split(',').every((ip) => LOOPBACK_IPS.has(ip.trim()))
}

export function authorizeAi(req: Request, env: Env = process.env): AiAuth {
  if (env.DATABASE_URL) {
    const claims = bearerClaims(req)
    if (!claims) return { ok: false, status: 401, error: 'Sign in to use the AI assistant.' }
    return { ok: true, caller: { id: claims.sub, role: claims.role } }
  }
  if (env.AI_ALLOW_ANONYMOUS === '1' || isLoopbackRequest(req)) return { ok: true, caller: { id: 'local', role: 'local' } }
  return { ok: false, status: 403, error: 'The AI assistant is only available from this computer on a local install.' }
}

// ── rate limiting ───────────────────────────────────────────────────────────

interface Window {
  count: number
  resetAt: number
}
const windows = new Map<string, Window>()
const inFlight = new Map<string, number>()

/** Count one hit in an in-memory fixed window. Returns the window's count after the hit. */
function memoryHit(key: string, windowMs: number, now: number): { count: number; resetAt: number } {
  const w = windows.get(key)
  if (!w || now >= w.resetAt) {
    const fresh = { count: 1, resetAt: now + windowMs }
    windows.set(key, fresh)
    if (windows.size > 5000) for (const [k, v] of windows) if (now >= v.resetAt) windows.delete(k)
    return fresh
  }
  w.count++
  return w
}

/** Redis-backed fixed window, shared by every instance. Null when Redis is not configured or fails. */
async function redisHit(key: string, windowMs: number, env: Env): Promise<{ count: number; ttlMs: number } | null> {
  if (!env.REDIS_URL) return null
  try {
    const { getRedisPub } = await import('./redis')
    const r = getRedisPub()
    const k = `simblip:ai-rate:${key}`
    const count = await r.incr(k)
    if (count === 1) await r.pexpire(k, windowMs)
    const ttl = await r.pttl(k)
    return { count, ttlMs: ttl > 0 ? ttl : windowMs }
  } catch {
    return null // fall back to the per-instance counter: still a limit, just not a shared one
  }
}

export type AiSlot = { ok: true; release: () => void } | { ok: false; status: 429; error: string; retryAfterSec: number }

/**
 * Take one request's worth of the caller's allowance. Call release() when the request is finished (also on
 * error and on a client abort), or the caller's concurrency slot stays taken.
 */
export async function takeAiSlot(callerId: string, env: Env = process.env, now: number = Date.now()): Promise<AiSlot> {
  const lim = aiLimits(env)
  const busy = inFlight.get(callerId) ?? 0
  if (busy >= lim.maxConcurrent) {
    return { ok: false, status: 429, error: 'You already have requests running. Wait for them to finish.', retryAfterSec: 5 }
  }
  for (const [label, windowMs, max] of [['m', 60_000, lim.perMinute], ['h', 3_600_000, lim.perHour]] as const) {
    const key = `${callerId}:${label}`
    const shared = await redisHit(key, windowMs, env)
    const count = shared ? shared.count : memoryHit(key, windowMs, now).count
    if (count > max) {
      const waitMs = shared ? shared.ttlMs : Math.max(1000, (windows.get(key)?.resetAt ?? now + windowMs) - now)
      return {
        ok: false,
        status: 429,
        error: label === 'm' ? 'Too many AI requests in a minute. Wait a little and try again.' : 'You have used this hour\'s AI allowance. Try again later.',
        retryAfterSec: Math.ceil(waitMs / 1000),
      }
    }
  }
  inFlight.set(callerId, busy + 1)
  let released = false
  return {
    ok: true,
    release() {
      if (released) return
      released = true
      const n = (inFlight.get(callerId) ?? 1) - 1
      if (n <= 0) inFlight.delete(callerId)
      else inFlight.set(callerId, n)
    },
  }
}

// ── request shaping ─────────────────────────────────────────────────────────

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,119}$/

/** Largest request body accepted, bytes. A prompt is at most 4,000 characters; the rest is page context. */
export const MAX_AI_BODY_BYTES = 256 * 1024

/**
 * The model a request may use. On a cloud deployment: the configured default or an allow-listed name
 * (admins: any well-formed name). On a local install the person's own Ollama is theirs to choose from.
 * Undefined means "use the server's default".
 */
export function allowedModel(requested: string | undefined, caller: AiCaller, env: Env = process.env): string | undefined {
  if (!requested || !MODEL_NAME.test(requested)) return undefined
  if (!env.DATABASE_URL) return requested
  if (caller.role === 'admin' || caller.role === 'super_admin') return requested
  const allow = new Set((env.AI_MODEL_ALLOWLIST ?? '').split(',').map((m) => m.trim()).filter(Boolean))
  if (env.OPENROUTER_MODEL) allow.add(env.OPENROUTER_MODEL)
  return allow.has(requested) ? requested : undefined
}

/** The model list a caller may see (the picker must not offer names the server will refuse). */
export function visibleModels<T extends { models: string[] }>(list: T, caller: AiCaller, env: Env = process.env): T {
  if (!env.DATABASE_URL || caller.role === 'admin' || caller.role === 'super_admin') return list
  return { ...list, models: list.models.filter((m) => allowedModel(m, caller, env) !== undefined) }
}

/** Forget all counters (tests). */
export function resetAiGuardForTests(): void {
  windows.clear()
  inFlight.clear()
}
