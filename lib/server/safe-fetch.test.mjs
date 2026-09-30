// SSRF guard for the web proxy (lib/server/safe-fetch.ts).
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs lib/server/safe-fetch.test.mjs
// Note: redirect-hop validation needs a public host that redirects to a
// private one, which a hermetic test cannot stand up; the per-hop check is the
// same `check()` + `safeLookup` exercised below on the first hop.

import assert from 'node:assert/strict'
import test from 'node:test'
import { GuardedFetchError, guardedGet } from './safe-fetch.ts'

const refused = (url, status) =>
  assert.rejects(guardedGet(new URL(url)), (e) => e instanceof GuardedFetchError && e.status === status, url)

test('non-http schemes and credentials are refused', async () => {
  await refused('file:///etc/passwd', 400)
  await refused('ftp://example.com/x', 400)
  await refused('http://user:pw@example.com/', 400)
})

test('loopback, private, metadata and IPv6 literals are refused', async () => {
  for (const u of [
    'http://localhost/', 'http://foo.localhost/', 'http://127.0.0.1:8080/', 'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.1/', 'http://[::1]/', 'http://[fd00::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0x7f000001/',
  ]) await refused(u, 403)
})
