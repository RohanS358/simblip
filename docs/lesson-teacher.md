# The lesson teacher

A lesson is taught by a drawn teacher, on a board that never loses what has been taught.

## Sections, not scenes (`lib/lesson/sections.ts`, `camera.ts`, `stage.ts`)

A scene that opens a new idea (`clear: true`) no longer wipes the board. It opens a **section**
below everything already there: a heading (`2 · Series`), then the scene. The camera slides
down to it (`frameObjects`, ease in-out, longer trips take longer). Older sections stay put and
at rest — one simulation runs at a time. The **section strip** above the controls has a chip
per section; tapping one slides the camera back to it. Seeking rebuilds every earlier section
instantly (`catchUp`), so jumping forward never loses what the student would have seen.

## The frame loop (`lib/frame/loop.ts`)

One clock, fixed timestep, painters `(frame) => void` that write straight to the DOM/canvas.
Deterministic (frame N is at N/fps), and headless: pass `clock: null` and call `render(seconds)`
with no window. The teacher is its first painter; scene authors can add their own.

## The teacher (`components/workspace/teacher.tsx`, `lib/teacher/`)

A layered SVG rig. Per frame the painter eases ~15 numbers (right hand, brows, smile, head tilt,
mouth, blink, gaze) towards what the lesson is doing and writes them to attributes — React renders
the figure once. Arms are two-bone IK (`rig.ts`) so she can point at the exact thing she is
explaining. The mouth follows the letter the voice has reached (`visemeOf`, driven by the caption's
`spoken` count). Mood and pose are set by the stage: curious when she asks, delight / concern after
a right / wrong answer, a wave at the start.

## Listening (`lib/lesson/tutor*.ts`, `components/workspace/lesson-tutor-ui.tsx`)

* **Ask** — circle (or tap) anything on the board, or select it first. The film stops where it is
  (sections stay), a ring marks the thing, she explains *that*, then offers *Got it / Simpler / More /
  Ask something else*. "Got it" replays the interrupted line without rebuilding anything.
* **Type a question** — same flow, with the student's words in the prompt.
* **Check-ins** — before a new chapter (every ≥10 beats) and straight after two wrong answers she asks
  *Clear / A bit tough / Too easy / Say it again*. `adapt()` changes depth and speed (tough: simpler,
  −0.2×, then re-explains; easy: deeper, +0.2×).
* **No model needed** — `fallbackExplain` says what a thing is and what it is set to; only the
  wording is better with the AI server or the on-device model.

Pure logic (pickObjects, fallbackExplain, adapt, shouldCheckIn, prompts) is in `tutor-core.ts` and tested.
E2E: `node scripts/e2e-teacher.mjs` against a dev server.

## Not done yet
* The teacher is one fixed character; her look is a vector approximation of the reference art.
* Authors cannot yet add their own painters from a lesson file (the loop supports it).
* Section strip does not yet mark which section is on screen while the student scrolls by hand.
