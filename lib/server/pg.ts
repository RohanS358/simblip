// Server-side Postgres access. One pool per process, configured with
// DATABASE_URL (any hosted/self-hosted Postgres — no Supabase involved).

import { Pool } from 'pg'

let pool: Pool | null = null

export const pgConfigured = Boolean(process.env.DATABASE_URL)

/**
 * SCALING: this pool is per-INSTANCE, and Vercel runs many warm instances
 * concurrently — so the real connection count is `max × instances`, not
 * `max`. At max:5, twenty warm instances exhaust a typical 100-connection
 * Postgres and new requests fail outright rather than queueing.
 *
 * Fluid Compute reuses one instance across concurrent requests, so a small
 * max still serves real traffic: requests queue briefly in-process instead
 * of opening more sockets. Overridable for deployments that front Postgres
 * with a pooler (PgBouncer/pgcat), where a larger max is safe and better.
 *
 * The durable fix past a few thousand users is a pooler — this only makes
 * the ceiling much harder to hit in the meantime.
 */
const POOL_MAX = Number(process.env.PG_POOL_MAX ?? 3)

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number.isFinite(POOL_MAX) && POOL_MAX > 0 ? POOL_MAX : 3,
      // Release sockets quickly: an idle instance holding connections is the
      // main way a serverless fleet starves the database.
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
      // Without a cap a single stuck query can pin a connection for the life
      // of the instance. Vercel's own function ceiling is far higher, so this
      // fails the query rather than leaking the connection.
      statement_timeout: 15000,
      query_timeout: 15000,
      ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
    })
    // A pool that emits 'error' with no listener crashes the process — an
    // idle client dropped by the server (restart, failover, idle reaper) is
    // routine and must not take the instance down with it.
    pool.on('error', (err) => console.error('[pg] idle client error:', err.message))
  }
  return pool
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(text, params)
  return res.rows as T[]
}

/** Guard for every identifier interpolated into SQL. */
export const ident = (name: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Bad identifier: ${name}`)
  return name
}

// jsonb columns per table (without the simblip_ prefix). Values for these are
// stringified and cast, so JS arrays inside documents don't get mangled into
// Postgres arrays by the driver.
const JSONB: Record<string, string[]> = {
  institutions: ['settings'],
  workspaces: ['notebooks'],
  pages: ['content', 'viewport'],
  board_sessions: ['snapshot', 'edited', 'remote'],
  shares: ['content'],
  library_assets: ['content'],
  assignments: ['content'],
  submissions: ['content'],
  sketch_templates: ['cloud', 'strokes'],
  devices: ['pending_pull'],
}

export const isJsonb = (table: string, col: string) => JSONB[table]?.includes(col) ?? false

export const encodeValue = (table: string, col: string, v: unknown): unknown =>
  isJsonb(table, col) && v !== null && v !== undefined ? JSON.stringify(v) : v

export const castFor = (table: string, col: string) => (isJsonb(table, col) ? '::jsonb' : '')

/** Insert one row; keys are whitelisted identifiers, jsonb-aware. */
export async function insertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row).map(ident)
  const params = cols.map((c) => encodeValue(table, c, row[c]))
  const placeholders = cols.map((c, i) => `$${i + 1}${castFor(table, c)}`)
  await q(
    `insert into simblip_${ident(table)} (${cols.join(', ')}) values (${placeholders.join(', ')})`,
    params
  )
}
