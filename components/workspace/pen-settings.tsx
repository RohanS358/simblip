'use client'

// Pen settings — THE control surface for how ink feels. Opens when you
// double-click the pen in the dock (the Settings dialog embeds the same
// panel, so there is one pen panel, not two that drift apart). Every pen
// behaviour lives here and only here: stability, smoothness, sensitivity,
// thickness, colour (basic + custom), style and scribble-to-erase.

import { X } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { inkPath } from '@/components/objects/ink'
import {
  usePrefs,
  PEN_COLORS,
  PEN_STYLES,
  DEFAULT_PEN,
  type PenStyle,
} from '@/lib/store/preferences'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useIsTouchDevice } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { Field, Choice, PrefRow } from './settings-fields'
import { HexColorSwatchPicker } from './hex-color-swatch-picker'

/** Live preview: the same renderer the canvas uses, over a fixed sample
 *  stroke with rising pressure — so every slider shows its real effect. */
const SAMPLE: number[][] = Array.from({ length: 60 }, (_, i) => {
  const t = i / 59
  return [16 + t * 268, 34 + Math.sin(t * Math.PI * 2.2) * 16 + Math.sin(t * 31) * 1.4, 0.35 + t * 0.5]
})

function Swatch({
  color,
  active,
  onSelect,
  onRemove,
}: {
  color: string
  active: boolean
  onSelect: () => void
  onRemove?: () => void
}) {
  return (
    <span className="relative">
      <button
        type="button"
        aria-label={`Pen colour ${color}`}
        aria-pressed={active}
        className={cn(
          'h-7 w-7 rounded-full border-2 transition-transform',
          active ? 'scale-110 border-[var(--ring)]' : 'border-transparent'
        )}
        style={{ background: color }}
        onClick={onSelect}
      />
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove colour ${color}`}
          className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  )
}

export function PenSettings() {
  const pen = usePrefs((s) => s.pen)
  const setPen = usePrefs((s) => s.setPen)
  const style = PEN_STYLES[pen.style] ?? PEN_STYLES.ink
  const pressureStyle = style.pressure
  const isTouchDevice = useIsTouchDevice()
  const touchOrthoPen = useWorkspaceStore((s) => s.touchOrthoPen)
  const touchFreeMove = useWorkspaceStore((s) => s.touchFreeMove)
  const touchMeasureMode = useWorkspaceStore((s) => s.touchMeasureMode)
  const toggleTouchOrthoPen = useWorkspaceStore((s) => s.toggleTouchOrthoPen)
  const toggleTouchFreeMove = useWorkspaceStore((s) => s.toggleTouchFreeMove)
  const toggleTouchMeasureMode = useWorkspaceStore((s) => s.toggleTouchMeasureMode)

  return (
    <div className="space-y-1">
      <div className="rounded-xl border border-border bg-card/60 p-2">
        <svg width="100%" height="72" viewBox="0 0 300 72" aria-label="Pen preview">
          <path
            d={inkPath(SAMPLE, {
              size: pen.size,
              thinning: pressureStyle ? pen.sensitivity : 0,
              smoothing: pen.smoothing,
              streamline: pen.streamline,
            })}
            fill={pen.color}
            fillOpacity={style.opacity}
          />
        </svg>
      </div>

      <Field
        label="Style"
        hint="Ink follows stylus pressure. Pen writes at one flat thickness. Highlighter is flat and translucent."
      >
        <Choice<PenStyle>
          value={PEN_STYLES[pen.style] ? pen.style : 'ink'}
          onChange={(style) => setPen({ style })}
          options={(Object.keys(PEN_STYLES) as PenStyle[]).map((id) => ({
            id,
            label: PEN_STYLES[id].label,
          }))}
        />
      </Field>

      <Field label="Thickness" value={`${pen.size}px`} hint="Base stroke width — what a mouse or flat style always draws at.">
        <Slider
          aria-label="Thickness"
          value={[pen.size]}
          min={0.5}
          max={16}
          step={0.25}
          onValueChange={([v]) => setPen({ size: v })}
        />
      </Field>

      <Field
        label="Stability"
        value={pen.streamline.toFixed(2)}
        hint="Steadies shaky lines. The tip stays glued to your pen, so even high values don't feel laggy — the line behind just settles straighter."
      >
        <Slider
          aria-label="Stability"
          value={[pen.streamline]}
          min={0}
          max={0.9}
          step={0.02}
          onValueChange={([v]) => setPen({ streamline: v })}
        />
      </Field>

      <Field
        label="Smoothness"
        value={pen.smoothing.toFixed(2)}
        hint="Rounds the finished outline. Low keeps every wobble; high makes clean flowing curves."
      >
        <Slider
          aria-label="Smoothness"
          value={[pen.smoothing]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => setPen({ smoothing: v })}
        />
      </Field>

      {pressureStyle && (
        <Field
          label="Sensitivity"
          value={pen.sensitivity.toFixed(2)}
          hint="How much stylus pressure thins and thickens the stroke. Mouse and touch always write at the base thickness."
        >
          <Slider
            aria-label="Sensitivity"
            value={[pen.sensitivity]}
            min={0}
            max={1}
            step={0.05}
            onValueChange={([v]) => setPen({ sensitivity: v })}
          />
        </Field>
      )}

      <Field label="Dot size" value={`${pen.dotSize}x`} hint="Multiplier for single-tap dots (like the dot on an 'i').">
        <Slider
          aria-label="Dot size"
          value={[pen.dotSize]}
          min={0.5}
          max={5}
          step={0.1}
          onValueChange={([v]) => setPen({ dotSize: v })}
        />
      </Field>

      <Field label="Colour" hint="Tap + to add your own colours; they stay in this palette.">
        <div className="flex flex-wrap items-center gap-1.5">
          {PEN_COLORS.map((c) => (
            <Swatch key={c} color={c} active={pen.color === c} onSelect={() => setPen({ color: c })} />
          ))}
          {pen.customColors.map((c) => (
            <Swatch
              key={c}
              color={c}
              active={pen.color === c}
              onSelect={() => setPen({ color: c })}
              onRemove={() =>
                setPen({
                  customColors: pen.customColors.filter((x) => x !== c),
                  ...(pen.color === c ? { color: DEFAULT_PEN.color } : {}),
                })
              }
            />
          ))}
          <HexColorSwatchPicker
            label="Add custom colour"
            size="md"
            initial={pen.color}
            onChange={(c) => setPen({ color: c })}
            onCommit={(c) =>
              setPen({
                color: c,
                customColors: pen.customColors.includes(c)
                  ? pen.customColors
                  : [...pen.customColors, c].slice(-12),
              })
            }
          />
        </div>
      </Field>

      <Field
        label="Scribble to erase"
        value={
          pen.scribbleSensitivity === 0
            ? 'off-ish'
            : `${Math.round(pen.scribbleSensitivity * 100)}%`
        }
        hint="Scratching over your work deletes what's under it. Low means you must scribble hard and long before anything goes — safer while you're writing. High means a quick zigzag is enough."
      >
        <Slider
          aria-label="Scribble to erase"
          value={[pen.scribbleSensitivity]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => setPen({ scribbleSensitivity: v })}
        />
      </Field>

      {isTouchDevice && (
        <div className="pt-1">
          <p className="pb-1 text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Touch assist
          </p>
          <div className="divide-y divide-border/60">
            <PrefRow
              label="Orthogonal pen"
              detail="The tablet substitute for Shift+pen — straight lines snap to horizontal/vertical while drawing."
              checked={touchOrthoPen}
              onChange={toggleTouchOrthoPen}
            />
            <PrefRow
              label="Free move"
              detail="Move objects without snap, like holding Alt on a mouse."
              checked={touchFreeMove}
              onChange={toggleTouchFreeMove}
            />
            <PrefRow
              label="Measure mode"
              detail="Tap a second object to compare distance."
              checked={touchMeasureMode}
              onChange={toggleTouchMeasureMode}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        className="mt-2 w-full rounded-lg border border-dashed border-border py-1.5 text-[0.75rem] text-muted-foreground hover:text-foreground"
        onClick={() => setPen({ ...DEFAULT_PEN, customColors: pen.customColors })}
      >
        Reset pen to defaults
      </button>
    </div>
  )
}
