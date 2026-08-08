'use client'

// Settings: profile, appearance, dock, notebook & simulation preferences,
// keyboard shortcuts and about. Styled after Obsidian's clean settings window.

import { useState, useMemo } from 'react'
import { useTheme } from 'next-themes'
import { APP_THEMES } from '@/components/theme-provider'
import { useAuthStore } from '@/lib/auth/store'
import { ROLE_LABEL } from '@/lib/auth/types'
import { useDocStore } from '@/lib/store/document'
import { Dialog, DialogContent } from '@/components/ui/dialog'

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
  Calculator,
  HelpCircle,
  Activity,
  Check,
  RotateCcw,
} from 'lucide-react'
import { PenSettings } from './pen-settings'
import { BackupSettings } from './backup-settings'
import { Field, Choice, PrefRow, SettingCard, ObsidianPrefRow } from './settings-fields'
import {
  usePrefs,
  DEFAULT_NOTEBOOK,
  DEFAULT_MATH,
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
import { SHORTCUTS, SHORTCUT_GROUPS } from '@/lib/shortcuts'

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
  sepia: 'oklch(0.955 0.02 88)',
  lily: 'linear-gradient(135deg, oklch(0.9 0.05 15) 0%, oklch(0.88 0.06 45) 100%)',
  dark: 'oklch(0.17 0.01 270)',
  dim: 'oklch(0.245 0.016 265)',
  midnight: 'oklch(0.13 0.008 270)',
  contrast: 'oklch(0.05 0 0)',
  system: 'linear-gradient(135deg, oklch(0.982 0.003 95) 50%, oklch(0.17 0.01 270) 50%)',
}

function AppearanceSettings() {
  const { theme, setTheme } = useTheme()
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
    <div className="space-y-4">
      <SettingCard title="Theme & Color Scheme">
        <ObsidianPrefRow
          label="App Theme"
          detail="Choose a workspace theme suited for light, dark, OLED or high contrast environments."
        >
          <div className="flex flex-wrap gap-1.5 max-w-full sm:max-w-md md:max-w-lg justify-start sm:justify-end">
            {APP_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all shrink-0',
                  theme === t.id
                    ? 'border-foreground bg-accent text-foreground shadow-xs font-semibold'
                    : 'border-border bg-background/80 text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                <span
                  aria-hidden
                  className="h-3 w-3 rounded-full border border-border/80 shrink-0"
                  style={{ background: THEME_SWATCH[t.id] }}
                />
                {t.label}
              </button>
            ))}
          </div>
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
  | 'math'
  | 'packages'
  | 'pen'
  | 'simulation'
  | 'about'

interface NavItem {
  id: TabId
  label: string
  icon: React.ComponentType<{ className?: string }>
  category: 'options' | 'tools'
}

const NAV_ITEMS: NavItem[] = [
  { id: 'general', label: 'General', icon: User, category: 'options' },
  { id: 'appearance', label: 'Appearance', icon: Palette, category: 'options' },
  { id: 'interface', label: 'Interface', icon: Sliders, category: 'options' },
  { id: 'dock', label: 'Dock', icon: Layout, category: 'options' },
  { id: 'editor', label: 'Editor', icon: Edit3, category: 'options' },
  { id: 'files', label: 'Files and links', icon: Files, category: 'options' },
  { id: 'hotkeys', label: 'Hotkeys', icon: Keyboard, category: 'options' },
  { id: 'math', label: 'Math', icon: Calculator, category: 'options' },
  { id: 'packages', label: 'Packages', icon: Package, category: 'options' },
  { id: 'pen', label: 'Pen feel', icon: Edit3, category: 'tools' },
  { id: 'simulation', label: 'Simulation Engine', icon: Activity, category: 'tools' },
  { id: 'about', label: 'About', icon: HelpCircle, category: 'tools' },
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-[88dvh] max-h-[850px] w-full sm:w-[92vw] md:w-[88vw] lg:w-[960px] sm:max-w-4xl md:max-w-5xl lg:max-w-5xl flex-col overflow-hidden p-0 rounded-2xl border border-border/70 bg-background shadow-2xl transition-all duration-200">
        <VisuallyHiddenPrimitive.Root asChild>
          <DialogPrimitive.Title>Settings</DialogPrimitive.Title>
        </VisuallyHiddenPrimitive.Root>
        {/* Top Obsidian Window Title Bar */}
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

        {/* Main Split Body */}
        <div className="flex flex-1 min-h-0 divide-x divide-border/40">
          {/* Left Sidebar */}
          <div className="w-48 sm:w-56 md:w-60 shrink-0 flex flex-col bg-muted/20 dark:bg-muted/10 p-3.5 space-y-3.5 overflow-y-auto no-scrollbar border-r border-border/40">
            {/* Search Input */}
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

            {/* Navigation Options */}
            <div className="space-y-4 pt-1">
              {optionsItems.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2 pb-1 text-[0.625rem] font-bold uppercase tracking-wider text-muted-foreground/70">
                    Options
                  </p>
                  {optionsItems.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors text-left',
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
              )}

              {toolsItems.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2 pb-1 text-[0.625rem] font-bold uppercase tracking-wider text-muted-foreground/70">
                    Core plugins & Tools
                  </p>
                  {toolsItems.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors text-left',
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
              )}
            </div>
          </div>

          {/* Right Main Settings Surface */}
          <div className="flex-1 min-w-0 flex flex-col p-5 sm:p-7 overflow-y-auto min-h-0 space-y-6">
            {/* Header Title */}
            <div className="border-b border-border/40 pb-3">
              <h2 className="text-lg font-bold tracking-tight text-foreground capitalize">
                {NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Settings'}
              </h2>
            </div>

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
                <SettingCard title="Backup & Device Sync">
                  <BackupSettings />
                </SettingCard>
              </div>
            )}

            {activeTab === 'math' && <MathSettings />}

            {activeTab === 'packages' && <PackagesSettings />}

            {activeTab === 'hotkeys' && (
              <div className="space-y-4">
                {SHORTCUT_GROUPS.map((group) => (
                  <SettingCard key={group} title={group}>
                    {SHORTCUTS.filter((s) => s.group === group).map((s, i) => (
                      <ObsidianPrefRow
                        key={`${s.keys}-${i}`}
                        label={s.label}
                        action={<Kbd>{s.keys}</Kbd>}
                      />
                    ))}
                  </SettingCard>
                ))}
              </div>
            )}

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
