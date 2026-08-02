'use client'

// SimScript IDE — a real little editor, not a bare textarea:
//  • syntax highlighting (transparent textarea over a token-colored layer)
//  • live line-accurate diagnostics (reserved words, unknown kinds, unclosed
//    brackets/strings…) with the offending line marked in the gutter
//  • snippet buttons that insert a ready-made line at the cursor
// Tokenizing + diagnostics live in lib/scene/simscript-diagnostics.ts.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { cn } from '@/lib/utils'
import { getString, type ObjectRendererProps } from './types'
import { executeSimScript } from '@/lib/scene/simscript'
import {
  diagnoseSimScript,
  tokenizeSimScript,
  type Diagnostic,
  type TokType,
} from '@/lib/scene/simscript-diagnostics'

const LH = 20 // editor line height (px) — keep the classes below in sync
const PAD = 12 // editor padding (p-3)

const TOK_STYLE: Record<TokType, React.CSSProperties | undefined> = {
  kw: { color: 'var(--accent-violet)' },
  api: { color: 'var(--accent-blue)', fontWeight: 600 },
  str: { color: 'var(--accent-mint)' },
  num: { color: 'var(--accent-amber)' },
  com: { color: 'var(--muted-foreground)', fontStyle: 'italic' },
  prop: { color: 'var(--accent-rose)' },
  id: undefined,
  punc: { opacity: 0.72 },
}

// One-click starter lines. `vars` = create()-declared variable names in order,
// so connect/set/plot reference what the user actually made.
const SNIPPETS: { label: string; make: (vars: string[], n: number) => string }[] = [
  { label: 'create', make: (_v, n) => `var part${n} = create("resistor", { R: 100 });` },
  {
    label: 'connect',
    make: (v) => `connect(${v[v.length - 2] ?? 'part1'}.b, ${v[v.length - 1] ?? 'part2'}.a);`,
  },
  { label: 'addproperty', make: (v) => `addproperty(${v[v.length - 1] ?? 'part1'}, "rigidBody", { mass: 1 });` },
  { label: '.set', make: (v) => `${v[v.length - 1] ?? 'part1'}.set({ R: 220 });` },
  { label: 'graph.plot', make: (v) => `graph.plot(${v[v.length - 1] ?? 'part1'}.voltage);` },
]

export function CodeObject({ pageId, object, selected }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const [editing, setEditing] = useState(false)
  const source = getString(object, 'source', '// Write SimScript here...\n')
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [ranOk, setRanOk] = useState(false)
  const [diags, setDiags] = useState<Diagnostic[]>([])
  const taRef = useRef<HTMLTextAreaElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const gutRef = useRef<HTMLDivElement>(null)
  const okTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live linting — errors appear as you type, not only on Run.
  useEffect(() => {
    setRanOk(false)
    const t = setTimeout(() => setDiags(diagnoseSimScript(source)), 400)
    return () => clearTimeout(t)
  }, [source])
  useEffect(() => () => { if (okTimer.current) clearTimeout(okTimer.current) }, [])

  const lines = useMemo(() => source.split('\n'), [source])
  const tokens = useMemo(() => tokenizeSimScript(source), [source])
  const errors = useMemo(() => diags.filter((d) => d.severity === 'error'), [diags])
  const warnings = useMemo(() => diags.filter((d) => d.severity === 'warning'), [diags])
  const errorLines = useMemo(() => new Set(errors.map((d) => d.line)), [errors])
  const declaredVars = useMemo(
    () => [...source.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*create\s*\(/g)].map((m) => m[1]),
    [source]
  )

  const setSource = (next: string) => {
    if (!editing) pushHistory(pageId)
    setStringParam(pageId, object.id, 'source', next)
    setEditing(true)
    setRuntimeError(null)
  }

  const runCode = () => {
    // Lint before running so the user gets the line, not "Unexpected token".
    const now = diagnoseSimScript(source)
    setDiags(now)
    setRanOk(false)
    setRuntimeError(null)
    if (now.some((d) => d.severity === 'error')) return
    pushHistory(pageId)
    // Spawn objects to the right of the code block.
    const ideOrigin = {
      x: object.position.x + object.size.w + 40,
      y: object.position.y,
    }
    try {
      executeSimScript(pageId, source, ideOrigin)
      setRanOk(true)
      if (okTimer.current) clearTimeout(okTimer.current)
      okTimer.current = setTimeout(() => setRanOk(false), 2500)
    } catch (e: any) {
      setRuntimeError(e.message || String(e))
    }
  }

  const insertSnippet = (make: (vars: string[], n: number) => string) => {
    const ta = taRef.current
    const partNums = [...source.matchAll(/\bpart(\d+)\b/g)].map((m) => Number(m[1]))
    const snippet = make(declaredVars, partNums.length ? Math.max(...partNums) + 1 : 1)
    // Insert on a fresh line after the cursor's current line.
    let pos = ta ? ta.selectionEnd : source.length
    const lineEnd = source.indexOf('\n', pos)
    pos = lineEnd === -1 ? source.length : lineEnd
    const before = source.slice(0, pos)
    const insert = (before.length && !before.endsWith('\n') ? '\n' : '') + snippet
    setSource(before + insert + source.slice(pos))
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      const p = before.length + insert.length
      ta.setSelectionRange(p, p)
    })
  }

  // Keep the highlight layer and gutter glued to the textarea's scroll.
  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget
    if (hlRef.current) hlRef.current.style.transform = `translate(${-t.scrollLeft}px, ${-t.scrollTop}px)`
    if (gutRef.current) gutRef.current.style.transform = `translateY(${-t.scrollTop}px)`
  }

  const firstError = errors[0]
  const firstWarning = warnings[0]

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-[var(--background)] shadow-sm"
      onPointerDown={(e) => {
        if (editing) e.stopPropagation()
      }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 bg-muted/20 px-3 py-1.5">
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          SimScript IDE
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              errors.length ? 'bg-[var(--accent-rose)]' : ranOk ? 'bg-[var(--accent-mint)]' : 'bg-muted-foreground/40'
            )}
          />
        </span>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md bg-[var(--accent-blue)] px-2 py-1 text-[11.5px] font-semibold text-white transition-colors hover:bg-blue-600"
          onClick={runCode}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Play className="h-3 w-3 fill-current" />
          Run
        </button>
      </div>

      {/* ── snippet toolbar: click to append a ready-made line ── */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 bg-muted/10 px-2 py-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {SNIPPETS.map((s) => (
          <button
            key={s.label}
            type="button"
            className="rounded-md border border-border/50 bg-background px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:border-[var(--accent-blue)] hover:text-foreground"
            onClick={() => insertSnippet(s.make)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ── gutter ── */}
        <div className="relative w-9 shrink-0 overflow-hidden border-r border-border/40 bg-muted/10">
          <div ref={gutRef} className="absolute left-0 top-0 w-full select-none py-3 font-mono text-[10px]">
            {lines.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'pr-2 text-right leading-[20px]',
                  errorLines.has(i + 1) ? 'font-bold text-[var(--accent-rose)]' : 'text-muted-foreground/50'
                )}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>

        {/* ── editor: highlight layer under a transparent-text textarea ── */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div ref={hlRef} aria-hidden className="pointer-events-none absolute left-0 top-0 min-w-full">
            {[...errorLines].map((l) => (
              <div
                key={l}
                className="absolute left-0 right-0"
                style={{
                  top: PAD + (l - 1) * LH,
                  height: LH,
                  background: 'color-mix(in oklch, var(--accent-rose) 12%, transparent)',
                }}
              />
            ))}
            <div className="relative p-3 font-mono text-[13px] text-foreground" style={{ tabSize: 2 }}>
              {tokens.map((lineToks, i) => (
                <div key={i} className="whitespace-pre leading-[20px]" style={{ minHeight: LH }}>
                  {lineToks.map((t, k) => (
                    <span key={k} style={TOK_STYLE[t.type]}>
                      {t.text}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <textarea
            ref={taRef}
            wrap="off"
            aria-label="SimScript code editor"
            className="absolute inset-0 h-full w-full resize-none whitespace-pre bg-transparent p-3 font-mono text-[13px] leading-[20px] placeholder:text-muted-foreground focus:outline-none"
            style={{ color: 'transparent', caretColor: 'var(--foreground)', tabSize: 2 }}
            value={source}
            placeholder="// Write your code here"
            spellCheck={false}
            onScroll={syncScroll}
            onPointerDown={(e) => e.stopPropagation()} // Let the user click to place cursor
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setSource(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              const ta = e.currentTarget
              if (e.key === 'Escape') {
                ta.blur()
                setEditing(false)
                return
              }
              // Real-IDE niceties: Tab indents, Enter keeps the indent.
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault()
                const s = ta.selectionStart
                const lineStart = source.lastIndexOf('\n', s - 1) + 1
                const indent = /^[ \t]*/.exec(source.slice(lineStart, s))?.[0] ?? ''
                const opened = /[{([]\s*$/.test(source.slice(lineStart, s))
                const text = e.key === 'Tab' ? '  ' : '\n' + indent + (opened ? '  ' : '')
                setSource(source.slice(0, s) + text + source.slice(ta.selectionEnd))
                requestAnimationFrame(() => ta.setSelectionRange(s + text.length, s + text.length))
              }
            }}
          />
        </div>
      </div>

      {/* ── status strip: live errors > runtime errors > warnings > success ── */}
      {firstError ? (
        <div className="shrink-0 border-t border-[color-mix(in_oklch,var(--accent-rose)_25%,transparent)] bg-[color-mix(in_oklch,var(--accent-rose)_10%,transparent)] px-3 py-2 font-mono text-[11.5px] text-[var(--accent-rose)]">
          <span className="font-bold">Line {firstError.line}</span> · {firstError.message}
          {errors.length > 1 && <span className="opacity-70"> · +{errors.length - 1} more</span>}
        </div>
      ) : runtimeError ? (
        <div className="shrink-0 border-t border-[color-mix(in_oklch,var(--accent-rose)_25%,transparent)] bg-[color-mix(in_oklch,var(--accent-rose)_10%,transparent)] px-3 py-2 font-mono text-[11.5px] text-[var(--accent-rose)]">
          {runtimeError}
        </div>
      ) : firstWarning ? (
        <div className="shrink-0 border-t border-[color-mix(in_oklch,var(--accent-amber)_25%,transparent)] bg-[color-mix(in_oklch,var(--accent-amber)_10%,transparent)] px-3 py-2 font-mono text-[11.5px] text-[var(--accent-amber)]">
          <span className="font-bold">Line {firstWarning.line}</span> · {firstWarning.message}
        </div>
      ) : ranOk ? (
        <div className="shrink-0 border-t border-[color-mix(in_oklch,var(--accent-mint)_25%,transparent)] bg-[color-mix(in_oklch,var(--accent-mint)_10%,transparent)] px-3 py-2 font-mono text-[11.5px] text-[var(--accent-mint)]">
          Script ran ✓
        </div>
      ) : null}
    </div>
  )
}
