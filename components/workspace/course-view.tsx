'use client'

// The course reader: written notes, read top to bottom, with live figures
// sitting where they are discussed.
//
// THREE DECISIONS WORTH KNOWING:
//
// 1. It SCROLLS. An earlier pass paged the lesson one screen at a time, which
//    is wrong for reference material — a reader re-checking step 2 of a
//    derivation should scroll up, not click back through four screens. One
//    continuous document also means a chapter is one page, so the outline can
//    address any part of it.
//
// 2. Figures WRAP side by side when the window allows. A laptop showing one
//    figure per row wastes half its width and pushes the next paragraph below
//    the fold. Flex wrap, not grid: a grid forces equal columns and stretches a
//    narrow component to match a wide one. No JS measuring either way.
//
// 3. Components sit IN the prose — no card, no border, no fixed box. A live
//    table or slider is part of the text the way a displayed equation is, and
//    it keeps every control and label it has on a canvas. See
//    components/workspace/course-figure.tsx.
//
// Each figure owns a scratch page in the doc store and runs its SimScript
// into it, so a lesson uses the same components, the same physics and the
// same renderers as a board the user built by hand. Those pages are torn down
// on unmount — a lesson leaves nothing behind in the notebook tree.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { useTocStore } from '@/lib/store/toc'
import {
  useCourse,
  questionKey,
  type CourseDoc,
  type CourseFigure,
  type CourseProblem,
  type CourseQuestion,
  type CourseSection,
} from '@/lib/store/course'
import { askAboutSelection } from '@/lib/store/ai-reference'
import { readCourse } from '@/lib/store/course-content'
import { renderMath } from '@/lib/text/katex-lazy'
import { useKatexReady } from '@/lib/text/use-katex-ready'
import { CourseFigureBlock, forgetBuiltFigures } from './course-figure'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MessageSquareQuote } from 'lucide-react'

function TeX({ expr, display = true }: { expr: string; display?: boolean }) {
  useKatexReady() // re-render once the chunk lands; falls back to source meanwhile
  const html = renderMath(expr, display)
  return html ? (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className="font-mono text-ui-sm opacity-70">{expr}</span>
  )
}

/** The multiple-choice check. A wrong answer is never scored — it routes to
 *  the misconception behind that specific choice and unlocks the figure.
 *
 *  `storeKey` rather than the section id: a section may hold several
 *  questions, and each needs its own slot in the persisted answers. */
function Question({
  q,
  storeKey,
  pageId,
}: {
  q: CourseQuestion
  storeKey: string
  pageId: string
}) {
  const picked = useCourse((s) => s.answers[pageId]?.[storeKey])
  const answer = useCourse((s) => s.answer)
  const answered = picked !== undefined

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="m-0 text-ui-lg font-semibold leading-snug">{q.prompt}</p>
      <div className="mt-3.5 flex flex-col gap-2">
        {q.choices.map((c, i) => {
          const isPick = picked === i
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => answer(pageId, storeKey, i)}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-ui-md leading-snug transition-colors',
                answered && c.correct
                  ? 'border-[var(--accent-mint)] bg-[var(--accent-mint)]/10'
                  : isPick
                    ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/8'
                    : 'border-border bg-background',
                !answered && 'hover:border-[var(--accent-blue)]'
              )}
            >
              <span
                className={cn(
                  'grid h-5 w-5 shrink-0 place-items-center rounded-md text-ui-3xs font-bold',
                  answered && c.correct
                    ? 'bg-[var(--accent-mint)] text-white'
                    : isPick
                      ? 'bg-[var(--accent-blue)] text-white'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {String.fromCharCode(65 + i)}
              </span>
              <span>{c.text}</span>
            </button>
          )
        })}
      </div>
      {answered && q.responses[picked] && (
        <div
          className={cn(
            'mt-3.5 rounded-xl border p-4 text-ui-md leading-relaxed',
            q.choices[picked].correct
              ? 'border-[var(--accent-mint)]/30 bg-[var(--accent-mint)]/10'
              : 'border-[var(--accent-amber)]/30 bg-[var(--accent-amber)]/10'
          )}
        >
          <b className="mb-1 block">{q.responses[picked].title}</b>
          <span dangerouslySetInnerHTML={{ __html: q.responses[picked].body }} />
        </div>
      )}
      {answered && q.verify && (
        // The answer, demonstrated rather than asserted. It appears only after
        // the reader has committed — running the circuit first would hand them
        // the answer and leave nothing to check.
        <div className="mt-3.5 border-t border-border pt-1">
          <CourseFigureBlock fig={q.verify} pageId={pageId} locked={false} />
        </div>
      )}
    </div>
  )
}

/** A numerical problem: the task, then the answer on request, then — where the
 *  answer is something an instrument can read — the circuit that produces it.
 *
 *  Revealing is a button rather than an accordion because the reader is meant
 *  to attempt it first, and a disclosure triangle invites a peek. */
function Problem({ problem, pageId, index }: { problem: CourseProblem; pageId: string; index: number }) {
  const [shown, setShown] = useState(false)

  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <p className="m-0 mb-1 text-ui-2xs font-bold uppercase tracking-[0.09em] text-muted-foreground">
        Problem {index + 1}
      </p>
      <div
        className="course-prose text-ui-md leading-relaxed [&_p]:mb-2 [&_p]:mt-0 [&_p:last-child]:mb-0"
        dangerouslySetInnerHTML={{ __html: problem.prompt }}
      />
      {shown ? (
        <div className="mt-3.5 rounded-xl border border-[var(--accent-mint)]/30 bg-[var(--accent-mint)]/10 p-4">
          {problem.math && (
            <div className="mb-2.5 overflow-x-auto rounded-lg bg-background/60 px-3.5 py-3 text-center">
              <TeX expr={problem.math} />
            </div>
          )}
          <div
            className="course-prose text-ui-md leading-relaxed [&_p]:mb-2 [&_p]:mt-0 [&_p:last-child]:mb-0"
            dangerouslySetInnerHTML={{ __html: problem.answer }}
          />
          {problem.verify && (
            <div className="mt-2 border-t border-[var(--accent-mint)]/25 pt-1">
              <CourseFigureBlock fig={problem.verify} pageId={pageId} locked={false} />
            </div>
          )}
        </div>
      ) : (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setShown(true)}>
          Show the answer
        </Button>
      )}
    </div>
  )
}

/** Justified steps. `why` renders before `math` because a step that arrives
 *  without its reason is where a reader stops following and starts copying. */
function Steps({ steps, reveal }: { steps: CourseSection['derivation']; reveal?: boolean }) {
  const [shown, setShown] = useState(reveal ? 1 : (steps?.length ?? 0))
  if (!steps?.length) return null
  const visible = reveal ? steps.slice(0, shown) : steps

  return (
    <div className="my-2">
      {visible.map((s, i) => (
        <div key={i} id={`step-${i}`} className="mb-5 flex items-start gap-3.5 last:mb-0">
          <span
            className={cn(
              'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-ui-2xs font-bold',
              s.hero
                ? 'border-transparent bg-[var(--accent-blue)] text-white'
                : 'border-border bg-card text-muted-foreground'
            )}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="m-0 mb-2 text-ui-md leading-relaxed text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: s.why }}
            />
            {s.math && (
              <div className="overflow-x-auto rounded-xl bg-muted px-3.5 py-3 text-center">
                <TeX expr={s.math} />
              </div>
            )}
          </div>
        </div>
      ))}
      {reveal && shown < steps.length && (
        <Button variant="outline" size="sm" onClick={() => setShown((n) => n + 1)}>
          Show the next step
        </Button>
      )}
    </div>
  )
}

export function CourseView({ pageId }: { pageId: string }) {
  const meta = useWorkspaceStore((s) => findPageMeta(s.nodes, pageId))
  const doc: CourseDoc | null = useMemo(() => readCourse(pageId), [pageId])
  const scrollRef = useRef<HTMLDivElement>(null)
  const setCurrent = useCourse((s) => s.setCurrent)
  const answers = useCourse((s) => s.answers[pageId])
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)

  const sections = doc?.sections ?? []

  // ── Outline → the shared Contents panel ────────────────────────────────
  // Published on mount, cleared on unmount, exactly as the PDF reader does
  // (pdf-view.tsx) — one outline panel, every view feeding it.
  const current = useCourse((s) => s.current)
  useEffect(() => {
    if (!sections.length) return
    const ids = sections.map((s) => s.id)
    useTocStore.getState().set({
      entries: sections.map((s, i) => ({
        index: i,
        title: s.title,
        level: 0,
        locator: s.locator,
      })),
      current: Math.max(0, ids.indexOf(current ?? ids[0])),
      goTo: (i) =>
        document.getElementById(`sec-${ids[i]}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    })
    return () => useTocStore.getState().set(null)
  }, [sections, current])

  // ── Scroll spy ─────────────────────────────────────────────────────────
  // One IntersectionObserver, not a scroll handler: the browser reports only
  // when a section crosses the line, so scrolling costs nothing per frame.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !sections.length) return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setCurrent(top.target.id.replace('sec-', ''))
      },
      { root, rootMargin: '-8% 0px -70% 0px', threshold: 0 }
    )
    for (const s of sections) {
      const el = document.getElementById(`sec-${s.id}`)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [sections, setCurrent])

  // ── Tear down the figures' scratch pages ───────────────────────────────
  useEffect(() => {
    return () => {
      const prefix = `${pageId}::fig::`
      useDocStore.setState((s) => {
        const pages = { ...s.pages }
        for (const id of Object.keys(pages)) if (id.startsWith(prefix)) delete pages[id]
        return { pages }
      })
      // The build guard must go with the pages it guards, or reopening the
      // lesson would skip every figure and render an empty document.
      forgetBuiltFigures(prefix)
      // Double-clicking a component points the sidebar at that figure's scratch
      // page; leaving the lesson deletes those pages, so release the pointer or
      // Properties is left inspecting something that no longer exists.
      if (useWorkspaceStore.getState().activeSheetId?.startsWith(prefix)) {
        useWorkspaceStore.setState({ activeSheetId: null })
      }
    }
  }, [pageId])

  // ── "Ask about this" on a selection ────────────────────────────────────
  const onSelect = useCallback(() => {
    const s = window.getSelection()
    const text = s?.toString().trim() ?? ''
    if (!text || text.length < 4 || !s || s.rangeCount === 0) return setSel(null)
    const host = scrollRef.current
    const rect = s.getRangeAt(0).getBoundingClientRect()
    const box = host?.getBoundingClientRect()
    if (!box) return setSel(null)
    setSel({ text, x: rect.left - box.left + rect.width / 2, y: rect.top - box.top })
  }, [])

  const ask = useCallback(() => {
    if (!sel) return
    const sec = sections.find((s) => s.id === current)
    askAboutSelection(sel.text, [doc?.title, sec?.title].filter(Boolean).join(' · '))
    setSel(null)
    window.getSelection()?.removeAllRanges()
  }, [sel, sections, current, doc?.title])

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-sm text-center text-ui-sm leading-relaxed text-muted-foreground">
          This course page has no lesson yet. Lessons are authored offline and imported — nothing is
          generated here.
        </p>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-y-auto"
      onMouseUp={onSelect}
      onTouchEnd={onSelect}
    >
      <article className="mx-auto max-w-[62rem] px-8 py-8 pb-32 max-md:px-4">
        {(doc.kicker || doc.title) && (
          <header className="mb-8">
            {doc.kicker && (
              <p className="m-0 mb-2.5 text-ui-2xs font-bold uppercase tracking-[0.09em] text-[var(--accent-violet)]">
                {doc.kicker}
              </p>
            )}
            <h1 className="m-0 text-[2rem] font-bold leading-[1.15] tracking-[-0.025em]">{doc.title}</h1>
            {doc.subtitle && (
              <p className="mt-3 text-ui-xl leading-relaxed text-muted-foreground">{doc.subtitle}</p>
            )}
          </header>
        )}

        {sections.map((s, i) => {
          // Every question in the section, in render order: the legacy single
          // `question` first, then the array.
          const qs: { q: CourseQuestion; key: string }[] = [
            ...(s.question ? [{ q: s.question, key: s.id }] : []),
            ...(s.questions ?? []).map((q, qi) => ({ q, key: questionKey(s, qi) })),
          ]
          // A locked figure waits for EVERY question in its section. One
          // answered question in a section that asks three would reveal a
          // figure the other two still depend on predicting.
          const allAnswered = qs.every(({ key }) => answers?.[key] !== undefined)
          const locked = (f: CourseFigure) => !!f.locked && !allAnswered
          return (
            <section
              key={s.id}
              id={`sec-${s.id}`}
              className={cn('scroll-mt-4 pb-3', i > 0 && 'mt-3 border-t border-border pt-8')}
            >
              {s.eyebrow && (
                <p className="m-0 mb-2.5 text-ui-2xs font-bold uppercase tracking-[0.09em] text-[var(--accent-violet)]">
                  {s.eyebrow}
                </p>
              )}
              <h2 className="m-0 mb-3.5 text-ui-3xl font-semibold leading-tight tracking-[-0.015em]">
                {s.title}
              </h2>

              {s.body && <Prose html={s.body} />}
              {s.derivation && <Steps steps={s.derivation} />}
              {s.worked && <Steps steps={s.worked} reveal />}
              {qs.length > 0 && (
                <div className="my-6 flex flex-col gap-4">
                  {qs.map(({ q, key }) => (
                    <Question key={key} q={q} storeKey={key} pageId={pageId} />
                  ))}
                </div>
              )}

              {!!s.figures?.length && (
                // Flow, not grid. Components sit in the prose at their natural
                // width and wrap side by side when two fit; a grid would force
                // equal columns and stretch a narrow component to match a wide
                // one — the dead space this design exists to avoid.
                <div className="flex flex-wrap items-start gap-x-8 gap-y-2">
                  {s.figures.map((f) => (
                    // A figure that reports itself wide (a block diagram, a
                    // long circuit) takes the whole row. Sharing it halves the
                    // width, and a drawing scaled to half a column is a
                    // picture of a diagram rather than a diagram.
                    <div key={f.id} className="min-w-[min(100%,22rem)] flex-1 has-[[data-wide]]:basis-full">
                      <CourseFigureBlock fig={f} pageId={pageId} locked={locked(f)} />
                    </div>
                  ))}
                </div>
              )}

              {!!s.problems?.length && (
                <div className="my-6 flex flex-col gap-4">
                  {s.problems.map((p, pi) => (
                    <Problem key={p.id ?? pi} problem={p} pageId={pageId} index={pi} />
                  ))}
                </div>
              )}

              {s.after && <Prose html={s.after} />}
            </section>
          )
        })}
      </article>

      {sel && (
        <div
          className="pointer-events-auto absolute z-50 -translate-x-1/2 -translate-y-full pb-2"
          style={{ left: sel.x, top: sel.y }}
        >
          <Button size="sm" className="gap-1.5 shadow-lg" onClick={ask}>
            <MessageSquareQuote className="h-3.5 w-3.5" />
            Ask about this
          </Button>
        </div>
      )}
    </div>
  )
}

/** Lesson prose. The authored subset is plain semantic HTML — paragraphs,
 *  bold/italic, lists, and the two callout classes below — so a lesson is
 *  readable as source and diffable in review. It is authored offline and
 *  lint-gated, never user input, so there is no untrusted HTML here. */
function Prose({ html }: { html: string }) {
  return (
    <div
      className="course-prose text-ui-lg leading-[1.8] [&_b]:font-semibold [&_p]:mb-4 [&_p]:mt-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
