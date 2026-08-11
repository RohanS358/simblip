'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'
import { usePrefs } from '@/lib/store/preferences'

// Every selectable appearance theme, in display order. Light and dark each
// come in flavors: Sepia is warm paper, Lily is baby pink/orange, Dim is
// softened slate, Midnight is near-black for OLED, Contrast is a
// high-visibility accessibility theme. Their palettes live in globals.css
// under .<id>.
export const APP_THEMES = [
  { id: 'light', label: 'Light', dark: false },
  { id: 'sepia', label: 'Sepia', dark: false },
  { id: 'lily', label: 'Lily', dark: false },
  { id: 'solarized', label: 'Solarized', dark: false },
  { id: 'sea', label: 'Sea', dark: false },
  { id: 'im-just-a-girl', label: "I'm Just a Girl", dark: false },
  { id: 'dark', label: 'Dark', dark: true },
  { id: 'dim', label: 'Dim', dark: true },
  { id: 'midnight', label: 'Midnight', dark: true },
  { id: 'contrast', label: 'Contrast', dark: true },
  { id: 'mountains', label: 'Mountains', dark: true },
  { id: 'diva', label: 'Diva', dark: true },
  { id: 'system', label: 'System', dark: false },
] as const

const DARK_FAMILY = new Set(['dark', 'dim', 'midnight', 'contrast', 'mountains', 'diva'])

// True for any dark-family theme — the canvas, icons and quick toggles must
// treat Dim, Midnight and Contrast exactly like Dark.
export function isDarkTheme(theme: string | undefined): boolean {
  return !!theme && DARK_FAMILY.has(theme)
}

// The chosen tint overrides --accent-blue at the root; every "blue" surface
// (selection, buttons, active states) follows, per theme, with no re-render.
// It lives HERE — not in any one shell — so the mobile shell, room boards,
// assignments and the presenter all wear the same tint.
function AccentApplier() {
  const accent = usePrefs((s) => s.appearance.accent) ?? 'blue'
  const customAccent = usePrefs((s) => s.appearance.customAccent) ?? '#3b82f6'
  React.useEffect(() => {
    if (accent === 'blue') document.documentElement.style.removeProperty('--accent-blue')
    else if (accent === 'custom') document.documentElement.style.setProperty('--accent-blue', customAccent)
    else document.documentElement.style.setProperty('--accent-blue', `var(--accent-${accent})`)
  }, [accent, customAccent])
  return null
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <AccentApplier />
      {children}
    </NextThemesProvider>
  )
}
