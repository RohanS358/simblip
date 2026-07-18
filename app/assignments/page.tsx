'use client'

// Assignments. Students see work targeted at them (via room enrollment or
// directly), pull a working copy into their notebook, and submit from here.
// Teachers get a live dashboard: per assignment, every targeted student and
// where they are in assigned → opened → in progress → submitted → late →
// reviewed, with feedback.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Eye,
  Loader2,
  NotebookPen,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { useAuthStore } from '@/lib/auth/store'
import {
  assignmentPageLinks,
  linkAssignmentPage,
  listMyAssignments,
  mySubmissions,
  removeAssignment,
  reviewSubmission,
  submissionsFor,
  subscribeAssignments,
  subscribeSubmissions,
  upsertSubmission,
} from '@/lib/data/assignments'
import { listRooms, listAllMembers } from '@/lib/data/admin'
import * as db from '@/lib/data/db'
import type { AssignmentRow, ProfileRow, SubmissionRow, SubmissionStatus } from '@/lib/data/types'
import { importPageDoc } from '@/lib/store/import-page'
import { bundlePage } from '@/lib/store/page-bundle'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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

// ── Student view ────────────────────────────────────────────────────────────

function StudentAssignments() {
  const router = useRouter()
  const profile = useAuthStore((s) => s.profile)!
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [subs, setSubs] = useState<SubmissionRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [a, s] = await Promise.all([listMyAssignments(), mySubmissions()])
    setAssignments(a)
    setSubs(s)
  }, [])

  useEffect(() => {
    void refresh()
    const unsubs = [subscribeAssignments(() => void refresh()), subscribeSubmissions(() => void refresh())]
    return () => unsubs.forEach((u) => u())
  }, [refresh])

  const subFor = (id: string) => subs.find((s) => s.assignment_id === id)
  const links = assignmentPageLinks(profile.id)

  const openInNotebook = async (a: AssignmentRow) => {
    let pageId = links[a.id]
    const exists =
      pageId &&
      useWorkspaceStore
        .getState()
        .notebooks.some((nb) => nb.sections.some((sec) => sec.pages.some((p) => p.id === pageId)))
    if (!exists) {
      pageId = importPageDoc({
        notebookName: 'Assignments',
        notebookEmoji: '📝',
        sectionName: a.teacher_name,
        pageName: a.title,
        content: a.content,
        activate: true,
      })
      linkAssignmentPage(profile.id, a.id, pageId)
      await upsertSubmission(a, { status: 'opened' })
    }
    useWorkspaceStore.getState().setActivePage(pageId!)
    router.push('/notebook')
  }

  const submit = async (a: AssignmentRow) => {
    const pageId = assignmentPageLinks(profile.id)[a.id]
    // Submit the full bundle — a doc/PDF assignment's work lives in its
    // sheets and ink layers, not just the main content page.
    const content = pageId && useDocStore.getState().pages[pageId] ? bundlePage(pageId) : null
    if (!content) {
      toast.error('Open the assignment in your notebook first.')
      return
    }
    setBusyId(a.id)
    try {
      await upsertSubmission(a, { status: 'submitted', content })
      toast.success(`“${a.title}” submitted`)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3 pt-6">
      {assignments.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <ClipboardList className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-[13px] text-muted-foreground">No assignments yet. Enjoy it while it lasts.</p>
        </div>
      )}
      {assignments.map((a) => {
        const sub = subFor(a.id)
        const status = sub?.status ?? 'assigned'
        const done = status === 'submitted' || status === 'late' || status === 'reviewed'
        return (
          <div key={a.id} className="glass rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[14px] font-semibold">
                  {a.title} <StatusChip status={status} />
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <CalendarClock className="h-3 w-3" /> {dueLabel(a)} · {a.teacher_name}
                </p>
                {a.instructions && (
                  <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                    {a.instructions}
                  </p>
                )}
                {sub?.feedback && (
                  <p className="mt-2 rounded-lg bg-accent/60 p-2 text-[12.5px] leading-relaxed">
                    <span className="font-semibold">Feedback:</span> {sub.feedback}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => void openInNotebook(a)}>
                  <NotebookPen className="h-3.5 w-3.5" /> {links[a.id] ? 'Open' : 'Start work'}
                </Button>
                {status !== 'reviewed' && (
                  <Button
                    size="sm"
                    className="h-7 text-[12px]"
                    disabled={busyId === a.id}
                    onClick={() => void submit(a)}
                  >
                    {busyId === a.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" /> {done ? 'Resubmit' : 'Submit'}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Teacher dashboard ───────────────────────────────────────────────────────

function TeacherAssignments() {
  const router = useRouter()
  const profile = useAuthStore((s) => s.profile)!
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [subsByAssignment, setSubsByAssignment] = useState<Record<string, SubmissionRow[]>>({})
  const [roster, setRoster] = useState<Record<string, ProfileRow[]>>({}) // room -> students
  const [roomNames, setRoomNames] = useState<Record<string, string>>({})
  const [openId, setOpenId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    const [as, rooms, members, people] = await Promise.all([
      listMyAssignments(),
      listRooms(),
      listAllMembers(),
      db.list<ProfileRow>('profiles', { institution_id: profile.institution_id }),
    ])
    setAssignments(as)
    setRoomNames(Object.fromEntries(rooms.map((r) => [r.id, r.name])))
    const byRoom: Record<string, ProfileRow[]> = {}
    for (const m of members) {
      if (m.member_role !== 'student') continue
      const p = people.find((x) => x.id === m.profile_id)
      if (p) (byRoom[m.room_id] ??= []).push(p)
    }
    setRoster(byRoom)
    const entries = await Promise.all(as.map(async (a) => [a.id, await submissionsFor(a.id)] as const))
    setSubsByAssignment(Object.fromEntries(entries))
  }, [profile.institution_id])

  useEffect(() => {
    void refresh()
    const unsubs = [subscribeAssignments(() => void refresh()), subscribeSubmissions(() => void refresh())]
    return () => unsubs.forEach((u) => u())
  }, [refresh])

  const targetsOf = useCallback(
    (a: AssignmentRow): ProfileRow[] => {
      const seen = new Map<string, ProfileRow>()
      for (const roomId of a.room_ids) for (const p of roster[roomId] ?? []) seen.set(p.id, p)
      return [...seen.values()].sort((x, y) => x.full_name.localeCompare(y.full_name))
    },
    [roster]
  )

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
    const pageId = importPageDoc({
      notebookName: 'Reviews',
      notebookEmoji: '🔍',
      sectionName: a.title,
      pageName: `${sub.student_name} — ${a.title}`,
      content: sub.content,
      activate: true,
    })
    useWorkspaceStore.getState().setActivePage(pageId)
    router.push('/notebook')
  }

  return (
    <div className="space-y-3 pt-6">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Create assignments from any notebook page — right-click it and choose{' '}
        <span className="font-medium text-foreground">Assign…</span>
      </p>
      {assignments.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <ClipboardList className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-[13px] text-muted-foreground">No assignments yet.</p>
        </div>
      )}
      {assignments.map((a) => {
        const subs = subsByAssignment[a.id] ?? []
        const targets = targetsOf(a)
        const submitted = subs.filter((s) => ['submitted', 'late', 'reviewed'].includes(s.status)).length
        const expanded = openId === a.id
        return (
          <div key={a.id} className="glass rounded-2xl p-4">
            <button
              type="button"
              className="flex w-full items-center gap-3 text-left"
              onClick={() => setOpenId(expanded ? null : a.id)}
            >
              <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{a.title}</p>
                <p className="text-[11.5px] text-muted-foreground">
                  {a.room_ids.map((r) => roomNames[r] ?? 'Room').join(', ')} · {dueLabel(a)}
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0 text-[11px]">
                {submitted}/{targets.length} submitted
              </Badge>
              <button
                type="button"
                aria-label="Delete assignment"
                className="rounded p-1 text-muted-foreground hover:text-[var(--accent-rose)]"
                onClick={(e) => {
                  e.stopPropagation()
                  void removeAssignment(a.id).then(refresh)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </button>

            {expanded && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
                {targets.length === 0 && (
                  <p className="text-[12px] text-muted-foreground">No students enrolled in the targeted rooms.</p>
                )}
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => viewSubmission(a, sub)}
                        >
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
                        <span className="max-w-48 truncate text-[11px] text-muted-foreground">“{sub.feedback}”</span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

function AssignmentsContent() {
  const role = useAuthStore((s) => s.profile?.role)
  return (
    <PageShell title="Assignments">
      {role === 'student' ? <StudentAssignments /> : <TeacherAssignments />}
    </PageShell>
  )
}

export default function AssignmentsPage() {
  return (
    <RequireAuth allow={['admin', 'teacher', 'student', 'super_admin']}>
      <AssignmentsContent />
    </RequireAuth>
  )
}
