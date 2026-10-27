'use client'

// The controls around the assistant's composer, laid out like the Claude app's: a "+" menu for things you add or switch on,
// a mode menu, and a context ring that opens a panel showing exactly what the next message will carry.

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, FileText, GraduationCap, Lightbulb, MessageSquareText, Paperclip, Plus, Sparkle, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { buildPanelContext, loadBriefItems, READ_KINDS } from '@/lib/ai/panel-context'
import type { BriefItem } from '@/lib/ai/brief/page-brief'
import { useLearner } from '@/lib/learning/store'
import { useAiChat, type ChatAttachment } from '@/lib/store/ai-chat'
import { useDocStore } from '@/lib/store/document'
import type { PageKind } from '@/lib/scene/types'
import { cn } from '@/lib/utils'

const tokens = (chars: number) => Math.ceil(chars / 4)
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** "+": add a file, switch the teacher on, attach or detach the page. */
export function ComposerPlus({ onAttach, teacher, onTeacher, useContext, onUseContext, hasPage }: {
  onAttach: () => void
  teacher: boolean
  onTeacher: () => void
  useContext: boolean
  onUseContext: () => void
  hasPage: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Add or switch on" className="shrink-0 rounded-full text-muted-foreground active:scale-90">
          <Plus className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuItem onSelect={onAttach}>
          <Paperclip /> Add files or photos
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onTeacher} className="items-start">
          <GraduationCap className="mt-0.5" />
          <span className="flex-1">
            Teacher
            <span className="block text-ui-2xs text-muted-foreground">Answer as a narrated lesson about this page</span>
          </span>
          {teacher && <Check className="mt-0.5" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onUseContext} disabled={!hasPage} className="items-start">
          <FileText className="mt-0.5" />
          <span className="flex-1">
            Use this page
            <span className="block text-ui-2xs text-muted-foreground">Send what is on the page with each message</span>
          </span>
          {useContext && hasPage && <Check className="mt-0.5" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Manual / Auto, as a menu with a line of explanation each. */
export function ModeMenu({ auto, onChange }: { auto: boolean; onChange: (v: boolean) => void }) {
  const rows = [
    { v: false, label: 'Manual', hint: 'Review each script, then add it yourself', Icon: Sparkle },
    { v: true, label: 'Auto', hint: 'Verified scripts are added to the canvas at once', Icon: Zap },
  ] as const
  const cur = rows.find((r) => r.v === auto)!
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-ui-xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
          <cur.Icon className="h-3 w-3" />
          {cur.label}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        {rows.map(({ v, label, hint, Icon }) => (
          <DropdownMenuItem key={label} onSelect={() => onChange(v)} className="items-start">
            <Icon className="mt-0.5" />
            <span className="flex-1">
              {label}
              <span className="block text-ui-2xs text-muted-foreground">{hint}</span>
            </span>
            {auto === v && <Check className="mt-0.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A ring that fills as the context grows; click for the list of what is in it and the text itself. */
export function ContextMeter({ pageId, pageKind, useContext, onUseContext, teacher, draft, attachments }: {
  pageId: string | null | undefined
  pageKind: PageKind
  useContext: boolean
  onUseContext: () => void
  teacher: boolean
  draft: string
  attachments: ChatAttachment[]
}) {
  const [open, setOpen] = useState(false)
  const [showText, setShowText] = useState(false)
  // The page changes while the panel is open (drawing, selecting); re-read it, but only while someone is looking.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setTick((t) => t + 1), 1200)
    return () => clearInterval(id)
  }, [open])
  // A document, deck or PDF is read (asynchronously) while the panel is open; a board is read straight from the page.
  const [items, setItems] = useState<BriefItem[] | undefined>()
  useEffect(() => {
    if (!open || !useContext || !READ_KINDS.has(pageKind)) return
    let live = true
    void loadBriefItems().then((r) => { if (live) setItems(r) }).catch(() => {})
    return () => { live = false }
  }, [open, useContext, pageKind, pageId, tick])
  const turns = useAiChat((s) => s.turns)
  const selection = useDocStore((s) => s.selection)

  const report = useMemo(() => {
    void tick
    void selection
    const ctx = useContext ? buildPanelContext(pageId, pageKind, draft, items) : null
    const history = turns.filter((t) => t.status === 'ok')
    const rows: { label: string; detail: string; chars: number }[] = []
    if (ctx) {
      const st = ctx.stats
      rows.push({ label: ctx.hasSelection ? 'Selection and page' : 'Page summary', detail: st.items > st.shown ? `${st.shown} of ${st.items} parts, best matches for your question in full` : `${st.items} part${st.items === 1 ? '' : 's'}`, chars: ctx.pageDigest.length })
      if (ctx.pageSurface) rows.push({ label: 'Space to build in', detail: 'sent with the system prompt', chars: ctx.pageSurface.length })
    }
    if (history.length) rows.push({ label: 'Earlier messages', detail: `${history.length} turn${history.length === 1 ? '' : 's'}`, chars: history.slice(-3).reduce((n, t) => n + t.prompt.length + (t.answer?.length ?? 0), 0) })
    if (attachments.length) rows.push({ label: 'Attachments', detail: attachments.map((a) => a.name).join(', '), chars: attachments.reduce((n, a) => n + a.text.length, 0) })
    if (draft.trim()) rows.push({ label: 'Your message', detail: 'being typed', chars: draft.length })
    const total = rows.reduce((n, r) => n + r.chars, 0)
    return { ctx, rows, total }
  }, [tick, selection, useContext, pageId, pageKind, turns, attachments, draft, items])

  const BUDGET = 12_000 // characters: the page digest alone is capped at 8000, the rest is history and files
  const frac = Math.min(1, report.total / BUDGET)
  const R = 6.5
  const C = 2 * Math.PI * R

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Context sent with the next message"
          title={`${fmt(tokens(report.total))} tokens of context`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-accent/60"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4 -rotate-90">
            <circle cx="8" cy="8" r={R} fill="none" strokeWidth="2" className="stroke-muted-foreground/35" />
            <circle cx="8" cy="8" r={R} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} className={frac > 0.85 ? 'stroke-amber-500' : 'stroke-[var(--accent-violet)]'} />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" collisionPadding={8} className="w-[min(20rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div>
            <p className="text-ui-sm font-semibold">Context</p>
            <p className="text-ui-2xs text-muted-foreground">What the next message carries · about {fmt(tokens(report.total))} tokens</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={useContext}
            onClick={onUseContext}
            className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', useContext ? 'bg-[var(--accent-violet)]' : 'bg-muted')}
            title={useContext ? 'Page is attached — click to detach' : 'Page is detached — click to attach'}
          >
            <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-[left]', useContext ? 'left-[18px]' : 'left-0.5')} />
          </button>
        </div>
        <div className="space-y-1.5 px-3 pb-3">
          {report.rows.length === 0 && <p className="text-ui-xs text-muted-foreground">{useContext ? 'Nothing yet — the page is empty.' : 'The page is detached: only your message is sent.'}</p>}
          {report.rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3 text-ui-xs">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{r.label}</span>
                <span className="ml-1.5 text-muted-foreground">{r.detail}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{fmt(tokens(r.chars))}</span>
            </div>
          ))}
          {teacher && <p className="text-ui-2xs text-muted-foreground">Teacher is on: the open page is read again in full (up to about 7,500 characters) when the lesson is planned.</p>}
        </div>
        {report.ctx && (
          <div className="border-t">
            <button type="button" onClick={() => setShowText((v) => !v)} className="flex w-full items-center justify-between px-3 py-2 text-ui-xs text-muted-foreground hover:text-foreground">
              Show exactly what is sent
              <ChevronDown className={cn('h-3 w-3 transition-transform', showText && 'rotate-180')} />
            </button>
            {showText && (
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t bg-muted/40 px-3 py-2 font-mono text-[11px] leading-relaxed">
                {[report.ctx.pageDigest && `# ${report.ctx.pageLabel}\n${report.ctx.pageDigest}`, report.ctx.pageSurface && `# Space (system prompt)\n${report.ctx.pageSurface}`].filter(Boolean).join('\n\n')}
              </pre>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Learn / Answer: whether the assistant gives hints first or the answer straight away. Explicit, never inferred. */
export function LearnMenu() {
  const mode = useLearner((s) => s.prefs.mode)
  const setPrefs = useLearner((s) => s.setPrefs)
  const rows = [
    { v: 'learn', label: 'Learn', hint: 'Hints first, never the bare answer', Icon: Lightbulb },
    { v: 'answer', label: 'Answer', hint: 'Direct answers, for quick checks', Icon: MessageSquareText },
  ] as const
  const cur = rows.find((r) => r.v === mode) ?? rows[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-ui-xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground">
          <cur.Icon className="h-3 w-3" />
          {cur.label}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        {rows.map(({ v, label, hint, Icon }) => (
          <DropdownMenuItem key={v} onSelect={() => setPrefs({ mode: v })} className="items-start">
            <Icon className="mt-0.5" />
            <span className="flex-1">
              {label}
              <span className="block text-ui-2xs text-muted-foreground">{hint}</span>
            </span>
            {mode === v && <Check className="mt-0.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
