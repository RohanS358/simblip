import type { Metadata, Viewport } from 'next'
import { WorkspaceShell } from '@/components/workspace/shell'
import { RequireAuth } from '@/components/auth/require-auth'

export const metadata: Metadata = {
  title: 'Notebook',
  description:
    'Your SIMBLIP workspace — draw, simulate and graph on an infinite canvas. Works offline; syncs across devices when cloud sync is enabled.',
  robots: { index: false }, // personal workspace, nothing to index
}

// The workspace is an app, not a document — but blocking page zoom to protect
// it failed WCAG 1.4.4: `user-scalable=no` takes magnification away from
// low-vision users, which is exactly who needs it on a dense canvas UI. The
// two problems it was papering over are handled where they actually live:
// canvas pinch-zoom claims its own gestures via `touch-action` (canvas.tsx),
// and iOS's auto-zoom-on-focus is prevented by the 16px control floor in
// globals.css rather than by disabling zoom for everyone.
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

export default function NotebookPage() {
  return (
    <RequireAuth allow={['admin', 'teacher', 'student', 'super_admin']}>
      <WorkspaceShell />
    </RequireAuth>
  )
}
