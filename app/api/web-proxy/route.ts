import { NextRequest, NextResponse } from 'next/server'

// Back-compat shim for the old ?url=<encoded> scheme this route used before
// moving to the path-based [...path]/route.ts (see that file's header for
// why: GET forms wipe a query-string-based proxy address on submit). Any
// link/bookmark still pointing at ?url= gets redirected to the new address
// instead of 404ing outright.
export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get('url')
  if (!rawUrl) return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
  return NextResponse.redirect(new URL(`/api/web-proxy/${encodeURIComponent(rawUrl)}`, req.url))
}
