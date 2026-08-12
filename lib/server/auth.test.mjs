// Regression test: nothing on the token-VERIFICATION path may ever throw.
//
// The outage this locks down: a production guard was placed inside secret(),
// which verifyToken() also calls. Every /api/pg request verifies a bearer
// token before entering any try/catch, so a missing (or, thanks to an
// invented ≥32-char rule, merely short) AUTH_SECRET turned into a 500 on
// EVERY data request — profiles, pages, shares, devices, announcements,
// assignments — instead of a clean 401. The app looked completely broken.
//
// Rule: verification fails closed and silently (wrong key ⇒ HMAC mismatch ⇒
// null). Only MINTING a token is allowed to refuse.
//
// Run directly:  node lib/server/auth.test.mjs

import assert from 'node:assert/strict'
import { createHmac, timingSafeEqual } from 'node:crypto'

const DEV_SECRET = 'simblip-dev-secret-change-me'
const secret = (env) => env.AUTH_SECRET || DEV_SECRET
const usingDevSecret = (env) => !env.AUTH_SECRET

function assertSignable(env) {
  if (env.NODE_ENV === 'production' && usingDevSecret(env)) {
    throw new Error('AUTH_SECRET is required in production')
  }
}

const b64u = (d) => Buffer.from(d).toString('base64url')
const hmac = (env, data) => createHmac('sha256', secret(env)).update(data).digest('base64url')

function signToken(env, claims, ttl) {
  assertSignable(env)
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttl }))
  return `${head}.${body}.${hmac(env, `${head}.${body}`)}`
}

function verifyToken(env, token, typ) {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const expected = hmac(env, `${parts[0]}.${parts[1]}`)
  if (
    expected.length !== parts[2].length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))
  )
    return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    if (claims.typ !== typ || claims.exp < Date.now() / 1000) return null
    return claims
  } catch {
    return null
  }
}

function bearerClaims(env, header) {
  try {
    if (!header?.startsWith('Bearer ')) return null
    return verifyToken(env, header.slice(7), 'access')
  } catch {
    return null
  }
}

// ── verification NEVER throws, under any environment ────────────────────────
const ENVS = [
  { NODE_ENV: 'production' }, // the outage: no AUTH_SECRET at all
  { NODE_ENV: 'production', AUTH_SECRET: 'short' }, // short secret must be fine
  { NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(64) },
  { NODE_ENV: 'development' },
]
const HEADERS = [
  undefined,
  '',
  'Bearer',
  'Bearer ',
  'Bearer garbage',
  'Bearer a.b.c',
  'Bearer ...',
  'Basic abc',
  'Bearer ' + 'x'.repeat(5000),
]
for (const env of ENVS) {
  for (const h of HEADERS) {
    assert.doesNotThrow(
      () => bearerClaims(env, h),
      `bearerClaims must not throw (env=${JSON.stringify(env)}, header=${h})`
    )
    assert.equal(bearerClaims(env, h), null, 'a bad token is simply unauthenticated')
  }
}

// ── minting is what refuses ─────────────────────────────────────────────────
assert.throws(
  () => signToken({ NODE_ENV: 'production' }, { sub: 'u', role: 'super_admin' }, 60),
  /AUTH_SECRET is required/,
  'production must not mint a token with the public dev secret'
)
assert.doesNotThrow(
  () => signToken({ NODE_ENV: 'development' }, { sub: 'u', role: 'teacher' }, 60),
  'dev keeps the convenience fallback'
)
// A short secret is a weak secret, not a broken one — refusing it here is
// what took production down, so it must keep working.
assert.doesNotThrow(
  () => signToken({ NODE_ENV: 'production', AUTH_SECRET: 'short' }, { sub: 'u' }, 60),
  'a configured secret of any length still signs'
)

// ── real tokens still round-trip ────────────────────────────────────────────
{
  const env = { NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(64) }
  const t = signToken(env, { sub: 'u1', role: 'teacher', inst: 'inst-1', typ: 'access' }, 3600)
  const c = bearerClaims(env, 'Bearer ' + t)
  assert.equal(c?.sub, 'u1')
  assert.equal(c?.inst, 'inst-1')
  // A token signed with a different key must not verify.
  assert.equal(bearerClaims({ ...env, AUTH_SECRET: 'y'.repeat(64) }, 'Bearer ' + t), null)
}

console.log('auth: all checks passed')
