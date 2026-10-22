'use client'

// The student's side of talking to the teacher: circle something to ask about it, answer her
// check-ins, type a question, and jump back to any earlier section of the board.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLesson } from '@/lib/lesson/store'
import { frameObjects } from '@/lib/lesson/camera'
import { continueLesson } from '@/lib/lesson/controller'
import { answerChip, askAbout, submitQuestion } from '@/lib/lesson/tutor'
import { getElement } from '@/lib/physics/world'
import { useTutor, type Ring } from '@/lib/lesson/tutor-store'

interface Rect { left: number; top: number; width: number; height: number }
type Pt = { x: number; y: number }

/** Draw a loop round part of the board. A tap (almost no movement) means "this one, here". */
export function CircleToAsk({ rect }: { rect: Rect | null }) {
  const mode = useTutor((s) => s.mode)
  const [pts, setPts] = useState<Pt[]>([])
  const down = useRef(false)

  useEffect(() => {
    if (mode !== 'selecting') return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') useTutor.getState().set({ mode: 'idle' }) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [mode])

  if (mode !== 'selecting' || !rect) return null

  const finish = (path: Pt[]) => {
    down.current = false
    setPts([])
    if (path.length < 2) return
    const xs = path.map((p) => p.x), ys = path.map((p) => p.y)
    let r: Ring = { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    if (r.width < 24 && r.height < 24) r = { left: r.left - 28, top: r.top - 28, width: 56, height: 56 } // a tap
    useTutor.getState().set({ mode: 'thinking' })
    void askAbout(r, continueLesson)
  }
  const at = (e: React.PointerEvent): Pt => ({ x: e.clientX, y: e.clientY })

  return (
    <div
      className="fixed z-[106] cursor-crosshair touch-none"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); down.current = true; setPts([at(e)]) }}
      onPointerMove={(e) => { if (down.current) setPts((p) => [...p, at(e)]) }}
      onPointerUp={() => finish(pts)}
    >
      <div className="pointer-events-none absolute inset-0 bg-[var(--accent-blue)]/5" />
      <p className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full border border-border/60 bg-card/95 px-4 py-2 text-ui-sm font-medium shadow-xl">
        Circle the part you want me to explain — or just tap it. <span className="text-muted-foreground">Esc to cancel</span>
      </p>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {pts.length > 1 && (
          <polyline points={pts.map((p) => `${p.x - rect.left},${p.y - rect.top}`).join(' ')} fill="none" stroke="var(--accent-blue)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </div>
  )
}

/** The ring round whatever she is explaining. */
export function ExplainRing() {
  const ring = useTutor((s) => s.ring)
  if (!ring) return null
  return (
    <motion.div
      key={`${Math.round(ring.left)}-${Math.round(ring.top)}`}
      initial={{ opacity: 0, scale: 1.08 }}
      animate={{ opacity: 1, scale: 1 }}
      className="pointer-events-none fixed z-[103] rounded-2xl border-[3px] border-[var(--accent-blue)] shadow-[0_0_0_6px_color-mix(in_oklch,var(--accent-blue)_18%,transparent)]"
      style={{ left: ring.left, top: ring.top, width: ring.width, height: ring.height }}
    />
  )
}

/** Answers to whatever she just asked, and the box for a typed question. */
export function TutorReplies() {
  const chips = useTutor((s) => s.chips)
  const typing = useTutor((s) => s.typing)
  const [text, setText] = useState('')
  if (typing) {
    return (
      <form
        className="glass-strong flex items-center gap-2 rounded-2xl border border-border/60 p-2 shadow-2xl"
        onSubmit={(e) => { e.preventDefault(); submitQuestion(text); setText('') }}
      >
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your question…"
          className="min-w-0 flex-1 bg-transparent px-2 text-ui-md outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" className="h-8 px-3 text-ui-xs" disabled={!text.trim()}>Ask</Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2.5 text-ui-xs" onClick={() => submitQuestion('')}>Never mind</Button>
      </form>
    )
  }
  if (!chips.length) return null
  return (
    <div role="group" aria-label="Your answer" className="flex flex-wrap gap-2">
      {chips.map((c, i) => (
        <Button key={c.id} variant={i === 0 ? 'default' : 'outline'} size="sm" onClick={() => answerChip(c.id)} className="h-9 rounded-full px-4 text-ui-sm font-semibold shadow-lg">
          {c.label}
        </Button>
      ))}
    </div>
  )
}

/** One chip per section of the board, in order. Tap one and the camera slides back to it. */
export function SectionStrip() {
  const sections = useLesson((s) => s.sections)
  const pageId = useLesson((s) => s.pageId)
  const ref = useRef<HTMLElement>(null)
  // The newest section is the one being taught: keep it in view as the strip grows past the board's width.
  useEffect(() => { ref.current?.lastElementChild?.scrollIntoView({ inline: 'end', block: 'nearest', behavior: 'smooth' }) }, [sections.length])
  if (sections.length < 2 || !pageId) return null
  return (
    <nav
      ref={ref}
      aria-label="Sections of this lesson"
      // Scrolls sideways with no scrollbar; the faded edges say "there is more this way" instead of a hard cut.
      className="no-scrollbar flex gap-1.5 overflow-x-auto px-1 pb-0.5 pr-6"
      style={{ maskImage: 'linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 28px), transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 28px), transparent 100%)' }}
    >
      {sections.map((s, i) => {
        const last = i === sections.length - 1
        return (
          <button
            key={s.id}
            type="button"
            title={`Go back to: ${s.title}`}
            onClick={() => void frameObjects(pageId, s.ids)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-ui-xs font-semibold shadow-md backdrop-blur transition-colors',
              last ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-primary-foreground' : 'border-border/60 bg-card/90 text-foreground hover:bg-accent'
            )}
          >
            <span className="tabular-nums opacity-70">{i + 1}</span>
            <span className="max-w-[10rem] truncate">{s.title}</span>
          </button>
        )
      })}
    </nav>
  )
}


/** Whatever the teacher is pointing at glows: a pulsing amber ring that follows the object as the camera moves. */
export function PointerSpot() {
  const spot = useTutor((s) => s.spot)
  const [rects, setRects] = useState<Rect[]>([])

  useEffect(() => {
    if (!spot.length) { setRects([]); return }
    let raf = 0
    const tick = () => {
      const next = spot.flatMap((id) => {
        const b = getElement(id)?.getBoundingClientRect()
        return b && b.width > 4 ? [{ left: b.left, top: b.top, width: b.width, height: b.height }] : []
      })
      // only touch React state when something actually moved
      setRects((cur) => (cur.length === next.length && cur.every((r, i) => Math.abs(r.left - next[i].left) < 0.5 && Math.abs(r.top - next[i].top) < 0.5 && Math.abs(r.width - next[i].width) < 0.5 && Math.abs(r.height - next[i].height) < 0.5) ? cur : next))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [spot])

  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          aria-hidden
          className="lesson-spot pointer-events-none fixed z-[103] rounded-2xl"
          style={{ left: r.left - 8, top: r.top - 8, width: r.width + 16, height: r.height + 16 }}
        />
      ))}
    </>
  )
}
