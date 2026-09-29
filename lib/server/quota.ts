// Server-side enforcement of the per-project cloud quota (lib/storage/quota.ts).
//
// Every write that adds bytes to an account's cloud footprint runs inside a
// transaction that first takes a per-owner advisory lock. That serialises
// concurrent writers for ONE account (two tabs, two devices, a burst of
// parallel uploads) so "read usage, check, write" can't interleave and let
// two uploads that each fit individually overshoot together. Different
// accounts never wait on each other.
//
// Usage is summed from server-computed `size_bytes` columns — never from a
// size the client reported.

import type { q } from '@/lib/server/pg'
import { PROJECT_QUOTA_BYTES, quotaDecision } from '@/lib/storage/quota'

type Query = typeof q

export class QuotaExceededError extends Error {
  used: number
  requested: number
  limit: number
  constructor(used: number, requested: number, limit = PROJECT_QUOTA_BYTES) {
    super(`Cloud storage full: ${used} of ${limit} bytes used, this change needs ${requested} more`)
    this.used = used
    this.requested = requested
    this.limit = limit
  }
  body() {
    return { error: 'quota_exceeded', used: this.used, requested: this.requested, limit: this.limit }
  }
}

/** Serialise quota-affecting writes for one owner until the transaction ends. */
export async function lockOwner(query: Query, ownerId: string): Promise<void> {
  // hashtext() (int4) rather than hashtextextended(): the latter is PG 11+
  // and missing on some hosted/compatible Postgres. A 32-bit key can collide
  // between two owners — harmless, they just briefly serialise each other.
  // Bounded wait: a push queued behind another one for the same account
  // holds a pooled connection while it waits, so an unbounded wait could
  // starve the (small) pool. 5 s and the client simply retries.
  await query("set local lock_timeout = '5s'")
  await query('select pg_advisory_xact_lock(hashtext($1::text))', [ownerId])
}

export interface UsageBreakdown {
  tree: number
  pages: number
  account: number
  files: number
  total: number
}

export async function usageOf(query: Query, ownerId: string): Promise<UsageBreakdown> {
  const [row] = await query<{ tree: string; pages: string; account: string; files: string }>(
    `select
       coalesce((select size_bytes from simblip_workspaces where id = $1), 0) as tree,
       coalesce((select sum(size_bytes) from simblip_pages where workspace_id = $1), 0) as pages,
       coalesce((select sum(size_bytes) from simblip_user_kv where owner_id = $1), 0) as account,
       coalesce((select sum(b.size_bytes) from simblip_file_blobs b
                   join simblip_file_manifest m on m.id = b.id
                  where m.owner_id = $1), 0) as files`,
    [ownerId]
  )
  const tree = Number(row?.tree ?? 0)
  const pages = Number(row?.pages ?? 0)
  const account = Number(row?.account ?? 0)
  const files = Number(row?.files ?? 0)
  return { tree, pages, account, files, total: tree + pages + account + files }
}

/** Throw QuotaExceededError unless adding `delta` bytes fits. Call with the
 *  owner lock held (lockOwner) so `used` can't go stale before the write. */
export async function assertFits(query: Query, ownerId: string, delta: number): Promise<number> {
  const used = (await usageOf(query, ownerId)).total
  const d = quotaDecision(used, delta)
  if (!d.ok) throw new QuotaExceededError(used, delta)
  return d.after
}
