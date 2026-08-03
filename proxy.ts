import { NextRequest, NextResponse } from 'next/server'

// Per-request nonce so script-src can drop 'unsafe-inline' for browsers that
// understand nonces while 'strict-dynamic' + the https:/unsafe-inline
// fallback keep older ones working — the pattern Next's own CSP docs and
// Google's strict-csp guide both recommend. Setting the nonce on the
// *request* headers (not just the response) is what makes Next thread it
// onto its own inline hydration scripts automatically.
function buildCsp(nonce: string) {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`,
    // Inline style="" is load-bearing here (canvas object positions/transforms
    // are set via style attrs, not classes) — a strict style-src would break
    // every object on the board.
    `style-src 'self' 'unsafe-inline'`,
    // Institution logos (app/admin) are admin-entered URLs on arbitrary
    // domains, so img-src can't be pinned to 'self'.
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' blob:`,
    `worker-src 'self' blob:`,
    `media-src 'self' blob:`,
    `manifest-src 'self'`,
    `frame-ancestors 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ].join('; ')
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = buildCsp(nonce)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    // Everything except API routes (JSON responses + the board-live WebSocket
    // upgrade, where a document CSP header is meaningless and risks
    // interfering with the upgrade handshake), static assets and the service
    // worker.
    '/((?!api/|_next/static|_next/image|favicon.ico|sw.js|manifest\\.webmanifest|manifest|fonts/|logo\\.png|apple-icon\\.png|icon-192\\.png|icon-512\\.png).*)',
  ],
}
