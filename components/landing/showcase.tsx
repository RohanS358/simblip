// Landing page — live-feeling demos of what the notebook actually does,
// rendered with the same design tokens (glass, canvas dots, accents) as the
// workspace, so the marketing page IS the product's UI.

import { ScrollFx } from './scroll-fx'
import { HeroBallpit } from './hero-ballpit'
import { SignInLink } from './sign-in-link'

function DemoCard({
  title,
  caption,
  children,
}: {
  title: string
  caption: string
  children: React.ReactNode
}) {
  return (
    <div className="glass flex flex-col overflow-hidden rounded-2xl">
      <div className="canvas-dots flex h-52 items-center justify-center bg-background/60 [background-size:20px_20px]">
        {children}
      </div>
      <div className="border-t border-border/60 p-4">
        <h3 className="text-ui-md font-semibold">{title}</h3>
        <p className="mt-1 text-ui-xs leading-relaxed text-muted-foreground">{caption}</p>
      </div>
    </div>
  )
}

const SVG_PROPS = {
  stroke: 'var(--foreground)',
  strokeWidth: 2,
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function PendulumDemo() {
  return (
    <svg viewBox="0 0 220 160" width="220" height="160" {...SVG_PROPS}>
      <circle cx={110} cy={18} r={5} fill="var(--foreground)" stroke="none" />
      <g style={{ transformOrigin: '110px 18px', animation: 'sb-swing 2.4s ease-in-out infinite alternate' }}>
        <line x1={110} y1={18} x2={110} y2={110} />
        <circle
          cx={110}
          cy={122}
          r={16}
          fill="color-mix(in oklch, var(--accent-blue) 22%, var(--card))"
          stroke="var(--accent-blue)"
        />
      </g>
      <path d="M60 150 h100" stroke="var(--muted-foreground)" strokeDasharray="4 6" />
    </svg>
  )
}

function CircuitDemo() {
  const loop = 'M40 40 H180 V120 H40 Z'
  return (
    <svg viewBox="0 0 220 160" width="220" height="160" {...SVG_PROPS}>
      {/* battery (left edge) */}
      <path d="M40 68 v-8 M40 100 v8 M30 68 h20 M35 76 h10" />
      <path d="M40 76 v-8 M40 92 v8" stroke="none" />
      {/* resistor (top edge) */}
      <path d="M88 40 l4 -8 8 16 8 -16 8 16 8 -16 4 8" />
      {/* LED (right edge) with glow */}
      <circle cx={180} cy={80} r={13} fill="var(--accent-amber)" stroke="none" style={{ animation: 'sb-glow 1.6s ease-in-out infinite' }} />
      <path d="M173 72 h14 l-7 14 z M173 92 h14" />
      {/* the loop + both flows */}
      <path d={loop} strokeWidth={1.6} opacity={0.55} />
      <path d={loop} stroke="var(--accent-amber)" strokeWidth={3} strokeDasharray="6 10" style={{ animation: 'sb-flow 1.2s linear infinite' }} />
      <path d={loop} stroke="var(--accent-blue)" strokeWidth={2.5} strokeDasharray="2.5 13.5" style={{ animation: 'sb-flow-rev 1.2s linear infinite' }} />
    </svg>
  )
}

function LogicDemo() {
  const Bit = ({ x, y, phase }: { x: number; y: number; phase: number }) => (
    <g fontFamily="var(--font-mono, monospace)" fontSize="13" fontWeight="bold" stroke="none">
      <text x={x} y={y} fill="var(--muted-foreground)" style={{ animation: `sb-bit0 2.4s steps(1) infinite`, animationDelay: `${phase}s` }}>
        0
      </text>
      <text x={x} y={y} fill="var(--accent-mint)" style={{ animation: `sb-bit1 2.4s steps(1) infinite`, animationDelay: `${phase}s` }}>
        1
      </text>
    </g>
  )
  return (
    <svg viewBox="0 0 220 160" width="220" height="160" {...SVG_PROPS}>
      <path d="M20 60 h40 M20 100 h40 M60 44 h44 a28 28 0 0 1 0 64 h-44 z M132 76 h48" />
      <circle cx={192} cy={76} r={10} fill="var(--accent-mint)" stroke="none" style={{ animation: 'sb-glow 2.4s steps(1) infinite', animationDelay: '1.2s' }} />
      <circle cx={192} cy={76} r={10} />
      <Bit x={24} y={52} phase={0} />
      <Bit x={24} y={92} phase={-1.2} />
      <Bit x={188} y={116} phase={-1.2} />
      <text x={80} y={82} fontSize="11" stroke="none" fill="var(--foreground)" fontFamily="var(--font-jakarta)">
        AND
      </text>
    </svg>
  )
}

function GraphDemo() {
  return (
    <svg viewBox="0 0 220 160" width="220" height="160" {...SVG_PROPS}>
      {[40, 70, 100, 130].map((y) => (
        <line key={y} x1={24} y1={y} x2={204} y2={y} stroke="var(--border)" strokeWidth={1} />
      ))}
      <line x1={24} y1={20} x2={24} y2={140} stroke="var(--muted-foreground)" strokeWidth={1} />
      <line x1={24} y1={140} x2={204} y2={140} stroke="var(--muted-foreground)" strokeWidth={1} />
      <path
        d="M24 85 C 40 30, 56 30, 72 85 S 104 140, 120 85 S 152 30, 168 85 S 200 140, 204 110"
        stroke="var(--chart-1)"
        strokeWidth={2.2}
        pathLength={100}
        strokeDasharray="100"
        style={{ animation: 'sb-draw 3.2s linear infinite' }}
      />
      <path d="M24 110 C 45 80, 60 68, 90 66 S 160 62, 204 61" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="6 3" />
      <line x1={24} y1={61} x2={204} y2={61} stroke="var(--accent-rose)" strokeWidth={1.2} strokeDasharray="5 4" />
    </svg>
  )
}

function SketchDemo() {
  return (
    <svg viewBox="0 0 220 160" width="220" height="160" {...SVG_PROPS}>
      {/* wobbly hand-drawn circle */}
      <path
        d="M60 80 c -2 -22 18 -36 34 -33 c 18 3 26 16 24 33 c -2 19 -14 31 -30 30 c -17 -1 -26 -12 -28 -30 z"
        pathLength={100}
        strokeDasharray="100"
        style={{ animation: 'sb-draw 3s ease-in-out infinite' }}
      />
      <path d="M132 80 h28 m-8 -7 8 7 -8 7" stroke="var(--muted-foreground)" />
      <circle cx={186} cy={80} r={17} fill="color-mix(in oklch, var(--accent-blue) 22%, var(--card))" stroke="var(--accent-blue)" />
      <text x={186} y={122} textAnchor="middle" fontSize="10" stroke="none" fill="var(--muted-foreground)" fontFamily="var(--font-jakarta)">
        Rigid Body
      </text>
    </svg>
  )
}

function SpringDemo() {
  return (
    <svg viewBox="0 0 220 160" width="220" height="160" {...SVG_PROPS}>
      <path d="M80 14 h60" />
      <g style={{ transformOrigin: '110px 14px', animation: 'sb-stretch 1.8s ease-in-out infinite alternate' }}>
        <path d="M110 14 l0 8 l-10 6 l20 8 l-20 8 l20 8 l-20 8 l20 8 l-10 6 l0 8" stroke="var(--accent-mint)" />
      </g>
      <circle cx={110} cy={112} r={15} fill="color-mix(in oklch, var(--accent-blue) 22%, var(--card))" stroke="var(--accent-blue)" style={{ animation: 'sb-bob 1.8s ease-in-out infinite alternate' }} />
      <text x={140} y={70} fontSize="11" stroke="none" fill="var(--accent-amber)" fontFamily="var(--font-mono, monospace)">
        k = 20
      </text>
    </svg>
  )
}

const FEATURES = [
  ['Draw → simulate', 'Sketch a shape, attach a Rigid Body — it falls, collides, spins. A zigzag stroke is already a spring.'],
  ['Full circuit lab', 'Batteries, R/L/C, diodes, transistors, op-amps solved with real Kirchhoff analysis at 120 Hz.'],
  ['Doodles are wires', 'Ink that touches a terminal conducts — watch conventional current and electron flow move through it.'],
  ['Digital logic', 'Gates, adders, flip-flops, decoders — every pin shows its 0/1 live; click inputs while it runs.'],
  ['Formulas everywhere', 'Every field takes an expression. Define g, k, R once — sweep them mid-simulation.'],
  ['Probes & meters', 'Voltmeter, ammeter, probes and graphs with custom formulas, axes and reference lines.'],
  ['DSA Lab', 'Write real C++ in the notebook — an in-browser interpreter steps arrays, trees, graphs and sorts as live visualizations.'],
  ['AI that builds pages', 'Describe an experiment and the local AI agent assembles it from real components — private, on your own machine.'],
  ['Docs, boards & PDFs', 'Infinite whiteboards, paged documents that export to PDF, and annotatable PDF/PPT readers — side by side in tabs.'],
] as const

export function Landing() {
  return (
    <ScrollFx>
    <div className="min-h-screen bg-background text-foreground">
      <style>{`
        @keyframes sb-swing { from { transform: rotate(-26deg) } to { transform: rotate(26deg) } }
        @keyframes sb-flow { to { stroke-dashoffset: -32 } }
        @keyframes sb-flow-rev { to { stroke-dashoffset: 32 } }
        @keyframes sb-glow { 0%, 100% { opacity: .12 } 50% { opacity: .5 } }
        @keyframes sb-draw { 0% { stroke-dashoffset: 100 } 55%, 100% { stroke-dashoffset: 0 } }
        @keyframes sb-bit0 { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        @keyframes sb-bit1 { 0%, 49% { opacity: 0 } 50%, 100% { opacity: 1 } }
        @keyframes sb-stretch { from { transform: scaleY(.82) } to { transform: scaleY(1.18) } }
        @keyframes sb-bob { from { transform: translateY(-16px) } to { transform: translateY(16px) } }
      `}</style>

      {/* Floating liquid-glass nav — chrome as a material, content flows under */}
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="progressive-blur-top !h-16" />
        <div className="relative flex items-center justify-between px-4 py-3 sm:px-8">
          <span className="liquid-glass rounded-full px-4 py-1.5 text-ui-lg font-bold tracking-tight">
            SIM<span className="text-[var(--accent-blue)]">BLIP</span>
          </span>
          <nav className="liquid-glass hidden items-center gap-1 rounded-full p-1 md:flex">
            {[
              ['#new', "What's new"],
              ['#demos', 'Demos'],
              ['#light', 'Physics'],
              ['#classroom', 'Classroom'],
              ['#pricing', 'Licensing'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-3.5 py-1.5 text-ui-xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
          <SignInLink
            signedOutLabel="Sign in"
            className="rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-ui-sm font-semibold text-primary-foreground shadow-[0_8px_24px_color-mix(in_oklch,var(--accent-blue)_45%,transparent)] transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
          />
        </div>
      </header>

      {/* Hero — full-bleed, left-anchored editorial type with a live demo rail */}
      <section className="canvas-dots relative min-h-[92svh] overflow-hidden [background-size:24px_24px]">
        <HeroBallpit />
        <div className="relative grid min-h-[92svh] items-end gap-10 px-4 pb-14 pt-28 sm:px-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:pb-20">
          <div data-fx="hero">
            <h1 className="mt-4 max-w-[13ch] text-[clamp(2.6rem,7.5vw,6rem)] font-bold leading-[0.98] tracking-[-0.03em]">
              Your <span className="text-[var(--accent-blue)]">drawings</span> become{' '}
              <span className="text-[var(--accent-mint)]">experiments</span>
            </h1>
            <p className="mt-6 max-w-xl text-pretty text-ui-lg leading-relaxed text-muted-foreground sm:text-ui-xl">
              Sketch mechanics, wire circuits, build logic, fire photons at a double slit — then
              press Play. One canvas, real physics, real Kirchhoff, real interference. Everything
              editable while it runs.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <SignInLink
                signedOutLabel="Sign in to your institution"
                className="rounded-full bg-[var(--accent-blue)] px-7 py-3 text-ui-md font-semibold text-primary-foreground shadow-[0_12px_36px_color-mix(in_oklch,var(--accent-blue)_50%,transparent)] transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
              />
              <a
                href="#demos"
                className="liquid-glass rounded-full px-7 py-3 text-ui-md font-medium text-foreground transition-transform active:scale-[0.97]"
              >
                See it in action
              </a>
            </div>
          </div>
        </div>
        <div className="progressive-blur-bottom !h-20" />
      </section>

      {/* Discipline strip — edge to edge */}
      <section className="border-y border-border/50 px-4 py-6 sm:px-8">
        <div data-fx="domino" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            ['Mechanics', 'Rigid bodies, springs, hinges, motors — drawn, then simulated.'],
            ['Circuits', 'Kirchhoff-solved R/L/C, diodes, op-amps at 120 Hz.'],
            ['Digital logic', 'Gates to flip-flops, every pin live.'],
            ['Electromagnetics', 'Waves, fields and photons at real dimensions.'],
            ['Quantum', 'Double-slit photons, wells, tunneling barriers.'],
            ['Algorithms', 'C++ runs in the page — data structures animate live.'],
          ].map(([t, b]) => (
            <div key={t} className="glass rounded-2xl p-4 text-left">
              <p className="text-ui-sm font-bold">{t}</p>
              <p className="mt-1 text-ui-2xs leading-relaxed text-muted-foreground">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What's new — the platform's latest capabilities, front and center. */}
      <section id="new" className="px-4 py-16 sm:px-8">
        <div data-fx="rise" className="mb-8">
          
          <h2 className="mt-3 max-w-[18ch] text-[clamp(1.8rem,4vw,3rem)] font-bold leading-[1.02] tracking-[-0.02em]">
            More than a whiteboard now
          </h2>
        </div>
        <div data-fx="domino" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['DSA Lab', 'A C++ interpreter lives inside the notebook. Step through your own code and watch arrays, stacks, trees and graph traversals animate as textbook-quality visualizations.', 'var(--accent-violet)'],
            ['Local AI agent', 'Ask for “a projectile hitting a spring on an incline” and the on-device AI assembles it from real simulation components. Nothing leaves your machine.', 'var(--accent-blue)'],
            ['Docs & PDF notebooks', 'Pages now come in three kinds — infinite Board, paged Doc that exports to high-quality PDF, and uploaded PDF/PPT you annotate with the pen.', 'var(--accent-amber)'],
            ['Tabs & split screen', 'Open several boards, docs and PDFs at once in header tabs, drop any two side by side in a resizable split, and take linked per-page notes.', 'var(--accent-mint)'],
          ].map(([t, b, c]) => (
            <div key={t} className="liquid-glass rounded-2xl p-5">
              <p className="text-ui-sm font-bold" style={{ color: c }}>{t}</p>
              <p className="mt-1.5 text-ui-xs leading-relaxed text-muted-foreground">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="demos" className="border-t border-border/60 px-4 py-16 sm:px-8">
        <div data-fx="rise" className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h2 className="max-w-[16ch] text-[clamp(1.8rem,4vw,3rem)] font-bold leading-[1.02] tracking-[-0.02em]">
            Six things your paper notebook can&apos;t do
          </h2>
          <p className="max-w-sm text-ui-sm leading-relaxed text-muted-foreground">
            Every card below is the real engine rendered small — the same solver, the same ink,
            the same math you get on the canvas.
          </p>
        </div>
        <div data-fx="domino" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <DemoCard title="Mechanics that obey you" caption="Pendulums, springs, collisions — gravity and air drag are just variables you edit, even mid-swing.">
          <PendulumDemo />
        </DemoCard>
        <DemoCard title="Electricity you can see" caption="Amber dashes are conventional current; blue dots are the electrons drifting the other way. Speed tracks the real amps.">
          <CircuitDemo />
        </DemoCard>
        <DemoCard title="Logic in real time" caption="Every pin wears its 0 or 1. Toggle inputs with a click while the clock runs.">
          <LogicDemo />
        </DemoCard>
        <DemoCard title="Draw it, don't place it" caption="Freehand recognition turns sketches into circles, rects, springs and wires — meaning comes from behaviors.">
          <SketchDemo />
        </DemoCard>
        <DemoCard title="Springs on a leash of math" caption="Stiffness is an expression. Type k = 20, plot ω₀ = √(k/m), then change k and watch both react.">
          <SpringDemo />
        </DemoCard>
        <DemoCard title="Graphs that do algebra" caption="Plot channels, your own formulas, phase portraits — with custom axes, scales and reference lines.">
          <GraphDemo />
        </DemoCard>
        </div>
      </section>

      {/* Wave & quantum nature of light — the physics is computed, not drawn. */}
      <section id="light" className="border-t border-border/60 px-4 py-16 sm:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div data-fx="rise">
            <h2 className="max-w-[14ch] text-[clamp(1.8rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.02em]">
              Light that behaves like <span className="text-[var(--accent-violet)]">light</span>
            </h2>
            <p className="mt-4 text-ui-md leading-relaxed text-muted-foreground sm:text-ui-lg">
              Build a double-slit experiment on the canvas — a coherent source, a slit mask, a
              screen — and SIMBLIP performs a Huygens–Fresnel phasor sum over the open apertures
              at real dimensions (1 px = 1 µm). The single-slit diffraction envelope and the
              cos² fringes emerge from the wave equation, not from a picture of them. Press Play
              and photons land one at a time at Born-rule positions, building the interference
              pattern from individual detections — the experiment that defines quantum mechanics,
              reproduced faithfully in your notebook.
            </p>
          </div>
          <div data-fx="domino" className="grid content-center gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              ['Huygens–Fresnel', 'Every open slit is summed as secondary wavelets — Σ e^{ikr}/√r. Change λ, gap or spacing and the fringes respond exactly as theory predicts.'],
              ['Born rule photons', 'In Play mode single photons accumulate stochastically from |A|². Watch randomness become the interference pattern.'],
              ['Wells & barriers', 'Particle-in-a-box eigenstates and tunneling transmission, solved from the Schrödinger picture with live parameters.'],
            ].map(([t, b]) => (
              <div key={t} className="liquid-glass rounded-2xl p-5">
                <p className="text-ui-sm font-bold text-[var(--accent-violet)]">{t}</p>
                <p className="mt-1.5 text-ui-xs leading-relaxed text-muted-foreground">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Classroom platform */}
      <section id="classroom" className="border-t border-border/60 bg-card/40 px-4 py-16 sm:px-8 lg:py-24">
        <div data-fx="rise" className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="max-w-[18ch] text-[clamp(1.8rem,4vw,3rem)] font-bold leading-[1.05] tracking-[-0.02em]">
            A whole <span className="text-[var(--accent-blue)]">classroom</span> operating system
          </h2>
          <p className="max-w-md text-ui-md leading-relaxed text-muted-foreground">
            SIMBLIP is not a lone notebook — it is the environment an engineering institution
            runs on. Teachers teach from it, boards present it, students submit through it.
          </p>
        </div>
        <div data-fx="domino" className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['1 · Scan', 'Every classroom display shows a rotating QR. A teacher scans it with their phone and picks any notebook page.'],
            ['2 · Present', 'The board loads a temporary copy — annotate, simulate, rewind. The original teaching material is never touched.'],
            ['3 · Assign', 'Any page becomes an assignment. Each student gets their own working copy and submits from their notebook.'],
            ['4 · Review', 'A live dashboard tracks opened → in progress → submitted → reviewed, with feedback flowing back instantly.'],
          ].map(([t, b], i) => (
            <div key={t} className={cnStep(i)}>
              <p className="text-ui-sm font-bold">{t}</p>
              <p className="mt-1.5 text-ui-xs leading-relaxed text-muted-foreground">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border/60 px-4 py-16 sm:px-8">
        <div data-fx="domino" className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([title, body]) => (
            <div key={title} className="border-l-2 border-[color-mix(in_oklch,var(--accent-blue)_35%,transparent)] pl-4">
              <h3 className="text-ui-md font-semibold">{title}</h3>
              <p className="mt-1 text-ui-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" data-fx="rise" className="relative overflow-hidden border-t border-border/60 px-4 py-20 sm:px-8 lg:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_30%_20%,color-mix(in_oklch,var(--accent-blue)_10%,transparent),transparent)]" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center">
          <div>
            <h2 className="max-w-[16ch] text-[clamp(2rem,5vw,3.6rem)] font-bold leading-[1.02] tracking-[-0.025em]">
              Built for <span className="text-[var(--accent-blue)]">institutions</span>, not accounts
            </h2>
            <p className="mt-4 max-w-2xl text-pretty text-ui-md leading-relaxed text-muted-foreground sm:text-ui-lg">
              SIMBLIP is licensed to universities, colleges and schools as a complete engineering
              education platform — role-based workspaces for admins, teachers and students,
              QR-paired classroom boards, an institution library, and a live assignment workflow.
              There is no public sign-up: your institution is provisioned for you, branded as
              yours.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <a
              href="mailto:licensing@simblip.app?subject=SIMBLIP%20institution%20licensing"
              className="rounded-full bg-[var(--accent-blue)] px-8 py-3.5 text-ui-lg font-semibold text-primary-foreground shadow-[0_12px_36px_color-mix(in_oklch,var(--accent-blue)_50%,transparent)] transition-[opacity,transform] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
            >
              Contact us for licensing
            </a>
            <SignInLink
              signedOutLabel="Already licensed? Sign in"
              className="liquid-glass rounded-full px-8 py-3.5 text-ui-lg font-medium text-foreground transition-transform active:scale-[0.97]"
            />
          </div>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 px-4 py-8 text-ui-xs text-muted-foreground sm:px-8">
        <span>
          © {new Date().getFullYear()} SIMBLIP · Built by Rohan Singh
        </span>
        <SignInLink signedOutLabel="Sign in →" signedInLabel="Open notebook →" className="hover:text-foreground" />
      </footer>
    </div>
    </ScrollFx>
  )
}

/** Step cards alternate glass weights so the row reads as a path, not a grid. */
const cnStep = (i: number) =>
  i % 2 === 0 ? 'liquid-glass rounded-2xl p-5' : 'glass rounded-2xl p-5'
