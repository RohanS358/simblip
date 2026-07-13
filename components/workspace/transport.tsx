'use client'

// Unity-style transport: Edit → Play → Pause → Step → Reset.
// Nothing is regenerated — the exact drawn scene starts simulating.

import { Play, Pause, StepBack, StepForward, RotateCcw } from 'lucide-react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useRuntimeStore, play, pause, stepFrame, stepBack, stop } from '@/lib/physics/world'
import { cn } from '@/lib/utils'

export function Transport({ pageId }: { pageId: string }) {
  const motion = useSpring()
  const mode = useRuntimeStore((s) => s.mode)
  const time = useRuntimeStore((s) => s.time)

  return (
    <fm.div
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={motion}
      className={cn(
        'glass-strong absolute left-1/2 top-4 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl p-1.5 transition-shadow',
        mode !== 'edit' && 'shadow-[0_0_0_1.5px_var(--accent-mint)]'
      )}
      aria-label="Simulation transport"
    >
      <button
        type="button"
        aria-label={mode === 'running' ? 'Pause' : 'Play'}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-xl transition-colors',
          mode === 'running'
            ? 'bg-[var(--accent-mint)] text-primary-foreground'
            : 'text-[var(--accent-mint)] hover:bg-accent'
        )}
        onClick={() => (mode === 'running' ? pause() : play(pageId))}
      >
        {mode === 'running' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button
        type="button"
        aria-label="Step back one frame"
        disabled={mode === 'edit' || mode === 'running'}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
        onClick={stepBack}
      >
        <StepBack className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Step one frame"
        disabled={mode === 'running'}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
        onClick={() => {
          if (mode === 'edit') {
            play(pageId)
            pause()
          }
          stepFrame()
        }}
      >
        <StepForward className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Reset simulation"
        disabled={mode === 'edit'}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
        onClick={stop}
      >
        <RotateCcw className="h-4 w-4" />
      </button>
      <div className="mx-1 h-6 w-px bg-border" />
      <span
        className={cn(
          'min-w-16 pr-2 text-right font-mono text-[11.5px] tabular-nums',
          mode === 'edit' ? 'text-muted-foreground' : 'text-[var(--accent-mint)]'
        )}
      >
        {mode === 'edit' ? 'EDIT' : `${time.toFixed(2)}s`}
      </span>
    </fm.div>
  )
}
