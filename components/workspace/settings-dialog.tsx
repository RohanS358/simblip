'use client'

// Settings: profile, appearance, notebook & simulation preferences,
// keyboard shortcuts and about. Institution-wide settings live in the
// admin console; these are the signed-in user's own preferences.

import { useTheme } from 'next-themes'
import { useAuthStore } from '@/lib/auth/store'
import { ROLE_LABEL } from '@/lib/auth/types'
import { useDocStore } from '@/lib/store/document'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import { inkPath } from '@/components/objects/ink'
import {
  usePrefs,
  PEN_COLORS,
  PEN_STYLES,
  DEFAULT_PEN,
  DEFAULT_NOTEBOOK,
  DEFAULT_MATH,
  type PenStyle,
  type GridType,
  type ScrollAxis,
  type DockSide,
  type AngleUnit,
  type NumberStyle,
  type MotionStyle,
} from '@/lib/store/preferences'
import { fmtNum } from '@/lib/scene/format'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'

const SHORTCUTS: Array<[string, string]> = [
  ['Ctrl/⌘ K', 'Command palette & global search'],
  ['V', 'Select tool'],
  ['P', 'Pen (sketch recognition)'],
  ['Space + drag', 'Pan the canvas'],
  ['Ctrl/⌘ Z', 'Undo'],
  ['Ctrl/⌘ ⇧ Z', 'Redo'],
  ['Delete', 'Remove selection'],
]

function PrefRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string
  detail: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        <p className="text-[11.5px] text-muted-foreground">{detail}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

function Field({
  label,
  hint,
  value,
  children,
}: {
  label: string
  hint?: string
  value?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium">{label}</p>
        {value && <span className="font-mono text-[11px] text-muted-foreground">{value}</span>}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Segmented option row — the visual equivalent of a radio group. */
function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-accent/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          className={cn(
            'flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
            value === o.id
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Live preview: the same renderer the canvas uses, over a fixed sample
 *  stroke — so the sliders show their real effect, not an approximation. */
const SAMPLE: number[][] = Array.from({ length: 60 }, (_, i) => {
  const t = i / 59
  return [16 + t * 268, 34 + Math.sin(t * Math.PI * 2.2) * 16 + Math.sin(t * 31) * 1.4, 0.35 + t * 0.5]
})

function PenSettings() {
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

      <Field label="Thickness" value={`${pen.size}px`}>
        <Slider
          value={[pen.size]}
          min={1}
          max={16}
          step={0.5}
          onValueChange={([v]) => setPen({ size: v })}
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

function NotebookSettings() {
  const nb = usePrefs((s) => s.notebook)
  const setNb = usePrefs((s) => s.setNotebook)

  return (
    <div className="space-y-1">
      <Field label="Scrolling" hint="Lock the canvas to one direction, or pan freely in both.">
        <Choice<ScrollAxis>
          value={nb.scrollAxis}
          onChange={(scrollAxis) => setNb({ scrollAxis })}
          options={[
            { id: 'free', label: 'Free' },
            { id: 'vertical', label: 'Vertical' },
            { id: 'horizontal', label: 'Horizontal' },
          ]}
        />
      </Field>

      <Field label="Grid">
        <Choice<GridType>
          value={nb.grid}
          onChange={(grid) => setNb({ grid })}
          options={[
            { id: 'dots', label: 'Dots' },
            { id: 'lines', label: 'Ruled' },
            { id: 'graph', label: 'Graph' },
            { id: 'none', label: 'None' },
          ]}
        />
      </Field>

      <Field
        label="UI scale"
        value={`${Math.round(nb.uiScale * 100)}%`}
        hint="Scales panels, docks and the inspector — the canvas keeps its own zoom."
      >
        <Slider
          value={[nb.uiScale]}
          min={0.8}
          max={1.4}
          step={0.05}
          onValueChange={([v]) => setNb({ uiScale: v })}
        />
      </Field>

      <Field label="Dock position" hint="Where the tool dock sits on the canvas.">
        <Choice<DockSide>
          value={nb.dock}
          onChange={(dock) => setNb({ dock })}
          options={[
            { id: 'bottom', label: 'Bottom' },
            { id: 'top', label: 'Top' },
            { id: 'left', label: 'Left' },
            { id: 'right', label: 'Right' },
          ]}
        />
      </Field>

      <button
        type="button"
        className="mt-2 w-full rounded-lg border border-dashed border-border py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        onClick={() => setNb({ ...DEFAULT_NOTEBOOK })}
      >
        Reset notebook to defaults
      </button>
    </div>
  )
}

function MotionSetting() {
  const motion = usePrefs((s) => s.appearance.motion)
  const setAppearance = usePrefs((s) => s.setAppearance)
  return (
    <Field
      label="Motion"
      hint="Bouncy springs overshoot slightly and settle — that's what makes an interface feel physical rather than mechanical. Smooth removes the overshoot; Off disables animation entirely (also the right choice if motion makes you queasy)."
    >
      <Choice<MotionStyle>
        value={motion}
        onChange={(m) => setAppearance({ motion: m })}
        options={[
          { id: 'bouncy', label: 'Bouncy' },
          { id: 'smooth', label: 'Smooth' },
          { id: 'none', label: 'Off' },
        ]}
      />
    </Field>
  )
}

function MathSettings() {
  const math = usePrefs((s) => s.math)
  const setMath = usePrefs((s) => s.setMath)

  // Live sample: real values a simulation actually produces — a clean number,
  // a long decimal, something huge, something tiny, and floating-point dust.
  const samples = [1234.56789, 0.000123456, 9.80665, 6.02e14, 1.7e-17]

  return (
    <div className="space-y-1">
      <div className="rounded-xl border border-border bg-card/60 p-2.5">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Preview
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
          {samples.map((v) => (
            <span key={v}>{fmtNum(v)}</span>
          ))}
        </div>
      </div>

      <Field
        label="Decimal precision"
        value={`${math.precision} dp`}
        hint="Digits after the point in every readout — graphs, measurements, variables."
      >
        <Slider
          value={[math.precision]}
          min={0}
          max={8}
          step={1}
          onValueChange={([v]) => setMath({ precision: v })}
        />
      </Field>

      <Field
        label="Notation"
        hint="Auto switches to exponents only for very large or very small values. Engineering locks the exponent to multiples of 3 (kilo, milli, micro…)."
      >
        <Choice<NumberStyle>
          value={math.numberStyle}
          onChange={(numberStyle) => setMath({ numberStyle })}
          options={[
            { id: 'auto', label: 'Auto' },
            { id: 'fixed', label: 'Plain' },
            { id: 'sci', label: 'Scientific' },
            { id: 'eng', label: 'Engineering' },
          ]}
        />
      </Field>

      <Field label="Angles" hint="How angles are displayed. The solver always works in radians.">
        <Choice<AngleUnit>
          value={math.angleUnit}
          onChange={(angleUnit) => setMath({ angleUnit })}
          options={[
            { id: 'deg', label: 'Degrees' },
            { id: 'rad', label: 'Radians' },
          ]}
        />
      </Field>

      <PrefRow
        label="Show units"
        detail="Append cm, cm/s, N·m… to values instead of showing bare numbers."
        checked={math.showUnits}
        onChange={() => setMath({ showUnits: !math.showUnits })}
      />

      <PrefRow
        label="Thousands separators"
        detail="1,234.5 instead of 1234.5. Useful for money, noisy for physics."
        checked={math.groupDigits}
        onChange={() => setMath({ groupDigits: !math.groupDigits })}
      />

      <Field
        label="Treat as zero below"
        value={math.zeroThreshold.toExponential(0)}
        hint="Floating-point error leaves values like 1e-17 lying around. Anything smaller than this reads as exactly 0, so noise doesn't look like signal."
      >
        <Slider
          value={[Math.log10(math.zeroThreshold)]}
          min={-15}
          max={-3}
          step={1}
          onValueChange={([v]) => setMath({ zeroThreshold: 10 ** v })}
        />
      </Field>

      <button
        type="button"
        className="mt-2 w-full rounded-lg border border-dashed border-border py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        onClick={() => setMath({ ...DEFAULT_MATH })}
      >
        Reset math to defaults
      </button>
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { theme, setTheme } = useTheme()
  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const inkToShape = useDocStore((s) => s.inkToShape)
  const inkAnnotate = useDocStore((s) => s.inkAnnotate)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Your preferences on this device.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="profile" className="flex min-h-0 flex-1 flex-col">
          {/* Seven tabs no longer fit a fixed strip — let it scroll rather
              than squeeze the labels out of the dialog. */}
          <TabsList className="no-scrollbar w-full justify-start overflow-x-auto">
            <TabsTrigger value="profile" className="shrink-0">Profile</TabsTrigger>
            <TabsTrigger value="appearance" className="shrink-0">Appearance</TabsTrigger>
            <TabsTrigger value="pen" className="shrink-0">Pen</TabsTrigger>
            <TabsTrigger value="notebook" className="shrink-0">Notebook</TabsTrigger>
            <TabsTrigger value="math" className="shrink-0">Math</TabsTrigger>
            <TabsTrigger value="workspace" className="shrink-0">Workspace</TabsTrigger>
            <TabsTrigger value="shortcuts" className="shrink-0">Shortcuts</TabsTrigger>
            <TabsTrigger value="about" className="shrink-0">About</TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-2 pt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {profile && (
              <>
                <div className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{profile.full_name}</span>
                  <span className="text-muted-foreground">Email</span>
                  <span>{profile.email}</span>
                  <span className="text-muted-foreground">Role</span>
                  <span>{ROLE_LABEL[profile.role]}</span>
                  <span className="text-muted-foreground">Institution</span>
                  <span>{institution?.name ?? '—'}</span>
                  {profile.department && (
                    <>
                      <span className="text-muted-foreground">Department</span>
                      <span>{profile.department}</span>
                    </>
                  )}
                </div>
                <p className="pt-1 text-[11.5px] text-muted-foreground">
                  Profile details are managed by your institution admin.
                </p>
                <Button variant="outline" size="sm" onClick={() => useAuthStore.getState().logout()}>
                  Sign out on this device
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="pen" className="pt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <PenSettings />
          </TabsContent>

          <TabsContent value="notebook" className="pt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <NotebookSettings />
          </TabsContent>

          <TabsContent value="math" className="min-h-0 flex-1 overflow-y-auto pr-1 pt-3">
            <MathSettings />
          </TabsContent>

          <TabsContent value="appearance" className="pt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <MotionSetting />
            <div className="mt-3 flex gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <Button
                  key={t}
                  variant={theme === t ? 'default' : 'outline'}
                  size="sm"
                  className="capitalize"
                  onClick={() => setTheme(t)}
                >
                  {t}
                </Button>
              ))}
            </div>
            <p className="pt-3 text-[11.5px] text-muted-foreground">
              The interface follows your institution's accent color automatically.
            </p>
          </TabsContent>

          <TabsContent value="workspace" className="divide-y divide-border/60 pt-1 min-h-0 flex-1 overflow-y-auto pr-1">
            <PrefRow
              label="Ink to shape"
              detail="Recognize pen strokes into circles, rectangles and components."
              checked={inkToShape}
              onChange={() => useDocStore.getState().toggleInkToShape()}
            />
            <PrefRow
              label="Ink annotations"
              detail="Small scribbles near components open the value/name input."
              checked={inkAnnotate}
              onChange={() => useDocStore.getState().toggleInkAnnotate()}
            />
          </TabsContent>

          <TabsContent value="shortcuts" className="pt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between text-[12.5px]">
                  <span className="text-muted-foreground">{what}</span>
                  <Kbd>{keys}</Kbd>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="about" className="pt-3 text-[12.5px] leading-relaxed text-muted-foreground min-h-0 flex-1 overflow-y-auto pr-1">
            <p>
              <span className="font-semibold text-foreground">SIMBLIP</span> — the engineering notebook
              that simulates. Enterprise education platform for engineering institutions.
            </p>
            <p className="pt-2">
              Built by <span className="font-semibold text-foreground">Rohan Singh</span>.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
