// Self-hosted auth primitives: scrypt password hashes and HS256 JWTs signed
// with AUTH_SECRET. Replaces Supabase GoTrue — no external service, no deps.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const SECRET = process.env.AUTH_SECRET ?? 'simblip-dev-secret-change-me'

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

const hmac = (data: string) => createHmac('sha256', SECRET).update(data).digest('base64url')

export function signToken(claims: Omit<Claims, 'exp'>, ttlSeconds: number): string {
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

/** Claims from a request's Bearer access token, or null. */
export function bearerClaims(req: Request): Claims | null {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return verifyToken(header.slice(7), 'access')
}
