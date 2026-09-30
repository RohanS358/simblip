'use client'

// Route-transition loader for every server-rendered segment.

import { BounceLoader } from '@/components/ui/bounce-loader'

export default function Loading() {
  return (
    <main
      aria-busy="true"
      className="canvas-dots flex h-dvh flex-col items-center justify-center gap-3 bg-background [background-size:24px_24px]"
    >
      <BounceLoader size={260} />
      <h1 className="text-ui-lg font-extrabold tracking-tight">
        SIM<span className="text-[var(--accent-blue)]">BLIP</span>
      </h1>
      <p role="status" className="text-ui-2xs tracking-wide text-muted-foreground">loading…</p>
    </main>
  )
}
