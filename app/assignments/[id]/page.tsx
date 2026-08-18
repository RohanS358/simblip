'use client'

// Assignment dashboard: everything derivable from one assignment's
// submissions in one place — roster status, timing, and per-student review —
// instead of the notebook sidebar's inline expandable row. Teacher-only
// (students track their own assignments in the notebook Assignments panel).

import { BounceLoader } from '@/components/ui/bounce-loader'
import { useNav } from '@/lib/use-nav'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { CalendarClock, Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { useAuthStore } from '@/lib/auth/store'
import {
  getAssignment,
  listMyAssignments,
  reviewSubmission,
  submissionsFor,
  subscribeSubmissions,
} from '@/lib/data/assignments'
import { listRooms, listAllMembers } from '@/lib/data/admin'
import * as db from '@/lib/data/db'
import type { AssignmentRow, ProfileRow, SubmissionRow, SubmissionStatus } from '@/lib/data/types'
import { importPageDoc } from '@/lib/store/import-page'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { StatusBreakdownBar, TimingChart, OnTimeRateChart, OnTimeTrendChart, StatTile } from '@/components/workspace/assignment-charts'

const STATUS_STYLE: Record<SubmissionStatus | 'assigned', string> = {
  assigned: 'bg-accent text-muted-foreground',
  opened: 'bg-[color-mix(in_oklch,var(--accent-blue)_15%,transparent)] text-[var(--accent-blue)]',
  in_progress: 'bg-[color-mix(in_oklch,var(--accent-amber)_18%,transparent)] text-[var(--accent-amber)]',
  submitted: 'bg-[color-mix(in_oklch,var(--accent-mint)_18%,transparent)] text-[var(--accent-mint)]',
  late: 'bg-[color-mix(in_oklch,var(--accent-rose)_18%,transparent)] text-[var(--accent-rose)]',
  reviewed: 'bg-[color-mix(in_oklch,var(--accent-violet)_18%,transparent)] text-[var(--accent-violet)]',
}

const STATUS_LABEL: Record<SubmissionStatus | 'assigned', string> = {
  assigned: 'Assigned',
  opened: 'Opened',
  in_progress: 'In progress',
  submitted: 'Submitted',
  late: 'Late',
  reviewed: 'Reviewed',
}

function StatusChip({ status }: { status: SubmissionStatus | 'assigned' }) {
  return (
    <span className={cn('rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold', STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  )
}

const dueLabel = (a: AssignmentRow) =>
  a.due_at ? `Due ${new Date(a.due_at).toLocaleString()}` : 'No due date'

function AssignmentDashboard({ id }: { id: string }) {
  const router = useNav()
  const profile = useAuthStore((s) => s.profile)!
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null)
  const [subs, setSubs] = useState<SubmissionRow[]>([])
  const [roster, setRoster] = useState<Record<string, ProfileRow[]>>({}) // room -> students
  const [roomNames, setRoomNames] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  // Every other assignment by this teacher + their submissions — the class-
  // trend charts need history beyond this one assignment to mean anything.
  const [history, setHistory] = useState<{ assignments: AssignmentRow[]; subs: SubmissionRow[] }>({
    assignments: [],
    subs: [],
  })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [a, rooms, members, people, allAssignments] = await Promise.all([
      getAssignment(id),
      listRooms(),
      listAllMembers(),
      db.list<ProfileRow>('profiles', { institution_id: profile.institution_id }),
      listMyAssignments(),
    ])
    setAssignment(a)
    setRoomNames(Object.fromEntries(rooms.map((r) => [r.id, r.name])))
    const byRoom: Record<string, ProfileRow[]> = {}
    for (const m of members) {
      if (m.member_role !== 'student') continue
      const p = people.find((x) => x.id === m.profile_id)
      if (p) (byRoom[m.room_id] ??= []).push(p)
    }
    setRoster(byRoom)
    setSubs(a ? await submissionsFor(a.id) : [])
    const allSubs = (await Promise.all(allAssignments.map((x) => submissionsFor(x.id)))).flat()
    setHistory({ assignments: allAssignments, subs: allSubs })
    setLoading(false)
  }, [id, profile.institution_id])

  useEffect(() => {
    void refresh()
    return subscribeSubmissions(() => void refresh())
  }, [refresh])

  const targets = useMemo(() => {
    if (!assignment) return []
    const seen = new Map<string, ProfileRow>()
    for (const roomId of assignment.room_ids) for (const p of roster[roomId] ?? []) seen.set(p.id, p)
    return [...seen.values()].sort((x, y) => x.full_name.localeCompare(y.full_name))
  }, [assignment, roster])

  const stats = useMemo(() => {
    const submitted = subs.filter((s) => ['submitted', 'late', 'reviewed'].includes(s.status)).length
    const late = subs.filter((s) => s.status === 'late').length
    const reviewed = subs.filter((s) => s.status === 'reviewed').length
    return { submitted, late, reviewed, total: targets.length }
  }, [subs, targets])

  // Per-student on-time rate across every assignment this teacher has given
  // them — the real "student behavior" signal (one assignment's timing is
  // one data point; this is the pattern).
  const onTimeRows = useMemo(() => {
    const byStudent = new Map<string, { name: string; onTime: number; total: number }>()
    for (const s of history.subs) {
      if (!['submitted', 'late', 'reviewed'].includes(s.status)) continue
      const entry = byStudent.get(s.student_id) ?? { name: s.student_name, onTime: 0, total: 0 }
      entry.total += 1
      if (s.status !== 'late') entry.onTime += 1
      byStudent.set(s.student_id, entry)
    }
    return [...byStudent.entries()].map(([studentId, v]) => ({
      studentId,
      name: v.name,
      onTimeRate: (v.onTime / v.total) * 100,
      total: v.total,
    }))
  }, [history.subs])

  const classAvgOnTime = useMemo(() => {
    if (onTimeRows.length === 0) return null
    return onTimeRows.reduce((sum, r) => sum + r.onTimeRate, 0) / onTimeRows.length
  }, [onTimeRows])

  // Class-average on-time rate per assignment, oldest first — the actual
  // trend of whether the class is improving or slipping over time.
  const onTimeTrend = useMemo(() => {
    const byAssignment = [...history.assignments].sort((a, b) => a.created_at.localeCompare(b.created_at))
    return byAssignment
      .map((a) => {
        const relevant = history.subs.filter(
          (s) => s.assignment_id === a.id && ['submitted', 'late', 'reviewed'].includes(s.status)
        )
        if (relevant.length === 0) return null
        const onTime = relevant.filter((s) => s.status !== 'late').length
        return { assignmentId: a.id, title: a.title, date: a.created_at, onTimeRate: (onTime / relevant.length) * 100 }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
  }, [history])

  const review = async (sub: SubmissionRow) => {
    await reviewSubmission(sub.id, feedback[sub.id] ?? '')
    toast.success(`Feedback sent to ${sub.student_name}`)
    await refresh()
  }

  const viewSubmission = (a: AssignmentRow, sub: SubmissionRow) => {
    if (!sub.content) {
      toast.error('No submitted content yet.')
      return
    }
    // Annotation-over-a-locked-base: everything the student submitted is
    // stamped read-only on the way in, feedback marks are new unlocked
    // objects on top, never edits to the original.
    const locked = {
      ...sub.content,
      objects: Object.fromEntries(
        Object.entries(sub.content.objects).map(([oid, o]) => [oid, { ...o, metadata: { ...o.metadata, locked: 1 } }])
      ),
    }
    const pageId = importPageDoc({
      notebookName: 'Reviews',
      notebookEmoji: '🔍',
      sectionName: a.title,
      pageName: `${sub.student_name} — ${a.title}`,
      content: locked,
      activate: true,
    })
    useWorkspaceStore.getState().setActivePage(pageId)
    router.push('/notebook')
    toast.info('Submitted work is locked — draw or write to add feedback on top of it.')
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <BounceLoader size={200} label="Loading assignment…" />
      </div>
    )
  }

  if (!assignment) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-[13px] text-muted-foreground">Assignment not found.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 pb-10 lg:max-w-none lg:space-y-0">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start lg:gap-3">
      <div className="lg:grid lg:auto-rows-min lg:grid-cols-12 lg:gap-3">
        <div className="glass rounded-2xl p-4 lg:col-span-8">
          <p className="text-[16px] font-semibold">{assignment.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> {dueLabel(assignment)} ·{' '}
            {assignment.room_ids.map((r) => roomNames[r] ?? 'Room').join(', ')}
          </p>
          {assignment.instructions && (
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
              {assignment.instructions}
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-4 lg:col-start-9 lg:mt-0 lg:grid-cols-2">
          <StatTile label="Submitted" value={`${stats.submitted}/${stats.total}`} tone="mint" />
          <StatTile label="Late" value={String(stats.late)} tone={stats.late > 0 ? 'rose' : undefined} />
          <StatTile label="Reviewed" value={String(stats.reviewed)} tone="violet" />
          <StatTile
            label="Class on-time rate"
            value={classAvgOnTime === null ? '—' : `${Math.round(classAvgOnTime)}%`}
            tone="amber"
          />
        </div>

        <div className="glass mt-4 rounded-2xl p-4 lg:col-span-6 lg:mt-3">
          <p className="mb-3 text-[12px] font-semibold text-muted-foreground">Status breakdown</p>
          <StatusBreakdownBar subs={subs} total={stats.total} />
        </div>

        <div className="glass mt-4 rounded-2xl p-4 lg:col-span-6 lg:mt-3">
          <p className="mb-3 text-[12px] font-semibold text-muted-foreground">Submission timing vs. due date</p>
          <TimingChart subs={subs} dueAt={assignment.due_at} />
        </div>

        <div className="glass mt-4 rounded-2xl p-4 lg:col-span-5 lg:mt-3">
          <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Class on-time trend</p>
          <p className="mb-3 text-[11px] text-muted-foreground">Average on-time rate, assignment over assignment.</p>
          <OnTimeTrendChart points={onTimeTrend} />
          <div className="mt-4 border-t border-border/50 pt-3">
            <p className="mb-1 text-[12px] font-semibold text-muted-foreground">Per-student on-time rate</p>
            <p className="mb-3 text-[11px] text-muted-foreground">Across every assignment this teacher has given.</p>
            <OnTimeRateChart rows={onTimeRows} />
          </div>
        </div>

        <div className="glass mt-4 rounded-2xl p-4 lg:col-span-7 lg:mt-3">
          <p className="mb-2 text-[12px] font-semibold text-muted-foreground">Students</p>
          {targets.length === 0 && (
            <p className="text-[12px] text-muted-foreground">No students enrolled in the targeted rooms.</p>
          )}
          <div className="space-y-1.5">
            {targets.map((student) => {
              const sub = subs.find((s) => s.student_id === student.id)
              const status = sub?.status ?? 'assigned'
              const reviewable = sub && (status === 'submitted' || status === 'late')
              return (
                <div key={student.id} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/40">
                  <span className="min-w-32 text-[12.5px] font-medium">{student.full_name}</span>
                  <StatusChip status={status} />
                  {sub?.submitted_at && (
                    <span className="text-[10.5px] text-muted-foreground">
                      {new Date(sub.submitted_at).toLocaleString()}
                    </span>
                  )}
                  <div className="flex-1" />
                  {sub?.content && (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => viewSubmission(assignment, sub)}>
                    <Eye className="h-3 w-3" /> View copy
                  </Button>
                )}
                {reviewable && (
                  <>
                    <Input
                      value={feedback[sub.id] ?? ''}
                      onChange={(e) => setFeedback((f) => ({ ...f, [sub.id]: e.target.value }))}
                      placeholder="Feedback…"
                      className="h-6 w-40 text-[11.5px]"
                    />
                    <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => void review(sub)}>
                      Mark reviewed
                    </Button>
                  </>
                )}
                {status === 'reviewed' && sub?.feedback && (
                  <span className="max-w-48 truncate text-[11px] text-muted-foreground">"{sub.feedback}"</span>
                )}
              </div>
            )
          })}
          </div>
        </div>
      </div>

      <div className="glass mt-4 rounded-2xl p-3 lg:mt-0 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Your assignments
        </p>
        <div className="space-y-1">
          {history.assignments.map((a) => {
            const isCurrent = a.id === id
            const count = history.subs.filter(
              (s) => s.assignment_id === a.id && ['submitted', 'late', 'reviewed'].includes(s.status)
            ).length
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => router.push(`/assignments/${a.id}`)}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                  isCurrent ? 'bg-accent' : 'hover:bg-accent/50'
                )}
              >
                <span className={cn('truncate text-[12px]', isCurrent ? 'font-semibold' : 'font-medium text-muted-foreground')}>
                  {a.title}
                </span>
                <span className="text-[10.5px] text-muted-foreground">{count} submitted</span>
              </button>
            )
          })}
        </div>
      </div>
      </div>
    </div>
  )
}

export default function AssignmentDashboardPage() {
  const params = useParams<{ id: string }>()
  return (
    <RequireAuth allow={['teacher', 'admin', 'super_admin']}>
      <PageShell title="Assignment dashboard">
        <AssignmentDashboard id={params.id} />
      </PageShell>
    </RequireAuth>
  )
}
