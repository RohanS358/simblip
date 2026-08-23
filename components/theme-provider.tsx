'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'
import { usePrefs } from '@/lib/store/preferences'
import { useAuthStore } from '@/lib/auth/store'
import { UNSET_BRAND_ACCENT } from '@/lib/auth/bootstrap'

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

// --accent-blue is the app's single accent channel: every "blue" surface
// (selection, buttons, active states) reads it, per theme, with no re-render.
//
// It has exactly ONE writer, here. It used to have two — this component for the
// user's Accent Tint, and RequireAuth for the institution's brand colour — both
// setting the same inline property on documentElement. RequireAuth mounts lower
// and re-ran on every auth change, so it silently clobbered the user's choice:
// picking green in Settings did nothing on any page inside an institution.
//
// Precedence, highest first:
//   1. an explicit user tint (anything other than the 'blue' default)
//   2. the institution's brand colour, if one was actually CHOSEN
//   3. the theme's own --accent-blue, by removing the override entirely
//
// Rung 2 used to swallow rung 3 whole: every institution row was seeded with
// UNSET_BRAND_ACCENT, the placeholder the admin colour picker opens on, so
// `brand` was always truthy and always blue. Picking Lily or Mountains changed
// every surface in the app EXCEPT the accent, which is the one the theme is
// named for. A brand only outranks the theme when someone picked it.
function AccentApplier() {
  const accent = usePrefs((s) => s.appearance.accent) ?? 'blue'
  const customAccent = usePrefs((s) => s.appearance.customAccent) ?? '#3b82f6'
  const rawBrand = useAuthStore((s) => s.institution?.accent_color) ?? null
  // Compared case-insensitively: the picker and the DB both round-trip hex.
  const brand = rawBrand?.toLowerCase() === UNSET_BRAND_ACCENT ? null : rawBrand
  React.useEffect(() => {
    const root = document.documentElement
    if (accent === 'custom') root.style.setProperty('--accent-blue', customAccent)
    else if (accent !== 'blue') root.style.setProperty('--accent-blue', `var(--accent-${accent})`)
    else if (brand) root.style.setProperty('--accent-blue', brand)
    else root.style.removeProperty('--accent-blue')
  }, [accent, customAccent, brand])
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
