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
      const rows = await q<ProfileAuthRow>(
        `select id, role, institution_id, active, password_hash
           from simblip_profiles where lower(email) = lower($1)`,
        [String(body.email ?? '').trim()]
      )
      const p = rows[0]
      if (!p || !verifyPassword(String(body.password ?? ''), p.password_hash)) {
        return NextResponse.json({ msg: 'Invalid email or password.' }, { status: 400 })
      }
      if (!p.active) return NextResponse.json({ msg: 'This account has been deactivated.' }, { status: 403 })
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
