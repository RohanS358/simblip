import { NextResponse } from 'next/server'
import { insertRow, pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims, hashPassword } from '@/lib/server/auth'

// Platform-operator provisioning (cross-tenant /dev console). Accounts are
// plain simblip_profiles rows with a scrypt password_hash — there is no
// separate auth service anymore.

export async function POST(req: Request) {
  if (!pgConfigured) {
    return NextResponse.json({ error: 'Provisioning requires DATABASE_URL in .env.local' }, { status: 500 })
  }

  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const caller = (await q<{ role: string; active: boolean }>(
    'select role, active from simblip_profiles where id = $1',
    [claims.sub]
  ))[0]
  if (!caller?.active || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 })
  }

  const { action, payload } = (await req.json()) as { action: string; payload: Record<string, unknown> }

  const createProfile = async (fields: Record<string, unknown>, password: string) => {
    const profile = {
      id: crypto.randomUUID(),
      active: true,
      ...fields,
      email: String(fields.email).trim().toLowerCase(),
    }
    await insertRow('profiles', { ...profile, password_hash: hashPassword(password) })
    return profile
  }

  try {
    if (action === 'createInstitutionWithAdmin') {
      const { institution, admin } = payload as {
        institution: Record<string, unknown>
        admin: Record<string, unknown> & { password: string }
      }
      await insertRow('institutions', institution)
      const { password, ...adminFields } = admin
      const adminProfile = await createProfile(
        { ...adminFields, institution_id: institution.id },
        password
      )
      return NextResponse.json({ institution, admin: adminProfile })
    }

    if (action === 'createAccount') {
      const { password, ...fields } = payload as Record<string, unknown> & { password: string }
      return NextResponse.json(await createProfile(fields, password))
    }

    if (action === 'createRoom') {
      await insertRow('rooms', payload)
      return NextResponse.json(payload)
    }

    if (action === 'createBoard') {
      const { profile, board } = payload as {
        profile: Record<string, unknown> & { password: string }
        board: Record<string, unknown>
      }
      const { password, ...fields } = profile
      const boardProfile = await createProfile(fields, password)
      const boardRow = { ...board, profile_id: boardProfile.id }
      await insertRow('boards', boardRow)
      return NextResponse.json({ profile: boardProfile, board: boardRow })
    }

    if (action === 'setMembership') {
      if (payload.enrolled) {
        await q(
          `insert into simblip_room_members (room_id, profile_id, member_role)
           values ($1, $2, $3) on conflict (room_id, profile_id) do update set member_role = excluded.member_role`,
          [payload.roomId, payload.profileId, payload.memberRole]
        )
      } else {
        await q('delete from simblip_room_members where room_id = $1 and profile_id = $2', [
          payload.roomId,
          payload.profileId,
        ])
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Provisioning failed' },
      { status: 400 }
    )
  }
}
