import { Landing } from '@/components/landing/showcase'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://simblip.vercel.app'

// Structured data: tells search engines what SIMBLIP is and who built it.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'SIMBLIP',
      url: SITE_URL,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web',
      description:
        'An engineering notebook on an infinite canvas: notes, live physics simulations, circuits, equations and graphs. Draw a shape, attach a behavior, press Play.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@id': `${SITE_URL}/#rohan-singh` },
      creator: { '@id': `${SITE_URL}/#rohan-singh` },
      featureList: [
        'Infinite canvas notebook',
        'Live rigid-body physics simulation',
        'Electrical, electronics and digital circuit simulation',
        'Sketch recognition — doodles become components',
        'Formula engine with live variables',
        'Multi-object live graphs',
        'Offline-first with optional cloud sync',
      ],
    },
    {
      '@type': 'Person',
      '@id': `${SITE_URL}/#rohan-singh`,
      name: 'Rohan Singh',
      jobTitle: 'Software Developer',
      description: 'Developer and creator of SIMBLIP.',
    },
  ],
}

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Landing />
    </>
  )
}
