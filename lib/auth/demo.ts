// Local demo tenant. Without a cloud database configured SIMBLIP stays fully
// offline (that IS the dev/demo mode): one seeded institution lives in this
// browser so every enterprise flow — RBAC, boards, sharing, assignments,
// admin — works end to end without infrastructure. With credentials present
// the same code paths run against the cloud instead.

import type { Institution, Profile, Room, RoomMember } from './types'

export const DEMO_INSTITUTION: Institution = {
  id: 'inst-demo',
  name: 'Aurora Institute of Technology',
  slug: 'aurora-tech',
  accentColor: '#3b82f6',
  logoUrl: null,
}

export interface DemoAccount extends Profile {
  password: string
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    // Platform operator — the /dev console. Not part of any real tenant's
    // staff; in demo mode it lives under the demo institution for simplicity.
    id: 'user-operator',
    institutionId: 'inst-demo',
    role: 'super_admin',
    fullName: 'SIMBLIP Operator',
    email: 'aalubhentakobhi@simblip.dev',
    password: 'loonivaislobhi',
    active: true,
  },
  {
    id: 'user-admin',
    institutionId: 'inst-demo',
    role: 'admin',
    fullName: 'Prof. Ada Sharma',
    email: 'admin@demo.edu',
    password: 'admin',
    active: true,
  },
  {
    id: 'user-teacher',
    institutionId: 'inst-demo',
    role: 'teacher',
    fullName: 'Dr. Elena Vasquez',
    email: 'teacher@demo.edu',
    password: 'teacher',
    department: 'Physics',
    active: true,
  },
  {
    id: 'user-student',
    institutionId: 'inst-demo',
    role: 'student',
    fullName: 'Alex Kumar',
    email: 'student@demo.edu',
    password: 'student',
    department: 'Mechanical Engineering',
    active: true,
  },
  {
    id: 'user-student-2',
    institutionId: 'inst-demo',
    role: 'student',
    fullName: 'Priya Patel',
    email: 'priya@demo.edu',
    password: 'student',
    department: 'Electrical Engineering',
    active: true,
  },
  {
    id: 'user-board-201',
    institutionId: 'inst-demo',
    role: 'board',
    fullName: 'Room 201 Board',
    email: 'board-201@demo.edu',
    password: 'board201',
    active: true,
  },
  {
    id: 'user-board-204',
    institutionId: 'inst-demo',
    role: 'board',
    fullName: 'Room 204 Board',
    email: 'board-204@demo.edu',
    password: 'board204',
    active: true,
  },
]

export const DEMO_ROOMS: Room[] = [
  { id: 'room-201', institutionId: 'inst-demo', name: 'Room 201', department: 'Physics' },
  { id: 'room-204', institutionId: 'inst-demo', name: 'Room 204', department: 'Electronics' },
]

// One room per student; teachers are independent (no enrollment needed —
// they assign and present to any room in the institution).
export const DEMO_MEMBERS: RoomMember[] = [
  { roomId: 'room-201', profileId: 'user-student', memberRole: 'student' },
  { roomId: 'room-204', profileId: 'user-student-2', memberRole: 'student' },
]

/** room_id → board account, mirrors simblip_boards. */
export const DEMO_BOARDS = [
  { id: 'board-201', institutionId: 'inst-demo', roomId: 'room-201', profileId: 'user-board-201' },
  { id: 'board-204', institutionId: 'inst-demo', roomId: 'room-204', profileId: 'user-board-204' },
]
