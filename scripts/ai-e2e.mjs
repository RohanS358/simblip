// End-to-end: the REAL app in REAL Chrome, the REAL on-device model, the REAL
// MCP server. Nothing is mocked. It signs in with the local-mode operator seed
// account (lib/auth/bootstrap.ts), so it only ever targets a dev server.
//
//   npm run dev                      (in another terminal)
//   node scripts/ai-e2e.mjs [--tier recommended|lite|standard] [--headed] [--only chat|mcp]
//
// The first run downloads the chosen model (397 MB / 1.1 GB) into the profile
// at .cache/ai-e2e-profile; later runs reuse it. Pass --no-download to fail
// instead of downloading.

import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = resolve(import.meta.dirname, '..')
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]) }
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
// 'recommended' = take whichever model this machine's probe offers (Standard on a GPU box).
const TIER = arg('tier', 'recommended')
const ONLY = arg('only', null)
const HEADED = arg('headed', false)
const seed = readFileSync(resolve(root, 'lib/auth/bootstrap.ts'), 'utf8')
const EMAIL = /email: '([^']+)'/.exec(seed)[1]
const PASS = /password: '([^']+)'/.exec(seed)[1]
const MCP_PORT = 7437

const results = []
const t0 = Date.now()
async function check(name, fn) {
  const s = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, ms: Date.now() - s, note })
    console.log(`  ✔ ${name} (${((Date.now() - s) / 1000).toFixed(1)}s)${note ? ' — ' + note : ''}`)
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - s, note: String(e.message ?? e) })
    console.log(`  ✖ ${name}\n      ${String(e.message ?? e).split('\n').join('\n      ')}`)
  }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

const ctx = await chromium.launchPersistentContext(resolve(root, '.cache/ai-e2e-profile'), {
  executablePath: '/usr/bin/google-chrome',
  headless: !HEADED,
  viewport: { width: 1280, height: 860 },
  args: ['--no-sandbox', '--enable-unsafe-webgpu'],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on('crash', () => console.log('  !! page crashed'))
ctx.on('close', () => console.log('  !! browser context closed'))
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

// ── Sign in, accept the local terms gate for the seeded operator ────────────
await page.goto(`${BASE}/login`)
if (await page.getByPlaceholder('you@institution.edu').count()) {
  await page.getByPlaceholder('you@institution.edu').fill(EMAIL)
  await page.locator('input[type=password]').fill(PASS)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
await page.waitForURL(/\/notebook/, { timeout: 90_000 })
await page.evaluate(() => {
  const user = localStorage.getItem('simblip-active-user') ?? localStorage.getItem(Object.keys(localStorage).find((k) => /active-user/.test(k)) ?? '')
  const key = `simblip-consent${user ? ':' + user : ''}`
  localStorage.setItem(key, JSON.stringify({ state: { acceptedVersion: '2026-09-27', acceptedAt: new Date().toISOString(), analytics: false, storageNoticeSeen: true }, version: 0 }))
})
await page.reload()

// ── Open a page with a simulation and the assistant ─────────────────────────
await page.getByText('Welcome', { exact: true }).first().click({ timeout: 90_000 })
const box = page.getByPlaceholder(/Describe a simulation|Describe it/)
// The rail button TOGGLES: clicking Assistant while it is already open folds the
// pane, and a folded pane keeps its DOM (so "visible" lies). The profile
// remembers the last state, so ask the sidebar what state it is in.
await page.waitForTimeout(1500)
if (await page.getByRole('button', { name: 'Expand sidebar' }).count()) await page.getByRole('button', { name: 'Expand sidebar' }).click()
await page.waitForTimeout(600)
if (!(await box.count())) await page.getByRole('button', { name: 'Assistant' }).click()
await box.waitFor({ state: 'visible', timeout: 60_000 })
await page.waitForTimeout(600)
if (await page.getByRole('button', { name: 'Clear conversation' }).count()) await page.getByRole('button', { name: 'Clear conversation' }).click()
const objectCount = async () => Number(/(\d+) objects?/.exec(await page.locator('text=/\\d+ objects?/').last().innerText())?.[1] ?? NaN)
const say = async (t) => { await box.click(); await box.fill(t); await page.keyboard.press('Enter') }
const lastTurn = () => page.locator('[class*="min-w-0 space-y-2"]').last()

async function ensureModel() {
  await page.getByText(/Download (Lite|Standard)|On this device ·|Downloading/).first().waitFor({ timeout: 60_000 })
  if (TIER !== 'recommended') {
    // Take a specific tier: download it if needed (once), and make it the one in use.
    console.log(`  … ensuring the ${TIER} model`)
    await page.evaluate((t) => window.__ai.downloadModel(t), TIER)
    await page.getByText(new RegExp(`On this device · ${TIER === 'lite' ? 'Lite' : 'Standard'}`)).first().waitFor({ timeout: 900_000 })
    return
  }
  const dl = page.getByRole('button', { name: /^Download (Lite|Standard)/ })
  if (await dl.count()) {
    if (arg('no-download', false)) throw new Error('model not downloaded and --no-download given')
    console.log(`  … downloading: ${await dl.first().innerText()} (once; cached in .cache/ai-e2e-profile)`)
    await dl.first().click()
    await page.getByText(/On this device ·/).first().waitFor({ timeout: 900_000 })
  }
}

if (!ONLY || ONLY === 'chat') {
  console.log('\nChat (on-device)')
  await check('route is on-device and the pill says so honestly', async () => {
    await ensureModel()
    const pill = await page.getByText(/On this device ·/).first().innerText()
    assert(/Lite|Standard/.test(pill), pill)
    return pill
  })

  await check('"run" is a quick command: simulation starts, tool chip shown, no model needed', async () => {
    await say('run')
    await page.getByText('Simulation running.').first().waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Pause' }).first().waitFor({ timeout: 5000 })
  })
  await check('"pause" then "reset" obey', async () => {
    await say('pause'); await page.getByText('Paused.').first().waitFor({ timeout: 10_000 })
    await say('reset'); await page.getByText(/Reset — the scene is back as drawn/).first().waitFor({ timeout: 10_000 })
  })

  await check('explain lane: the on-device model writes a real answer, and the turn finishes', async () => {
    const done = () => page.getByText(/Answered — review it/).count()
    const before = await done()
    await say('In two sentences, what is Ohm\'s law?')
    for (let i = 0; i < 120 && (await done()) <= before; i++) await page.waitForTimeout(2000)
    assert((await done()) > before, 'no answer within 240s')
    const text = await page.locator('[class*="space-y-4"]').first().innerText()
    assert(/voltage|current|resistance/i.test(text), 'the answer should mention voltage/current/resistance')
    return `${await page.evaluate(() => window.__ai.useEngine.getState().tps?.toFixed(1))} tok/s`
  })

  await check('simulate lane (canned model reply): verified script shown, Add puts it on the canvas, ONE undo removes it', async () => {
    await page.evaluate(() => { window.__aiOpts = { fakeReply: 'var b = create("battery", {V: 9});\nvar r1 = create("resistor", {R: 1000});\nvar r2 = create("resistor", {R: 2000});\nconnect(b.positive, r1.a);\nconnect(r1.b, r2.a);\nconnect(r2.b, b.negative);' } })
    const before = await objectCount()
    await say('A voltage divider with two resistors')
    const add = page.getByRole('button', { name: /Add to canvas/ }).last()
    await add.waitFor({ timeout: 60_000 })
    assert(/battery/.test(await page.locator('pre').last().innerText()), 'the script should be shown')
    await add.click()
    await page.waitForTimeout(800)
    const after = await objectCount()
    assert(after > before, `objects ${before} → ${after}`)
    // One undo, via the keyboard, on the canvas.
    await page.locator('[data-canvas-root]').first().click({ position: { x: 600, y: 600 } })
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    assert((await objectCount()) === before, `after ONE undo expected ${before}, got ${await objectCount()}`)
    await page.evaluate(() => { window.__aiOpts = {} })
    return `${before} → ${after} → ${before}`
  })

  await check('an invalid script from the model is NOT put on the canvas, and the failure is honest', async () => {
    await page.evaluate(() => { window.__aiOpts = { fakeReply: 'var x = create("flux-capacitor", {});' } })
    const before = await objectCount()
    await say('A voltage divider with two resistors')
    await page.getByText(/couldn't produce a valid simulation/).last().waitFor({ timeout: 60_000 })
    assert((await objectCount()) === before, 'nothing may reach the canvas')
    await page.evaluate(() => { window.__aiOpts = {} })
  })

  await check('measure question: the agent MUST call scene.measure (a small model invents numbers otherwise)', async () => {
    await say('run'); await page.waitForTimeout(2500)
    const before = await page.locator('code', { hasText: 'scene.' }).count()
    await say('how fast is the mass moving?')
    for (let i = 0; i < 120 && (await page.locator('code', { hasText: /scene\.(measure|describe)/ }).count()) <= 0; i++) await page.waitForTimeout(2000)
    const chips = await page.locator('code', { hasText: /scene\./ }).allInnerTexts()
    assert(chips.some((c) => /measure|describe/.test(c)), `tool chips: ${chips.join(', ')}`)
    return chips.slice(before).join(' → ')
  })

  if (arg('slow', false)) {
    await check('[slow, informational] the REAL model attempts a voltage divider: it must END, with a script or an honest failure', async () => {
      await page.evaluate(() => { window.__aiOpts = {} })
      await say('A voltage divider with two resistors')
      const ok = page.getByRole('button', { name: /Add to canvas/ }).last()
      const bad = page.getByText(/couldn't produce a valid simulation/).last()
      await Promise.race([ok.waitFor({ timeout: 600_000 }), bad.waitFor({ timeout: 600_000 })])
      return (await ok.count()) ? 'valid scene' : 'honest failure (base model — needs the fine-tune)'
    })
  }
}

if (!ONLY || ONLY === 'mcp') {
  console.log('\nMCP (real server process ↔ real tab)')
  const client = new Client({ name: 'e2e', version: '1' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve(root, 'scripts/mcp/simblip-mcp.mjs')], env: { ...process.env, SIMBLIP_MCP_PORT: String(MCP_PORT) } }))
  const text = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')

  await check('server reports "not connected" while agents are off', async () => {
    assert(/No SIMBLIP notebook is connected/.test(text(await client.callTool({ name: 'scene.describe', arguments: {} }))), 'expected not-connected')
  })

  await check('turning agents on in Settings connects the tab; the first call asks for approval', async () => {
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    await page.getByRole('button', { name: /AI assistant/ }).click()
    await page.getByRole('button', { name: 'Full control' }).click()
    await page.keyboard.press('Escape')
    for (let i = 0; i < 40 && (await client.listTools()).tools.length < 5; i++) await new Promise((r) => setTimeout(r, 500))
    const tools = (await client.listTools()).tools.map((t) => t.name)
    assert(tools.includes('scene.run') && tools.includes('scene.edit'), `tools: ${tools.join(',')}`)
    const pending = client.callTool({ name: 'scene.describe', arguments: {} })
    await page.getByRole('button', { name: 'Allow' }).click({ timeout: 15_000 })
    const r = await pending
    assert(!r.isError, text(r))
    return `${tools.length} tools; describe → ${text(r).slice(0, 60).replace(/\n/g, ' ')}…`
  })

  await check('an agent builds a scene through MCP; it appears on the canvas; undo removes it', async () => {
    const before = await objectCount()
    const r = await client.callTool({ name: 'scene.script', arguments: { script: 'var b = create("battery", {V: 9});\nvar r = create("resistor", {R: 100});\nconnect(b.positive, r.a);\nconnect(r.b, b.negative);' } })
    assert(!r.isError, text(r))
    await page.waitForTimeout(600)
    const after = await objectCount()
    assert(after > before, `objects ${before} → ${after}`)
    await client.callTool({ name: 'scene.undo', arguments: {} })
    await page.waitForTimeout(400)
    assert((await objectCount()) === before, 'undo should restore the page')
  })

  await check('an agent can SEE the page: scene.snapshot returns a real image', async () => {
    const r = await client.callTool({ name: 'scene.snapshot', arguments: { scale: 0.4 } })
    assert(!r.isError, text(r))
    const img = r.content.find((c) => c.type === 'image')
    assert(img && img.mimeType === 'image/jpeg' && img.data.length > 2000, 'expected a jpeg')
    return `${Math.round((img.data.length * 3) / 4 / 1024)} KB jpeg`
  })

  await check('an agent runs the simulation and reads a real measurement from a described id', async () => {
    const d = text(await client.callTool({ name: 'scene.describe', arguments: {} }))
    const id = /\b([a-z0-9]{8,})\b/.exec(d.split('\n').find((l) => /mass|circle|rigid/i.test(l)) ?? '')?.[1]
    assert(id, `no object id in the digest:\n${d.slice(0, 400)}`)
    assert(!(await client.callTool({ name: 'scene.run', arguments: {} })).isError, 'run failed')
    await page.waitForTimeout(1200)
    const m = await client.callTool({ name: 'scene.measure', arguments: { id, channel: 'y' } })
    assert(!m.isError, text(m))
    return text(m).slice(0, 80)
  })

  await check('switching to Read only removes writers and refuses them at execution', async () => {
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: /Settings/ }).click()
    await page.getByRole('button', { name: /AI assistant/ }).click()
    await page.getByRole('button', { name: 'Read only' }).click()
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 1000))
    const names = (await client.listTools()).tools.map((t) => t.name)
    assert(!names.includes('scene.add') && names.includes('scene.describe'), names.join(','))
    const r = await client.callTool({ name: 'scene.add', arguments: { component: 'note' } })
    assert(r.isError, 'writer must be refused')
  })
  await client.close()
}

console.log('\nBrowser console errors:', errors.length ? '\n  ' + [...new Set(errors)].slice(0, 8).join('\n  ') : 'none')
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
await ctx.close()
process.exit(failed.length ? 1 : 0)
