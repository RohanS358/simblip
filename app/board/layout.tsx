import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  robots: { index: false }, // a specific room's display, nothing to index
}

// Same fix as /notebook (see app/notebook/page.tsx): this is the same
// touch-driven PageView (DocView/PdfView/InfiniteCanvas) running on the
// room's touchscreen. Without this, native page-zoom fights the canvas's
// own pinch-zoom and drags every fixed-position panel out of place with it —
// this route just never got the fix when /notebook did.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
}

export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return children
}
