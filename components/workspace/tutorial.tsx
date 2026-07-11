'use client'

// Hands-on tutorials — one guided experiment per area of study, done on the
// user's own page. Steps auto-complete by watching the document and runtime
// stores (place a mass → detected; press Play → detected), so learners DO
// the physics instead of reading about it. Progress is sticky per course.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, ChevronLeft, GraduationCap, X } from 'lucide-react'
import { useDocStore, type Tool } from '@/lib/store/document'
import { useRuntimeStore } from '@/lib/physics/world'
import type { PageDoc, SceneObject } from '@/lib/scene/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Ctx {
  page: PageDoc | null
  tool: Tool
  played: boolean
}

interface Step {
  text: string
  /** auto-complete predicate; omit for read-and-continue steps */
  check?: (ctx: Ctx) => boolean
}

interface Course {
  id: string
  title: string
  goal: string
  steps: Step[]
}

const objs = (ctx: Ctx): SceneObject[] => (ctx.page ? Object.values(ctx.page.objects) : [])
const hasB = (ctx: Ctx, type: string, n = 1) =>
  objs(ctx).filter((o) => o.behaviors.some((b) => b.enabled && b.type === type)).length >= n
const hasSymbol = (ctx: Ctx, domain: string, n = 1) =>
  objs(ctx).filter((o) => o.geometry.kind === 'symbol' && o.geometry.domain === domain).length >= n

const COURSES: Course[] = [
  {
    id: 'basics',
    title: 'Notebook basics',
    goal: 'Draw, write and control the canvas.',
    steps: [
      { text: 'Pick the Pen (P) in the bottom dock and draw anything — a scribble is fine.', check: (c) => objs(c).some((o) => o.geometry.kind === 'stroke') || c.tool === 'pen' },
      { text: 'Draw a rough circle slowly — sketch recognition turns it into a real circle.', check: (c) => objs(c).some((o) => o.geometry.kind === 'circle') },
      { text: 'Add a Note (N) and type a caption. Two fingers (or Space+drag) pan; pinch or scroll zooms.', check: (c) => objs(c).some((o) => o.geometry.kind === 'note') },
      { text: 'Try the Eraser (E): drag across leftover ink to clean up. You know the surface now.' },
    ],
  },
  {
    id: 'mechanics',
    title: 'Mechanics — spring–mass oscillator',
    goal: 'Build and run your first simulation.',
    steps: [
      { text: 'Open Components (the shapes icon) and place a Spring, then a Mass touching its lower end.', check: (c) => hasB(c, 'spring') && hasB(c, 'rigidBody') },
      { text: 'Place a Ground under everything so the world has a floor.', check: (c) => hasB(c, 'staticBody') },
      { text: 'Add a Graph (G); in the Inspector point its source at the mass, channels “y,vy”.', check: (c) => objs(c).some((o) => o.geometry.kind === 'graph') },
      { text: 'Press ▶ Play. The mass oscillates and the graph traces y(t) — simple harmonic motion, live.', check: (c) => c.played },
      { text: 'While it runs, select the spring and change k in the Inspector. Stiffer spring, higher frequency: ω = √(k/m).' },
    ],
  },
  {
    id: 'circuits',
    title: 'Circuits — Ohm’s law loop',
    goal: 'A battery, a resistor and real Kirchhoff current.',
    steps: [
      { text: 'From Components, place a Battery and a Resistor side by side.', check: (c) => hasSymbol(c, 'electrical', 2) },
      { text: 'Draw ink from terminal to terminal to wire them into a loop — ink that touches terminals conducts.', check: (c) => hasB(c, 'wire') },
      { text: 'Press ▶ Play: amber dashes are conventional current; their speed tracks the real amps.', check: (c) => c.played },
      { text: 'Change the resistance in the Inspector and watch the current respond — I = V/R, solved every frame.' },
    ],
  },
  {
    id: 'optics',
    title: 'Optics & quantum light — Young’s double slit',
    goal: 'Interference fringes, then photon-by-photon build-up.',
    steps: [
      { text: 'Place a Light Source (Optics section) — a coherent beam fires along its rotation.', check: (c) => hasB(c, 'lightSource') },
      { text: 'Place a Slit across the beam. Its defaults are already Young’s d = 40 µm double slit.', check: (c) => hasB(c, 'slit') },
      { text: 'Place a Screen a few hundred µm behind the slit, facing the beam.', check: (c) => hasB(c, 'opticalScreen') },
      { text: 'Fringes! The band and curve on the screen are a real Huygens–Fresnel sum. Change λ or the slit spacing d — Δy = λL/d obeys.', check: (c) => hasB(c, 'lightSource') && hasB(c, 'slit') && hasB(c, 'opticalScreen') },
      { text: 'Press ▶ Play: single photons now land at Born-rule positions, building the same pattern out of raw randomness. That IS quantum mechanics.', check: (c) => c.played },
    ],
  },
  {
    id: 'waves',
    title: 'Waves — media & standing waves',
    goal: 'Propagation, loss and reflection.',
    steps: [
      { text: 'Place a Wave Source (Waves section) and press ▶ Play to watch the travelling wave.', check: (c) => hasB(c, 'waveSource') && c.played },
      { text: 'In the Inspector set σ > 0 — the envelope decays: a lossy medium. Large σ ⇒ conductor-like skin depth.', check: (c) => hasB(c, 'waveSource') },
      { text: 'Place a Wave Boundary: with εr2 = 4 (glass) you get Γ, τ and a standing-wave ratio at the interface.', check: (c) => hasB(c, 'waveBoundary') },
      { text: 'Add a Transmission Line and sweep its load — Zin, Γ and the SWR pattern respond like the Smith chart says.', check: (c) => hasB(c, 'transmissionLine') },
    ],
  },
  {
    id: 'quantum',
    title: 'Quantum — confinement & tunneling',
    goal: 'Wells, wavefunctions and barriers.',
    steps: [
      { text: 'Place a Quantum Well (Quantum section) — you see ψ, |ψ|² and the energy ladder.', check: (c) => hasB(c, 'quantumWell') },
      { text: 'Step n to 2, then 3 in the Inspector — nodes appear; En grows as n².', check: (c) => hasB(c, 'quantumWell') },
      { text: 'Narrow the well (smaller L): every level rises as 1/L² — confinement costs energy.', check: (c) => hasB(c, 'quantumWell') },
      { text: 'Place a Tunnel Barrier with E < V0. Transmission is NOT zero — sweep E and the width to map how tunneling decays.', check: (c) => hasB(c, 'tunnelBarrier') },
    ],
  },
]

const PROGRESS_KEY = 'simblip-tutorial-progress'
const loadProgress = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

export function TutorialPanel({ pageId, onClose }: { pageId: string | null; onClose: () => void }) {
  const [courseId, setCourseId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [played, setPlayed] = useState(false)

  const page = useDocStore((s) => (pageId ? s.pages[pageId] ?? null : null))
  const tool = useDocStore((s) => s.tool)
  const mode = useRuntimeStore((s) => s.mode)

  useEffect(() => setProgress(loadProgress()), [])
  useEffect(() => {
    if (mode !== 'edit') setPlayed(true)
  }, [mode])

  const course = COURSES.find((c) => c.id === courseId) ?? null
  const step = course ? Math.min(progress[course.id] ?? 0, course.steps.length) : 0
  const ctx: Ctx = { page, tool, played }
  const current = course?.steps[step]
  const passed = Boolean(current?.check?.(ctx))

  const setStep = (id: string, n: number) => {
    const next = { ...progress, [id]: n }
    setProgress(next)
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(next))
    if (n === 0) setPlayed(false)
  }

  return (
    <motion.div
      initial={{ y: 16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="glass-strong fixed bottom-20 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col rounded-2xl p-3"
      aria-label="Tutorial"
    >
      <div className="mb-1 flex items-center gap-2">
        {course ? (
          <button
            type="button"
            aria-label="All tutorials"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setCourseId(null)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <GraduationCap className="h-4 w-4 text-[var(--accent-blue)]" />
        )}
        <span className="flex-1 truncate text-[12px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          {course ? course.title : 'Learn SIMBLIP'}
        </span>
        <button
          type="button"
          aria-label="Close tutorial"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!course ? (
        <div className="space-y-1.5">
          <p className="pb-1 text-[12px] leading-relaxed text-muted-foreground">
            Guided experiments, done by you on this page. Each step watches your canvas and ticks
            itself when it detects the setup.
          </p>
          {COURSES.map((c) => {
            const done = (progress[c.id] ?? 0) >= c.steps.length
            return (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                onClick={() => setCourseId(c.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold">{c.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{c.goal}</span>
                </span>
                {done ? (
                  <Check className="h-4 w-4 shrink-0 text-[var(--accent-mint)]" />
                ) : (
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">
                    {progress[c.id] ?? 0}/{c.steps.length}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : step >= course.steps.length ? (
        <div className="py-3 text-center">
          <Check className="mx-auto h-6 w-6 text-[var(--accent-mint)]" />
          <p className="mt-1 text-[13px] font-semibold">Experiment complete!</p>
          <Button size="sm" variant="outline" className="mt-2 h-7 text-[12px]" onClick={() => setStep(course.id, 0)}>
            Restart
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex gap-1">
            {course.steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1 flex-1 rounded-full',
                  i < step ? 'bg-[var(--accent-mint)]' : i === step ? 'bg-[var(--accent-blue)]' : 'bg-border'
                )}
              />
            ))}
          </div>
          <p className="min-h-16 text-[12.5px] leading-relaxed">{current?.text}</p>
          <div className="mt-2 flex items-center gap-2">
            {current?.check && (
              <span
                className={cn(
                  'flex items-center gap-1 text-[11px] font-semibold',
                  passed ? 'text-[var(--accent-mint)]' : 'text-muted-foreground'
                )}
              >
                <Check className="h-3.5 w-3.5" /> {passed ? 'Detected on your page!' : 'Watching your page…'}
              </span>
            )}
            <div className="flex-1" />
            {step > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={() => setStep(course.id, step - 1)}>
                Back
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 text-[12px]"
              variant={current?.check && !passed ? 'outline' : 'default'}
              onClick={() => setStep(course.id, step + 1)}
            >
              {current?.check && !passed ? 'Skip' : 'Next'}
            </Button>
          </div>
        </>
      )}
    </motion.div>
  )
}
