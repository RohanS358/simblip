'use client'

// Unity-style transport: Edit → Play → Pause → Step → Reset.
// Nothing is regenerated — the exact drawn scene starts simulating.
//
// Positioning is not this component's job anymore — it used to sit at a
// hard-coded corner and reactively shift away if it measured a collision
// with the dock (see use-dock-clearance.ts). By default it's a plain grid
// item placed by CanvasControls (floating, so it draws its own glass pill
// to stay legible over the canvas). Pass `flat` when embedding it inline in
// a bar that already has its own chrome (the tab bar's controls row, see
// page-controls-menu.tsx) — it then renders as bare buttons instead of a
// self-contained pill.

import { Play, Pause, StepBack, StepForward, RotateCcw } from 'lucide-react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useRuntimeStore, play, pause, stepFrame, stepBack, stop } from '@/lib/physics/world'
import { cn } from '@/lib/utils'
import { useIsNarrow } from '@/hooks/use-mobile'

export function Transport({ pageId, flat = false }: { pageId: string; flat?: boolean }) {
  const motion = useSpring()
  const mode = useRuntimeStore((s) => s.mode)
  const time = useRuntimeStore((s) => s.time)
  // A phone doesn't have room for a five-button strip that's idle 95% of the
  // time: while editing it collapses to a single Play; the full transport
  // unfolds the moment a simulation is actually running.
  const isPhone = useIsNarrow(767)

  const btnSize = flat ? 'h-7 w-7' : 'h-9 w-9'
  const iconSize = flat ? 'h-3.5 w-3.5' : 'h-4 w-4'

  if (isPhone && mode === 'edit') {
    const playBtn = (
      <button
        type="button"
        aria-label="Play"
        className={cn(
          'flex items-center justify-center rounded-xl text-[var(--accent-mint)] transition-colors hover:bg-accent',
          btnSize
        )}
        onClick={() => play(pageId)}
      >
        <Play className={iconSize} />
      </button>
    )
    if (flat) return playBtn
    return (
      <fm.div
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={motion}
        className="glass-strong rounded-2xl p-1"
        aria-label="Simulation transport"
      >
        {playBtn}
      </fm.div>
    )
  }

  const buttons = (
    <>
      <button
        type="button"
        aria-label={mode === 'running' ? 'Pause' : 'Play'}
        className={cn(
          'flex items-center justify-center rounded-xl transition-colors',
          btnSize,
          mode === 'running'
            ? 'bg-[var(--accent-mint)] text-primary-foreground'
            : 'text-[var(--accent-mint)] hover:bg-accent'
        )}
        onClick={() => (mode === 'running' ? pause() : play(pageId))}
      >
        {mode === 'running' ? <Pause className={iconSize} /> : <Play className={iconSize} />}
      </button>
      <button
        type="button"
        aria-label="Step back one frame"
        disabled={mode === 'edit' || mode === 'running'}
        className={cn(
          'flex items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30',
          btnSize
        )}
        onClick={stepBack}
      >
        <StepBack className={iconSize} />
      </button>
      <button
        type="button"
        aria-label="Step one frame"
        disabled={mode === 'running'}
        className={cn(
          'flex items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30',
          btnSize
        )}
        onClick={() => {
          if (mode === 'edit') {
            play(pageId)
            pause()
          }
          stepFrame()
        }}
      >
        <StepForward className={iconSize} />
      </button>
      <button
        type="button"
        aria-label="Reset simulation"
        disabled={mode === 'edit'}
        className={cn(
          'flex items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30',
          btnSize
        )}
        onClick={stop}
      >
        <RotateCcw className={iconSize} />
      </button>
      <div className={cn('mx-1 w-px bg-border', flat ? 'h-4' : 'h-6')} />
      <span
        className={cn(
          'text-right font-mono tabular-nums',
          flat ? 'min-w-14 pr-1 text-[10.5px]' : 'min-w-16 pr-2 text-[11.5px]',
          mode === 'edit' ? 'text-muted-foreground' : 'text-[var(--accent-mint)]'
        )}
      >
        {mode === 'edit' ? 'EDIT' : `${time.toFixed(2)}s`}
      </span>
    </>
  )

  if (flat) return <div className="flex items-center gap-0.5">{buttons}</div>

  return (
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
      {buttons}
    </fm.div>
  )
}
