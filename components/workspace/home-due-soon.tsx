'use client'

// Mobile Home's "what's due" row — students land on notebooks with zero
// signal about outstanding work, even though assignments already track due
// dates and submission status. Pulls the same data assignments-panel.tsx
// uses, filtered to what still needs action, so a student never has to
// switch tabs just to see what's due.

import { useCallback, useEffect, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useAuthStore } from '@/lib/auth/store'
import {
  listMyAssignments,
  mySubmissions,
  subscribeAssignments,
  subscribeSubmissions,
} from '@/lib/data/assignments'
import type { AssignmentRow, SubmissionRow } from '@/lib/data/types'
import { cn } from '@/lib/utils'

const DONE_STATUSES = new Set(['submitted', 'late', 'reviewed'])

function relativeDue(dueAt: string): { label: string; urgent: boolean } {
  const ms = new Date(dueAt).getTime() - Date.now()
  const hours = ms / 36e5
  if (hours < 0) return { label: 'Overdue', urgent: true }
  if (hours < 24) return { label: `Due ${new Date(dueAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`, urgent: true }
  if (hours < 24 * 7) return { label: `Due ${new Date(dueAt).toLocaleDateString([], { weekday: 'short' })}`, urgent: false }
  return { label: `Due ${new Date(dueAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`, urgent: false }
}

export function HomeDueSoon({ onOpen }: { onOpen: () => void }) {
  const role = useAuthStore((s) => s.profile?.role)
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [subs, setSubs] = useState<SubmissionRow[]>([])

  const refresh = useCallback(async () => {
    const [a, s] = await Promise.all([listMyAssignments(), mySubmissions()])
    setAssignments(a)
    setSubs(s)
  }, [])

  useEffect(() => {
    if (role !== 'student') return
    void refresh()
    const unsubs = [subscribeAssignments(() => void refresh()), subscribeSubmissions(() => void refresh())]
    return () => unsubs.forEach((u) => u())
  }, [role, refresh])

  if (role !== 'student') return null

  const outstanding = assignments
    .filter((a) => a.due_at)
    .filter((a) => !DONE_STATUSES.has(subs.find((s) => s.assignment_id === a.id)?.status ?? 'assigned'))
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime())
    .slice(0, 3)

  if (outstanding.length === 0) return null

  return (
    <div className="pb-6">
      <p className="mb-2 px-0.5 text-ui-xs font-bold uppercase tracking-wider text-muted-foreground/70">
        Due soon
      </p>
      <div className="flex flex-col gap-2">
        {outstanding.map((a, i) => {
          const due = relativeDue(a.due_at!)
          return (
            <button
              key={a.id}
              type="button"
              onClick={onOpen}
              style={{ animationDelay: `${i * 50}ms` }}
              className="flex animate-[home-card-in_240ms_var(--ease-strong)_backwards] items-center gap-3 rounded-2xl border border-border/50 bg-card p-3 text-left transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:animate-none"
            >
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                  due.urgent
                    ? 'bg-[color-mix(in_oklch,var(--accent-rose)_16%,transparent)] text-[var(--accent-rose)]'
                    : 'bg-[color-mix(in_oklch,var(--accent-blue)_14%,transparent)] text-[var(--accent-blue)]'
                )}
              >
                <CalendarClock className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui-md font-semibold text-foreground">{a.title}</p>
                <p className="truncate text-ui-sm text-muted-foreground">{a.teacher_name}</p>
              </div>
              <span className={cn('shrink-0 text-ui-sm font-semibold', due.urgent ? 'text-[var(--accent-rose)]' : 'text-muted-foreground')}>
                {due.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
