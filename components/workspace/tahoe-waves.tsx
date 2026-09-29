'use client'

// Top-of-screen backdrop for the mobile tabs. This used to be an animated
// scene of layered multi-colour SVG waves with a backdrop blur and per-theme
// hard-coded palettes — busy, off-brand next to the rest of the UI, and a
// constant animation cost on phones. It is now a single quiet wash: the
// theme's own accent, a trace of it, fading into the background. Static,
// token-driven (follows every theme and the user's accent automatically).
//
// Name and props kept so every screen picks it up unchanged.

export function TahoeWaves({ height = 180, className = '' }: { height?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 ${className}`}
      style={{
        height,
        background:
          'radial-gradient(120% 90% at 50% -20%, color-mix(in oklch, var(--accent-blue) 14%, transparent) 0%, transparent 70%), linear-gradient(to bottom, color-mix(in oklch, var(--accent-blue) 5%, transparent), transparent)',
      }}
    />
  )
}
