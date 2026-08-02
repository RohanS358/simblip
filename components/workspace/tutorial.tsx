'use client'

// Hands-on tutorials — one guided experiment per area of study, done on the
// user's own page. Steps auto-complete by watching the document and runtime
// stores (place a mass → detected; press Play → detected), so learners DO
// the physics instead of reading about it. Progress is sticky per course.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Check, ChevronLeft, Film, GraduationCap, X } from 'lucide-react'
import { useDocStore, type Tool } from '@/lib/store/document'
import { useRuntimeStore } from '@/lib/physics/world'
import type { PageDoc, SceneObject } from '@/lib/scene/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Ctx {
  page: PageDoc | null
  tool: Tool
  played: boolean
  pinned: boolean
}

interface Step {
  text: string
  /** auto-complete predicate; omit for read-and-continue steps */
  check?: (ctx: Ctx) => boolean
  /** CSS selector of the UI control this step uses — gets a spotlight ring */
  target?: string
}

const T = {
  pen: '[aria-label^="Pen"]',
  eraser: '[aria-label^="Eraser"]',
  note: '[aria-label="Note"]',
  graph: '[aria-label="Graph"]',
  components: '[aria-label^="Components"]',
  play: '[aria-label="Play"], [aria-label="Pause"]',
  inspector: '[aria-label="Toggle inspector"], [aria-label="Close inspector"]',
  undo: '[aria-label="Undo"]',
  pin: '[aria-label="Pin this run — compare against the next one"], [aria-label="Clear pinned run"]',
}

/** Pulsing ring pinned over the step's control; tracks it as layout moves. */
function StepHighlight({ selector }: { selector?: string }) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    if (!selector) {
      setRect(null)
      return
    }
    const update = () => {
      const el = document.querySelector(selector)
      const r = el?.getBoundingClientRect()
      setRect(r && r.width > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null)
    }
    update()
    const timer = setInterval(update, 350)
    window.addEventListener('resize', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', update)
    }
  }, [selector])
  if (!rect) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[60] animate-pulse rounded-xl border-2 border-[var(--accent-blue)] shadow-[0_0_0_5px_color-mix(in_oklch,var(--accent-blue)_25%,transparent)] transition-[left,top,width,height] duration-300 ease-out"
      style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
    />
  )
}

/** Beginner: never touched the app. Intermediate: comfortable placing and
 *  connecting components, ready for tool-mastery and a new physics domain.
 *  Advanced: fluent — the remaining domains are genuinely harder physics,
 *  not harder UI. Purely a grouping/ordering label for the course picker;
 *  nothing is ever locked, every course stays one tap away (§24/§27 of the
 *  UX masterplan — no course should ever gate another). */
type Tier = 'beginner' | 'intermediate' | 'advanced'

interface Course {
  id: string
  title: string
  goal: string
  tier: Tier
  steps: Step[]
}

const TIERS: { id: Tier; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
]

const objs = (ctx: Ctx): SceneObject[] => (ctx.page ? Object.values(ctx.page.objects) : [])
const hasB = (ctx: Ctx, type: string, n = 1) =>
  objs(ctx).filter((o) => o.behaviors.some((b) => b.enabled && b.type === type)).length >= n
const hasSymbol = (ctx: Ctx, domain: string, n = 1) =>
  objs(ctx).filter((o) => o.geometry.kind === 'symbol' && o.geometry.domain === domain).length >= n
/** Any numeric param anywhere whose expression is exactly one of the page's
 *  variable names — i.e. the learner wired a variable into an object. */
const usesAVariable = (ctx: Ctx) => {
  const names = ctx.page?.variables.map((v) => v.name) ?? []
  if (!names.length) return false
  return objs(ctx).some((o) =>
    o.behaviors.some((b) => Object.values(b.params).some((p) => p.kind === 'number' && names.includes(p.expr.trim())))
  )
}

const COURSES: Course[] = [
  {
    id: 'basics',
    title: 'Notebook basics',
    goal: 'Draw, write and control the canvas.',
    tier: 'beginner',
    steps: [
      { text: 'Pick the Pen (P) in the bottom dock and draw anything — a scribble is fine.', target: T.pen, check: (c) => objs(c).some((o) => o.geometry.kind === 'stroke') || c.tool === 'pen' },
      { text: 'Draw a rough circle slowly — sketch recognition turns it into a real circle.', target: T.pen, check: (c) => objs(c).some((o) => o.geometry.kind === 'circle') },
      { text: 'Add a Note (N) and type a caption. Two fingers (or Space+drag) pan; pinch or scroll zooms.', target: T.note, check: (c) => objs(c).some((o) => o.geometry.kind === 'note') },
      { text: 'Try the Eraser (E): drag across leftover ink to clean up. You know the surface now.', target: T.eraser },
    ],
  },
  {
    id: 'mechanics',
    title: 'Mechanics — spring–mass oscillator',
    goal: 'Build and run your first simulation.',
    tier: 'beginner',
    steps: [
      { text: 'Open Components (the shapes icon) and place a Spring, then a Mass touching its lower end.', target: T.components, check: (c) => hasB(c, 'spring') && hasB(c, 'rigidBody') },
      { text: 'Place a Ground under everything so the world has a floor.', target: T.components, check: (c) => hasB(c, 'staticBody') },
      { text: 'Add a Graph (G); in the Inspector point its source at the mass, channels “y,vy”.', target: T.graph, check: (c) => objs(c).some((o) => o.geometry.kind === 'graph') },
      { text: 'Press ▶ Play. The mass oscillates and the graph traces y(t) — simple harmonic motion, live.', target: T.play, check: (c) => c.played },
      { text: 'While it runs, select the spring and change k in the Inspector. Stiffer spring, higher frequency: ω = √(k/m).', target: T.inspector },
    ],
  },
  {
    id: 'workflow',
    title: 'Working faster — variables & shortcuts',
    goal: 'Drive several objects from one shared number, and the moves that stop costing clicks.',
    tier: 'intermediate',
    steps: [
      { text: 'Open Properties → Variables and add one — any name, any starting value.', target: T.inspector, check: (c) => (c.page?.variables.length ?? 0) >= 1 },
      { text: 'Select an object with a physics behavior, then type your variable’s name into one of its numeric fields instead of a number.', target: T.inspector, check: usesAVariable },
      { text: 'Change that variable’s value in the Variables tab — everything wired to it updates at once, even mid-simulation.', target: T.inspector },
      { text: 'Select any object and duplicate it (Ctrl/Cmd+D) — same properties, ready to place again without rebuilding it.', target: T.components },
      { text: 'Made a mess? Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z redoes. Try it now.', target: T.undo },
    ],
  },
  {
    id: 'circuits',
    title: 'Circuits — Ohm’s law loop',
    goal: 'A battery, a resistor and real Kirchhoff current.',
    tier: 'intermediate',
    steps: [
      { text: 'From Components, place a Battery and a Resistor side by side.', target: T.components, check: (c) => hasSymbol(c, 'electrical', 2) },
      { text: 'Draw ink from terminal to terminal to wire them into a loop — ink that touches terminals conducts.', target: T.pen, check: (c) => hasB(c, 'wire') },
      { text: 'Press ▶ Play: amber dashes are conventional current; their speed tracks the real amps.', target: T.play, check: (c) => c.played },
      { text: 'Change the resistance in the Inspector and watch the current respond — I = V/R, solved every frame.', target: T.inspector },
    ],
  },
  {
    id: 'optics',
    title: 'Optics & quantum light — Young’s double slit',
    goal: 'Interference fringes, then photon-by-photon build-up.',
    tier: 'advanced',
    steps: [
      { text: 'Place a Light Source (Optics section) — a coherent beam fires along its rotation.', target: T.components, check: (c) => hasB(c, 'lightSource') },
      { text: 'Place a Slit across the beam. Its defaults are already Young’s d = 40 µm double slit.', target: T.components, check: (c) => hasB(c, 'slit') },
      { text: 'Place a Screen a few hundred µm behind the slit, facing the beam.', target: T.components, check: (c) => hasB(c, 'opticalScreen') },
      { text: 'Fringes! The band and curve on the screen are a real Huygens–Fresnel sum. Change λ or the slit spacing d — Δy = λL/d obeys.', target: T.inspector, check: (c) => hasB(c, 'lightSource') && hasB(c, 'slit') && hasB(c, 'opticalScreen') },
      { text: 'Press ▶ Play: single photons now land at Born-rule positions, building the same pattern out of raw randomness. That IS quantum mechanics.', target: T.play, check: (c) => c.played },
    ],
  },
  {
    id: 'waves',
    title: 'Waves — media & standing waves',
    goal: 'Propagation, loss and reflection.',
    tier: 'advanced',
    steps: [
      { text: 'Place a Wave Source (Waves section) and press ▶ Play to watch the travelling wave.', target: T.components, check: (c) => hasB(c, 'waveSource') && c.played },
      { text: 'In the Inspector set σ > 0 — the envelope decays: a lossy medium. Large σ ⇒ conductor-like skin depth.', target: T.inspector, check: (c) => hasB(c, 'waveSource') },
      { text: 'Place a Wave Boundary: with εr2 = 4 (glass) you get Γ, τ and a standing-wave ratio at the interface.', target: T.components, check: (c) => hasB(c, 'waveBoundary') },
      { text: 'Add a Transmission Line and sweep its load — Zin, Γ and the SWR pattern respond like the Smith chart says.', target: T.components, check: (c) => hasB(c, 'transmissionLine') },
    ],
  },
  {
    id: 'quantum',
    title: 'Quantum — confinement & tunneling',
    goal: 'Wells, wavefunctions and barriers.',
    tier: 'advanced',
    steps: [
      { text: 'Place a Quantum Well (Quantum section) — you see ψ, |ψ|² and the energy ladder.', target: T.components, check: (c) => hasB(c, 'quantumWell') },
      { text: 'Step n to 2, then 3 in the Inspector — nodes appear; En grows as n².', target: T.inspector, check: (c) => hasB(c, 'quantumWell') },
      { text: 'Narrow the well (smaller L): every level rises as 1/L² — confinement costs energy.', target: T.inspector, check: (c) => hasB(c, 'quantumWell') },
      { text: 'Place a Tunnel Barrier with E < V0. Transmission is NOT zero — sweep E and the width to map how tunneling decays.', target: T.components, check: (c) => hasB(c, 'tunnelBarrier') },
    ],
  },
  {
    id: 'teaching',
    title: 'Teaching with SIMBLIP',
    goal: 'The instructor moves — not more physics, the tools you use in front of a class.',
    tier: 'advanced',
    steps: [
      { text: 'Press ? anywhere (not while typing) to open the keyboard shortcut cheat sheet — the fastest way to learn the bindings your students will pick up by watching you drive.' },
      { text: 'Run a simulation, then change one parameter (e.g. a spring’s k) and run it again. Click the Pin icon next to Reset first: the earlier run overlays as a dimmed trace on any Graph reading that channel — a live "k=5 vs k=10" without a second page.', target: T.pin, check: (c) => c.pinned },
      { text: 'On a room’s paired display, press Present on any page from its ⋯ menu — the room shows a frozen copy live; your master notebook is never touched, so you can keep editing it during class.' },
      { text: 'In Assignments, open a submitted page and click "View copy" — it imports locked: you can draw or write feedback on top, but the student’s own work can’t be moved, resized or edited, ever.' },
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

export function TutorialPanel({
  pageId,
  onClose,
  initialCourseId,
}: {
  pageId: string | null
  onClose: () => void
  /** Pre-select a course on mount — e.g. the first-run seed opens straight
   *  into "basics" instead of the course list, since the seeded page was
   *  built for exactly that course (shell.tsx's seedFirstRun). */
  initialCourseId?: string
}) {
  const [courseId, setCourseId] = useState<string | null>(initialCourseId ?? null)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [played, setPlayed] = useState(false)

  const page = useDocStore((s) => (pageId ? s.pages[pageId] ?? null : null))
  const tool = useDocStore((s) => s.tool)
  const mode = useRuntimeStore((s) => s.mode)
  const pinned = useDocStore((s) => (pageId ? Boolean(s.pinnedRuns[pageId]) : false))

  useEffect(() => setProgress(loadProgress()), [])
  useEffect(() => {
    if (mode !== 'edit') setPlayed(true)
  }, [mode])

  const course = COURSES.find((c) => c.id === courseId) ?? null
  const step = course ? Math.min(progress[course.id] ?? 0, course.steps.length) : 0
  const ctx: Ctx = { page, tool, played, pinned }
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
      {/* Spotlight the control this step uses. */}
      {course && step < course.steps.length && <StepHighlight selector={current?.target} />}
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
        <div className="max-h-[60vh] space-y-3 overflow-y-auto no-scrollbar">
          <p className="pb-1 text-[12px] leading-relaxed text-muted-foreground">
            Guided experiments, done by you on this page. Each step watches your canvas and ticks
            itself when it detects the setup. Nothing is locked — jump to any tier any time.
          </p>
          <Link
            href="/tutorial"
            className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:border-[var(--accent-violet)] hover:text-foreground"
          >
            <Film className="h-3.5 w-3.5 shrink-0 text-[var(--accent-violet)]" />
            New here? Watch the silent visual walkthrough first — no setup, nothing saved.
          </Link>
          {TIERS.map(({ id: tierId, label }) => {
            const inTier = COURSES.filter((c) => c.tier === tierId)
            if (!inTier.length) return null
            return (
              <div key={tierId} className="space-y-1.5">
                <span className="block px-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {label}
                </span>
                {inTier.map((c) => {
                  const done = (progress[c.id] ?? 0) >= c.steps.length
                  const isFirstEver = c.id === 'basics' && !done && Object.keys(progress).length === 0
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                      onClick={() => setCourseId(c.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="block truncate text-[12.5px] font-semibold">{c.title}</span>
                          {isFirstEver && (
                            <span className="shrink-0 rounded-full bg-[var(--accent-blue)]/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[var(--accent-blue)]">
                              Start here
                            </span>
                          )}
                        </span>
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
