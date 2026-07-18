'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner, ToasterProps } from 'sonner'
import { isDarkTheme } from '@/components/theme-provider'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()
  // Sonner only knows light/dark/system — every extra flavor (Sepia, Lily,
  // Dim, Midnight, Contrast) maps down to whichever family it belongs to.
  const sonnerTheme: ToasterProps['theme'] =
    theme === 'system' ? 'system' : isDarkTheme(theme) ? 'dark' : 'light'

  return (
    <Sonner
      theme={sonnerTheme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
