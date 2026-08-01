import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Present',
  robots: { index: false }, // a live session controller, nothing to index
}

// Same fix as /notebook and /board: the presenter controller is a phone UI
// too, so an accidental pinch shouldn't zoom the page instead of the intended
// control.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
}

export default function PresentLayout({ children }: { children: React.ReactNode }) {
  return children
}
