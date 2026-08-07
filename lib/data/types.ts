// Row shapes for the platform collections. Keys are snake_case to match
// db/schema.sql exactly — the same objects flow through the /api/pg gateway and
// the local demo database without mapping.

import type { PageDoc, SceneObject } from '@/lib/scene/types'
import type { Role } from '@/lib/auth/types'

export interface ProfileRow {
  id: string
  institution_id: string
  role: Role
  full_name: string
  email: string
  avatar_url?: string | null
  department?: string | null
  active: boolean
  /** local demo mode only — cloud auth is handled by GoTrue */
  password?: string
  [key: string]: unknown
}

export interface InstitutionRow {
  id: string
  name: string
  slug: string
  logo_url?: string | null
  accent_color?: string | null
  settings?: Record<string, unknown>
  active?: boolean
  [key: string]: unknown
}

export interface RoomRow {
  id: string
  institution_id: string
  name: string
  department?: string | null
  [key: string]: unknown
}

export interface RoomMemberRow {
  id: string // `${room_id}:${profile_id}` — synthesized, stable
  room_id: string
  profile_id: string
  member_role: 'teacher' | 'student'
  [key: string]: unknown
}

export interface BoardRow {
  id: string
  institution_id: string
  room_id: string
  profile_id: string
  pairing_code: string
  pairing_rotated_at?: string
  [key: string]: unknown
}

export type BoardSessionStatus = 'live' | 'ended' | 'merged' | 'discarded'

/** One command from the teacher's phone to the presenting board. Stored on
 *  the session row (last-write-wins); the board applies each new `seq` once. */
export interface RemoteCommand {
  seq: number
  kind: 'play' | 'pause' | 'stop' | 'pdf' | 'pptx' | 'select' | 'param' | 'toggle'
  /** pdf: page direction — pptx: slide direction */
  dir?: 1 | -1
  objectId?: string
  behaviorId?: string
  /** param: behavior param name — toggle: object parameter name (closed/value) */
  param?: string
  /** param: new expression, e.g. "9" or "2*g" */
  value?: string
}

export interface BoardSessionRow {
  id: string
  institution_id: string
  board_id: string
  teacher_id: string
  page_id: string
  page_name: string
  snapshot: PageDoc
  edited: PageDoc | null
  status: BoardSessionStatus
  started_at: string
  ended_at?: string | null
  remote?: RemoteCommand | null
  [key: string]: unknown
}

export interface ShareRow {
  id: string
  institution_id: string
  sender_id: string
  sender_name: string
  title: string
  content: PageDoc
  target_room_id: string | null
  target_profile_id: string | null
  created_at: string
  [key: string]: unknown
}

export type AssetKind = 'page' | 'objects'

export interface LibraryAssetRow {
  id: string
  institution_id: string
  uploader_id: string
  uploader_name: string
  title: string
  description?: string | null
  category: string
  tags: string[]
  kind: AssetKind
  content: PageDoc | SceneObject[]
  approved: boolean
  version: number
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface AssignmentRow {
  id: string
  institution_id: string
  teacher_id: string
  teacher_name: string
  title: string
  description?: string | null
  instructions?: string | null
  content: PageDoc
  room_ids: string[]
  profile_ids: string[]
  due_at: string | null
  created_at: string
  [key: string]: unknown
}

export type SubmissionStatus = 'opened' | 'in_progress' | 'submitted' | 'late' | 'reviewed'

export interface SubmissionRow {
  id: string
  institution_id: string
  assignment_id: string
  student_id: string
  student_name: string
  status: SubmissionStatus
  content: PageDoc | null
  feedback?: string | null
  submitted_at?: string | null
  reviewed_at?: string | null
  updated_at: string
  [key: string]: unknown
}

export interface AnnouncementRow {
  id: string
  institution_id: string
  room_id: string | null
  author_id: string
  author_name: string
  body: string
  created_at: string
  [key: string]: unknown
}

export const LIBRARY_CATEGORIES = [
  'general',
  'mechanics',
  'circuits',
  'waves',
  'thermodynamics',
  'mathematics',
  'lesson-pages',
  'experiments',
] as const
