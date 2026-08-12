// Self-hosted auth primitives: scrypt password hashes and HS256 JWTs signed
// with AUTH_SECRET. Replaces Supabase GoTrue — no external service, no deps.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

// SECURITY: the dev fallback below is a PUBLIC string in this repo — anyone
// can forge a token with it, including `role: 'super_admin'`, which bypasses
// all tenant scoping in /api/pg. So production must never ISSUE a token
// signed with it.
//
// The guard deliberately sits on the signing path only. An earlier version
// threw inside secret() itself, which also covers verifyToken() — and since
// every /api/pg request verifies a bearer token, one unset env var turned
// into a 500 on every single data request instead of a clear auth failure.
// Verification with the wrong key already fails safely (the HMAC simply
// doesn't match), so it does not need to throw.
//
// Resolved lazily, never at module load: `next build` runs with
// NODE_ENV=production and collects page data without runtime env vars, so
// throwing at import time would fail every build.
const DEV_SECRET = 'simblip-dev-secret-change-me'

function secret(): string {
  return process.env.AUTH_SECRET || DEV_SECRET
}

/** True when we'd be signing with the public dev fallback. */
const usingDevSecret = (): boolean => !process.env.AUTH_SECRET

/**
 * Called before MINTING a token. Refuses to hand out a credential signed
 * with a secret that is public knowledge; verification is unaffected.
 */
function assertSignable(): void {
  if (process.env.NODE_ENV === 'production' && usingDevSecret()) {
    throw new Error(
      'AUTH_SECRET is required in production — refusing to issue tokens signed with the public dev secret.'
    )
  }
}

// ── Passwords ───────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [scheme, salt, hex] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hex) return false
  const a = scryptSync(password, salt, 64)
  const b = Buffer.from(hex, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── JWT (HS256) ─────────────────────────────────────────────────────────────

export interface Claims {
  sub: string
  role: string
  inst: string | null
  typ: 'access' | 'refresh'
  exp: number
}

const b64u = (data: Buffer | string) => Buffer.from(data).toString('base64url')

const hmac = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url')

export function signToken(claims: Omit<Claims, 'exp'>, ttlSeconds: number): string {
  assertSignable()
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSeconds }))
  return `${head}.${body}.${hmac(`${head}.${body}`)}`
}

export function verifyToken(token: string, typ: Claims['typ']): Claims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const expected = hmac(`${parts[0]}.${parts[1]}`)
  const given = parts[2]
  if (
    expected.length !== given.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  )
    return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Claims
    if (claims.typ !== typ || claims.exp < Date.now() / 1000) return null
    return claims
  } catch {
    return null
  }
}

/**
 * Claims from a request's Bearer access token, or null.
 *
 * Never throws. This runs at the top of every authenticated route, usually
 * before any try/catch, so anything thrown here becomes an unhandled 500 on
 * every request rather than a 401 — which is exactly what happened when the
 * production-secret guard lived on this path. A bad or unverifiable token is
 * simply "not authenticated".
 */
export function bearerClaims(req: Request): Claims | null {
  try {
    const header = req.headers.get('authorization')
    if (!header?.startsWith('Bearer ')) return null
    return verifyToken(header.slice(7), 'access')
  } catch {
    return null
  }
}
