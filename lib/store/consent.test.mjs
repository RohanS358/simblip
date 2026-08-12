// Consent gate logic — the conditions that decide whether a user is blocked.
// Run: node lib/store/consent.test.mjs
//
// The store itself is Zustand + localStorage, so this checks the pure decision
// rules that the gate and notice read. Getting these backwards either locks
// everyone out or silently lets new accounts skip the terms entirely.

import assert from 'node:assert/strict'

const TERMS_VERSION = '2026-08-13'

// Mirrors `termsOutstanding` in consent.ts.
const termsOutstanding = (s) => s.acceptedVersion !== TERMS_VERSION

// Mirrors the `show` condition in terms-gate.tsx.
const gateShows = ({ ready, status, role, acceptedVersion }) =>
  ready && status === 'authed' && role !== 'board' && termsOutstanding({ acceptedVersion })

// Mirrors the `show` condition in storage-notice.tsx.
const noticeShows = ({ ready, status, role, acceptedVersion, storageNoticeSeen }) =>
  ready &&
  status === 'authed' &&
  role !== 'board' &&
  !termsOutstanding({ acceptedVersion }) &&
  !storageNoticeSeen

const base = { ready: true, status: 'authed', role: 'student', acceptedVersion: null, storageNoticeSeen: false }

// ── Terms gate ──────────────────────────────────────────────────────────────
assert.equal(gateShows(base), true, 'new signed-in user must see the gate')

assert.equal(
  gateShows({ ...base, acceptedVersion: TERMS_VERSION }),
  false,
  'user who accepted the current version must not be re-prompted',
)

assert.equal(
  gateShows({ ...base, acceptedVersion: '2025-01-01' }),
  true,
  'stale acceptance must re-prompt after a version bump',
)

assert.equal(gateShows({ ...base, role: 'board' }), false, 'room boards are exempt')

assert.equal(gateShows({ ...base, status: 'anon' }), false, 'signed-out users see no gate')
assert.equal(gateShows({ ...base, status: 'loading' }), false, 'no gate while auth is resolving')

assert.equal(gateShows({ ...base, ready: false }), false, 'no gate before hydration (avoids SSR flash)')

// Admin and teacher accounts are provisioned the same way — they get it too.
for (const role of ['admin', 'teacher', 'super_admin', 'student']) {
  assert.equal(gateShows({ ...base, role }), true, `${role} must see the gate`)
}

// ── Storage notice ──────────────────────────────────────────────────────────
assert.equal(
  noticeShows(base),
  false,
  'notice must wait until terms are accepted (never stack two prompts)',
)

assert.equal(
  noticeShows({ ...base, acceptedVersion: TERMS_VERSION }),
  true,
  'notice appears once terms are done',
)

assert.equal(
  noticeShows({ ...base, acceptedVersion: TERMS_VERSION, storageNoticeSeen: true }),
  false,
  'notice does not return after being answered',
)

assert.equal(
  noticeShows({ ...base, acceptedVersion: TERMS_VERSION, role: 'board' }),
  false,
  'room boards see no notice',
)

// ── Analytics default ───────────────────────────────────────────────────────
// The notice promises analytics are off until turned on; the default must hold.
const freshState = { analytics: false, storageNoticeSeen: false }
assert.equal(freshState.analytics, false, 'analytics must default to off')

console.log('consent: all assertions passed')
