// Roles and permissions for the multi-tenant education platform.
//
// The Institution is the tenant; every user belongs to exactly one and has
// exactly one role. `board` is not a person: it is the dedicated account a
// physical classroom display signs in with.

export type Role = 'super_admin' | 'admin' | 'teacher' | 'student' | 'board'

export interface Institution {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  accentColor?: string | null
  settings?: Record<string, unknown>
}

export interface Profile {
  id: string
  institutionId: string
  role: Role
  fullName: string
  email: string
  avatarUrl?: string | null
  department?: string | null
  active: boolean
}

export interface Room {
  id: string
  institutionId: string
  name: string
  department?: string | null
}

export interface RoomMember {
  roomId: string
  profileId: string
  memberRole: 'teacher' | 'student'
}

// ── Permissions ─────────────────────────────────────────────────────────────
// Students deliberately get fewer shortcuts: no AI, no library publishing.
// The goal is that students build systems themselves.

export type Permission =
  | 'use-ai'
  | 'share-pages'
  | 'create-assignments'
  | 'review-submissions'
  | 'submit-assignments'
  | 'publish-library'
  | 'approve-library'
  | 'browse-library'
  | 'present-on-board'
  | 'manage-institution'
  | 'edit-notebooks'

const GRANTS: Record<Role, readonly Permission[]> = {
  super_admin: [
    'use-ai', 'share-pages', 'create-assignments', 'review-submissions',
    'publish-library', 'approve-library', 'browse-library', 'present-on-board',
    'manage-institution', 'edit-notebooks',
  ],
  admin: [
    'use-ai', 'share-pages', 'create-assignments', 'review-submissions',
    'publish-library', 'approve-library', 'browse-library', 'present-on-board',
    'manage-institution', 'edit-notebooks',
  ],
  teacher: [
    'use-ai', 'share-pages', 'create-assignments', 'review-submissions',
    'publish-library', 'browse-library', 'present-on-board', 'edit-notebooks',
  ],
  student: ['submit-assignments', 'browse-library', 'edit-notebooks'],
  board: ['browse-library'], // presentation surface only
}

export const can = (role: Role | null | undefined, p: Permission): boolean =>
  Boolean(role && GRANTS[role]?.includes(p))

/** Where each role lands after signing in. */
export const homeFor = (role: Role): string =>
  role === 'board' ? '/board' : role === 'super_admin' ? '/dev' : role === 'admin' ? '/admin' : '/notebook'

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Platform Admin',
  admin: 'Institution Admin',
  teacher: 'Teacher',
  student: 'Student',
  board: 'Room Board',
}
