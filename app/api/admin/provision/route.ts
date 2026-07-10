import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Institution-admin provisioning (cloud mode). Creating or resetting auth
// accounts needs the service role key, which never reaches the browser — so
// the admin console calls this route. Authorization is strict:
//
//   caller  → must hold a valid session whose profile is an active
//             institution admin (or the platform operator).
//   scope   → every action is forced into the caller's OWN institution;
//             targets outside it (or other admins) are rejected.
//
// The platform operator's cross-tenant console uses /api/dev/provision.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

interface CallerProfile {
  id: string
  institution_id: string
  role: string
  active: boolean
  email: string
}

export async function POST(req: Request) {
  if (!URL || !SERVICE_KEY) {
    return NextResponse.json(
      { error: 'Cloud provisioning requires SUPABASE_SERVICE_ROLE_KEY on the server.' },
      { status: 500 }
    )
  }

  const supabase = createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('simblip_profiles')
    .select('id, institution_id, role, active, email')
    .eq('id', user.id)
    .single<CallerProfile>()

  if (!caller || !caller.active || !['admin', 'super_admin'].includes(caller.role)) {
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
      const email = String(payload.email).trim().toLowerCase()
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password: String(payload.password),
        email_confirm: true,
      })
      if (authErr) throw authErr

      const profile = {
        id: authUser.user.id,
        institution_id: institutionId, // never trust a client-sent tenant
        role,
        full_name: String(payload.full_name).trim(),
        email,
        department: (payload.department as string | null) ?? null,
        active: true,
      }
      const { error: profError } = await supabase.from('simblip_profiles').insert(profile)
      if (profError) {
        await supabase.auth.admin.deleteUser(authUser.user.id) // don't strand auth users
        throw profError
      }
      return NextResponse.json(profile)
    }

    // ── Reset a password inside the caller's institution ────────────────────
    if (action === 'resetPassword') {
      const targetId = String(payload.profile_id)
      const { data: target } = await supabase
        .from('simblip_profiles')
        .select('id, institution_id, role')
        .eq('id', targetId)
        .single()
      const selfReset = targetId === caller.id
      if (
        !target ||
        target.institution_id !== institutionId ||
        (!selfReset && !['teacher', 'student', 'board'].includes(target.role))
      ) {
        return NextResponse.json({ error: 'Target account is outside your scope.' }, { status: 403 })
      }
      const { error } = await supabase.auth.admin.updateUserById(targetId, {
        password: String(payload.password),
      })
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    // ── Create a room board (dedicated display account) ─────────────────────
    if (action === 'createBoard') {
      const roomId = String(payload.room_id)
      const { data: room } = await supabase
        .from('simblip_rooms')
        .select('id, institution_id, name')
        .eq('id', roomId)
        .single()
      if (!room || room.institution_id !== institutionId) {
        return NextResponse.json({ error: 'Room not found in your institution.' }, { status: 403 })
      }
      const { data: existing } = await supabase
        .from('simblip_boards')
        .select('id')
        .eq('room_id', roomId)
      if (existing && existing.length > 0) {
        return NextResponse.json({ error: 'This room already has a board.' }, { status: 400 })
      }

      const email = String(payload.email).trim().toLowerCase()
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password: String(payload.password),
        email_confirm: true,
      })
      if (authErr) throw authErr

      const profile = {
        id: authUser.user.id,
        institution_id: institutionId,
        role: 'board',
        full_name: `${room.name} Board`,
        email,
        active: true,
      }
      const { error: profError } = await supabase.from('simblip_profiles').insert(profile)
      if (profError) {
        await supabase.auth.admin.deleteUser(authUser.user.id)
        throw profError
      }

      const board = {
        institution_id: institutionId,
        room_id: roomId,
        profile_id: authUser.user.id,
        pairing_code: String(payload.pairing_code),
        pairing_rotated_at: new Date().toISOString(),
      }
      const { data: boardRow, error: boardError } = await supabase
        .from('simblip_boards')
        .insert(board)
        .select()
        .single()
      if (boardError) throw boardError

      return NextResponse.json({ board: boardRow, email })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provisioning failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
