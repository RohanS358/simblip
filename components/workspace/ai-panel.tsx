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
import { blocksToSlides, deckTitle } from '@/lib/ai/slides'
import { wantsSlides } from '@/lib/ai/route-intent'
import { placeAnswerAndScene } from '@/lib/ai/placement'
import { viewportBounds } from '@/lib/scene/insertables'
import {
  ArrowUp, AtSign, BrainCircuit, Check, Copy, History, Loader2, Paperclip, Plus, Presentation as PresentationIcon, RotateCcw, Sparkle, Square, SquarePen, Trash2, X, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { ChatContainerContent, ChatContainerRoot } from '@/components/ui/chat-container'
import { Message, MessageContent } from '@/components/ui/message'
import {
  PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea,
} from '@/components/ui/prompt-input'
import { ScrollButton } from '@/components/ui/scroll-button'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useDocStore } from '@/lib/store/document'
import { findPageMeta, useWorkspaceStore } from '@/lib/store/workspace'
import { executeSimScript } from '@/lib/scene/simscript'
import { tokenizeSimScript, type TokType } from '@/lib/scene/simscript-diagnostics'
import { useAiChat, type AiTurn, type ChatAttachment } from '@/lib/store/ai-chat'
import { ACCEPTED_TYPES, extractFileText, isSupported, withAttachments } from '@/lib/ai/attachments'
import { buildDigest, describeSurface } from '@/lib/ai/page-context'
import { verifyScene } from '@/lib/scene/verify-scene'
import type { PageDoc } from '@/lib/scene/types'
import { applyPlan } from '@/lib/ai/apply-ops'
import { describePlan, type EditPlan } from '@/lib/ai/edit-ops'
import {
  deleteSession, listSessions, loadSession, type AiSessionMeta,
} from '@/lib/store/ai-sessions'
import { cn } from '@/lib/utils'
import { PanelHeader, segmentedTab, segmentedTrack } from './panel-header'

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
        'overflow-x-auto rounded-lg border border-border/60 bg-[var(--card)] p-2.5 font-mono text-ui-xs leading-[1.6]',
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

/** Two states, one control. Wears the shared segmented-control recipe (see
 *  segmentedTrack/segmentedTab in panel-header.tsx) so it matches the Uploads
 *  filter rather than being a second, slightly-different toggle. */
function ModeToggle({ auto, onChange }: { auto: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={cn(segmentedTrack(2), 'w-fit')}>
      {([false, true] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={auto === v}
          title={v
            ? 'Auto — verified scripts are added to the canvas immediately'
            : 'Manual — review each script, then add it yourself'}
          onClick={() => onChange(v)}
          className={segmentedTab(auto === v)}
        >
          {v ? <Zap className="h-3 w-3" /> : <Sparkle className="h-3 w-3" />}
          {v ? 'Auto' : 'Manual'}
        </button>
      ))}
    </div>
  )
}

/** Stands in for the store's empty-string model — see the Select below. */
const DEFAULT_MODEL = '__default__'

const SUGGESTIONS = [
  'A 9V battery lighting a bulb through a switch',
  'A mass on a spring, plot its velocity',
  'A voltage divider with two resistors',
  'A block sliding down a ramp with friction',
]

/** Always-available actions under the composer, distinct from SUGGESTIONS
 *  above: those are full example prompts shown only on an empty thread, these
 *  are short verbs that stay reachable mid-conversation. Each is a prompt
 *  prefix the user can send as-is or keep typing after. */
const QUICK_ACTIONS = [
  { label: 'Explain this scene', prompt: 'Explain what this scene does, step by step.' },
  { label: 'Check the physics', prompt: 'Check this scene against real physics and list anything wrong.' },
  { label: 'Add a force', prompt: 'Add a force to this scene and show how it changes the motion.' },
  { label: 'Plot a quantity', prompt: 'Plot a useful quantity from this simulation over time.' },
]

/** "today" / "3d" / "2w" — enough to find a thread, short enough for a row. */
function relativeDay(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}

export function AiPanel({ pageId }: { pageId: string | null }) {
  const turns = useAiChat((s) => s.turns)
  const auto = useAiChat((s) => s.auto)
  const sessionTitle = useAiChat((s) => s.sessionTitle)
  const openSession = useAiChat((s) => s.openSession)
  const newSession = useAiChat((s) => s.newSession)
  const setAuto = useAiChat((s) => s.setAuto)
  const model = useAiChat((s) => s.model)
  const setModel = useAiChat((s) => s.setModel)
  // What the live backend offers — local Ollama models when one is running,
  // the OpenRouter catalogue when deployed. Fetched once per panel mount:
  // the list changes when a model is pulled, not while you are typing.
  const [models, setModels] = useState<{ backend: string; models: string[]; default: string }>({
    backend: '',
    models: [],
    default: '',
  })
  useEffect(() => {
    let alive = true
    void fetch('/api/ai/models')
      .then((r) => r.json())
      .then((d) => alive && setModels(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  const addTurn = useAiChat((s) => s.addTurn)
  const patchTurn = useAiChat((s) => s.patchTurn)
  const clear = useAiChat((s) => s.clear)

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [reading, setReading] = useState(false)
  /** What extraction is doing right now. Only OCR reports this — it is the
   *  one path that downloads ~7MB before it can read a character. */
  const [readPhase, setReadPhase] = useState('')
  const [sessions, setSessions] = useState<AiSessionMeta[] | null>(null)
  /** Is the page attached to the next prompt? On by default — the assistant
   *  being aware of what you are looking at is the point — but revocable, so
   *  it is never secretly reading the page. */
  const [useContext, setUseContext] = useState(true)
  const selection = useDocStore((s) => s.selection)
  const docPages = useDocStore((s) => s.pages)
  /** A slide, a doc sheet and a board constrain placement differently. */
  const pageKind = useWorkspaceStore(
    (s) => findPageMeta(s.nodes, s.activePageId)?.pageKind ?? 'board'
  )
  const pageObjectCount = useDocStore((s) =>
    pageId ? Object.keys(s.pages[pageId]?.objects ?? {}).length : 0
  )

  /** What the chip says, and what gets sent. A selection is more specific
   *  than the page, so it wins when there is one. */
  const contextLabel = useMemo(() => {
    if (!pageId || pageObjectCount === 0) return null
    if (selection.length > 0) {
      return `${selection.length} selected`
    }
    return `this page · ${pageObjectCount} object${pageObjectCount === 1 ? '' : 's'}`
  }, [pageId, pageObjectCount, selection.length])
  const fileRef = useRef<HTMLInputElement>(null)
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
        // Placement is decided by geometry, not by the model: the script's
        // coordinates are a layout, and this is where it actually goes.
        executeSimScript(pageId, script, origin, {
          bounds: viewportBounds(pageId),
          fixedFrame: pageKind === 'pptx' || pageKind === 'doc',
        })
      } catch (e) {
        // It passed the verifier, so this is a genuine surprise rather than a
        // known failure mode — say so instead of failing silently.
        toast.error(e instanceof Error ? e.message : 'Could not run the script.')
        return false
      }
      // Did it actually build something that WORKS? A script can pass every
      // static check and still leave a spring attached to nothing, which
      // looks right and does nothing on Play. Report it instead of letting
      // the user discover it by pressing Play.
      const built = useDocStore.getState().pages[pageId]
      if (built) {
        const report = verifyScene(Object.values(built.objects))
        const errors = report.issues.filter((i) => i.level === 'error')
        if (errors.length > 0) toast.warning(errors[0].message)
      }
      patchTurn(turnId, { added: true })
      return true
    },
    [pageId, patchTurn, pageKind]
  )

  /** Build a real .pptx-kind page from an answer's blocks — the SAME
   *  SceneObject[]-per-slide shape AddPageDialog's own presentation
   *  templates use (lib/ai/slides.ts blocksToSlides -> addDocSheet +
   *  addObject, mirroring createPptx in add-page-dialog.tsx), so the result
   *  edits, exports and runs Present mode exactly like a hand-built deck.
   *  Lands as a sibling of the page currently open — "near where the user
   *  is working" — rather than needing a folder picker for every slide ask. */
  const makeSlides = useCallback(
    (turn: Pick<AiTurn, 'id' | 'prompt' | 'blocks'>) => {
      if (!turn.blocks?.length) return
      const ws = useWorkspaceStore.getState()
      const parentId = pageId ? ws.nodes[pageId]?.parentId : null
      if (!parentId) {
        toast.error('Open a notebook page first.')
        return
      }
      // Name the page after the deck's subject, not the request: the raw
      // prompt showed up in the sidebar as "make me slides on different
      // states of matter and their related gr…".
      const markdown = turn.blocks.map((b) => b.content).join('\n\n')
      const id = ws.addPageIn(parentId, deckTitle(markdown, turn.prompt) || 'Untitled Presentation', 'pptx')
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

  /** Read dropped/picked files into text. Extraction is browser-side and can
   *  take a second for a large PDF or an OCR pass, so the composer shows a
   *  reading state rather than appearing to hang. */
  const attachFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(isSupported)
    if (list.length === 0) return
    setReading(true)
    setReadPhase('')
    try {
      const read = await Promise.all(
        list.map(async (f) => {
          const { text, warning } = await extractFileText(f, (phase, progress) =>
            setReadPhase(`${phase} ${Math.round(progress * 100)}%`)
          )
          return { name: f.name, text, warning } satisfies ChatAttachment
        })
      )
      setAttachments((prev) => [...prev, ...read])
      for (const a of read) if (a.warning) toast.warning(`${a.name}: ${a.warning}`)
    } finally {
      setReading(false)
    }
  }, [])

  /** Paste an image (or a file) straight into the composer.
   *
   *  A screenshot on the clipboard arrives as a File with an empty or generic
   *  name, which isSupported() would reject on extension — so name it from
   *  its MIME type before handing it on. This is the common path for a
   *  student: screenshot an exam question, paste, ask. */
  const pasteFiles = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files)
      if (files.length === 0) return
      e.preventDefault()
      const named = files.map((f) => {
        if (f.name && f.name.includes('.')) return f
        const ext = (f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')
        return new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type })
      })
      void attachFiles(named)
    },
    [attachFiles]
  )

  /** Apply a proposed edit after the user confirms.
   *
   *  The whole batch is one history entry (see lib/ai/apply-ops.ts), so a
   *  regretted edit is a single Ctrl+Z — which is what makes letting the
   *  assistant touch the page acceptable at all. */
  const applyEdit = useCallback(
    (turn: AiTurn) => {
      if (!pageId) {
        toast.error('Open a page first.')
        return
      }
      if (!turn.editPlan) return
      const result = applyPlan(pageId, turn.editPlan as EditPlan)
      if (!result.ok) {
        // Usually the page changed under the plan — an object it addressed
        // was deleted. Say so rather than applying a partial patch.
        toast.error(result.errors[0] ?? 'That edit no longer fits this page.')
        return
      }
      patchTurn(turn.id, { editApplied: true })
      toast.success(`Applied ${result.applied} change${result.applied === 1 ? '' : 's'}.`, {
        action: { label: 'Undo', onClick: () => useDocStore.getState().undo(pageId) },
      })
    },
    [pageId, patchTurn]
  )

  const refreshSessions = useCallback(async () => {
    setSessions(await listSessions())
  }, [])

  const resume = useCallback(
    async (id: string) => {
      const session = await loadSession(id)
      if (!session) return
      openSession(session)
      setSessions(null)
    },
    [openSession]
  )

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim()
      if (!prompt || busy) return
      setInput('')
      setBusy(true)

      // Attachments belong to THIS turn; clear them so the next prompt starts
      // clean rather than silently re-sending the same file.
      const sent = attachments
      setAttachments([])
      const turnId = addTurn({
        prompt,
        script: '',
        status: 'streaming',
        ...(sent.length > 0 ? { attachments: sent } : {}),
      })
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const page = pageId ? useDocStore.getState().pages[pageId] : undefined

        // The page the user is looking at, digested. Sent only when the
        // context chip is on — the toggle is what makes this visible rather
        // than the assistant silently reading their work.
        const ctx = (() => {
          if (!useContext || !page || !pageId) return null
          const sel = useDocStore.getState().selection
          const digest = buildDigest(page, sel)
          // The space to work in, even when the page is empty — an empty
          // board still has a viewport, and that is exactly when knowing it
          // matters most.
          const surface = describeSurface(
            { kind: pageKind, bounds: viewportBounds(pageId) },
            page
          )
          if (!digest.text && !surface) return null
          return {
            pageDigest: digest.text,
            pageSurface: surface,
            hasSelection: sel.length > 0,
            pageLabel: sel.length > 0 ? `${sel.length} selected object(s)` : 'the page you are on',
            // Ids and parameter NAMES only — enough to verify an edit plan
            // server-side, without shipping the document itself.
            pageObjects: Object.fromEntries(
              Object.values(page.objects).map((o) => [
                o.id,
                { kind: o.geometry.kind, params: Object.keys(o.parameters) },
              ])
            ),
          }
        })()
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            // The model sees the file contents folded in; the turn keeps the
            // user's own words, so the thread stays readable.
            prompt: withAttachments(prompt, sent),
            stream: true,
            ...(model ? { model } : {}),
            ...(ctx ?? {}),
            // What was said before, so "add a graph to that" resolves. Read
            // at send time rather than from the render closure: the turn we
            // just added is already in the store, and a stale closure would
            // silently drop the most recent exchange — the one a follow-up
            // almost always refers to. Only settled turns are useful context,
            // so the in-flight one (and any failure) is filtered out.
            history: useAiChat
              .getState()
              .turns.filter((t) => t.id !== turnId && t.status === 'ok')
              .map((t) => ({ prompt: t.prompt, answer: t.answer, script: t.script })),
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
                editPlan?: EditPlan
              }
              if (data.editPlan) {
                // A plan is a PROPOSAL. It is verified but not applied — the
                // user confirms it below, and applying re-verifies against
                // the page as it is at that moment.
                patchTurn(turnId, {
                  editPlan: data.editPlan,
                  message: data.message,
                  status: 'ok',
                })
              } else if (data.script || data.answer) {
                patchTurn(turnId, {
                  // Clear the streamed preview when this lane produced no
                  // script, or a half-written scene would linger on screen.
                  script: data.script ?? '',
                  answer: data.answer,
                  blocks: data.blocks,
                  message: data.message,
                  status: 'ok',
                })
                if (auto && data.script && pageId) {
                  // Same clamped placement as the Add button. This used to
                  // pass viewportCenter directly, which puts the scene's
                  // TOP-LEFT at the centre — so it always hung off the
                  // bottom-right, and off a slide entirely.
                  const spot = placeAnswerAndScene(null, true, viewportBounds(pageId)).scene
                  if (spot) runScript(data.script, turnId, spot)
                }
                // "Make me slides on X" asked for a deck, not for a button
                // that makes one — build it now. Gated on wantsSlides so an
                // ordinary derivation still just answers; the manual "Make
                // slides" action stays for turning any answer into a deck.
                if (data.blocks?.length && wantsSlides(prompt)) {
                  makeSlides({ id: turnId, prompt, blocks: data.blocks })
                }
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
    [busy, addTurn, patchTurn, pageId, auto, model, runScript, attachments, useContext]
  )

  const empty = turns.length === 0

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void attachFiles(e.dataTransfer.files)
      }}
      onPaste={pasteFiles}
    >
      <PanelHeader
        icon={BrainCircuit}
        title={sessionTitle || 'Assistant'}
        accent="var(--accent-violet)"
        actions={
          <>
            <button
              type="button"
              aria-label="Saved sessions"
              title="Saved sessions"
              onClick={() => (sessions ? setSessions(null) : void refreshSessions())}
              className="rounded p-1 text-muted-foreground transition-[color,transform] duration-150 ease-strong hover:text-foreground active:scale-90"
            >
              <History className="h-3.5 w-3.5" />
            </button>
            {!empty && (
              <button
                type="button"
                aria-label="New session"
                title="New session — the current one stays saved"
                onClick={newSession}
                className="rounded p-1 text-muted-foreground transition-[color,transform] duration-150 ease-strong hover:text-foreground active:scale-90"
              >
                <SquarePen className="h-3.5 w-3.5" />
              </button>
            )}
            {!empty && (
              <button
                type="button"
                aria-label="Clear conversation"
                title="Clear conversation"
                onClick={clear}
                className="rounded p-1 text-muted-foreground transition-[color,transform] duration-150 ease-strong hover:text-foreground active:scale-90"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        }
      />

      {/* Saved sessions. A panel rather than a dropdown: the list is the
          primary way back into old work, so it gets room to breathe. */}
      {sessions && (
        <div className="max-h-56 shrink-0 overflow-y-auto border-b border-border/60 bg-muted/30 p-1.5">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-center text-ui-xs text-muted-foreground">
              No saved sessions yet.
            </p>
          ) : (
            sessions.map((sn) => (
              <div key={sn.id} className="group flex items-center gap-1 rounded px-1 hover:bg-background/70">
                <button
                  type="button"
                  onClick={() => void resume(sn.id)}
                  className="flex-1 truncate py-1.5 text-left text-ui-xs"
                  title={sn.title}
                >
                  <span className="font-medium">{sn.title}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    {sn.turnCount} turn{sn.turnCount === 1 ? '' : 's'} · {relativeDay(sn.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete session ${sn.title}`}
                  onClick={async () => {
                    await deleteSession(sn.id)
                    void refreshSessions()
                  }}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Thread */}
      <div className="relative min-h-0 min-w-0 flex-1">
        <ChatContainerRoot className="h-full">
          <ChatContainerContent className="space-y-4 p-3">
            {empty ? (
              <div className="flex flex-col gap-3 pt-6">
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--accent-violet)_14%,transparent)]">
                    <BrainCircuit className="h-5 w-5 text-[var(--accent-violet)]" />
                  </div>
                  <p className="text-ui-md font-semibold">Describe a simulation</p>
                  <p className="max-w-[15rem] text-ui-xs leading-relaxed text-muted-foreground">
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
                      className="rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 text-left text-ui-xs text-muted-foreground transition-colors duration-150 hover:bg-accent/50 hover:text-foreground"
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
                  onApplyEdit={applyEdit}
                  onDiscardEdit={(turn) => patchTurn(turn.id, { editPlan: undefined })}
                  docPage={pageId ? docPages[pageId] : undefined}
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
                    // All the arithmetic lives in placeAnswerAndScene, which
                    // clamps to the page's real boundary — a slide's fixed
                    // 960x540, not the scrolled viewport. Placing the scene
                    // beside the answer (origin.x + column + 80) is what ran
                    // it off the right edge of a deck slide.
                    const answer = t.blocks?.length ? blocksToSimScript(t.blocks) : ''
                    const spots = placeAnswerAndScene(
                      answer ? answerColumnSize(t.blocks!) : null,
                      !!t.script,
                      viewportBounds(pageId)
                    )
                    if (answer && spots.answer) {
                      if (!runScript(answer, t.id, spots.answer)) return
                    }
                    if (t.script && spots.scene) runScript(t.script, t.id, spots.scene)
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
      <div className="min-w-0 shrink-0 border-t border-border/60 p-2">
        {/* Attached files. Text-only: the extracted words are what the model
            gets, so a chip shows the name and, when nothing could be read,
            says so instead of pretending the file was understood. */}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void attachFiles(e.target.files)
            e.target.value = '' // let the same file be picked again
          }}
        />
        {/* Header bar: what the next send will USE — which model answers and
            which mode it lands in. Both were below the box previously; they
            moved up here so the row under the composer is actions only, and
            the composer reads top-down as context → prompt → actions. */}
        {/* flex-wrap: the panel is user-resizable down to 200px, where a model
            name and a two-segment toggle cannot share a line — unwrapped, the
            toggle ran off the right edge. The Select takes the full row and
            the toggle drops beneath it instead. */}
        <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
          {models.models.length > 0 && (
            // The app's own Select, not a native <select>: a native one paints
            // the OS menu, which looks nothing like every other dropdown in
            // this workspace. Radix gives the same popover, ticks and hover
            // states as the account menu and Settings.
            // Radix reserves value="" for "cleared", so the store's own empty
            // string (meaning "whatever the backend defaults to") rides a
            // sentinel through the control and is mapped back on the way out.
            <Select
              value={model || DEFAULT_MODEL}
              onValueChange={(v) => setModel(v === DEFAULT_MODEL ? '' : v)}
            >
              <SelectTrigger
                size="sm"
                aria-label="Model"
                title={`Which model answers — running ${models.backend === 'ollama' ? 'locally' : 'on OpenRouter'}`}
                className="min-w-0 max-w-[11rem] flex-1 text-ui-xs font-medium"
              >
                <SelectValue placeholder={models.default} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL} className="text-ui-xs">
                  {models.default}
                </SelectItem>
                {models.models.map((m) => (
                  <SelectItem key={m} value={m} className="text-ui-xs">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="shrink-0">
            <ModeToggle auto={auto} onChange={setAuto} />
          </div>
          {/* Kept visible, not just a tooltip on the toggle: this is the one
              piece of state that decides whether a send mutates the canvas. */}
          
        </div>
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={busy}
          onSubmit={() => void send(input)}
          className="border-border/60 bg-card/60"
        >
          <PromptInputTextarea
            placeholder={auto ? 'Describe it — I’ll build it straight away' : 'Describe a simulation…'}
            className="text-ui-sm"
          />
          <PromptInputActions className="justify-between gap-1.5 pt-1.5">
            {/* What the assistant can see: auto-attached from the page or
                selection and revocable — the toggle is why this is transparent
                rather than the assistant silently reading your work.

                Attach button and what IS attached read as one unit, on one
                line. These chips used to stack ABOVE the composer, pushing the
                text area down a row for every context or file, and putting the
                evidence a long way from the control that produced it. */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <PromptInputAction tooltip="Attach a PDF, slide deck, document, sheet or image">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 rounded-full transition-transform duration-150 ease-strong active:scale-90"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </Button>
              </PromptInputAction>
              {/* Scrolls rather than wraps: a wrapping row would grow the
                  composer's height again, which is what this move fixed. */}
              <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {contextLabel && (
                  <button
                    type="button"
                    onClick={() => setUseContext((v) => !v)}
                    title={useContext ? 'Attached — click to detach' : 'Detached — click to attach'}
                    className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-ui-2xs transition-colors ${
                      useContext
                        ? 'bg-[color-mix(in_oklch,var(--accent-violet)_10%,transparent)] text-foreground'
                        : 'text-muted-foreground line-through'
                    }`}
                  >
                    <AtSign className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{contextLabel}</span>
                  </button>
                )}
        {(attachments.length > 0 || reading) && (
                  <div className="flex min-w-0 items-center gap-1">
                    {attachments.map((a, i) => (
                      <span
                        key={`${a.name}-${i}`}
                        title={a.warning ?? `${a.text.length} characters read`}
                        className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-ui-2xs ${
                          a.warning
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-muted-foreground'
                        }`}
                      >
                        <Paperclip className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{a.name}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${a.name}`}
                          onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                          className="shrink-0 hover:text-foreground"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                    {reading && (
                      <span className="inline-flex items-center gap-1 text-ui-2xs text-muted-foreground">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" /> {readPhase || 'Reading…'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <PromptInputAction tooltip={busy ? 'Stop' : 'Send'}>
              <Button
                size="icon-sm"
                className="rounded-full transition-transform duration-150 ease-strong active:scale-90"
                disabled={!busy && !input.trim() && attachments.length === 0}
                onClick={() => (busy ? abortRef.current?.abort() : void send(input))}
              >
                {busy ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
        {/* Quick actions sit UNDER the composer and stay put mid-conversation —
            SUGGESTIONS above only ever show on an empty thread. Clicking one
            fills the box rather than sending, so the prompt can be edited
            first; that's the difference between a shortcut and a trapdoor. */}
        {/* One scrolling line, not a wrapping block: four labels wrapped to two
            rows and cost the conversation twice the vertical space these
            shortcuts are worth. Borderless too — four outlined pills under an
            outlined composer read as another control surface rather than as
            the quiet suggestions they are. */}
        <div className="no-scrollbar -mx-0.5 mt-1.5 flex items-center gap-1 overflow-x-auto px-0.5">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              type="button"
              disabled={busy}
              onClick={() => setInput(a.prompt)}
              className="shrink-0 whitespace-nowrap rounded-full px-2 py-[3px] text-ui-2xs text-muted-foreground transition-[color,background-color,transform] duration-150 ease-strong hover:bg-accent/60 hover:text-foreground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
        </div>
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
        .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 font-mono text-[0.9em]">$1</code>')

    return source
      .split('\n')
      .map((line) => {
        const h = /^(#{1,6})\s+(.*)$/.exec(line)
        if (h) {
          const size = h[1].length <= 2 ? 'text-ui-md' : 'text-ui-sm'
          return `<p class="${size} font-semibold text-foreground">${inline(h[2])}</p>`
        }
        const li = /^\s*[-*+]\s+(.*)$/.exec(line)
        if (li)
          return `<p class="flex gap-2"><span class="select-none text-muted-foreground">•</span><span class="min-w-0 flex-1">${inline(li[1])}</span></p>`
        const ol = /^\s*(\d+)\.\s+(.*)$/.exec(line)
        if (ol)
          return `<p class="flex gap-2"><span class="select-none tabular-nums text-muted-foreground">${ol[1]}.</span><span class="min-w-0 flex-1">${inline(ol[2])}</span></p>`
        if (!line.trim()) return '<p class="h-2"></p>'
        return `<p>${inline(line)}</p>`
      })
      .join('')
  }, [source])

  return (
    // No card, no border, no tinted background. The answer is the assistant
    // SPEAKING — it should read as prose on the panel, the way every modern
    // chat renders a reply, not as one more boxed control in a workspace full
    // of them. The user's own message keeps its bubble (see Turn below), which
    // is what makes the two sides distinguishable without giving both chrome.
    //
    // Chrome stays only where it carries meaning: a ScriptBlock is code and is
    // still boxed, because that block is a thing you copy and run.
    <div
      className={cn(
        'space-y-1 text-ui-sm leading-[1.65] text-foreground',
        '[&_.katex]:text-[0.95em]',
        // Headings get air above them, but never before the first line.
        '[&>p.font-semibold]:mt-3 [&>p.font-semibold:first-child]:mt-0',
        streaming && 'animate-in fade-in-0'
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function Turn({
  turn, onAdd, onRetry, onMakeSlides, onApplyEdit, onDiscardEdit, docPage,
}: {
  turn: AiTurn
  onAdd: () => void
  onRetry: () => void
  /** Only set for a turn that has written blocks — a pure scene has nothing
   *  to put on a slide, so there's no button to show. */
  onMakeSlides?: () => void
  onApplyEdit: (turn: AiTurn) => void
  onDiscardEdit: (turn: AiTurn) => void
  /** The live page, so an op's object id renders as that object's name. */
  docPage: PageDoc | undefined
}) {
  const [copied, setCopied] = useState(false)
  const streaming = turn.status === 'streaming'

  return (
    // min-w-0: the answer holds a <pre> that scrolls itself, but a flex/grid
    // child defaults to min-width:auto and would size to its widest line
    // instead — pushing the whole thread wider than the panel.
    <div className="min-w-0 space-y-2">
      {/* What was asked */}
      <Message className="justify-end">
        <MessageContent className="max-w-[85%] rounded-2xl rounded-br-md bg-[color-mix(in_oklch,var(--accent-violet)_16%,var(--card))] px-3 py-1.5 text-ui-sm">
          {turn.attachments && turn.attachments.length > 0 && (
            <span className="mb-1 flex flex-wrap gap-1">
              {turn.attachments.map((a, i) => (
                <span
                  key={`${a.name}-${i}`}
                  title={a.warning ?? undefined}
                  className="inline-flex items-center gap-1 rounded-full bg-background/50 px-1.5 py-0.5 text-ui-2xs"
                >
                  <Paperclip className="h-2 w-2" />
                  {a.name}
                </span>
              ))}
            </span>
          )}
          {turn.prompt}
        </MessageContent>
      </Message>

      {/* What came back */}
      <div className="min-w-0 space-y-1.5">
        {/* A proposed edit to the page. Shown as plain language, never
            applied until confirmed — and one Ctrl+Z reverses the whole
            batch once it is. */}
        {turn.editPlan && (
          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
            <p className="mb-1 text-ui-xs font-medium">{turn.editPlan.summary}</p>
            <ul className="mb-2 space-y-0.5">
              {describePlan(turn.editPlan as EditPlan, docPage).map((line, i) => (
                <li key={i} className="flex gap-1.5 text-ui-xs text-muted-foreground">
                  <span className="text-[var(--accent-violet)]">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {turn.editApplied ? (
              <span className="inline-flex items-center gap-1 text-ui-xs text-muted-foreground">
                <Check className="h-3 w-3" /> Applied
              </span>
            ) : (
              <div className="flex gap-1.5">
                <Button size="sm" className="h-6 px-2 text-ui-xs" onClick={() => onApplyEdit(turn)}>
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-ui-xs"
                  onClick={() => onDiscardEdit(turn)}
                >
                  Discard
                </Button>
              </div>
            )}
          </div>
        )}
        {streaming && !turn.script && !turn.answer && (
          <div className="flex items-center gap-2 text-ui-xs text-muted-foreground">
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
              'text-ui-xs leading-relaxed',
              turn.status === 'error' ? 'text-[var(--accent-rose)]' : 'text-muted-foreground'
            )}
          >
            {turn.message}
          </p>
        )}

        {turn.status === 'ok' && (turn.script || turn.blocks?.length) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {turn.added ? (
              <>
                <span className="flex items-center gap-1 rounded-md px-1.5 py-1 text-ui-xs font-medium text-[var(--accent-mint)]">
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
                className="h-6 gap-1 border-[var(--accent-mint)]/50 px-2 text-ui-xs text-[var(--accent-mint)] hover:bg-[var(--accent-mint)]/10"
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
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-ui-xs" onClick={onRetry}>
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
      className="rounded-md p-1 text-muted-foreground transition-[color,background-color,transform] duration-150 ease-strong hover:bg-accent hover:text-foreground active:scale-90"
    >
      {children}
    </button>
  )
}
