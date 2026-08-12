// Regression test for the /api/pg tenant- and owner-isolation rules.
//
// These guards previously had a hole: scoping was applied only when the
// client had NOT already sent that column, so supplying the filter yourself
// removed the guard and returned another tenant's rows. Any change that makes
// scoping conditional again must fail here.
//
// No test framework in this project — run it directly:
//   node app/api/pg/scoping.test.mjs
//
// The decision logic is mirrored (not imported): route.ts is a Next server
// module that pulls in pg/redis. Keep in sync with buildWhere/buildTail.

import assert from 'node:assert/strict'

const TABLES = {
  institutions: { pk: ['id'] },
  profiles: { pk: ['id'] },
  rooms: { pk: ['id'] },
  room_members: { pk: ['room_id', 'profile_id'] },
  workspaces: { pk: ['id'], owner: 'id' },
  pages: { pk: ['id'], owner: 'workspace_id' },
  submissions: { pk: ['id'] },
  library_favorites: { pk: ['asset_id', 'profile_id'] },
  sketch_templates: { pk: ['id'], anon: ['GET', 'POST'] },
  file_manifest: { pk: ['id'], owner: 'owner_id' },
  devices: { pk: ['id'], owner: 'owner_id' },
}

const TENANT_COLUMN = new Set(
  Object.keys(TABLES).filter(
    (t) => !['institutions', 'sketch_templates', 'room_members', 'library_favorites'].includes(t)
  )
)

const isOperator = (c) => c?.role === 'super_admin'

function buildWhere(table, queryString, claims) {
  const url = new URL('http://x/?' + queryString)
  const parts = []
  const scopedCol =
    table === 'institutions' ? 'id' : TENANT_COLUMN.has(table) ? 'institution_id' : null

  for (const [k, v] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue
    if (k === 'password_hash') throw new Error('Forbidden column')
    if (
      claims &&
      !isOperator(claims) &&
      claims.inst &&
      k === scopedCol &&
      v.startsWith('eq.') &&
      v.slice(3) !== claims.inst
    ) {
      throw new Error('Cross-tenant filter rejected')
    }
    if (v.startsWith('eq.')) parts.push(`${k} = '${v.slice(3)}'`)
  }

  const spec = TABLES[table]
  if (claims && !isOperator(claims)) {
    if (table === 'institutions') {
      if (claims.inst) parts.push(`id = '${claims.inst}'`)
    } else if (TENANT_COLUMN.has(table)) {
      if (claims.inst) parts.push(`institution_id = '${claims.inst}'`)
    }
    if (spec.owner && claims.role !== 'board') parts.push(`${spec.owner} = '${claims.sub}'`)
  }
  return parts.length ? ' where ' + parts.join(' and ') : ''
}

const me = { sub: 'user-me', role: 'teacher', inst: 'inst-MINE' }
const threw = (fn) => {
  try {
    fn()
    return null
  } catch (e) {
    return e.message
  }
}

// ── the breach: a client filter must never REPLACE the scope ────────────────
for (const table of ['pages', 'profiles', 'submissions', 'rooms', 'workspaces']) {
  assert.equal(
    threw(() => buildWhere(table, 'institution_id=eq.inst-VICTIM', me)),
    'Cross-tenant filter rejected',
    `${table}: foreign institution_id must be rejected`
  )
}

// Owner scoping likewise survives a client-supplied owner column: the result
// is contradictory (both values required), so no foreign row can match.
{
  const clause = buildWhere('pages', 'workspace_id=eq.someone-elses', me)
  assert.ok(clause.includes("workspace_id = 'user-me'"), 'own-owner predicate still applied')
  assert.ok(clause.includes("institution_id = 'inst-MINE'"), 'tenant predicate still applied')
}

// ── legitimate traffic is unaffected ────────────────────────────────────────
for (const qs of ['select=*', 'institution_id=eq.inst-MINE', 'id=eq.my-page']) {
  const clause = buildWhere('pages', qs, me)
  assert.ok(clause.includes("institution_id = 'inst-MINE'"), `${qs}: tenant scope present`)
  assert.ok(clause.includes("workspace_id = 'user-me'"), `${qs}: owner scope present`)
}

// A scoped query is NEVER unfiltered for an ordinary user.
assert.notEqual(buildWhere('pages', 'select=*', me), '', 'never an unscoped read')

// ── roles ───────────────────────────────────────────────────────────────────
// The operator is deliberately unscoped; the DB re-read in resolve() is what
// makes trusting this role safe.
assert.equal(
  buildWhere('pages', 'institution_id=eq.inst-ANY', { sub: 'op', role: 'super_admin', inst: null }),
  " where institution_id = 'inst-ANY'",
  'operator may cross tenants'
)
// A board is a shared kiosk: tenant-scoped, but not owner-scoped.
{
  const clause = buildWhere('pages', 'select=*', { sub: 'b', role: 'board', inst: 'inst-MINE' })
  assert.ok(clause.includes("institution_id = 'inst-MINE'"), 'board is tenant-scoped')
  assert.ok(!clause.includes('workspace_id'), 'board skips owner scoping by design')
}

// ── forbidden column ────────────────────────────────────────────────────────
assert.equal(
  threw(() => buildWhere('profiles', 'password_hash=eq.x', me)),
  'Forbidden column',
  'password_hash can never be filtered on'
)

// ── pagination ceiling ──────────────────────────────────────────────────────
const MAX_ROWS = 2000
const MAX_EXPLICIT_LIMIT = 5000
function limitOf(queryString) {
  const raw = new URL('http://x/?' + queryString).searchParams.get('limit')
  const n = raw !== null ? Math.floor(Number(raw)) : NaN
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_EXPLICIT_LIMIT) : MAX_ROWS
}
assert.equal(limitOf('select=*'), MAX_ROWS, 'unbounded read gets a ceiling')
assert.equal(limitOf('limit=50'), 50, 'explicit limit honoured')
assert.equal(limitOf('limit=999999'), MAX_EXPLICIT_LIMIT, 'explicit limit is capped')
assert.equal(limitOf('limit=-5'), MAX_ROWS, 'negative limit falls back')
assert.equal(limitOf('limit=abc'), MAX_ROWS, 'junk limit falls back')

console.log('pg scoping: all checks passed')
