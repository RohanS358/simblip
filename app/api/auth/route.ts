import { NextResponse } from 'next/server'
import { q, pgConfigured } from '@/lib/server/pg'
import { signToken, verifyPassword, verifyToken } from '@/lib/server/auth'

// Token endpoint (replaces GoTrue). Grants:
//   { grant: 'password', email, password }
//   { grant: 'refresh', refresh_token }
// Response matches the shape the auth store adopted from GoTrue:
//   { access_token, refresh_token, expires_in, user: { id } }

const ACCESS_TTL = 3600 // 1 h
const REFRESH_TTL = 60 * 60 * 24 * 30 // 30 d

// ── Rate limiting ───────────────────────────────────────────────────────────
// Password grants were unlimited, which is both a brute-force hole and a
// cheap CPU-exhaustion DoS: every attempt runs scrypt (deliberately
// expensive) on OUR server, so an attacker spends nothing and we spend a
// core. Counters are per-instance and in-memory — imperfect across a
// horizontally-scaled deployment, but it turns "unlimited" into "a few per
// minute per instance", which is the difference that matters. Redis-backed
// counting is the upgrade if this ever needs to be exact.
const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

const attempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const rec = attempts.get(key)
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    // Opportunistic sweep so the map can't grow without bound; cheap because
    // it only runs on a fresh window, not on every request.
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k)
    }
    return false
  }
  rec.count++
  return rec.count > MAX_ATTEMPTS
}

/** Successful login clears the counter, so ordinary users are never locked. */
const clearAttempts = (key: string) => attempts.delete(key)

/** Best-effort client identity for rate limiting. */
function clientKey(req: Request, email: string): string {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  // Keyed on ip+email: one attacker can't lock out every account from one IP,
  // and one victim's account can't be locked out from many IPs either.
  return `${ip}:${email.toLowerCase()}`
}

interface ProfileAuthRow {
  id: string
  role: string
  institution_id: string | null
  active: boolean
  password_hash: string | null
}

const issue = (p: ProfileAuthRow) =>
  NextResponse.json({
    access_token: signToken({ sub: p.id, role: p.role, inst: p.institution_id, typ: 'access' }, ACCESS_TTL),
    refresh_token: signToken({ sub: p.id, role: p.role, inst: p.institution_id, typ: 'refresh' }, REFRESH_TTL),
    expires_in: ACCESS_TTL,
    user: { id: p.id },
  })

export async function POST(req: Request) {
  if (!pgConfigured) {
    return NextResponse.json({ msg: 'DATABASE_URL is not configured.' }, { status: 500 })
  }
  const body = (await req.json().catch(() => null)) as Record<string, string> | null
  if (!body) return NextResponse.json({ msg: 'Bad request' }, { status: 400 })

  try {
    if (body.grant === 'password') {
      const email = String(body.email ?? '').trim()
      const key = clientKey(req, email)
      if (rateLimited(key)) {
        return NextResponse.json(
          { msg: 'Too many sign-in attempts. Try again in a few minutes.' },
          { status: 429, headers: { 'Retry-After': String(WINDOW_MS / 1000) } }
        )
      }

      const rows = await q<ProfileAuthRow>(
        `select id, role, institution_id, active, password_hash
           from simblip_profiles where lower(email) = lower($1)`,
        [email]
      )
      const p = rows[0]
      // SECURITY: a deactivated account used to answer 403 "This account has
      // been deactivated" while an unknown one answered 400 — which confirmed
      // to an attacker that the address exists. Wrong password, unknown
      // address and disabled account are now indistinguishable from outside.
      // The distinction is kept in the server log for support.
      // verifyPassword runs FIRST and unconditionally when a row exists, so a
      // deactivated account costs the same scrypt time as an active one —
      // short-circuiting on `active` would leak the account's existence
      // through response timing instead of through the status code.
      const passwordOk = p ? verifyPassword(String(body.password ?? ''), p.password_hash) : false
      if (!p || !passwordOk || !p.active) {
        if (p && passwordOk && !p.active) {
          console.warn(`[auth] sign-in refused: profile ${p.id} is deactivated`)
        }
        return NextResponse.json({ msg: 'Invalid email or password.' }, { status: 400 })
      }
      clearAttempts(key)
      return issue(p)
    }

    if (body.grant === 'refresh') {
      const claims = verifyToken(String(body.refresh_token ?? ''), 'refresh')
      if (!claims) return NextResponse.json({ msg: 'Invalid refresh token.' }, { status: 401 })
      // Re-read the profile so role changes and deactivation take effect.
      const rows = await q<ProfileAuthRow>(
        `select id, role, institution_id, active, password_hash
           from simblip_profiles where id = $1`,
        [claims.sub]
      )
      const p = rows[0]
      if (!p || !p.active) return NextResponse.json({ msg: 'Account unavailable.' }, { status: 401 })
      return issue(p)
    }

    return NextResponse.json({ msg: 'Unknown grant.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { msg: err instanceof Error ? err.message : 'Auth failed' },
      { status: 500 }
    )
  }
}
