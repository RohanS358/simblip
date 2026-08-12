import { NextResponse } from 'next/server'
import { bearerClaims } from '@/lib/server/auth'
import { getRedisPub } from '@/lib/server/redis'
import type { DeviceRow } from '@/lib/sync/devices'

// Device presence, backed by Redis TTL keys instead of a Postgres table —
// presence is inherently ephemeral (a device is "online" or it isn't, no
// history needed), so a key that just expires is simpler and cheaper than
// writing a heartbeat row every 15s and filtering by timestamp on read.
//
//   set:   devices:{ownerId}                 -> Set of device ids (index)
//   key:   device:{ownerId}:{deviceId}        -> "<label>\t<last_seen_at ISO>", TTL 180s
//
// The index Set has no TTL of its own — stale ids (past their key's TTL)
// are pruned lazily on read via SMEMBERS + MGET + filtering out misses,
// rather than reaching for KEYS/SCAN in a request path.
//
// One client per warm instance (lib/server/redis.ts) — this route reuses
// the same shared publisher connection board-live already holds open, no
// extra Redis connection.

const TTL_SECONDS = 180

export async function POST(req: Request) {
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { id: string; label: string; last_seen_at: string }
  if (!body?.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const redis = getRedisPub()
  await Promise.all([
    redis.set(`device:${claims.sub}:${body.id}`, `${body.label}\t${body.last_seen_at}`, 'EX', TTL_SECONDS),
    redis.sadd(`devices:${claims.sub}`, body.id),
  ])
  return new NextResponse(null, { status: 204 })
}

export async function GET(req: Request) {
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // SECURITY: always the caller's own id. This used to honour a client
  // ?owner_id=, which let any authenticated user enumerate anyone else's
  // devices (labels + last-seen times). The param is still accepted so
  // existing callers don't break, but only when it matches the caller.
  const requested = new URL(req.url).searchParams.get('owner_id')
  if (requested && requested !== claims.sub) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const ownerId = claims.sub
  const redis = getRedisPub()
  const ids = await redis.smembers(`devices:${ownerId}`)
  if (ids.length === 0) return NextResponse.json([] satisfies DeviceRow[])

  const values = await redis.mget(...ids.map((id) => `device:${ownerId}:${id}`))
  const stale: string[] = []
  const rows: DeviceRow[] = ids.flatMap((id, i) => {
    const raw = values[i]
    if (!raw) {
      stale.push(id)
      return []
    }
    const [label, last_seen_at] = raw.split('\t')
    return [{ id, owner_id: ownerId, label, last_seen_at }]
  })
  if (stale.length > 0) void redis.srem(`devices:${ownerId}`, ...stale)
  return NextResponse.json(rows)
}
