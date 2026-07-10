// Landing page — live-feeling demos of what the notebook actually does,
// rendered with the same design tokens (glass, canvas dots, accents) as the
// workspace, so the marketing page IS the product's UI.

import Link from 'next/link'

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
        <h3 className="text-[14px] font-semibold">{title}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{caption}</p>
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
] as const

export function Landing() {
  return (
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

      <header className="glass sticky top-0 z-50 flex items-center justify-between px-6 py-3">
        <span className="text-[15px] font-bold tracking-tight">
          SIM<span className="text-[var(--accent-blue)]">BLIP</span>
        </span>
        <Link
          href="/login"
          className="rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
      </header>

      <section className="canvas-dots px-6 pb-16 pt-20 text-center [background-size:24px_24px]">
        <h1 className="mx-auto max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          The notebook where your <span className="text-[var(--accent-blue)]">drawings</span> become{' '}
          <span className="text-[var(--accent-mint)]">experiments</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground">
          Sketch mechanics, wire circuits, build logic — then press Play. One canvas, real
          physics, real Kirchhoff, real waveforms. Everything editable while it runs.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-full bg-[var(--accent-blue)] px-6 py-2.5 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Sign in to your institution
          </Link>
          <a
            href="#demos"
            className="rounded-full border border-border px-6 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            See it in action
          </a>
        </div>
      </section>

      <section id="demos" className="mx-auto grid max-w-5xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-3">
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
      </section>

      <section className="border-t border-border/60 bg-card/40 px-6 py-16">
        <div className="mx-auto grid max-w-5xl gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([title, body]) => (
            <div key={title}>
              <h3 className="text-[14px] font-semibold">{title}</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="border-t border-border/60 px-6 py-16 text-center">
        <h2 className="mx-auto max-w-2xl text-balance text-3xl font-bold tracking-tight">
          Built for <span className="text-[var(--accent-blue)]">institutions</span>, not accounts
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-[14px] leading-relaxed text-muted-foreground">
          SIMBLIP is licensed to universities, colleges and schools as a complete engineering
          education platform — role-based workspaces for admins, teachers and students, QR-paired
          classroom boards, an institution library, and a live assignment workflow. There is no
          public sign-up: your institution is provisioned for you, branded as yours.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <a
            href="mailto:licensing@simblip.app?subject=SIMBLIP%20institution%20licensing"
            className="rounded-full bg-[var(--accent-blue)] px-6 py-2.5 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Contact us for licensing
          </a>
          <Link
            href="/login"
            className="rounded-full border border-border px-6 py-2.5 text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Already licensed? Sign in
          </Link>
        </div>
      </section>

      <footer className="flex items-center justify-between px-6 py-8 text-[12px] text-muted-foreground">
        <span>
          © {new Date().getFullYear()} SIMBLIP · Built by Rohan Singh
        </span>
        <Link href="/login" className="hover:text-foreground">
          Sign in →
        </Link>
      </footer>
    </div>
  )
}
