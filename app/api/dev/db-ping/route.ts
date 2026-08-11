import { NextResponse } from 'next/server'
import net from 'node:net'

// One-off diagnostic: raw TCP connect timing to DATABASE_URL's host:port,
// measured from inside a real deployed function — tells us whether the
// cPanel Postgres timeouts are a network-level block (port never opens)
// or something further up the stack (TCP connects fine, pg auth/handshake
// is what's slow). Delete this route once the board-live latency issue
// is resolved; it has no auth and shouldn't linger in production.
export async function GET() {
  const url = process.env.DATABASE_URL
  if (!url) {
    return NextResponse.json({ error: 'DATABASE_URL not set' }, { status: 500 })
  }

  let host: string
  let port: number
  try {
    const parsed = new URL(url)
    host = parsed.hostname
    port = Number(parsed.port) || 5432
  } catch {
    return NextResponse.json({ error: 'Could not parse DATABASE_URL' }, { status: 500 })
  }

  const t0 = Date.now()
  const result = await new Promise<{ ok: boolean; ms: number; error?: string }>((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 8000 })
    socket.on('connect', () => {
      const ms = Date.now() - t0
      socket.destroy()
      resolve({ ok: true, ms })
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ ok: false, ms: Date.now() - t0, error: 'timeout' })
    })
    socket.on('error', (err) => {
      resolve({ ok: false, ms: Date.now() - t0, error: err.message })
    })
  })

  return NextResponse.json({ host, port, ...result })
}
