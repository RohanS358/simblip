'use client'

// A course lesson: written notes with live figures, read top to bottom.
//
// WHY THIS IS NOT A doc/pptx PAGE. A doc is a flowing body of text the user
// authors; a deck is a sequence of slides. A lesson is neither — it is a
// fixed, authored document whose figures are real simulations, and whose
// reader is a student rather than an editor. The content is written offline
// (see .claude/skills/course-author) and lint-gated before it ships, so the
// view is a READER: no tool dock, no inspector, no object selection. That is
// the whole reason it earns its own page kind instead of riding on doc.
//
// A platform admin can edit a published lesson in place — see
// components/workspace/course-editor.tsx — but that is a repair bench bolted
// onto the reader, not an authoring surface, and every other role still gets
// the read-only view described above.
//
// A lesson is DATA. Nothing here is generated at runtime — the local model is
// not trusted with lesson content — so this file is types plus the two small
// pieces of live state a reader needs: which section is in view, and what the
// student has answered.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** A figure: a group of live objects built by a SimScript string.
 *
 *  `script` is SimScript, the same language lib/scene/simscript.ts executes
 *  for the AI and the Code object — so a figure is authored, linted and
 *  debugged with the tools that already exist, and any component added to the
 *  app is available to a lesson the same day. */
export interface CourseFigure {
  id: string
  /** "Figure 2.1 — the pendulum and its three controls". Shown above it. */
  caption: string
  /** SimScript source. Runs into this figure's own scratch page. */
  script: string
  /** One line under the figure: what to look at, or what to try. */
  note?: string
  // Deliberately NO size field. A figure is a column of real objects rendered
  // at the size the script gave them (course-figure.tsx), so it already has an
  // intrinsic height — asking the author to guess a box is what produced the
  // dead grid this replaced.
  /** Held back until the section's question is answered — a prediction is
   *  worthless once the answer is on screen. */
  locked?: boolean
}

/** A multiple-choice check. Wrong answers route to the MISCONCEPTION behind
 *  them, never to a score: each distractor carries its own explanation, and
 *  answering unlocks the figure rather than marking the student down. */
export interface CourseQuestion {
  prompt: string
  choices: { text: string; correct?: boolean }[]
  /** Per-choice response, indexed to `choices`. The correct one gets a
   *  confirmation; the rest get the reason that intuition is appealing and
   *  what to look at instead. */
  responses: { title: string; body: string }[]
}

/** One step of a derivation. `why` comes BEFORE `math` on purpose: a step
 *  that arrives without justification is the moment a reader stops following
 *  a derivation and starts copying it. */
export interface CourseStep {
  /** Short label for the outline, e.g. "Restoring force". */
  toc?: string
  why: string
  /** KaTeX. Optional — a closing step is often prose alone. */
  math?: string
  /** The step that carries the result. Rendered with emphasis. */
  hero?: boolean
}

export interface CourseSection {
  id: string
  /** Outline title. */
  title: string
  /** Outline locator, e.g. "4" or "4.2". */
  locator?: string
  /** Small uppercase label above the heading. */
  eyebrow?: string
  /** Body prose, as a restricted HTML subset (see course-view). */
  body?: string
  /** Figures for THIS section — none, one, or several. Several render side
   *  by side where the window allows it. */
  figures?: CourseFigure[]
  /** A derivation: justified steps, revealed all at once. */
  derivation?: CourseStep[]
  /** A worked numerical: steps revealed ONE AT A TIME, so the reader can
   *  attempt each before seeing it. */
  worked?: CourseStep[]
  /** Prose that belongs after the figures/derivation rather than before. */
  after?: string
  question?: CourseQuestion
}

export interface CourseDoc {
  title: string
  subtitle?: string
  /** "Oscillations · Lesson 4" — course and position, for the header. */
  kicker?: string
  sections: CourseSection[]
}

// ── Reader state ────────────────────────────────────────────────────────────

interface CourseState {
  /** Section id currently under the fold line, for the outline highlight. */
  current: string | null
  setCurrent: (id: string | null) => void
  /** answers[pageId][sectionId] = chosen index. Persisted: a student who
   *  closes the tab mid-lesson should not lose the prediction they committed
   *  to, or they will simply not commit next time. */
  answers: Record<string, Record<string, number>>
  answer: (pageId: string, sectionId: string, choice: number) => void
}

export const useCourse = create<CourseState>()(
  persist(
    (set) => ({
      current: null,
      setCurrent: (id) => set({ current: id }),
      answers: {},
      answer: (pageId, sectionId, choice) =>
        set((s) => ({
          answers: { ...s.answers, [pageId]: { ...s.answers[pageId], [sectionId]: choice } },
        })),
    }),
    { name: 'simblip-course-progress', partialize: (s) => ({ answers: s.answers }) }
  )
)
