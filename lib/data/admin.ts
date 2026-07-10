'use client'

// Institution admin operations: people, rooms, boards, branding.
//
// In local demo mode these are fully functional (accounts live in the demo
// database). In cloud mode, creating auth users requires the service role —
// that is the platform operator's provisioning path (supabase/provision.sql),
// so `createPerson`/`createBoard` throw a descriptive error instead.

import * as db from './db'
import { useAuthStore } from '@/lib/auth/store'
import type { Role } from '@/lib/auth/types'
import type { BoardRow, InstitutionRow, ProfileRow, RoomMemberRow, RoomRow } from './types'
import { newPairingCode } from './boards'

const requireAdmin = (): ProfileRow => {
  const { profile } = useAuthStore.getState()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'super_admin'))
    throw new Error('Institution admin access required.')
  return profile
}

const cloudProvisioningError = () =>
  new Error(
    'Cloud mode: user accounts are provisioned by the SIMBLIP operator with the service role key (see supabase/provision.sql). In local demo mode this works directly.'
  )

// ── People ──────────────────────────────────────────────────────────────────

export const listPeople = async (): Promise<ProfileRow[]> => {
  const admin = requireAdmin()
  const rows = await db.list<ProfileRow>('profiles', { institution_id: admin.institution_id })
  return rows.sort((a, b) => a.full_name.localeCompare(b.full_name))
}

export async function createPerson(input: {
  fullName: string
  email: string
  role: Extract<Role, 'teacher' | 'student'>
  department?: string
  password: string
}): Promise<ProfileRow> {
  const admin = requireAdmin()
  if (db.getDbMode() === 'cloud') throw cloudProvisioningError()
  const existing = await db.list<ProfileRow>('profiles', { email: input.email.trim().toLowerCase() })
  if (existing.length > 0) throw new Error('An account with this email already exists.')
  const row: ProfileRow = {
    id: db.newId(),
    institution_id: admin.institution_id,
    role: input.role,
    full_name: input.fullName,
    email: input.email.trim().toLowerCase(),
    department: input.department ?? null,
    active: true,
    password: input.password,
  }
  await db.insert('profiles', row)
  return row
}

export const setPersonActive = (id: string, active: boolean) =>
  db.update('profiles', id, { active })

export async function resetPassword(id: string, password: string): Promise<void> {
  if (db.getDbMode() === 'cloud') throw cloudProvisioningError()
  await db.update('profiles', id, { password })
}

export const subscribeProfiles = (fn: () => void) => db.subscribe('profiles', fn)

// ── Rooms & membership ──────────────────────────────────────────────────────

export const listRooms = async (): Promise<RoomRow[]> => {
  const { profile } = useAuthStore.getState()
  if (!profile) return []
  const rows = await db.list<RoomRow>('rooms', { institution_id: profile.institution_id })
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export const listRoomMembers = (roomId: string) =>
  db.list<RoomMemberRow>('room_members', { room_id: roomId })

export const listAllMembers = () => db.list<RoomMemberRow>('room_members')

export async function createRoom(name: string, department?: string): Promise<RoomRow> {
  const admin = requireAdmin()
  const row: RoomRow = {
    id: db.newId(),
    institution_id: admin.institution_id,
    name,
    department: department ?? null,
  }
  await db.insert('rooms', row)
  return row
}

export async function setMembership(
  roomId: string,
  profileId: string,
  memberRole: 'teacher' | 'student',
  enrolled: boolean
): Promise<void> {
  requireAdmin()
  const id = `${roomId}:${profileId}`
  if (enrolled) {
    await db.insert<RoomMemberRow>('room_members', {
      id,
      room_id: roomId,
      profile_id: profileId,
      member_role: memberRole,
    })
  } else {
    await db.removeWhere('room_members', { room_id: roomId, profile_id: profileId })
  }
}

export const subscribeRooms = (fn: () => void) => db.subscribe('rooms', fn)
export const subscribeMembers = (fn: () => void) => db.subscribe('room_members', fn)

// ── Boards ──────────────────────────────────────────────────────────────────

export const listBoards = () => db.list<BoardRow>('boards')

export async function createBoard(roomId: string, roomName: string, password: string): Promise<{ board: BoardRow; email: string }> {
  const admin = requireAdmin()
  if (db.getDbMode() === 'cloud') throw cloudProvisioningError()
  const existing = await db.list<BoardRow>('boards', { room_id: roomId })
  if (existing.length > 0) throw new Error('This room already has a board.')
  const slug = roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const email = `board-${slug}@${(admin.email.split('@')[1] ?? 'demo.edu')}`
  const boardProfile: ProfileRow = {
    id: db.newId(),
    institution_id: admin.institution_id,
    role: 'board',
    full_name: `${roomName} Board`,
    email,
    active: true,
    password,
  }
  await db.insert('profiles', boardProfile)
  const board: BoardRow = {
    id: db.newId(),
    institution_id: admin.institution_id,
    room_id: roomId,
    profile_id: boardProfile.id,
    pairing_code: newPairingCode(),
    pairing_rotated_at: new Date().toISOString(),
  }
  await db.insert('boards', board)
  return { board, email }
}

// ── Institution branding & settings ─────────────────────────────────────────

export async function updateInstitution(patch: {
  name?: string
  logo_url?: string | null
  accent_color?: string | null
}): Promise<void> {
  const admin = requireAdmin()
  await db.update('institutions', admin.institution_id, patch)
  const { institution } = useAuthStore.getState()
  if (institution) useAuthStore.setState({ institution: { ...institution, ...patch } })
}
