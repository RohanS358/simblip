import { NextRequest, NextResponse } from 'next/server'

// Web proxy — fetches any external URL server-side and strips the headers
// that prevent cross-origin iframe embedding (X-Frame-Options,
// Content-Security-Policy, Cross-Origin-Opener-Policy, etc.).
//
// Usage: /api/web-proxy/https://example.com/some/path?query=1
//
// Path-based (not /api/web-proxy?url=...): a GET <form> submit always
// REPLACES the action URL's entire query string with the form's own fields
// — that's standard browser behavior, not something rewriteHtml can work
// around. With a ?url= query param scheme, any GET search box on any
// proxied site would silently wipe the url= param the instant it submitted
// (confirmed against Google's own search form). Putting the target URL in
// the PATH instead means a form's query string lands where it belongs — as
// the query string of the (upstream) target URL, appended right here from
// req.nextUrl.search — while the proxy's own address (the path) survives
// untouched.
//
// Security: this route is intentionally wide-open — it's a deliberate
// "browser-in-a-tab" feature, not an unintended SSRF vector. Requests that
// attempt to reach local/RFC-1918 addresses are blocked.

// SSRF guard. The old check was a string regex on the hostname:
//   /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1)/i
// which every standard bypass walks straight through — decimal-encoded IPs
// (http://2130706433 = 127.0.0.1), IPv6-mapped (::ffff:127.0.0.1), 0.0.0.0,
// the link-local cloud metadata endpoint at 169.254.169.254 (the dangerous
// one on any cloud host: it hands out instance credentials), and DNS
// rebinding via a hostname that resolves to a private address.
//
// We now RESOLVE the hostname and check the resulting IPs, so what's
// validated is what will actually be connected to.

/**
 * True when `hostname` is — or resolves to — an address we must not proxy.
 * Resolution is what closes DNS rebinding and every encoding trick: whatever
 * the hostname looks like, we judge the IPs it actually points at.
 *
 * A resolution failure blocks the request. A hostname we cannot resolve is
 * one we cannot vet, and failing open here is the whole vulnerability.
 */
async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) return true

  // Decimal / octal / hex encodings of an IPv4 address ("2130706433",
  // "0x7f000001") — URL parsers accept these, DNS never sees them. This must
  // be tested BEFORE the dotted-quad branch: "2130706433" also matches a
  // digits-and-dots pattern, and would otherwise fall through as a malformed
  // dotted quad and be judged public.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    const n = host.toLowerCase().startsWith('0x') ? parseInt(host, 16) : Number(host)
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) {
      return isPrivateIp(
        [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
      )
    }
    return true
  }

  // A bare IP literal needs no DNS round-trip.
  if (/^[\d.]+$/.test(host) || host.includes(':')) return isPrivateIp(host)

  try {
    const { lookup } = await import('node:dns/promises')
    const results = await lookup(host, { all: true })
    // ANY private answer blocks: a name resolving to both a public and a
    // private address is a rebinding attempt, not a legitimate site.
    return results.length === 0 || results.some((r) => isPrivateIp(r.address))
  } catch {
    return true
  }
}

/** Private, loopback, link-local and other non-routable IPv4/IPv6 ranges. */
function isPrivateIp(ip: string): boolean {
  // Normalize IPv6-mapped IPv4 ("::ffff:127.0.0.1") down to the IPv4 form.
  const v4 = ip.replace(/^::ffff:/i, '')

  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const parts = v4.split('.').map(Number)
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b] = parts
    return (
      a === 0 || // 0.0.0.0/8 — "this host"
      a === 10 || // private
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 192 && b === 0) || // IETF protocol assignments
      a >= 224 // multicast + reserved
    )
  }

  const v6 = ip.toLowerCase()
  return (
    v6 === '::' ||
    v6 === '::1' || // loopback
    v6.startsWith('fc') || // unique local
    v6.startsWith('fd') ||
    v6.startsWith('fe80') || // link-local
    v6.startsWith('ff') // multicast
  )
}

// Headers we strip from upstream responses before forwarding to the iframe.
const STRIP_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  // The iframe now runs allow-same-origin (see web-view.tsx) so its scripts
  // can fetch()/read cookies like a real page — a foreign Set-Cookie would
  // otherwise land in OUR app's own cookie jar, so it must be stripped here
  // at the HTTP layer; the sandbox no longer provides this as a backstop.
  'set-cookie',
  // fetch() already decompresses the body when we call arrayBuffer() — if we
  // forward these headers the browser tries to decompress again and fails with
  // ERR_CONTENT_DECODING_FAILED.
  'content-encoding',
  'transfer-encoding',
])

// URL-bearing attributes we rewrite so browsing stays inside the proxy.
// Covers both navigation (a/form/iframe — leaving the proxy breaks framing)
// and resources (link/script/img/source — leaving the proxy 404s, since
// those requests go straight to the real origin with no Set-Cookie/CORS
// stripping). Deliberately wider than just nav elements: relying on a
// <base href> pointed at the upstream origin makes root-relative paths
// built by the PAGE'S OWN JavaScript at runtime (e.g. a site constructing a
// path from embedded config and assigning location.href directly) resolve
// straight to the real site, bypassing every rewrite here — since that only
// runs once, server-side, against the static HTML. Making every attribute
// we control an ABSOLUTE proxy URL closes that gap for anything a script
// reads back out of the DOM (most sites reuse the attribute value rather
// than re-deriving it), and <base> below now points at the proxy itself as
// a backstop for whatever still isn't covered, instead of at the upstream
// origin.
const ATTR_REWRITES: Array<[string, string]> = [
  ['a', 'href'],
  ['area', 'href'],
  ['form', 'action'],
  ['iframe', 'src'],
  ['frame', 'src'],
  ['link', 'href'],
  ['script', 'src'],
  ['img', 'src'],
  ['source', 'src'],
]

function toProxyPath(abs: URL): string {
  // The target's own query string travels as part of the path segment here
  // (encodeURIComponent covers '?'/'&' fine) — a GET form's fields are
  // appended by the browser AFTER this whole path, landing in req.nextUrl's
  // own search params, and get merged back onto the target in GET() below.
  return `/api/web-proxy/${encodeURIComponent(abs.href)}`
}

// Closes the gap ATTR_REWRITES can't reach: elements a page's own JS creates
// and populates AFTER load (document.createElement('script').src = ...,
// new Image().src = ..., dynamic <link>, fetch()/XHR to a relative path).
// None of that exists in the static HTML rewriteHtml() scans, so without
// this a root-relative path a site's JS builds (e.g. '/xjs/...') resolves
// against <base href="/"> straight to OUR origin and 404s (confirmed against
// Google's homepage, which injects its /xjs/... bootstrap script and
// nav_logo229.png this way). __SIMBLIP_PROXY_BASE__ (set in rewriteHtml
// below, one value per response — the target's own URL) is the base a
// root-relative path needs to resolve against to reach the REAL site, since
// location.href here is our own proxy path, not the upstream one. Patches
// the DOM property setters/methods every dynamic-resource path funnels
// through, regardless of which specific API a site uses — same interception
// point real forward-proxies use for this problem. Only rewrites values
// that would otherwise resolve outside the proxy; a no-op for anything
// already correct (relative paths that stay same-document, proxy URLs, etc).
function resourceInterceptScript(base: URL): string {
  return `<script>(function(){
  var PREFIX = '/api/web-proxy/';
  var UPSTREAM_BASE = ${JSON.stringify(base.href)};
  function needsRewrite(abs) {
    return abs.origin === location.origin && abs.pathname.indexOf(PREFIX) !== 0;
  }
  function toProxy(raw) {
    try {
      var here = new URL(String(raw), location.href);
      if (!needsRewrite(here)) return raw;
      // Resolve the ORIGINAL (possibly relative) value against the real
      // upstream origin, not against our own proxy path.
      var real = new URL(String(raw), UPSTREAM_BASE);
      return PREFIX + encodeURIComponent(real.href);
    } catch (e) { return raw; }
  }
  function patchProp(proto, prop) {
    var desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || !desc.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (value) { desc.set.call(this, toProxy(value)); },
    });
  }
  patchProp(HTMLScriptElement.prototype, 'src');
  patchProp(HTMLImageElement.prototype, 'src');
  patchProp(HTMLLinkElement.prototype, 'href');
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      if (typeof input === 'string') input = toProxy(input);
      return origFetch.call(this, input, init);
    };
  }
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var rest = Array.prototype.slice.call(arguments, 2);
    return origOpen.apply(this, [method, toProxy(url)].concat(rest));
  };
})();</script>`
}

function rewriteHtml(html: string, base: URL): string {
  const toProxy = (orig: string): string => {
    if (!orig || /^(?:javascript:|data:|mailto:|tel:|vbscript:|#)/i.test(orig)) return orig
    let abs: URL
    try {
      abs = new URL(orig, base)
    } catch {
      return orig
    }
    if (!['http:', 'https:'].includes(abs.protocol)) return orig
    // Skipping the proxy would leave the sandbox; keep it inside.
    return toProxyPath(abs)
  }

  for (const [tag, attr] of ATTR_REWRITES) {
    const re = new RegExp(`(<${tag}\\b[^>]*?\\b${attr}=["'])([^"']*?)(["'])`, 'gi')
    html = html.replace(re, (_m, pre: string, val: string, post: string) => pre + toProxy(val) + post)
  }

  // <meta http-equiv="refresh" content="0; url=...">
  html = html.replace(
    /(<meta[^>]*?content=["']\d*;?\s*url=)([^"']+?)(["'])/gi,
    (_m, pre, url, post) => pre + toProxy(url) + post,
  )

  // CSS url(...) references (background images, @import, @font-face) in
  // <style> blocks and style="" attributes — same escape otherwise.
  html = html.replace(/url\((['"]?)([^'")]+)\1\)/gi, (_m, quote: string, val: string) => {
    const trimmed = val.trim()
    return `url(${quote}${toProxy(trimmed)}${quote})`
  })

  // Fallback base: anything we didn't catch above (rare — a handful of
  // sites still construct URLs no rewrite rule above touches) now resolves
  // against the PROXY's own origin rather than the upstream origin, so a
  // stray root-relative path still stays inside the sandbox instead of
  // silently escaping to the real site with none of our header/cookie
  // stripping applied. The intercept script runs immediately after, before
  // any of the page's OWN scripts get a chance to run and create the
  // dynamic elements/requests it needs to catch.
  html = html.replace(
    /<head([^>]*)>/i,
    (_m, attrs) => `<head${attrs}><base href="/">${resourceInterceptScript(base)}`,
  )

  return html
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  // path is the URL-decoded segments Next already split on '/' — rejoin with
  // '/' since the encoded target URL itself may contain further '/'s that
  // encodeURIComponent turned into literal characters, not path separators,
  // so a single decodeURIComponent over the rejoined segments recovers the
  // original target exactly once (matching what toProxyPath encoded).
  const rawTarget = decodeURIComponent(path.join('/'))
  if (!rawTarget) return NextResponse.json({ error: 'Missing target URL' }, { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(rawTarget)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  // A GET <form> (or any link) appends its own query string onto whatever
  // path it submits to — that lands in req.nextUrl.search, not in `path`.
  // Merge it onto the TARGET's query string, which is where it semantically
  // belongs (e.g. a search box's q=... reaching the upstream site), letting
  // any query string already baked into the encoded target URL survive too.
  const incomingSearch = req.nextUrl.search
  if (incomingSearch) {
    const merged = new URLSearchParams(parsed.search)
    for (const [key, value] of new URLSearchParams(incomingSearch)) merged.set(key, value)
    parsed.search = merged.toString()
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return NextResponse.json({ error: 'Only http/https allowed' }, { status: 400 })
  }

  if (await resolvesToPrivateAddress(parsed.hostname)) {
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
    for (const [key, value] of upstream.headers) {
      if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        outHeaders.set(key, value)
      }
    }

    // Allow the page to display in the iframe.
    outHeaders.set('X-Frame-Options', 'ALLOWALL')
    outHeaders.delete('Content-Security-Policy')

    const ctype = upstream.headers.get('content-type') ?? ''
    if (ctype.toLowerCase().includes('text/html') && body.byteLength > 0) {
      const html = new TextDecoder().decode(body)
      return new NextResponse(rewriteHtml(html, parsed), {
        status: upstream.status,
        headers: outHeaders,
      })
    }

    return new NextResponse(body, {
      status: upstream.status,
      headers: outHeaders,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Fetch failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
