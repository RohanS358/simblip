// Per-table, per-role access policy for the /api/pg gateway.
//
// The gateway used to enforce TENANT isolation only (institution_id) plus
// owner scoping on a few tables. Inside one institution every signed-in user
// could therefore PATCH or DELETE any row of any tenant table, including
// `profiles`: a student could `PATCH /api/pg/profiles?id=eq.<self>` with
// `{"role":"admin"}` (or `super_admin`, which bypasses tenant scoping
// entirely) and become an operator, because privileged claims are re-read
// from that very row. This module is the missing authorization layer.
//
// Pure functions, no imports, so it is unit-tested without a database
// (lib/server/pg-policy.test.mjs). The gateway calls it before touching SQL.
//
// `super_admin` (the platform operator, used by /dev) bypasses this module.

export type Method = 'POST' | 'PATCH' | 'DELETE'

export interface PolicyClaims {
  sub: string
  role: string
  inst: string | null
}

interface Rule {
  /** Roles allowed to perform this method. */
  roles: string[]
  /** PATCH: only these columns may be written. */
  cols?: string[]
  /** PATCH: these columns may never be written. */
  denyCols?: string[]
  /** PATCH: columns only these roles may write (e.g. `approved`). */
  roleCols?: Record<string, string[]>
  /** POST: column forced to the caller's id (also guards upsert takeover). */
  force?: string
  /** Extra SQL narrowing the rows a PATCH/DELETE can touch; `{sub}` is the
   *  caller's id. Skipped for roles in `exempt`. */
  scope?: string
  exempt?: string[]
  /** PATCH value check; return an error string to reject. */
  check?: (patch: Record<string, unknown>) => string | null
  /** POST value check on each row; return an error string to reject. */
  checkRow?: (row: Record<string, unknown>) => string | null
}

const ADMIN = ['admin']
const STAFF = ['admin', 'teacher']
const ALL = ['admin', 'teacher', 'student', 'board']

/** Never client-writable on any table. */
const IMMUTABLE = ['id', 'institution_id', 'password_hash']

// Student-writable submission statuses. `reviewed` is the teacher's.
const STUDENT_STATUSES = new Set(['opened', 'in_progress', 'submitted', 'late'])

const POLICY: Record<string, Partial<Record<Method, Rule | Rule[]>>> = {
  institutions: {
    PATCH: { roles: ADMIN, cols: ['name', 'logo_url', 'accent_color', 'settings'] },
  },
  profiles: {
    // Accounts are created through /api/admin/provision (it hashes the
    // password). Role, email and tenant are never editable from here.
    PATCH: {
      roles: ADMIN,
      cols: ['active', 'full_name', 'department'],
      scope: "role <> 'super_admin'",
    },
  },
  rooms: {
    POST: { roles: ADMIN },
    PATCH: { roles: ADMIN, cols: ['name', 'department'] },
    DELETE: { roles: ADMIN },
  },
  room_members: {
    POST: { roles: ADMIN },
    DELETE: { roles: ADMIN },
  },
  boards: {
    POST: { roles: ADMIN },
    PATCH: { roles: [...ADMIN, 'teacher', 'board'], cols: ['pairing_code', 'pairing_rotated_at'] },
    DELETE: { roles: ADMIN },
  },
  board_sessions: {
    POST: { roles: STAFF, force: 'teacher_id' },
    PATCH: {
      roles: [...STAFF, 'board'],
      cols: ['edited', 'status', 'ended_at', 'remote'],
      scope:
        '(teacher_id = {sub} or board_id in (select id from simblip_boards where profile_id = {sub}))',
      exempt: ADMIN,
    },
    DELETE: { roles: ADMIN },
  },
  shares: {
    POST: { roles: STAFF, force: 'sender_id' },
    DELETE: {
      roles: ALL,
      scope: '(sender_id = {sub} or target_profile_id = {sub})',
      exempt: ADMIN,
    },
  },
  library_assets: {
    POST: [
      { roles: ADMIN, force: 'uploader_id' },
      // A teacher's upload waits for admin approval; it cannot arrive approved.
      {
        roles: ['teacher'],
        force: 'uploader_id',
        checkRow: (r) => (r.approved === true ? 'Approval is the admin’s' : null),
      },
    ],
    PATCH: {
      roles: STAFF,
      denyCols: ['uploader_id', 'approved'],
      roleCols: { admin: ['approved'] },
      scope: 'uploader_id = {sub}',
      exempt: ADMIN,
    },
    DELETE: { roles: STAFF, scope: 'uploader_id = {sub}', exempt: ADMIN },
  },
  library_favorites: {
    POST: { roles: ALL, force: 'profile_id' },
    DELETE: { roles: ALL, scope: 'profile_id = {sub}' },
  },
  assignments: {
    POST: { roles: STAFF, force: 'teacher_id' },
    PATCH: { roles: STAFF, denyCols: ['teacher_id'], scope: 'teacher_id = {sub}', exempt: ADMIN },
    DELETE: { roles: STAFF, scope: 'teacher_id = {sub}', exempt: ADMIN },
  },
  submissions: {
    POST: {
      roles: ['student'],
      force: 'student_id',
      // A student cannot file a submission that is already graded.
      checkRow: (r) =>
        ('status' in r && !STUDENT_STATUSES.has(String(r.status))) || 'feedback' in r || 'reviewed_at' in r
          ? 'Status not allowed'
          : null,
    },
    PATCH: [
      {
        roles: ['student'],
        cols: ['status', 'content', 'submitted_at', 'updated_at'],
        scope: 'student_id = {sub}',
        check: (p) =>
          'status' in p && !STUDENT_STATUSES.has(String(p.status)) ? 'Status not allowed' : null,
      },
      {
        roles: STAFF,
        cols: ['status', 'feedback', 'reviewed_at'],
        scope: 'assignment_id in (select id from simblip_assignments where teacher_id = {sub})',
        exempt: ADMIN,
      },
    ],
    DELETE: { roles: ADMIN },
  },
  announcements: {
    POST: { roles: STAFF, force: 'author_id' },
    PATCH: { roles: STAFF, denyCols: ['author_id'], scope: 'author_id = {sub}', exempt: ADMIN },
    DELETE: { roles: STAFF, scope: 'author_id = {sub}', exempt: ADMIN },
  },
  // Reporters file and read their own; triage is the operator's.
  bug_reports: {
    POST: { roles: ALL },
    PATCH: { roles: [] },
    DELETE: { roles: [] },
  },
}

export type Verdict =
  | { ok: false; status: number; error: string }
  | { ok: true; rule: Rule | null }

/** Pick the rule for this role; null means the table has no extra policy. */
export function authorize(table: string, method: Method, role: string): Verdict {
  const policy = POLICY[table]
  // Tables without a policy keep their gateway scoping (owner/tenant) as-is.
  if (!policy) return { ok: true, rule: null }
  // A table WITH a policy is default-deny: a method it doesn't list (POST on
  // profiles, PATCH on shares…) is refused rather than silently open.
  const entry = policy[method]
  if (!entry) return { ok: false, status: 403, error: 'Not permitted' }
  const rules = Array.isArray(entry) ? entry : [entry]
  const rule = rules.find((r) => r.roles.includes(role))
  if (!rule) return { ok: false, status: 403, error: 'Not permitted' }
  return { ok: true, rule }
}

/** Validate a PATCH body against the rule. Returns an error message or null. */
export function checkPatch(
  rule: Rule | null,
  patch: Record<string, unknown>,
  role: string
): string | null {
  for (const k of Object.keys(patch)) {
    if (IMMUTABLE.includes(k)) return `Column not writable: ${k}`
  }
  if (!rule) return null
  for (const k of Object.keys(patch)) {
    if (rule.cols && !rule.cols.includes(k)) return `Column not writable: ${k}`
    if (rule.denyCols?.includes(k)) {
      if (!rule.roleCols?.[role]?.includes(k)) return `Column not writable: ${k}`
    }
  }
  return rule.check?.(patch) ?? null
}

/** Validate a POST row against the rule. Returns an error message or null. */
export function checkRow(rule: Rule | null, row: Record<string, unknown>): string | null {
  return rule?.checkRow?.(row) ?? null
}

/** Force ownership columns on a POST row; returns the guarded columns. */
export function forceRow(rule: Rule | null, row: Record<string, unknown>, sub: string): string[] {
  if (!rule?.force) return []
  row[rule.force] = sub
  return [rule.force]
}

/** SQL fragment narrowing a PATCH/DELETE to rows the caller may touch. */
export function scopeSql(
  rule: Rule | null,
  claims: PolicyClaims,
  params: unknown[]
): string | null {
  if (!rule?.scope || rule.exempt?.includes(claims.role)) return null
  params.push(claims.sub)
  return rule.scope.replaceAll('{sub}', `$${params.length}`)
}

// ── Reads ───────────────────────────────────────────────────────────────────
// Tenant scoping alone let any student read every classmate's submission and
// every share/session in the institution.

const READ_SCOPES: Record<string, (role: string) => string | null> = {
  submissions: (role) => (role === 'student' ? 'student_id = {sub}' : null),
  library_assets: (role) => (role === 'student' ? 'approved = true' : null),
  shares: (role) =>
    role === 'admin'
      ? null
      : '(sender_id = {sub} or target_profile_id = {sub} or target_room_id in ' +
        '(select room_id from simblip_room_members where profile_id = {sub}))',
  board_sessions: (role) =>
    role === 'admin'
      ? null
      : '(teacher_id = {sub} or board_id in (select id from simblip_boards where profile_id = {sub} ' +
        'or room_id in (select room_id from simblip_room_members where profile_id = {sub})))',
}

/** Row filter for a read, or null when this caller sees the whole tenant.
 *  A non-null result also means the response is per-caller: never serve it
 *  from, or store it in, the tenant-shared cache. */
export function readScope(table: string, claims: PolicyClaims, params: unknown[]): string | null {
  const s = READ_SCOPES[table]?.(claims.role)
  if (!s) return null
  params.push(claims.sub)
  return s.replaceAll('{sub}', `$${params.length}`)
}

export const hasReadScope = (table: string, role: string): boolean =>
  Boolean(READ_SCOPES[table]?.(role))
