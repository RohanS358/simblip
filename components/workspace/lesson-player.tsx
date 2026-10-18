'use client'

// Controls, captions and the prediction card for a playing lesson
// (lib/lesson). Bottom-centre so it never covers the figure it is narrating.

import { AnimatePresence, motion } from 'framer-motion'
import { Gauge, List, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useLesson } from '@/lib/lesson/store'
import { pauseLesson, resumeLesson, seekLesson, stopLesson } from '@/lib/lesson/controller'
import { durationOf } from '@/lib/lesson/storyboard'
import { useWalkthroughStore } from '@/lib/store/walkthrough-store'

const SPEEDS = [0.75, 1, 1.25, 1.5]

export function LessonPlayer() {
  const { active, storyboard, index, paused, caption, card, pending, chosen, set } = useLesson()
  const muted = useWalkthroughStore((s) => s.muted)
  const toggleMute = useWalkthroughStore((s) => s.toggleMute)
  const speed = useWalkthroughStore((s) => s.speed)
  const setSpeed = useWalkthroughStore((s) => s.setSpeed)
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
            className="pointer-events-none fixed inset-x-0 top-[22%] z-[104] flex justify-center px-6"
          >
            <div className="glass-strong rounded-3xl border border-border/60 px-10 py-7 text-center shadow-2xl">
              {card.sub && <p className="text-ui-xs font-bold uppercase tracking-wider text-muted-foreground">{card.sub}</p>}
              <h2 className="mt-1 text-2xl font-semibold text-foreground">{card.text}</h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-auto fixed bottom-6 left-1/2 z-[105] flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2.5">
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
            <p className="text-ui-lg font-medium leading-relaxed text-foreground">{caption}</p>
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
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive" title="Close lesson" onClick={stopLesson}><X className="h-4 w-4" /></Button>
        </div>
      </div>
    </>
  )
}
