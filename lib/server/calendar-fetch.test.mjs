// SSRF guards for calendar subscription links (lib/server/calendar-fetch.ts).
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs lib/server/calendar-fetch.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchCalendar, isBlockedAddress, normaliseUrl } from './calendar-fetch.ts'

test('private, loopback, link-local and metadata addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
    assert.equal(isBlockedAddress(ip), true, ip)
  for (const ip of ['8.8.8.8', '142.250.72.14', '2606:4700::1111']) assert.equal(isBlockedAddress(ip), false, ip)
})

test('url rules: webcal→https, schemes, ports, credentials, literal IPs', () => {
  assert.equal(normaliseUrl('webcal://example.com/a.ics').protocol, 'https:')
  assert.throws(() => normaliseUrl('file:///etc/passwd'), /Only http/)
  assert.throws(() => normaliseUrl('ftp://x.com/a'), /Only http/)
  assert.throws(() => normaliseUrl('https://x.com:8443/a'), /standard ports/)
  assert.throws(() => normaliseUrl('https://u:p@x.com/a'), /username/)
  assert.throws(() => normaliseUrl('http://127.0.0.1/a.ics'), /isn’t allowed/)
  assert.throws(() => normaliseUrl('http://[::1]/a.ics'), /isn’t allowed/)
  assert.throws(() => normaliseUrl('not a url'), /doesn’t look like a link/)
})

test('a hostname resolving to loopback is refused at connect time (rebinding-safe)', async () => {
  // localhost resolves to 127.0.0.1/::1 — the custom lookup must refuse it
  // even though the URL's hostname isn't a literal IP. Refused before any
  // connection, so no server is needed.
  await assert.rejects(fetchCalendar('http://localhost/cal.ics'), /isn’t allowed/)
})

test('IPv4 hidden inside IPv6 is judged by the embedded address', () => {
  // new URL('http://[::ffff:127.0.0.1]/').hostname === '[::ffff:7f00:1]'
  for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:c0a8:101', '64:ff9b::7f00:1', '2002:7f00:1::', '::127.0.0.1', '0:0:0:0:0:0:0:1'])
    assert.equal(isBlockedAddress(ip), true, ip)
  for (const ip of ['::ffff:808:808', '64:ff9b::808:808', '2002:808:808::']) assert.equal(isBlockedAddress(ip), false, ip)
})
