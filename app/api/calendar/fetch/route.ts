import { NextResponse } from 'next/server'
import { bearerClaims } from '@/lib/server/auth'
import { FetchError, fetchCalendar } from '@/lib/server/calendar-fetch'

// Fetches a calendar subscription link for Settings → Calendar (browsers
// can't read another site's .ics directly). All SSRF protection lives in
// lib/server/calendar-fetch.ts.

export async function POST(req: Request) {
  if (!bearerClaims(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let raw = ''
  try {
    raw = String(((await req.json()) as { url?: unknown }).url ?? '')
  } catch {
    return NextResponse.json({ error: 'Body must be JSON { url }' }, { status: 400 })
  }
  try {
    const body = await fetchCalendar(raw)
    return new NextResponse(body, {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store' },
    })
  } catch (err) {
    if (err instanceof FetchError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: 'Couldn’t fetch that calendar' }, { status: 502 })
  }
}
