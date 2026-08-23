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
  // minified stack traces. This ships .map files alongside the chunks; they
  // are only fetched when devtools is open, so there is no cost to real
  // users, but it does make the client source readable to anyone who looks.
  productionBrowserSourceMaps: true,
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
          // `preload` is the directive Lighthouse's strong-HSTS audit wants.
          // It only advertises eligibility — the domain is NOT on the preload
          // list until someone submits it at hstspreload.org, which is the
          // genuinely hard-to-reverse step. Do not submit until every current
          // and future subdomain of rohan-singh.com.np is HTTPS-only.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
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
