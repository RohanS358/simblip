import http from 'node:http'
import https from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'
import { isBlockedAddress, safeLookup } from './calendar-fetch'

// GET a user-supplied URL without being an SSRF gadget.
//
// The web proxy used `fetch(url, { redirect: 'follow' })` after a one-off DNS
// check on the FIRST hostname. Two holes: a public page answering
// `302 Location: http://169.254.169.254/…` was followed straight into the
// cloud metadata service, and the DNS answer checked up front was not the one
// connected to (rebinding). Here every connection resolves through
// `safeLookup` (the address that is checked is the address that is used) and
// redirects are followed by hand, each hop re-validated.

export class GuardedFetchError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

export interface GuardedResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
  /** URL after redirects — relative links in the body resolve against this. */
  url: URL
}

export interface GuardedOptions {
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  headers?: Record<string, string>
}

function once(url: URL, opts: Required<GuardedOptions>): Promise<{ res: GuardedResponse } | { redirect: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.get(
      url,
      { lookup: safeLookup as never, timeout: opts.timeoutMs, headers: opts.headers },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          return resolve({ redirect: res.headers.location })
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > opts.maxBytes) {
            req.destroy(new GuardedFetchError('Response is too large', 413))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({ res: { status, headers: res.headers, body: Buffer.concat(chunks), url } }))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new GuardedFetchError('The site took too long to answer', 504)))
    req.on('error', (err: NodeJS.ErrnoException) =>
      reject(
        err instanceof GuardedFetchError
          ? err
          : err.code === 'EBLOCKED'
            ? new GuardedFetchError('Private addresses not allowed', 403)
            : new GuardedFetchError('Could not reach that site', 502)
      )
    )
  })
}

/** Reject non-http(s), embedded credentials and literal private IPs up front. */
function check(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new GuardedFetchError('Only http/https allowed', 400)
  if (url.username || url.password) throw new GuardedFetchError('Links with credentials are not supported', 400)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost'))
    throw new GuardedFetchError('Private addresses not allowed', 403)
  // A literal IP skips DNS (and so skips safeLookup): judge it here.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isBlockedAddress(host)) throw new GuardedFetchError('Private addresses not allowed', 403)
  }
}

export async function guardedGet(start: URL, options: GuardedOptions = {}): Promise<GuardedResponse> {
  const opts: Required<GuardedOptions> = {
    maxBytes: options.maxBytes ?? 25 * 1024 * 1024,
    timeoutMs: options.timeoutMs ?? 10_000,
    maxRedirects: options.maxRedirects ?? 5,
    headers: options.headers ?? {},
  }
  let url = start
  for (let hop = 0; ; hop++) {
    check(url)
    const r = await once(url, opts)
    if ('res' in r) return r.res
    if (hop >= opts.maxRedirects) throw new GuardedFetchError('Too many redirects', 502)
    try {
      url = new URL(r.redirect, url)
    } catch {
      throw new GuardedFetchError('Bad redirect', 502)
    }
  }
}
