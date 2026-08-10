# Assignment Insights Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a teacher-scoped analytics dashboard (overview stats, class-wide trend, per-assignment breakdown, per-student performance) reachable from a compact "Insights" button in the sidebar's Assignments section and from the mobile Assignments tab, replacing the sidebar's per-assignment expand/roster with a flat compact list.

**Architecture:** One shared component, `InsightsDashboard`, does all the aggregation and rendering (stat tiles + Recharts `LineChart` + two tables), mounted from a single new route `/assignments/insights` behind `RequireAuth` + `PageShell` — that route serves both desktop (a normal `PageShell` page) and mobile (reached by pushing to that route from the Assignments tab; `PageShell` already renders full-bleed with no tab bar dependency after an earlier task removed `tabBar`). `AssignmentsPanel`/`TeacherAssignments` gain an optional `compact` prop so the sidebar embed can suppress the existing click-to-expand roster without forking the component.

**Tech Stack:** Next.js App Router, React, Recharts (already installed, already used in `app/admin/page.tsx` and `components/objects/chart.tsx` — no new dependency), Tailwind, lucide-react.

## Global Constraints

- No new npm dependencies — Recharts is already installed.
- No test framework in this repo — verification is `npx tsc --noEmit` (no `npm run typecheck` script exists) plus manual review. No working eslint install.
- All aggregation is client-side over `listMyAssignments()` + `submissionsFor(assignmentId)` — no new API routes, no schema changes.
- Scope is the signed-in teacher's own assignments only (`listMyAssignments()`'s existing server-side filter to `teacher_id === profile.id` — already how `TeacherAssignments` works).
- `compact` prop on `AssignmentsPanel`/`TeacherAssignments` defaults to `false` — mobile and student-facing behavior must be pixel-identical to before this plan unless explicitly touched.
- Visual conventions must match `app/admin/page.tsx`'s existing `Stat`/`ChartCard`/`CHART_COLORS` pattern (glass rounded-2xl cards, same Recharts prop conventions) rather than inventing a new visual language.

---

### Task 1: Insights aggregation helpers

**Files:**
- Create: `lib/data/insights.ts`

**Interfaces:**
- Consumes: `AssignmentRow`, `SubmissionRow`, `ProfileRow`, `RoomMemberRow` from `@/lib/data/types`; nothing else (pure functions over already-fetched data, no I/O).
- Produces:
  - `export interface AssignmentStats { assignment: AssignmentRow; completionRate: number; onTimeRate: number; avgTurnaroundHours: number | null; submittedCount: number; targetCount: number }`
  - `export function computeAssignmentStats(assignment: AssignmentRow, submissions: SubmissionRow[], targets: ProfileRow[]): AssignmentStats`
  - `export interface StudentStats { student: ProfileRow; completionRate: number; onTimeStreak: number; trend: 'up' | 'down' | 'flat' }`
  - `export function computeStudentStats(students: ProfileRow[], assignments: AssignmentRow[], subsByAssignment: Record<string, SubmissionRow[]>, targetsByAssignment: Record<string, ProfileRow[]>): StudentStats[]`
  - `export interface OverviewStats { totalAssignments: number; totalSubmissions: number; onTimeRate: number; avgTurnaroundHours: number | null }`
  - `export function computeOverviewStats(assignmentStats: AssignmentStats[]): OverviewStats`
  - `export interface TrendPoint { assignmentId: string; label: string; completionRate: number }`
  - `export function computeTrend(assignmentStats: AssignmentStats[]): TrendPoint[]` — sorted by `assignment.created_at` ascending.

- [ ] **Step 1: Write the file**

```typescript
// Client-side aggregation for the teacher assignment insights dashboard —
// pure functions over data already fetched by listMyAssignments() /
// submissionsFor(), no new I/O. See
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual self-check (no test framework in this repo)**

Since this file is pure aggregation logic with no I/O, sanity-check it with a throwaway Node script run via `npx tsx` if available, or by temporarily adding a `console.log` call in a page that already imports the module and observing output in the browser console. Confirm: `computeAssignmentStats` with 0 targets returns `completionRate: 0` (not `NaN`/`Infinity`), and `computeStudentStats` with a student who has 1 assignment returns `trend: 'flat'`. Remove any temporary debug code before committing.

- [ ] **Step 4: Commit**

```bash
git add lib/data/insights.ts
git commit -m "Add client-side aggregation helpers for assignment insights"
```

---

### Task 2: `InsightsDashboard` component

**Files:**
- Create: `components/workspace/insights-dashboard.tsx`

**Interfaces:**
- Consumes: `computeAssignmentStats`, `computeOverviewStats`, `computeTrend`, `computeStudentStats` and their types (Task 1, `@/lib/data/insights`); `listMyAssignments`, `submissionsFor`, `subscribeAssignments`, `subscribeSubmissions` (`@/lib/data/assignments`); `listRooms`, `listAllMembers` (`@/lib/data/admin`); `db.list` (`@/lib/data/db`); `useAuthStore` (`@/lib/auth/store`); `AssignmentRow`, `ProfileRow`, `RoomMemberRow`, `SubmissionRow` (`@/lib/data/types`); Recharts (`Line`, `LineChart`, `ResponsiveContainer`, `Tooltip as RechartsTooltip`, `XAxis`, `YAxis`, `CartesianGrid`).
- Produces: `export function InsightsDashboard(): JSX.Element` — no props, self-contained data fetching (mirrors how `TeacherAssignments` already fetches its own data), renders standalone (no page chrome of its own — the route wrapper in Task 3 supplies `PageShell`).

- [ ] **Step 1: Write the component**

```tsx
'use client'

// Teacher-scoped assignment insights: overview stats, a class-wide
// completion-rate trend, a per-assignment breakdown table, and per-student
// performance/trend. Pure client-side aggregation over the same two calls
// TeacherAssignments already makes (listMyAssignments + submissionsFor) —
// see lib/data/insights.ts and
// docs/superpowers/specs/2026-08-10-assignment-insights-dashboard-design.md.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, CheckCircle2, Clock, ListChecks, Users } from 'lucide-react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { useAuthStore } from '@/lib/auth/store'
import { listMyAssignments, submissionsFor, subscribeAssignments, subscribeSubmissions } from '@/lib/data/assignments'
import { listRooms, listAllMembers } from '@/lib/data/admin'
import * as db from '@/lib/data/db'
import type { AssignmentRow, ProfileRow, RoomMemberRow, SubmissionRow } from '@/lib/data/types'
import {
  computeAssignmentStats,
  computeOverviewStats,
  computeStudentStats,
  computeTrend,
  type AssignmentStats,
  type StudentStats,
} from '@/lib/data/insights'
import { cn } from '@/lib/utils'

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="glass flex items-center gap-3 rounded-2xl p-4">
      <Icon className="h-5 w-5 text-[var(--accent-blue)]" />
      <div>
        <p className="text-[20px] font-extrabold leading-none">{value}</p>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
      <div className="h-56">{children}</div>
    </div>
  )
}

const TREND_ICON = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const
const TREND_COLOR = {
  up: 'text-[var(--accent-mint)]',
  down: 'text-[var(--accent-rose)]',
  flat: 'text-muted-foreground',
} as const

type AssignmentSortKey = 'completionRate' | 'onTimeRate' | 'avgTurnaroundHours'

export function InsightsDashboard() {
  const profile = useAuthStore((s) => s.profile)!
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [subsByAssignment, setSubsByAssignment] = useState<Record<string, SubmissionRow[]>>({})
  const [roster, setRoster] = useState<Record<string, ProfileRow[]>>({}) // room -> students
  const [sortKey, setSortKey] = useState<AssignmentSortKey>('completionRate')

  const refresh = useCallback(async () => {
    const [as, rooms, members, people] = await Promise.all([
      listMyAssignments(),
      listRooms(),
      listAllMembers(),
      db.list<ProfileRow>('profiles', { institution_id: profile.institution_id }),
    ])
    setAssignments(as)
    const byRoom: Record<string, ProfileRow[]> = {}
    for (const m of members as RoomMemberRow[]) {
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

  const targetsByAssignment = useMemo(() => {
    const out: Record<string, ProfileRow[]> = {}
    for (const a of assignments) {
      const seen = new Map<string, ProfileRow>()
      for (const roomId of a.room_ids) for (const p of roster[roomId] ?? []) seen.set(p.id, p)
      out[a.id] = [...seen.values()]
    }
    return out
  }, [assignments, roster])

  const assignmentStats: AssignmentStats[] = useMemo(
    () =>
      assignments.map((a) =>
        computeAssignmentStats(a, subsByAssignment[a.id] ?? [], targetsByAssignment[a.id] ?? [])
      ),
    [assignments, subsByAssignment, targetsByAssignment]
  )

  const overview = useMemo(() => computeOverviewStats(assignmentStats), [assignmentStats])
  const trend = useMemo(() => computeTrend(assignmentStats), [assignmentStats])

  const allStudents = useMemo(() => {
    const seen = new Map<string, ProfileRow>()
    for (const list of Object.values(targetsByAssignment)) for (const p of list) seen.set(p.id, p)
    return [...seen.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
  }, [targetsByAssignment])

  const studentStats: StudentStats[] = useMemo(
    () => computeStudentStats(allStudents, assignments, subsByAssignment, targetsByAssignment),
    [allStudents, assignments, subsByAssignment, targetsByAssignment]
  )

  const sortedAssignmentStats = useMemo(() => {
    return [...assignmentStats].sort((a, b) => {
      const av = a[sortKey] ?? -1
      const bv = b[sortKey] ?? -1
      return bv - av
    })
  }, [assignmentStats, sortKey])

  const fmtHours = (h: number | null) => (h === null ? '—' : h < 1 ? '<1h' : `${Math.round(h)}h`)

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={ListChecks} label="Assignments" value={String(overview.totalAssignments)} />
        <Stat icon={CheckCircle2} label="Submissions received" value={String(overview.totalSubmissions)} />
        <Stat icon={Clock} label="On-time rate" value={`${overview.onTimeRate}%`} />
        <Stat icon={Users} label="Avg review turnaround" value={fmtHours(overview.avgTurnaroundHours)} />
      </div>

      <ChartCard title="Completion rate over time">
        {trend.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12.5px] text-muted-foreground">
            No assignments yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.25} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <RechartsTooltip
                cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.2 }}
                contentStyle={{ fontSize: 12, borderRadius: 12 }}
                formatter={(v: number) => [`${v}%`, 'Completion']}
              />
              <Line
                type="monotone"
                dataKey="completionRate"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="glass rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            Per-assignment breakdown
          </p>
        </div>
        {sortedAssignmentStats.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-muted-foreground">No assignments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3 font-semibold">Title</th>
                  <th className="pb-2 pr-3 font-semibold">Due</th>
                  {(
                    [
                      ['completionRate', 'Completion'],
                      ['onTimeRate', 'On-time'],
                      ['avgTurnaroundHours', 'Turnaround'],
                    ] as const
                  ).map(([key, label]) => (
                    <th key={key} className="pb-2 pr-3 font-semibold">
                      <button
                        type="button"
                        className={cn('hover:text-foreground', sortKey === key && 'text-foreground')}
                        onClick={() => setSortKey(key)}
                      >
                        {label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedAssignmentStats.map((s) => (
                  <tr key={s.assignment.id} className="border-b border-border/30 last:border-b-0">
                    <td className="max-w-48 truncate py-2 pr-3 font-medium">{s.assignment.title}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {s.assignment.due_at ? new Date(s.assignment.due_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-2 pr-3">
                      {s.completionRate}% ({s.submittedCount}/{s.targetCount})
                    </td>
                    <td className="py-2 pr-3">{s.onTimeRate}%</td>
                    <td className="py-2 pr-3">{fmtHours(s.avgTurnaroundHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="glass rounded-2xl p-4">
        <p className="mb-3 text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Student performance
        </p>
        {studentStats.length === 0 ? (
          <p className="py-8 text-center text-[12.5px] text-muted-foreground">No students targeted yet.</p>
        ) : (
          <div className="space-y-1.5">
            {studentStats.map((s) => {
              const TrendIcon = TREND_ICON[s.trend]
              return (
                <div
                  key={s.student.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/40"
                >
                  <span className="min-w-32 flex-1 truncate text-[12.5px] font-medium">
                    {s.student.full_name}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">{s.completionRate}% complete</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {s.onTimeStreak > 0 ? `${s.onTimeStreak} on-time streak` : 'no streak'}
                  </span>
                  <TrendIcon className={cn('h-3.5 w-3.5', TREND_COLOR[s.trend])} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/insights-dashboard.tsx
git commit -m "Add InsightsDashboard: teacher-scoped assignment analytics"
```

---

### Task 3: Route wrapper — `/assignments/insights`

**Files:**
- Create: `app/assignments/insights/page.tsx`

**Interfaces:**
- Consumes: `RequireAuth` (`@/components/auth/require-auth`), `PageShell` (`@/components/platform/page-shell`), `InsightsDashboard` (Task 2, `@/components/workspace/insights-dashboard`).
- Produces: default export page component at route `/assignments/insights`.

- [ ] **Step 1: Write the route**

```tsx
'use client'

import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { InsightsDashboard } from '@/components/workspace/insights-dashboard'

export default function AssignmentInsightsPage() {
  return (
    <RequireAuth allow={['teacher', 'admin', 'super_admin']}>
      <PageShell title="Assignment Insights" backHref="/notebook">
        <InsightsDashboard />
      </PageShell>
    </RequireAuth>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/assignments/insights/page.tsx
git commit -m "Add /assignments/insights route"
```

---

### Task 4: `compact` prop on `AssignmentsPanel`/`TeacherAssignments`

**Files:**
- Modify: `components/workspace/assignments-panel.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AssignmentsPanel` signature becomes `export function AssignmentsPanel({ compact = false }: { compact?: boolean } = {})`; `TeacherAssignments` signature becomes `function TeacherAssignments({ compact = false }: { compact?: boolean } = {})`. `StudentAssignments` is untouched (the design only asked about the teacher view's expand behavior).

- [ ] **Step 1: Thread the prop from `AssignmentsPanel` to `TeacherAssignments`**

Find the current `AssignmentsPanel` function (added in the earlier notebook-nav-unification plan) — it currently reads:

```tsx
export function AssignmentsPanel() {
  const role = useAuthStore((s) => s.profile?.role)
  return role === 'student' ? <StudentAssignments /> : <TeacherAssignments />
}
```

Change to:

```tsx
export function AssignmentsPanel({ compact = false }: { compact?: boolean } = {}) {
  const role = useAuthStore((s) => s.profile?.role)
  return role === 'student' ? <StudentAssignments /> : <TeacherAssignments compact={compact} />
}
```

- [ ] **Step 2: Add the `compact` branch to `TeacherAssignments`**

Change the function signature from `function TeacherAssignments() {` to `function TeacherAssignments({ compact = false }: { compact?: boolean } = {}) {`.

In the `assignments.map((a) => { ... })` body, the existing row currently renders a clickable `<button>` with a `ChevronRight` toggle plus a collapsible roster section below it (the exact JSX is in the file as of the notebook-nav-unification plan, roughly: a `<button onClick={() => setOpenId(...)}>` wrapping title/badge/delete, followed by a `<div className="grid transition-[grid-template-rows]...">` containing the per-student roster).

Wrap the existing per-assignment `<div key={a.id} className="glass rounded-2xl p-4">...</div>` block in a conditional: when `compact` is true, render a plain non-clickable summary row instead of the expandable card. Add this branch at the top of the `.map()` callback, before the existing `return (...)`:

```tsx
      {assignments.map((a) => {
        const subs = subsByAssignment[a.id] ?? []
        const targets = targetsOf(a)
        const submitted = subs.filter((s) => ['submitted', 'late', 'reviewed'].includes(s.status)).length

        if (compact) {
          return (
            <div
              key={a.id}
              className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-[12.5px]"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {submitted}/{targets.length}
              </span>
            </div>
          )
        }

        const expanded = openId === a.id
        return (
          // ...existing expandable card JSX, unchanged...
        )
      })}
```

The existing `expanded`/`return (...)` block after this stays exactly as it is today — only add the `if (compact) { return (...) }` early-return before it, and remove the now-duplicate `const expanded = openId === a.id` line that already exists right before the existing `return` (keep one copy, after the `if (compact)` block, exactly as shown above).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual check**

Confirm by reading the diff that `compact` defaults to `false` everywhere it isn't explicitly passed — grep for `<AssignmentsPanel` across the codebase and confirm every existing call site (mobile Assignments tab, if it calls `<AssignmentsPanel />` with no props) is unaffected.

Run: `grep -rn "<AssignmentsPanel" components app`

- [ ] **Step 5: Commit**

```bash
git add components/workspace/assignments-panel.tsx
git commit -m "Add compact prop to AssignmentsPanel/TeacherAssignments"
```

---

### Task 5: Wire the Insights button into the sidebar, and an entry point on mobile

**Files:**
- Modify: `components/workspace/notebook-panel.tsx`
- Modify: `components/workspace/mobile-shell.tsx`

**Interfaces:**
- Consumes: `AssignmentsPanel` with `compact` prop (Task 4); `Link` from `next/link`; a `BarChart3` (or similar) icon from `lucide-react` for the Insights button.
- Produces: no new exports — wiring only.

- [ ] **Step 1: Add the Insights button and `compact` to the sidebar's Assignments section**

In `components/workspace/notebook-panel.tsx`, the Assignments `<Section>` currently renders:

```tsx
      <Section id="assignments" label="Assignments" icon={ClipboardList} open={!collapsed.assignments} onToggle={toggle}>
        <div className="px-1"><AssignmentsPanel /></div>
      </Section>
```

Change to:

```tsx
      <Section id="assignments" label="Assignments" icon={ClipboardList} open={!collapsed.assignments} onToggle={toggle}>
        <div className="px-1">
          <Link
            href="/assignments/insights"
            className="mb-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <BarChart3 className="h-3.5 w-3.5" /> Insights
          </Link>
          <AssignmentsPanel compact />
        </div>
      </Section>
```

Add the two new imports at the top of the file: `import Link from 'next/link'` and add `BarChart3` to the existing `lucide-react` import line (`import { ChevronDown, ClipboardList, Share2 } from 'lucide-react'` becomes `import { BarChart3, ChevronDown, ClipboardList, Share2 } from 'lucide-react'`).

- [ ] **Step 2: Add a matching Insights entry point to the mobile Assignments tab**

In `components/workspace/mobile-shell.tsx`, the Assignments view's header currently reads:

```tsx
        <header
          className="relative flex shrink-0 items-center px-4 pt-[max(0px,env(safe-area-inset-top))]"
          style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}
        >
          <span className="text-[0.9375rem] font-extrabold tracking-tight">Assignments</span>
        </header>
```

(Exact current classes may include the gradient-wash sibling `<div>` added in an earlier pass — match by content, not line number.) Add a staff-only Insights button to the right side of this header, mirroring how other mobile-shell headers place a trailing action:

```tsx
        <header
          className="relative flex shrink-0 items-center px-4 pt-[max(0px,env(safe-area-inset-top))]"
          style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}
        >
          <span className="text-[0.9375rem] font-extrabold tracking-tight">Assignments</span>
          <div className="flex-1" />
          {staff && (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => router.push('/assignments/insights')}
            >
              <BarChart3 className="h-3.5 w-3.5" /> Insights
            </button>
          )}
        </header>
```

Add `BarChart3` to `mobile-shell.tsx`'s existing `lucide-react` import list. This button uses `router.push` (a real navigation, since Insights is a genuine separate route, not an in-shell `View`) — confirm `mobile-shell.tsx` still has a `router` in scope reachable at this point; if an earlier pass removed the unused `useRouter()` call, re-add `const router = useRouter()` near the top of `MobileShell()` and re-add the `useRouter` import, since this task reintroduces a real navigation need.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual browser check**

Run: `npm run dev`. Desktop: open the sidebar's Assignments section, confirm the "Insights" link appears above a flat (non-expanding) assignment list, and clicking it navigates to `/assignments/insights` showing stat tiles, the trend chart, and both tables. Mobile (DevTools device toolbar): open the Assignments tab as a teacher account, confirm the "Insights" button appears in the header and navigates to the same dashboard; confirm it does NOT appear for a student account (`staff` gate).

- [ ] **Step 5: Commit**

```bash
git add components/workspace/notebook-panel.tsx components/workspace/mobile-shell.tsx
git commit -m "Wire Insights entry points into sidebar and mobile Assignments tab"
```

---

## Self-Review

**Spec coverage:**
- §1 (sidebar Assignments section: compact list + Insights button) → Tasks 4, 5 Step 1.
- §2 (shared `InsightsDashboard`, two entry points) → Tasks 2, 3, 5 Step 2.
- §3 (overview stats, class trend, per-assignment table, per-student table) → Tasks 1, 2.
- Non-goals (no new backend, teacher-scoped only, no cross-teacher rollup, no date filtering) → respected throughout: Task 1's functions take already-scoped data as input, Task 2 fetches via the existing teacher-scoped `listMyAssignments()`.

**Placeholder scan:** No TBD/TODO; every step has literal code, not descriptions.

**Type consistency:** `AssignmentStats`, `StudentStats`, `OverviewStats`, `TrendPoint` (Task 1) are consumed with identical shapes in Task 2's `InsightsDashboard` (`computeAssignmentStats(...)` return type flows directly into `assignmentStats: AssignmentStats[]`, etc.) — no re-declaration. `compact` prop (Task 4) is defined once on both `AssignmentsPanel` and `TeacherAssignments` and consumed identically at both call sites added in Task 5 (`compact` explicit in the sidebar, omitted — defaulting `false` — on mobile).
