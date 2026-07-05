import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://simblip.vercel.app'

export default function sitemap(): MetadataRoute.Sitemap {
  // /notebook is a personal workspace (noindex) — only the landing is public.
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
