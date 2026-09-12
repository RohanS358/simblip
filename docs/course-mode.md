# Course Mode

Prebuilt, interactive lessons a student reads end to end. Written notes with
live components — real simulations, sliders, tables, charts — sitting in the
prose rather than beside it.

The point is to remove the teacher's prep burden, not the teacher: a class runs
with nothing prepared, and the teacher presides rather than performs.

---

## What exists today

| Piece | Where |
|---|---|
| Page kind | `'course'` in `lib/scene/types.ts`, routed at `components/workspace/page-view.tsx` |
| Lesson types | `lib/store/course.ts` — `CourseDoc → CourseSection → CourseFigure` |
| Storage | `lib/store/course-content.ts` — one JSON blob in the page's `flow` field, so shares/assignments/sync carry it with no transport changes |
| Reader | `components/workspace/course-view.tsx` |
| Live components | `components/workspace/course-figure.tsx` — each figure with anything to step carries its own Simulate/Pause/Reset |
| Sidebar section | `components/workspace/courses-panel.tsx` (rail icon: Courses) |
| Outline | publishes to the shared `lib/store/toc.ts` — the same Contents panel PDFs use |
| Ask-about-this | `lib/store/ai-reference.ts` — selection → assistant as a `ChatAttachment` |
| Authoring skill | `.claude/skills/course-author/` |
| Lint gate | `.claude/skills/course-author/lint-course.mjs` |

| Catalogue + grants | `db/migrations/001-course-mode.sql` — `simblip_courses`, `simblip_course_lessons`, `simblip_course_grants` |
| Read API | `app/api/courses/route.ts` — granted courses as a syllabus tree |
| Grant API | `app/api/courses/grants/route.ts` — admin grant/revoke |
| Publisher | `.claude/skills/course-author/publish-course.mjs` — lints, then writes to Postgres |

Lesson content lives ONLY in Postgres. The browser persists just which MCQ
option a student picked (`partialize` in `lib/store/course.ts`), keyed per
question so a section can ask several.

**Not built yet:** the admin console UI for granting. The API is there, so it
is a form over three endpoints.

---

## Diagrams

Boxes and arrows are written, not placed: `diagram("…")` in any figure script
(`lib/scene/diagram.ts`, grammar in `simscript-component-reference.md`). It
parses a small PlantUML-ish language, ranks the graph, orders it by barycentre
and routes the edges orthogonally, emitting real scene objects — labelled
shapes and anchored connectors — so a diagram can be dragged apart on a canvas
like anything else.

It is pure, which is what lets the lint gate parse the same source offline and
reject a broken diagram before it ships.

## Running a figure

A lesson is not a canvas, so the app's single transport pill has nothing to
point at — every figure is its own scratch page. Each figure therefore carries
its OWN Simulate / Pause / Reset, and the reader runs figures one at a time
(there is one world; starting a figure resets whichever was running). Figures
with nothing to step — a table, a chart, a block diagram — show no buttons.

Figure objects are registered with the physics runtime exactly as the canvas
registers its own (`registerElement`), because a run writes its results
straight to the DOM: body transforms, meter readouts, current flow along the
wires. Without that registration a figure renders, plays, and shows nothing.

---

## Authoring a lesson

Lessons are written **offline and lint-gated**. Nothing is generated at runtime:
a wrong hint is recoverable, a wrong lesson taught confidently is not.

```
/course-author write a lesson on <topic> for <course>
```

The skill reads `docs/syllabus-coverage-plan.md` (what the engines actually
support) and `simscript-component-reference.md` (every `create()` kind) before
writing, then emits `content/courses/<course>/<lesson>.json`.

**The gate is mandatory:**

```bash
node .claude/skills/course-author/lint-course.mjs content/courses/**/*.json
```

It runs headless in plain Node — no model, no browser — and checks that every
figure's SimScript executes, that controls are wired to real targets, that each
MCQ has exactly one correct answer and a per-choice response, that no response
scolds, that no filler text survived, and that the lesson has the depth a lesson
needs. Exit 1 lists a repair for each failure. **A lesson that does not pass is
not finished.**

It also **runs the circuits**. A figure may declare what its instruments must
read — `"expect": { "am": "27.3 mA" }`, keyed by the object `name` in the
script — and the gate executes that figure through the shipping solver
(`lib/circuit/engine.ts`) and fails the lesson if a meter disagrees. This is
what stops notes asserting a number the student's own figure will never show;
before it existed, the first lesson claimed a 9 V reading beside a voltmeter
that was wired to nothing.

### Division of labour

- **Opus, offline** — the hard reusable parts: a topic's pedagogical shape, the
  SimScript patterns, worked numericals, the misconception list. Written once
  per topic-family, not once per lesson.
- **Local model, offline** — fills those templates across the long tail. Its
  output is never trusted; it goes through the same gate, and failures come
  back for a rewrite.
- **Local model, runtime** — bounded low-stakes text only (rephrasing a hint).
  Never lesson content.

---

## Allocation — the design

Three tiers, each with a different job.

### 1. Dev — authors and publishes

Lessons are written in this repo and published as a **course**: an ordered tree
of lessons with syllabus metadata (code, semester, subject). Publishing writes
directly to Postgres:

```bash
node --env-file=.env.local .claude/skills/course-author/publish-course.mjs content/courses/<course>
```

There is no publish secret. Whoever runs this from a checkout already has the
repo and `DATABASE_URL`, so a shared token would add a hoop and one more thing
to leak. `/api/courses/publish` still exists for a future admin console and
requires a super_admin session.

A course is a catalogue entry plus its lessons; a lesson is a `CourseDoc`.

```
course   { id, code: 'ENEX 101', title, subject, semester, version }
  └── unit/topic (nestable, mirrors the syllabus)
        └── lesson  { id, title, order, doc: CourseDoc }
```

### 1b. Platform operator — decides which institutions may use a course

`/dev` → **Courses** is the tier between publishing and granting, and the one
place a course can be moved from the repository into the product without a
shell:

- every course in the build, whether it has reached the database, and whether
  the build has newer lessons than the published version;
- **Publish** / **Republish**, per course or all at once — the same write
  `publish-course.mjs` performs, through `/api/courses/publish` with
  `{ fromRepo: <id> | true }`;
- the institutions each course is **allowed on**, with **Everyone** for a core
  subject that should reach a whole institution without its admin granting it
  room by room.

An allowance (`simblip_course_allowances`) is a licence. Without one, a course
is published but unusable: its institution's admins cannot grant it and nobody
can open it. Withdrawing one stops access immediately — grants made under it
are kept, stop resolving, and work again if the course is re-allowed, because
deleting an admin's work to express "not licensed this term" would be a
surprising amount of damage for a toggle.

Before this tier existed, publishing a course made it grantable by EVERY
institution, and getting one into the database at all needed a checkout, a
`DATABASE_URL` and a CLI — which is why an authored course appeared nowhere in
the running product.

### 2. Admin console — grants access

`/admin` decides **which institution, room or profile gets which course**.
Nothing else changes: an admin never edits lesson content.

This mirrors `simblip_shares`, which already targets either a room or a
profile — the same shape, so the RLS and membership logic are understood:

```sql
create table simblip_course_grants (
  id             uuid primary key default gen_random_uuid(),
  course_id      text not null,
  institution_id uuid not null references simblip_institutions (id) on delete cascade,
  -- Exactly one target, like simblip_shares: a whole room, or one profile.
  target_room_id    uuid references simblip_rooms (id) on delete cascade,
  target_profile_id uuid references simblip_profiles (id) on delete cascade,
  granted_by     uuid not null references simblip_profiles (id),
  granted_at     timestamptz not null default now(),
  check (target_room_id is not null or target_profile_id is not null)
);
```

Grant by room for a class, by profile for an individual. Revoking removes the
grant, not the student's progress — `useCourse.answers` is keyed by page id and
survives.

The catalogue an admin can grant from is filtered to what the platform allowed
on their institution, so "published" and "available to everyone" are no longer
the same thing.

### One database, one decision

`NEXT_PUBLIC_CLOUD` decides whether the BROWSER talks to Postgres or to its own
localStorage database (`lib/data/db.ts`), and it used to be a switch separate
from `DATABASE_URL`. Setting only the latter — the obvious thing to do — left
the halves disagreeing: the server authenticated real sessions while the
browser signed in against its own storage and sent tokens no server would
accept, so every server-backed panel answered 401 and rendered empty. That is
what made Course Mode and the admin console look broken on a database-backed
deployment. `next.config.mjs` now derives the client switch from
`DATABASE_URL`; set `NEXT_PUBLIC_CLOUD` explicitly only to override it.

### 3. Teachers and students — read

The Courses panel lists what this profile has been granted, grouped by
**semester**, then opened as a **tree following the syllabus**:

```
Second Semester
  ENEX 101 — Basic Electrical Engineering
    1. DC Circuits
         1.1 Ohm's law and resistance
         1.2 Kirchhoff's laws            ✓ read
    2. Electrostatics
         2.1 Coulomb's law               ← in progress
Third Semester
  ENEE 154 — Electronic Devices          🔒 unlocks Sem 3
```

Teachers and students see the same tree. A teacher additionally gets the
presentation affordances that already exist (room boards, Present mode); the
lesson content is identical, which is the point — the teacher is not preparing
it.

### Why not the library table

`simblip_library_assets` is for teacher-published reusable assets with an
`approved` flag. A course is different: published by dev, versioned, ordered,
and granted rather than browsed. Overloading it would conflate "an asset a
teacher shared" with "a curriculum a student is enrolled in".

---

## What is left

The admin **console UI** for granting — a form over `/api/courses/grants`
(GET lists grants and the catalogue, POST grants, DELETE revokes). Until it
exists, grant with a direct insert or a curl against that endpoint.

Progress (`lib/store/course.ts`) is per-page and persisted locally, so it needs
no schema change until a teacher has to see it.
