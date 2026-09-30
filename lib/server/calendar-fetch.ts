import { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

// Server-side fetch of a calendar subscription link, used by
// app/api/calendar/fetch/route.ts. Fetches a calendar subscription link (Google "secret address in iCal
// format", Outlook "Publish calendar", webcal://…) on the user's behalf —
// browsers can't read another site's .ics directly (CORS).
//
// A server that fetches user-supplied URLs is an SSRF risk, so:
//   • signed-in users only;
//   • http/https/webcal only, ports 80/443 only;
//   • EVERY connection's DNS answer is checked (custom `lookup`), not just the
//     hostname up front — so a hostname that re-resolves to 127.0.0.1 or
//     169.254.169.254 between check and connect (DNS rebinding) is refused;
//   • redirects are followed by hand (max 3), each hop re-validated;
//   • 10 s timeout, 5 MB cap, and the body must look like iCalendar.
// The URL itself is never logged: these links are bearer secrets.

export class FetchError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

/** Private, loopback, link-local, CGNAT, multicast, reserved — never fetched. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (net.isIPv6(ip)) {
    const groups = expandIPv6(ip)
    if (!groups) return true
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
    // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64
    // (64:ff9b::/96) and 6to4 (2002::/16) all smuggle an IPv4 address. The URL
    // parser rewrites the dotted form into hex (::ffff:7f00:1), so judge the
    // embedded address rather than pattern-matching the text.
    const zeros5 = groups.slice(0, 5).every((g) => g === 0)
    if (zeros5 && (groups[5] === 0xffff || groups[5] === 0)) return isBlockedAddress(v4(groups[6], groups[7]))
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0))
      return isBlockedAddress(v4(groups[6], groups[7]))
    if (groups[0] === 0x2002) return isBlockedAddress(v4(groups[1], groups[2]))
    const v = ip.toLowerCase()
    return (
      groups.every((g) => g === 0) || // ::
      (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) || // ::1
      v.startsWith('fc') ||
      v.startsWith('fd') ||
      v.startsWith('fe8') ||
      v.startsWith('fe9') ||
      v.startsWith('fea') ||
      v.startsWith('feb') ||
      v.startsWith('ff')
    )
  }
  return true
}

/** Eight 16-bit groups of an IPv6 literal, or null if it doesn't parse. */
function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number)
    s = s.slice(0, dotted.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = 8 - head.length - tail.length
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null
  const all = [...head, ...(halves.length === 2 ? Array(fill).fill('0') : []), ...tail]
  const nums = all.map((g) => parseInt(g, 16))
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null
}

export function safeLookup(
  hostname: string,
  options: object,
  cb: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void
) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, '')
    const list = addresses as { address: string; family: number }[]
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return cb(Object.assign(new Error('Blocked address'), { code: 'EBLOCKED' }), '')
    }
    if ((options as { all?: boolean }).all) cb(null, list)
    else cb(null, list[0].address, list[0].family)
  })
}

export function normaliseUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'))
  } catch {
    throw new FetchError('That doesn’t look like a link')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchError('Only http(s) and webcal links work')
  if (url.username || url.password) throw new FetchError('Links with a username/password aren’t supported')
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (port !== 80 && port !== 443) throw new FetchError('Only standard ports (80/443) are allowed')
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new FetchError('That address isn’t allowed')
  }
  return url
}

function getOnce(url: URL): Promise<{ status: number; location?: string; body?: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.get(
      url,
      {
        lookup: safeLookup as never,
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': 'SIMBLIP-Calendar/1.0', Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return resolve({ status, location: res.headers.location })
        }
        if (status !== 200) {
          res.resume()
          return reject(new FetchError(`The calendar server answered ${status}`, 502))
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BYTES) {
            req.destroy(new FetchError('Calendar is larger than 5 MB', 413))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new FetchError('The calendar server took too long', 504)))
    req.on('error', (err: NodeJS.ErrnoException) =>
      reject(
        err instanceof FetchError
          ? err
          : err.code === 'EBLOCKED'
            ? new FetchError('That address isn’t allowed')
            : new FetchError('Couldn’t reach that calendar', 502)
      )
    )
  })
}


/** Fetch and validate an .ics link. Throws FetchError with a user-facing
 *  message and an HTTP status on any refusal or failure. */
export async function fetchCalendar(raw: string): Promise<string> {
  let url = normaliseUrl(raw)
  for (let hop = 0; ; hop++) {
    const r = await getOnce(url)
    if (r.location) {
      if (hop >= MAX_REDIRECTS) throw new FetchError('Too many redirects', 502)
      url = normaliseUrl(new URL(r.location, url).toString())
      continue
    }
    const body = r.body ?? ''
    if (!/BEGIN:VCALENDAR/i.test(body.slice(0, 2048))) {
      throw new FetchError('That link didn’t return a calendar (.ics)', 422)
    }
    return body
  }
}
