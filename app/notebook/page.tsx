import type { Metadata } from 'next'
import { WorkspaceShell } from '@/components/workspace/shell'

export const metadata: Metadata = {
  title: 'Notebook',
  description:
    'Your SIMBLIP workspace — draw, simulate and graph on an infinite canvas. Works offline; syncs across devices when cloud sync is enabled.',
  robots: { index: false }, // personal workspace, nothing to index
}

export default function NotebookPage() {
  return <WorkspaceShell />
}
