'use client'

// Blender-style inspector — and the conversion surface of the whole app.
// "Convert to physics object" = attaching a behavior here. Every numeric
// field accepts an expression against the page's variable scope.

import { useState, useEffect, useMemo, useRef, useContext, createContext, useId } from 'react'
import {
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
  Underline,
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
  Type,
  Eye,
  EyeOff,
  RotateCw,
  FoldHorizontal,
  UnfoldHorizontal,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from 'lucide-react'
import { motion as fm } from 'framer-motion'
import { useSpring } from '@/lib/motion'
import { useDocStore, type Viewport } from '@/lib/store/document'
import { useWorkspaceStore, ownerPageOf, findPageMeta } from '@/lib/store/workspace'
import { HexColorSwatchPicker } from './hex-color-swatch-picker'
import { usePageSwatches, EMPTY_SWATCHES } from '@/lib/store/page-swatches'
import { useImagePalette } from '@/lib/color/use-image-palette'
import { parseSeries, GRAPH_COLORS, type GraphSeries } from '@/components/objects/graph'
import { FILLS } from '@/components/objects/text'
import { TEXT_COLORS, TEXT_SIZES, TEXT_FONTS, TEXT_FONT_LABELS, FONT_GROUPS, TEXT_WEIGHTS, parse, applyMark, serialize, type MarkKind } from '@/lib/text/marks'
import { htmlToMarkdownSource } from '@/lib/text/render'
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
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { num, str, type SceneObject, type GeometryKind, type Variable } from '@/lib/scene/types'
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
import {
  channelOptions,
  serializeBindings,
  splitIds,
} from '@/lib/scene/bindings'
import { pxToCmRounded, cmToPx } from '@/lib/scene/units'
import { truthCandidates, MAX_INPUTS } from '@/lib/circuit/truth-table'
import { InfoPopover } from './info-popover'
import { ColumnPicker } from './column-picker'
import {
  scopeItems,
  filterScope,
  activeToken,
  spliceItem,
  type ScopeItem,
} from './expr-scope'

const EMPTY_SCOPE: ScopeItem[] = Object.freeze([]) as unknown as ScopeItem[]

/** The page's variables + live channels, available to every ExprInput below
 *  without threading `pageId` through 28 call sites. Empty outside a page. */
const ExprScopeContext = createContext<ScopeItem[]>(EMPTY_SCOPE)

/** A value the scrubber is allowed to touch: a plain number, nothing else.
 *
 *  This guard is the whole reason scrubbing was corrupting data. `scrubbable`
 *  defaulted to true and only ONE of twenty call sites opted out, so object
 *  names, variable names, expressions and "auto" range fields were all
 *  draggable — and `Number("Mass 1")` is NaN, which was then committed live.
 *  A field is now scrubbed only if what's actually in it right now is a
 *  number, regardless of what the call site asked for. */
const isNumericValue = (v: string): boolean => v.trim() !== '' && Number.isFinite(Number(v))

/**
 * The panel's single text/number field.
 *
 * Commits on blur/Enter — mid-typing never reaches the engine. Escape
 * reverts. On a NUMERIC value it also supports the two conventions every
 * design tool shares:
 *
 *   • drag left/right to scrub (Shift = coarse, Alt = fine)
 *   • ArrowUp/Down to nudge
 *
 * Both are hard-gated on the current value actually being numeric, and both
 * are mouse/pen only — a touch drag scrolls the panel, because on a tablet
 * that is what dragging a field must do.
 */
function ExprInput({
  value,
  onCommit,
  error,
  ariaLabel,
  placeholder,
  mono = true,
  scrubbable = true,
  suffix,
  disabled = false,
  onPointerDownCapture,
  onInvalid,
}: {
  value: string
  onCommit: (value: string) => void
  error?: string
  ariaLabel: string
  placeholder?: string
  mono?: boolean
  /** Opt OUT of scrubbing. Even when true, a non-numeric value is never
   *  scrubbed — this only suppresses it for numeric fields that shouldn't
   *  drag (e.g. one inside a horizontally scrolling row). */
  scrubbable?: boolean
  /** Small unit label rendered inside the field, right-aligned (e.g. "px"). */
  suffix?: string
  disabled?: boolean
  /** Fires before ExprInput's own drag-tracking starts — needed by fields
   *  that must snapshot state (e.g. a live text selection elsewhere in the
   *  DOM) before this input's own focus/pointer handling can run. */
  onPointerDownCapture?: () => void
  /** Called when a commit is rejected by the caller's validation, so the
   *  field can say why instead of silently snapping back. */
  onInvalid?: (attempted: string) => string | void
}) {
  const [draft, setDraft] = useState(value)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  // ── Autocomplete ──────────────────────────────────────────────────────────
  // The whole discovery fix: a field can't LOOK like a plain number box when
  // it accepts `g` or [Mass 1(vx)]. Typing `[` opens the list; so does the
  // chip that appears on focus, for users who don't know the syntax exists.
  const scope = useContext(ExprScopeContext)
  const listId = useId()
  const [openList, setOpenList] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [query, setQuery] = useState('')
  const matches = useMemo(
    () => (openList ? filterScope(scope, query).slice(0, 8) : EMPTY_SCOPE),
    [openList, scope, query]
  )
  const closeList = () => {
    setOpenList(false)
    setQuery('')
    setHighlight(0)
  }
  /** Re-read the caret and decide whether a `[…` token is being typed. */
  const syncToken = (el: HTMLInputElement) => {
    if (!scope.length) return
    const tok = activeToken(el.value, el.selectionStart ?? el.value.length)
    if (tok) {
      setQuery(tok.query)
      setHighlight(0)
      setOpenList(true)
    } else if (openList && query !== '') {
      // Only auto-close a token-driven list; the chip-opened one stays put.
      closeList()
    }
  }
  const pick = (item: ScopeItem) => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? draft.length
    const next = spliceItem(draft, caret, item)
    setDraft(next.text)
    closeList()
    // Restore focus and drop the caret after the inserted token, so the user
    // can keep typing an operator without reaching for the mouse.
    requestAnimationFrame(() => {
      const node = inputRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(next.caret, next.caret)
    })
  }
  const dragRef = useRef<{ startX: number; startVal: number; dragged: boolean } | null>(null)
  /** True while a scrub is committing, so the value→draft sync below doesn't
   *  fight the gesture (each commit changes `value`, which would otherwise
   *  immediately overwrite the draft mid-drag and make the number stutter). */
  const scrubbingRef = useRef(false)

  useEffect(() => {
    if (scrubbingRef.current) return
    setDraft(value)
    setLocalError(null)
  }, [value])

  const canScrub = scrubbable && isNumericValue(draft)

  const commit = (next: string) => {
    const msg = next === value ? undefined : onInvalid?.(next)
    setLocalError(typeof msg === 'string' ? msg : null)
    onCommit(next)
  }

  const shownError = error ?? localError ?? undefined

  return (
    <div className="group/expr relative" ref={wrapRef}>
      <input
      ref={inputRef}
      aria-label={ariaLabel}
      aria-invalid={Boolean(shownError)}
      title={shownError}
      placeholder={placeholder}
      disabled={disabled}
      // `pan-y` keeps a vertical touch drag scrolling the panel; the scrub
      // gesture is mouse/pen only. Without this the panel could not be
      // scrolled by dragging over any field — the whole inspector felt stuck
      // on a tablet.
      style={{ touchAction: 'pan-y' }}
      className={cn(
        'w-full min-w-0 rounded-md border bg-background/60 px-2 py-1 text-[0.75rem] outline-none transition-colors focus:border-[var(--ring)] disabled:pointer-events-none disabled:opacity-30',
        mono && 'font-mono',
        shownError ? 'border-[var(--accent-rose)]' : 'border-input',
        // The ew-resize cursor is a PROMISE that dragging does something. It
        // now appears only where dragging actually scrubs.
        canScrub ? 'cursor-ew-resize' : 'cursor-text',
        suffix && 'pr-5',
        // Room for the [ ] chip so it never overlaps the value.
        scope.length > 0 && !disabled && !suffix && 'pr-7'
      )}
      role={scope.length ? 'combobox' : undefined}
      aria-expanded={scope.length ? openList : undefined}
      aria-autocomplete={scope.length ? 'list' : undefined}
      aria-controls={openList ? listId : undefined}
      aria-activedescendant={openList && matches.length ? `${listId}-${highlight}` : undefined}
      autoComplete="off"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        syncToken(e.currentTarget)
      }}
      onSelect={(e) => {
        // Arrow/click caret moves can leave or enter a token too.
        if (openList) syncToken(e.currentTarget)
      }}
      onPointerDown={(e) => {
        onPointerDownCapture?.()
        // Mouse/pen only: a touch drag belongs to the scroll container.
        if (!canScrub || e.button !== 0 || e.pointerType === 'touch') return
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
          scrubbingRef.current = true
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
          scrubbingRef.current = false
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        // A plain click is left alone: the browser places the caret where the
        // user clicked. Auto-selecting here (in a rAF, racing the native
        // caret placement) is what made the first click feel dead and forced
        // a second one. Select-all is available on focus-by-keyboard below,
        // and by the usual ⌘A once focused.
      }}
      onFocus={(e) => {
        // Tabbing into a field selects it (so typing replaces) — but only for
        // keyboard focus, never for a click, which must keep its caret.
        if (e.target.matches(':focus-visible')) e.target.select()
      }}
      onBlur={(e) => {
        scrubbingRef.current = false
        // Clicking a suggestion blurs the input — committing here would race
        // the pick and snap the draft back. relatedTarget is the row, which
        // lives inside this wrapper, so we let the pick handler finish.
        if (e.relatedTarget && wrapRef.current?.contains(e.relatedTarget as Node)) return
        closeList()
        if (draft !== value) commit(draft)
      }}
      onKeyDown={(e) => {
        // The suggestion list owns these keys while it's open, so Enter picks
        // a row instead of committing and Escape closes the list instead of
        // reverting the whole field. Both fall through once it's closed.
        if (openList && matches.length) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
            return
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault()
            e.stopPropagation()
            pick(matches[highlight])
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            closeList()
            return
          }
        }
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          setLocalError(null)
          e.currentTarget.blur()
        }
        // Arrow keys nudge — numeric values only, same guard as the scrubber.
        // Nudging "Mass 1" used to commit NaN.
        if (canScrub && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : e.altKey ? 0.01 : 1
          const next = String(
            Math.round((Number(draft) + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000
          )
          setDraft(next)
          commit(next)
        }
        e.stopPropagation()
      }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[0.625rem] text-muted-foreground">
          {suffix}
        </span>
      )}

      {/* The affordance. A field that accepts `g` or [Mass 1(vx)] cannot look
          identical to one that only takes a number — that was the entire
          discovery failure. This appears on hover/focus only, so a panel of
          number boxes stays calm until you engage with one. */}
      {scope.length > 0 && !disabled && !suffix && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Insert a variable or live value into ${ariaLabel}`}
          title="Insert a variable or live value  ·  or just type ["
          className={cn(
            'absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 py-0.5 font-mono text-[0.625rem] leading-none transition-opacity duration-150',
            // Base is VISIBLE-but-quiet, not hidden. A hover-only reveal
            // would leave the chip unreachable on a tablet, where there is no
            // hover and a tap gives focus (not :focus-visible). Pointer-fine
            // devices get the calmer fade-up instead.
            'text-muted-foreground opacity-50 hover:!opacity-100 hover:text-foreground',
            // Underscores are Tailwind's escape for spaces in an arbitrary
            // variant — without them the `and` fuses to the parens and the
            // whole stylesheet fails to parse.
            '[@media(hover:hover)_and_(pointer:fine)]:opacity-0',
            '[@media(hover:hover)_and_(pointer:fine)]:group-hover/expr:opacity-70',
            // Focusing the field is the moment you might want the picker.
            '[@media(hover:hover)_and_(pointer:fine)]:group-focus-within/expr:opacity-70',
            'focus-visible:!opacity-100',
            openList && '!opacity-100 text-[var(--accent-blue)]'
          )}
          onMouseDown={(e) => e.preventDefault()} // keep focus in the input
          onClick={() => {
            if (openList) return closeList()
            setQuery('')
            setHighlight(0)
            setOpenList(true)
            inputRef.current?.focus()
          }}
        >
          [ ]
        </button>
      )}

      {openList && matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Variables and live values"
          className="absolute left-0 right-0 top-[calc(100%+2px)] z-50 max-h-56 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {matches.map((m, i) => (
            <li
              key={m.insert}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              className={cn(
                'flex cursor-pointer items-baseline gap-2 px-2 py-1 text-[0.71875rem]',
                i === highlight && 'bg-accent'
              )}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                // mousedown, not click: click fires after blur, by which time
                // the field has already committed and closed the list.
                e.preventDefault()
                pick(m)
              }}
            >
              <span
                className={cn(
                  'shrink-0 font-mono',
                  m.kind === 'variable'
                    ? 'text-[var(--accent-amber)]'
                    : 'text-[var(--accent-blue)]'
                )}
              >
                {m.kind === 'variable' ? 'var' : 'live'}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono">{m.label}</span>
              <span className="shrink-0 truncate text-[0.625rem] text-muted-foreground">
                {m.hint}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[0.65625rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </p>
  )
}

/** One self-contained control group, framed so it reads as its own module
 *  instead of bleeding into the next — a ribbon of separate cards (font,
 *  size, spacing…) rather than one long undifferentiated stack. */
function OptionCard({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5 rounded-lg border border-border/50 bg-card/40 p-2.5">{children}</div>
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
        'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[0.625rem] font-medium transition-colors',
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

function ConnectorCapsSection({ pageId, object }: { pageId: string; object: SceneObject }) {
  const updateObject = useDocStore((s) => s.updateObject)
  const setCap = (which: 'startCap' | 'endCap', value: 'none' | 'arrow') =>
    updateObject(pageId, object.id, { metadata: { ...object.metadata, [which]: value } }, { history: true })

  const Row = ({ label, field }: { label: string; field: 'startCap' | 'endCap' }) => (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[0.6875rem] text-muted-foreground">{label}</span>
      <select
        aria-label={`${label} cap`}
        className="flex-1 rounded-md border border-border/70 bg-background px-2 py-1 text-[0.6875rem]"
        value={(object.metadata[field] as string | undefined) ?? 'none'}
        onChange={(e) => setCap(field, e.target.value as 'none' | 'arrow')}
      >
        <option value="none">None</option>
        <option value="arrow">Arrow</option>
      </select>
    </div>
  )

  return (
    <div>
      <SectionTitle>Connector</SectionTitle>
      <Row label="Start cap" field="startCap" />
      <Row label="End cap" field="endCap" />
    </div>
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
        <p className="mb-2 rounded-lg bg-accent/40 p-2 text-[0.71875rem] leading-relaxed text-muted-foreground">
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
                    'flex-1 text-[0.75rem] font-semibold',
                    !b.enabled && 'text-muted-foreground line-through'
                  )}
                >
                  {spec?.label ?? b.type}
                </span>
                {spec && !spec.live && (
                  <span className="rounded bg-accent px-1 py-0.5 text-[0.5625rem] uppercase tracking-wide text-muted-foreground">
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
                  <p className="mb-1 text-[0.59375rem] font-semibold uppercase tracking-wide text-muted-foreground">
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
                      <span className="w-20 shrink-0 truncate text-[0.6875rem] text-muted-foreground" title={ps.label}>
                        Collides
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={ps.label}
                        onClick={() => setBehaviorParam(pageId, object.id, b.id, ps.name, on ? '0' : '1')}
                        className={cn(
                          'relative rounded-full px-2 py-0.5 text-[0.625rem] font-semibold transition-colors',
              // Touch target: the pill stays visually small, but an invisible
              // inset overlay gives it a finger-sized hit area (WCAG 2.5.8).
              "after:absolute after:left-0 after:top-1/2 after:h-11 after:w-full after:-translate-y-1/2 after:content-['']",
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
                      <span className="w-20 shrink-0 truncate text-[0.6875rem] text-muted-foreground" title={ps.label}>
                        {ps.label}
                      </span>
                      <ExprInput
                        ariaLabel={`${spec?.label} ${ps.label}`}
                        value={p.expr}
                        error={p.error}
                        onCommit={(v) => setBehaviorParam(pageId, object.id, b.id, ps.name, v)}
                      />
                      <span className="w-14 shrink-0 truncate text-right font-mono text-[0.625rem] text-[var(--accent-amber)]">
                        {Number.isFinite(p.value) ? +p.value.toFixed(3) : '—'}
                      </span>
                    </div>
                    {p.error && (
                      <p className="ml-[5.5rem] mt-0.5 text-[0.625rem] text-[var(--accent-rose)]">{p.error}</p>
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
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-[0.75rem] text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
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
                <span className="text-[0.78125rem] font-medium">
                  {spec.label}
                  {!spec.live && (
                    <span className="ml-1.5 text-[0.5625rem] uppercase tracking-wide text-muted-foreground">
                      solver soon
                    </span>
                  )}
                </span>
                <span className="text-[0.6875rem] text-muted-foreground">{spec.hint}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

// Stable fallbacks (never recreated per render) so Zustand selectors always
// return the same reference — an inline `?? {}`/`?? []` rebuilds a fresh
// snapshot every render and trips useSyncExternalStore's bailout (React #185).
const EMPTY_OBJECTS: Record<string, SceneObject> = Object.freeze({})
const EMPTY_VARIABLES: Variable[] = Object.freeze([]) as unknown as Variable[]

function ExprScopeProvider({ pageId, children }: { pageId: string; children: React.ReactNode }) {
  const variables = useDocStore((s) => s.pages[pageId]?.variables ?? EMPTY_VARIABLES)
  const objects = useDocStore((s) => s.pages[pageId]?.objects ?? EMPTY_OBJECTS)
  const items = useMemo(() => scopeItems(variables, Object.values(objects)), [variables, objects])
  return <ExprScopeContext.Provider value={items}>{children}</ExprScopeContext.Provider>
}
const FALLBACK_VIEWPORT: Viewport = Object.freeze({ x: 0, y: 0, zoom: 1 })

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

const splitList = splitIds

const selectCls =
  'w-full min-w-0 rounded-md border border-input bg-background/60 px-1.5 py-1 text-[0.71875rem] outline-none focus:border-[var(--ring)]'

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1 text-[0.71875rem] text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
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
  const pageObjects = useDocStore((s) => s.pages[pageId]?.objects ?? EMPTY_OBJECTS)
  const { sources, sinks } = truthCandidates(Object.values(pageObjects))

  const picked = (param: 'inputs' | 'outputs') => splitList(getStr(object, param))

  const list = (
    param: 'inputs' | 'outputs',
    items: SceneObject[],
    empty: string,
    color: string
  ) => (
    <ColumnPicker
      items={items}
      value={getStr(object, param)}
      onChange={(next) => setStringParam(pageId, object.id, param, next)}
      color={color}
      empty={empty}
    />
  )

  const nIn = picked('inputs').length

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionTitle>Inputs</SectionTitle>
        {list('inputs', sources, 'Add a logic Input or Switch to the circuit.', 'var(--chart-1)')}
        {nIn > MAX_INPUTS && (
          <p className="text-[0.65625rem] text-[var(--accent-rose)]">
            Too many inputs — {MAX_INPUTS} max ({1 << MAX_INPUTS} rows).
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Outputs</SectionTitle>
        {list('outputs', sinks, 'Add an Output, logic probe, LED or bulb.', 'var(--chart-2)')}
      </div>

      <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
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
    'w-full min-w-0 rounded-md border border-input bg-background/60 px-1.5 py-1 font-mono text-[0.71875rem] outline-none focus:border-[var(--ring)]'

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
    <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
              <span className="text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
                <span className="text-[0.625rem] text-muted-foreground">Starting year</span>
                <YearInput
                  label={`Annuity ${idx + 1} start`}
                  value={a.start}
                  onCommit={(start) =>
                    write({ ...spec, annuities: spec.annuities.map((x, k) => (k === idx ? { ...x, start } : x)) })
                  }
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[0.625rem] text-muted-foreground">Time period (yrs)</span>
                <YearInput
                  label={`Annuity ${idx + 1} periods`}
                  value={a.periods}
                  onCommit={(periods) =>
                    write({ ...spec, annuities: spec.annuities.map((x, k) => (k === idx ? { ...x, periods } : x)) })
                  }
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[0.625rem] text-muted-foreground">Every (1, 1/2, 1/4)</span>
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
                <span className="text-[0.625rem] text-muted-foreground">Amount</span>
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
          <span className="w-16 shrink-0 text-[0.6875rem] text-muted-foreground">Amount</span>
          <MoneyInput label="Salvage value" value={spec.salvage} onCommit={(salvage) => write({ ...spec, salvage })} />
        </div>
        <p className="text-[0.65625rem] text-muted-foreground">Received at the end of the analysis horizon.</p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>MARR</SectionTitle>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[0.6875rem] text-muted-foreground">Percentage</span>
          <MoneyInput label="MARR percent" value={spec.marr} onCommit={(marr) => write({ ...spec, marr })} />
          <span className="text-[0.6875rem] text-muted-foreground">%</span>
        </div>
        <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
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
        className="rounded-md px-1.5 py-1 font-mono text-[0.71875rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
        <p className="rounded-lg bg-accent/40 p-2 text-[0.6875rem] leading-relaxed text-muted-foreground">
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
              className="flex items-center gap-1 text-[0.65625rem] text-muted-foreground transition-colors hover:text-[var(--accent-rose)]"
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

  const byId = new Map(bodies.map((b) => [b.id, b]))
  const series = parseSeries(object)
  // Channel discovery lives in lib/scene/bindings.ts — the same source the
  // Variables panel uses. This used to be a local re-guess from behaviors
  // that offered V/I/P for anything electrical, which was wrong for the many
  // symbols with their own channel sets (potentiometer, transformer, motors…).
  const channelsOf = (objId: string) => channelOptions(byId.get(objId))

  const writeSeries = (list: GraphSeries[]) => {
    set('series', serializeBindings(list))
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
    <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
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
  const xOptions = [...new Set(['t', ...(series[0] ? channelsOf(series[0].objectId) : [])])]

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <SectionTitle>Series</SectionTitle>
        {series.length === 0 && (
          <p className="rounded-lg bg-accent/40 p-2 text-[0.6875rem] leading-relaxed text-muted-foreground">
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
                const chs = channelsOf(objId)
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
              {!channelsOf(s.objectId).includes(s.channel) && <option value={s.channel}>{s.channel}</option>}
              {channelsOf(s.objectId).map((c) => (
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
              const chs = channelsOf(objId)
              writeSeries([...series, { objectId: objId, channel: chs.find((c) => !used.includes(c)) ?? chs[0] }])
            }}
          />
        ) : (
          <p className="text-[0.65625rem] text-muted-foreground">
            No physics objects yet — give something a Rigid Body behavior first.
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Layout</SectionTitle>
        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[0.6875rem] text-muted-foreground">Stacked</span>
          <button
            type="button"
            role="switch"
            aria-checked={getStr(object, 'stacked') === '1'}
            aria-label="Stacked charts"
            onClick={() => set('stacked', getStr(object, 'stacked') === '1' ? '' : '1')}
            className={cn(
              'relative rounded-full px-2 py-0.5 text-[0.625rem] font-semibold transition-colors',
              // Touch target: the pill stays visually small, but an invisible
              // inset overlay gives it a finger-sized hit area (WCAG 2.5.8).
              "after:absolute after:left-0 after:top-1/2 after:h-11 after:w-full after:-translate-y-1/2 after:content-['']",
              getStr(object, 'stacked') === '1'
                ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)]'
                : 'bg-accent text-muted-foreground'
            )}
          >
            {getStr(object, 'stacked') === '1' ? 'On' : 'Off'}
          </button>
          <span className="text-[0.65625rem] text-muted-foreground">one mini chart per series</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Axes</SectionTitle>
        <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
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
        <p className="text-[0.65625rem] text-muted-foreground">
          Blank = auto. Values can be expressions (e.g. <span className="font-mono">2*g</span>).
        </p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Formulas</SectionTitle>
        {editableList(formulas, writeFormulas, 'Formula')}
        <AddRowButton label="Add formula" onClick={() => writeFormulas([...formulas, 'sin(t)'])} />
        <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
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
              <p className="text-[0.65625rem] text-muted-foreground">{label}</p>
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
    <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
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
        <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
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
        <p className="text-[0.65625rem] text-muted-foreground">Values can be expressions (e.g. 2*r).</p>
      </div>

      <div className="space-y-1.5">
        <SectionTitle>Resolution</SectionTitle>
        <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <span className="w-8 shrink-0 font-mono">grid</span>
          <ExprInput
            ariaLabel="Grid resolution"
            value={getStr(object, 'res')}
            placeholder="28"
            scrubbable={false}
            onCommit={(v) => set('res', v)}
          />
        </label>
        <p className="text-[0.65625rem] text-muted-foreground">Samples per axis, 8–60. Higher is smoother but slower.</p>
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
                'flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[0.59375rem]',
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
            <span className="w-14 shrink-0 text-[0.6875rem] text-muted-foreground">Stacked</span>
            <button
              type="button"
              role="switch"
              aria-checked={stacked}
              aria-label="Stacked series"
              onClick={() => set('stacked', stacked ? '' : '1')}
              className={cn(
                'relative rounded-full px-2 py-0.5 text-[0.625rem] font-semibold transition-colors',
              // Touch target: the pill stays visually small, but an invisible
              // inset overlay gives it a finger-sized hit area (WCAG 2.5.8).
              "after:absolute after:left-0 after:top-1/2 after:h-11 after:w-full after:-translate-y-1/2 after:content-['']",
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
          <label className="flex min-h-9 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.65625rem] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
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
          <table className="w-full border-collapse font-mono text-[0.65625rem]">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="bg-[var(--accent-blue)]/8">
                <th className="min-w-[52px] border-b border-r border-border/50 px-1.5 py-1 text-left text-[0.625rem] font-semibold text-muted-foreground">
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
        <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
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
        <label className="text-[0.6875rem] text-muted-foreground">Label</label>
        <ExprInput
          value={label}
          onCommit={(v) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, label: str(v) } },
              { history: true }
            )
          }
          ariaLabel="Label"
          mono={false}
        />
      </div>

      <div>
        <label className="text-[0.6875rem] text-muted-foreground">Target Type</label>
        <select
          aria-label="Target Type"
          value={targetType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none"
        >
          <option value="variable">Page Variable</option>
          <option value="objectParam">Component Parameter</option>
        </select>
      </div>

      {targetType === 'objectParam' && (
        <div>
          <label className="text-[0.6875rem] text-muted-foreground">Target Component</label>
          <select
            aria-label="Target Component"
            value={targetObjectId}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, targetObjectId: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none"
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
        <label className="text-[0.6875rem] text-muted-foreground">Target Parameter / Variable</label>
        <select
          aria-label="Target Parameter / Variable"
          value={targetParamName}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetParamName: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none"
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

      {/* Min/Max/Step commit on blur via ExprInput. As raw <input onChange>
          they pushed a history entry per KEYSTROKE, so typing "2500" left
          four undo steps and undo became unusable. */}
      <div className="grid grid-cols-3 gap-1.5">
        {([
          ['Min', 'min', min],
          ['Max', 'max', max],
          ['Step', 'step', step],
        ] as const).map(([label, key, val]) => (
          <div key={key}>
            <label className="text-[0.625rem] text-muted-foreground">{label}</label>
            <ExprInput
              ariaLabel={`Slider ${label}`}
              value={String(val)}
              onInvalid={(v) => (Number.isFinite(Number(v)) ? undefined : 'Enter a number')}
              onCommit={(v) => {
                if (!Number.isFinite(Number(v))) return
                updateObject(
                  pageId,
                  object.id,
                  { parameters: { ...object.parameters, [key]: num(v) } },
                  { history: true }
                )
              }}
            />
          </div>
        ))}
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
        <label className="text-[0.6875rem] text-muted-foreground">Label</label>
        <ExprInput
          value={label}
          onCommit={(v) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, label: str(v) } },
              { history: true }
            )
          }
          ariaLabel="Label"
          mono={false}
        />
      </div>

      <div>
        <label className="text-[0.6875rem] text-muted-foreground">Action Type</label>
        <select
          aria-label="Action Type"
          value={actionType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, actionType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none"
        >
          <option value="set">Set Target Value</option>
          <option value="toggle">Toggle Flag (0 ↔ 1)</option>
          <option value="step">Step Add Value</option>
        </select>
      </div>

      <div>
        <label className="text-[0.6875rem] text-muted-foreground">Target Type</label>
        <select
          aria-label="Target Type"
          value={targetType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none"
        >
          <option value="variable">Page Variable</option>
          <option value="objectParam">Component Parameter</option>
        </select>
      </div>

      {targetType === 'objectParam' && (
        <div>
          <label className="text-[0.6875rem] text-muted-foreground">Target Component</label>
          <select
            aria-label="Target Component"
            value={targetObjectId}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, targetObjectId: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none"
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
        <label className="text-[0.6875rem] text-muted-foreground">Target Parameter / Variable</label>
        <select
          aria-label="Target Parameter / Variable"
          value={targetParamName}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetParamName: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none"
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
          <label className="text-[0.6875rem] text-muted-foreground">Value to Set / Step</label>
          <ExprInput
            ariaLabel="Value to set / step"
            value={String(targetValue)}
            onInvalid={(v) => (Number.isFinite(Number(v)) ? undefined : 'Enter a number')}
            onCommit={(v) => {
              if (!Number.isFinite(Number(v))) return
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, targetValue: num(v) } },
                { history: true }
              )
            }}
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
        <label className="text-[0.6875rem] text-muted-foreground">Label</label>
        <ExprInput
          value={label}
          onCommit={(v) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, label: str(v) } },
              { history: true }
            )
          }
          ariaLabel="Label"
          mono={false}
        />
      </div>

      <div className="rounded-lg border border-border/60 bg-accent/30 p-2 space-y-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-wider text-muted-foreground">Monitored Source</p>
        <select
          aria-label="Monitored Source"
          value={sourceType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, sourceType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.71875rem] outline-none"
        >
          <option value="variable">Page Variable</option>
          <option value="objectParam">Component Parameter</option>
        </select>

        {sourceType === 'objectParam' && (
          <select
            aria-label="Component Parameter"
            value={sourceObjectId}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, sourceObjectId: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.71875rem] outline-none"
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
          aria-label="Monitored parameter"
          value={sourceParamName}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, sourceParamName: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.71875rem] outline-none"
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
          <label className="text-[0.625rem] text-muted-foreground">Operator</label>
          <select
            aria-label="Operator"
            value={condition}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, condition: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] font-mono outline-none"
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
          <label className="text-[0.625rem] text-muted-foreground">Threshold Value</label>
          <ExprInput
            ariaLabel="Threshold value"
            value={String(threshold)}
            onInvalid={(v) => (Number.isFinite(Number(v)) ? undefined : 'Enter a number')}
            onCommit={(v) => {
              if (!Number.isFinite(Number(v))) return
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, threshold: num(v) } },
                { history: true }
              )
            }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border/60 bg-accent/30 p-2 space-y-2">
        <p className="text-[0.625rem] font-bold uppercase tracking-wider text-muted-foreground">Target Action</p>
        <select
          aria-label="Target Action"
          value={targetType}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetType: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.71875rem] outline-none"
        >
          <option value="variable">Page Variable</option>
          <option value="objectParam">Component Parameter</option>
        </select>

        {targetType === 'objectParam' && (
          <select
            aria-label="Component Parameter"
            value={targetObjectId}
            onChange={(e) =>
              updateObject(
                pageId,
                object.id,
                { parameters: { ...object.parameters, targetObjectId: str(e.target.value) } },
                { history: true }
              )
            }
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.71875rem] outline-none"
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
          aria-label="Target parameter"
          value={targetParamName}
          onChange={(e) =>
            updateObject(
              pageId,
              object.id,
              { parameters: { ...object.parameters, targetParamName: str(e.target.value) } },
              { history: true }
            )
          }
          className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.71875rem] outline-none"
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

/** A small gray field caption — Figma's own field labels ("Alignment",
 *  "Position", "Resizing"…) inside each section. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 text-[0.6875rem] text-muted-foreground">{children}</p>
}

/** A flat, divider-separated section — Figma's Design panel stacks Position/
 *  Layout/Appearance/Typography/Fill this way (no individual card borders),
 *  unlike the rest of this app's per-kind panels (see OptionCard above),
 *  which the text panel deliberately departs from to match Figma exactly. */
function PanelSection({
  title,
  right,
  children,
  last = false,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div className={cn('space-y-2.5 pb-3', !last && 'border-b border-border/60')}>
      <div className="flex items-center justify-between">
        <h3 className="text-[0.78125rem] font-semibold text-foreground">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}

const H_FRAME_ALIGN = [
  { id: 'left' as const, edge: 'left' as const, Icon: AlignHorizontalJustifyStart },
  { id: 'center' as const, edge: 'centerH' as const, Icon: AlignHorizontalJustifyCenter },
  { id: 'right' as const, edge: 'right' as const, Icon: AlignHorizontalJustifyEnd },
]
const V_FRAME_ALIGN = [
  { id: 'top' as const, edge: 'top' as const, Icon: AlignVerticalJustifyStart },
  { id: 'middle' as const, edge: 'centerV' as const, Icon: AlignVerticalJustifyCenter },
  { id: 'bottom' as const, edge: 'bottom' as const, Icon: AlignVerticalJustifyEnd },
]
type ViewportEdge = (typeof H_FRAME_ALIGN)[number]['edge'] | (typeof V_FRAME_ALIGN)[number]['edge']

const V_TEXT_ALIGN = [
  { id: 'top' as const, Icon: AlignVerticalJustifyStart },
  { id: 'middle' as const, Icon: AlignVerticalJustifyCenter },
  { id: 'bottom' as const, Icon: AlignVerticalJustifyEnd },
]

const WEIGHT_LABELS: Record<keyof typeof TEXT_WEIGHTS, string> = {
  thin: 'Thin',
  light: 'Light',
  regular: 'Regular',
  medium: 'Medium',
  semibold: 'Semibold',
  bold: 'Bold',
  black: 'Black',
}

/** Position → Alignment: this canvas has no parent "frame" to align a layer
 *  against (unlike Figma), so these align to the visible viewport instead —
 *  the real, useful equivalent given what's actually on screen. Reads the
 *  canvas's live on-screen rect via the data-canvas-root bridge (see
 *  canvas.tsx) since the Properties panel lives in a separate component
 *  tree with no ref of its own into it. */
function alignObjectToViewport(
  pageId: string,
  object: SceneObject,
  updateObject: ReturnType<typeof useDocStore.getState>['updateObject'],
  viewport: Viewport,
  edge: ViewportEdge
) {
  const root = Array.from(document.querySelectorAll('[data-canvas-root]')).find(
    (el) => (el as HTMLElement).dataset.canvasRoot === pageId
  ) as HTMLElement | undefined
  const rect = root?.getBoundingClientRect()
  if (!rect) return
  const left = -viewport.x / viewport.zoom
  const right = (rect.width - viewport.x) / viewport.zoom
  const top = -viewport.y / viewport.zoom
  const bottom = (rect.height - viewport.y) / viewport.zoom
  const position = { ...object.position }
  if (edge === 'left') position.x = left
  else if (edge === 'centerH') position.x = (left + right) / 2 - object.size.w / 2
  else if (edge === 'right') position.x = right - object.size.w
  else if (edge === 'top') position.y = top
  else if (edge === 'centerV') position.y = (top + bottom) / 2 - object.size.h / 2
  else if (edge === 'bottom') position.y = bottom - object.size.h
  updateObject(pageId, object.id, { position }, { history: true })
}

/** Text object's Properties panel, rebuilt to match Figma's Design panel
 *  section-for-section (Position/Layout/Appearance/Typography/Fill) instead
 *  of this app's usual generic Transform card + kind-specific options.
 *  Format/color/weight/size act on the LIVE SELECTION inside whichever text
 *  box is currently being edited (via useActiveTextEditor, bridged from
 *  components/objects/text.tsx — the panel can't reach the canvas's
 *  contentEditable any other way); everything else here is box-level. */
function TextObjectPanel({ pageId, object }: { pageId: string; object: SceneObject }) {
  const updateObject = useDocStore((s) => s.updateObject)
  const viewport = useDocStore((s) => s.viewports[pageId] ?? FALLBACK_VIEWPORT)
  const activeId = useActiveTextEditor((s) => s.objectId)
  const handleRef = useActiveTextEditor((s) => s.handleRef)
  const isActive = activeId === object.id

  const align = (object.metadata.align as string) ?? 'left'
  const vAlign = (object.metadata.verticalAlign as string) ?? 'top'
  const resizing = (object.metadata.resizing as string) ?? 'fixed'
  const hidden = Boolean(object.metadata.hidden)
  const lineHeight = object.metadata.lineHeight as number | undefined
  const letterSpacing = (object.metadata.letterSpacing as number | undefined) ?? 0
  const bg = (object.metadata.color as string) ?? ''
  // Custom colors, shared across the WHOLE document (every sheet/slide, not
  // just this one) — added via any "+" swatch picker below, kept even after
  // whatever added one no longer uses it.
  const documentId = useWorkspaceStore((s) => ownerPageOf(s.nodes, pageId))
  const swatches = usePageSwatches((s) => s.swatches[documentId] ?? EMPTY_SWATCHES)
  const addSwatch = (hex: string) => usePageSwatches.getState().add(documentId, hex)
  const imageSwatches = useImagePalette(pageId)

  const setMeta = (patch: Record<string, unknown>) =>
    updateObject(pageId, object.id, { metadata: { ...object.metadata, ...patch } }, { history: true })

  const toggleMark = (kind: MarkKind) => {
    if (handleRef?.current) {
      handleRef.current.toggleMark(kind)
    } else {
      const raw = htmlToMarkdownSource(getString(object, 'text'))
      const parsed = parse(raw)
      const fullEnd = Math.max(0, parsed.text.length)
      const newMarks = applyMark(parsed.marks, 0, fullEnd, kind)
      const next = serialize({ text: parsed.text, marks: newMarks })
      useDocStore.getState().setStringParam(pageId, object.id, 'text', next)
    }
  }
  const prefixLine = (prefix: string) => handleRef?.current?.prefixLine(prefix)
  const setSpan = (kind: 'size' | 'color' | 'font' | 'weight', value: string, wholeBox?: boolean) => {
    if (handleRef?.current) {
      handleRef.current.setSpan(kind, value, wholeBox)
    } else {
      const raw = htmlToMarkdownSource(getString(object, 'text'))
      const parsed = parse(raw)
      const fullEnd = Math.max(0, parsed.text.length)
      const newMarks = applyMark(parsed.marks, 0, fullEnd, kind, value)
      const next = serialize({ text: parsed.text, marks: newMarks })
      useDocStore.getState().setStringParam(pageId, object.id, 'text', next)
    }
  }
  // Link has no dedicated input field (a URL isn't a bounded palette the
  // way color/size are) — window.prompt is the same lightweight pattern
  // already used elsewhere in this panel tree (canvas.tsx's "rename" flows)
  // for a single quick text value. Applies as an exclusive mark keyed by
  // 'link' in setSpan's underlying applyMark, exactly like color/size/font/
  // weight — see lib/text/marks.ts.
  const applyLink = () => {
    const url = window.prompt('Link URL')
    if (url && url.trim()) handleRef?.current?.setSpan('link', url.trim())
  }
  // Called from the Size input's onFocus, before the browser's native
  // focus-shift lands — see snapshotSelection's doc comment in
  // lib/store/text-editor.ts for why the Size field specifically needs this
  // and Bold/color/etc's plain buttons don't.
  const snapshotSelection = () => handleRef?.current?.snapshotSelection()

  // Staged "last applied" values — same reasoning as the old size stepper:
  // the markdown model wraps a NEW span per apply rather than tracking one
  // live current value (a selection can already span several), so there's no
  // true value to read back. These just remember what was last picked/typed.
  const [font, setFont] = useState<keyof typeof TEXT_FONTS>('sans')
  const [fontOpen, setFontOpen] = useState(false)
  const [weight, setWeight] = useState<keyof typeof TEXT_WEIGHTS>('regular')
  const [size, setSize] = useState(TEXT_SIZES.m)
  const applySize = (v: string) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return
    const clamped = Math.min(200, Math.max(6, Math.round(n)))
    setSize(clamped)
    // Each commit (scrub tick, arrow nudge, or typed Enter/blur) re-snapshots
    // first — snapshotSelection() no-ops if the last snapshot is still
    // "fresh" (see its doc comment), so a drag's rapid-fire onCommit calls
    // keep reapplying to the SAME captured range instead of each needing its
    // own click.
    snapshotSelection()
    setSpan('size', String(clamped))
  }

  // preventDefault on pointerdown keeps the editor's selection alive while
  // clicking a panel button — the panel is a different part of the DOM than
  // the contentEditable, so without this the click would blur it first and
  // collapse whatever text was selected.
  const guard = (e: React.PointerEvent) => e.preventDefault()
  // Same intent as guard, but for Radix DropdownMenuTrigger buttons (Font
  // family, Weight) specifically: Radix's own trigger opens on POINTERDOWN
  // via composeEventHandlers, which SKIPS its own open-toggle if the passed-
  // in onPointerDown already called preventDefault() — so `guard` here would
  // silently stop the menu from ever opening (confirmed against
  // @radix-ui/react-dropdown-menu's source: DropdownMenuTrigger's
  // onPointerDown composes ours first, and Radix's composeEventHandlers
  // checks event.defaultPrevented before running the open-toggle). Guarding
  // on mousedown instead still blocks the native focus-steal that would blur
  // the contentEditable (focus shifts on mousedown, before pointerdown/
  // click), but Radix never listens on mousedown at all, so it can't see —
  // and can't be short-circuited by — this preventDefault.
  const guardTrigger = (e: React.MouseEvent) => e.preventDefault()

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

  /** A plain px field — X/Y/W/H all read/write object geometry directly (it's
   *  already in px internally; unlike every other object kind, this panel
   *  shows raw pixels rather than the app's usual cm display unit — Figma
   *  parity, by explicit request). */
  const pxField = (label: string, value: number, commit: (n: number) => void) => (
    <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
      <span className="w-3 shrink-0">{label}</span>
      <ExprInput
        ariaLabel={label}
        value={String(Math.round(value))}
        onCommit={(v) => {
          const n = Number(v)
          if (Number.isFinite(n)) commit(n)
        }}
      />
    </label>
  )

  const segButton = (
    key: string,
    label: string,
    pressed: boolean,
    Icon: typeof Bold,
    onClick: () => void
  ) => (
    <button
      key={key}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'flex flex-1 items-center justify-center rounded-md py-1 transition-colors',
        pressed
          ? 'bg-[var(--accent-blue)] text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      )}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )

  return (
    <div className="space-y-3">
      <PanelSection
        title="Position"
        right={
          <button
            type="button"
            aria-label={hidden ? 'Show object' : 'Hide object'}
            aria-pressed={hidden}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={() => setMeta({ hidden: !hidden })}
          >
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        }
      >
        <div>
          <FieldLabel>Alignment</FieldLabel>
          <div className="flex items-center gap-0.5 rounded-lg bg-accent/40 p-0.5">
            {H_FRAME_ALIGN.map(({ id, edge, Icon }) =>
              segButton(id, `Align ${id} in view`, false, Icon, () =>
                alignObjectToViewport(pageId, object, updateObject, viewport, edge)
              )
            )}
            <span className="mx-0.5 h-4 w-px bg-border" />
            {V_FRAME_ALIGN.map(({ id, edge, Icon }) =>
              segButton(id, `Align ${id} in view`, false, Icon, () =>
                alignObjectToViewport(pageId, object, updateObject, viewport, edge)
              )
            )}
          </div>
        </div>
        <div>
          <FieldLabel>Position</FieldLabel>
          <div className="grid grid-cols-2 gap-1.5">
            {pxField('X', object.position.x, (n) =>
              updateObject(pageId, object.id, { position: { ...object.position, x: n } }, { history: true })
            )}
            {pxField('Y', object.position.y, (n) =>
              updateObject(pageId, object.id, { position: { ...object.position, y: n } }, { history: true })
            )}
          </div>
        </div>
        <div>
          <FieldLabel>Rotation</FieldLabel>
          <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
            <RotateCw className="h-3.5 w-3.5 shrink-0" />
            <ExprInput
              ariaLabel="Rotation"
              value={String(Math.round(object.rotation * 100) / 100)}
              onCommit={(v) => {
                const n = Number(v)
                if (Number.isFinite(n)) updateObject(pageId, object.id, { rotation: n }, { history: true })
              }}
            />
            <span className="shrink-0 text-[0.625rem] opacity-60">°</span>
          </label>
        </div>
      </PanelSection>

      <PanelSection title="Layout">
        <div>
          <FieldLabel>Resizing</FieldLabel>
          <div className="flex gap-1 rounded-lg bg-accent/40 p-0.5">
            {segButton('fixed', 'Fixed width', resizing === 'fixed', UnfoldHorizontal, () =>
              setMeta({ resizing: 'fixed' })
            )}
            {segButton('hug', 'Hug contents', resizing === 'hug', FoldHorizontal, () =>
              setMeta({ resizing: 'hug' })
            )}
          </div>
        </div>
        <div>
          <FieldLabel>Dimensions</FieldLabel>
          <div className="grid grid-cols-2 gap-1.5">
            {pxField('W', object.size.w, (n) =>
              n > 4 && updateObject(pageId, object.id, { size: { ...object.size, w: n } }, { history: true })
            )}
            {pxField('H', object.size.h, (n) =>
              n > 4 && updateObject(pageId, object.id, { size: { ...object.size, h: n } }, { history: true })
            )}
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Typography" last>
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
                <DropdownMenuItem key={s.label} className="gap-2 text-[0.75rem]" onSelect={() => prefixLine(s.prefix)}>
                  <s.icon className="h-3.5 w-3.5" /> {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {iconBtn('Bold (Ctrl+B)', Bold, () => toggleMark('bold'))}
          {iconBtn('Italic (Ctrl+I)', Italic, () => toggleMark('italic'))}
          {iconBtn('Underline (Ctrl+U)', Underline, () => toggleMark('underline'))}
          {iconBtn('Strikethrough', Strikethrough, () => toggleMark('strike'))}
          {iconBtn('Highlight', Highlighter, () => toggleMark('highlight'))}
          {iconBtn('Inline code', Code, () => toggleMark('code'))}
          {iconBtn('Link', Link, applyLink)}
          <span className="mx-0.5 h-4 w-px bg-border" />
          {iconBtn('Bullet list', List, () => prefixLine('- '))}
          {iconBtn('Numbered list', ListOrdered, () => prefixLine('1. '))}
          {iconBtn('Checklist', CheckSquare, () => prefixLine('- [ ] '))}
          {iconBtn('Quote', Quote, () => prefixLine('> '))}
        </div>
        {!isActive && (
          <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
            Double-click into the text and select some — these apply to the selection, not the whole box.
          </p>
        )}

        <div>
          <FieldLabel>Selection color</FieldLabel>
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(TEXT_COLORS).map(([id, value]) => (
              <button
                key={id}
                type="button"
                aria-label={`Text color ${id}`}
                disabled={!isActive}
                className="h-5 w-5 rounded-full border-2 border-transparent transition-transform hover:scale-110 disabled:pointer-events-none disabled:opacity-30"
                style={{ background: value }}
                onPointerDown={guard}
                onClick={() => setSpan('color', id)}
              />
            ))}
            {swatches.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`Text color ${hex}`}
                disabled={!isActive}
                className="h-5 w-5 rounded-full border-2 border-transparent transition-transform hover:scale-110 disabled:pointer-events-none disabled:opacity-30"
                style={{ background: hex }}
                onPointerDown={guard}
                onClick={() => setSpan('color', hex)}
              />
            ))}
            {/* Custom color — opens BEFORE the popover to capture the live
                selection, same reasoning the Size field's snapshotSelection
                uses: any UI stealing focus from the contentEditable would
                otherwise collapse the selection first. Committed colors join
                the same document-wide swatch palette as Background. */}
            {isActive && (
              <span onPointerDown={snapshotSelection}>
                <HexColorSwatchPicker
                  label="Custom text color"
                  imageSwatches={imageSwatches}
                  onChange={(hex) => setSpan('color', hex)}
                  onCommit={(hex) => {
                    setSpan('color', hex)
                    addSwatch(hex)
                  }}
                />
              </span>
            )}
          </div>
        </div>

        {/* Not in the Figma reference — bare text has no parent frame to
            paint a fill on there. Pre-existing, separate app feature: a
            tint behind the whole box, not the text itself (glyph color is
            Selection color above, not here). Kept right below it since both
            are "pick a color" controls. */}
        <div>
          <FieldLabel>Background</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-label="No background"
              aria-pressed={!bg}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border-2 text-[0.625rem] text-muted-foreground',
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
            {swatches.map((hex) => (
              <button
                key={hex}
                type="button"
                aria-label={`Background ${hex}`}
                aria-pressed={bg === hex}
                className={cn(
                  'h-6 w-6 rounded-full border-2',
                  bg === hex ? 'scale-110 border-[var(--ring)]' : 'border-transparent'
                )}
                style={{ background: hex }}
                onClick={() => setMeta({ color: hex })}
              />
            ))}
            <HexColorSwatchPicker
              label="Custom background color"
              size="md"
              imageSwatches={imageSwatches}
              onChange={(hex) => setMeta({ color: hex })}
              onCommit={(hex) => {
                setMeta({ color: hex })
                addSwatch(hex)
              }}
            />
          </div>
          <p className="mt-1 text-[0.65625rem] leading-relaxed text-muted-foreground">
            A tint behind the whole box, not the text itself.
          </p>
        </div>

        <div>
          <FieldLabel>Font family</FieldLabel>
          {/* Expands IN PLACE (a plain conditional render, no portal) rather
              than a floating Radix popup — Radix's portal-positioned content
              can render detached from its trigger whenever an ancestor
              scales via CSS zoom (Panel text size), since the two no longer
              share a coordinate space the portal's position math accounts
              for. An in-place list can never misposition: it's just the
              next sibling in normal flow. */}
          <button
            type="button"
            aria-label="Font family"
            aria-expanded={fontOpen}
            className="flex w-full items-center justify-between gap-1.5 rounded-md border border-input bg-background/60 px-2 py-1.5 text-[0.75rem] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
            onMouseDown={(e) => {
              guardTrigger(e)
              snapshotSelection()
            }}
            onClick={() => setFontOpen((v) => !v)}
          >
            <span className="flex items-center gap-1.5">
              <Type className="h-3.5 w-3.5 text-muted-foreground" />
              {TEXT_FONT_LABELS[font]}
            </span>
            <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', fontOpen && 'rotate-180')} />
          </button>
          {fontOpen && (
            <div className="mt-1 max-h-64 overflow-y-auto rounded-md border border-input bg-background/95 p-1">
              {FONT_GROUPS.map((group) => (
                <div key={group.label}>
                  {/* Group header — non-interactive divider */}
                  <div className="px-2 pb-0.5 pt-2 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted-foreground/70 first:pt-1">
                    {group.label}
                  </div>
                  {group.keys.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className={cn(
                        'block w-full rounded-md px-2 py-1.5 text-left text-[0.8125rem] transition-colors hover:bg-accent',
                        id === font && 'bg-accent'
                      )}
                      style={{ fontFamily: TEXT_FONTS[id] }}
                      onPointerDown={guard}
                      onClick={() => {
                        setFont(id)
                        setSpan('font', id, true)
                        setFontOpen(false)
                      }}
                    >
                      {TEXT_FONT_LABELS[id]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <FieldLabel>Weight</FieldLabel>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Font weight"
                  disabled={!isActive}
                  className="flex w-full items-center justify-between gap-1 rounded-md border border-input bg-background/60 px-2 py-1.5 text-[0.75rem] text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                  onMouseDown={(e) => {
                    guardTrigger(e)
                    // Opening the dropdown is a Radix state change — by the
                    // time an item's onSelect fires, window.getSelection()
                    // may no longer reflect what was live when this button
                    // was pressed, so capture it now; setSpan consumes it
                    // once. (Font family used to have this same comment —
                    // it now always applies whole-box instead, see its own
                    // setSpan(..., true) call.)
                    snapshotSelection()
                  }}
                >
                  {WEIGHT_LABELS[weight]}
                  <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="glass-strong w-32">
                {(Object.keys(TEXT_WEIGHTS) as (keyof typeof TEXT_WEIGHTS)[]).map((id) => (
                  <DropdownMenuItem
                    key={id}
                    className="text-[0.78125rem]"
                    style={{ fontWeight: TEXT_WEIGHTS[id] }}
                    onSelect={() => {
                      setWeight(id)
                      setSpan('weight', id)
                    }}
                  >
                    {WEIGHT_LABELS[id]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div>
            <FieldLabel>Size</FieldLabel>
            {/* Same scrubbable numeric field every other value in this panel
                uses (drag = scrub, arrows = nudge, type = commit on blur/
                Enter) — applySize() re-snapshots the text selection on every
                commit (see its comment) so drag-scrubbing reapplies live to
                the same captured range instead of needing a fresh click per
                tick. Can't use the plain `guard` pattern (preventDefault on
                pointerdown) other buttons use — this field must be able to
                take focus so typing works — so the selection snapshot has to
                happen via onPointerDownCapture, which fires before
                ExprInput's own drag-tracking and before the browser's focus
                shift collapses window.getSelection() out of the
                contentEditable. */}
              <ExprInput
                ariaLabel="Font size in pixels"
                value={String(size)}
                suffix="px"
                disabled={!isActive}
                onPointerDownCapture={isActive ? snapshotSelection : undefined}
                onCommit={applySize}
              />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <FieldLabel>Line height</FieldLabel>
            <ExprInput
              ariaLabel="Line height"
              placeholder="Auto"
              value={lineHeight !== undefined ? String(lineHeight) : ''}
              onCommit={(v) => {
                if (v.trim() === '') {
                  setMeta({ lineHeight: undefined })
                  return
                }
                const n = Number(v)
                if (Number.isFinite(n)) setMeta({ lineHeight: Math.max(0.5, n) })
              }}
            />
          </div>
          <div>
            <FieldLabel>Letter spacing</FieldLabel>
            <label className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
              <ExprInput
                ariaLabel="Letter spacing"
                value={String(letterSpacing)}
                onCommit={(v) => {
                  const n = Number(v)
                  if (Number.isFinite(n)) setMeta({ letterSpacing: n })
                }}
              />
              <span className="shrink-0 text-[0.625rem] opacity-60">%</span>
            </label>
          </div>
        </div>

        <div>
          <FieldLabel>Alignment</FieldLabel>
          <div className="flex gap-1 rounded-lg bg-accent/40 p-0.5">
            {(['left', 'center', 'right'] as const).map((a) =>
              segButton(a, `Align text ${a}`, align === a, ALIGN_ICONS[a], () => setMeta({ align: a }))
            )}
            <span className="mx-0.5 h-4 w-px bg-border" />
            {V_TEXT_ALIGN.map(({ id, Icon }) =>
              segButton(id, `Align text ${id}`, vAlign === id, Icon, () => setMeta({ verticalAlign: id }))
            )}
          </div>
        </div>
      </PanelSection>
    </div>
  )
}

const SHAPE_KINDS = new Set<GeometryKind>(['rect', 'circle', 'polygon', 'line'])

function AppearanceSection({ pageId, object }: { pageId: string; object: SceneObject }) {
  const updateObject = useDocStore((s) => s.updateObject)
  const kind = object.geometry.kind
  const isShape = SHAPE_KINDS.has(kind)
  const isPicture = kind === 'picture'
  const hasFill = isShape && kind !== 'line'
  const hasStroke = isShape || isPicture
  const hasCornerRadius = kind === 'rect' || isPicture
  const opacity = (object.metadata.opacity as number | undefined) ?? 100
  const fillColor = (object.metadata.fillColor as string | undefined) ?? ''
  const strokeColor = (object.metadata.strokeColor as string | undefined) ?? ''
  const strokeWidth = (object.metadata.strokeWidth as number | undefined) ?? 2
  const cornerRadius = (object.metadata.cornerRadius as number | undefined) ?? 8
  const documentId = useWorkspaceStore((s) => ownerPageOf(s.nodes, pageId))
  const swatches = usePageSwatches((s) => s.swatches[documentId] ?? EMPTY_SWATCHES)
  const imageSwatches = useImagePalette(pageId)

  const setMeta = (patch: Record<string, unknown>) =>
    updateObject(pageId, object.id, { metadata: { ...object.metadata, ...patch } }, { history: true })

  const colorField = (label: string, value: string, commit: (hex: string) => void, clear: () => void) => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`No ${label.toLowerCase()}`}
          aria-pressed={!value}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[0.625rem] text-muted-foreground',
            !value ? 'border-[var(--ring)]' : 'border-transparent'
          )}
          onClick={clear}
        >
          ×
        </button>
        <HexColorSwatchPicker
          label={`Custom ${label.toLowerCase()}`}
          initial={value || '#000000'}
          documentSwatches={swatches}
          imageSwatches={imageSwatches}
          onChange={commit}
          onCommit={(hex) => {
            commit(hex)
            usePageSwatches.getState().add(documentId, hex)
          }}
          trigger={
            <button
              type="button"
              aria-label={`Custom ${label.toLowerCase()}`}
              className="h-6 w-6 shrink-0 rounded-full border border-border"
              style={{ background: value || 'repeating-conic-gradient(#8883 0% 25%, transparent 0% 50%) 0/8px 8px' }}
            />
          }
        />
      </div>
    </div>
  )

  /** A labeled numeric field with a unit suffix, matching colorField's label
   *  treatment above — stroke width and corner radius were previously bare
   *  <label> rows with no FieldLabel, reading as a different, cheaper control
   *  than the color swatches right above them. */
  const unitField = (label: string, ariaLabel: string, value: number, commit: (n: number) => void, unit: string) => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5">
        <ExprInput
          ariaLabel={ariaLabel}
          value={String(value)}
          onCommit={(v) => {
            const n = Number(v)
            if (Number.isFinite(n) && n >= 0) commit(n)
          }}
        />
        <span className="shrink-0 text-[0.625rem] text-muted-foreground/70">{unit}</span>
      </div>
    </div>
  )

  return (
    <OptionCard>
      <SectionTitle>Appearance</SectionTitle>

      <div className="space-y-3">
        {(hasFill || hasStroke) && (
          <div className="grid grid-cols-2 gap-3">
            {hasFill && colorField('Fill', fillColor, (hex) => setMeta({ fillColor: hex }), () => setMeta({ fillColor: undefined }))}
            {hasStroke && colorField('Stroke', strokeColor, (hex) => setMeta({ strokeColor: hex }), () => setMeta({ strokeColor: undefined }))}
          </div>
        )}

        {(hasStroke || hasCornerRadius) && (
          <div className="grid grid-cols-2 gap-3">
            {hasStroke && unitField('Stroke width', 'Stroke width', strokeWidth, (n) => setMeta({ strokeWidth: n }), 'px')}
            {hasCornerRadius && unitField('Corner radius', 'Corner radius', cornerRadius, (n) => setMeta({ cornerRadius: n }), 'px')}
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <FieldLabel>Opacity</FieldLabel>
            <span className="text-[0.6875rem] tabular-nums text-muted-foreground">{opacity}%</span>
          </div>
          <Slider
            aria-label="Opacity"
            value={[opacity]}
            min={0}
            max={100}
            step={1}
            onValueChange={([v]) => setMeta({ opacity: v })}
          />
        </div>
      </div>
    </OptionCard>
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
    <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
      {label}
      <ExprInput
        ariaLabel={label}
        value={String(Math.round(value * 100) / 100)}
        onInvalid={(v) => (Number.isFinite(Number(v)) ? undefined : 'Enter a number')}
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
    <label className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
      {label}
      <ExprInput
        ariaLabel={`${label} (cm)`}
        value={String(pxToCmRounded(px))}
        onInvalid={(v) => (Number.isFinite(Number(v)) ? undefined : 'Enter a number in cm')}
        onCommit={(v) => {
          const n = Number(v)
          if (Number.isFinite(n)) commitPx(cmToPx(n))
        }}
      />
      <span className="shrink-0 text-[0.625rem] opacity-60">cm</span>
    </label>
  )

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-stretch gap-1">
          <div className="flex-1">
            <ExprInput
              ariaLabel="Object name"
              mono={false}
              value={object.name}
              onInvalid={(name) => (name.trim() ? undefined : 'A name is required')}
              onCommit={(name) => name.trim() && updateObject(pageId, object.id, { name: name.trim() }, { history: true })}
            />
          </div>
          {/* Eye button: toggle label visibility above the object on the canvas */}
          <button
            type="button"
            title={object.metadata.labelVisible ? 'Hide label' : 'Show label'}
            aria-pressed={Boolean(object.metadata.labelVisible)}
            onClick={() =>
              updateObject(pageId, object.id, { metadata: { ...object.metadata, labelVisible: !object.metadata.labelVisible } }, { history: false })
            }
            className="flex items-center justify-center rounded-md border border-input bg-background/60 px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {object.metadata.labelVisible
              ? <Eye className="h-3.5 w-3.5" />
              : <EyeOff className="h-3.5 w-3.5" />
            }
          </button>
        </div>
        <p className="mt-1 text-[0.65625rem] uppercase tracking-[0.12em] text-muted-foreground">
          {object.geometry.kind}
          {object.geometry.symbol ? ` · ${object.geometry.symbol}` : ''}
        </p>
      </div>


      {/* Text gets its own Figma-style Position/Layout section instead (see
          TextObjectPanel below) — raw px, alignment-to-viewport, and a
          Resizing control this generic cm-based card doesn't have. */}
      {object.geometry.kind !== 'text' && (
        <OptionCard>
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
            <div className="col-span-2">
              {numField('Rot°', object.rotation, (n) =>
                updateObject(pageId, object.id, { rotation: n }, { history: true })
              )}
            </div>
          </div>
        </OptionCard>
      )}

      {object.geometry.kind !== 'text' && (
        <AppearanceSection pageId={pageId} object={object} />
      )}

      {object.geometry.kind === 'symbol' && MODEL_OPTIONS[object.geometry.symbol ?? ''] && (
        <div className="space-y-1.5">
          <SectionTitle>Model</SectionTitle>
          <select
            aria-label="Component model"
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none focus:border-[var(--ring)]"
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
          <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
            Pins move to match — rewire connections after changing the model.
          </p>
        </div>
      )}

      {object.metadata.render === 'system' && (
        <div className="space-y-1.5">
          <SectionTitle>System domain</SectionTitle>
          <select
            aria-label="System domain"
            className="w-full rounded-md border border-input bg-background/60 px-2 py-1 text-[0.75rem] outline-none focus:border-[var(--ring)]"
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
          <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
            Doodles inside become this domain&apos;s components — zigzag →
            resistor, box → battery/gate, blob → bulb/BJT, lines → wires.
            Scribble a small mark near any part to write its value or name.
          </p>
        </div>
      )}

      {object.geometry.kind === 'text' && <TextObjectPanel pageId={pageId} object={object} />}

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

      {object.geometry.kind === 'line' && object.metadata.render === 'connector' && (
        <ConnectorCapsSection pageId={pageId} object={object} />
      )}

      {contentParams.length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle>Parameters</SectionTitle>
          {contentParams.map(([name, p]) => (
            <div key={name}>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 truncate font-mono text-[0.71875rem] text-muted-foreground" title={name}>{name}</span>
                <ExprInput
                  ariaLabel={`Parameter ${name}`}
                  value={p.expr}
                  error={p.error}
                  onCommit={(v) => setParam(pageId, object.id, name, v)}
                />
                <span className="w-14 shrink-0 truncate text-right font-mono text-[0.625rem] text-[var(--accent-amber)]">
                  {Number.isFinite(p.value) ? +p.value.toFixed(3) : '—'}
                </span>
              </div>
              {p.error && <p className="ml-16 mt-0.5 text-[0.65625rem] text-[var(--accent-rose)]">{p.error}</p>}
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

/** One-click starters for an empty page. A button that writes a real variable
 *  teaches the concept faster than a paragraph describing one. */
const STARTER_VARS = [
  { name: 'k', expr: '2', why: 'A plain number you can reuse and tune in one place' },
  { name: 'speed', expr: '10', why: 'Name a value once, use it in every field' },
]

function VariablesPanel({ pageId }: { pageId: string }) {
  const variables = useDocStore((s) => s.pages[pageId]?.variables ?? EMPTY_VARIABLES)
  const addVariable = useDocStore((s) => s.addVariable)
  const updateVariable = useDocStore((s) => s.updateVariable)
  const removeVariable = useDocStore((s) => s.removeVariable)

  const unsetSystem = SYSTEM_VARS.filter((sv) => !variables.some((v) => v.name === sv.name))
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="space-y-1.5">
      {variables.length === 0 && (
        // Was three lines of prose teaching [Name(channel)] syntax. Nobody
        // reads an empty state, and nothing here could be clicked — so the
        // one sentence that matters stays and the examples became buttons
        // that write a real, working variable you can immediately edit.
        <div className="py-3 text-center">
          <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
            A value you name once and reuse in any field on this page.
          </p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
            {STARTER_VARS.map((s) => (
              <button
                key={s.name}
                type="button"
                title={s.why}
                className="rounded-md border border-border px-2 py-1 font-mono text-[0.6875rem] text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground active:scale-[0.97]"
                onClick={() => addVariable(pageId, s.name, s.expr)}
              >
                {s.name} = {s.expr}
              </button>
            ))}
          </div>
        </div>
      )}
      {variables.map((v) => (
        <div key={v.id} className="border-b border-border/50 pb-1.5 last:border-b-0">
          <div className="group flex items-center gap-1.5">
            <ExprInput
              ariaLabel="Variable name"
              value={v.name}
              // Rejected names used to vanish silently — the field just
              // snapped back with no clue why.
              onInvalid={(name) =>
                /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)
                  ? undefined
                  : 'Names start with a letter or _, then letters, digits or _'
              }
              onCommit={(name) =>
                /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && updateVariable(pageId, v.id, { name })
              }
            />
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
            {/* The old Link2 button + two-select row lived here. The
                expression field itself now offers the same picker (type `[`
                or hit its [ ] chip), so this was a second, worse door to one
                room — and the only one that appended a guessed ` * `. */}
            <button
              type="button"
              aria-label={`Delete variable ${v.name}`}
              className="rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:text-[var(--accent-rose)] hover:opacity-100"
              onClick={() => removeVariable(pageId, v.id)}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-muted-foreground">=</span>
            <ExprInput
              ariaLabel={`Expression for ${v.name}`}
              value={v.expr}
              error={v.error}
              onCommit={(expr) => updateVariable(pageId, v.id, { expr })}
            />
            <span className="w-14 shrink-0 truncate text-right font-mono text-[0.625rem] text-[var(--accent-amber)]">
              {v.error ? '—' : +v.value.toFixed(3)}
            </span>
          </div>
          {expandedId === v.id && (
            <textarea
              autoFocus
              defaultValue={v.expr}
              rows={3}
              spellCheck={false}
              aria-label={`Large formula editor for ${v.name}`}
              className="mt-1 w-full resize-y rounded-md border border-input bg-background/80 px-2 py-1.5 font-mono text-[0.75rem] leading-relaxed outline-none focus:border-[var(--ring)]"
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
          {v.error && <p className="mt-0.5 text-[0.65625rem] text-[var(--accent-rose)]">{v.error}</p>}
        </div>
      ))}
      <button
        type="button"
        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-1.5 text-[0.75rem] text-muted-foreground transition-colors hover:border-[var(--ring)] hover:text-foreground"
        onClick={() => addVariable(pageId)}
      >
        <Plus className="h-3.5 w-3.5" /> Add variable
      </button>

      {unsetSystem.length > 0 && (
        <div className="pt-2">
          <SectionTitle>System (engine defaults)</SectionTitle>
          {unsetSystem.map((sv) => (
            <div key={sv.name} className="flex items-center gap-1.5 py-0.5">
              <span className="w-20 shrink-0 font-mono text-[0.71875rem] text-muted-foreground">{sv.name}</span>
              <ExprInput
                ariaLabel={`System variable ${sv.name}`}
                value={sv.def}
                onCommit={(expr) => addVariable(pageId, sv.name, expr)}
              />
              <span className="w-28 shrink-0 truncate text-[0.625rem] text-muted-foreground" title={sv.label}>
                {sv.label}
              </span>
            </div>
          ))}
          <p className="mt-1 text-[0.65625rem] leading-relaxed text-muted-foreground">
            Edit a value to override it for this page — it becomes a normal
            variable above (delete it to restore the default).
          </p>
        </div>
      )}
    </div>
  )
}

// Neutral page-fill defaults — deliberately not TEXT_COLORS's accent hues: a
// page background wants paper/dark-canvas tones, matching what PowerPoint/
// Slides offer for "Set Background Color".
const PAGE_BG_COLORS: Record<string, string> = {
  white: '#ffffff',
  cream: '#faf7f0',
  gray: '#e5e5e5',
  charcoal: '#27272a',
  black: '#000000',
}

/** Doc/pptx only: the current sheet's own background color, editable right
 *  in the Properties panel's empty state (nothing selected) — a document's
 *  background is a property of the PAGE, not of any object on it, so it has
 *  no object to attach a control to otherwise. Boards have no such per-page
 *  fill (they're an infinite canvas, not a sheet), so this renders nothing
 *  for that page kind. */
function PageBackgroundPanel({ contentPageId }: { contentPageId: string }) {
  const documentId = useWorkspaceStore((s) => ownerPageOf(s.nodes, contentPageId))
  const meta = useWorkspaceStore((s) => findPageMeta(s.nodes, documentId))
  const swatches = usePageSwatches((s) => s.swatches[documentId] ?? EMPTY_SWATCHES)
  const imageSwatches = useImagePalette(contentPageId)

  if (meta?.pageKind !== 'doc' && meta?.pageKind !== 'pptx') return null

  const value = meta.sheetColors?.[contentPageId]
  const setValue = (color: string | undefined) => {
    const next = { ...meta.sheetColors }
    if (color) next[contentPageId] = color
    else delete next[contentPageId]
    useWorkspaceStore.getState().updatePageMeta(documentId, { sheetColors: next })
  }
  const addSwatch = (hex: string) => usePageSwatches.getState().add(documentId, hex)

  return (
    <PanelSection title="Background">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-label="Default background"
          aria-pressed={!value}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border-2 text-[0.625rem] text-muted-foreground',
            !value ? 'border-[var(--ring)]' : 'border-transparent'
          )}
          onClick={() => setValue(undefined)}
        >
          ×
        </button>
        {Object.entries(PAGE_BG_COLORS).map(([id, hex]) => (
          <button
            key={id}
            type="button"
            aria-label={`Background ${id}`}
            aria-pressed={value === hex}
            className={cn(
              'h-6 w-6 rounded-full border-2',
              value === hex ? 'scale-110 border-[var(--ring)]' : 'border-transparent'
            )}
            style={{ background: hex, boxShadow: id === 'white' ? 'inset 0 0 0 1px var(--border)' : undefined }}
            onClick={() => setValue(hex)}
          />
        ))}
        {swatches.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={`Background ${hex}`}
            aria-pressed={value === hex}
            className={cn(
              'h-6 w-6 rounded-full border-2',
              value === hex ? 'scale-110 border-[var(--ring)]' : 'border-transparent'
            )}
            style={{ background: hex }}
            onClick={() => setValue(hex)}
          />
        ))}
        <HexColorSwatchPicker
          label="Custom background color"
          size="md"
          imageSwatches={imageSwatches}
          onChange={setValue}
          onCommit={(hex) => {
            setValue(hex)
            addSwatch(hex)
          }}
        />
      </div>
      <p className="text-[0.65625rem] leading-relaxed text-muted-foreground">
        {meta.pageKind === 'pptx' ? "This slide's background." : "This page's background."}
      </p>
    </PanelSection>
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
    <ExprScopeProvider pageId={pageId}>
    <Tabs defaultValue="properties" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="m-2 grid grid-cols-2 bg-accent/50">
        <TabsTrigger value="properties" className="text-[0.75rem]">
          Properties
        </TabsTrigger>
        <TabsTrigger value="variables" className="text-[0.75rem]">
          Variables
        </TabsTrigger>
      </TabsList>
      <TabsContent value="properties" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {object ? (
          <ObjectProperties pageId={pageId} object={object} />
        ) : (
          <div className="space-y-3">
            <PageBackgroundPanel contentPageId={pageId} />
            <p className="py-6 text-center text-[0.75rem] leading-relaxed text-muted-foreground">
              {selection.length > 1
                ? `${selection.length} objects selected`
                : 'Select an object — or draw one and give it a behavior.'}
            </p>
          </div>
        )}
      </TabsContent>
      <TabsContent value="variables" className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <VariablesPanel pageId={pageId} />
      </TabsContent>
    </Tabs>
    </ExprScopeProvider>
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
