'use client'

import * as db from './db'
import { getAccessToken, useAuthStore } from '@/lib/auth/store'
import { newPairingCode } from './boards'
import type { BoardRow, BugReportRow, InstitutionRow, ProfileRow, RoomMemberRow, RoomRow } from './types'
import type { Role } from '@/lib/auth/types'

const requirePlatformAdmin = () => {
  const { profile } = useAuthStore.getState()
  if (!profile || profile.role !== 'super_admin') {
    throw new Error('Platform admin access required.')
  }
  return profile
}

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

async function cloudProvision<T>(action: string, payload: unknown): Promise<T> {
  const response = await fetch('/api/dev/provision', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken() ?? ''}`,
    },
    body: JSON.stringify({ action, payload }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Cloud provisioning failed')
  }
  return response.json()
}

export const listInstitutions = () => db.list<InstitutionRow>('institutions')
export const listProfiles = () => db.list<ProfileRow>('profiles')
export const listRooms = () => db.list<RoomRow>('rooms')
export const listBoards = () => db.list<BoardRow>('boards')
export const listMembers = () => db.list<RoomMemberRow>('room_members')

/** User-filed bug reports, newest first (see simblip_bug_reports in
 *  db/schema.sql). Operator-only in practice: the /api/pg gateway scopes a
 *  normal caller to their own reports, and skips both the tenant and owner
 *  scopes for an operator token — which is what the /dev console holds. */
export const listBugReports = () =>
  db.list<BugReportRow>('bug_reports', undefined, '*')

export const setBugStatus = (id: string, status: 'open' | 'closed') =>
  db.update('bug_reports', id, { status })

export async function createInstitution(input: {
  name: string
  slug?: string
  logoUrl?: string | null
  accentColor?: string | null
  licensedUntil?: string | null
  active?: boolean
}): Promise<InstitutionRow> {
  requirePlatformAdmin()
  const row: InstitutionRow = {
    id: db.newId(),
    name: input.name.trim(),
    slug: (input.slug?.trim() || normalizeSlug(input.name)),
    logo_url: input.logoUrl ?? null,
    accent_color: input.accentColor ?? '#3b82f6',
    settings: {},
    active: input.active ?? true,
    licensed_until: input.licensedUntil ?? null,
  }
  await db.insert('institutions', row)
  return row
}

export async function createInstitutionWithAdmin(input: {
  institution: {
    name: string
    slug?: string
    logoUrl?: string | null
    accentColor?: string | null
    licensedUntil?: string | null
    active?: boolean
  }
  admin: {
    fullName: string
    email: string
    password: string
    department?: string | null
  }
}): Promise<{ institution: InstitutionRow; admin: ProfileRow }> {
  if (db.getDbMode() === 'cloud') {
    requirePlatformAdmin()
    // The provisioning route inserts these rows verbatim — send exact
    // snake_case column shapes, and the admin's role explicitly.
    const institution: InstitutionRow = {
      id: db.newId(),
      name: input.institution.name.trim(),
      slug: input.institution.slug?.trim() || normalizeSlug(input.institution.name),
      logo_url: input.institution.logoUrl ?? null,
      accent_color: input.institution.accentColor ?? '#3b82f6',
      settings: {},
      active: input.institution.active ?? true,
      licensed_until: input.institution.licensedUntil ?? null,
    }
    return cloudProvision('createInstitutionWithAdmin', {
      institution,
      admin: {
        role: 'admin',
        full_name: input.admin.fullName.trim(),
        email: input.admin.email.trim().toLowerCase(),
        password: input.admin.password,
        department: input.admin.department ?? null,
      },
    })
  }
  const institution = await createInstitution(input.institution)
  const admin: ProfileRow = {
    id: db.newId(),
    institution_id: institution.id,
    role: 'admin',
    full_name: input.admin.fullName.trim(),
    email: input.admin.email.trim().toLowerCase(),
    department: input.admin.department ?? null,
    active: true,
    password: input.admin.password,
  }
  await db.insert('profiles', admin)
  return { institution, admin }
}

export async function createAccount(input: {
  institutionId: string
  role: Exclude<Role, 'board'>
  fullName: string
  email: string
  password: string
  department?: string | null
  active?: boolean
}): Promise<ProfileRow> {
  requirePlatformAdmin()
  if (db.getDbMode() === 'cloud') {
    // Route spreads the payload into simblip_profiles — snake_case only.
    return cloudProvision('createAccount', {
      institution_id: input.institutionId,
      role: input.role,
      full_name: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      password: input.password,
      department: input.department ?? null,
      active: input.active ?? true,
    })
  }
  const row: ProfileRow = {
    id: db.newId(),
    institution_id: input.institutionId,
    role: input.role,
    full_name: input.fullName.trim(),
    email: input.email.trim().toLowerCase(),
    department: input.department ?? null,
    active: input.active ?? true,
    password: input.password,
  }
  await db.insert('profiles', row)
  return row
}

export async function createRoom(input: {
  institutionId: string
  name: string
  department?: string | null
}): Promise<RoomRow> {
  requirePlatformAdmin()
  if (db.getDbMode() === 'cloud') {
    const row: RoomRow = {
      id: db.newId(),
      institution_id: input.institutionId,
      name: input.name.trim(),
      department: input.department ?? null,
    }
    return cloudProvision('createRoom', row)
  }
  const row: RoomRow = {
    id: db.newId(),
    institution_id: input.institutionId,
    name: input.name.trim(),
    department: input.department ?? null,
  }
  await db.insert('rooms', row)
  return row
}

export async function createBoard(input: {
  institutionId: string
  roomId: string
  roomName: string
  email?: string
  password: string
}): Promise<{ profile: ProfileRow; board: BoardRow }> {
  requirePlatformAdmin()
  if (db.getDbMode() === 'cloud') {
    const email = input.email?.trim().toLowerCase() || `board-${normalizeSlug(input.roomName)}@simblip.local`
    const profile: ProfileRow = {
      id: db.newId(),
      institution_id: input.institutionId,
      role: 'board',
      full_name: `${input.roomName} Board`,
      email,
      active: true,
      password: input.password,
    }
    const board: BoardRow = {
      id: db.newId(),
      institution_id: input.institutionId,
      room_id: input.roomId,
      profile_id: profile.id, // Replaced by API endpoint
      pairing_code: newPairingCode(),
      pairing_rotated_at: new Date().toISOString(),
    }
    return cloudProvision('createBoard', { profile, board })
  }
  const email = input.email?.trim().toLowerCase() || `board-${normalizeSlug(input.roomName)}@simblip.local`
  const profile: ProfileRow = {
    id: db.newId(),
    institution_id: input.institutionId,
    role: 'board',
    full_name: `${input.roomName} Board`,
    email,
    active: true,
    password: input.password,
  }
  await db.insert('profiles', profile)
  const board: BoardRow = {
    id: db.newId(),
    institution_id: input.institutionId,
    room_id: input.roomId,
    profile_id: profile.id,
    pairing_code: newPairingCode(),
    pairing_rotated_at: new Date().toISOString(),
  }
  await db.insert('boards', board)
  return { profile, board }
}

export async function setMembership(input: {
  roomId: string
  profileId: string
  memberRole: 'teacher' | 'student'
  enrolled: boolean
}): Promise<void> {
  requirePlatformAdmin()
  if (db.getDbMode() === 'cloud') {
    return cloudProvision('setMembership', input)
  }
  if (input.enrolled) {
    await db.insert<RoomMemberRow>('room_members', {
      id: `${input.roomId}:${input.profileId}`,
      room_id: input.roomId,
      profile_id: input.profileId,
      member_role: input.memberRole,
    })
    return
  }
  await db.removeWhere('room_members', { room_id: input.roomId, profile_id: input.profileId })
}

export async function updateInstitutionPackages(institutionId: string, packages: string[]): Promise<void> {
  requirePlatformAdmin()
  const insts = await listInstitutions()
  const inst = insts.find((i) => i.id === institutionId)
  const currentSettings = (inst?.settings as Record<string, unknown> | undefined) ?? {}
  await db.update('institutions', institutionId, {
    settings: { ...currentSettings, package_access: packages },
  })
}

export async function updateProfilePackages(profileId: string, packages: string[]): Promise<void> {
  requirePlatformAdmin()
  await db.update('profiles', profileId, {
    package_access: packages,
  })
}