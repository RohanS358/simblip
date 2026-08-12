'use client'

// Settings: profile, appearance, dock, notebook & simulation preferences,
// keyboard shortcuts and about. Styled after Obsidian's clean settings window.

import { useState, useMemo, useEffect } from 'react'
import { useIsMobile } from '@/hooks/use-mobile'
import { useTheme } from 'next-themes'
import { APP_THEMES } from '@/components/theme-provider'
import { useAuthStore } from '@/lib/auth/store'
import { ROLE_LABEL } from '@/lib/auth/types'
import { useDocStore } from '@/lib/store/document'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Stable empty reference — returning a fresh `{}` from a Zustand selector on
// every render trips useSyncExternalStore's identity check and crashes the
// component tree with React #185 ("Maximum update depth exceeded").
const EMPTY_PACKAGES: Record<string, boolean> = Object.freeze({})
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHiddenPrimitive from '@radix-ui/react-visually-hidden'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { COMPONENT_PACKAGES } from '@/lib/packages/registry'
import {
  Package,
  Search,
  X,
  Sliders,
  Layout,
  User,
  Palette,
  Edit3,
  Files,
  Keyboard,
  Hand,
  Calculator,
  HelpCircle,
  Activity,
  Check,
  Pencil,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  Plus,
} from 'lucide-react'
import { PenSettings } from './pen-settings'
import { HexColorSwatchPicker } from './hex-color-swatch-picker'
import { BackupSettings } from './backup-settings'
import { StoragePanel } from './storage-panel'
import { Field, Choice, PrefRow, SettingCard, ObsidianPrefRow } from './settings-fields'
import {
  usePrefs,
  DEFAULT_NOTEBOOK,
  DEFAULT_MATH,
  DEFAULT_GESTURES,
  type GridType,
  type ScrollAxis,
  type DockSide,
  type AngleUnit,
  type NumberStyle,
  type MotionStyle,
  type AccentName,
  type DockPositionMode,
  type DockLayoutMode,
  type DockContainerStyle,
  type DockShape,
  type DockColorTheme,
  type DockSize,
} from '@/lib/store/preferences'
import { fmtNum } from '@/lib/scene/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ACTIONS, SHORTCUT_GROUPS, resolveCombo, comboLabel, comboFromEvent, findCollision } from '@/lib/keymap'

function DockSettings() {
  const dock = usePrefs((s) => s.dock)
  const setDock = usePrefs((s) => s.setDock)

  return (
    <div className="space-y-4">
      <SettingCard title="Positioning & Docking">
        <ObsidianPrefRow
          label="Position Mode"
          detail="Choose whether the dock is anchored to a screen edge or draggable anywhere on the canvas."
        >
          <Choice<DockPositionMode>
            value={dock.positionMode}
            onChange={(positionMode) => setDock({ positionMode })}
            options={[
              { id: 'fixed', label: 'Fixed Position' },
              { id: 'draggable', label: 'Draggable' },
            ]}
          />
        </ObsidianPrefRow>

        {dock.positionMode === 'fixed' && (
          <ObsidianPrefRow
            label="Fixed Dock Edge"
            detail="Where the tool dock is anchored on the canvas."
          >
            <Choice<DockSide>
              value={dock.fixedSide}
              onChange={(fixedSide) => setDock({ fixedSide })}
              options={[
                { id: 'bottom', label: 'Bottom' },
                { id: 'top', label: 'Top' },
                { id: 'left', label: 'Left' },
                { id: 'right', label: 'Right' },
              ]}
            />
          </ObsidianPrefRow>
        )}

        {dock.positionMode === 'draggable' && (
          <ObsidianPrefRow
            label="Drag Position Reset"
            detail="Reset saved coordinates back to default position."
          >
            <Button
              variant="outline"
              size="sm"
              className="text-xs rounded-lg"
              onClick={() => setDock({ dragPosition: null })}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset Position
            </Button>
          </ObsidianPrefRow>
        )}
      </SettingCard>

      <SettingCard title="Layout & Extensions">
        <ObsidianPrefRow
          label="Dock Layout Mode"
          detail="Compact provides a minimal drawing toolstrip. Extended embeds simulation controls and page selector directly into the dock."
        >
          <Choice<DockLayoutMode>
            value={dock.layoutMode}
            onChange={(layoutMode) => setDock({ layoutMode })}
            options={[
              { id: 'compact', label: 'Compact' },
              { id: 'extended', label: 'Extended' },
            ]}
          />
        </ObsidianPrefRow>

        {dock.layoutMode === 'extended' && (
          <>
            <ObsidianPrefRow
              label="Embed Simulation Controls"
              detail="Include Play, Pause, Step frame & time counter inside the dock."
            >
              <Switch
                checked={dock.showTransport}
                onCheckedChange={(val) => setDock({ showTransport: val })}
                className="data-[state=checked]:bg-[#7f6df2]"
              />
            </ObsidianPrefRow>

            <ObsidianPrefRow
              label="Embed Tools & Components Launcher"
              detail="Include quick Tools / Palette launcher shortcut directly inside the dock."
            >
              <Switch
                checked={dock.showToolsMenu ?? true}
                onCheckedChange={(val) => setDock({ showToolsMenu: val })}
                className="data-[state=checked]:bg-[#7f6df2]"
              />
            </ObsidianPrefRow>

            <ObsidianPrefRow
              label="Embed Page Selector Menu"
              detail="Include quick page navigator dropdown inside the dock."
            >
              <Switch
                checked={dock.showPageMenu}
                onCheckedChange={(val) => setDock({ showPageMenu: val })}
                className="data-[state=checked]:bg-[#7f6df2]"
              />
            </ObsidianPrefRow>
          </>
        )}
      </SettingCard>

      <SettingCard title="Appearance & Aesthetics">
        <ObsidianPrefRow
          label="Container Style"
          detail="Floating island pill vs full-width fixed bar flush with screen edge."
        >
          <Choice<DockContainerStyle>
            value={dock.containerStyle}
            onChange={(containerStyle) => setDock({ containerStyle })}
            options={[
              { id: 'floating', label: 'Floating Island' },
              { id: 'fixed-bar', label: 'Fixed Bar' },
              { id: 'sundial', label: 'Dial' },
            ]}
          />
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Corner Shape"
          detail="Rounding style applied to dock corners."
        >
          <Choice<DockShape>
            value={dock.shape}
            onChange={(shape) => setDock({ shape })}
            options={[
              { id: 'pill', label: 'Pill' },
              { id: 'soft', label: 'Soft' },
              { id: 'sharp', label: 'Sharp' },
            ]}
          />
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Color Theme"
          detail="Visual background style and opacity."
        >
          <Choice<DockColorTheme>
            value={dock.colorTheme}
            onChange={(colorTheme) => setDock({ colorTheme })}
            options={[
              { id: 'glass', label: 'Glass' },
              { id: 'translucent', label: 'Translucent' },
              { id: 'solid', label: 'Solid' },
              { id: 'accent-tinted', label: 'Accent' },
              { id: 'dark-glass', label: 'Dark' },
            ]}
          />
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Icon & Dock Size"
          detail="Footprint and button sizes for dock tools."
        >
          <Choice<DockSize>
            value={dock.size}
            onChange={(size) => setDock({ size })}
            options={[
              { id: 'compact', label: 'Compact' },
              { id: 'normal', label: 'Normal' },
              { id: 'large', label: 'Large' },
            ]}
          />
        </ObsidianPrefRow>
      </SettingCard>

      <SettingCard title="Behavior">
        <ObsidianPrefRow
          label="Autohide on Inactivity"
          detail="Fade the dock out during active drawing or after 3.5s of mouse idle."
        >
          <Switch
            checked={dock.autohide}
            onCheckedChange={(val) => setDock({ autohide: val })}
            className="data-[state=checked]:bg-[#7f6df2]"
          />
        </ObsidianPrefRow>
      </SettingCard>
    </div>
  )
}

function NotebookSettings() {
  const nb = usePrefs((s) => s.notebook)
  const setNb = usePrefs((s) => s.setNotebook)
  const inkToShape = useDocStore((s) => s.inkToShape)
  const inkAnnotate = useDocStore((s) => s.inkAnnotate)

  return (
    <div className="space-y-4">
      <SettingCard title="Canvas & Grid">
        <ObsidianPrefRow
          label="Scrolling Axis"
          detail="Lock canvas navigation to one direction or pan freely in both."
        >
          <Choice<ScrollAxis>
            value={nb.scrollAxis}
            onChange={(scrollAxis) => setNb({ scrollAxis })}
            options={[
              { id: 'free', label: 'Free' },
              { id: 'vertical', label: 'Vertical' },
              { id: 'horizontal', label: 'Horizontal' },
            ]}
          />
        </ObsidianPrefRow>

        <ObsidianPrefRow label="Grid Style">
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
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Grid Cell Size"
          detail={`Grid size: ${nb.gridSize}px`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Grid size"
              value={[nb.gridSize]}
              min={16}
              max={80}
              step={4}
              onValueChange={([v]) => setNb({ gridSize: v })}
            />
          </div>
        </ObsidianPrefRow>
      </SettingCard>

      <SettingCard title="Editing Behavior">
        <ObsidianPrefRow
          label="Ink to Shape"
          detail="Automatically recognize pen strokes into clean circles, rectangles, and components."
        >
          <Switch
            checked={inkToShape}
            onCheckedChange={() => useDocStore.getState().toggleInkToShape()}
            className="data-[state=checked]:bg-[#7f6df2]"
          />
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Ink Annotations"
          detail="Small scribbles near components trigger parameter inputs."
        >
          <Switch
            checked={inkAnnotate}
            onCheckedChange={() => useDocStore.getState().toggleInkAnnotate()}
            className="data-[state=checked]:bg-[#7f6df2]"
          />
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Disable Double-tap Zoom"
          detail="Prevent double-tap gestures from zooming canvas."
        >
          <Switch
            checked={nb.disableDoubleTapZoom}
            onCheckedChange={() => setNb({ disableDoubleTapZoom: !nb.disableDoubleTapZoom })}
            className="data-[state=checked]:bg-[#7f6df2]"
          />
        </ObsidianPrefRow>
      </SettingCard>

      <Button
        variant="outline"
        size="sm"
        className="w-full rounded-xl border-dashed py-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setNb({ ...DEFAULT_NOTEBOOK })}
      >
        Reset Notebook Preferences to Default
      </Button>
    </div>
  )
}

function InterfaceSettings() {
  const nb = usePrefs((s) => s.notebook)
  const setNb = usePrefs((s) => s.setNotebook)

  return (
    <div className="space-y-4">
      <SettingCard title="Interface & Component Scaling">
        <ObsidianPrefRow
          label="Interface UI Scale"
          detail={`Panels, docks, and chrome scale: ${Math.round(nb.uiScale * 100)}%`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Interface UI scale"
              value={[nb.uiScale]}
              min={0.6}
              max={1.4}
              step={0.05}
              onValueChange={([v]) => setNb({ uiScale: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Components UI Scale"
          detail={`Text and chrome inside canvas objects: ${Math.round((nb.componentScale ?? 1) * 100)}%`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Component scale"
              value={[nb.componentScale ?? 1]}
              min={0.8}
              max={1.6}
              step={0.05}
              onValueChange={([v]) => setNb({ componentScale: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Panel Text Size"
          detail={`Sidebar panel text scale: ${Math.round((nb.panelFontScale ?? 1) * 100)}%`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Panel font scale"
              value={[nb.panelFontScale ?? 1]}
              min={0.85}
              max={1.3}
              step={0.05}
              onValueChange={([v]) => setNb({ panelFontScale: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Panel Text Spacing"
          detail={`Letter spacing airiness: ${Math.round((nb.panelSpacing ?? 1) * 100)}%`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Panel letter spacing"
              value={[nb.panelSpacing ?? 1]}
              min={0.9}
              max={1.25}
              step={0.05}
              onValueChange={([v]) => setNb({ panelSpacing: v })}
            />
          </div>
        </ObsidianPrefRow>
      </SettingCard>
    </div>
  )
}

const THEME_SWATCH: Record<(typeof APP_THEMES)[number]['id'], string> = {
  light: 'oklch(0.982 0.003 95)',
  sepia: 'linear-gradient(135deg, oklch(0.97 0.014 90) 0%, oklch(0.725 0.137 51.2) 100%)',
  lily: 'linear-gradient(135deg, oklch(0.9 0.05 15) 0%, oklch(0.88 0.06 45) 100%)',
  solarized: 'linear-gradient(135deg, oklch(0.974 0.026 90.1) 0%, oklch(0.615 0.139 244.9) 100%)',
  sea: 'linear-gradient(135deg, oklch(0.964 0.023 61.2) 0%, oklch(0.522 0.089 194.8) 100%)',
  'im-just-a-girl': 'linear-gradient(135deg, oklch(0.975 0.016 340) 0%, oklch(0.68 0.15 335) 100%)',
  dark: 'oklch(0.17 0.01 270)',
  dim: 'oklch(0.245 0.016 265)',
  midnight: 'oklch(0.13 0.008 270)',
  contrast: 'oklch(0.05 0 0)',
  mountains: 'linear-gradient(135deg, oklch(0.22 0.014 190) 0%, oklch(0.68 0.09 155) 100%)',
  diva: 'linear-gradient(135deg, oklch(0.13 0 0) 0%, oklch(0.624 0.174 1.1) 100%)',
  system: 'linear-gradient(135deg, oklch(0.982 0.003 95) 50%, oklch(0.17 0.01 270) 50%)',
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
  const motion = usePrefs((s) => s.appearance.motion)
  const focusOnEdit = usePrefs((s) => s.appearance.focusOnEdit)
  const accent = usePrefs((s) => s.appearance.accent) ?? 'blue'
  const customAccent = usePrefs((s) => s.appearance.customAccent) ?? '#3b82f6'
  const setAppearance = usePrefs((s) => s.setAppearance)

  const ACCENTS: { id: AccentName; label: string }[] = [
    { id: 'blue', label: 'Blue' },
    { id: 'violet', label: 'Violet' },
    { id: 'mint', label: 'Mint' },
    { id: 'amber', label: 'Amber' },
    { id: 'rose', label: 'Rose' },
  ]

  return (
    <div className="space-y-4">
      <SettingCard title="Theme & Color Scheme">
        <ObsidianPrefRow label="App Theme">
          <Select value={theme} onValueChange={(v) => setTheme(v)}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue>
                {theme && (
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-3 w-3 rounded-full border border-border/80 shrink-0"
                      style={{ background: THEME_SWATCH[theme as keyof typeof THEME_SWATCH] }}
                    />
                    {APP_THEMES.find((t) => t.id === theme)?.label}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {APP_THEMES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-3 w-3 rounded-full border border-border/80 shrink-0"
                      style={{ background: THEME_SWATCH[t.id] }}
                    />
                    {t.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Accent Tint"
          detail="Interface highlight color used for selections, buttons, and active indicators."
        >
          <div className="flex items-center gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                aria-label={`${a.label} tint`}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-95"
                style={{
                  background: `var(--accent-${a.id === 'blue' ? 'blue-base' : a.id})`,
                  boxShadow: accent === a.id ? '0 0 0 2px var(--background), 0 0 0 4px currentColor' : undefined,
                  color: `var(--accent-${a.id === 'blue' ? 'blue-base' : a.id})`,
                }}
                onClick={() => setAppearance({ accent: a.id })}
              >
                {accent === a.id && <Check className="h-3.5 w-3.5 text-white" />}
              </button>
            ))}

            <HexColorSwatchPicker
              label="Custom tint"
              initial={customAccent}
              onChange={(hex) => setAppearance({ accent: 'custom', customAccent: hex })}
              onCommit={(hex) => setAppearance({ accent: 'custom', customAccent: hex })}
              trigger={
                <button
                  type="button"
                  aria-label="Custom tint"
                  className="relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-95"
                  style={{
                    background:
                      accent === 'custom'
                        ? customAccent
                        : 'conic-gradient(from 0deg, red, yellow, lime, cyan, blue, magenta, red)',
                    boxShadow: accent === 'custom' ? '0 0 0 2px var(--background), 0 0 0 4px currentColor' : undefined,
                    color: customAccent,
                  }}
                >
                  {accent === 'custom' ? (
                    <Check className="h-3.5 w-3.5 text-white" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-white drop-shadow" />
                  )}
                </button>
              }
            />
          </div>
        </ObsidianPrefRow>
      </SettingCard>

      <SettingCard title="Motion & Interactions">
        <ObsidianPrefRow
          label="Interface Motion"
          detail="Bouncy physics springs vs smooth transitions vs reduced motion."
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
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Focus Object on Edit"
          detail="On mobile/tablets, lift selected object out of canvas while editing properties."
        >
          <Switch
            checked={focusOnEdit}
            onCheckedChange={() => setAppearance({ focusOnEdit: !focusOnEdit })}
            className="data-[state=checked]:bg-[#7f6df2]"
          />
        </ObsidianPrefRow>
      </SettingCard>
    </div>
  )
}

function MathSettings() {
  const math = usePrefs((s) => s.math)
  const setMath = usePrefs((s) => s.setMath)
  const samples = [1234.56789, 0.000123456, 9.80665, 6.02e14, 1.7e-17]

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/60 bg-card/60 p-3.5">
        <p className="mb-2 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Live Math Preview
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.8125rem]">
          {samples.map((v) => (
            <span key={v}>{fmtNum(v)}</span>
          ))}
        </div>
      </div>

      <SettingCard title="Format & Precision">
        <ObsidianPrefRow
          label="Decimal Precision"
          detail={`Digits after decimal point: ${math.precision} dp`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Decimal precision"
              value={[math.precision]}
              min={0}
              max={8}
              step={1}
              onValueChange={([v]) => setMath({ precision: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Number Notation"
          detail="Auto switches to exponents for large/small values. Engineering locks exponents to powers of 3."
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
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Angle Units"
          detail="Display units for angles (solver works internally in radians)."
        >
          <Choice<AngleUnit>
            value={math.angleUnit}
            onChange={(angleUnit) => setMath({ angleUnit })}
            options={[
              { id: 'deg', label: 'Degrees' },
              { id: 'rad', label: 'Radians' },
            ]}
          />
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Show Unit Labels"
          detail="Append physical units (cm, N, m/s) to readouts."
        >
          <Switch
            checked={math.showUnits}
            onCheckedChange={() => setMath({ showUnits: !math.showUnits })}
            className="data-[state=checked]:bg-[#7f6df2]"
          />
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Thousands Separator"
          detail="Use digit grouping (1,234.5)."
        >
          <Switch
            checked={math.groupDigits}
            onCheckedChange={() => setMath({ groupDigits: !math.groupDigits })}
            className="data-[state=checked]:bg-[#7f6df2]"
          />
        </ObsidianPrefRow>
      </SettingCard>

      <Button
        variant="outline"
        size="sm"
        className="w-full rounded-xl border-dashed py-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setMath({ ...DEFAULT_MATH })}
      >
        Reset Math Settings to Default
      </Button>
    </div>
  )
}

function HotkeyRow({ actionId, label, when }: { actionId: string; label: string; when?: string }) {
  const overrides = usePrefs((s) => s.hotkeys.overrides)
  const setHotkeys = usePrefs((s) => s.setHotkeys)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const combo = resolveCombo(actionId)
  const hasOverride = actionId in overrides

  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setListening(false)
        return
      }
      // Ignore bare modifier presses — wait for the actual key.
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return
      const next = comboFromEvent(e)
      const collision = findCollision(next, actionId)
      if (collision) {
        setError(`Already used by ${collision.label}`)
        return
      }
      setHotkeys({ overrides: { ...overrides, [actionId]: next } })
      setListening(false)
      setError(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, actionId, overrides, setHotkeys])

  return (
    <ObsidianPrefRow
      label={label}
      detail={
        when === 'while-editing' ? 'Only while editing' :
        when === 'while-paused' ? 'Only while paused' :
        when === 'while-running-or-paused' ? 'Only once a run exists' :
        undefined
      }
      action={
        <div className="flex items-center gap-1.5">
          {error && <span className="text-[0.6875rem] text-destructive">{error}</span>}
          {/* The Kbd alone read as a static badge — nobody clicked it. Wrap it
              in a visibly interactive shell (border, hover, focus ring, a
              pencil on hover) and say what a click does, so the row announces
              itself as editable without a tooltip hunt. */}
          <button
            type="button"
            aria-label={
              listening
                ? `Recording new shortcut for ${label}. Press a key, or Escape to cancel.`
                : `Change shortcut for ${label} (currently ${comboLabel(combo)})`
            }
            title={listening ? 'Press a key… Esc to cancel' : 'Click to change'}
            onClick={() => {
              setError(null)
              setListening(true)
            }}
            className={cn(
              'group/hk flex items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5',
              'cursor-pointer transition-colors hover:border-solid hover:border-ring hover:bg-accent/60',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              listening && 'border-solid border-ring bg-accent/60 ring-2 ring-ring'
            )}
          >
            <Kbd className={cn('bg-transparent px-0', listening && 'text-foreground')}>
              {listening ? 'Press a key… (Esc cancels)' : comboLabel(combo)}
            </Kbd>
            {!listening && (
              <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/hk:opacity-100" />
            )}
          </button>
          {hasOverride && (
            <button
              type="button"
              aria-label={`Reset ${label} to default`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                const next = { ...overrides }
                delete next[actionId]
                setHotkeys({ overrides: next })
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      }
    />
  )
}

function GestureSettings() {
  const gestures = usePrefs((s) => s.gestures)
  const setGestures = usePrefs((s) => s.setGestures)

  return (
    <div className="space-y-4">
      <SettingCard title="Pinch & Touch Feel">
        <ObsidianPrefRow
          label="Pinch Sensitivity"
          detail={`How strongly a pinch gesture zooms. ${gestures.pinchSensitivity.toFixed(2)}× (default 1.00×).`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Pinch sensitivity"
              value={[gestures.pinchSensitivity]}
              min={0.5}
              max={2}
              step={0.05}
              onValueChange={([v]) => setGestures({ pinchSensitivity: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Hold Before Drag"
          detail={`Delay before a touch-and-hold starts moving an object, so a quick swipe can still scroll. ${gestures.holdBeforeDragMs}ms (default 150ms).`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Hold before drag"
              value={[gestures.holdBeforeDragMs]}
              min={50}
              max={500}
              step={10}
              onValueChange={([v]) => setGestures({ holdBeforeDragMs: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Tap vs. Drag Distance"
          detail={`How far a touch must travel to count as a swipe instead of a drag. ${gestures.tapVsDragPx}px (default 8px).`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Tap vs drag distance"
              value={[gestures.tapVsDragPx]}
              min={2}
              max={24}
              step={1}
              onValueChange={([v]) => setGestures({ tapVsDragPx: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Palm Rejection Radius"
          detail={`Touch contact size above which it's ignored as a resting palm instead of a fingertip. ${gestures.palmRejectRadiusPx}px (default 20px, 0 disables).`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Palm rejection radius"
              value={[gestures.palmRejectRadiusPx]}
              min={0}
              max={60}
              step={2}
              onValueChange={([v]) => setGestures({ palmRejectRadiusPx: v })}
            />
          </div>
        </ObsidianPrefRow>
      </SettingCard>

      <button
        type="button"
        className="text-[0.75rem] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => usePrefs.getState().setGestures({ ...DEFAULT_GESTURES })}
      >
        Reset to defaults
      </button>
    </div>
  )
}

function PackagesSettings() {
  const packages = usePrefs((s) => s.packages ?? EMPTY_PACKAGES)
  const setPackage = usePrefs((s) => s.setPackage)

  return (
    <div className="space-y-4">
      <SettingCard title="Subject Component Packages">
        {COMPONENT_PACKAGES.map((pkg) => {
          const enabled = packages[pkg.domain] ?? true
          return (
            <ObsidianPrefRow
              key={pkg.id}
              label={pkg.name}
              detail={pkg.description}
            >
              <Switch
                checked={enabled}
                onCheckedChange={(val) => setPackage(pkg.domain, val)}
                className="data-[state=checked]:bg-[#7f6df2]"
              />
            </ObsidianPrefRow>
          )
        })}
      </SettingCard>
    </div>
  )
}

type TabId =
  | 'general'
  | 'appearance'
  | 'interface'
  | 'dock'
  | 'editor'
  | 'files'
  | 'hotkeys'
  | 'gestures'
  | 'math'
  | 'packages'
  | 'pen'
  | 'simulation'
  | 'about'

interface NavItem {
  id: TabId
  label: string
  detail: string
  icon: React.ComponentType<{ className?: string }>
  category: 'options' | 'tools'
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', detail: 'Account, sign out', icon: User, category: 'options' },
  { id: 'appearance', label: 'Appearance', detail: 'Theme, colors', icon: Palette, category: 'options' },
  { id: 'interface', label: 'Interface', detail: 'Layout & density', icon: Sliders, category: 'options' },
  { id: 'dock', label: 'Dock', detail: 'Toolbar position', icon: Layout, category: 'options' },
  { id: 'editor', label: 'Editor', detail: 'Grid, pages', icon: Edit3, category: 'options' },
  { id: 'files', label: 'Files and links', detail: 'Backup, device sync', icon: Files, category: 'options' },
  { id: 'hotkeys', label: 'Hotkeys', detail: 'Keyboard shortcuts', icon: Keyboard, category: 'options' },
  { id: 'gestures', label: 'Gestures', detail: 'Pinch, hold & drag feel', icon: Hand, category: 'options' },
  { id: 'math', label: 'Math', detail: 'Angle unit, notation', icon: Calculator, category: 'options' },
  { id: 'packages', label: 'Packages', detail: 'Optional components', icon: Package, category: 'options' },
  { id: 'pen', label: 'Pen feel', detail: 'Stylus & pressure', icon: Edit3, category: 'tools' },
  { id: 'simulation', label: 'Simulation Engine', detail: 'Physics solver', icon: Activity, category: 'tools' },
  { id: 'about', label: 'About', detail: 'Version, credits', icon: HelpCircle, category: 'tools' },
]

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initialTab?: string
}) {
  const [activeTab, setActiveTab] = useState<TabId>(
    (initialTab as TabId) ?? 'general'
  )
  const [searchQuery, setSearchQuery] = useState('')
  const isTouch = useIsMobile()
  // On mobile, settings opens on a grouped list (like iOS Settings) — a
  // category is only "open" once tapped, so there's a real list screen
  // instead of always dropping straight into General with no way back to
  // an overview. Desktop keeps its always-visible sidebar + panel.
  const [mobileCategoryOpen, setMobileCategoryOpen] = useState(false)

  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)

  const filteredNav = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return NAV_ITEMS
    return NAV_ITEMS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
    )
  }, [searchQuery])

  const optionsItems = filteredNav.filter((item) => item.category === 'options')
  const toolsItems = filteredNav.filter((item) => item.category === 'tools')

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setMobileCategoryOpen(false)
      }}
    >
      <DialogContent
        showCloseButton={false}
        variant={isTouch ? 'sheet' : 'modal'}
        className={cn(
          'flex flex-col overflow-hidden p-0 bg-background shadow-2xl',
          isTouch
            ? 'h-dvh max-h-none w-screen max-w-none rounded-none border-0'
            : 'h-[88dvh] max-h-[850px] w-full sm:w-[92vw] md:w-[88vw] lg:w-[960px] sm:max-w-4xl md:max-w-5xl lg:max-w-5xl rounded-2xl border border-border/70 transition-[transform,opacity] duration-200'
        )}
      >
        <VisuallyHiddenPrimitive.Root asChild>
          <DialogPrimitive.Title>Settings</DialogPrimitive.Title>
        </VisuallyHiddenPrimitive.Root>

        {/* Title bar — desktop keeps the Obsidian-style window chrome; touch
            gets an iOS-style bar that swaps to a Back button once a category
            is open, so the header itself communicates nav depth. */}
        {isTouch ? (
          <div
            className="flex h-12 shrink-0 items-center border-b border-border/50 bg-background px-1 pt-[max(0px,env(safe-area-inset-top))] select-none"
            style={{ height: 'calc(3rem + env(safe-area-inset-top))' }}
          >
            {mobileCategoryOpen ? (
              <button
                type="button"
                onClick={() => setMobileCategoryOpen(false)}
                className="flex items-center gap-0.5 px-2 py-2 text-[0.9375rem] font-medium text-[var(--accent-blue)]"
              >
                <ChevronLeft className="h-5 w-5" />
                Settings
              </button>
            ) : (
              <>
                <span className="flex-1 px-3 text-[0.9375rem] font-extrabold tracking-tight">Settings</span>
                <DialogPrimitive.Close className="px-3 py-2 text-[0.9375rem] font-medium text-[var(--accent-blue)]">
                  Done
                </DialogPrimitive.Close>
              </>
            )}
          </div>
        ) : (
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/50 bg-muted/20 px-4 select-none">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground/80">
              <span>Settings</span>
              <span className="text-muted-foreground/40">•</span>
              <span className="text-muted-foreground font-normal">{profile?.full_name ?? 'Rohan'}</span>
              <span className="text-muted-foreground/40">•</span>
              <span className="text-muted-foreground/80 font-mono text-[0.6875rem]">SIMBLIP 1.13.4</span>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
        )}

        {/* Touch root: a single grouped list, tap a row to drill into that
            category as a full-screen page — same interaction language as
            the rest of the mobile shell (notebook drill-down), instead of a
            horizontal icon strip that hides labels and needs sideways
            scanning to find anything. */}
        {isTouch && !mobileCategoryOpen && (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-border/40 bg-card p-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)] text-lg font-bold text-white shadow-sm">
                {profile?.full_name?.charAt(0) || 'U'}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[0.9375rem] font-bold text-foreground">{profile?.full_name || 'User'}</span>
                <span className="truncate text-[0.75rem] text-muted-foreground">{profile?.email || ''}</span>
              </div>
            </div>

            {[
              { title: null, items: optionsItems.filter((i) => i.id === 'general') },
              { title: 'Preferences', items: optionsItems.filter((i) => i.id !== 'general') },
              { title: 'Tools', items: toolsItems },
            ].map((group, gi) =>
              group.items.length === 0 ? null : (
                <div key={gi} className="mb-5">
                  {group.title && (
                    <div className="mb-1.5 px-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.title}
                    </div>
                  )}
                  <div className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border/40 bg-card">
                    {group.items.map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setActiveTab(item.id)
                            setMobileCategoryOpen(true)
                          }}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-accent/60"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1 text-[0.875rem] font-medium text-foreground">{item.label}</span>
                          <span className="truncate text-[0.75rem] text-muted-foreground">{item.detail}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* Main Split Body — desktop only below this point on touch (the
            drill-in page renders instead when a category is open). On
            touch it slides in from the right rather than popping in via
            `hidden`, so entering a category reads as forward navigation
            matching the header's Back-button direction; `translate-x-full`
            (not `hidden`) keeps it transitionable while off-screen. */}
        <div
          className={cn(
            'flex flex-1 min-h-0',
            isTouch
              ? cn(
                  'absolute inset-0 top-12 flex-col bg-background transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
                  mobileCategoryOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
                )
              : 'divide-x divide-border/40'
          )}
        >
          {/* Sidebar / nav — desktop only; touch uses the grouped list above instead. */}
          {!isTouch && (
            <div className="shrink-0 flex w-48 sm:w-56 md:w-60 flex-col p-3.5 space-y-3.5 overflow-y-auto no-scrollbar border-r bg-muted/20 dark:bg-muted/10 border-border/40">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search settings..."
                  className="h-8 pl-8 pr-7 text-xs bg-background/80 border-border/60 rounded-lg focus-visible:ring-1"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="space-y-4 pt-1">
                {[...optionsItems, ...toolsItems].map((item) => {
                  const Icon = item.icon
                  const isActive = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
                        isActive
                          ? 'bg-black/5 dark:bg-white/10 text-foreground font-semibold shadow-2xs'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                      )}
                    >
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-[var(--accent-blue)]' : 'opacity-70')} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Right Main Settings Surface */}
          <div
            className={cn(
              'flex-1 min-w-0 flex flex-col overflow-y-auto min-h-0 space-y-6',
              isTouch ? 'p-4' : 'p-5 sm:p-7'
            )}
          >
            {/* Header Title — desktop only; touch's Back-button bar already names the category. */}
            {!isTouch && (
              <div className="border-b border-border/40 pb-3">
                <h2 className="text-lg font-bold tracking-tight text-foreground capitalize">
                  {NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Settings'}
                </h2>
              </div>
            )}

            {/* Tab Contents */}
            {activeTab === 'general' && (
              <div className="space-y-4">
                <SettingCard title="User Account">
                  {profile && (
                    <>
                      <ObsidianPrefRow label="Full Name" detail={profile.full_name} />
                      <ObsidianPrefRow label="Email Address" detail={profile.email} />
                      <ObsidianPrefRow label="Role" detail={ROLE_LABEL[profile.role]} />
                      <ObsidianPrefRow label="Institution" detail={institution?.name ?? 'Standard Workspace'} />
                    </>
                  )}
                </SettingCard>

                <SettingCard title="Account Actions">
                  <ObsidianPrefRow
                    label="Sign Out"
                    detail="Log out of your account on this browser."
                    action={
                      <Button variant="outline" size="sm" onClick={() => useAuthStore.getState().logout()}>
                        Sign Out
                      </Button>
                    }
                  />
                </SettingCard>
              </div>
            )}

            {activeTab === 'dock' && <DockSettings />}

            {activeTab === 'appearance' && <AppearanceSettings />}

            {activeTab === 'interface' && <InterfaceSettings />}

            {activeTab === 'editor' && <NotebookSettings />}

            {activeTab === 'pen' && (
              <div className="space-y-4">
                <SettingCard title="Stylus & Pen Controls">
                  <PenSettings />
                </SettingCard>
              </div>
            )}

            {activeTab === 'files' && (
              <div className="space-y-4">
                <SettingCard title="Storage">
                  <StoragePanel />
                </SettingCard>
                <SettingCard title="Backup & Device Sync">
                  <BackupSettings />
                </SettingCard>
              </div>
            )}

            {activeTab === 'math' && <MathSettings />}

            {activeTab === 'packages' && <PackagesSettings />}

            {activeTab === 'hotkeys' && (
              <div className="space-y-4">
                {/* Nothing on this tab used to say the keys were editable —
                    they looked like a printed reference sheet. State the
                    interaction once, up front, instead of hoping the hover
                    styles get discovered. */}
                <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
                  Click any shortcut to record a new one, then press the key combination you want.{' '}
                  <Kbd>Esc</Kbd> cancels, and a combination already taken by another action is
                  refused rather than silently stealing it. Changed shortcuts get a{' '}
                  <RotateCcw className="inline h-3 w-3 align-[-0.1em]" /> to restore the default.
                </p>
                {SHORTCUT_GROUPS.map((group) => (
                  <SettingCard key={group} title={group}>
                    {ACTIONS.filter((a) => a.group === group).map((a) => (
                      <HotkeyRow key={a.id} actionId={a.id} label={a.label} when={a.when} />
                    ))}
                  </SettingCard>
                ))}
                <button
                  type="button"
                  className="text-[0.75rem] font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => usePrefs.getState().setHotkeys({ overrides: {} })}
                >
                  Reset all to defaults
                </button>
              </div>
            )}

            {activeTab === 'gestures' && <GestureSettings />}

            {activeTab === 'simulation' && (
              <div className="space-y-4">
                <SettingCard title="Simulation Engine">
                  <ObsidianPrefRow
                    label="Physics World Solver"
                    detail="Sub-stepping collision detector and spring integrator."
                  />
                </SettingCard>
              </div>
            )}

            {activeTab === 'about' && (
              <div className="space-y-4">
                <SettingCard title="About SIMBLIP">
                  <ObsidianPrefRow
                    label="Version 1.13.4"
                    detail="Installer version: 1.13.4"
                    action={
                      <Button variant="outline" size="sm">
                        Check for updates
                      </Button>
                    }
                  />
                  <ObsidianPrefRow
                    label="Developer"
                    detail="Built by Rohan Singh."
                  />
                </SettingCard>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
