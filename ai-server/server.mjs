// SIMBLIP AI server — runs on the GPU machine, separate from the web app.
//
//   AI_SERVER_KEY=... node ai-server/server.mjs
//
// Speaks Ollama's HTTP API (/api/chat, /api/tags), so the app needs only
//   OLLAMA_HOST=https://<this machine>   OLLAMA_API_KEY=<AI_SERVER_KEY>
// and the existing generate → lint → repair pipeline works unchanged.
//
// What it adds in front of Ollama (a single GPU must not be a free-for-all):
//   · bearer auth (constant-time)       · per-client rate limit
//   · FIFO queue, bounded depth         · model aliases per lane (models.json)
//   · client disconnect cancels the GPU job
//   · one JSON log line per request — latency and token counts, never content
// No dependencies: node:http only.

import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export function loadConfig(env = process.env) {
  const file = env.AI_SERVER_MODELS ?? join(here, 'models.json')
  const aliases = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
  return {
    port: Number(env.AI_SERVER_PORT ?? 8787),
    host: env.AI_SERVER_HOST ?? '127.0.0.1', // put a tunnel (Tailscale / cloudflared) in front; do not bind 0.0.0.0 bare
    key: env.AI_SERVER_KEY ?? '',
    upstream: env.OLLAMA_UPSTREAM ?? 'http://127.0.0.1:11434',
    concurrency: Number(env.AI_SERVER_CONCURRENCY ?? 1), // one 8 GB GPU: 1 keeps latency predictable
    maxQueue: Number(env.AI_SERVER_MAX_QUEUE ?? 8),
    ratePerMin: Number(env.AI_SERVER_RATE_PER_MIN ?? 60),
    keepAlive: env.AI_SERVER_KEEP_ALIVE ?? '30m',
    tts: env.AI_SERVER_TTS ?? 'http://127.0.0.1:8788', // the Kokoro sidecar (ai-server/tts); optional
    aliases,
  }
}

const safeEq = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** FIFO gate with bounded depth. acquire() resolves with a release(). */
export function makeGate(limit, maxQueue) {
  let active = 0
  const waiting = []
  return {
    get depth() { return waiting.length },
    acquire(signal) {
      return new Promise((resolve, reject) => {
        const go = () => { active++; resolve(() => { active--; waiting.shift()?.() }) }
        if (active < limit) return go()
        if (waiting.length >= maxQueue) return reject(Object.assign(new Error('queue full'), { code: 'full' }))
        const w = go
        waiting.push(w)
        signal?.addEventListener('abort', () => {
          const i = waiting.indexOf(w)
          if (i >= 0) { waiting.splice(i, 1); reject(Object.assign(new Error('aborted'), { code: 'abort' })) }
        })
      })
    },
  }
}

/** Fixed-window per-client counter. */
export function makeLimiter(perMin, now = Date.now) {
  const hits = new Map()
  return (id) => {
    const t = now(), w = Math.floor(t / 60_000)
    const h = hits.get(id)
    if (!h || h.w !== w) { hits.set(id, { w, n: 1 }); return true }
    return ++h.n <= perMin
  }
}

export function createServer(cfg) {
  const gate = makeGate(cfg.concurrency, cfg.maxQueue)
  const allow = makeLimiter(cfg.ratePerMin)
  const send = (res, code, body, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...extra })
    res.end(JSON.stringify(body))
  }
  const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }))

  return http.createServer(async (req, res) => {
    const t0 = Date.now()
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/healthz') return send(res, 200, { ok: true })
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
    if (!cfg.key || !safeEq(bearer, cfg.key)) return send(res, 401, { error: 'unauthorized' })
    if (!allow(req.socket.remoteAddress ?? '?')) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': '30' })

    try {
      if (req.method === 'GET' && url.pathname === '/api/tags') {
        const up = await fetch(`${cfg.upstream}/api/tags`)
        const j = await up.json()
        // Aliases show up as models so the panel's picker lists the lanes.
        j.models = [...Object.keys(cfg.aliases).map((name) => ({ name, model: name })), ...(j.models ?? [])]
        return send(res, 200, j)
      }
      if (req.method === 'GET' && url.pathname === '/v1/status') {
        return send(res, 200, { queue: gate.depth, concurrency: cfg.concurrency, aliases: cfg.aliases })
      }
      // Speech: the app asks for audio, the sidecar synthesises it (or says it is not running).
      if (url.pathname === '/v1/tts' || url.pathname === '/v1/tts/voices') {
        const chunks = []
        let size = 0
        for await (const c of req) { size += c.length; if (size > 20_000) return send(res, 413, { error: 'too large' }); chunks.push(c) }
        const ac = new AbortController()
        res.on('close', () => { if (!res.writableEnded) ac.abort() })
        let up
        try {
          up = url.pathname === '/v1/tts/voices'
            ? await fetch(`${cfg.tts}/voices`, { signal: ac.signal })
            : await fetch(`${cfg.tts}/speak`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.concat(chunks), signal: ac.signal })
        } catch { return send(res, 503, { error: 'speech service not running' }) }
        res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'private, max-age=86400' })
        res.end(Buffer.from(await up.arrayBuffer()))
        log({ route: 'tts', status: up.status, ms: Date.now() - t0 }) // length only — never the text
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const chunks = []
        let size = 0
        for await (const c of req) { size += c.length; if (size > 2_000_000) return send(res, 413, { error: 'too large' }); chunks.push(c) }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        const alias = cfg.aliases[body.model]
        const model = alias?.model ?? body.model
        const out = { ...body, model, keep_alive: body.keep_alive ?? cfg.keepAlive, options: { ...(alias?.options ?? {}), ...(body.options ?? {}) } }
        // A fine-tuned lane carries SimScript in its weights: swap the app's ~1k-token
        // prompt + few-shots for the short one it was trained on (prefill is the slow part).
        if (alias?.system && Array.isArray(body.messages)) {
          const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')
          out.messages = [{ role: 'system', content: alias.system }, ...(lastUser ? [lastUser] : [])]
        }
        if (alias && out.think === undefined && alias.think !== undefined) out.think = alias.think

        const ac = new AbortController()
        res.on('close', () => { if (!res.writableEnded) ac.abort() }) // client left → free the GPU
        let release
        try { release = await gate.acquire(ac.signal) } catch (e) {
          if (e.code === 'full') return send(res, 503, { error: 'busy, try again shortly' }, { 'Retry-After': '10' })
          return
        }
        try {
          const up = await fetch(`${cfg.upstream}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out), signal: ac.signal })
          res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') ?? 'application/json' })
          let tail = ''
          for await (const c of up.body) { res.write(c); tail = (tail + Buffer.from(c).toString('utf8')).slice(-600) }
          res.end()
          const m = tail.match(/"eval_count":(\d+)/), p = tail.match(/"prompt_eval_count":(\d+)/)
          log({ route: 'chat', model, status: up.status, ms: Date.now() - t0, out_tokens: m ? +m[1] : null, prompt_tokens: p ? +p[1] : null })
        } finally { release() }
        return
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      if (e?.name === 'AbortError') return
      log({ route: url.pathname, error: String(e?.message ?? e) })
      if (!res.headersSent) send(res, 502, { error: 'upstream unavailable' })
      else res.end()
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig()
  if (!cfg.key) { console.error('Set AI_SERVER_KEY (a long random string). Refusing to start without auth.'); process.exit(1) }
  createServer(cfg).listen(cfg.port, cfg.host, () => console.log(`SIMBLIP AI server on http://${cfg.host}:${cfg.port} → ${cfg.upstream}`))
}
