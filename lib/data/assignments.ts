'use client'

// Assignments: a teacher freezes a page as the starter, targets rooms and/or
// individual students, sets a due date. Students clone the starter into their
// own notebook, work there, and submit a snapshot. The teacher dashboard
// tracks assigned → opened → in progress → submitted → late → reviewed.

import * as db from './db'
import { useAuthStore } from '@/lib/auth/store'
import type { PageDoc } from '@/lib/scene/types'
import type { AssignmentRow, SubmissionRow, SubmissionStatus } from './types'

export async function createAssignment(input: {
  title: string
  description?: string
  instructions?: string
  content: PageDoc
  roomIds: string[]
  profileIds?: string[]
  dueAt: string | null
}): Promise<void> {
  const { profile } = useAuthStore.getState()
  if (!profile) throw new Error('Not signed in')
  const row: AssignmentRow = {
    id: db.newId(),
    institution_id: profile.institution_id,
    teacher_id: profile.id,
    teacher_name: profile.full_name,
    title: input.title,
    description: input.description ?? null,
    instructions: input.instructions ?? null,
    content: JSON.parse(JSON.stringify(input.content)) as PageDoc,
    room_ids: input.roomIds,
    profile_ids: input.profileIds ?? [],
    due_at: input.dueAt,
    created_at: new Date().toISOString(),
  }
  await db.insert('assignments', row)
}

export async function listMyAssignments(): Promise<AssignmentRow[]> {
  const { profile, myRoomIds } = useAuthStore.getState()
  if (!profile) return []
  const rows = await db.list<AssignmentRow>('assignments', {
    institution_id: profile.institution_id,
  })
  const mine =
    profile.role === 'student'
      ? rows.filter(
          (a) =>
            a.profile_ids.includes(profile.id) ||
            a.room_ids.some((r) => myRoomIds.includes(r))
        )
      : rows.filter((a) => a.teacher_id === profile.id)
  return mine.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Assignments addressed to one room — the board's idle feed. Metadata
 *  only: the starter PageDoc stays out of the classroom display's fetch. */
export async function listRoomAssignments(roomId: string): Promise<AssignmentRow[]> {
  const { profile } = useAuthStore.getState()
  if (!profile) return []
  const rows = await db.list<AssignmentRow>(
    'assignments',
    { institution_id: profile.institution_id },
    'id,teacher_id,teacher_name,title,description,room_ids,profile_ids,due_at,created_at'
  )
  return rows
    .filter((a) => a.room_ids.includes(roomId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function getAssignment(id: string): Promise<AssignmentRow | null> {
  const { profile } = useAuthStore.getState()
  if (!profile) return null
  const rows = await db.list<AssignmentRow>('assignments', { institution_id: profile.institution_id })
  return rows.find((a) => a.id === id) ?? null
}

export const removeAssignment = (id: string) => db.removeById('assignments', id)

export const subscribeAssignments = (fn: () => void) => db.subscribe('assignments', fn)
export const subscribeSubmissions = (fn: () => void) => db.subscribe('submissions', fn)

// ── Submissions ─────────────────────────────────────────────────────────────

export async function mySubmissions(): Promise<SubmissionRow[]> {
  const { profile } = useAuthStore.getState()
  if (!profile) return []
  return db.list<SubmissionRow>('submissions', { student_id: profile.id })
}

export const submissionsFor = (assignmentId: string) =>
  db.list<SubmissionRow>('submissions', { assignment_id: assignmentId })

/** Create or update the signed-in student's submission for an assignment. */
export async function upsertSubmission(
  assignment: AssignmentRow,
  patch: { status: SubmissionStatus; content?: PageDoc | null }
): Promise<void> {
  const { profile } = useAuthStore.getState()
  if (!profile) throw new Error('Not signed in')
  const existing = (await mySubmissions()).find((s) => s.assignment_id === assignment.id)
  const now = new Date().toISOString()
  const late =
    patch.status === 'submitted' && assignment.due_at && now > assignment.due_at
  const status: SubmissionStatus = late ? 'late' : patch.status
  if (existing) {
    await db.update('submissions', existing.id, {
      status,
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(status === 'submitted' || status === 'late' ? { submitted_at: now } : {}),
      updated_at: now,
    })
    return
  }
  const row: SubmissionRow = {
    id: db.newId(),
    institution_id: profile.institution_id,
    assignment_id: assignment.id,
    student_id: profile.id,
    student_name: profile.full_name,
    status,
    content: patch.content ?? null,
    submitted_at: status === 'submitted' || status === 'late' ? now : null,
    updated_at: now,
  }
  await db.insert('submissions', row)
}

export const reviewSubmission = (id: string, feedback: string) =>
  db.update('submissions', id, {
    status: 'reviewed',
    feedback,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

// ── Notebook linkage (per user, per device) ─────────────────────────────────
// Which local page holds the student's working copy of each assignment.

const linkKey = (userId: string) => `simblip-assignment-pages:${userId}`

export function assignmentPageLinks(userId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(linkKey(userId)) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function linkAssignmentPage(userId: string, assignmentId: string, pageId: string) {
  const links = assignmentPageLinks(userId)
  links[assignmentId] = pageId
  localStorage.setItem(linkKey(userId), JSON.stringify(links))
}
