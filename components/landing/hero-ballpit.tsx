'use client'

// The landing/auth backdrop: the React Bits ballpit — real colliding spheres
// that chase the cursor. Loaded lazily (three.js never blocks first paint)
// and it self-pauses when offscreen or the tab is hidden.

import dynamic from 'next/dynamic'

const Ballpit = dynamic(() => import('./ballpit'), { ssr: false })

export function HeroBallpit({ className }: { className?: string }) {
  return (
    <div className={className ?? 'absolute inset-0 opacity-70'} aria-hidden>
      <Ballpit
        count={90}
        gravity={0.05}
        friction={0.9975}
        wallBounce={0.95}
        folowCursor={false}
        colors={[0x3b82f6, 0x10b981, 0x8b5cf6, 0xf59e0b]}
        minSize={0.35}
        maxSize={0.9}
        maxVelocity={0.12}
      />
    </div>
  )
}
