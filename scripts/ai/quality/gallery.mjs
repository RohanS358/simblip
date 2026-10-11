// Look at scripts the way a student would: run each through the REAL app in Chrome
// (layout engine, symbols, wires and all) and save a picture. A scorer tells you
// that something is off; only a picture tells you what.
//
//   node scripts/ai/quality/gallery.mjs scripts.jsonl outdir [--scale 0.7]
//   scripts.jsonl: one {"name": "...", "script": "..."} per line.
//
// Needs `npm run dev` on :3000. Uses the e2e profile (.cache/ai-e2e-profile).

import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const [, , inFile, outDir = '.cache/gallery'] = process.argv
const scale = Number(process.argv[process.argv.indexOf('--scale') + 1]) || 0.7
const seed = readFileSync(resolve(import.meta.dirname, '../../../lib/auth/bootstrap.ts'), 'utf8')
const EMAIL = /email: '([^']+)'/.exec(seed)[1], PASS = /password: '([^']+)'/.exec(seed)[1]
const items = readFileSync(inFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
mkdirSync(outDir, { recursive: true })

const ctx = await chromium.launchPersistentContext('.cache/ai-e2e-profile', { executablePath: '/usr/bin/google-chrome', headless: true, viewport: { width: 1400, height: 900 }, args: ['--no-sandbox'] })
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto('http://localhost:3000/login')
if (await page.getByPlaceholder('you@institution.edu').count()) {
  await page.getByPlaceholder('you@institution.edu').fill(EMAIL)
  await page.locator('input[type=password]').fill(PASS)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
await page.waitForURL(/\/notebook/, { timeout: 90_000 })
await page.getByText('Welcome', { exact: true }).first().click({ timeout: 90_000 })
await page.waitForTimeout(1500)
if (await page.getByRole('button', { name: 'Expand sidebar' }).count()) { /* leave collapsed: more canvas */ } else if (await page.getByRole('button', { name: 'Collapse sidebar' }).count()) await page.getByRole('button', { name: 'Collapse sidebar' }).click()
// The assistant panel hosts the dev hook; make sure it is mounted once.
await page.getByRole('button', { name: 'Assistant' }).click().catch(() => {})
await page.waitForFunction(() => window.__ai?.runTool, null, { timeout: 30_000 })
await page.getByRole('button', { name: 'Collapse sidebar' }).click().catch(() => {})

for (const [i, it] of items.entries()) {
  // A fresh blank board per script, so nothing leaks between pictures.
  const shot = await page.evaluate(async ({ script, scale }) => {
    const { runTool, activeContext } = window.__ai
    const made = await runTool('page.create', { name: 'gallery', kind: 'board' }, activeContext())
    await new Promise((r) => setTimeout(r, 700))
    const ctx = activeContext()
    const r = await runTool('scene.script', { script }, ctx)
    await new Promise((r2) => setTimeout(r2, 900))
    const s = r.ok ? await runTool('scene.snapshot', { scale }, ctx) : null
    return { ok: r.ok, summary: r.summary, image: s?.data?.image ?? null, id: made.data?.id }
  }, { script: it.script, scale })
  if (shot.image) writeFileSync(`${outDir}/${String(i).padStart(2, '0')}-${it.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.jpg`, Buffer.from(shot.image.split(',')[1], 'base64'))
  console.log(`${i} ${it.name}: ${shot.ok ? 'ok' : 'FAILED ' + shot.summary}${shot.image ? '' : ' (no image)'}`)
}
await ctx.close()
