# Assignment Insights Dashboard

2026-08-10

## Problem

The sidebar's Assignments section (added in the notebook-nav unification
work) shows teachers a click-to-expand per-assignment roster — useful for
managing one assignment, but it eats sidebar space and doesn't answer the
question a teacher actually has: *how are my assignments and students doing
overall?* There's no cross-assignment view — no trends, no per-student
history, no way to see if the class is improving.

## Design

### 1. Sidebar Assignments section

`AssignmentsPanel` as embedded in the desktop `NotebookPanel` sidebar keeps
its flat per-assignment list (title, due date, submitted count) but the
per-assignment expand/collapse roster is removed from that embed
specifically. A low-profile "Insights" button (icon + label, ghost-button
weight — not a primary CTA, doesn't compete with the assignment list for
attention) sits above the list, linking to `/assignments/insights`.

This is scoped to the sidebar embed only. The mobile Assignments tab and
the student-facing view are unchanged — they keep whatever behavior
`AssignmentsPanel` already has today, since only the sidebar's dropdown was
called out as taking too much space.

### 2. Shared `InsightsDashboard` component

One component, `components/workspace/insights-dashboard.tsx`, renders the
whole dashboard. It is mounted from two places:

- **Desktop**: a new route, `app/assignments/insights/page.tsx`, wrapped in
  `RequireAuth allow={['teacher','admin','super_admin']}` and `PageShell`
  (title "Assignment Insights") for chrome consistent with `/admin` and
  `/dev`.
- **Mobile**: the same route, reached via a matching "Insights" entry point
  added next to the header in the mobile Assignments tab
  (`mobile-shell.tsx`'s Assignments view). `PageShell` already renders
  plain full-bleed content with no `tabBar` prop (removed in an earlier
  task), so this works on mobile without a second dashboard implementation
  — one component, two entry points.

Scope: the signed-in teacher's own assignments only, via the same
`listMyAssignments()` call `TeacherAssignments` already uses (filtered to
`teacher_id === profile.id` server-side). No institution-wide or
cross-teacher view.

### 3. Dashboard content

Data source: `listMyAssignments()` + `submissionsFor(assignmentId)` for
each — the same two calls `TeacherAssignments` already makes today. No new
API routes, no schema changes; everything below is computed client-side
from `AssignmentRow[]` + `SubmissionRow[]`.

**Overview stat tiles** (styled like `admin/page.tsx`'s `Stat` component):
total assignments, total submissions received, on-time submission rate
(%), average turnaround from submission to review (for reviewed
submissions only).

**Class-wide trend line**: a Recharts `LineChart` (matching
`admin/page.tsx`'s `ChartCard`/`CHART_COLORS` conventions), x-axis =
assignments in chronological order (by `created_at`), y-axis = completion
rate (%) for that assignment — submitted-or-later statuses ÷ targeted
student count. Shows whether the class trend is improving or declining
assignment-over-assignment.

**Per-assignment breakdown**: a table — title, due date, completion %,
on-time %, average feedback turnaround — one row per assignment, sortable
by clicking a column header (client-side array sort, no server round-trip).

**Per-student performance & trends**: aggregated across all of the
teacher's assignments — one row per student (deduplicated by student id
across all targeted rooms), each showing: completion rate, on-time streak
(consecutive most-recent on-time submissions), and a trend indicator
(comparing the student's completion rate on their most recent half of
assignments vs. their older half — up/down/flat arrow). This directly
answers "student history and trends."

## Non-goals

- No new backend endpoints or schema changes — pure client-side aggregation
  over data already fetched elsewhere in the app.
- No institution-wide or admin cross-teacher rollup — teacher-scoped only,
  matching `listMyAssignments()`'s existing scoping.
- No changes to the assignment creation flow, submission flow, or the
  mobile/student-facing Assignments views beyond adding the Insights entry
  point.
- No date-range filtering or export in this pass — the dashboard covers
  the teacher's full assignment history unfiltered.

## Files touched (expected)

- `components/workspace/insights-dashboard.tsx` (new) — the shared
  dashboard component (stat tiles, trend chart, per-assignment table,
  per-student table), all aggregation logic.
- `app/assignments/insights/page.tsx` (new) — route wrapper
  (`RequireAuth` + `PageShell` + `InsightsDashboard`).
- `components/workspace/notebook-panel.tsx` — Assignments section gets the
  Insights button above the list.
- `components/workspace/assignments-panel.tsx` — `AssignmentsPanel` and
  `TeacherAssignments` gain an optional `compact?: boolean` prop (default
  `false`, so mobile/student behavior is untouched). When `true`,
  `TeacherAssignments` renders each assignment as a plain non-clickable
  summary row (title, due date, submitted count) with no chevron button
  and no expand section, instead of today's click-to-expand roster.
  `NotebookPanel`'s sidebar embed passes `compact`; the mobile Assignments
  view does not.
- `components/workspace/mobile-shell.tsx` — Assignments view header gets a
  matching Insights entry point.
