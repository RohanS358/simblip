import type { Metadata } from 'next'
import { DocsView } from '@/components/docs/docs-view'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://simblip.rohan-singh.com.np'

export const metadata: Metadata = {
  title: 'Documentation — how to use SIMBLIP',
  description:
    'The complete SIMBLIP user manual: every tool, panel, page kind, component, behavior, simulation engine, AI feature, classroom workflow and setting, explained.',
  alternates: { canonical: '/docs' },
  openGraph: {
    title: 'SIMBLIP Documentation',
    description:
      'Every tool, panel, component, behavior and setting in SIMBLIP — the engineering notebook that simulates.',
    url: `${SITE_URL}/docs`,
  },
}

export default function DocsPage() {
  return <DocsView />
}
