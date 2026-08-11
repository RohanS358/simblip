'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, ClipboardList, Loader2, NotebookPen, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth/store'
import {
  assignmentPageLinks,
  linkAssignmentPage,
  listMyAssignments,
  mySubmissions,
  removeAssignment,
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
    const nodes = useWorkspaceStore.getState().nodes
    const exists = pageId && pageId in nodes && nodes[pageId].kind === 'page'
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
      toast.success(`"${a.title}" submitted`)
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

function TeacherAssignments({ compact = false }: { compact?: boolean } = {}) {
  const router = useRouter()
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [subsByAssignment, setSubsByAssignment] = useState<Record<string, SubmissionRow[]>>({})

  const refresh = useCallback(async () => {
    const as = await listMyAssignments()
    setAssignments(as)
    const entries = await Promise.all(as.map(async (a) => [a.id, await submissionsFor(a.id)] as const))
    setSubsByAssignment(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    void refresh()
    const unsubs = [subscribeAssignments(() => void refresh()), subscribeSubmissions(() => void refresh())]
    return () => unsubs.forEach((u) => u())
  }, [refresh])

  return (
    <div className="space-y-3 pt-0">
      {assignments.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <ClipboardList className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-[13px] text-muted-foreground">No assignments yet.</p>
        </div>
      )}
      {assignments.map((a) => {
        const subs = subsByAssignment[a.id] ?? []
        const submitted = subs.filter((s) => ['submitted', 'late', 'reviewed'].includes(s.status)).length

        if (compact) {
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => router.push(`/assignments/${a.id}`)}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] transition-colors hover:bg-accent/40"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{submitted} submitted</span>
            </button>
          )
        }

        return (
          <button
            key={a.id}
            type="button"
            className="glass flex w-full items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-accent/30"
            onClick={() => router.push(`/assignments/${a.id}`)}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{a.title}</p>
              <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <CalendarClock className="h-3 w-3" /> {dueLabel(a)}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0 text-[11px]">
              {submitted} submitted
            </Badge>
            <button
              type="button"
              aria-label="Delete assignment"
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-[var(--accent-rose)]"
              onClick={(e) => {
                e.stopPropagation()
                void removeAssignment(a.id).then(refresh)
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </button>
        )
      })}
    </div>
  )
}

export function AssignmentsPanel({ compact = false }: { compact?: boolean } = {}) {
  const role = useAuthStore((s) => s.profile?.role)
  return role === 'student' ? <StudentAssignments /> : <TeacherAssignments compact={compact} />
}
