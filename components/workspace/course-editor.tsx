'use client'

// Lesson editing, for the platform admin only.
//
// Course Mode was built read-only on purpose (lib/store/course.ts): lessons are
// authored offline, lint-gated, and never generated at runtime. That still
// holds for WRITING a lesson — the authoring skill runs the real SimScript
// linter over every figure, which nothing in the browser does. What it could
// not do was fix a typo, reword a paragraph or correct a figure's script
// without a full re-publish from a checkout.
//
// So this is a repair bench, not an authoring tool:
//
//   * super_admin only, the same bar as publishing. An edit changes what every
//     student holding a grant sees, so it is a platform action.
//   * It edits the REAL CourseDoc field by field — prose, figure scripts,
//     derivation and worked steps, and the question with its per-choice
//     responses — because a raw JSON box is hostile to write prose in and one
//     stray comma corrupts a live lesson.
//   * Saving writes the page first, so the reader behind it re-renders with
//     real figures immediately, and only then PUTs the lesson. What you see is
//     what the student gets.
//
// Deliberately NOT here: creating or deleting a lesson, or reordering sections.
// Those change a course's shape, which is the publish pipeline's job.

import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@/lib/auth/store'
import { getAccessToken } from '@/lib/auth/store'
import { readCourse, writeCourse } from '@/lib/store/course-content'
import type { CourseDoc, CourseFigure, CourseSection, CourseStep } from '@/lib/store/course'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'

/** A lesson page is opened as `course:<lessonId>` (courses-panel.tsx), so the
 *  id the save route needs is already in the page id — no extra plumbing. */
export function lessonIdOf(pageId: string): string | null {
  return pageId.startsWith('course:') ? pageId.slice('course:'.length) : null
}

/** May this profile edit published lessons? Editing is publishing. */
export function useCanEditCourse(pageId: string): boolean {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  return role === 'super_admin' && !!lessonIdOf(pageId)
}

// ── Field primitives ────────────────────────────────────────────────────────
// Plain textareas that grow with their content. A rich editor here would have
// to round-trip the authored HTML subset (course-view's Prose) and would
// quietly rewrite markup the lint gate accepted.

function Field({
  label, value, onChange, rows = 2, mono, placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
  mono?: boolean
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-ui-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-ui-sm',
          'focus:outline-none focus:ring-2 focus:ring-[var(--accent-violet)]/40',
          mono && 'font-mono text-ui-xs leading-relaxed'
        )}
      />
    </label>
  )
}

/** Derivation and worked steps share a shape, so they share an editor. */
function StepList({
  label, steps, onChange,
}: {
  label: string
  steps: CourseStep[]
  onChange: (next: CourseStep[] | undefined) => void
}) {
  const patch = (i: number, p: Partial<CourseStep>) =>
    onChange(steps.map((s, k) => (k === i ? { ...s, ...p } : s)))

  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-ui-2xs"
            onClick={() => onChange([...steps, { why: '' }])}
          >
            <Plus className="h-3 w-3" /> Step
          </Button>
          <Button
            variant="ghost" size="sm" className="h-6 px-1.5 text-ui-2xs text-destructive"
            onClick={() => onChange(undefined)}
          >
            Remove all
          </Button>
        </div>
      </div>
      <div className="space-y-2.5">
        {steps.map((s, i) => (
          <div key={i} className="rounded border border-border/60 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-ui-2xs text-muted-foreground">Step {i + 1}</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-ui-2xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!s.hero}
                    onChange={(e) => patch(i, { hero: e.target.checked || undefined })}
                  />
                  result
                </label>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onChange(steps.filter((_, k) => k !== i))}
                  aria-label={`Delete step ${i + 1}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Field label="Outline label" value={s.toc ?? ''} rows={1}
                onChange={(v) => patch(i, { toc: v || undefined })} />
              {/* `why` before `math`, the order the schema insists on: a step
                  without its justification is where a reader starts copying. */}
              <Field label="Why" value={s.why} rows={2} onChange={(v) => patch(i, { why: v })} />
              <Field label="Math (KaTeX)" value={s.math ?? ''} rows={1} mono
                onChange={(v) => patch(i, { math: v || undefined })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FigureList({
  figures, onChange,
}: {
  figures: CourseFigure[]
  onChange: (next: CourseFigure[] | undefined) => void
}) {
  const patch = (i: number, p: Partial<CourseFigure>) =>
    onChange(figures.map((f, k) => (k === i ? { ...f, ...p } : f)))

  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Figures
        </span>
        <Button
          variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-ui-2xs"
          onClick={() =>
            onChange([...figures, { id: `fig-${Date.now().toString(36)}`, caption: '', script: '' }])
          }
        >
          <Plus className="h-3 w-3" /> Figure
        </Button>
      </div>
      <div className="space-y-2.5">
        {figures.map((f, i) => (
          <div key={f.id} className="rounded border border-border/60 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-ui-2xs text-muted-foreground">{f.id}</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-ui-2xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!f.locked}
                    onChange={(e) => patch(i, { locked: e.target.checked || undefined })}
                  />
                  locked
                </label>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onChange(figures.filter((_, k) => k !== i))}
                  aria-label={`Delete ${f.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Field label="Caption" value={f.caption} rows={1}
                onChange={(v) => patch(i, { caption: v })} />
              {/* The figure IS this script — the same SimScript the AI and the
                  Code object run, so every component in the app is available
                  to a lesson. Saving re-runs it in the reader behind this
                  panel, which is the only real check the browser can make. */}
              <Field label="SimScript" value={f.script} rows={8} mono
                onChange={(v) => patch(i, { script: v })} />
              <Field label="Note under the figure" value={f.note ?? ''} rows={1}
                onChange={(v) => patch(i, { note: v || undefined })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuestionEditor({
  section, onChange,
}: {
  section: CourseSection
  onChange: (q: CourseSection['question']) => void
}) {
  const q = section.question
  if (!q) {
    return (
      <Button
        variant="outline" size="sm" className="w-full gap-1 text-ui-2xs"
        onClick={() =>
          onChange({
            prompt: '',
            choices: [{ text: '', correct: true }, { text: '' }],
            responses: [{ title: '', body: '' }, { title: '', body: '' }],
          })
        }
      >
        <Plus className="h-3 w-3" /> Add a check
      </Button>
    )
  }

  // choices and responses are index-matched by the schema, so they are always
  // added and removed together — a response without its choice renders blank.
  const setChoice = (i: number, text: string) =>
    onChange({ ...q, choices: q.choices.map((c, k) => (k === i ? { ...c, text } : c)) })
  const setCorrect = (i: number) =>
    onChange({ ...q, choices: q.choices.map((c, k) => ({ ...c, correct: k === i || undefined })) })
  const setResponse = (i: number, p: Partial<{ title: string; body: string }>) =>
    onChange({ ...q, responses: q.responses.map((r, k) => (k === i ? { ...r, ...p } : r)) })

  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-ui-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Check
        </span>
        <Button
          variant="ghost" size="sm" className="h-6 px-1.5 text-ui-2xs text-destructive"
          onClick={() => onChange(undefined)}
        >
          Remove
        </Button>
      </div>
      <Field label="Prompt" value={q.prompt} rows={2}
        onChange={(v) => onChange({ ...q, prompt: v })} />
      <div className="mt-2 space-y-2">
        {q.choices.map((c, i) => (
          <div key={i} className="rounded border border-border/60 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-ui-2xs text-muted-foreground">
                <input
                  type="radio"
                  name={`correct-${section.id}`}
                  checked={!!c.correct}
                  onChange={() => setCorrect(i)}
                />
                correct
              </label>
              {q.choices.length > 2 && (
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    onChange({
                      ...q,
                      choices: q.choices.filter((_, k) => k !== i),
                      responses: q.responses.filter((_, k) => k !== i),
                    })
                  }
                  aria-label={`Delete choice ${i + 1}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <Field label={`Choice ${i + 1}`} value={c.text} rows={1}
              onChange={(v) => setChoice(i, v)} />
            {/* Every choice carries its own response: a wrong answer routes to
                the misconception behind it, never to a score. */}
            <div className="mt-1.5 space-y-1.5 border-l-2 border-border pl-2">
              <Field label="Response title" value={q.responses[i]?.title ?? ''} rows={1}
                onChange={(v) => setResponse(i, { title: v })} />
              <Field label="Response body" value={q.responses[i]?.body ?? ''} rows={2}
                onChange={(v) => setResponse(i, { body: v })} />
            </div>
          </div>
        ))}
      </div>
      <Button
        variant="ghost" size="sm" className="mt-2 h-6 gap-1 px-1.5 text-ui-2xs"
        onClick={() =>
          onChange({
            ...q,
            choices: [...q.choices, { text: '' }],
            responses: [...q.responses, { title: '', body: '' }],
          })
        }
      >
        <Plus className="h-3 w-3" /> Choice
      </Button>
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export function CourseEditor({
  pageId, onClose, onDraft,
}: {
  pageId: string
  onClose: () => void
  /** Called on every keystroke with the working doc, so the reader behind the
   *  panel shows the edit live — including re-running a changed figure. */
  onDraft: (doc: CourseDoc) => void
}) {
  const lessonId = lessonIdOf(pageId)
  const [doc, setDoc] = useState<CourseDoc | null>(() => readCourse(pageId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Re-read when the page changes under the panel (a different lesson opened).
  useEffect(() => { setDoc(readCourse(pageId)); setError(null); setSaved(false) }, [pageId])

  const update = useCallback((next: CourseDoc) => {
    setDoc(next)
    setSaved(false)
    onDraft(next)
  }, [onDraft])

  const patchSection = useCallback((i: number, p: Partial<CourseSection>) => {
    if (!doc) return
    update({ ...doc, sections: doc.sections.map((s, k) => (k === i ? { ...s, ...p } : s)) })
  }, [doc, update])

  const save = useCallback(async () => {
    if (!doc || !lessonId) return
    setSaving(true)
    setError(null)
    try {
      const token = getAccessToken()
      const res = await fetch('/api/courses/lesson', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lessonId, doc, title: doc.title }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      // The page already holds the draft (onDraft wrote it); make it the
      // committed state too, so closing the panel keeps what was saved.
      writeCourse(pageId, doc)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }, [doc, lessonId, pageId])

  if (!doc) {
    return (
      <aside className="flex h-full w-[26rem] shrink-0 items-center justify-center border-l border-border bg-card p-6">
        <p className="text-center text-ui-sm text-muted-foreground">
          This page has no lesson to edit.
        </p>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-[26rem] shrink-0 flex-col border-l border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="m-0 text-ui-sm font-semibold">Edit lesson</p>
          <p className="m-0 truncate font-mono text-ui-2xs text-muted-foreground">{lessonId}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" className="h-7 gap-1.5 px-2 text-ui-2xs" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" />
              : saved ? <Check className="h-3 w-3" /> : null}
            {saving ? 'Saving' : saved ? 'Saved' : 'Publish'}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close editor">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {error && (
        <p className="m-0 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-2xs text-destructive">
          {error}
        </p>
      )}
      <p className="m-0 border-b border-border bg-muted/40 px-3 py-1.5 text-ui-2xs text-muted-foreground">
        Publishing updates the live lesson for everyone it is granted to.
      </p>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <div className="space-y-1.5">
          <Field label="Kicker" value={doc.kicker ?? ''} rows={1}
            onChange={(v) => update({ ...doc, kicker: v || undefined })} />
          <Field label="Title" value={doc.title} rows={1}
            onChange={(v) => update({ ...doc, title: v })} />
          <Field label="Subtitle" value={doc.subtitle ?? ''} rows={2}
            onChange={(v) => update({ ...doc, subtitle: v || undefined })} />
        </div>

        {doc.sections.map((s, i) => (
          <details key={s.id} className="rounded-md border border-border" open={i === 0}>
            <summary className="cursor-pointer select-none px-2.5 py-2 text-ui-sm font-medium">
              {s.locator ? `${s.locator}. ` : ''}{s.title || <span className="text-muted-foreground">Untitled</span>}
            </summary>
            <div className="space-y-2.5 border-t border-border p-2.5">
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Locator" value={s.locator ?? ''} rows={1}
                  onChange={(v) => patchSection(i, { locator: v || undefined })} />
                <Field label="Eyebrow" value={s.eyebrow ?? ''} rows={1}
                  onChange={(v) => patchSection(i, { eyebrow: v || undefined })} />
              </div>
              <Field label="Title" value={s.title} rows={1}
                onChange={(v) => patchSection(i, { title: v })} />
              {/* The authored HTML subset, edited as source. A WYSIWYG box here
                  would rewrite markup the offline lint gate already approved. */}
              <Field label="Body (HTML)" value={s.body ?? ''} rows={6} mono
                placeholder="<p>…</p>"
                onChange={(v) => patchSection(i, { body: v || undefined })} />

              <FigureList
                figures={s.figures ?? []}
                onChange={(figures) => patchSection(i, { figures: figures?.length ? figures : undefined })}
              />

              {s.derivation
                ? <StepList label="Derivation" steps={s.derivation}
                    onChange={(d) => patchSection(i, { derivation: d?.length ? d : undefined })} />
                : <Button variant="outline" size="sm" className="w-full gap-1 text-ui-2xs"
                    onClick={() => patchSection(i, { derivation: [{ why: '' }] })}>
                    <Plus className="h-3 w-3" /> Add a derivation
                  </Button>}

              {s.worked
                ? <StepList label="Worked example" steps={s.worked}
                    onChange={(w) => patchSection(i, { worked: w?.length ? w : undefined })} />
                : <Button variant="outline" size="sm" className="w-full gap-1 text-ui-2xs"
                    onClick={() => patchSection(i, { worked: [{ why: '' }] })}>
                    <Plus className="h-3 w-3" /> Add a worked example
                  </Button>}

              <QuestionEditor section={s} onChange={(q) => patchSection(i, { question: q })} />

              <Field label="After (HTML)" value={s.after ?? ''} rows={4} mono
                onChange={(v) => patchSection(i, { after: v || undefined })} />
            </div>
          </details>
        ))}
      </div>
    </aside>
  )
}

/** The button that opens the editor. Rendered only for a super_admin on a
 *  lesson page — everyone else sees the reader exactly as before. */
export function EditLessonButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="absolute right-4 top-4 z-40 gap-1.5 shadow-sm"
      onClick={onClick}
    >
      <Pencil className="h-3.5 w-3.5" />
      Edit
    </Button>
  )
}
