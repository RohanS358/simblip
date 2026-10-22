'use client'

// The study notes for the lesson that was just taught: every section's key points, the words it
// introduced, its formulas and the questions it asked (with answers), then a formula sheet and a
// glossary. Print it, save it as a PDF (the browser's print dialog does both), or copy it as
// Markdown. While it is open, printing shows only this page.

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Printer, X } from 'lucide-react'
import { toast } from 'sonner'
import katex from '@/lib/text/katex-impl'
import { Button } from '@/components/ui/button'
import { useLesson } from '@/lib/lesson/store'
import { buildSummary, keyPoints, studyMarkdown, type Section } from '@/lib/lesson/sections'

const tex = (latex: string) => ({ __html: katex.renderToString(latex || '\\text{empty}', { displayMode: false, throwOnError: false }) })

function SectionNotes({ s, n }: { s: Section; n: number }) {
  return (
    <section className="mb-7 break-inside-avoid">
      <h2 className="mb-2 border-b border-neutral-300 pb-1 text-xl font-semibold">{n}. {s.title}</h2>
      {keyPoints(s).length > 0 && <ul className="ml-5 list-disc space-y-1.5">{keyPoints(s).map((b) => <li key={b}>{b}</li>)}</ul>}
      {!!s.definitions?.length && (
        <div className="mt-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Words to know</h3>
          <ul className="ml-5 list-disc space-y-1">{s.definitions.map((d) => <li key={d.term}><b>{d.term}</b> — {d.meaning}</li>)}</ul>
        </div>
      )}
      {!!s.formulas?.length && (
        <div className="mt-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Formulas</h3>
          {s.formulas.map((f) => (
            <p key={f.latex} className="my-1.5"><span className="text-lg" dangerouslySetInnerHTML={tex(f.latex)} />{f.text && <span className="ml-3 text-neutral-600">{f.text}</span>}</p>
          ))}
        </div>
      )}
      {!!s.checks?.length && (
        <div className="mt-3">
          <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Check yourself</h3>
          <ol className="ml-5 list-decimal space-y-2">{s.checks.map((c) => <li key={c.q}>{c.q}<div className="mt-0.5 text-neutral-600"><b>Answer:</b> {c.a}</div></li>)}</ol>
        </div>
      )}
    </section>
  )
}

export function StudyNotes() {
  const open = useLesson((s) => s.notesOpen)
  const title = useLesson((s) => s.storyboard?.title ?? 'Lesson')
  const sections = useLesson((s) => s.sections)
  const close = () => useLesson.getState().set({ notesOpen: false })

  useEffect(() => {
    if (!open) return
    document.body.classList.add('printing-study-notes')
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', esc)
    return () => { document.body.classList.remove('printing-study-notes'); window.removeEventListener('keydown', esc) }
  }, [open])

  if (!open || typeof document === 'undefined') return null
  const real = sections.filter((s) => !s.summary && (keyPoints(s).length + (s.checks?.length ?? 0) > 0))
  const sum = buildSummary(title, sections)

  return createPortal(
    <div className="study-notes-root fixed inset-0 z-[200] overflow-y-auto bg-white text-neutral-900" role="dialog" aria-label="Study notes">
      <div className="no-print sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white/95 px-5 py-2.5 backdrop-blur">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">Study notes · {title}</p>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { void navigator.clipboard?.writeText(studyMarkdown(title, sections)).then(() => toast.success('Copied as Markdown')) }}><Copy className="h-3.5 w-3.5" />Copy</Button>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" />Print / Save as PDF</Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Close" onClick={close}><X className="h-4 w-4" /></Button>
      </div>
      <article className="mx-auto max-w-3xl px-8 py-8 text-[15px] leading-relaxed">
        <header className="mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">Study notes</p>
          <h1 className="mt-1 text-3xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-neutral-500">{new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} · SIMBLIP</p>
        </header>
        {real.length === 0 && <p className="text-neutral-500">Nothing to show yet — the notes fill in as the lesson is taught.</p>}
        {real.map((s, i) => <SectionNotes key={s.id} s={s} n={i + 1} />)}
        {sum.formulas.length > 0 && (
          <section className="mb-7 break-inside-avoid">
            <h2 className="mb-2 border-b border-neutral-300 pb-1 text-xl font-semibold">Formula sheet</h2>
            {sum.formulas.map((f) => <p key={f.latex} className="my-1.5"><span className="text-lg" dangerouslySetInnerHTML={tex(f.latex)} />{f.text && <span className="ml-3 text-neutral-600">{f.text}</span>}</p>)}
          </section>
        )}
        {sum.glossary.length > 0 && (
          <section className="break-inside-avoid">
            <h2 className="mb-2 border-b border-neutral-300 pb-1 text-xl font-semibold">Glossary</h2>
            <ul className="ml-5 list-disc space-y-1">{sum.glossary.map((d) => <li key={d.term}><b>{d.term}</b> — {d.meaning}</li>)}</ul>
          </section>
        )}
      </article>
    </div>,
    document.body
  )
}
