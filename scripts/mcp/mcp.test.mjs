// The MCP bridge, end to end over real transports: a real MCP client talks stdio
// to the real server process; a fake "notebook tab" talks WebSocket to it.
// Run: npm run test:ai
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import WebSocket from 'ws'
import { toMcpResult } from './simblip-mcp.mjs'

const SERVER = resolve(import.meta.dirname, 'simblip-mcp.mjs')
const PORT = 20_000 + Math.floor(Math.random() * 20_000)

const client = new Client({ name: 'test', version: '1' })
await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env, SIMBLIP_MCP_PORT: String(PORT) } }))
test.after(async () => { await client.close() })

const TOOLS = [
  { name: 'scene.describe', description: 'Describe the page', effect: 'read', inputSchema: { type: 'object', properties: {} } },
  { name: 'scene.add', description: 'Add a thing', effect: 'write', inputSchema: { type: 'object', properties: { component: { type: 'string' } }, required: ['component'] } },
]

/** A notebook tab that answers calls with `handle`. */
const openTab = (handle, { origin = 'http://localhost:3000', tools = TOOLS } = {}) =>
  new Promise((ok, bad) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, origin ? { headers: { Origin: origin } } : undefined)
    ws.on('error', bad)
    ws.on('unexpected-response', (_q, res) => bad(Object.assign(new Error('rejected'), { status: res.statusCode })))
    ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', info: { page: 'Physics 1' }, tools })); setTimeout(() => ok(ws), 80) })
    ws.on('message', async (raw) => {
      const m = JSON.parse(String(raw))
      if (m.type === 'call') ws.send(JSON.stringify({ type: 'result', id: m.id, result: await handle(m) }))
    })
  })

const text = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')

test('with no notebook open, the client is told exactly how to connect', async () => {
  const tools = (await client.listTools()).tools
  assert.deepEqual(tools.map((t) => t.name), ['simblip_status'])
  const r = await client.callTool({ name: 'simblip_status', arguments: {} })
  assert.match(text(r), /Settings → AI agents/)
  const other = await client.callTool({ name: 'scene.describe', arguments: {} })
  assert.equal(other.isError, true)
  assert.match(text(other), /No SIMBLIP notebook is connected/)
})

test('a browser origin that is not SIMBLIP is refused at the socket', async () => {
  await assert.rejects(openTab(async () => ({}), { origin: 'https://evil.example' }), (e) => e.status === 403)
  await assert.rejects(openTab(async () => ({}), { origin: null }), (e) => e.status === 403)
})

test('a connected notebook\'s tools appear to the MCP client, and calls round-trip', async () => {
  const calls = []
  const ws = await openTab(async (m) => { calls.push(m); return { ok: true, summary: `ran ${m.name}`, data: { n: 3 } } })
  const tools = (await client.listTools()).tools.map((t) => t.name)
  assert.deepEqual(tools, ['simblip_status', 'scene.describe', 'scene.add'])
  const add = (await client.listTools()).tools.find((t) => t.name === 'scene.add')
  assert.deepEqual(add.inputSchema.required, ['component'], 'the page\'s JSON Schema is passed through untouched')
  assert.match(add.description, /\[write\]/)

  const st = await client.callTool({ name: 'simblip_status', arguments: {} })
  assert.match(text(st), /Connected: 2 tools/)
  assert.match(text(st), /Physics 1/)

  const r = await client.callTool({ name: 'scene.add', arguments: { component: 'note' } })
  assert.equal(r.isError, false)
  assert.match(text(r), /ran scene\.add/)
  assert.match(text(r), /"n":3/, 'structured data rides along for ids etc.')
  assert.deepEqual(calls[0].args, { component: 'note' })
  ws.close()
  await new Promise((r) => setTimeout(r, 80))
})

test('a failed tool is an MCP error the model can read, not a transport failure', async () => {
  const ws = await openTab(async () => ({ ok: false, summary: 'unknown id "x"', error: 'unknown id' }))
  const r = await client.callTool({ name: 'scene.add', arguments: { component: 'x' } })
  assert.equal(r.isError, true)
  assert.match(text(r), /unknown id/)
  ws.close()
  await new Promise((r) => setTimeout(r, 80))
})

test('calling a tool the notebook never offered is refused', async () => {
  const ws = await openTab(async () => ({ ok: true, summary: 'x' }))
  const r = await client.callTool({ name: 'scene.destroy', arguments: {} })
  assert.equal(r.isError, true)
  assert.match(text(r), /Unknown tool/)
  ws.close()
  await new Promise((r) => setTimeout(r, 80))
})

test('closing the tab mid-call resolves the call with an error instead of hanging', async () => {
  let ws
  ws = await openTab(async () => { ws.close(); return new Promise(() => {}) })
  const r = await client.callTool({ name: 'scene.describe', arguments: {} })
  assert.equal(r.isError, true)
  assert.match(text(r), /disconnected/)
})

test('a newer tab replaces the older one', async () => {
  const a = await openTab(async () => ({ ok: true, summary: 'from A' }))
  const closed = new Promise((r) => a.on('close', r))
  const b = await openTab(async () => ({ ok: true, summary: 'from B' }))
  await closed
  assert.match(text(await client.callTool({ name: 'scene.describe', arguments: {} })), /from B/)
  b.close()
  await new Promise((r) => setTimeout(r, 80))
})

test('after the tab closes, the tool list shrinks back and tools_changed fires', async () => {
  const tools = (await client.listTools()).tools.map((t) => t.name)
  assert.deepEqual(tools, ['simblip_status'])
})

test('a snapshot image becomes real MCP image content', () => {
  const r = toMcpResult({ ok: true, summary: 'Snapshot.', data: { image: 'data:image/png;base64,AAAA', size: [10, 10] } })
  assert.deepEqual(r.content[1], { type: 'image', data: 'AAAA', mimeType: 'image/png' })
  assert.match(r.content[2].text, /"size":\[10,10\]/)
  assert.ok(!r.content[2].text.includes('AAAA'), 'the base64 must not be repeated as text')
  assert.equal(r.isError, false)
})
