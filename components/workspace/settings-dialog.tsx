'use client'

// Settings: profile, appearance, notebook & simulation preferences,
// keyboard shortcuts and about. Institution-wide settings live in the
// admin console; these are the signed-in user's own preferences.

import { useTheme } from 'next-themes'
import { APP_THEMES } from '@/components/theme-provider'
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
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { COMPONENT_PACKAGES } from '@/lib/packages/registry'
import { Package } from 'lucide-react'
import { PenSettings } from './pen-settings'
import { Field, Choice, PrefRow } from './settings-fields'
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
  type AccentName,
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

function NotebookSettings() {
  const nb = usePrefs((s) => s.notebook)
  const setNb = usePrefs((s) => s.setNotebook)
  const inkToShape = useDocStore((s) => s.inkToShape)
  const inkAnnotate = useDocStore((s) => s.inkAnnotate)

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
        label="Grid size"
        value={`${nb.gridSize}px`}
        hint="Controls how large each grid cell is. Smaller values give a finer grid; larger values give a coarser one."
      >
        <Slider
          aria-label="Grid size"
          value={[nb.gridSize]}
          min={16}
          max={80}
          step={4}
          onValueChange={([v]) => setNb({ gridSize: v })}
        />
      </Field>

      <Field
        label="Interface UI"
        value={`${Math.round(nb.uiScale * 100)}%`}
        hint="Scales panels, docks and the inspector chrome — the canvas and its components keep their own sizes."
      >
        <Slider
          aria-label="Interface UI scale"
          value={[nb.uiScale]}
          min={0.8}
          max={1.4}
          step={0.05}
          onValueChange={([v]) => setNb({ uiScale: v })}
        />
      </Field>

      <Field
        label="Components UI"
        value={`${Math.round((nb.componentScale ?? 1) * 100)}%`}
        hint="Scales text and chrome inside canvas components — tables, formulas, graphs, notes, labs — and the calculator. Canvas zoom and Interface UI stay untouched."
      >
        <Slider
          aria-label="Component scale"
          value={[nb.componentScale ?? 1]}
          min={0.8}
          max={1.6}
          step={0.05}
          onValueChange={([v]) => setNb({ componentScale: v })}
        />
      </Field>

      <Field
        label="Panel text size"
        value={`${Math.round((nb.panelFontScale ?? 1) * 100)}%`}
        hint="Text size inside the docked panels only — Interface UI and canvas zoom stay untouched."
      >
        <Slider
          aria-label="Panel font scale"
          value={[nb.panelFontScale ?? 1]}
          min={0.85}
          max={1.3}
          step={0.05}
          onValueChange={([v]) => setNb({ panelFontScale: v })}
        />
      </Field>

      <Field
        label="Panel text spacing"
        value={`${Math.round((nb.panelSpacing ?? 1) * 100)}%`}
        hint="Letter spacing in the docked panels — denser or airier text."
      >
        <Slider
          aria-label="Panel letter spacing"
          value={[nb.panelSpacing ?? 1]}
          min={0.9}
          max={1.25}
          step={0.05}
          onValueChange={([v]) => setNb({ panelSpacing: v })}
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

      <PrefRow
        label="Disable double-tap zoom"
        detail="When on, double-tapping the canvas no longer zooms in or out — useful if you prefer pinch-to-zoom only."
        checked={nb.disableDoubleTapZoom}
        onChange={() => setNb({ disableDoubleTapZoom: !nb.disableDoubleTapZoom })}
      />

      <div className="pt-1">
        <p className="pb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Editing behavior
        </p>
        <div className="divide-y divide-border/60">
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
        </div>
      </div>

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

// Each theme's paper color, matching the .<id> palettes in globals.css.
// System previews as a light/dark split.
const THEME_SWATCH: Record<(typeof APP_THEMES)[number]['id'], string> = {
  light: 'oklch(0.982 0.003 95)',
  sepia: 'oklch(0.955 0.02 88)',
  lily: 'linear-gradient(135deg, oklch(0.9 0.05 15) 0%, oklch(0.88 0.06 45) 100%)',
  dark: 'oklch(0.17 0.01 270)',
  dim: 'oklch(0.245 0.016 265)',
  midnight: 'oklch(0.13 0.008 270)',
  contrast: 'oklch(0.05 0 0)',
  system: 'linear-gradient(135deg, oklch(0.982 0.003 95) 50%, oklch(0.17 0.01 270) 50%)',
}

function MotionSetting() {
  const motion = usePrefs((s) => s.appearance.motion)
  const focusOnEdit = usePrefs((s) => s.appearance.focusOnEdit)
  const accent = usePrefs((s) => s.appearance.accent) ?? 'blue'
  const setAppearance = usePrefs((s) => s.setAppearance)
  const ACCENTS: { id: AccentName; label: string }[] = [
    { id: 'blue', label: 'Blue' },
    { id: 'violet', label: 'Violet' },
    { id: 'mint', label: 'Mint' },
    { id: 'amber', label: 'Amber' },
    { id: 'rose', label: 'Rose' },
  ]
  return (
    <>
    <Field label="Tint" hint="The interface accent — selection, buttons, active states.">
      <div className="flex items-center gap-2">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-label={`${a.label} tint`}
            aria-pressed={accent === a.id}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-95"
            style={{
              // "Blue" reads the untouched base var — --accent-blue itself is
              // overridden globally to the active tint, so the swatch would
              // otherwise silently turn into a copy of whatever's selected.
              background: `var(--accent-${a.id === 'blue' ? 'blue-base' : a.id})`,
              boxShadow: accent === a.id ? '0 0 0 2px var(--background), 0 0 0 4px currentColor' : undefined,
              color: `var(--accent-${a.id === 'blue' ? 'blue-base' : a.id})`,
            }}
            onClick={() => setAppearance({ accent: a.id })}
          />
        ))}
      </div>
    </Field>
    <PrefRow
      label="Focus the object while editing"
      detail="On phones and tablets, lift the selected object out of the canvas and dim the board while its properties are open. Off keeps the board as it is."
      checked={focusOnEdit}
      onChange={() => setAppearance({ focusOnEdit: !focusOnEdit })}
    />
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
    </>
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
          aria-label="Decimal precision"
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
          aria-label="Zero threshold"
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

function PackagesSettings() {
  const packages = usePrefs((s) => s.packages) ?? {}
  const setPackage = usePrefs((s) => s.setPackage)

  return (
    <div className="space-y-3 pt-1">
      <div className="rounded-xl border border-border bg-card/60 p-3">
        <div className="flex items-center gap-2 font-semibold text-[13px] text-foreground">
          <Package className="h-4 w-4 text-[var(--accent-blue)]" />
          Subject Component Packages
        </div>
        <p className="mt-1 text-[11.5px] leading-normal text-muted-foreground">
          Toggle subject packages to enable or disable their components in the sidebar component panel, palette, dock, and search. Unlocked on this device.
        </p>
      </div>

      <div className="divide-y divide-border/60">
        {COMPONENT_PACKAGES.map((pkg) => {
          const enabled = packages[pkg.domain] ?? true
          return (
            <div key={pkg.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">{pkg.name}</span>
                  <span className="rounded-full bg-accent/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {pkg.price}
                  </span>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-normal text-muted-foreground">{pkg.description}</p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={(val) => setPackage(pkg.domain, val)}
                aria-label={`Toggle ${pkg.name}`}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { theme, setTheme } = useTheme()
  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Your preferences on this device.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="profile" className="flex min-h-0 flex-1 flex-col">
          {/* Six tabs no longer fit a fixed strip — let it scroll rather
              than squeeze the labels out of the dialog. */}
          <TabsList className="no-scrollbar w-full justify-start overflow-x-auto">
            <TabsTrigger value="profile" className="shrink-0">Profile</TabsTrigger>
            <TabsTrigger value="packages" className="shrink-0">Packages</TabsTrigger>
            <TabsTrigger value="appearance" className="shrink-0">Appearance</TabsTrigger>
            <TabsTrigger value="pen" className="shrink-0">Pen</TabsTrigger>
            <TabsTrigger value="notebook" className="shrink-0">Notebook</TabsTrigger>
            <TabsTrigger value="math" className="shrink-0">Math</TabsTrigger>
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
                <div className="flex flex-wrap gap-2">
                  {profile.role === 'super_admin' && (
                    <Button variant="outline" size="sm" onClick={() => { window.location.href = '/dev' }}>
                      ← Return to dev console
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => useAuthStore.getState().logout()}>
                    Sign out on this device
                  </Button>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="packages" className="pt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            <PackagesSettings />
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
            <div className="mt-3 flex flex-wrap gap-2">
              {APP_THEMES.map((t) => (
                <Button
                  key={t.id}
                  variant={theme === t.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setTheme(t.id)}
                >
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-full border border-border"
                    // Fixed preview colors — the theme's own paper, not live
                    // vars, which would all render in the active theme.
                    style={{ background: THEME_SWATCH[t.id] }}
                  />
                  {t.label}
                </Button>
              ))}
            </div>
            <p className="pt-3 text-[11.5px] text-muted-foreground">
              Sepia is warm paper for reading; Lily is soft pink and orange; Dim is a softer dark
              for lit rooms; Midnight is near-black for OLED screens; Contrast is high-visibility
              for accessibility. Theme and tint apply everywhere — the notebook, room boards and
              the presenter.
            </p>
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
