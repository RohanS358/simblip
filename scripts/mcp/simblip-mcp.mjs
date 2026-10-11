#!/usr/bin/env node
// SIMBLIP MCP server — lets an MCP client (Claude Code, Claude Desktop, …)
// operate the notebook you have OPEN in a browser tab.
//
//   MCP client ──stdio──▶ this process ◀──WebSocket (127.0.0.1)── the tab
//
// The tab is the source of truth for tools: it sends its registry (names,
// schemas) on connect, and executes every call against the real stores. This
// process owns no notebook state and has no tool list of its own, so it can
// never drift from the app.
//
// Security: binds 127.0.0.1 only; refuses browser origins that are not
// SIMBLIP's; and the tab itself must have "AI agents" turned on in Settings
// and the user must approve each connection (lib/tools/bridge.ts).
//
// Add to Claude Code:   claude mcp add simblip -- node scripts/mcp/simblip-mcp.mjs
// Env: SIMBLIP_MCP_PORT (7437), SIMBLIP_ORIGINS (comma list of extra origins).

import { WebSocketServer } from 'ws'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'

export const DEFAULT_PORT = 7437
const CALL_TIMEOUT_MS = 120_000

const STATUS_TOOL = {
  name: 'simblip_status',
  description: 'Is a SIMBLIP notebook connected? Call this first; it explains how to connect if not.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
}

const isAllowedOrigin = (origin, extra) => {
  if (!origin) return false // browsers always send one; a bare script has no business here
  if (extra.includes(origin)) return true
  try {
    const u = new URL(origin)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === 'simblip.rohan-singh.com.np'
  } catch {
    return false
  }
}

/** The bridge: a WebSocket server holding (at most) one live notebook tab. */
export function createBridge({ port = DEFAULT_PORT, origins = [], onChange = () => {}, log = () => {} } = {}) {
  let page = null // { ws, tools, info }
  let seq = 0
  const waiting = new Map()

  const wss = new WebSocketServer({ host: '127.0.0.1', port, verifyClient: ({ origin }, done) => (isAllowedOrigin(origin, origins) ? done(true) : done(false, 403, 'Origin not allowed')) })

  wss.on('connection', (ws) => {
    // Newest tab wins: the one the user just switched on is the one they mean.
    if (page) page.ws.close(4000, 'replaced by a newer tab')
    const me = { ws, tools: [], info: {} }
    page = me
    ws.on('message', (raw) => {
      let m
      try { m = JSON.parse(String(raw)) } catch { return }
      if (m.type === 'hello') {
        me.info = m.info ?? {}
        me.tools = Array.isArray(m.tools) ? m.tools : []
        log(`notebook connected (${me.tools.length} tools)`)
        onChange()
      } else if (m.type === 'tools') {
        me.tools = m.tools ?? []
        onChange()
      } else if (m.type === 'result' && waiting.has(m.id)) {
        const w = waiting.get(m.id)
        waiting.delete(m.id)
        clearTimeout(w.timer)
        w.resolve(m.result)
      }
    })
    ws.on('close', () => {
      if (page === me) page = null
      for (const [id, w] of waiting) if (w.ws === ws) { clearTimeout(w.timer); waiting.delete(id); w.resolve({ ok: false, summary: 'The notebook tab disconnected mid-call.', error: 'disconnected' }) }
      log('notebook disconnected')
      onChange()
    })
  })

  return {
    wss,
    connected: () => page !== null && page.tools.length > 0,
    info: () => page?.info ?? null,
    tools: () => page?.tools ?? [],
    call(name, args) {
      if (!page) return Promise.resolve({ ok: false, summary: 'No notebook connected.', error: 'not connected' })
      const id = ++seq
      return new Promise((resolve) => {
        const timer = setTimeout(() => { waiting.delete(id); resolve({ ok: false, summary: `Timed out after ${CALL_TIMEOUT_MS / 1000}s.`, error: 'timeout' }) }, CALL_TIMEOUT_MS)
        waiting.set(id, { resolve, timer, ws: page.ws })
        page.ws.send(JSON.stringify({ type: 'call', id, name, args: args ?? {} }))
      })
    },
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()) }),
  }
}

const HOW_TO_CONNECT = (port) =>
  `No SIMBLIP notebook is connected.\n1. Open SIMBLIP in your browser (e.g. http://localhost:3000/notebook).\n2. Settings → AI agents → choose "Read only" or "Full control".\n3. Approve the connection when the notebook asks.\nThe notebook connects to ws://127.0.0.1:${port}.`

/** Turn a tool result into MCP content. An image (scene.snapshot) becomes real
 *  image content so a vision-capable client can SEE the page. */
export function toMcpResult(res) {
  const content = [{ type: 'text', text: res.summary ?? '' }]
  const data = res.data
  if (data && typeof data === 'object') {
    const { image, ...rest } = data
    if (typeof image === 'string' && image.startsWith('data:image/')) {
      const [head, b64] = image.split(',')
      content.push({ type: 'image', data: b64, mimeType: head.slice(5, head.indexOf(';')) })
    }
    if (Object.keys(rest).length) content.push({ type: 'text', text: JSON.stringify(rest).slice(0, 4000) })
  }
  return { content, isError: !res.ok }
}

export function createServer(bridge, port = DEFAULT_PORT) {
  const server = new Server({ name: 'simblip', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [STATUS_TOOL, ...bridge.tools().map((t) => ({ name: t.name, description: `${t.description} [${t.effect}]`, inputSchema: t.inputSchema }))],
  }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name === STATUS_TOOL.name) {
      const info = bridge.info()
      return { content: [{ type: 'text', text: bridge.connected() ? `Connected: ${bridge.tools().length} tools. ${info?.page ?? ''}`.trim() : HOW_TO_CONNECT(port) }] }
    }
    if (!bridge.connected()) return { content: [{ type: 'text', text: HOW_TO_CONNECT(port) }], isError: true }
    if (!bridge.tools().some((t) => t.name === params.name)) return { content: [{ type: 'text', text: `Unknown tool "${params.name}".` }], isError: true }
    return toMcpResult(await bridge.call(params.name, params.arguments))
  })
  return server
}

async function main() {
  const port = Number(process.env.SIMBLIP_MCP_PORT) || DEFAULT_PORT
  const origins = (process.env.SIMBLIP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  // stdout is the MCP channel; every human-readable line goes to stderr.
  const log = (m) => process.stderr.write(`[simblip-mcp] ${m}\n`)
  let server
  const bridge = createBridge({ port, origins, log, onChange: () => server?.sendToolListChanged().catch(() => {}) })
  bridge.wss.on('error', (e) => log(e.code === 'EADDRINUSE' ? `port ${port} is in use (another SIMBLIP MCP server?). Set SIMBLIP_MCP_PORT.` : String(e)))
  server = createServer(bridge, port)
  await server.connect(new StdioServerTransport())
  log(`ready — waiting for a notebook on ws://127.0.0.1:${port}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1) })
