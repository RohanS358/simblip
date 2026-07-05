import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/notebook',
    name: 'SIMBLIP — The Engineering Notebook That Simulates',
    short_name: 'SIMBLIP',
    description:
      'Notes, physics simulations, circuits, equations and live graphs on one infinite canvas. Built by Rohan Singh.',
    start_url: '/notebook',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a0b',
    theme_color: '#0a0a0b',
    categories: ['education', 'productivity'],
    // Chrome's install criteria want explicit 192 and 512 icons.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
