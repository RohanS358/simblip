'use client'

// Hands-on onboarding: a checklist that watches the document and ticks
// itself as the user actually performs each step — no passive slideshow.
// Steps mirror SIMBLIP's core loop: draw → behave → play → measure.
// Completion is sticky per step (pausing doesn't untick "Play").

import { useEffect, useState } from 'react'
import { X, Check, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import { useDocStore } from '@/lib/store/document'
import { useRuntimeStore } from '@/lib/physics/world'
import type { SceneObject } from '@/lib/scene/types'
import { cn } from '@/lib/utils'

interface Step {
  title: string
  how: string
  check: (objects: SceneObject[], hasPlayed: boolean, hasVariables: boolean) => boolean
}

const STEPS: Step[] = [
  {
    title: 'Draw something',
    how: 'Press P for the pen and doodle a circle on the canvas — or click the circle tool and drag to size it.',
    check: (objects) =>
      objects.some((o) => ['circle', 'rect', 'polygon', 'stroke'].includes(o.geometry.kind)),
  },
  {
    title: 'Make it physical',
    how: 'Click your shape, then in the Inspector press “Add behavior” → Rigid Body. Now it has mass.',
    check: (objects) =>
      objects.some((o) => o.behaviors.some((b) => b.enabled && b.type === 'rigidBody')),
  },
  {
    title: 'Give it ground',
    how: 'Open Components (the shapes button in the toolbar) and place a Ground under your shape.',
    check: (objects) =>
      objects.some((o) => o.behaviors.some((b) => b.enabled && b.type === 'staticBody')),
  },
  {
    title: 'Press Play',
    how: 'Hit ▶ in the transport. Your drawing falls, lands and bounces — that is the whole idea.',
    check: (_o, hasPlayed) => hasPlayed,
  },
  {
    title: 'Graph it',
    how: 'Press G and drag out a graph, then pick your object as a series in the Inspector. Play again and watch it plot live.',
    check: (objects) => objects.some((o) => o.geometry.kind === 'graph'),
  },
  {
    title: 'Bend reality',
    how: 'Inspector → Variables tab → set g (try 1.62 — Moon gravity). Change it while the simulation runs.',
    check: (_o, _p, hasVariables) => hasVariables,
  },
]

export function Tutorial({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const objects = useDocStore((s) => s.pages[pageId]?.objects)
  const variables = useDocStore((s) => s.pages[pageId]?.variables)
  const mode = useRuntimeStore((s) => s.mode)

  const [hasPlayed, setHasPlayed] = useState(false)
  const [done, setDone] = useState<boolean[]>(() => STEPS.map(() => false))

  useEffect(() => {
    if (mode === 'running') setHasPlayed(true)
  }, [mode])

  useEffect(() => {
    const objs = Object.values(objects ?? {})
    const hasVars = (variables?.length ?? 0) > 0
    setDone((prev) =>
      prev.map((was, i) => was || STEPS[i].check(objs, hasPlayed, hasVars))
    )
  }, [objects, variables, hasPlayed])

  const current = done.findIndex((d) => !d)
  const finished = current === -1

  return (
    <motion.aside
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      // Phones: sit above the toolbar and span the width; desktop keeps the
      // bottom-left card clear of the centered toolbar.
      className="glass-strong absolute bottom-[5.5rem] left-4 right-4 z-40 rounded-2xl p-3 sm:bottom-5 sm:right-auto sm:w-72"
      aria-label="Getting started tutorial"
    >
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-[var(--accent-amber)]" />
        <span className="flex-1 text-[12.5px] font-bold tracking-tight">
          {finished ? 'You know SIMBLIP now!' : 'Get started'}
        </span>
        <button
          type="button"
          aria-label="Close tutorial"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ol className="space-y-1">
        {STEPS.map((step, i) => {
          const isDone = done[i]
          const isCurrent = i === current
          return (
            <li
              key={step.title}
              className={cn(
                'rounded-lg px-2 py-1.5 transition-colors',
                isCurrent && 'bg-accent/60'
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold',
                    isDone
                      ? 'bg-[var(--accent-mint)] text-background'
                      : isCurrent
                        ? 'bg-[var(--accent-blue)] text-primary-foreground'
                        : 'bg-accent text-muted-foreground'
                  )}
                >
                  {isDone ? <Check className="h-2.5 w-2.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    'text-[12px] font-medium',
                    isDone && 'text-muted-foreground line-through'
                  )}
                >
                  {step.title}
                </span>
              </div>
              {isCurrent && (
                <p className="ml-6 mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {step.how}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {finished ? (
        <button
          type="button"
          className="mt-2 w-full rounded-lg bg-foreground py-1.5 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
          onClick={onClose}
        >
          Start building
        </button>
      ) : (
        <button
          type="button"
          className="mt-2 w-full rounded-lg border border-border py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
          onClick={onClose}
        >
          Skip the tour
        </button>
      )}
    </motion.aside>
  )
}
