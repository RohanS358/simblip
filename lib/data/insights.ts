// Client-side aggregation for the teacher assignment insights dashboard —
// pure functions over data already fetched by listMyAssignments() /
// listInstitutionSubmissions(), no new I/O. See
// docs/superpowers/specs/2026-08-10-assignment-insights-dashboard-design.md.

import type { AssignmentRow, ProfileRow, SubmissionRow } from './types'

const DONE_STATUSES = new Set(['submitted', 'late', 'reviewed'])

export interface AssignmentStats {
  assignment: AssignmentRow
  completionRate: number // 0-100
  onTimeRate: number // 0-100, of submitted work only
  avgTurnaroundHours: number | null // submitted_at -> reviewed_at, reviewed only
  submittedCount: number
  targetCount: number
}

export function computeAssignmentStats(
  assignment: AssignmentRow,
  submissions: SubmissionRow[],
  targets: ProfileRow[]
): AssignmentStats {
  const targetCount = targets.length
  const submitted = submissions.filter((s) => DONE_STATUSES.has(s.status))
  const submittedCount = submitted.length
  const completionRate = targetCount === 0 ? 0 : Math.round((submittedCount / targetCount) * 100)
  const onTime = submitted.filter((s) => s.status !== 'late')
  const onTimeRate = submittedCount === 0 ? 0 : Math.round((onTime.length / submittedCount) * 100)
  const turnarounds = submissions
    .filter((s) => s.status === 'reviewed' && s.submitted_at && s.reviewed_at)
    .map((s) => (new Date(s.reviewed_at!).getTime() - new Date(s.submitted_at!).getTime()) / 3_600_000)
  const avgTurnaroundHours =
    turnarounds.length === 0 ? null : turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
  return { assignment, completionRate, onTimeRate, avgTurnaroundHours, submittedCount, targetCount }
}

export interface OverviewStats {
  totalAssignments: number
  totalSubmissions: number
  onTimeRate: number
  avgTurnaroundHours: number | null
}

export function computeOverviewStats(assignmentStats: AssignmentStats[]): OverviewStats {
  const totalAssignments = assignmentStats.length
  const totalSubmissions = assignmentStats.reduce((sum, a) => sum + a.submittedCount, 0)
  const weightedOnTime = assignmentStats.reduce((sum, a) => sum + (a.onTimeRate * a.submittedCount) / 100, 0)
  const onTimeRate = totalSubmissions === 0 ? 0 : Math.round((weightedOnTime / totalSubmissions) * 100)
  const turnarounds = assignmentStats.filter((a) => a.avgTurnaroundHours !== null).map((a) => a.avgTurnaroundHours!)
  const avgTurnaroundHours =
    turnarounds.length === 0 ? null : turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length
  return { totalAssignments, totalSubmissions, onTimeRate, avgTurnaroundHours }
}

export interface TrendPoint {
  assignmentId: string
  label: string
  completionRate: number
}

/** Chronological (oldest first) so the line chart reads left-to-right as
 *  "over time," matching how a teacher thinks about progress. */
export function computeTrend(assignmentStats: AssignmentStats[]): TrendPoint[] {
  return [...assignmentStats]
    .sort((a, b) => a.assignment.created_at.localeCompare(b.assignment.created_at))
    .map((a) => ({
      assignmentId: a.assignment.id,
      label: a.assignment.title.length > 18 ? `${a.assignment.title.slice(0, 18)}…` : a.assignment.title,
      completionRate: a.completionRate,
    }))
}

export interface StudentStats {
  student: ProfileRow
  completionRate: number // 0-100, across all assignments targeting this student
  onTimeStreak: number // consecutive most-recent on-time submissions, 0 if none
  trend: 'up' | 'down' | 'flat'
}

/** Per-student rollup across every assignment in `assignments` that
 *  targeted them (via `targetsByAssignment`). Assignments are consumed in
 *  chronological order (oldest first) so "recent half vs older half" and
 *  "most recent streak" both read naturally. */
export function computeStudentStats(
  students: ProfileRow[],
  assignments: AssignmentRow[],
  subsByAssignment: Record<string, SubmissionRow[]>,
  targetsByAssignment: Record<string, ProfileRow[]>
): StudentStats[] {
  const sortedAssignments = [...assignments].sort((a, b) => a.created_at.localeCompare(b.created_at))

  return students.map((student) => {
    // This student's assignment history, oldest first: only assignments
    // that actually targeted them, each paired with their submission (or
    // null if they never submitted).
    const history = sortedAssignments
      .filter((a) => (targetsByAssignment[a.id] ?? []).some((p) => p.id === student.id))
      .map((a) => {
        const sub = (subsByAssignment[a.id] ?? []).find((s) => s.student_id === student.id) ?? null
        return { assignment: a, submission: sub }
      })

    const total = history.length
    const done = history.filter((h) => h.submission && DONE_STATUSES.has(h.submission.status))
    const completionRate = total === 0 ? 0 : Math.round((done.length / total) * 100)

    // Consecutive on-time submissions counting back from the most recent
    // assignment; a miss or a late submission breaks the streak.
    let onTimeStreak = 0
    for (let i = history.length - 1; i >= 0; i--) {
      const sub = history[i].submission
      if (sub && DONE_STATUSES.has(sub.status) && sub.status !== 'late') onTimeStreak++
      else break
    }

    // Trend: split history in half, compare completion rate of the recent
    // half against the older half. Fewer than 2 assignments -> flat (not
    // enough data to call a direction).
    let trend: StudentStats['trend'] = 'flat'
    if (total >= 2) {
      const mid = Math.floor(total / 2)
      const olderRate = rateOf(history.slice(0, mid))
      const recentRate = rateOf(history.slice(mid))
      if (recentRate > olderRate) trend = 'up'
      else if (recentRate < olderRate) trend = 'down'
    }

    return { student, completionRate, onTimeStreak, trend }
  })
}

function rateOf(history: { submission: SubmissionRow | null }[]): number {
  if (history.length === 0) return 0
  const done = history.filter((h) => h.submission && DONE_STATUSES.has(h.submission.status)).length
  return done / history.length
}
