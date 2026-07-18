'use client'

// Pen settings — the sliders that decide how ink FEELS. Shared by the Settings
// dialog and the popover that opens when you double-click the pen in the dock,
// so there is one pen panel, not two that drift apart.

import { Slider } from '@/components/ui/slider'
import { inkPath } from '@/components/objects/ink'
import {
  usePrefs,
  PEN_COLORS,
  PEN_STYLES,
  DEFAULT_PEN,
  type PenStyle,
} from '@/lib/store/preferences'
import { cn } from '@/lib/utils'
import { Field, Choice } from './settings-fields'

/** Live preview: the same renderer the canvas uses, over a fixed sample
 *  stroke — so the sliders show their real effect, not an approximation. */
const SAMPLE: number[][] = Array.from({ length: 60 }, (_, i) => {
  const t = i / 59
  return [16 + t * 268, 34 + Math.sin(t * Math.PI * 2.2) * 16 + Math.sin(t * 31) * 1.4, 0.35 + t * 0.5]
})

export function PenSettings() {
  const pen = usePrefs((s) => s.pen)
  const setPen = usePrefs((s) => s.setPen)

  return (
    <div className="space-y-1">
      <div className="rounded-xl border border-border bg-card/60 p-2">
        <svg width="100%" height="72" viewBox="0 0 300 72" aria-label="Pen preview">
          <path
            d={inkPath(SAMPLE, { size: pen.size })}
            fill={pen.color}
            fillOpacity={PEN_STYLES[pen.style].opacity}
          />
        </svg>
      </div>

      <Field
        label="Thickness"
        value={`${pen.size}px`}
        hint="Base stroke width — the same value the dock's hover flyout adjusts."
      >
        <Slider
          value={[pen.size]}
          min={0.5}
          max={16}
          step={0.25}
          onValueChange={([v]) => setPen({ size: v })}
        />
      </Field>

      <Field
        label="Smoothing"
        value={pen.smoothing.toFixed(2)}
        hint="Rounds the finished outline. Low keeps every wobble; high makes clean curves."
      >
        <Slider
          value={[pen.smoothing]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => setPen({ smoothing: v })}
        />
      </Field>

      <Field
        label="Stabilisation"
        value={pen.streamline.toFixed(2)}
        hint="How much the ink lags your hand to steady it. THIS is the one that feels sticky — turn it down for responsive writing, up for confident straight strokes."
      >
        <Slider
          value={[pen.streamline]}
          min={0}
          max={0.9}
          step={0.02}
          onValueChange={([v]) => setPen({ streamline: v })}
        />
      </Field>

      <Field
        label="Pressure sensitivity"
        value={pen.sensitivity.toFixed(2)}
        hint="How much the stroke thins and thickens with pressure (or speed, on a mouse)."
      >
        <Slider
          value={[pen.sensitivity]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => setPen({ sensitivity: v })}
        />
      </Field>

      <Field label="Dot size" value={`${pen.dotSize}x`} hint="Multiplier for single-tap dots (like the dot on an 'i').">
        <Slider
          value={[pen.dotSize]}
          min={0.5}
          max={5}
          step={0.1}
          onValueChange={([v]) => setPen({ dotSize: v })}
        />
      </Field>

      <Field label="Colour">
        <div className="flex gap-1.5">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Pen colour ${c}`}
              aria-pressed={pen.color === c}
              className={cn(
                'h-7 w-7 rounded-full border-2 transition-transform',
                pen.color === c ? 'scale-110 border-[var(--ring)]' : 'border-transparent'
              )}
              style={{ background: c }}
              onClick={() => setPen({ color: c })}
            />
          ))}
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
          value={[pen.scribbleSensitivity]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => setPen({ scribbleSensitivity: v })}
        />
      </Field>

      <Field label="Style">
        <Choice<PenStyle>
          value={pen.style}
          onChange={(style) => setPen({ style })}
          options={(Object.keys(PEN_STYLES) as PenStyle[]).map((id) => ({
            id,
            label: PEN_STYLES[id].label,
          }))}
        />
      </Field>

      <button
        type="button"
        className="mt-2 w-full rounded-lg border border-dashed border-border py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        onClick={() => setPen({ ...DEFAULT_PEN })}
      >
        Reset pen to defaults
      </button>
    </div>
  )
}

