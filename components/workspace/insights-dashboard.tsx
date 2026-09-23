'use client'

// Teacher-scoped assignment insights: overview stats, a class-wide
// completion-rate trend, a per-assignment breakdown table, and per-student
// performance/trend. Pure client-side aggregation over the same two calls
// TeacherAssignments already makes (listMyAssignments +
// listInstitutionSubmissions) —
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
import { listMyAssignments, listInstitutionSubmissions, subscribeAssignments, subscribeSubmissions } from '@/lib/data/assignments'
import { listAllMembers } from '@/lib/data/admin'
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
        <p className="text-ui-2xl font-extrabold leading-none">{value}</p>
        <p className="mt-1 text-ui-2xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="mb-2 text-ui-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{title}</p>
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
    const [as, members, people] = await Promise.all([
      listMyAssignments(),
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
    // One tenant-wide request, grouped locally — not one per assignment on
    // every 4s subscribe() tick (see listInstitutionSubmissions).
    const mine = new Set(as.map((a) => a.id))
    const grouped: Record<string, SubmissionRow[]> = Object.fromEntries(as.map((a) => [a.id, []]))
    for (const s of await listInstitutionSubmissions()) {
      if (mine.has(s.assignment_id)) grouped[s.assignment_id].push(s)
    }
    setSubsByAssignment(grouped)
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
          <div className="flex h-full items-center justify-center text-ui-xs text-muted-foreground">
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
          <p className="text-ui-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
            Per-assignment breakdown
          </p>
        </div>
        {sortedAssignmentStats.length === 0 ? (
          <p className="py-8 text-center text-ui-xs text-muted-foreground">No assignments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-ui-xs">
              <thead>
                <tr className="border-b border-border/50 text-left text-ui-2xs uppercase tracking-wider text-muted-foreground">
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
        <p className="mb-3 text-ui-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Student performance
        </p>
        {studentStats.length === 0 ? (
          <p className="py-8 text-center text-ui-xs text-muted-foreground">No students targeted yet.</p>
        ) : (
          <div className="space-y-1.5">
            {studentStats.map((s) => {
              const TrendIcon = TREND_ICON[s.trend]
              return (
                <div
                  key={s.student.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/40"
                >
                  <span className="min-w-32 flex-1 truncate text-ui-xs font-medium">
                    {s.student.full_name}
                  </span>
                  <span className="text-ui-2xs text-muted-foreground">{s.completionRate}% complete</span>
                  <span className="text-ui-2xs text-muted-foreground">
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
