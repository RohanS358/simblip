import { NextResponse } from 'next/server'
import { insertRow, pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims, hashPassword } from '@/lib/server/auth'

// Institution-admin provisioning (cloud mode). Password hashes never reach
// the browser, so account creation and resets go through this route.
//
//   caller  → must hold a valid session whose profile is an active
//             institution admin (or the platform operator).
//   scope   → every action is forced into the caller's OWN institution;
//             targets outside it (or other admins) are rejected.

interface CallerProfile {
  id: string
  institution_id: string
  role: string
  active: boolean
}

export async function POST(req: Request) {
  if (!pgConfigured) {
    return NextResponse.json({ error: 'Cloud provisioning requires DATABASE_URL on the server.' }, { status: 500 })
  }

  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const caller = (await q<CallerProfile>(
    'select id, institution_id, role, active from simblip_profiles where id = $1',
    [claims.sub]
  ))[0]
  if (!caller?.active || !['admin', 'super_admin'].includes(caller.role)) {
    return NextResponse.json({ error: 'Institution admin access required.' }, { status: 403 })
  }
  const institutionId = caller.institution_id

  const { action, payload } = (await req.json()) as { action: string; payload: Record<string, unknown> }

  try {
    // ── Create a teacher or student in the caller's institution ────────────
    if (action === 'createPerson') {
      const role = String(payload.role)
      if (!['teacher', 'student'].includes(role)) {
        return NextResponse.json({ error: 'Admins can create teacher and student accounts.' }, { status: 400 })
      }
      const profile = {
        id: crypto.randomUUID(),
        institution_id: institutionId, // never trust a client-sent tenant
        role,
        full_name: String(payload.full_name).trim(),
        email: String(payload.email).trim().toLowerCase(),
        department: (payload.department as string | null) ?? null,
        active: true,
      }
      await insertRow('profiles', { ...profile, password_hash: hashPassword(String(payload.password)) })
      return NextResponse.json(profile)
    }

    // ── Reset a password inside the caller's institution ────────────────────
    if (action === 'resetPassword') {
      const targetId = String(payload.profile_id)
      const target = (await q<{ id: string; institution_id: string; role: string }>(
        'select id, institution_id, role from simblip_profiles where id = $1',
        [targetId]
      ))[0]
      const selfReset = targetId === caller.id
      if (
        !target ||
        target.institution_id !== institutionId ||
        (!selfReset && !['teacher', 'student', 'board'].includes(target.role))
      ) {
        return NextResponse.json({ error: 'Target account is outside your scope.' }, { status: 403 })
      }
      await q('update simblip_profiles set password_hash = $1 where id = $2', [
        hashPassword(String(payload.password)),
        targetId,
      ])
      return NextResponse.json({ success: true })
    }

    // ── Create a room board (dedicated display account) ─────────────────────
    if (action === 'createBoard') {
      const roomId = String(payload.room_id)
      const room = (await q<{ id: string; institution_id: string; name: string }>(
        'select id, institution_id, name from simblip_rooms where id = $1',
        [roomId]
      ))[0]
      if (!room || room.institution_id !== institutionId) {
        return NextResponse.json({ error: 'Room not found in your institution.' }, { status: 403 })
      }
      const existing = await q('select id from simblip_boards where room_id = $1', [roomId])
      if (existing.length > 0) {
        return NextResponse.json({ error: 'This room already has a board.' }, { status: 400 })
      }

      const email = String(payload.email).trim().toLowerCase()
      const profileId = crypto.randomUUID()
      await insertRow('profiles', {
        id: profileId,
        institution_id: institutionId,
        role: 'board',
        full_name: `${room.name} Board`,
        email,
        active: true,
        password_hash: hashPassword(String(payload.password)),
      })

      const board = {
        id: crypto.randomUUID(),
        institution_id: institutionId,
        room_id: roomId,
        profile_id: profileId,
        pairing_code: String(payload.pairing_code),
        pairing_rotated_at: new Date().toISOString(),
      }
      await insertRow('boards', board)
      return NextResponse.json({ board, email })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Provisioning failed' },
      { status: 400 }
    )
  }
}
