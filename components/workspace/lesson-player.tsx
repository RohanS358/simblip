'use client'

// Controls, captions and the prediction card for a playing lesson
// (lib/lesson). Bottom-centre so it never covers the figure it is narrating.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Gauge, HelpCircle, List, MessageCircleQuestion, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useLesson } from '@/lib/lesson/store'
import { cancelPreparing } from '@/lib/lesson/generate'
import { pauseLesson, resumeLesson, seekLesson, stopLesson } from '@/lib/lesson/controller'
import { durationOf } from '@/lib/lesson/storyboard'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'
import { useTutor } from '@/lib/lesson/tutor-store'
import { askQuestion } from '@/lib/lesson/tutor'
import { continueLesson } from '@/lib/lesson/controller'
import { visibleBoard } from '@/lib/lesson/camera'
import { StudyNotes } from './study-notes'
import { Teacher } from './teacher'
import { CircleToAsk, ExplainRing, SectionStrip, TutorReplies } from './lesson-tutor-ui'

const SPEEDS = [0.75, 1, 1.25, 1.5]
/** The floating tool dock sits along the bottom of the canvas; the lesson controls ride above it. */
const DOCK_CLEARANCE = 76
/** She stands at the board's bottom-right, facing left towards the board; lifted clear of the zoom control. */
const TEACHER_LIFT = 40
const teacherHeight = (r: { height: number }) => Math.max(150, Math.min(280, r.height * 0.38))
const teacherWidth = (r: { height: number }) => (teacherHeight(r) * 560) / 770 * 0.62

interface Rect { left: number; top: number; width: number; height: number }

/** The whiteboard's own rectangle — the player belongs to the board, not to the whole window,
 *  so it never covers the sidebar, the assistant panel or the page tabs. */
function useCanvasRect(): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  useEffect(() => {
    const read = () => {
      const next = visibleBoard()
      setRect((cur) => (cur && next && cur.left === next.left && cur.top === next.top && cur.width === next.width && cur.height === next.height ? cur : next))
    }
    read()
    const iv = setInterval(read, 400) // panels open and close without any event we can hear
    window.addEventListener('resize', read)
    return () => { clearInterval(iv); window.removeEventListener('resize', read) }
  }, [])
  return rect
}

/** Bottom-centre of the canvas (or of the window when there is no canvas, e.g. a doc page). */
function Anchor({ rect, children, className }: { rect: Rect | null; children: ReactNode; className?: string }) {
  // The caption and controls sit in the space left of the teacher, centred there.
  const room = rect ? rect.width - (rect.width > 760 ? teacherWidth(rect) + 24 : 0) : 0
  const style: CSSProperties = rect
    ? { left: rect.left + room / 2, bottom: window.innerHeight - (rect.top + rect.height) + DOCK_CLEARANCE, width: Math.min(640, room - 32) }
    : { left: '50%', bottom: 24, width: 'min(640px, calc(100vw - 32px))' }
  return <div style={style} className={cn('pointer-events-auto fixed z-[105] flex -translate-x-1/2 flex-col gap-2.5', className)}>{children}</div>
}

/** The caption writes itself out as the voice speaks. The unspoken part keeps its space (so the
 *  box does not jump) but is invisible; a caret marks the pen. */
function Typed({ text, spoken }: { text: string; spoken: number }) {
  const n = Math.max(0, Math.min(text.length, spoken))
  return (
    <p className="text-ui-lg font-medium leading-relaxed text-foreground">
      <span>{text.slice(0, n)}</span>
      {n < text.length && <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse bg-[var(--accent-blue)]" aria-hidden />}
      <span className="opacity-0" aria-hidden>{text.slice(n)}</span>
      <span className="sr-only">{text}</span>
    </p>
  )
}

export function LessonPlayer() {
  const { active, storyboard, index, paused, caption, spoken, card, pending, chosen, preparing, set } = useLesson()
  const rect = useCanvasRect()
  const tutorMode = useTutor((s) => s.mode)
  const muted = useWalkthroughStore((s) => s.muted)
  const toggleMute = useWalkthroughStore((s) => s.toggleMute)
  const speed = useWalkthroughStore((s) => s.speed)
  const setSpeed = useWalkthroughStore((s) => s.setSpeed)
  if (preparing && !active) {
    return (
      <Anchor rect={rect}>
      <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/90 p-3 shadow-2xl backdrop-blur">
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-sm font-medium text-foreground">Building a lesson on “{preparing.topic}”</p>
          <p className="truncate text-ui-xs text-muted-foreground">{preparing.message}</p>
        </div>
        <Button size="sm" variant="ghost" className="h-8 px-2.5 text-ui-xs" onClick={cancelPreparing}>Cancel</Button>
      </div>
      </Anchor>
    )
  }
  if (!active || !storyboard) return null

  const total = storyboard.beats.length
  const chapters = storyboard.beats.map((b, i) => ({ b, i })).filter((x) => x.b.t === 'title') as { b: { t: 'title'; text: string }; i: number }[]
  const here = [...chapters].reverse().find((c) => c.i <= index)
  const mins = Math.max(1, Math.round(durationOf(storyboard) / 60))

  return (
    <>
      <AnimatePresence>
        {card && (
          <motion.div
            key={card.text}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed z-[104] flex justify-center px-6"
            style={rect ? { left: rect.left, width: rect.width, top: rect.top + rect.height * 0.2 } : { left: 0, right: 0, top: '22%' }}
          >
            <div className="glass-strong rounded-3xl border border-border/60 px-10 py-7 text-center shadow-2xl">
              {card.sub && <p className="text-ui-xs font-bold uppercase tracking-wider text-muted-foreground">{card.sub}</p>}
              <h2 className="mt-1 text-2xl font-semibold text-foreground">{card.text}</h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <StudyNotes />
      <CircleToAsk rect={rect} />
      <ExplainRing />
      {rect && (
        <div className="pointer-events-none fixed z-[103]" style={{ right: window.innerWidth - (rect.left + rect.width) + 8, bottom: window.innerHeight - (rect.top + rect.height) + TEACHER_LIFT }}>
          <Teacher height={teacherHeight(rect)} />
        </div>
      )}

      <Anchor rect={rect}>
        <SectionStrip />
        <TutorReplies />
        {pending && (
          <div role="group" aria-label="Prediction" className="glass-strong rounded-2xl border border-border/60 p-3.5 shadow-2xl">
            <p className="text-ui-xs font-bold uppercase tracking-wider text-[var(--accent-blue)]">Predict first</p>
            <p className="mt-1 text-ui-md font-medium text-foreground">{pending.prompt}</p>
            <div className="mt-2.5 grid gap-1.5">
              {pending.choices.map((c, i) => (
                <Button
                  key={i}
                  variant="outline"
                  disabled={chosen !== null}
                  onClick={() => set({ chosen: i })}
                  className={cn('h-auto justify-start whitespace-normal px-3 py-2 text-left text-ui-sm', chosen === i && 'border-[var(--accent-blue)]')}
                >
                  {c}
                </Button>
              ))}
            </div>
          </div>
        )}

        {caption && !pending && (
          <div aria-live="polite" className="glass-strong rounded-2xl border border-border/60 px-4 py-3 shadow-2xl">
            <Typed text={caption} spoken={spoken} />
          </div>
        )}

        <div className="glass-strong flex items-center gap-1.5 rounded-2xl border border-border/60 p-2 shadow-2xl">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 max-w-[44%] gap-1.5 px-2.5 text-ui-xs font-semibold" title="Chapters">
                <List className="h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
                <span className="truncate">{here?.b.text ?? storyboard.title}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
              {chapters.map((c) => (
                <DropdownMenuItem key={c.i} onClick={() => seekLesson(c.i)} className={cn('py-2 text-ui-xs', c === here && 'font-bold text-[var(--accent-blue)]')}>
                  <span className="truncate">{c.b.text}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="mx-1 h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-accent/60" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index + 1} aria-label={`Lesson progress, about ${mins} minutes long`}>
            <div className="h-full rounded-full bg-[var(--accent-blue)] transition-[width] duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>

          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Previous" onClick={() => seekLesson(index - 1)}><SkipBack className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={paused ? 'Play' : 'Pause'} onClick={() => (paused ? resumeLesson() : pauseLesson())}>
            {paused ? <Play className="h-4 w-4 fill-current text-[var(--accent-blue)]" /> : <Pause className="h-4 w-4" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Next" onClick={() => seekLesson(index + 1)}><SkipForward className="h-4 w-4" /></Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-ui-xs font-semibold" title="Speed"><Gauge className="h-3.5 w-3.5 text-[var(--accent-blue)]" />{speed}x</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-24 min-w-0">
              {SPEEDS.map((s) => <DropdownMenuItem key={s} onClick={() => setSpeed(s)} className={cn('justify-center py-1.5 text-ui-xs', s === speed && 'font-bold text-[var(--accent-blue)]')}>{s}x</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={muted ? 'Unmute narration' : 'Mute narration'} onClick={toggleMute}>
            {muted ? <VolumeX className="h-4 w-4 text-muted-foreground" /> : <Volume2 className="h-4 w-4 text-[var(--accent-blue)]" />}
          </Button>
          <Button size="sm" variant={tutorMode === 'selecting' ? 'default' : 'ghost'} className="h-8 gap-1 px-2 text-ui-xs font-semibold" title="Circle something on the board and the teacher explains it" onClick={() => useTutor.getState().set({ mode: tutorMode === 'selecting' ? 'idle' : 'selecting' })}>
            <HelpCircle className="h-4 w-4 text-[var(--accent-blue)]" />Ask
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Study notes — read, print or save as PDF" onClick={() => set({ notesOpen: true })}><FileText className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Type a question for the teacher" onClick={() => void askQuestion(continueLesson)}><MessageCircleQuestion className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive" title="Close lesson" onClick={stopLesson}><X className="h-4 w-4" /></Button>
        </div>
      </Anchor>
    </>
  )
}
