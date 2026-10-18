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
await box.click(); await box.fill('teach me ohms law'); await page.keyboard.press('Enter')

const bar = page.getByRole('progressbar', { name: /Lesson progress/ })
await bar.waitFor({ timeout: 60_000 }); log('✔ lesson overlay appeared'); await shot('1-started')
await page.waitForTimeout(9000); await shot('2-narrating')
// Speed up: 1.5x then wait for the first prediction card.
const pred = page.getByRole('group', { name: 'Prediction' })
await pred.waitFor({ timeout: 240_000 }); log('✔ prediction card appeared'); await shot('3-predict')
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
