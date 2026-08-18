'use client'

// The AI assistant, docked in the left rail beside Notebook / Components /
// Tools — a first-class place in the workspace rather than a floating bubble,
// because building a scene by describing it is a primary way to work here,
// not an accessory.
//
// It is a real conversation: every turn keeps its script, so you can compare
// two attempts, re-run an earlier one, or copy a script into the Code IDE.
//
// TWO MODES, and the distinction is the point:
//
//   • Manual — the script lands in the thread and waits. You read it, then
//     press Add. Nothing touches the canvas until you say so.
//   • Auto   — a verified script is executed the moment it arrives.
//
// Auto is only safe BECAUSE of the verifier (lib/ai/simscript-lint.ts): a
// script reaches the canvas only after passing every static check, so "just
// do it" cannot silently produce a broken scene. Both modes run identical
// generation — the only difference is who presses the button. Auto is
// undoable like any other edit, since executeSimScript goes through the same
// store actions a manual edit does.
//
// Chat UI is prompt-kit (components/ui/{chat-container,message,prompt-input,
// scroll-button,loader}). Its markdown renderer was dropped deliberately:
// it pulls react-markdown + shiki (multi-MB) to render what is almost always
// SimScript, which this app already tokenizes for free — see ScriptBlock.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import { answerColumnSize, blocksToSimScript } from '@/lib/ai/explain'
import { blocksToSlides } from '@/lib/ai/slides'
import { viewportBounds, viewportCenter } from '@/lib/scene/insertables'
import {
  BrainCircuit, Check, Copy, Loader2, Plus, Presentation as PresentationIcon, RotateCcw, Sparkle, Square, Trash2, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { ChatContainerContent, ChatContainerRoot } from '@/components/ui/chat-container'
import { Message, MessageContent } from '@/components/ui/message'
import {
  PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea,
} from '@/components/ui/prompt-input'
import { ScrollButton } from '@/components/ui/scroll-button'
import { Button } from '@/components/ui/button'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { executeSimScript } from '@/lib/scene/simscript'
import { tokenizeSimScript, type TokType } from '@/lib/scene/simscript-diagnostics'
import { useAiChat, type AiTurn } from '@/lib/store/ai-chat'
import { cn } from '@/lib/utils'

/** Same palette the Code IDE uses (components/objects/code.tsx), so a script
 *  looks identical whether it is read here or edited there. */
const TOK_COLOR: Record<TokType, string | undefined> = {
  kw: 'var(--accent-violet)',
  api: 'var(--accent-blue)',
  str: 'var(--accent-mint)',
  num: 'var(--accent-amber)',
  com: 'var(--muted-foreground)',
  prop: 'var(--foreground)',
  id: undefined,
  punc: 'var(--muted-foreground)',
}

/** Syntax-highlighted SimScript. Reuses the app's own tokenizer rather than a
 *  general-purpose highlighter — zero added bytes, and the colours match the
 *  IDE exactly. */
function ScriptBlock({ source, streaming }: { source: string; streaming?: boolean }) {
  const lines = tokenizeSimScript(source)
  return (
    <pre
      className={cn(
        'overflow-x-auto rounded-lg border border-border/60 bg-[var(--card)] p-2.5 font-mono text-[0.6875rem] leading-[1.6]',
        streaming && 'animate-in fade-in-0'
      )}
    >
      <code>
        {lines.map((toks, i) => (
          <div key={i} className="whitespace-pre">
            {toks.length === 0 ? ' ' : toks.map((t, j) => (
              <span key={j} style={{ color: TOK_COLOR[t.type], fontWeight: t.type === 'api' ? 600 : undefined }}>
                {t.text}
              </span>
            ))}
          </div>
        ))}
        {streaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-[var(--accent-blue)] align-middle" />}
      </code>
    </pre>
  )
}

/** Two states, one control. Auto is visually distinct (amber, filled) because
 *  it changes what a send DOES — it is a mode, not a preference. */
function ModeToggle({ auto, onChange }: { auto: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border/60 bg-card/60 p-0.5">
      {([false, true] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={auto === v}
          title={v
            ? 'Auto — verified scripts are added to the canvas immediately'
            : 'Manual — review each script, then add it yourself'}
          onClick={() => onChange(v)}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-[3px] text-[0.6875rem] font-medium transition-colors duration-150',
            auto === v
              ? v
                ? 'bg-[var(--accent-amber)] text-black'
                : 'bg-accent text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {v ? <Zap className="h-3 w-3" /> : <Sparkle className="h-3 w-3" />}
          {v ? 'Auto' : 'Manual'}
        </button>
      ))}
    </div>
  )
}

const SUGGESTIONS = [
  'A 9V battery lighting a bulb through a switch',
  'A mass on a spring, plot its velocity',
  'A voltage divider with two resistors',
  'A block sliding down a ramp with friction',
]

export function AiPanel({ pageId }: { pageId: string | null }) {
  const turns = useAiChat((s) => s.turns)
  const auto = useAiChat((s) => s.auto)
  const setAuto = useAiChat((s) => s.setAuto)
  const addTurn = useAiChat((s) => s.addTurn)
  const patchTurn = useAiChat((s) => s.patchTurn)
  const clear = useAiChat((s) => s.clear)

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Stop generating if the panel unmounts mid-request — otherwise the stream
  // keeps running and writes into a store nobody is showing.
  useEffect(() => () => abortRef.current?.abort(), [])

  /** Run a script onto the canvas, its (0,0) landing at `origin`'s top-left
   *  rather than guessing — callers that want the result CENTERED on the
   *  viewport pass an origin already offset by half the content's own size
   *  (see the onAdd handler below), the same convention insertAt() uses for
   *  a pasted image or dragged-in component. */
  const runScript = useCallback(
    (script: string, turnId: string, origin: { x: number; y: number }) => {
      if (!pageId) {
        toast.error('Open a page first.')
        return false
      }
      try {
        executeSimScript(pageId, script, origin)
      } catch (e) {
        // It passed the verifier, so this is a genuine surprise rather than a
        // known failure mode — say so instead of failing silently.
        toast.error(e instanceof Error ? e.message : 'Could not run the script.')
        return false
      }
      patchTurn(turnId, { added: true })
      return true
    },
    [pageId, patchTurn]
  )

  /** Build a real .pptx-kind page from an answer's blocks — the SAME
   *  SceneObject[]-per-slide shape AddPageDialog's own presentation
   *  templates use (lib/ai/slides.ts blocksToSlides -> addDocSheet +
   *  addObject, mirroring createPptx in add-page-dialog.tsx), so the result
   *  edits, exports and runs Present mode exactly like a hand-built deck.
   *  Lands as a sibling of the page currently open — "near where the user
   *  is working" — rather than needing a folder picker for every slide ask. */
  const makeSlides = useCallback(
    (turn: AiTurn) => {
      if (!turn.blocks?.length) return
      const ws = useWorkspaceStore.getState()
      const parentId = pageId ? ws.nodes[pageId]?.parentId : null
      if (!parentId) {
        toast.error('Open a notebook page first.')
        return
      }
      const id = ws.addPageIn(parentId, turn.prompt.slice(0, 60) || 'Untitled Presentation', 'pptx')
      const slides = blocksToSlides(turn.blocks, turn.prompt)
      for (const objects of slides) {
        const slideId = useWorkspaceStore.getState().addDocSheet(id)
        for (const obj of objects) useDocStore.getState().addObject(slideId, obj)
      }
      patchTurn(turn.id, { slidesMade: true })
      toast.success(`${slides.length} slide${slides.length === 1 ? '' : 's'} created.`)
    },
    [pageId, patchTurn]
  )

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim()
      if (!prompt || busy) return
      setInput('')
      setBusy(true)

      const turnId = addTurn({ prompt, script: '', status: 'streaming' })
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const page = pageId ? useDocStore.getState().pages[pageId] : undefined
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            prompt,
            stream: true,
            pageContext: page
              ? {
                  variables: page.variables.map((v) => ({ name: v.name, expr: v.expr })),
                  objectCount: Object.keys(page.objects).length,
                }
              : undefined,
          }),
        })
        const reader = res.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''
        let live = ''
        // Which lane the router picked, sent before the first token so prose
        // streams into the answer pane and script into the code pane — a
        // derivation shown in the SimScript highlighter reads as garbage.
        let lane: 'simulate' | 'explain' | 'both' = 'simulate'
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // SSE frames are blank-line separated; the tail may be partial.
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const evt = /^event:\s*(.+)$/m.exec(frame)?.[1]
            const raw = /^data:\s*([\s\S]*)$/m.exec(frame)?.[1]
            if (!evt || raw === undefined) continue
            if (evt === 'intent') {
              lane = JSON.parse(raw) as typeof lane
              patchTurn(turnId, { intent: lane })
            } else if (evt === 'token') {
              live += JSON.parse(raw) as string
              // Live text is a PREVIEW — unverified, never executed.
              patchTurn(turnId, lane === 'simulate' ? { script: live } : { answer: live })
            } else if (evt === 'done') {
              const data = JSON.parse(raw) as {
                message: string
                script?: string
                answer?: string
                blocks?: { kind: 'text' | 'formula'; content: string }[]
              }
              if (data.script || data.answer) {
                patchTurn(turnId, {
                  // Clear the streamed preview when this lane produced no
                  // script, or a half-written scene would linger on screen.
                  script: data.script ?? '',
                  answer: data.answer,
                  blocks: data.blocks,
                  message: data.message,
                  status: 'ok',
                })
                if (auto && data.script && pageId) runScript(data.script, turnId, viewportCenter(pageId))
              } else {
                patchTurn(turnId, { message: data.message, status: 'error' })
              }
            }
          }
        }
      } catch (e) {
        if (controller.signal.aborted) {
          patchTurn(turnId, { status: 'error', message: 'Stopped.' })
        } else {
          patchTurn(turnId, {
            status: 'error',
            message: e instanceof Error ? e.message : 'Request failed.',
          })
        }
      } finally {
        abortRef.current = null
        setBusy(false)
      }
    },
    [busy, addTurn, patchTurn, pageId, auto, runScript]
  )

  const empty = turns.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <BrainCircuit className="h-4 w-4 text-[var(--accent-violet)]" />
        <span className="flex-1 text-[0.8125rem] font-semibold">Assistant</span>
        <ModeToggle auto={auto} onChange={setAuto} />
        {!empty && (
          <button
            type="button"
            aria-label="Clear conversation"
            title="Clear conversation"
            onClick={clear}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Thread */}
      <div className="relative min-h-0 flex-1">
        <ChatContainerRoot className="h-full">
          <ChatContainerContent className="space-y-4 p-3">
            {empty ? (
              <div className="flex flex-col gap-3 pt-6">
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--accent-violet)_14%,transparent)]">
                    <BrainCircuit className="h-5 w-5 text-[var(--accent-violet)]" />
                  </div>
                  <p className="text-[0.8125rem] font-semibold">Describe a simulation</p>
                  <p className="max-w-[15rem] text-[0.71875rem] leading-relaxed text-muted-foreground">
                    It writes SimScript — the same language the Code IDE runs — so you can
                    read and edit anything it builds.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 pt-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 text-left text-[0.71875rem] text-muted-foreground transition-colors duration-150 hover:border-[var(--accent-violet)]/40 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              turns.map((t) => (
                <Turn
                  key={t.id}
                  turn={t}
                  // A written answer is placed as text/formula objects, via
                  // the SAME executeSimScript path a scene goes through — so
                  // the AI still cannot put anything on a page that a user
                  // could not have typed by hand.
                  // Two runs, not one joined script: the answer is a column
                  // of cards at the origin and the scene starts to its right,
                  // so a script that positions nothing can't land on top of
                  // the derivation it belongs to.
                  //
                  // Both runs are centered on the SAME point (the viewport's
                  // middle), each offset by half ITS OWN size — the general
                  // insertAt() convention (lib/scene/insertables.ts) every
                  // other "drop this on the canvas" action already uses.
                  // Previously the origin was the point itself (a fixed
                  // guess at the panel's width, +320/+240), which put the
                  // block's top-left corner — not its middle — under the
                  // cursor: everything landed visibly down-and-right of
                  // center, worse the wider the answer column got.
                  //
                  // The answer column additionally CLAMPS to the visible
                  // document boundary (viewportBounds), not just centered on
                  // a point — a long derivation is taller than the visible
                  // canvas, and centering alone pushes it past both the top
                  // AND bottom edges. Notes read top-to-bottom, so when it
                  // doesn't fit, anchoring the TOP at the boundary (rather
                  // than centering and losing the opening lines above the
                  // fold) keeps the start of the answer in view; horizontal
                  // stays centered either way since the column's fixed
                  // width almost always fits.
                  onAdd={() => {
                    if (!pageId) return
                    const answer = t.blocks?.length ? blocksToSimScript(t.blocks) : ''
                    const center = viewportCenter(pageId)
                    if (answer) {
                      const size = answerColumnSize(t.blocks!)
                      const bounds = viewportBounds(pageId)
                      const fitsVertically = size.h <= bounds.bottom - bounds.top
                      const origin = {
                        x: center.x - size.w / 2,
                        y: fitsVertically ? center.y - size.h / 2 : bounds.top + 24,
                      }
                      if (!runScript(answer, t.id, origin)) return
                      if (t.script) runScript(t.script, t.id, { x: origin.x + size.w + 80, y: origin.y })
                    } else if (t.script) {
                      runScript(t.script, t.id, center)
                    }
                  }}
                  onRetry={() => void send(t.prompt)}
                  onMakeSlides={t.blocks?.length ? () => makeSlides(t) : undefined}
                />
              ))
            )}
          </ChatContainerContent>
          <div className="pointer-events-none absolute bottom-2 left-0 right-0 flex justify-center">
            <ScrollButton className="pointer-events-auto shadow-md" />
          </div>
        </ChatContainerRoot>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/60 p-2">
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={busy}
          onSubmit={() => void send(input)}
          className="border-border/60 bg-card/60"
        >
          <PromptInputTextarea
            placeholder={auto ? 'Describe it — I’ll build it straight away' : 'Describe a simulation…'}
            className="text-[0.78125rem]"
          />
          <PromptInputActions className="justify-between pt-1.5">
            <span className="pl-1 text-[0.65625rem] text-muted-foreground">
              {auto ? 'Adds to canvas automatically' : 'You review before adding'}
            </span>
            <PromptInputAction tooltip={busy ? 'Stop' : 'Send'}>
              <Button
                size="icon-sm"
                className="rounded-full"
                disabled={!busy && !input.trim()}
                onClick={() => (busy ? abortRef.current?.abort() : void send(input))}
              >
                {busy ? <Square className="h-3 w-3 fill-current" /> : <BrainCircuit className="h-3.5 w-3.5" />}
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  )
}

/** A written answer: Markdown headings/lists plus `$…$` maths.
 *
 *  Deliberately a small renderer rather than react-markdown + rehype-katex:
 *  those were removed from this panel once already for bundle weight, and the
 *  answer format is a known, narrow subset — the same one the notebook's own
 *  text objects accept (BLOCK_PREFIX_RE in lib/text/marks.ts). */
function AnswerBlock({ source, streaming }: { source: string; streaming?: boolean }) {
  const html = useMemo(() => {
    const inline = (t: string) =>
      t
        // Maths first: its braces and backslashes must not be seen by the
        // bold/italic passes below.
        .replace(/\$([^$\n]+)\$/g, (_, e) => {
          try {
            return katex.renderToString(e, { throwOnError: false })
          } catch {
            return e as string
          }
        })
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1">$1</code>')

    return source
      .split('\n')
      .map((line) => {
        const h = /^(#{1,6})\s+(.*)$/.exec(line)
        if (h) {
          const size = h[1].length <= 2 ? 'text-[0.8125rem]' : 'text-[0.75rem]'
          return `<p class="${size} font-semibold mt-2 text-foreground">${inline(h[2])}</p>`
        }
        const li = /^\s*[-*+]\s+(.*)$/.exec(line)
        if (li) return `<p class="pl-3 -indent-2">• ${inline(li[1])}</p>`
        const ol = /^\s*(\d+)\.\s+(.*)$/.exec(line)
        if (ol) return `<p class="pl-4 -indent-4">${ol[1]}. ${inline(ol[2])}</p>`
        if (!line.trim()) return '<p class="h-1"></p>'
        return `<p>${inline(line)}</p>`
      })
      .join('')
  }, [source])

  return (
    <div
      className={cn(
        'space-y-0.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2',
        'text-[0.71875rem] leading-relaxed text-foreground/90',
        '[&_.katex]:text-[0.95em]',
        streaming && 'animate-in fade-in-0'
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function Turn({
  turn, onAdd, onRetry, onMakeSlides,
}: {
  turn: AiTurn
  onAdd: () => void
  onRetry: () => void
  /** Only set for a turn that has written blocks — a pure scene has nothing
   *  to put on a slide, so there's no button to show. */
  onMakeSlides?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const streaming = turn.status === 'streaming'

  return (
    <div className="space-y-2">
      {/* What was asked */}
      <Message className="justify-end">
        <MessageContent className="max-w-[85%] rounded-2xl rounded-br-md bg-[color-mix(in_oklch,var(--accent-violet)_16%,var(--card))] px-3 py-1.5 text-[0.75rem]">
          {turn.prompt}
        </MessageContent>
      </Message>

      {/* What came back */}
      <div className="space-y-1.5">
        {streaming && !turn.script && !turn.answer && (
          <div className="flex items-center gap-2 text-[0.71875rem] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Thinking&hellip;
          </div>
        )}

        {/* The written answer comes first: for a derivation or a numerical it
            IS the answer, and any scene is the supporting illustration. */}
        {turn.answer && <AnswerBlock source={turn.answer} streaming={streaming} />}

        {turn.script && <ScriptBlock source={turn.script} streaming={streaming} />}

        {turn.message && (
          <p
            className={cn(
              'text-[0.71875rem] leading-relaxed',
              turn.status === 'error' ? 'text-[var(--accent-rose)]' : 'text-muted-foreground'
            )}
          >
            {turn.message}
          </p>
        )}

        {turn.status === 'ok' && (turn.script || turn.blocks?.length) && (
          <div className="flex items-center gap-1.5 pt-0.5">
            {turn.added ? (
              <>
                <span className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] font-medium text-[var(--accent-mint)]">
                  <Check className="h-3 w-3" /> {turn.blocks?.length && !turn.script ? 'In notebook' : 'On canvas'}
                </span>
                {/* Placing once no longer blocks placing again — a diagram or
                    derivation you want in two spots (this page and another,
                    or twice on a wide board) shouldn't need a re-generate. */}
                <TurnAction label="Place again" onClick={onAdd}>
                  <Plus className="h-3 w-3" />
                </TurnAction>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 border-[var(--accent-mint)]/50 px-2 text-[0.6875rem] text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/10"
                onClick={onAdd}
              >
                <Plus className="h-3 w-3" /> {turn.blocks?.length && !turn.script ? 'Add to notebook' : 'Add to canvas'}
              </Button>
            )}
            <TurnAction
              label={copied ? 'Copied' : 'Copy script'}
              onClick={() => {
                void navigator.clipboard.writeText(turn.script)
                setCopied(true)
                setTimeout(() => setCopied(false), 1400)
              }}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </TurnAction>
            {/* Re-running the SAME prompt is the natural move when a scene is
                nearly right — the model is non-deterministic, so a second
                attempt is often better than describing the fix. */}
            <TurnAction label="Try again" onClick={onRetry}>
              <RotateCcw className="h-3 w-3" />
            </TurnAction>
            {/* A written answer (Given:/Derivation:/Result: headings) turns
                into an actual presentation — one Markdown heading per slide,
                the SAME real .pptx page a hand-picked template creates (see
                makeSlides in AiPanel). Never blocked by having built one
                already: a second click makes a fresh deck, same as
                "Place again" for the canvas. */}
            {onMakeSlides && (
              <TurnAction
                label={turn.slidesMade ? 'Make slides again' : 'Make slides'}
                onClick={onMakeSlides}
              >
                <PresentationIcon className="h-3 w-3" />
              </TurnAction>
            )}
          </div>
        )}

        {turn.status === 'error' && (
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[0.6875rem]" onClick={onRetry}>
            <RotateCcw className="h-3 w-3" /> Try again
          </Button>
        )}
      </div>
    </div>
  )
}

function TurnAction({
  label, onClick, children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}
