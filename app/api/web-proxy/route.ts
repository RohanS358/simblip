import { NextRequest, NextResponse } from 'next/server'

// Web proxy — fetches any external URL server-side and strips the headers
// that prevent cross-origin iframe embedding (X-Frame-Options,
// Content-Security-Policy, Cross-Origin-Opener-Policy, etc.).
//
// Usage: /api/web-proxy?url=https://example.com
//
// Security: this route is intentionally wide-open — it's a deliberate
// "browser-in-a-tab" feature, not an unintended SSRF vector. Requests that
// attempt to reach local/RFC-1918 addresses are blocked.

const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1)/i

// Headers we strip from upstream responses before forwarding to the iframe.
const STRIP_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
])

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url')
  if (!rawUrl) return NextResponse.json({ error: 'Missing url param' }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return NextResponse.json({ error: 'Only http/https allowed' }, { status: 400 })
  }

  if (BLOCKED_HOSTS.test(parsed.hostname)) {
    return NextResponse.json({ error: 'Private addresses not allowed' }, { status: 403 })
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Simblip/1.0)',
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      // Next.js edge/node doesn't honour AbortSignal the same way, but a
      // 10-second timeout prevents hung requests from blocking the server.
      signal: AbortSignal.timeout(10_000),
    })

    const body = await upstream.arrayBuffer()

    const outHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
      if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        outHeaders.set(key, value)
      }
    })

    // Allow the iframe to display the proxied content.
    outHeaders.set('X-Frame-Options', 'ALLOWALL')
    outHeaders.delete('Content-Security-Policy')

    return new NextResponse(body, {
      status: upstream.status,
      headers: outHeaders,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Fetch failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
