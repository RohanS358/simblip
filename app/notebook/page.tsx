import type { Metadata, Viewport } from 'next'
import { WorkspaceShell } from '@/components/workspace/shell'

export const metadata: Metadata = {
  title: 'Notebook',
  description:
    'Your SIMBLIP workspace — draw, simulate and graph on an infinite canvas. Works offline; syncs across devices when cloud sync is enabled.',
  robots: { index: false }, // personal workspace, nothing to index
}

// The workspace is an app, not a document: page zoom would fight canvas
// pinch-zoom and iOS would auto-zoom the compact inputs. Landing stays zoomable.
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

export default function NotebookPage() {
  return <WorkspaceShell />
}
