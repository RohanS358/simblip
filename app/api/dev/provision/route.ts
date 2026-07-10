import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(req: Request) {
  if (!URL || !SERVICE_KEY) {
    return NextResponse.json(
      { error: 'Cloud provisioning requires SUPABASE_SERVICE_ROLE_KEY in .env.local' },
      { status: 500 }
    )
  }

  const supabase = createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Basic authorization: Verify the requester is a super_admin
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const token = authHeader.replace(/^Bearer\s+/, '')
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // Verify super_admin role
  const { data: profile } = await supabase
    .from('simblip_profiles')
    .select('role')
    .eq('id', user.id)
    .single()
    
  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 })
  }

  const body = await req.json()
  const { action, payload } = body

  try {
    if (action === 'createInstitutionWithAdmin') {
      const { institution, admin } = payload
      
      const { error: instError } = await supabase.from('simblip_institutions').insert(institution)
      if (instError) throw instError

      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email: admin.email,
        password: admin.password,
        email_confirm: true,
      })
      if (authErr) throw authErr

      const adminProfile = {
        id: authUser.user.id,
        institution_id: institution.id,
        role: admin.role,
        full_name: admin.full_name,
        email: admin.email,
        department: admin.department,
        active: true,
      }
      
      const { error: profError } = await supabase.from('simblip_profiles').insert(adminProfile)
      if (profError) throw profError

      return NextResponse.json({ institution, admin: adminProfile })
    }

    if (action === 'createAccount') {
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email: payload.email,
        password: payload.password,
        email_confirm: true,
      })
      if (authErr) throw authErr

      const accountProfile = {
        ...payload,
        id: authUser.user.id,
      }
      // Remove password before inserting into DB
      delete accountProfile.password
      
      const { error: profError } = await supabase.from('simblip_profiles').insert(accountProfile)
      if (profError) throw profError

      return NextResponse.json(accountProfile)
    }

    if (action === 'createRoom') {
      const { error } = await supabase.from('simblip_rooms').insert(payload)
      if (error) throw error
      return NextResponse.json(payload)
    }

    if (action === 'createBoard') {
      const { profile, board } = payload
      
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email: profile.email,
        password: profile.password,
        email_confirm: true,
      })
      if (authErr) throw authErr

      const boardProfile = {
        ...profile,
        id: authUser.user.id,
      }
      delete boardProfile.password
      
      const { error: profError } = await supabase.from('simblip_profiles').insert(boardProfile)
      if (profError) throw profError

      const boardRow = {
        ...board,
        profile_id: authUser.user.id,
      }
      
      const { error: boardError } = await supabase.from('simblip_boards').insert(boardRow)
      if (boardError) throw boardError

      return NextResponse.json({ profile: boardProfile, board: boardRow })
    }

    if (action === 'setMembership') {
      if (payload.enrolled) {
        const row = {
          room_id: payload.roomId,
          profile_id: payload.profileId,
          member_role: payload.memberRole,
        }
        const { error } = await supabase.from('simblip_room_members').insert(row)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('simblip_room_members')
          .delete()
          .eq('room_id', payload.roomId)
          .eq('profile_id', payload.profileId)
        if (error) throw error
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
