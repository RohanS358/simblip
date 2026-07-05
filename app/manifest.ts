import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SIMBLIP — The Engineering Notebook That Simulates',
    short_name: 'SIMBLIP',
    description:
      'Notes, physics simulations, circuits, equations and live graphs on one infinite canvas. Built by Rohan Singh.',
    start_url: '/notebook',
    display: 'standalone',
    background_color: '#0a0a0b',
    theme_color: '#0a0a0b',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
