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


const breadcrumbs = (name: string, path: string) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'SIMBLIP', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name, item: `${SITE_URL}${path}` },
  ],
})

export default function DocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs('Documentation', '/docs')) }} />
      <DocsView />
    </>
  )
}
