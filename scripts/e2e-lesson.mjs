// E2E: "teach me ohms law" in the REAL app → a playing, interactive lesson.
// Signs in with the local dev operator seed (lib/auth/bootstrap.ts); dev servers only.
//   npm run dev   (other terminal)   node scripts/e2e-lesson.mjs [--out dir] [--headed]
import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true) }
const OUT = resolve(arg('out', '.cache/e2e-lesson')); mkdirSync(OUT, { recursive: true })
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
const seed = readFileSync(resolve(root, 'lib/auth/bootstrap.ts'), 'utf8')
const EMAIL = /email: '([^']+)'/.exec(seed)[1], PASS = /password: '([^']+)'/.exec(seed)[1]

const ctx = await chromium.launchPersistentContext(resolve(root, '.cache/ai-e2e-profile'), {
  executablePath: '/usr/bin/google-chrome', headless: !arg('headed', false), viewport: { width: 1360, height: 860 }, args: ['--no-sandbox'],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const log = (s) => console.log(s)
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` })

await page.goto(`${BASE}/login`)
if (await page.getByPlaceholder('you@institution.edu').count()) {
  await page.getByPlaceholder('you@institution.edu').fill(EMAIL)
  await page.locator('input[type=password]').fill(PASS)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
await page.waitForURL(/\/notebook/, { timeout: 120_000 })
await page.evaluate(() => {
  const user = localStorage.getItem('simblip-active-user') ?? localStorage.getItem(Object.keys(localStorage).find((k) => /active-user/.test(k)) ?? '')
  localStorage.setItem(`simblip-consent${user ? ':' + user : ''}`, JSON.stringify({ state: { acceptedVersion: '2026-09-27', acceptedAt: new Date().toISOString(), analytics: false, storageNoticeSeen: true }, version: 0 }))
})
await page.reload()
const welcome = page.getByText('Welcome', { exact: true }).first()
if (!(await welcome.isVisible({ timeout: 8000 }).catch(() => false))) await page.mouse.click(19, 77) // open the Notebooks rail
await welcome.click({ timeout: 60_000 })
const box = page.getByPlaceholder(/Describe a simulation|Describe it/)
await page.waitForTimeout(1500)
if (await page.getByRole('button', { name: 'Expand sidebar' }).count()) await page.getByRole('button', { name: 'Expand sidebar' }).click()
if (!(await box.count())) await page.getByRole('button', { name: 'Assistant' }).click()
await box.waitFor({ state: 'visible', timeout: 60_000 })
const TOPIC = arg('topic', 'ohms law')
// Generated films need the AI server: pin this browser to it for the run.
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('simblip-lesson-cache')) localStorage.removeItem(k); const k = 'simblip-ai-engine'; const v = JSON.parse(localStorage.getItem(k) ?? '{"state":{},"version":0}'); v.state.backend = 'server'; localStorage.setItem(k, JSON.stringify(v)) })
await page.reload(); await page.waitForTimeout(2500)
if (!(await box.count())) await page.getByRole('button', { name: 'Assistant' }).click()
await box.waitFor({ state: 'visible', timeout: 60_000 })
await box.click(); await box.fill(`teach me ${TOPIC}`); await page.keyboard.press('Enter')
if (arg('generate', false)) {
  const t0 = Date.now()
  const building = page.getByRole('status').filter({ hasText: 'Building a lesson' })
  await building.waitFor({ timeout: 30_000 }); log('✔ progress card shown'); await shot('0-building')
  let last = ''
  while (await building.count()) { const t = (await building.innerText().catch(() => '')).split('\n').pop(); if (t !== last) { log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${t}`); last = t } await page.waitForTimeout(1500); if (Date.now() - t0 > 600_000) throw new Error('generation took > 10 min') }
  log(`✔ film ready after ${Math.round((Date.now() - t0) / 1000)}s`)
}

const bar = page.getByRole('progressbar', { name: /Lesson progress/ })
await bar.waitFor({ timeout: 60_000 }); log('✔ lesson overlay appeared'); await shot('1-started')
await page.waitForTimeout(9000); await shot('2-narrating')
// What did the director produce? (the film is cached per user in localStorage)
const film = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('simblip-lesson-cache')); if (!k) return null; const f = Object.values(JSON.parse(localStorage.getItem(k)).state.films)[0]?.storyboard; return f ? { title: f.title, beats: f.beats.map((b) => b.t) } : null })
if (film) log(`  film "${film.title}": ${film.beats.length} beats — ` + Object.entries(film.beats.reduce((a, t) => ((a[t] = (a[t] ?? 0) + 1), a), {})).map(([t, n]) => `${t}×${n}`).join(' '))
await page.waitForTimeout(3000); await shot('2b-early')
log('  canvas roots: ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-canvas-root]')].map((e) => [e.dataset.canvasRoot, Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]))))
const pred = page.getByRole('group', { name: 'Prediction' })
await pred.waitFor({ timeout: 20_000 }).catch(async (e) => { await shot("9-no-predict"); throw e }); log('✔ prediction card appeared'); await shot('3-predict')
const label = await pred.innerText(); log('  ' + label.replace(/\n+/g, ' | ').slice(0, 200))
await pred.getByRole('button').first().click(); await page.waitForTimeout(3500); await shot('4-after-choice')
log('  caption: ' + (await page.locator('[aria-live=polite]').last().innerText().catch(() => '(none)')).slice(0, 200))
await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.waitForTimeout(2500); await shot('5-next')
const objs = await page.locator('text=/\\d+ objects?/').last().innerText().catch(() => '?')
log(`  ${objs} on the lesson page`)
await page.getByTitle('Close lesson').click(); await page.waitForTimeout(500)
log((await bar.count()) === 0 ? '✔ closed cleanly' : '✖ overlay still open')
log(errors.length ? `page errors: ${errors.slice(0, 3).join(' | ').slice(0, 400)}` : '✔ no page errors')
await ctx.close()
process.exit(0)
