'use client'

// /docs — the user manual. Public (no sign-in), so it wears the landing
// page's chrome rather than PageShell, which assumes a signed-in profile.
//
// Layout: a sticky contents rail on the left, the manual on the right. The
// search box filters ARTICLES, not sections — typing "spring" should leave
// you with the three places springs are actually explained, and the rail
// collapses to match so the two never disagree about what is on screen.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, Search, X } from 'lucide-react'
import { SignInLink } from '@/components/landing/sign-in-link'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SECTIONS, type DocSection } from './sections'

function matches(haystack: string, q: string) {
  return haystack.toLowerCase().includes(q)
}

export function DocsView() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string>(SECTIONS[0].id)
  const contentRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()

  const visible: DocSection[] = useMemo(() => {
    if (!q) return SECTIONS
    return SECTIONS.map((s) => ({
      ...s,
      articles: s.articles.filter(
        (a) =>
          matches(a.title, q) ||
          matches(a.keywords ?? '', q) ||
          matches(s.title, q)
      ),
    })).filter((s) => s.articles.length > 0)
  }, [q])

  // Scroll-spy: whichever section heading is highest in the top half of the
  // viewport owns the rail highlight. Re-observed when the filter changes,
  // since filtering removes headings from the document.
  useEffect(() => {
    const headings = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('[data-doc-section]') ?? []
    )
    if (headings.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.getAttribute('data-doc-section') ?? '')
      },
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 }
    )
    headings.forEach((h) => io.observe(h))
    return () => io.disconnect()
  }, [visible])

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Floating glass chrome, same material as the landing page's nav. */}
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="progressive-blur-top !h-16" />
        <div className="relative flex items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6">
          <Link
            href="/"
            className="liquid-glass shrink-0 rounded-full px-3.5 py-1.5 text-ui-md font-bold tracking-tight sm:text-ui-lg"
          >
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </Link>
          <span className="hidden text-ui-sm font-medium text-muted-foreground sm:inline">
            Documentation
          </span>

          <div className="relative ml-auto w-full max-w-xs">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the docs…"
              aria-label="Search the documentation"
              className="liquid-glass h-9 rounded-full border-transparent pl-9 pr-9 text-ui-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <SignInLink
            signedOutLabel="Sign in"
            className="hidden shrink-0 rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-ui-sm font-semibold text-primary-foreground transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-[0.97] sm:inline-block"
          />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[100rem] gap-8 px-4 pb-24 pt-24 sm:px-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12 lg:px-10">
        {/* Contents. A collapsible summary on small screens, a sticky rail
            from lg up — a fixed rail on a phone would eat the whole fold. */}
        <nav aria-label="Documentation contents" className="lg:sticky lg:top-24 lg:self-start">
          <details className="rounded-2xl border border-border/50 lg:border-0" open>
            <summary className="cursor-pointer list-none px-3.5 py-3 text-ui-xs font-bold uppercase tracking-[0.12em] text-muted-foreground lg:cursor-default lg:px-1 lg:py-0">
              Contents
            </summary>
            <ul className="max-h-[calc(100dvh-9rem)] space-y-0.5 overflow-y-auto px-2 pb-3 lg:mt-3 lg:px-0">
              {visible.map((s) => {
                const Icon = s.icon
                const on = active === s.id
                return (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-ui-sm transition-colors',
                        on
                          ? 'bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)] font-semibold text-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                      )}
                    >
                      <Icon
                        className="h-4 w-4 shrink-0"
                        style={{ color: on ? 'var(--accent-blue)' : undefined }}
                      />
                      <span className="min-w-0 truncate">{s.title}</span>
                    </a>
                    {on && s.articles.length > 1 && (
                      <ul className="ml-[1.4rem] mt-0.5 space-y-px border-l border-border/60 pl-2.5">
                        {s.articles.map((a) => (
                          <li key={a.id}>
                            <a
                              href={`#${a.id}`}
                              className="block truncate rounded px-1.5 py-1 text-ui-xs text-muted-foreground transition-colors hover:text-foreground"
                            >
                              {a.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
              {visible.length === 0 && (
                <li className="px-2.5 py-2 text-ui-xs text-muted-foreground">No matches</li>
              )}
            </ul>
          </details>
        </nav>

        <main ref={contentRef} className="min-w-0">
          {!q && (
            <header className="mb-12">
              <p className="text-ui-xs font-bold uppercase tracking-[0.16em] text-[var(--accent-blue)]">
                Documentation
              </p>
              <h1 className="mt-3 max-w-[16ch] text-[clamp(2rem,5vw,3.4rem)] font-bold leading-[1.02] tracking-[-0.025em]">
                How to use SIMBLIP
              </h1>
              <p className="mt-4 max-w-2xl text-pretty text-ui-md leading-[1.7] text-muted-foreground sm:text-ui-lg">
                Everything in the app, explained: every tool, panel, page kind, component, behavior
                and setting, plus the classroom workflows built on top of them. Start at{' '}
                <a href="#start" className="font-medium text-foreground underline underline-offset-4">
                  Getting started
                </a>{' '}
                if this is your first session, or search above if you came looking for one thing.
              </p>
            </header>
          )}

          {q && (
            <p className="mb-8 text-ui-sm text-muted-foreground">
              {visible.reduce((n, s) => n + s.articles.length, 0)} result
              {visible.reduce((n, s) => n + s.articles.length, 0) === 1 ? '' : 's'} for{' '}
              <span className="font-semibold text-foreground">“{query.trim()}”</span>
            </p>
          )}

          <div className="space-y-16">
            {visible.map((s) => {
              const Icon = s.icon
              return (
                <section key={s.id} id={s.id} data-doc-section={s.id} className="scroll-mt-24">
                  <div className="mb-6 border-b border-border/50 pb-5">
                    <div className="flex items-center gap-2.5">
                      <Icon className="h-5 w-5 text-[var(--accent-blue)]" />
                      <h2 className="text-[clamp(1.35rem,2.6vw,1.9rem)] font-bold leading-tight tracking-[-0.02em]">
                        {s.title}
                      </h2>
                    </div>
                    <p className="mt-2 max-w-2xl text-ui-sm leading-relaxed text-muted-foreground">
                      {s.blurb}
                    </p>
                  </div>

                  <div className="space-y-8">
                    {s.articles.map((a) => (
                      <article key={a.id} id={a.id} className="scroll-mt-24">
                        <h3 className="group mb-3 flex items-baseline gap-2 text-ui-2xl font-semibold tracking-[-0.01em]">
                          {a.title}
                          <a
                            href={`#${a.id}`}
                            aria-label={`Link to ${a.title}`}
                            className="text-ui-md text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            #
                          </a>
                        </h3>
                        <div className="space-y-4">{a.body}</div>
                      </article>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>

          {visible.length === 0 && (
            <p className="text-ui-md text-muted-foreground">
              Nothing in the manual matches “{query.trim()}”. Try a tool name (pen, graph), a subject
              (circuits, quantum) or a task (assignment, export).
            </p>
          )}

          <footer className="mt-20 flex flex-wrap items-center justify-between gap-3 border-t border-border/40 pt-8 text-ui-xs text-muted-foreground">
            <span>© {new Date().getFullYear()} SIMBLIP · Built by Rohan Singh</span>
            <div className="flex items-center gap-4">
              <a href="#" className="inline-flex items-center gap-1 hover:text-foreground">
                <ArrowUp className="h-3.5 w-3.5" />
                Back to top
              </a>
              <SignInLink signedOutLabel="Sign in →" signedInLabel="Open notebook →" className="hover:text-foreground" />
            </div>
          </footer>
        </main>
      </div>
    </div>
  )
}
