---
name: course-author
description: "Write a SIMBLIP course lesson — deep, textbook-quality notes with live SimScript figures, block diagrams, derivations, worked numericals and MCQs, emitted as a lint-gated CourseDoc JSON. Use when asked to author, write, draft or extend a lesson, chapter, topic or course for SIMBLIP's Course Mode."
---

# Course author

Write one lesson as a `CourseDoc` JSON file. Depth is the point — a lesson that
takes an hour to write and forty minutes to read is the target, not a summary.

**Never generate lessons at runtime.** Authoring happens here, offline, gated by
the linter. The local model is not trusted with lesson content: a wrong hint is
recoverable, a wrong lesson taught confidently is not.

## The one hard gate

Every figure's `script` MUST pass the SimScript linter before the lesson ships:

```bash
node .claude/skills/course-author/lint-course.mjs <lesson.json>
```

It exits non-zero and names the fix for each broken figure. A lesson that does
not pass is not finished. This costs no model time and no browser — that is
precisely why it is mandatory.

## Process

1. **Read the syllabus scope.** `docs/syllabus-coverage-plan.md` says which
   engines exist. Never author a figure for physics the app cannot simulate.
2. **Check the components.** `simscript-component-reference.md` is the full
   list of `create()` kinds, their params and their anchors. Read it before
   writing any script — inventing a component is the most common failure.
3. **Outline the sections** (see shape below), then write them in full.
4. **Write each figure's SimScript**, then lint. Repair, re-lint.
5. **Write the file** to `content/courses/<course>/<lesson>.json`.
6. **Publish** (below) when the course is ready to reach students.

## Publishing

A course directory holds `course.json` — the catalogue entry — plus one JSON
file per lesson:

```
content/courses/enex-101/
  course.json          id, code, title, subject, semester, lesson paths
  ohms-law.json        a CourseDoc
  kirchhoff.json       a CourseDoc
```

`course.json` carries the syllabus position of each lesson, which is what
builds the tree a student navigates:

```json
{
  "id": "enex-101", "code": "ENEX 101",
  "title": "Basic Electrical Engineering",
  "subject": "electrical", "semester": 2,
  "order": ["ohms-law", "kirchhoff"],
  "lessons": {
    "ohms-law":  { "path": "DC Circuits", "title": "Ohm's Law and Resistance" },
    "kirchhoff": { "path": "DC Circuits", "title": "Kirchhoff's Laws" }
  }
}
```

Then push it to the database:

```bash
node --env-file=.env.local .claude/skills/course-author/publish-course.mjs content/courses/enex-101
```

It writes straight to `DATABASE_URL` — no token, no running server. `--dry-run`
validates and prints the payload without writing.

The publisher **re-lints every lesson first** and refuses to write if any fails;
the whole write is one transaction, so a failure leaves the previous version
intact rather than a half-published course. Publishing REPLACES a course's
lesson set, so a lesson deleted from the directory disappears from the database.

Publishing makes a course exist; it does not make it visible. Grant it to a room
or a profile to do that (`docs/course-mode.md`) — the publisher tells you
whether any grants exist yet.

## Section shape

A lesson is `{ title, kicker, subtitle, sections: [...] }`. Every section has
an `id`, `title`, `locator`, and any of: `eyebrow`, `body`, `figures`,
`derivation`, `worked`, `question`, `after`.

Full type definitions: `lib/store/course.ts`. Worked example:
`references/example-lesson.json`.

## What a good lesson contains

Aim for **8–14 sections**. A lesson with no numerical and no question is a
handout, not a lesson.

| Element | How much | Notes |
|---|---|---|
| Prose | Every section | 2–5 paragraphs. Full sentences, no bullet-dumps. |
| Figures | 4–8 across the lesson | Put them where they are discussed, not all at the top. |
| Derivations | 1–3 | Every step's `why` written BEFORE its `math`. |
| Worked numericals | 2–4 | `worked` reveals one step at a time. Include units. |
| MCQs | 2–4 | Each wrong choice gets its own misconception response. |
| Block diagrams | Where structure matters | See below. |

### Prose

Write as authored notes, not as a chatbot. No "Let's explore!", no "Great
question!", no addressing the reader as a persona. The voice is a textbook
someone took care over. Define every term on first use with
`<em class="term">term</em>`.

Allowed HTML: `<p> <b> <i> <em class="term"> <ul> <ol> <li> <code>`, plus
`<div class="aside">` (margin note) and `<div class="callout">` (do-this-now).

### Figures

Each figure is `{ id, caption, script, note?, locked? }`.

- `caption` — "Figure 4.1 — what it shows". Numbered by section.
- `script` — SimScript. Wrap mechanics/optics components in a `system`; the
  linter enforces it, because `system` is what Play scopes a run to.
- `note` — one line: what to look at, or what to try.
- `locked: true` — held back until the section's `question` is answered. Use it
  for any figure that would give away a prediction.

**You do not set a figure's size.** A figure is not a canvas — it is a column
of real objects rendered at the size the script gave them, so it is exactly as
tall as its contents. Set sensible `width`/`height` on the objects themselves
and the figure follows. Figures in the same section render **side by side**
where the window allows, so 2–3 small related figures beat one crowded one.

Objects are grouped automatically: shapes and symbols that mean something by
their relative positions (a bob on a rod, a circuit) are drawn together as one
scaled drawing; self-contained widgets (`table`, `chart`, `slider`, `formula`)
each get their own row. A `system` boundary is not drawn — it scopes the solver,
not the picture.

### Controls must be wired to something

A `slider`, `button` or `trigger` needs **`targetObjectId`** as well as
`targetParamName`, and the target must live in the **same figure**:

```javascript
var bob   = create("mass", { x: 200, y: 220, mass: 1 });
var sMass = create("slider", { min: 0.2, max: 5, step: 0.1, value: 1,
                               label: "Bob mass (kg)",
                               targetObjectId: bob, targetParamName: "mass" });
```

Without `targetObjectId` the control silently falls back to a page variable
nothing reads: it renders, it drags, and it drives nothing. The linter now
rejects this, but know why — a control in a *different* figure from its target
can never be wired, because each figure is its own scene.

`targetParamName` must be a param the target actually has: the geometry
properties every object has (`x`, `y`, `width`, `height`, `rotation`) or one its
behaviors declare (a `mass` offers `mass`, `friction`, `vx`, `vy`, `omega`…).
There is no `length` or `angle` param on a body — drive `y` for length, and
discuss amplitude in prose. The linter checks this too.

### Derivations

Each step is `{ toc?, why, math?, hero? }`. The `why` is a full justification in
prose — a step that arrives without its reason is where a reader stops
following and starts copying. Mark the step carrying the result `hero: true`.

State every approximation explicitly, at the step where it is made.

### Worked numericals

`worked` steps reveal one at a time, so the reader attempts each first. Carry
units through every line, keep four significant figures until the final answer,
and make the last step check the result against a figure the reader already ran.

### MCQs

`question` is `{ prompt, choices, responses }`. `responses` is indexed to
`choices` — every choice, right and wrong, gets its own reply.

**Wrong answers route to the misconception, never to a score.** Each distractor
must be a real thing students believe, and its response explains why that
intuition is appealing before correcting it. Never "Incorrect". Never a streak,
a mark, or a percentage.

### Block diagrams

For structure, flow, or classification — where a simulation would say nothing —
build the diagram from real canvas objects, not an image:

```javascript
var a = create("rect", { x: 0,   y: 0, width: 150, height: 60, radius: 12,
                         fill: "#e0e7ff", stroke: "#6366f1", strokeWidth: 2 });
var t = create("text", { x: 20, y: 20, text: "**Input**" });
var b = create("rect", { x: 220, y: 0, width: 150, height: 60, radius: 12 });
connect(a.centre, b.centre, "wire");
```

`text` content is markdown, so `# Heading` and `**bold**` render. Use the
palette from `docs/design-system.md` rather than arbitrary colours.

## Rules

- **No filler.** No "TODO", no lorem, no placeholder captions, no invented
  citations or fabricated experimental data.
- **Every number must be right.** Compute it; do not estimate. If a figure
  reads 2.84 s, the worked example must also give 2.84 s.
- **Never invent a component.** Check the reference. If the engine cannot do
  it, write the section without a figure.
- **Approximations get named.** Small-angle, ideal-diode, lossless — say so at
  the step where it enters.
- Prefer more sections over longer sections. A reader navigates by outline.
