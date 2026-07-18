'use client'

// Unity-style transport: Edit → Play → Pause → Step → Reset.
// Nothing is regenerated — the exact drawn scene starts simulating.

import { Play, Pause, StepBack, StepForward, RotateCcw } from 'lucide-react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useRuntimeStore, play, pause, stepFrame, stepBack, stop } from '@/lib/physics/world'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/lib/store/preferences'
import { useIsNarrow } from '@/hooks/use-mobile'
import { useDockClearance } from '@/hooks/use-dock-clearance'
import { useRef } from 'react'

export function Transport({ pageId }: { pageId: string }) {
  const motion = useSpring()
  const mode = useRuntimeStore((s) => s.mode)
  const dock = usePrefs((s) => s.notebook.dock)
  const time = useRuntimeStore((s) => s.time)
  // A phone doesn't have room for a five-button strip that's idle 95% of the
  // time: while editing it collapses to a single Play; the full transport
  // unfolds the moment a simulation is actually running.
  const isPhone = useIsNarrow(767)
  // A TOP dock shares this edge — measure, don't guess, and step aside.
  // The wrapper owns position so framer's intro can keep the transform.
  const wrapRef = useRef<HTMLDivElement>(null)
  const shift = useDockClearance(wrapRef, [isPhone, mode, dock])

  if (isPhone && mode === 'edit') {
    return (
      <div
        ref={wrapRef}
        style={{ translate: `${shift.x}px ${shift.y}px` }}
        className="absolute left-1/2 top-3 z-40 -translate-x-1/2 transition-[translate] duration-200"
      >
        <fm.div
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={motion}
          className="glass-strong rounded-2xl p-1"
          aria-label="Simulation transport"
        >
          <button
            type="button"
            aria-label="Play"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--accent-mint)] transition-colors hover:bg-accent"
            onClick={() => play(pageId)}
          >
            <Play className="h-4 w-4" />
          </button>
        </fm.div>
      </div>
    )
  }

  return (
    <div
      ref={wrapRef}
      style={{ translate: `${shift.x}px ${shift.y}px` }}
      className={cn(
        'absolute z-40 transition-[translate] duration-200',
        // The dock is centred on its edge, so a TOP dock would sit right on
        // the transport. Park the transport beside it on the same row — the
        // two read as one control strip — and let the clearance shift take
        // over if the dock grows all the way into this corner.
        dock === 'top' ? 'right-4 top-4' : 'left-1/2 top-4 -translate-x-1/2'
      )}
    >
    <fm.div
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={motion}
      className={cn(
        'glass-strong flex items-center gap-1 rounded-2xl p-1.5 transition-shadow',
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
    </div>
  )
}
