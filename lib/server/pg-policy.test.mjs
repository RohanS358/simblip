// Regression test for the /api/pg authorization layer.
// The hole it locks shut: tenant scoping alone let any signed-in user PATCH
// their own profile to role 'admin'/'super_admin' and read or edit everyone
// else's rows inside the institution.
//
// Run directly:
//   node --experimental-strip-types lib/server/pg-policy.test.mjs

import assert from 'node:assert/strict'
import { authorize, checkPatch, checkRow, forceRow, hasReadScope, readScope, scopeSql } from './pg-policy.ts'

const allowed = (t, m, role) => authorize(t, m, role).ok
const rule = (t, m, role) => authorize(t, m, role).rule

// ── privilege escalation ────────────────────────────────────────────────────
for (const role of ['student', 'teacher', 'board']) {
  assert.equal(allowed('profiles', 'PATCH', role), false, `${role} must not patch profiles`)
  // POST is an upsert: writing an existing id would rewrite that account's role.
  assert.equal(allowed('profiles', 'POST', role), false, `${role} must not upsert profiles`)
  assert.equal(allowed('profiles', 'DELETE', role), false)
  assert.equal(allowed('institutions', 'POST', role), false)
  assert.equal(allowed('institutions', 'DELETE', role), false)
}
assert.equal(allowed('profiles', 'POST', 'admin'), false, 'accounts are created via /api/admin/provision')
assert.equal(allowed('room_members', 'PATCH', 'admin'), false, 'no member_role edits')
assert.equal(allowed('shares', 'PATCH', 'teacher'), false)
assert.equal(allowed('bug_reports', 'POST', 'student'), true)
assert.equal(allowed('file_manifest', 'PATCH', 'student'), true, 'unlisted tables keep gateway scoping')
// Admin PATCH may only touch benign columns.
const adminProfiles = rule('profiles', 'PATCH', 'admin')
for (const col of ['role', 'institution_id', 'email', 'password_hash', 'id']) {
  assert.match(checkPatch(adminProfiles, { [col]: 'x' }, 'admin') ?? '', /not writable/, `admin patching ${col}`)
}
assert.equal(checkPatch(adminProfiles, { active: false }, 'admin'), null)
assert.match(scopeSql(adminProfiles, { sub: 'u', role: 'admin', inst: 'i' }, []) ?? '', /super_admin/)

// ── writes that need a role ─────────────────────────────────────────────────
assert.equal(allowed('rooms', 'POST', 'student'), false)
assert.equal(allowed('rooms', 'DELETE', 'teacher'), false)
assert.equal(allowed('rooms', 'POST', 'admin'), true)
assert.equal(allowed('assignments', 'POST', 'student'), false)
assert.equal(allowed('announcements', 'POST', 'student'), false)
assert.equal(allowed('shares', 'POST', 'student'), false)
assert.equal(allowed('library_assets', 'POST', 'student'), false)
assert.equal(allowed('bug_reports', 'PATCH', 'admin'), false)

// ── ownership: forced columns and scoped rows ───────────────────────────────
const row = { id: 'a1', teacher_id: 'someone-else' }
assert.deepEqual(forceRow(rule('assignments', 'POST', 'teacher'), row, 'me'), ['teacher_id'])
assert.equal(row.teacher_id, 'me', 'a client cannot author on behalf of another teacher')

const p = []
const sql = scopeSql(rule('assignments', 'DELETE', 'teacher'), { sub: 'me', role: 'teacher', inst: 'i' }, p)
assert.equal(sql, 'teacher_id = $1')
assert.deepEqual(p, ['me'])
assert.equal(scopeSql(rule('assignments', 'DELETE', 'admin'), { sub: 'me', role: 'admin', inst: 'i' }, []), null)

// ── submissions: students cannot grade themselves ───────────────────────────
const studentSub = rule('submissions', 'PATCH', 'student')
assert.match(checkPatch(studentSub, { status: 'reviewed' }, 'student') ?? '', /not allowed/i)
assert.match(checkPatch(studentSub, { feedback: 'A+' }, 'student') ?? '', /not writable/)
assert.equal(checkPatch(studentSub, { status: 'submitted', content: {} }, 'student'), null)
assert.match(scopeSql(studentSub, { sub: 's', role: 'student', inst: 'i' }, []) ?? '', /student_id = \$1/)
assert.equal(checkPatch(rule('submissions', 'PATCH', 'teacher'), { status: 'reviewed', feedback: 'ok' }, 'teacher'), null)

assert.match(checkRow(rule('submissions', 'POST', 'student'), { status: 'reviewed' }) ?? '', /not allowed/i)
assert.match(checkRow(rule('submissions', 'POST', 'student'), { status: 'submitted', feedback: 'A+' }) ?? '', /not allowed/i)
assert.equal(checkRow(rule('submissions', 'POST', 'student'), { status: 'opened', content: null }), null)

// ── library approval is the admin's ─────────────────────────────────────────
assert.match(checkRow(rule('library_assets', 'POST', 'teacher'), { approved: true }) ?? '', /admin/)
assert.equal(checkRow(rule('library_assets', 'POST', 'teacher'), { approved: false }), null)
assert.equal(checkRow(rule('library_assets', 'POST', 'admin'), { approved: true }), null)
assert.match(checkPatch(rule('library_assets', 'PATCH', 'teacher'), { approved: true }, 'teacher') ?? '', /not writable/)
assert.equal(checkPatch(rule('library_assets', 'PATCH', 'admin'), { approved: true }, 'admin'), null)

// ── immutables apply even to tables with no rule ────────────────────────────
assert.match(checkPatch(null, { institution_id: 'other' }, 'student') ?? '', /not writable/)
assert.equal(checkPatch(null, { pending_pull: [] }, 'student'), null)

// ── reads ───────────────────────────────────────────────────────────────────
const rp = []
assert.match(readScope('submissions', { sub: 's', role: 'student', inst: 'i' }, rp) ?? '', /student_id = \$1/)
assert.equal(readScope('submissions', { sub: 't', role: 'teacher', inst: 'i' }, []), null)
assert.equal(hasReadScope('shares', 'student'), true)
assert.equal(hasReadScope('shares', 'admin'), false)
assert.match(readScope('library_assets', { sub: 's', role: 'student', inst: 'i' }, []) ?? '', /approved/)
assert.match(readScope('board_sessions', { sub: 's', role: 'student', inst: 'i' }, []) ?? '', /room_members/)

console.log('pg-policy: all assertions passed')
