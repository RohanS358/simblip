import { NextResponse } from 'next/server'
import net from 'node:net'
import { Client } from 'pg'
import { bearerClaims } from '@/lib/server/auth'
import { q } from '@/lib/server/pg'

// One-off diagnostic: raw TCP connect timing to DATABASE_URL's host:port,
// PLUS an actual pg client login attempt — measured from inside a real
// deployed function. Raw TCP tells us if the network path is open; the pg
// login tells us Postgres's own rejection reason (pg_hba.conf entry
// missing, SSL required, auth failure, etc.) instead of a generic timeout.
// SECURITY: this used to be unauthenticated, handing anyone the database host,
// port and Postgres's raw login error. It now requires an active platform
// operator (re-read from the database, like every other operator route).
export async function GET(req: Request) {
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [caller] = process.env.DATABASE_URL
    ? await q<{ role: string; active: boolean }>(
        'select role, active from simblip_profiles where id = $1',
        [claims.sub]
      ).catch(() => [])
    : []
  if (!caller?.active || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 })
  }
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

  const t1 = Date.now()
  const login = await (async () => {
    const client = new Client({
      connectionString: url,
      connectionTimeoutMillis: 8000,
      ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
    })
    try {
      await client.connect()
      await client.query('select 1')
      await client.end()
      return { ok: true, ms: Date.now() - t1 }
    } catch (err) {
      return { ok: false, ms: Date.now() - t1, error: err instanceof Error ? err.message : String(err) }
    }
  })()

  return NextResponse.json({ host, port, tcp: result, pgLogin: login })
}
