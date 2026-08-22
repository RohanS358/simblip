'use client'

// Chart primitives for the assignment dashboard — plain SVG, no chart lib.
// Each derives its numbers straight from SubmissionRow[]; nothing here is
// decorative. Status color order (mint/blue/amber/rose/violet) is the app's
// existing accent set, reordered so adjacent slots pass CVD separation
// (validated via dataviz skill's validate_palette.js) — blue and violet sit
// non-adjacent since they're the palette's closest pair.

import { useId, useState } from 'react'
import type { SubmissionRow, SubmissionStatus } from '@/lib/data/types'
import { cn } from '@/lib/utils'

type Status = SubmissionStatus | 'assigned'

const STATUS_HEX: Record<Status, string> = {
  assigned: 'var(--muted-foreground)',
  opened: 'var(--accent-blue)',
  in_progress: 'var(--accent-amber)',
  submitted: 'var(--accent-mint)',
  late: 'var(--accent-rose)',
  reviewed: 'var(--accent-violet)',
}

const STATUS_LABEL: Record<Status, string> = {
  assigned: 'Not started',
  opened: 'Opened',
  in_progress: 'In progress',
  submitted: 'Submitted',
  late: 'Late',
  reviewed: 'Reviewed',
}

// Part-to-whole order (not the color validation order) — reads as a
// progression from not-started to reviewed, left to right.
const STATUS_ORDER: Status[] = ['assigned', 'opened', 'in_progress', 'submitted', 'late', 'reviewed']

function Tooltip({
  x,
  y,
  visible,
  children,
}: {
  x: number
  y: number
  visible: boolean
  children: React.ReactNode
}) {
  if (!visible) return null
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border/60 bg-popover px-2 py-1 text-ui-2xs shadow-lg"
      style={{ left: x, top: y - 8 }}
    >
      {children}
    </div>
  )
}

/** Part-to-whole: how the class's submissions break down by status right now. */
export function StatusBreakdownBar({ subs, total }: { subs: SubmissionRow[]; total: number }) {
  const counts: Record<Status, number> = {
    assigned: 0,
    opened: 0,
    in_progress: 0,
    submitted: 0,
    late: 0,
    reviewed: 0,
  }
  for (const s of subs) counts[s.status] = (counts[s.status] ?? 0) + 1
  counts.assigned = Math.max(0, total - subs.length)
  const denom = Math.max(1, total)
  const [hover, setHover] = useState<{ status: Status; x: number; y: number } | null>(null)

  const segments = STATUS_ORDER.filter((s) => counts[s] > 0)

  return (
    <div className="relative">
      <div className="flex h-6 w-full overflow-hidden rounded-md" role="img" aria-label="Submission status breakdown">
        {segments.map((status, i) => {
          const pct = (counts[status] / denom) * 100
          return (
            <button
              key={status}
              type="button"
              className="h-full transition-[filter] hover:brightness-110"
              style={{
                width: `${pct}%`,
                background: STATUS_HEX[status],
                marginLeft: i === 0 ? 0 : '2px',
              }}
              onPointerMove={(e) => {
                const r = e.currentTarget.parentElement!.getBoundingClientRect()
                setHover({ status, x: e.clientX - r.left, y: 0 })
              }}
              onPointerLeave={() => setHover(null)}
              onFocus={(e) => {
                const r = e.currentTarget.parentElement!.getBoundingClientRect()
                setHover({ status, x: e.currentTarget.getBoundingClientRect().left - r.left + 4, y: 0 })
              }}
              onBlur={() => setHover(null)}
              aria-label={`${STATUS_LABEL[status]}: ${counts[status]} of ${total}`}
            />
          )
        })}
      </div>
      <Tooltip x={hover?.x ?? 0} y={-4} visible={!!hover}>
        {hover && (
          <>
            <span className="font-semibold">{counts[hover.status]}</span>{' '}
            <span className="text-muted-foreground">{STATUS_LABEL[hover.status]}</span>
          </>
        )}
      </Tooltip>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {STATUS_ORDER.map((status) => (
          <span key={status} className="flex items-center gap-1 text-ui-2xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_HEX[status] }} />
            {STATUS_LABEL[status]} · {counts[status]}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Diverging: each submission's timing relative to the due date, in hours.
 *  Negative (mint) = early/on-time, positive (rose) = late. Sequential by
 *  submit time gives the class's collective work-timing pattern (e.g. a
 *  last-minute cluster right before the deadline). */
export function TimingChart({ subs, dueAt }: { subs: SubmissionRow[]; dueAt: string | null }) {
  const gid = useId()
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const withTimes = subs
    .filter((s) => s.submitted_at)
    .map((s) => ({
      sub: s,
      hoursFromDue: dueAt ? (new Date(s.submitted_at!).getTime() - new Date(dueAt).getTime()) / 3_600_000 : 0,
    }))
    .sort((a, b) => a.hoursFromDue - b.hoursFromDue)

  if (!dueAt) {
    return <p className="text-ui-xs text-muted-foreground">This assignment has no due date — timing isn't tracked.</p>
  }
  if (withTimes.length === 0) {
    return <p className="text-ui-xs text-muted-foreground">No submissions yet.</p>
  }

  const maxAbs = Math.max(1, ...withTimes.map((w) => Math.abs(w.hoursFromDue)))
  const W = 100 // percent-based, scales with container
  const rowH = 22

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${withTimes.length * rowH + 8}`}
        className="w-full"
        style={{ height: withTimes.length * rowH + 8 }}
        preserveAspectRatio="none"
        role="img"
        aria-label="Submission timing relative to due date"
      >
        <line x1={W / 2} y1={0} x2={W / 2} y2={withTimes.length * rowH} stroke="var(--border)" strokeWidth={0.3} />
        {withTimes.map((w, i) => {
          const early = w.hoursFromDue <= 0
          const frac = Math.min(1, Math.abs(w.hoursFromDue) / maxAbs)
          const barLen = frac * (W / 2 - 4)
          const y = i * rowH + rowH / 2
          const x1 = early ? W / 2 - barLen : W / 2
          const x2 = early ? W / 2 : W / 2 + barLen
          return (
            <g
              key={w.sub.id}
              onPointerMove={(e) => {
                const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top })
              }}
              onPointerLeave={() => setHover(null)}
            >
              <rect x={x1} y={y - 3} width={Math.max(0.5, x2 - x1)} height={6} rx={2} fill={early ? 'var(--accent-mint)' : 'var(--accent-rose)'} />
              <circle cx={early ? x1 : x2} cy={y} r={1.4} fill={early ? 'var(--accent-mint)' : 'var(--accent-rose)'} stroke="var(--card)" strokeWidth={0.6} />
            </g>
          )
        })}
      </svg>
      <Tooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={!!hover}>
        {hover && (
          <>
            <span className="font-semibold">{withTimes[hover.i].sub.student_name}</span>{' '}
            <span className="text-muted-foreground">
              {Math.abs(withTimes[hover.i].hoursFromDue) < 1
                ? '<1h'
                : `${Math.round(Math.abs(withTimes[hover.i].hoursFromDue))}h`}{' '}
              {withTimes[hover.i].hoursFromDue <= 0 ? 'before' : 'after'} due
            </span>
          </>
        )}
      </Tooltip>
      <div className="mt-2 flex items-center justify-between text-ui-2xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[var(--accent-mint)]" /> Early / on-time
        </span>
        <span>Due date</span>
        <span className="flex items-center gap-1">
          Late <span className="h-2 w-2 rounded-full bg-[var(--accent-rose)]" />
        </span>
      </div>
      <span className="sr-only" id={gid} />
    </div>
  )
}

/** Sequential, sorted low→high: each student's on-time rate across every
 *  assignment this teacher has given them — the actual "student behavior"
 *  signal, not just this one assignment. */
export function OnTimeRateChart({
  rows,
}: {
  rows: { studentId: string; name: string; onTimeRate: number; total: number }[]
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const sorted = [...rows].filter((r) => r.total > 0).sort((a, b) => a.onTimeRate - b.onTimeRate)
  if (sorted.length === 0) {
    return <p className="text-ui-xs text-muted-foreground">Not enough submission history yet.</p>
  }
  const rowH = 24
  const W = 100

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${sorted.length * rowH}`}
        className="w-full"
        style={{ height: sorted.length * rowH }}
        preserveAspectRatio="none"
        role="img"
        aria-label="Per-student on-time submission rate across all assignments"
      >
        {sorted.map((r, i) => {
          const y = i * rowH + rowH / 2
          const barW = (r.onTimeRate / 100) * (W - 32)
          const low = r.onTimeRate < 50
          return (
            <g
              key={r.studentId}
              onPointerMove={(e) => {
                const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
                setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top })
              }}
              onPointerLeave={() => setHover(null)}
            >
              <rect x={32} y={y - 4} width={W - 32} height={8} rx={2} fill="var(--accent)" opacity={0.5} />
              <rect x={32} y={y - 4} width={Math.max(0.5, barW)} height={8} rx={2} fill={low ? 'var(--accent-rose)' : 'var(--accent-blue)'} />
            </g>
          )
        })}
      </svg>
      {/* Name labels rendered as HTML overlay so text stays crisp (SVG text scales oddly with preserveAspectRatio=none) */}
      <div className="pointer-events-none absolute inset-0">
        {sorted.map((r, i) => (
          <div
            key={r.studentId}
            className="absolute left-0 flex items-center text-ui-3xs font-medium text-muted-foreground"
            style={{ top: `${(i / sorted.length) * 100}%`, height: `${100 / sorted.length}%`, width: '30%' }}
          >
            <span className="truncate">{r.name.split(' ')[0]}</span>
          </div>
        ))}
      </div>
      <Tooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={!!hover}>
        {hover && (
          <>
            <span className="font-semibold">{Math.round(sorted[hover.i].onTimeRate)}%</span>{' '}
            <span className="text-muted-foreground">
              {sorted[hover.i].name} on-time ({sorted[hover.i].total} assignment{sorted[hover.i].total === 1 ? '' : 's'})
            </span>
          </>
        )}
      </Tooltip>
    </div>
  )
}

/** Trend over time: class-average on-time rate per assignment, in
 *  chronological order — is the class getting better or worse at meeting
 *  deadlines, assignment over assignment. */
export function OnTimeTrendChart({
  points,
}: {
  points: { assignmentId: string; title: string; date: string; onTimeRate: number }[]
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  if (points.length < 2) {
    return <p className="text-ui-xs text-muted-foreground">Needs at least two assignments with submissions to show a trend.</p>
  }
  const W = 100
  const H = 56
  const padY = 6
  const step = W / (points.length - 1)
  const coords = points.map((p, i) => ({
    x: i * step,
    y: padY + (1 - p.onTimeRate / 100) * (H - padY * 2),
  }))
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ')
  const areaPath = `${path} L ${coords[coords.length - 1].x} ${H} L ${coords[0].x} ${H} Z`
  const first = points[0].onTimeRate
  const last = points[points.length - 1].onTimeRate
  const trendUp = last >= first

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }} preserveAspectRatio="none" role="img" aria-label="Class on-time rate trend across assignments">
        <path d={areaPath} fill="var(--accent-blue)" opacity={0.1} />
        <path d={path} fill="none" stroke="var(--accent-blue)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) => (
          <g
            key={points[i].assignmentId}
            onPointerMove={(e) => {
              const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect()
              setHover({ i, x: e.clientX - r.left, y: e.clientY - r.top })
            }}
            onPointerLeave={() => setHover(null)}
          >
            <circle cx={c.x} cy={c.y} r={2.6} fill="var(--accent-blue)" stroke="var(--card)" strokeWidth={1} />
            <circle cx={c.x} cy={c.y} r={6} fill="transparent" />
          </g>
        ))}
      </svg>
      <Tooltip x={hover?.x ?? 0} y={hover?.y ?? 0} visible={!!hover}>
        {hover && (
          <>
            <span className="font-semibold">{Math.round(points[hover.i].onTimeRate)}%</span>{' '}
            <span className="text-muted-foreground">{points[hover.i].title}</span>
          </>
        )}
      </Tooltip>
      <p className="mt-1 text-ui-2xs text-muted-foreground">
        {trendUp ? '↗' : '↘'} {Math.round(first)}% → {Math.round(last)}% across {points.length} assignments
      </p>
    </div>
  )
}

export function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'mint' | 'rose' | 'violet' | 'amber' }) {
  const toneColor = tone ? `var(--accent-${tone})` : undefined
  return (
    <div className="glass rounded-xl p-3">
      <p className="text-ui-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-ui-3xl font-semibold')} style={toneColor ? { color: toneColor } : undefined}>
        {value}
      </p>
    </div>
  )
}
