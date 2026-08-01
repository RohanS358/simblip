import { ImageResponse } from 'next/og'

export const alt = 'SIMBLIP — The Engineering Notebook That Simulates'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Next.js wires this into og:image (and twitter:image, via twitter-image.tsx
// re-exporting it) automatically by file convention — no metadata.images
// entry needed. Without either, shares to Slack/Discord/X/iMessage rendered
// as a bare link with no preview card at all.
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
          background: '#0a0a0b',
          backgroundImage:
            'radial-gradient(circle at 82% 18%, rgba(59,130,246,0.35), transparent 60%)',
        }}
      >
        <div style={{ display: 'flex', fontSize: 42, fontWeight: 800, letterSpacing: -1, color: '#fff' }}>
          SIM<span style={{ color: '#3b82f6' }}>BLIP</span>
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 36,
            fontSize: 68,
            fontWeight: 800,
            letterSpacing: -2,
            lineHeight: 1.05,
            maxWidth: 920,
            color: '#fff',
          }}
        >
          Where drawings become experiments
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 30,
            fontSize: 28,
            lineHeight: 1.4,
            maxWidth: 840,
            color: '#a1a1aa',
          }}
        >
          Notes, live physics simulations, circuits, equations and graphs on one infinite canvas.
        </div>
      </div>
    ),
    { ...size }
  )
}
