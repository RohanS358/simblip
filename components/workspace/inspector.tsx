'use client'

// Blender-style inspector — and the conversion surface of the whole app.
// "Convert to physics object" = attaching a behavior here. Every numeric
// field accepts an expression against the page's variable scope.

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Link2,
  Link,
  Maximize2,
  Plus,
  Trash2,
  Upload,
  X,
  Zap,
  ZapOff,
  Navigation2,
  Route,
  Weight,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  Code,
  Pilcrow,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  ChevronDown,
} from 'lucide-react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useDocStore } from '@/lib/store/document'
import { readBuffer } from '@/lib/physics/bus'
import { parseSeries, GRAPH_COLORS, type GraphSeries } from '@/components/objects/graph'
import { FILLS } from '@/components/objects/text'
import { TEXT_COLORS, TEXT_SIZES } from '@/lib/text/markdown'
import { useActiveTextEditor } from '@/lib/store/text-editor'
import {
  parseSeries as parseChartSeries,
  serializeSeries as serializeChartSeries,
  splitList as splitChartLabels,
  CHART_TYPES,
  type ChartType,
  type Series as ChartDataSeries,
} from '@/components/objects/chart'
import { isBody } from '@/lib/behaviors/registry'
import { specsForGeometry, behaviorSpec, NO_BEHAVIOR_KINDS } from '@/lib/behaviors/registry'
import { recommendedHeight } from '@/lib/circuit/engine'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { num, str, type SceneObject } from '@/lib/scene/types'
import { getString, getNumber } from '@/components/objects/types'
import { getObjectParams } from '@/lib/scene/control-targets'
import { readSpec, parseYear, fmtYear, type CashflowSpec } from '@/lib/econ/engine'
import {
  parseFormula,
  derivativeSteps,
  integralSteps,
  iteratedIntegralSteps,
  laplaceSteps,
  fourierSteps,
} from '@/lib/formula/steps'
import { channelsFor, CHANNEL_LABELS } from '@/lib/scene/channels'
import { pxToCmRounded, cmToPx } from '@/lib/scene/units'
import { truthCandidates, MAX_INPUTS } from '@/lib/circuit/truth-table'
import { InfoPopover } from './info-popover'

/** Commits on blur/Enter — mid-typing never hits the engine. Figma-style:
 * a single click never enters text edit — only a double-click does. A
 * plain click-drag instead SCRUBS a purely numeric value (right = up, left
 * = down; hold Shift for coarse, Alt for fine), committing live so the
 * canvas follows the drag, exactly like dragging a resize handle — see the
 * pushHistory coalescing in lib/store/document.ts for why that's safe to
 * call on every pointermove instead of just on release. Non-numeric values
 * (an expression, a variable name) simply aren't scrubbable; double-click
 * still edits them normally. */
function ExprInput({
  value,
  onCommit,
  error,
  ariaLabel,
  placeholder,
  mono = true,
  scrubbable = true,
}: {
  value: string
  onCommit: (value: string) => void
  error?: string
  ariaLabel: string
  placeholder?: string
  mono?: boolean
  scrubbable?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ startX: number; startVal: number; dragged: boolean } | null>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      aria-invalid={Boolean(error)}
      placeholder={placeholder}
      className={cn(
        'w-full min-w-0 rounded-md border bg-background/60 px-2 py-1 text-[12px] outline-none transition-colors focus:border-[var(--ring)]',
        mono && 'font-mono',
        error ? 'border-[var(--accent-rose)]' : 'border-input',
        scrubbable && 'cursor-ew-resize'
      )}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onPointerDown={(e) => {
        if (!scrubbable || e.button !== 0) return
        // Don't capture yet — capturing would steal the click that focuses
        // the field. We only take over once the pointer actually moves.
        dragRef.current = { startX: e.clientX, startVal: Number(draft), dragged: false }
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        const dx = e.clientX - drag.startX
        if (!drag.dragged) {
          if (Math.abs(dx) < 4) return // still just a click
          drag.dragged = true
          e.currentTarget.setPointerCapture(e.pointerId)
          e.currentTarget.blur() // hand the gesture to the scrubber
        }
        const sensitivity = e.shiftKey ? 5 : e.altKey ? 0.05 : 0.5
        const next = String(Math.round((drag.startVal + dx * sensitivity) * 1000) / 1000)
        setDraft(next)
        onCommit(next)
      }}
      onPointerUp={(e) => {
        const drag = dragRef.current
        dragRef.current = null
        if (drag?.dragged) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } else {
          // A plain click: select everything so typing replaces the value,
          // which is what you want on a numeric field.
          requestAnimationFrame(() => inputRef.current?.select())
        }
      }}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          e.currentTarget.blur()
        }
        // Arrow keys nudge a numeric value, like every other design tool.
        if (scrubbable && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : e.altKey ? 0.01 : 1
          const next = String(
            Math.round((Number(draft) + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000
          )
          setDraft(next)
          onCommit(next)
        }
        e.stopPropagation()
      }}
    />
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  )
}

const TRACER_PARAMS = [
  { name: 'showMotion', label: 'Motion', icon: Navigation2, color: 'var(--accent-mint)', hint: 'Velocity + acceleration arrows, magnitude labeled' },
  { name: 'showTrail', label: 'Trail', icon: Route, color: 'var(--accent-blue)', hint: 'Dashed line tracing the path taken' },
  { name: 'showForces', label: 'Forces', icon: Weight, color: 'var(--accent-rose)', hint: 'Weight, applied force, tension, contact & drag arrows' },
] as const

function TracerToggle({
  label,
  icon: Icon,
  color,
  on,
  hint,
  onClick,
}: {
  label: string
  icon: typeof Navigation2
  color: string
  on: boolean
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Tracer: ${label}`}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] font-medium transition-colors',
        on ? 'border-transparent' : 'border-border/70 text-muted-foreground hover:text-foreground'
      )}
      style={
        on
          ? { background: `color-mix(in oklch, ${color} 22%, transparent)`, color, borderColor: color }
          : undefined
      }
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="flex min-w-0 max-w-full items-center gap-1">
        <span className="truncate">{label}</span>
        <span className="shrink-0" onPointerDown={(e) => e.stopPropagation()}>
          <InfoPopover description={hint} />
        </span>
      </span>
    </button>
  )
}

function BehaviorsSection({ pageId, object }: { pageId: string; object: SceneObject }) {
  const addBehavior = useDocStore((s) => s.addBehavior)
  const removeBehavior = useDocStore((s) => s.removeBehavior)
  const toggleBehavior = useDocStore((s) => s.toggleBehavior)
  const setBehaviorParam = useDocStore((s) => s.setBehaviorParam)

  const available = specsForGeometry(object.geometry.kind).filter(
    (spec) => !object.behaviors.some((b) => b.type === spec.type)
  )

  return (
    <div>
      <SectionTitle>Behaviors</SectionTitle>
      {object.behaviors.length === 0 && (
        <p className="mb-2 rounded-lg bg-accent/40 p-2 text-[11.5px] leading-relaxed text-muted-foreground">
          This is a drawing. Attach a behavior to make it real — a Rigid Body
          falls and collides, a Spring connects what it touches.
        </p>
      )}

      <div className="space-y-2">
        {object.behaviors.map((b) => {
          const spec = behaviorSpec(b.type)
          return (
            <div key={b.id} className="rounded-xl border border-border/70 p-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'flex-1 text-[12px] font-semibold',
                    !b.enabled && 'text-muted-foreground line-through'
                  )}
                >
                  {spec?.label ?? b.type}
                </span>
                {spec && !spec.live && (
                  <span className="rounded bg-accent px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                    solver soon
                  </span>
                )}
                <button
                  type="button"
                  aria-label={b.enabled ? 'Disable behavior' : 'Enable behavior'}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => toggleBehavior(pageId, object.id, b.id)}
                >
                  {b.enabled ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  aria-label="Remove behavior"
                  className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-rose)]"
                  onClick={() => removeBehavior(pageId, object.id, b.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {b.type === 'rigidBody' && (
                <div className="mt-1.5 border-t border-border/50 pt-1.5">
                  <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Tracers · off by default
                  </p>
                  <div className="flex gap-1.5">
                    {TRACER_PARAMS.map((tp) => {
                      const p = b.params[tp.name]
                      const on = p?.kind === 'number' && p.value !== 0
                      return (
                        <TracerToggle
                          key={tp.name}
                          label={tp.label}
                          icon={tp.icon}
                          color={tp.color}
                          hint={tp.hint}
                          on={on}
                          onClick={() => setBehaviorParam(pageId, object.id, b.id, tp.name, on ? '0' : '1')}
                        />
                      )
                    })}
                  </div>
                </div>
              )}

              {(spec?.params ?? [])
                .filter((ps) => !TRACER_PARAMS.some((tp) => tp.name === ps.name))
                .map((ps) => {
                const p = b.params[ps.name]
                if (!p || p.kind !== 'number') return null
                if (ps.name === 'collide') {
                  const on = p.value !== 0
                  return (
                    <div key={ps.name} className="mt-1.5 flex items-center gap-2">
                      <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground" title={ps.label}>
                        Collides
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={ps.label}
                        onClick={() => setBehaviorParam(pageId, object.id, b.id, ps.name, on ? '0' : '1')}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors',
                          on
                            ? 'bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]'
                            : 'bg-accent text-muted-foreground'
                        )}
                      >
                        {on ? 'On' : 'Off'}
                      </button>
                    </div>
                  )
                }
                return (
                  <div key={ps.name} className="mt-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground" title={ps.label}>
                        {ps.label}
                      </span>
                      <ExprInput
                        ariaLabel={`${spec?.label} ${ps.label}`}
                        value={p.expr}
                        error={p.error}
                        onCommit={(v) => setBehaviorParam(pageId, object.id, b.id, ps.name, v)}
                      />
                      <span className="w-14 shrink-0 truncate text-right font-mono text-[10px] text-[var(--accent-amber)]">
                        {Number.isFinite(p.value) ? +p.value.toFixed(3) : '—'}
                      </span>
                    </div>
                    {p.error && (
                      <p className="ml-[5.5rem] mt-0.5 text-[10px] text-[var(--accent-rose)]">{p.error}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {available.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Add behavior
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="glass-strong w-64">
            {available.map((spec) => (
              <DropdownMenuItem
                key={spec.type}
                className="flex-col items-start gap-0 py-2"
                onClick={() => addBehavior(pageId, object.id, spec.type)}
              >
                <span className="text-[12.5px] font-medium">
                  {spec.label}
                  {!spec.live && (
                    <span className="ml-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                      solver soon
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground">{spec.hint}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

const GRAPH_CHANNELS = ['x', 'y', 'vx', 'vy', 'speed', 'angle', 'omega', 'ke']

// Component models: symbols whose pin layout is selectable. The chosen
// input count lives in an `inputs` param; terminals, glyph and solver all
// follow it (lib/circuit/engine.ts terminalsOf).
const GATE_MODELS = [2, 3, 4, 5, 6, 8].map((n) => ({ value: n, label: `${n}-input` }))
const MODEL_OPTIONS: Record<string, { value: number; label: string }[]> = {
  'and-gate': GATE_MODELS,
  'or-gate': GATE_MODELS,
  'xor-gate': GATE_MODELS,
  'nand-gate': GATE_MODELS,
  'nor-gate': GATE_MODELS,
  mux: [
    { value: 2, label: '2:1 (1 select)' },
    { value: 4, label: '4:1 (2 selects)' },
  ],
  demux: [
    { value: 2, label: '1:2 (1 select)' },
    { value: 4, label: '1:4 (2 selects)' },
  ],
  decoder: [
    { value: 2, label: '2:4' },
    { value: 3, label: '3:8' },
  ],
  encoder: [
    { value: 4, label: '4:2' },
    { value: 8, label: '8:3' },
  ],
  register4: [
    { value: 0, label: 'SISO' },
    { value: 1, label: 'SIPO' },
    { value: 2, label: 'PISO' },
    { value: 3, label: 'PIPO' },
  ],
}

const getStr = (obj: SceneObject, name: string): string => {
  const p = obj.parameters[name]
  return p?.kind === 'string' ? p.value : ''
}

const splitList = (s: string) =>
  s
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)

const selectCls =
  'w-full min-w-0 rounded-md border border-input bg-background/60 px-1.5 py-1 text-[11.5px] outline-none focus:border-[var(--ring)]'

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
      onClick={onClick}
    >
      <Plus className="h-3 w-3" /> {label}
    </button>
  )
}

/** Column picker for the Truth Table — which of the circuit's inputs and
 *  outputs to tabulate. The table itself is produced by simulating every
 *  combination (lib/circuit/truth-table.ts). */
function TruthTableOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pageObjects = useDocStore((s) => s.pages[pageId]?.objects) ?? {}
  const { sources, sinks } = truthCandidates(Object.values(pageObjects))

  const picked = (param: 'inputs' | 'outputs') => splitList(getStr(object, param))
  const toggle = (param: 'inputs' | 'outputs', id: string) => {
    const cur = picked(param)
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    setStringParam(pageId, object.id, param, next.join('; '))
  }

  const list = (
    param: 'inputs' | 'outputs',
    items: SceneObject[],
    empty: string,
    color: string
  ) => {
    const chosen = picked(param)
    return items.length === 0 ? (
      <p className="text-[11.5px] text-muted-foreground">{empty}</p>
    ) : (
      <div className="space-y-1">
        {items.map((o) => {
          const on = chosen.includes(o.id)
          return (
            <button
              key={o.id}
              type="button"
              role="switch"
              aria-checked={on}
              className="flex w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-[12px] transition-colors"
              style={{
                borderColor: on ? color : 'var(--border)',
                color: on ? 'var(--foreground)' : 'var(--muted-foreground)',
                background: on ? `color-mix(in oklch, ${color} 10%, transparent)` : 'transparent',
              }}
              onClick={() => toggle(param, o.id)}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: on ? color : 'var(--border)' }}
              />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="shrink-0 font-mono text-[10px] opacity-60">
                {o.geometry.symbol}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  const nIn = picked('inputs').length

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionTitle>Inputs</SectionTitle>
        {list('inputs', sources, 'Add a logic Input or Switch to the circuit.', 'var(--chart-1)')}
        {nIn > MAX_INPUTS && (
          <p className="text-[10.5px] text-[var(--accent-rose)]">
            Too many inputs — {MAX_INPUTS} max ({1 << MAX_INPUTS} rows).
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Outputs</SectionTitle>
        {list('outputs', sinks, 'Add an Output, logic probe, LED or bulb.', 'var(--chart-2)')}
      </div>

      <p className="text-[10.5px] leading-relaxed text-muted-foreground">
        Every combination of the chosen inputs is simulated on the real circuit
        {nIn > 0 && nIn <= MAX_INPUTS ? ` — ${1 << nIn} rows` : ''}. Rewire a gate and the table
        updates itself.
      </p>
    </div>
  )
}

/** Visual editor for the Cash Flow object. Years accept fractions — "1/2"
 *  for semiannual, "1/4" for quarterly — everything else is plain money. */
function CashflowOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const spec = readSpec(getStr(object, 'spec'))
  const write = (next: CashflowSpec) =>
    setStringParam(pageId, object.id, 'spec', JSON.stringify(next))

  const field =
    'w-full min-w-0 rounded-md border border-input bg-background/60 px-1.5 py-1 font-mono text-[11.5px] outline-none focus:border-[var(--ring)]'

  /** Year cell: keeps the raw text so "1/2" survives while you type. */
  const YearInput = ({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) => (
    <input
      aria-label={label}
      className={field}
      defaultValue={fmtYear(value)}
      key={fmtYear(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        e.stopPropagation()
      }}
      onBlur={(e) => onCommit(parseYear(e.target.value, value))}
    />
  )
  const MoneyInput = ({ value, onCommit, label }: { value: number; onCommit: (v: number) => void; label: string }) => (
    <input
      aria-label={label}
      type="number"
      className={field}
      defaultValue={value}
      key={value}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        e.stopPropagation()
      }}
      onBlur={(e) => {
        const v = Number(e.target.value)
        if (Number.isFinite(v)) onCommit(v)
      }}
    />
  )
  const Head = ({ children }: { children: React.ReactNode }) => (
    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionTitle>Description</SectionTitle>
        <ExprInput
          ariaLabel="Cash flow description"
          mono={false}
          placeholder="e.g. Machine A — 4-year purchase"
          value={spec.description}
          onCommit={(v) => write({ ...spec, description: v })}
        />
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Discrete investment</SectionTitle>
        <Head>
          <span>Year</span>
          <span>Amount (+ up / − down)</span>
          <span className="w-4" />
        </Head>
        {spec.discrete.map((d, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
            <YearInput
              label={`Discrete ${idx + 1} year`}
              value={d.t}
              onCommit={(t) => write({ ...spec, discrete: spec.discrete.map((x, k) => (k === idx ? { ...x, t } : x)) })}
            />
            <MoneyInput
              label={`Discrete ${idx + 1} amount`}
              value={d.amount}
              onCommit={(amount) =>
                write({ ...spec, discrete: spec.discrete.map((x, k) => (k === idx ? { ...x, amount } : x)) })
              }
            />
            <button
              type="button"
              aria-label={`Remove discrete investment ${idx + 1}`}
              className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-rose)]"
              onClick={() => write({ ...spec, discrete: spec.discrete.filter((_, k) => k !== idx) })}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <AddRowButton
          label="Add another"
          onClick={() => write({ ...spec, discrete: [...spec.discrete, { t: 0, amount: -100 }] })}
        />
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Annuity</SectionTitle>
        {spec.annuities.map((a, idx) => (
          <div key={idx} className="space-y-1 rounded-xl border border-border/60 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Series {idx + 1}
              </span>
              <button
                type="button"
                aria-label={`Remove annuity ${idx + 1}`}
                className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-rose)]"
                onClick={() => write({ ...spec, annuities: spec.annuities.filter((_, k) => k !== idx) })}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Starting year</span>
                <YearInput
                  label={`Annuity ${idx + 1} start`}
                  value={a.start}
                  onCommit={(start) =>
                    write({ ...spec, annuities: spec.annuities.map((x, k) => (k === idx ? { ...x, start } : x)) })
                  }
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Time period (yrs)</span>
                <YearInput
                  label={`Annuity ${idx + 1} periods`}
                  value={a.periods}
                  onCommit={(periods) =>
                    write({ ...spec, annuities: spec.annuities.map((x, k) => (k === idx ? { ...x, periods } : x)) })
                  }
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Every (1, 1/2, 1/4)</span>
                <YearInput
                  label={`Annuity ${idx + 1} interval`}
                  value={a.every}
                  onCommit={(every) =>
                    write({
                      ...spec,
                      annuities: spec.annuities.map((x, k) => (k === idx ? { ...x, every: every > 0 ? every : 1 } : x)),
                    })
                  }
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">Amount</span>
                <MoneyInput
                  label={`Annuity ${idx + 1} amount`}
                  value={a.amount}
                  onCommit={(amount) =>
                    write({ ...spec, annuities: spec.annuities.map((x, k) => (k === idx ? { ...x, amount } : x)) })
                  }
                />
              </label>
            </div>
          </div>
        ))}
        <AddRowButton
          label="Add another"
          onClick={() =>
            write({ ...spec, annuities: [...spec.annuities, { start: 0, periods: 5, every: 1, amount: 100 }] })
          }
        />
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Salvage value</SectionTitle>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11px] text-muted-foreground">Amount</span>
          <MoneyInput label="Salvage value" value={spec.salvage} onCommit={(salvage) => write({ ...spec, salvage })} />
        </div>
        <p className="text-[10.5px] text-muted-foreground">Received at the end of the analysis horizon.</p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>MARR</SectionTitle>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11px] text-muted-foreground">Percentage</span>
          <MoneyInput label="MARR percent" value={spec.marr} onCommit={(marr) => write({ ...spec, marr })} />
          <span className="text-[11px] text-muted-foreground">%</span>
        </div>
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          Discount rate for PW / FW / AW. Years accept fractions —{' '}
          <span className="font-mono">1/2</span> is semiannual, <span className="font-mono">1/4</span> quarterly.
        </p>
      </div>
    </div>
  )
}

/** Formula card — d/dx, ∫dx, Laplace and Fourier actions live here instead
 *  of on the card itself so the canvas stays uncluttered; the worked
 *  solution still renders inside the card. */
function FormulaOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const latex = getStr(object, 'latex')
  const solution = getStr(object, 'solution')

  const parsed = useMemo(() => parseFormula(latex), [latex])
  const boundedVars = parsed ? parsed.vars.filter((v) => parsed.bounds[v]) : []

  const solve = (kind: 'd' | 'i' | 'ii' | 'L' | 'F', v?: string) => {
    if (!parsed) return
    pushHistory(pageId)
    try {
      const steps =
        kind === 'd'
          ? derivativeSteps(parsed, v!)
          : kind === 'ii'
            ? iteratedIntegralSteps(parsed)
            : kind === 'L'
              ? laplaceSteps(parsed, v!)
              : kind === 'F'
                ? fourierSteps(parsed, v!)
                : integralSteps(parsed, v!)
      setStringParam(pageId, object.id, 'solution', steps)
    } catch {
      setStringParam(pageId, object.id, 'solution', `\\text{could not solve — check the expression}`)
    }
  }

  const ToolBtn = ({
    label,
    description,
    onClick,
  }: {
    label: string
    description: string
    onClick: () => void
  }) => (
    <span className="flex items-center gap-0.5 rounded-lg border border-border/70 pl-0.5">
      <button
        type="button"
        className="rounded-md px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={onClick}
      >
        {label}
      </button>
      <InfoPopover description={description} />
    </span>
  )

  return (
    <div className="space-y-1.5">
      <SectionTitle>Calculus</SectionTitle>
      {!parsed ? (
        <p className="rounded-lg bg-accent/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
          Write <span className="font-mono">f(x) = x^2 + 3*x, 10&lt;x&lt;20</span> on the card (bounds
          optional, several variables → partials) to unlock solving.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1">
            {parsed.vars.map((v) => (
              <ToolBtn
                key={`d${v}`}
                label={parsed.vars.length > 1 ? `∂/∂${v}` : `d/d${v}`}
                description={`Differentiate the expression with respect to ${v}.`}
                onClick={() => solve('d', v)}
              />
            ))}
            {parsed.vars.map((v) => (
              <ToolBtn
                key={`i${v}`}
                label={`∫d${v}`}
                description={
                  parsed.bounds[v]
                    ? `Compute a definite integral from ${parsed.bounds[v][0]} to ${parsed.bounds[v][1]} with respect to ${v}.`
                    : `Compute an indefinite integral with respect to ${v}.`
                }
                onClick={() => solve('i', v)}
              />
            ))}
            {boundedVars.length > 1 && (
              <ToolBtn
                label={boundedVars.length > 2 ? '∭' : '∬'}
                description={`Compute an iterated integral over ${boundedVars.join(', ')}.`}
                onClick={() => solve('ii')}
              />
            )}
            {parsed.vars.map((v) => (
              <ToolBtn
                key={`L${v}`}
                label={`L${parsed.vars.length > 1 ? `{${v}}` : ''}`}
                description={`Compute the Laplace transform in ${v} to rewrite the expression in the frequency domain.`}
                onClick={() => solve('L', v)}
              />
            ))}
            {parsed.vars.map((v) => (
              <ToolBtn
                key={`F${v}`}
                label={`F${parsed.vars.length > 1 ? `{${v}}` : ''}`}
                description={`Compute the Fourier transform in ${v} to analyze the expression by frequency.`}
                onClick={() => solve('F', v)}
              />
            ))}
          </div>
          {solution && (
            <button
              type="button"
              className="flex items-center gap-1 text-[10.5px] text-muted-foreground transition-colors hover:text-[var(--accent-rose)]"
              onClick={() => {
                pushHistory(pageId)
                setStringParam(pageId, object.id, 'solution', '')
              }}
            >
              <X className="h-3 w-3" /> Clear solution
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Visual editor for the Graph object — series, axes, formulas, ref lines. */
function GraphOptions({
  pageId,
  object,
  bodies,
}: {
  pageId: string
  object: SceneObject
  bodies: SceneObject[]
}) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const set = (name: string, v: string) => setStringParam(pageId, object.id, name, v)

  const series = parseSeries(object)
  const channelsFor = (objId: string) => {
    const live = readBuffer(objId)?.channelNames
    if (live && live.length > 0) return live
    // No samples yet: guess from the object kind — circuit parts stream
    // V/I/P (analog) or level/value (digital), bodies stream motion.
    const o = bodies.find((b) => b.id === objId)
    if (o?.behaviors.some((b) => b.enabled && b.type === 'electricalNode')) {
      const sym = o.geometry.symbol ?? ''
      if (sym === 'logic-probe') return ['level']
      if (sym === 'output' || sym === 'input' || sym === 'clock') return ['value']
      return ['V', 'I', 'P']
    }
    return GRAPH_CHANNELS
  }

  const writeSeries = (list: GraphSeries[]) => {
    set('series', list.map((s) => `${s.objectId}:${s.channel}`).join('; '))
    // Legacy single-source params would resurrect as a fallback once the
    // series list empties — clear them the first time the editor writes.
    if (getStr(object, 'sourceId')) set('sourceId', '')
    if (getStr(object, 'yChannels')) set('yChannels', '')
  }
  const updateSeries = (i: number, patch: Partial<GraphSeries>) =>
    writeSeries(series.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const formulas = splitList(getStr(object, 'formulas'))
  const writeFormulas = (list: string[]) => set('formulas', list.join('; '))

  const editableList = (list: string[], write: (l: string[]) => void, itemLabel: string) => (
    <div className="space-y-1">
      {list.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <ExprInput
            ariaLabel={`${itemLabel} ${i + 1}`}
            value={item}
            onCommit={(v) =>
              write(v.trim() ? list.map((x, j) => (j === i ? v.trim() : x)) : list.filter((_, j) => j !== i))
            }
          />
          <button
            type="button"
            aria-label={`Remove ${itemLabel} ${i + 1}`}
            className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-rose)]"
            onClick={() => write(list.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )

  const rangeField = (name: string, label: string) => (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="w-9 shrink-0">{label}</span>
      <ExprInput
        ariaLabel={`Graph ${label}`}
        value={getStr(object, name)}
        placeholder="auto"
        onCommit={(v) => set(name, v)}
      />
    </label>
  )

  const xChannel = getStr(object, 'xChannel') || 't'
  const xOptions = [...new Set(['t', ...(series[0] ? channelsFor(series[0].objectId) : [])])]

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionTitle>Series</SectionTitle>
        {series.length === 0 && (
          <p className="rounded-lg bg-accent/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
            Each series plots one channel of one object — add several to
            compare objects on the same graph.
          </p>
        )}
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: GRAPH_COLORS[i % GRAPH_COLORS.length] }}
              aria-hidden
            />
            <select
              aria-label={`Series ${i + 1} object`}
              className={selectCls}
              value={s.objectId}
              onChange={(e) => {
                const objId = e.target.value
                const chs = channelsFor(objId)
                updateSeries(i, { objectId: objId, channel: chs.includes(s.channel) ? s.channel : chs[0] })
              }}
            >
              {!bodies.some((o) => o.id === s.objectId) && <option value={s.objectId}>(missing)</option>}
              {bodies.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              aria-label={`Series ${i + 1} channel`}
              className={cn(selectCls, 'w-24 shrink-0 font-mono')}
              value={s.channel}
              onChange={(e) => updateSeries(i, { channel: e.target.value })}
            >
              {!channelsFor(s.objectId).includes(s.channel) && <option value={s.channel}>{s.channel}</option>}
              {channelsFor(s.objectId).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Remove series ${i + 1}`}
              className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-rose)]"
              onClick={() => writeSeries(series.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        {bodies.length > 0 ? (
          <AddRowButton
            label="Add series"
            onClick={() => {
              const objId = series[series.length - 1]?.objectId ?? bodies[0].id
              const used = series.filter((s) => s.objectId === objId).map((s) => s.channel)
              const chs = channelsFor(objId)
              writeSeries([...series, { objectId: objId, channel: chs.find((c) => !used.includes(c)) ?? chs[0] }])
            }}
          />
        ) : (
          <p className="text-[10.5px] text-muted-foreground">
            No physics objects yet — give something a Rigid Body behavior first.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Layout</SectionTitle>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] text-muted-foreground">Stacked</span>
          <button
            type="button"
            role="switch"
            aria-checked={getStr(object, 'stacked') === '1'}
            aria-label="Stacked charts"
            onClick={() => set('stacked', getStr(object, 'stacked') === '1' ? '' : '1')}
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors',
              getStr(object, 'stacked') === '1'
                ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'
                : 'bg-accent text-muted-foreground'
            )}
          >
            {getStr(object, 'stacked') === '1' ? 'On' : 'Off'}
          </button>
          <span className="text-[10.5px] text-muted-foreground">one mini chart per series</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Axes</SectionTitle>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-9 shrink-0">X axis</span>
          <select
            aria-label="Graph X axis channel"
            className={cn(selectCls, 'font-mono')}
            value={xChannel}
            onChange={(e) => set('xChannel', e.target.value)}
          >
            {!xOptions.includes(xChannel) && <option value={xChannel}>{xChannel}</option>}
            {xOptions.map((c) => (
              <option key={c} value={c}>
                {c === 't' ? 't (time)' : c}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {rangeField('xMin', 'X min')}
          {rangeField('xMax', 'X max')}
          {rangeField('yMin', 'Y min')}
          {rangeField('yMax', 'Y max')}
        </div>
        <p className="text-[10.5px] text-muted-foreground">
          Blank = auto. Values can be expressions (e.g. <span className="font-mono">2*g</span>).
        </p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Formulas</SectionTitle>
        {editableList(formulas, writeFormulas, 'Formula')}
        <AddRowButton label="Add formula" onClick={() => writeFormulas([...formulas, 'sin(t)'])} />
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          Plotted as dashed lines. Can use page variables, <span className="font-mono">t</span> and the
          first series&apos; channels. Without a series, formulas plot over the X range. Calculus works
          too: <span className="font-mono">derivative(sin(t), t)</span>,{' '}
          <span className="font-mono">integral(sin(u), u, 0, t)</span> — differentiate or integrate
          with respect to any variable for partials.
        </p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Reference lines</SectionTitle>
        {(
          [
            ['refY', 'Horizontal (y =)'],
            ['refX', 'Vertical (x =)'],
          ] as const
        ).map(([name, label]) => {
          const list = splitList(getStr(object, name))
          const write = (l: string[]) => set(name, l.join('; '))
          return (
            <div key={name} className="space-y-1">
              <p className="text-[10.5px] text-muted-foreground">{label}</p>
              {editableList(list, write, label)}
              <AddRowButton label="Add line" onClick={() => write([...list, '0'])} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 3D Graph — the surface-plot analog of GraphOptions above. Axis choice
 *  lives on the card itself (a plain <select>, no history/undo needed for a
 *  view toggle); this panel handles the things worth undo-tracking: the
 *  formula list and the axis bounds/resolution. */
function Surface3DOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const set = (name: string, v: string) => setStringParam(pageId, object.id, name, v)

  const formulas = splitList(getStr(object, 'formulas'))
  const writeFormulas = (list: string[]) => set('formulas', list.join('; '))

  const editableList = (list: string[], write: (l: string[]) => void, itemLabel: string) => (
    <div className="space-y-1">
      {list.map((item, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <ExprInput
            ariaLabel={`${itemLabel} ${i + 1}`}
            value={item}
            onCommit={(v) =>
              write(v.trim() ? list.map((x, j) => (j === i ? v.trim() : x)) : list.filter((_, j) => j !== i))
            }
          />
          <button
            type="button"
            aria-label={`Remove ${itemLabel} ${i + 1}`}
            className="rounded p-0.5 text-muted-foreground hover:text-[var(--accent-rose)]"
            onClick={() => write(list.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )

  const rangeField = (name: string, label: string, fallback: string) => (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="w-8 shrink-0 font-mono">{label}</span>
      <ExprInput ariaLabel={`Range ${label}`} value={getStr(object, name)} placeholder={fallback} onCommit={(v) => set(name, v)} />
    </label>
  )

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionTitle>Formulas</SectionTitle>
        {editableList(formulas, writeFormulas, 'Formula')}
        <AddRowButton label="Add formula" onClick={() => writeFormulas([...formulas, 'x^2+y^2'])} />
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          Explicit: <span className="font-mono">sin(x)*cos(y)</span> plots as a height field. Implicit
          equations work too — <span className="font-mono">x^2+y^2+z^2=25</span> (sphere) or{' '}
          <span className="font-mono">2*x+3*y+z=6</span> (plane) — solved for the dependent axis and
          rendered as two caps. The dependent axis (which variable is &quot;height&quot;) is picked on
          the card itself.
        </p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Bounds</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          {rangeField('xMin', 'x min', '-5')}
          {rangeField('xMax', 'x max', '5')}
          {rangeField('yMin', 'y min', '-5')}
          {rangeField('yMax', 'y max', '5')}
          {rangeField('zMin', 'z min', '-5')}
          {rangeField('zMax', 'z max', '5')}
        </div>
        <p className="text-[10.5px] text-muted-foreground">Values can be expressions (e.g. 2*r).</p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Resolution</SectionTitle>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-8 shrink-0 font-mono">grid</span>
          <ExprInput
            ariaLabel="Grid resolution"
            value={getStr(object, 'res')}
            placeholder="28"
            scrubbable={false}
            onCommit={(v) => set('res', v)}
          />
        </label>
        <p className="text-[10.5px] text-muted-foreground">Samples per axis, 8–60. Higher is smoother but slower.</p>
      </div>
    </div>
  )
}

/** Minimal CSV split with double-quote support — good enough for a
 *  spreadsheet export's simple quoting, not a full RFC 4180 parser. */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

/** Chart — type switching and the data grid live here rather than on the
 *  card itself, so the card's whole footprint goes to the rendered chart.
 *  CSV import expects a header row (blank/label cell, then one column per
 *  series) followed by one row per label. */
function ChartOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const pushHistory = useDocStore((s) => s.pushHistory)
  const set = (name: string, v: string) => setStringParam(pageId, object.id, name, v)

  const chartType = (getStr(object, 'chartType') || 'bar') as ChartType
  const stacked = getStr(object, 'stacked') === '1'
  const labelsStr = getStr(object, 'labels') || 'A;B;C;D'
  const seriesStr = getStr(object, 'series') || 'Series 1|10;25;16;30'

  const parsedLabels = splitChartLabels(labelsStr)
  const parsedSeries = parseChartSeries(seriesStr)
  const rows = parsedLabels.length < 3 ? [...parsedLabels, ...Array(3 - parsedLabels.length).fill('')] : parsedLabels
  const cols = parsedSeries.length > 0 ? parsedSeries : [{ name: 'Series 1', values: rows.map(() => 0) }]

  const commit = (nextLabels: string[], nextSeries: ChartDataSeries[]) => {
    pushHistory(pageId)
    set('labels', nextLabels.join(';'))
    set('series', serializeChartSeries(nextSeries))
  }
  const updateLabel = (r: number, v: string) => commit(rows.map((l, i) => (i === r ? v : l)), cols)
  const updateCell = (r: number, c: number, v: string) =>
    commit(
      rows,
      cols.map((s, i) => (i === c ? { ...s, values: s.values.map((x, j) => (j === r ? Number(v) || 0 : x)) } : s))
    )
  const updateSeriesName = (c: number, v: string) => commit(rows, cols.map((s, i) => (i === c ? { ...s, name: v } : s)))
  const addRow = () => commit([...rows, ''], cols.map((s) => ({ ...s, values: [...s.values, 0] })))
  const removeRow = (r: number) => {
    if (rows.length <= 1) return
    commit(rows.filter((_, i) => i !== r), cols.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== r) })))
  }
  const addSeries = () => commit(rows, [...cols, { name: `Series ${cols.length + 1}`, values: rows.map(() => 0) }])
  const removeSeries = (c: number) => {
    if (cols.length <= 1) return
    commit(rows, cols.filter((_, i) => i !== c))
  }

  const importCsv = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
      if (lines.length === 0) return
      const table = lines.map(parseCsvLine)
      const [header, ...body] = table
      const seriesNames = header.slice(1).map((n, i) => (n.trim() ? n.trim() : `Series ${i + 1}`))
      const newRows = body.map((r) => (r[0] ?? '').trim())
      const newCols: ChartDataSeries[] =
        seriesNames.length > 0
          ? seriesNames.map((name, c) => ({ name, values: body.map((r) => Number(r[c + 1]) || 0) }))
          : [{ name: 'Series 1', values: body.map(() => 0) }]
      commit(newRows, newCols)
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionTitle>Chart type</SectionTitle>
        <div className="grid grid-cols-5 gap-1">
          {CHART_TYPES.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={chartType === id}
              title={label}
              onClick={() => set('chartType', id)}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[9.5px]',
                chartType === id
                  ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        {(chartType === 'bar' || chartType === 'area') && (
          <div className="flex items-center gap-2 pt-0.5">
            <span className="w-14 shrink-0 text-[11px] text-muted-foreground">Stacked</span>
            <button
              type="button"
              role="switch"
              aria-checked={stacked}
              aria-label="Stacked series"
              onClick={() => set('stacked', stacked ? '' : '1')}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors',
                stacked ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]' : 'bg-accent text-muted-foreground'
              )}
            >
              {stacked ? 'On' : 'Off'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <SectionTitle>Data</SectionTitle>
          <label className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            <Upload className="h-3 w-3" /> Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importCsv(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>
        <div className="max-h-64 overflow-auto rounded-md border border-border/60">
          <table className="w-full border-collapse font-mono text-[10.5px]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="bg-[var(--accent-blue)]/8">
                <th className="min-w-[52px] border-b border-r border-border/50 px-1.5 py-1 text-left text-[10px] font-semibold text-muted-foreground">
                  Label
                </th>
                {cols.map((s, c) => (
                  <th key={c} className="min-w-[60px] border-b border-r border-border/50 px-1 py-1 text-left">
                    <div className="flex items-center gap-1">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: GRAPH_COLORS[c % GRAPH_COLORS.length] }}
                        aria-hidden
                      />
                      <input
                        type="text"
                        spellCheck={false}
                        value={s.name}
                        onChange={(e) => updateSeriesName(c, e.target.value)}
                        aria-label={`Series ${c + 1} name`}
                        className="w-full min-w-0 bg-transparent text-foreground outline-none"
                      />
                      {cols.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove series ${s.name}`}
                          onClick={() => removeSeries(c)}
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-50 transition-opacity hover:text-[var(--accent-rose)] hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="w-6 border-b border-border p-0">
                  <button
                    type="button"
                    aria-label="Add series"
                    onClick={addSeries}
                    className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((label, r) => (
                <tr key={r} className={r % 2 ? 'bg-accent/20' : undefined}>
                  <td className="border-r border-border/40 p-0">
                    <input
                      type="text"
                      spellCheck={false}
                      value={label}
                      onChange={(e) => updateLabel(r, e.target.value)}
                      aria-label={`Row ${r + 1} label`}
                      className="w-full bg-transparent px-1.5 py-0.5 text-foreground outline-none"
                      placeholder={`#${r + 1}`}
                    />
                  </td>
                  {cols.map((s, c) => (
                    <td key={c} className="border-r border-border/40 p-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        spellCheck={false}
                        value={s.values[r] ?? 0}
                        onChange={(e) => updateCell(r, c, e.target.value)}
                        aria-label={`Row ${r + 1} ${s.name}`}
                        className="w-full bg-transparent px-1.5 py-0.5 text-right text-foreground outline-none tabular-nums"
                      />
                    </td>
                  ))}
                  <td className="p-0">
                    <button
                      type="button"
                      aria-label={`Remove row ${r + 1}`}
                      onClick={() => removeRow(r)}
                      disabled={rows.length <= 1}
                      className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-[var(--accent-rose)] disabled:opacity-30"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddRowButton label="Add row" onClick={addRow} />
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          CSV: header row (blank cell, then one column per series), then one row per label.
        </p>
      </div>
    </div>
  )
}

function SliderOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const updateObject = useDocStore((s) => s.updateObject)
  const page = useDocStore((s) => s.pages[pageId])
  const objects = Object.values(page?.objects ?? {}).filter((o) => o.id !== object.id)
  const variables = page?.variables ?? []

  const targetType = getString(object, 'targetType', 'variable')
  const targetObjectId = getString(object, 'targetObjectId', '')
  const targetParamName = getString(object, 'targetParamName', 'x')
  const label = getString(object, 'label', object.name)
  const min = getNumber(object, 'min', 0)
  const max = getNumber(object, 'max', 100)
  const step = getNumber(object, 'step', 1)

  const selectedTargetObj = page?.objects[targetObjectId]
  const targetObjParams = getObjectParams(selectedTargetObj)

  return (
    <div className="space-y-2">
      <SectionTitle>Slider Configuration</SectionTitle>

      <div>
        <label className="text-[11px] text-muted-foreground">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, label: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
        />
      </div>

      <div>
        <label className="text-[11px] text-muted-foreground">Target Type</label>
        <select
          value={targetType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
        >
          <option value="variable">Page Variable</option>
          <option value="objectParam">Component Parameter</option>
        </select>
      </div>

      {targetType === 'objectParam' && (
        <div>
          <label className="text-[11px] text-muted-foreground">Target Component</label>
          <select
            value={targetObjectId}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, targetObjectId: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
          >
            <option value="">Select component…</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.geometry.kind})
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="text-[11px] text-muted-foreground">Target Parameter / Variable</label>
        <select
          value={targetParamName}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetParamName: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
        >
          <option value="">Select target…</option>
          {targetType === 'variable'
            ? variables.map((v) => (
                <option key={v.id} value={v.name}>
                  Variable: {v.name}
                </option>
              ))
            : targetObjParams.map((p) => (
                <option key={p} value={p}>
                  Param: {p}
                </option>
              ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <div>
          <label className="text-[10px] text-muted-foreground">Min</label>
          <input
            type="number"
            value={min}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, min: num(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-1.5 py-0.5 text-[11px] font-mono outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Max</label>
          <input
            type="number"
            value={max}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, max: num(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-1.5 py-0.5 text-[11px] font-mono outline-none"
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Step</label>
          <input
            type="number"
            value={step}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, step: num(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-1.5 py-0.5 text-[11px] font-mono outline-none"
          />
        </div>
      </div>
    </div>
  )
}

function ButtonOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const updateObject = useDocStore((s) => s.updateObject)
  const page = useDocStore((s) => s.pages[pageId])
  const objects = Object.values(page?.objects ?? {}).filter((o) => o.id !== object.id)
  const variables = page?.variables ?? []

  const targetType = getString(object, 'targetType', 'variable')
  const targetObjectId = getString(object, 'targetObjectId', '')
  const targetParamName = getString(object, 'targetParamName', 'x')
  const actionType = getString(object, 'actionType', 'set')
  const targetValue = getNumber(object, 'targetValue', 1)
  const label = getString(object, 'label', object.name)

  const selectedTargetObj = page?.objects[targetObjectId]
  const targetObjParams = getObjectParams(selectedTargetObj)

  return (
    <div className="space-y-2">
      <SectionTitle>Button Configuration</SectionTitle>

      <div>
        <label className="text-[11px] text-muted-foreground">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, label: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
        />
      </div>

      <div>
        <label className="text-[11px] text-muted-foreground">Action Type</label>
        <select
          value={actionType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, actionType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
        >
          <option value="set">Set Target Value</option>
          <option value="toggle">Toggle Flag (0 ↔ 1)</option>
          <option value="step">Step Add Value</option>
        </select>
      </div>

      <div>
        <label className="text-[11px] text-muted-foreground">Target Type</label>
        <select
          value={targetType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
        >
          <option value="variable">Page Variable</option>
          <option value="objectParam">Component Parameter</option>
        </select>
      </div>

      {targetType === 'objectParam' && (
        <div>
          <label className="text-[11px] text-muted-foreground">Target Component</label>
          <select
            value={targetObjectId}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, targetObjectId: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
          >
            <option value="">Select component…</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.geometry.kind})
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="text-[11px] text-muted-foreground">Target Parameter / Variable</label>
        <select
          value={targetParamName}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetParamName: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
        >
          <option value="">Select target…</option>
          {targetType === 'variable'
            ? variables.map((v) => (
                <option key={v.id} value={v.name}>
                  Variable: {v.name}
                </option>
              ))
            : targetObjParams.map((p) => (
                <option key={p} value={p}>
                  Param: {p}
                </option>
              ))}
        </select>
      </div>

      {actionType !== 'toggle' && (
        <div>
          <label className="text-[11px] text-muted-foreground">Value to Set / Step</label>
          <input
            type="number"
            value={targetValue}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, targetValue: num(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] font-mono outline-none"
          />
        </div>
      )}
    </div>
  )
}

function TriggerOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const updateObject = useDocStore((s) => s.updateObject)
  const page = useDocStore((s) => s.pages[pageId])
  const objects = Object.values(page?.objects ?? {}).filter((o) => o.id !== object.id)
  const variables = page?.variables ?? []

  const sourceType = getString(object, 'sourceType', 'variable')
  const sourceObjectId = getString(object, 'sourceObjectId', '')
  const sourceParamName = getString(object, 'sourceParamName', 'x')
  const condition = getString(object, 'condition', '>')
  const threshold = getNumber(object, 'threshold', 50)

  const targetType = getString(object, 'targetType', 'variable')
  const targetObjectId = getString(object, 'targetObjectId', '')
  const targetParamName = getString(object, 'targetParamName', 'y')
  const actionType = getString(object, 'actionType', 'toggle')
  const targetValue = getNumber(object, 'targetValue', 1)
  const label = getString(object, 'label', object.name)

  const selectedSourceObj = page?.objects[sourceObjectId]
  const sourceObjParams = getObjectParams(selectedSourceObj)

  const selectedTargetObj = page?.objects[targetObjectId]
  const targetObjParams = getObjectParams(selectedTargetObj)

  return (
    <div className="space-y-2">
      <SectionTitle>Trigger Condition</SectionTitle>

      <div>
        <label className="text-[11px] text-muted-foreground">Label</label>
        <input
          type="text"
          value={label}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, label: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none"
        />
      </div>

      <div className="rounded-lg border border-border/60 bg-accent/30 p-2 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Monitored Source</p>
        <select
          value={sourceType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, sourceType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[11.5px] outline-none"
        >
          <option value="variable">Page Variable</option>
          <option value="objectParam">Component Parameter</option>
        </select>

        {sourceType === 'objectParam' && (
          <select
            value={sourceObjectId}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, sourceObjectId: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[11.5px] outline-none"
          >
            <option value="">Select source component…</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.geometry.kind})
              </option>
            ))}
          </select>
        )}

        <select
          value={sourceParamName}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, sourceParamName: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[11.5px] outline-none"
        >
          <option value="">Select monitored value…</option>
          {sourceType === 'variable'
            ? variables.map((v) => (
                <option key={v.id} value={v.name}>
                  Variable: {v.name}
                </option>
              ))
            : sourceObjParams.map((p) => (
                <option key={p} value={p}>
                  Param: {p}
                </option>
              ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="text-[10px] text-muted-foreground">Operator</label>
          <select
            value={condition}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, condition: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] font-mono outline-none"
          >
            <option value=">">&gt; (Greater Than)</option>
            <option value="<">&lt; (Less Than)</option>
            <option value="==">== (Equals)</option>
            <option value=">=">&gt;= (Greater or Equal)</option>
            <option value="<=">&lt;= (Less or Equal)</option>
            <option value="!=">!= (Not Equal)</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Threshold Value</label>
          <input
            type="number"
            value={threshold}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, threshold: num(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] font-mono outline-none"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-accent/30 p-2 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Target Action</p>
        <select
          value={targetType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[11.5px] outline-none"
        >
          <option value="variable">Page Variable</option>
          <option value="objectParam">Component Parameter</option>
        </select>

        {targetType === 'objectParam' && (
          <select
            value={targetObjectId}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, targetObjectId: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[11.5px] outline-none"
          >
            <option value="">Select target component…</option>
            {objects.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.geometry.kind})
              </option>
            ))}
          </select>
        )}

        <select
          value={targetParamName}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetParamName: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[11.5px] outline-none"
        >
          <option value="">Select target value…</option>
          {targetType === 'variable'
            ? variables.map((v) => (
                <option key={v.id} value={v.name}>
                  Variable: {v.name}
                </option>
              ))
            : targetObjParams.map((p) => (
                <option key={p} value={p}>
                  Param: {p}
                </option>
              ))}
        </select>
      </div>
    </div>
  )
}

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const

const TEXT_STYLES: { label: string; icon: typeof Pilcrow; prefix: string }[] = [
  { label: 'Body', icon: Pilcrow, prefix: '' },
  { label: 'Heading 1', icon: Heading1, prefix: '# ' },
  { label: 'Heading 2', icon: Heading2, prefix: '## ' },
  { label: 'Heading 3', icon: Heading3, prefix: '### ' },
]

/** Everything that used to live in a floating dock above the text box now
 * lives here instead — one home for text controls, matching how every other
 * object's options work. Format/color/size act on the LIVE SELECTION inside
 * whichever text box is currently being edited (via useActiveTextEditor,
 * bridged from components/objects/text.tsx — the panel can't reach the
 * canvas's contentEditable any other way), so they only ever touch the
 * highlighted text, never the whole box. Alignment/background stay box-wide
 * — there's no per-paragraph tracking in the markdown model, and background
 * is inherently a frame property, not a text one. */
function TextOptions({ pageId, object }: { pageId: string; object: SceneObject }) {
  const updateObject = useDocStore((s) => s.updateObject)
  const activeId = useActiveTextEditor((s) => s.objectId)
  const handleRef = useActiveTextEditor((s) => s.handleRef)
  const isActive = activeId === object.id
  const bg = (object.metadata.color as string) ?? ''
  const align = (object.metadata.align as string) ?? 'left'

  const setMeta = (patch: Record<string, unknown>) =>
    updateObject(pageId, object.id, { metadata: { ...object.metadata, ...patch } }, { history: true })

  const wrap = (before: string, after?: string) => handleRef?.current?.wrap(before, after)
  const prefixLine = (prefix: string) => handleRef?.current?.prefixLine(prefix)

  // preventDefault on pointerdown keeps the editor's selection alive while
  // clicking a panel button — the panel is a different part of the DOM than
  // the contentEditable, so without this the click would blur it first and
  // collapse whatever text was selected.
  const guard = (e: React.PointerEvent) => e.preventDefault()

  const iconBtn = (label: string, Icon: typeof Bold, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-label={label}
      disabled={!isActive}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
      onPointerDown={guard}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <SectionTitle>Format selected text</SectionTitle>
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-accent/40 p-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Text style"
                disabled={!isActive}
                className="flex items-center gap-0.5 rounded-md px-1.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                onPointerDown={guard}
              >
                <Pilcrow className="h-3.5 w-3.5" />
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="glass-strong w-36">
              {TEXT_STYLES.map((s) => (
                <DropdownMenuItem key={s.label} className="gap-2 text-[12px]" onSelect={() => prefixLine(s.prefix)}>
                  <s.icon className="h-3.5 w-3.5" /> {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {iconBtn('Bold (Ctrl+B)', Bold, () => wrap('**'))}
          {iconBtn('Italic (Ctrl+I)', Italic, () => wrap('*'))}
          {iconBtn('Strikethrough', Strikethrough, () => wrap('~~'))}
          {iconBtn('Highlight', Highlighter, () => wrap('=='))}
          {iconBtn('Inline code', Code, () => wrap('`'))}
          {iconBtn('Link', Link, () => wrap('[', '](url)'))}
          <span className="mx-0.5 h-4 w-px bg-border" />
          {iconBtn('Bullet list', List, () => prefixLine('- '))}
          {iconBtn('Numbered list', ListOrdered, () => prefixLine('1. '))}
          {iconBtn('Checklist', CheckSquare, () => prefixLine('- [ ] '))}
          {iconBtn('Quote', Quote, () => prefixLine('> '))}
        </div>
        {!isActive && (
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Double-click into the text and select some — these apply to the selection, not the whole box.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Text color</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(TEXT_COLORS).map(([id, value]) => (
            <button
              key={id}
              type="button"
              aria-label={`Text color ${id}`}
              disabled={!isActive}
              className="h-6 w-6 rounded-full border-2 border-transparent transition-transform hover:scale-110 disabled:pointer-events-none disabled:opacity-30"
              style={{ background: value }}
              onPointerDown={guard}
              onClick={() => wrap('[', `]{color=${id}}`)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Text size</SectionTitle>
        <div className="flex gap-1 rounded-lg bg-accent/40 p-0.5">
          {(Object.keys(TEXT_SIZES) as (keyof typeof TEXT_SIZES)[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Text size ${s}`}
              disabled={!isActive}
              className="flex flex-1 items-center justify-center rounded-md py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
              onPointerDown={guard}
              onClick={() => wrap('[', `]{size=${s}}`)}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Alignment</SectionTitle>
        <div className="flex gap-1 rounded-lg bg-accent/40 p-0.5">
          {(Object.keys(ALIGN_ICONS) as (keyof typeof ALIGN_ICONS)[]).map((a) => {
            const Icon = ALIGN_ICONS[a]
            return (
              <button
                key={a}
                type="button"
                aria-label={`Align ${a}`}
                aria-pressed={align === a}
                className={cn(
                  'flex flex-1 items-center justify-center rounded-md py-1 transition-colors',
                  align === a
                    ? 'bg-[var(--accent-blue)] text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
                onClick={() => setMeta({ align: a })}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            )
          })}
        </div>
        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          Whole textbox — the markdown model doesn&apos;t track per-paragraph alignment yet.
        </p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Background</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-label="No background"
            aria-pressed={!bg}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] text-muted-foreground',
              !bg ? 'border-[var(--ring)]' : 'border-transparent'
            )}
            onClick={() => setMeta({ color: undefined })}
          >
            ×
          </button>
          {Object.keys(FILLS).map((id) => (
            <button
              key={id}
              type="button"
              aria-label={`Background ${id}`}
              aria-pressed={bg === id}
              className={cn(
                'h-6 w-6 rounded-full border-2',
                FILLS[id],
                bg === id ? 'scale-110 border-[var(--ring)]' : 'border-transparent'
              )}
              onClick={() => setMeta({ color: id })}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function ObjectProperties({ pageId, object }: { pageId: string; object: SceneObject }) {
  const setParam = useDocStore((s) => s.setParam)
  const updateObject = useDocStore((s) => s.updateObject)
  const page = useDocStore((s) => s.pages[pageId])

  const contentParams = Object.entries(object.parameters).filter(
    // `inputs` is structural (component model) — the Model dropdown owns it.
    ([name, p]) => p.kind === 'number' && name !== 'inputs'
  ) as [
    string,
    Extract<SceneObject['parameters'][string], { kind: 'number' }>,
  ][]

  const bodies = Object.values(page?.objects ?? {}).filter(
    (o) =>
      isBody(o.behaviors) === 'dynamic' ||
      o.behaviors.some((b) => b.enabled && b.type === 'electricalNode')
  )
  /** A plain number field (rotation, and anything unitless). */
  const numField = (label: string, value: number, commit: (n: number) => void) => (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {label}
      <ExprInput
        ariaLabel={label}
        value={String(Math.round(value * 100) / 100)}
        onCommit={(v) => {
          const n = Number(v)
          if (Number.isFinite(n)) commit(n)
        }}
      />
    </label>
  )

  /** A LENGTH field. The page's unit is the centimetre (10 px = 1 cm), so the
   *  user reads and types cm while geometry stays in pixels internally. */
  const cmField = (label: string, px: number, commitPx: (px: number) => void) => (
    <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      {label}
      <ExprInput
        ariaLabel={`${label} (cm)`}
        value={String(pxToCmRounded(px))}
        onCommit={(v) => {
          const n = Number(v)
          if (Number.isFinite(n)) commitPx(cmToPx(n))
        }}
      />
      <span className="shrink-0 text-[10px] opacity-60">cm</span>
    </label>
  )

  return (
    <div className="space-y-4">
      <div>
        <ExprInput
          ariaLabel="Object name"
          mono={false}
          value={object.name}
          onCommit={(name) => name.trim() && updateObject(pageId, object.id, { name: name.trim() }, { history: true })}
        />
        <p className="mt-1 text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
          {object.geometry.kind}
          {object.geometry.symbol ? ` · ${object.geometry.symbol}` : ''}
        </p>
      </div>

      <div>
        <SectionTitle>Transform</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          {cmField('X', object.position.x, (n) =>
            updateObject(pageId, object.id, { position: { ...object.position, x: n } }, { history: true })
          )}
          {cmField('Y', object.position.y, (n) =>
            updateObject(pageId, object.id, { position: { ...object.position, y: n } }, { history: true })
          )}
          {cmField('W', object.size.w, (n) =>
            n > 4 && updateObject(pageId, object.id, { size: { ...object.size, w: n } }, { history: true })
          )}
          {cmField('H', object.size.h, (n) =>
            n > 4 && updateObject(pageId, object.id, { size: { ...object.size, h: n } }, { history: true })
          )}
          {numField('Rot°', object.rotation, (n) =>
            updateObject(pageId, object.id, { rotation: n }, { history: true })
          )}
        </div>
      </div>

      {object.geometry.kind === 'symbol' && MODEL_OPTIONS[object.geometry.symbol ?? ''] && (
        <div className="space-y-1.5">
          <SectionTitle>Model</SectionTitle>
          <select
            aria-label="Component model"
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none focus:border-[var(--ring)]"
            value={
              object.parameters.inputs?.kind === 'number'
                ? Math.round(object.parameters.inputs.value)
                : MODEL_OPTIONS[object.geometry.symbol ?? ''][0].value
            }
            onChange={(e) => {
              const n = Number(e.target.value)
              const h = recommendedHeight(object.geometry.symbol ?? '', n)
              updateObject(
                pageId,
                object.id,
                {
                  parameters: { ...object.parameters, inputs: num(e.target.value) },
                  // Widening to a many-pin model needs a taller box, or its
                  // own pins pack closer than the wire snap radius.
                  ...(h && h > object.size.h ? { size: { ...object.size, h } } : {}),
                },
                { history: true }
              )
            }}
          >
            {MODEL_OPTIONS[object.geometry.symbol ?? ''].map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Pins move to match — rewire connections after changing the model.
          </p>
        </div>
      )}

      {object.metadata.render === 'system' && (
        <div className="space-y-1.5">
          <SectionTitle>System domain</SectionTitle>
          <select
            aria-label="System domain"
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[12px] outline-none focus:border-[var(--ring)]"
            value={(object.metadata.domain as string) ?? 'electrical'}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { metadata: { ...object.metadata, domain: e.target.value } },
                { history: true }
              )
            }
          >
            <option value="mechanics">Mechanics</option>
            <option value="electrical">Electrical</option>
            <option value="electronics">Electronics</option>
            <option value="digital">Digital</option>
          </select>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            Doodles inside become this domain&apos;s components — zigzag →
            resistor, box → battery/gate, blob → bulb/BJT, lines → wires.
            Scribble a small mark near any part to write its value or name.
          </p>
        </div>
      )}

      {object.geometry.kind === 'text' && <TextOptions pageId={pageId} object={object} />}

      {object.geometry.kind === 'formula' && <FormulaOptions pageId={pageId} object={object} />}

      {object.geometry.kind === 'graph' && (
        <GraphOptions pageId={pageId} object={object} bodies={bodies} />
      )}

      {object.geometry.kind === 'surface3d' && <Surface3DOptions pageId={pageId} object={object} />}

      {object.geometry.kind === 'chart' && <ChartOptions pageId={pageId} object={object} />}

      {object.geometry.kind === 'cashflow' && <CashflowOptions pageId={pageId} object={object} />}

      {object.geometry.kind === 'truthtable' && (
        <TruthTableOptions pageId={pageId} object={object} />
      )}

      {object.geometry.kind === 'slider' && <SliderOptions pageId={pageId} object={object} />}
      {object.geometry.kind === 'button' && <ButtonOptions pageId={pageId} object={object} />}
      {object.geometry.kind === 'trigger' && <TriggerOptions pageId={pageId} object={object} />}

      {contentParams.length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle>Parameters</SectionTitle>
          {contentParams.map(([name, p]) => (
            <div key={name}>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 truncate font-mono text-[11.5px] text-muted-foreground" title={name}>{name}</span>
                <ExprInput
                  ariaLabel={`Parameter ${name}`}
                  value={p.expr}
                  error={p.error}
                  onCommit={(v) => setParam(pageId, object.id, name, v)}
                />
                <span className="w-14 shrink-0 truncate text-right font-mono text-[10px] text-[var(--accent-amber)]">
                  {Number.isFinite(p.value) ? +p.value.toFixed(3) : '—'}
                </span>
              </div>
              {p.error && <p className="ml-16 mt-0.5 text-[10.5px] text-[var(--accent-rose)]">{p.error}</p>}
            </div>
          ))}
        </div>
      )}

      {!NO_BEHAVIOR_KINDS.includes(object.geometry.kind) &&
        object.metadata.render !== 'system' && (
          <BehaviorsSection pageId={pageId} object={object} />
        )}
    </div>
  )
}

// Engine defaults surfaced as editable variables. Overriding one creates a
// normal page variable the runtime reads live — delete it to restore default.
const SYSTEM_VARS = [
  { name: 'g', def: '9.81', label: 'Gravity (m/s²)' },
  { name: 'drag', def: '0.01', label: 'Air resistance (0 = vacuum)' },
  { name: 'timeScale', def: '1', label: 'Simulation speed ×' },
]

function VariablesPanel({ pageId }: { pageId: string }) {
  const variables = useDocStore((s) => s.pages[pageId]?.variables) ?? []
  const addVariable = useDocStore((s) => s.addVariable)
  const updateVariable = useDocStore((s) => s.updateVariable)
  const removeVariable = useDocStore((s) => s.removeVariable)

  const unsetSystem = SYSTEM_VARS.filter((sv) => !variables.some((v) => v.name === sv.name))
  const pageObjects = useDocStore((st) => st.pages[pageId]?.objects) ?? {}
  // Component-value binding: pick an object + one of its live channels and a
  // [Name(channel)] token is appended to the expression — no typing needed.
  const [binding, setBinding] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [bindObj, setBindObj] = useState('')
  const [bindCh, setBindCh] = useState('')
  // Only objects that actually stream data can be bound — and each one
  // offers ITS channels (a mass gives x/vx/ke, a resistor gives V/I/P).
  // Derived from the object, so this works before Play has ever run; a live
  // buffer, when one exists, is authoritative.
  const objectList = Object.values(pageObjects).filter(
    (o) => o.metadata.render !== 'system' && channelsFor(o).length > 0
  )
  const channelsOf = (id: string): string[] => {
    const live = readBuffer(id)?.channelNames
    if (live && live.length > 0) return live
    const obj = pageObjects[id]
    return obj ? channelsFor(obj) : []
  }

  return (
    <div className="space-y-1.5">
      {variables.length === 0 && (
        <p className="py-4 text-center text-[12px] leading-relaxed text-muted-foreground">
          Variables are shared by every object on this page.
          <br />
          Try <span className="font-mono">g = 9.81</span>, then use{' '}
          <span className="font-mono">g</span> in any parameter — even while
          the simulation runs. Live outputs work too:{' '}
          <span className="font-mono">k = 2*[Voltmeter 1(V)] / [Capacitor 1(I)]</span>{' '}
          tracks any object&apos;s graphed channel by name, in every domain.
        </p>
      )}
      {variables.map((v) => (
        <div key={v.id}>
          <div className="group flex items-center gap-1.5">
            <ExprInput
              ariaLabel="Variable name"
              value={v.name}
              onCommit={(name) =>
                /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && updateVariable(pageId, v.id, { name })
              }
            />
            <span className="text-muted-foreground">=</span>
            <ExprInput
              ariaLabel={`Expression for ${v.name}`}
              value={v.expr}
              error={v.error}
              onCommit={(expr) => updateVariable(pageId, v.id, { expr })}
            />
            <span className="w-14 shrink-0 truncate text-right font-mono text-[10px] text-[var(--accent-amber)]">
              {v.error ? '—' : +v.value.toFixed(3)}
            </span>
            <button
              type="button"
              aria-label={`Open large editor for ${v.name}`}
              title="Edit the formula in a larger box"
              className={
                expandedId === v.id
                  ? 'rounded p-0.5 text-[var(--accent-blue)]'
                  : 'rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-foreground hover:opacity-100'
              }
              onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
            >
              <Maximize2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={`Bind a component value to ${v.name}`}
              title="Insert a live component value"
              className={
                binding === v.id
                  ? 'rounded p-0.5 text-[var(--accent-blue)]'
                  : 'rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-foreground hover:opacity-100'
              }
              onClick={() => {
                setBinding(binding === v.id ? null : v.id)
                setBindObj('')
                setBindCh('')
              }}
            >
              <Link2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={`Delete variable ${v.name}`}
              className="rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-[var(--accent-rose)] hover:opacity-100"
              onClick={() => removeVariable(pageId, v.id)}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {expandedId === v.id && (
            <textarea
              autoFocus
              defaultValue={v.expr}
              rows={3}
              spellCheck={false}
              aria-label={`Large formula editor for ${v.name}`}
              className="mt-1 w-full resize-y rounded-md border border-input bg-background/80 px-2 py-1.5 font-mono text-[12px] leading-relaxed outline-none focus:border-[var(--ring)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
              }}
              onBlur={(e) => {
                const expr = e.target.value.trim()
                if (expr && expr !== v.expr) updateVariable(pageId, v.id, { expr })
                setExpandedId(null)
              }}
            />
          )}
          {binding === v.id && (
            <div className="mt-1 flex items-center gap-1.5">
              <select
                aria-label="Component"
                value={bindObj}
                onChange={(e) => {
                  setBindObj(e.target.value)
                  setBindCh('')
                }}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-1 text-[11.5px]"
              >
                <option value="">Component…</option>
                {objectList.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Value channel"
                value={bindCh}
                disabled={!bindObj}
                onChange={(e) => setBindCh(e.target.value)}
                className="w-24 rounded-md border border-border bg-background px-1.5 py-1 text-[11.5px]"
              >
                <option value="">Value…</option>
                {bindObj &&
                  channelsOf(bindObj).map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c] ? `${c} — ${CHANNEL_LABELS[c]}` : c}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!bindObj || !bindCh}
                className="rounded-md border border-border px-2 py-1 text-[11.5px] font-semibold text-muted-foreground enabled:hover:text-foreground disabled:opacity-40"
                onClick={() => {
                  const o = pageObjects[bindObj]
                  if (!o) return
                  const token = `[${o.name}(${bindCh})]`
                  const cur = v.expr.trim()
                  updateVariable(pageId, v.id, {
                    expr: !cur || cur === '0' ? token : `${cur} * ${token}`,
                  })
                  setBinding(null)
                }}
              >
                Insert
              </button>
            </div>
          )}
          {binding === v.id && (
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              Live value from the simulation — combine several (edit the expression, e.g.{' '}
              <span className="font-mono">2*[A(V)]/[B(I)]</span>). Only objects that produce
              data are listed, each with its own outputs.
            </p>
          )}
          {v.error && <p className="mt-0.5 text-[10.5px] text-[var(--accent-rose)]">{v.error}</p>}
        </div>
      ))}
      <button
        type="button"
        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
        onClick={() => addVariable(pageId)}
      >
        <Plus className="h-3.5 w-3.5" /> Add variable
      </button>

      {unsetSystem.length > 0 && (
        <div className="pt-2">
          <SectionTitle>System (engine defaults)</SectionTitle>
          {unsetSystem.map((sv) => (
            <div key={sv.name} className="flex items-center gap-1.5 py-0.5">
              <span className="w-20 shrink-0 font-mono text-[11.5px] text-muted-foreground">{sv.name}</span>
              <ExprInput
                ariaLabel={`System variable ${sv.name}`}
                value={sv.def}
                onCommit={(expr) => addVariable(pageId, sv.name, expr)}
              />
              <span className="w-28 shrink-0 truncate text-[10px] text-muted-foreground" title={sv.label}>
                {sv.label}
              </span>
            </div>
          ))}
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
            Edit a value to override it for this page — it becomes a normal
            variable above (delete it to restore the default).
          </p>
        </div>
      )}
    </div>
  )
}

/** The Properties/Variables tabs without any panel shell — hosted by the
 *  left rail's Properties section on desktop and by Inspector (the phone
 *  drawer's floating card) below. */
export function InspectorPane({ pageId }: { pageId: string }) {
  const selection = useDocStore((s) => s.selection)
  const object = useDocStore((s) =>
    selection.length === 1 ? s.pages[pageId]?.objects[selection[0]] : undefined
  )

  return (
    <Tabs defaultValue="properties" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="m-2 grid grid-cols-2 bg-accent/50">
        <TabsTrigger value="properties" className="text-[12px]">
          Properties
        </TabsTrigger>
        <TabsTrigger value="variables" className="text-[12px]">
          Variables
        </TabsTrigger>
      </TabsList>
      <TabsContent value="properties" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {object ? (
          <ObjectProperties pageId={pageId} object={object} />
        ) : (
          <p className="py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
            {selection.length > 1
              ? `${selection.length} objects selected`
              : 'Select an object — or draw one and give it a behavior.'}
          </p>
        )}
      </TabsContent>
      <TabsContent value="variables" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <VariablesPanel pageId={pageId} />
      </TabsContent>
    </Tabs>
  )
}

/** The floating panel shell — the phone inspector drawer's card. Desktop no
 *  longer docks this; Properties lives in the left rail (see sidebar.tsx). */
export function Inspector({ pageId }: { pageId: string }) {
  const motion = useSpring()
  const [panelW, setPanelW] = useState(() => {
    if (typeof window === 'undefined') return 288
    return Number(localStorage.getItem('simblip-inspector-w')) || 288
  })

  return (
    <fm.aside
      initial={{ x: 16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={motion}
      className="glass relative z-30 m-3 flex max-w-[calc(100vw-1.5rem)] flex-col rounded-2xl"
      style={{ width: panelW }}
      aria-label="Inspector"
    >
      <div
        role="separator"
        aria-label="Resize inspector"
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize"
        onPointerDown={(e) => {
          e.preventDefault()
          const startX = e.clientX
          const startW = panelW
          const move = (ev: PointerEvent) =>
            setPanelW(Math.min(560, Math.max(230, startW + (startX - ev.clientX))))
          const up = (ev: PointerEvent) => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            try {
              localStorage.setItem(
                'simblip-inspector-w',
                String(Math.min(560, Math.max(230, startW + (startX - ev.clientX))))
              )
            } catch {}
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      />
      <InspectorPane pageId={pageId} />
    </fm.aside>
  )
}
