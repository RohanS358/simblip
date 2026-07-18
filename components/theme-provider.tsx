'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'
import { usePrefs } from '@/lib/store/preferences'

// The chosen tint overrides --accent-blue at the root; every "blue" surface
// (selection, buttons, active states) follows, per theme, with no re-render.
// It lives HERE — not in any one shell — so the mobile shell, room boards,
// assignments and the presenter all wear the same tint.
function AccentApplier() {
  const accent = usePrefs((s) => s.appearance.accent) ?? 'blue'
  React.useEffect(() => {
    if (accent === 'blue') document.documentElement.style.removeProperty('--accent-blue')
    else document.documentElement.style.setProperty('--accent-blue', `var(--accent-${accent})`)
  }, [accent])
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
