'use client'

// The main tutorial — a separate, single whole page, not an overlay over a
// real notebook (that's tutorial.tsx's TutorialPanel, which stays exactly
// as it is, for learning to build components on your OWN page). Nothing
// here is ever saved: this sandbox is local component state only, never
// touches useDocStore/useWorkspaceStore, and resets every time you land on
// the page.
//
// "Visual movie for deaf people": nothing is communicated by sound or
// spoken narration — every instruction is an on-screen caption, and every
// cue is motion (a pulsing ring, a fade) rather than audio. And rather than
// spotlighting controls on a page that's already fully built, elements
// don't exist yet — the next control only fades in once the current one has
// actually been used, so the whole toolbar assembles itself in front of you
// one piece at a time instead of arriving all at once.

import { useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Pen,
  Circle as CircleIcon,
  Type,
  MousePointer2,
  Play,
  Undo2,
  Check,
  ArrowRight,
} from 'lucide-react'
import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { cn } from '@/lib/utils'

type StageId = 'pen' | 'shape' | 'text' | 'move' | 'play' | 'undo'

const STAGES: { id: StageId; label: string; Icon: typeof Pen; caption: string }[] = [
  { id: 'pen', label: 'Pen', Icon: Pen, caption: 'Tap the pen, then draw anything in the box below.' },
  { id: 'shape', label: 'Circle', Icon: CircleIcon, caption: 'Tap Circle, then drag one out in the box.' },
  { id: 'text', label: 'Text', Icon: Type, caption: 'Tap Text, click the box, then type a word.' },
  { id: 'move', label: 'Select', Icon: MousePointer2, caption: 'Tap Select, then drag your circle somewhere else.' },
  { id: 'play', label: 'Play', Icon: Play, caption: 'Press Play — watch your circle react.' },
  { id: 'undo', label: 'Undo', Icon: Undo2, caption: 'Ctrl / Cmd + Z undoes the last thing. Try it now.' },
]

interface Vec {
  x: number
  y: number
}

function localPoint(el: HTMLElement, e: { clientX: number; clientY: number }): Vec {
  const r = el.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

/** The single control being taught right now — nothing else in its row
 *  exists yet. Pulses until tapped (armed), since a "silent movie" has no
 *  narration to point at it with. */
function StageButton({
  Icon,
  label,
  armed,
  onTap,
}: {
  Icon: typeof Pen
  label: string
  armed: boolean
  onTap: () => void
}) {
  return (
    <motion.button
      key={label}
      type="button"
      initial={{ opacity: 0, scale: 0.6, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', damping: 16, stiffness: 260 }}
      onClick={onTap}
      aria-label={label}
      className={cn(
        'relative flex flex-col items-center gap-1.5 rounded-2xl border px-6 py-4 text-[12px] font-semibold transition-colors',
        armed
          ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
          : 'border-border bg-card text-foreground hover:border-[var(--accent-blue)]/60'
      )}
    >
      {!armed && (
        <span className="absolute inset-0 animate-ping rounded-2xl border-2 border-[var(--accent-blue)] opacity-40" />
      )}
      <Icon className="h-6 w-6" />
      {label}
    </motion.button>
  )
}

/** The row of controls already learned — small, dimmed, checked off. This
 *  is the real toolbar assembling itself piece by piece. */
function LearnedRow({ stages }: { stages: typeof STAGES }) {
  if (stages.length === 0) return null
  return (
    <div className="flex items-center gap-2">
      {stages.map((s) => (
        <span
          key={s.id}
          className="flex items-center gap-1 rounded-full border border-[var(--accent-mint)]/40 bg-[var(--accent-mint)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--accent-mint)]"
        >
          <Check className="h-3 w-3" />
          <s.Icon className="h-3 w-3" />
          {s.label}
        </span>
      ))}
    </div>
  )
}

function Walkthrough() {
  const [stageIndex, setStageIndex] = useState(0)
  const [armed, setArmed] = useState(false)
  const sandboxRef = useRef<HTMLDivElement>(null)

  // Sandbox content — pure local state, never persisted.
  const [stroke, setStroke] = useState<Vec[] | null>(null)
  const [drawing, setDrawing] = useState<Vec[] | null>(null)
  const [circle, setCircle] = useState<{ cx: number; cy: number; r: number } | null>(null)
  const [dragCircleStart, setDragCircleStart] = useState<Vec | null>(null)
  const [note, setNote] = useState<{ x: number; y: number; value: string } | null>(null)
  const [editingNote, setEditingNote] = useState(false)
  const [moving, setMoving] = useState(false)
  const [fell, setFell] = useState(false)
  const [undone, setUndone] = useState(false)

  const stage = STAGES[stageIndex]
  const done = stageIndex >= STAGES.length

  const complete = () => {
    setArmed(false)
    setStageIndex((i) => i + 1)
  }

  const onSandboxPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!armed || !stage) return
    const el = sandboxRef.current
    if (!el) return
    const p = localPoint(el, e)
    if (stage.id === 'pen') {
      setDrawing([p])
    } else if (stage.id === 'shape') {
      setDragCircleStart(p)
    } else if (stage.id === 'text') {
      setNote({ x: p.x, y: p.y, value: '' })
      setEditingNote(true)
    } else if (stage.id === 'move' && circle) {
      const d = Math.hypot(p.x - circle.cx, p.y - circle.cy)
      if (d <= circle.r + 12) setMoving(true)
    }
  }

  const onSandboxPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = sandboxRef.current
    if (!el) return
    const p = localPoint(el, e)
    if (stage?.id === 'pen' && drawing) setDrawing((pts) => (pts ? [...pts, p] : pts))
    else if (stage?.id === 'shape' && dragCircleStart)
      setCircle({
        cx: dragCircleStart.x,
        cy: dragCircleStart.y,
        r: Math.max(12, Math.hypot(p.x - dragCircleStart.x, p.y - dragCircleStart.y)),
      })
    else if (stage?.id === 'move' && moving && circle) setCircle({ ...circle, cx: p.x, cy: p.y })
  }

  const onSandboxPointerUp = () => {
    if (!armed || !stage) return
    if (stage.id === 'pen' && drawing && drawing.length > 2) {
      setStroke(drawing)
      setDrawing(null)
      complete()
    } else if (stage.id === 'shape' && circle && circle.r > 14) {
      setDragCircleStart(null)
      complete()
    } else if (stage.id === 'move' && moving) {
      setMoving(false)
      complete()
    }
  }

  const learned = STAGES.slice(0, stageIndex)

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-4 py-6 text-center">
      <LearnedRow stages={learned} />

      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div
            key={stage.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-5"
          >
            {/* The caption track — every instruction is text, never audio. */}
            <p className="max-w-md text-[15px] font-medium leading-relaxed text-foreground">{stage.caption}</p>

            {stage.id === 'play' || stage.id === 'undo' ? (
              <StageButton
                Icon={stage.Icon}
                label={stage.label}
                armed={armed}
                onTap={() => {
                  if (stage.id === 'play') setFell(true)
                  if (stage.id === 'undo') setUndone(true)
                  setArmed(true)
                  window.setTimeout(complete, 500)
                }}
              />
            ) : (
              <StageButton Icon={stage.Icon} label={stage.label} armed={armed} onTap={() => setArmed(true)} />
            )}

            <div
              ref={sandboxRef}
              onPointerDown={onSandboxPointerDown}
              onPointerMove={onSandboxPointerMove}
              onPointerUp={onSandboxPointerUp}
              className={cn(
                'relative h-72 w-full touch-none select-none rounded-2xl border-2 border-dashed bg-card/40',
                armed ? 'border-[var(--accent-blue)]/50' : 'border-border'
              )}
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                {(stroke || drawing) && (
                  <polyline
                    points={(drawing ?? stroke ?? []).map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="var(--foreground)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {circle && (
                  <motion.circle
                    cx={circle.cx}
                    animate={{ cy: fell ? Math.min(circle.cy + 120, 260) : circle.cy }}
                    transition={{ type: 'spring', damping: 10, stiffness: 120 }}
                    r={circle.r}
                    fill="color-mix(in oklch, var(--accent-mint) 25%, transparent)"
                    stroke="var(--accent-mint)"
                    strokeWidth={2}
                  />
                )}
              </svg>
              {note &&
                (editingNote ? (
                  <input
                    autoFocus
                    value={note.value}
                    onChange={(e) => setNote({ ...note, value: e.target.value })}
                    onBlur={() => {
                      setEditingNote(false)
                      if (note.value.trim()) complete()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    className="absolute rounded-md border border-[var(--accent-blue)] bg-background px-1.5 py-0.5 text-[13px] outline-none"
                    style={{ left: note.x, top: note.y - 12 }}
                    placeholder="Type something…"
                  />
                ) : (
                  <span
                    className="absolute -translate-y-1/2 rounded-md bg-[var(--accent-amber)]/15 px-1.5 py-0.5 text-[13px] font-medium text-[var(--accent-amber)]"
                    style={{ left: note.x, top: note.y }}
                  >
                    {note.value}
                  </span>
                ))}
              {stage.id === 'move' && circle && !moving && (
                <span
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+14px)] text-[11px] text-muted-foreground"
                  style={{ left: circle.cx, top: circle.cy - circle.r }}
                >
                  drag me
                </span>
              )}
              {!armed && !stroke && !circle && !note && (
                <span className="absolute inset-0 flex items-center justify-center text-[12px] text-muted-foreground/50">
                  Nothing here yet
                </span>
              )}
              {stage.id === 'undo' && undone && (
                <span className="absolute inset-0 flex items-center justify-center text-[13px] font-medium text-[var(--accent-rose)]">
                  Undone!
                </span>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-4"
          >
            <p className="max-w-md text-[15px] font-medium leading-relaxed text-foreground">
              That's the core of SIMBLIP — draw, place, select, run, undo. Everything else in the real
              notebook is the same handful of moves applied to physics.
            </p>
            <Link
              href="/board"
              className="flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-[13.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open your notebook <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function TutorialWalkthroughPage() {
  return (
    <RequireAuth>
      <PageShell title="Learn SIMBLIP" backHref="/board">
        <Walkthrough />
      </PageShell>
    </RequireAuth>
  )
}
