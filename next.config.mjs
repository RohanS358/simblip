/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Lighthouse flagged the first-party chunks as missing source maps —
  // without them, production errors (Sentry-less right now) are unreadable
  // minified stack traces.
  productionBrowserSourceMaps: false,
  async headers() {
    // _next/static/* already gets long-lived immutable caching from Vercel;
    // these are the public/ assets that don't. sw.js is deliberately
    // excluded — a long max-age there would delay PWA update pickup.
    //
    // Content-Security-Policy lives in middleware.ts instead of here — it
    // needs a fresh per-request nonce, which this static headers() config
    // can't generate. HSTS/COOP/XFO/nosniff don't depend on the request, so
    // they're simpler to keep here and apply to every route incl. /api.
    return [
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/:path(logo|apple-icon|icon-192|icon-512).png',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/:path*',
        headers: [
          // Not preloaded — submitting to the HSTS preload list is a
          // separate, harder-to-reverse step (browsers ship the list in
          // their binary) that belongs to a deliberate launch decision, not
          // a default here.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ]
  },
}

export default nextConfig
