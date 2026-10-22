// E2E: the section board, the teacher, circle-to-ask and the check-in, in the REAL app.
// Dev servers only; signs in with the local operator seed (lib/auth/bootstrap.ts).
//   npm run dev   (other terminal)   node scripts/e2e-teacher.mjs [--out dir] [--headed]
import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true) }
const OUT = resolve(arg('out', '.cache/e2e-teacher')); mkdirSync(OUT, { recursive: true })
const BASE = process.env.E2E_BASE ?? 'http://localhost:3000'
const seed = readFileSync(resolve(root, 'lib/auth/bootstrap.ts'), 'utf8')
const EMAIL = /email: '([^']+)'/.exec(seed)[1], PASS = /password: '([^']+)'/.exec(seed)[1]

const ctx = await chromium.launchPersistentContext(resolve(OUT, 'profile'), {
  executablePath: '/usr/bin/google-chrome', headless: !arg('headed', false), viewport: { width: 1360, height: 860 }, args: ['--no-sandbox'],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const log = (s) => console.log(s)
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` })
let failed = 0
const check = (ok, what) => { log(`${ok ? '✔' : '✖'} ${what}`); if (!ok) failed++ }

await page.goto(`${BASE}/login`)
// A saved session bounces /login straight to the notebook; give that a moment before filling the form.
await page.waitForURL(/\/notebook/, { timeout: 6000 }).catch(() => {})
if (!/\/notebook/.test(page.url()) && (await page.getByPlaceholder('you@institution.edu').count())) {
  await page.getByPlaceholder('you@institution.edu').fill(EMAIL)
  await page.locator('input[type=password]').fill(PASS)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
await page.waitForURL(/\/notebook/, { timeout: 120_000 })
await page.evaluate(() => {
  const user = localStorage.getItem('simblip-active-user')
  localStorage.setItem(`simblip-consent${user ? ':' + user : ''}`, JSON.stringify({ state: { acceptedVersion: '2026-09-27', acceptedAt: new Date().toISOString(), analytics: false, storageNoticeSeen: true }, version: 0 }))
})
await page.reload()
const welcome = page.getByText('Welcome', { exact: true }).first()
if (!(await welcome.isVisible({ timeout: 8000 }).catch(() => false))) await page.mouse.click(19, 77)
await welcome.click({ timeout: 60_000 })
const box = page.getByPlaceholder(/Describe a simulation|Describe it/)
await page.waitForTimeout(1500)
if (await page.getByRole('button', { name: 'Expand sidebar' }).count()) await page.getByRole('button', { name: 'Expand sidebar' }).click()
if (!(await box.count())) await page.getByRole('button', { name: 'Assistant' }).click()
await box.waitFor({ state: 'visible', timeout: 60_000 })
await box.click(); await box.fill('teach me ohms law'); await page.keyboard.press('Enter')

const bar = page.getByRole('progressbar', { name: /Lesson progress/ })
await bar.waitFor({ timeout: 60_000 })
const teacher = page.getByRole('img', { name: 'Your teacher' })
check(await teacher.isVisible(), 'the teacher is on screen beside the board')
const tb = await teacher.boundingBox()
check(!!tb && tb.x < 460 && tb.y + tb.height > 600, `she stands at the bottom-left of the visible board (${Math.round(tb?.x)},${Math.round(tb?.y)} ${Math.round(tb?.width)}x${Math.round(tb?.height)})`)
await page.waitForTimeout(4000); await shot('1-teacher-talking')

// Play on, answering predictions, until a second section opens.
await page.getByRole('button', { name: /0\.75x/ }).click(); await page.getByRole('menuitem', { name: '1.5x' }).click({ force: true })
const strip = page.getByRole('navigation', { name: 'Sections of this lesson' })
const chips = () => strip.getByRole('button')
let n = 0
for (let i = 0; i < 400 && n < 2; i++) {
  const p = page.getByRole('group', { name: 'Prediction' })
  if (await p.count()) { await p.getByRole('button').nth(1).click().catch(() => {}); await page.waitForTimeout(400); continue }
  const a = page.getByRole('group', { name: 'Your answer' })
  if (await a.count()) { await a.getByRole('button').first().click().catch(() => {}); continue }
  n = await chips().count().catch(() => 0)
  await page.waitForTimeout(400)
}
check(n >= 2, `older content stays: the board has ${n} sections, each reachable from the strip`)
const objsBefore = await page.evaluate(() => document.querySelectorAll('[data-object-id], [data-obj]').length)
await shot('2-sections')

// Circle something on the board.
await page.getByTitle(/Circle something on the board/).click()
check(await page.getByText(/Circle the part you want me to explain/).isVisible(), 'Ask mode: the board waits for a circle')
const cr = await page.locator('[aria-label="Infinite canvas"]').boundingBox()
const cx = cr.x + cr.width * 0.5, cy = cr.y + cr.height * 0.35
await page.mouse.move(cx - 90, cy); await page.mouse.down()
for (let a = 0; a <= 360; a += 20) await page.mouse.move(cx + 90 * Math.cos((a * Math.PI) / 180), cy + 70 * Math.sin((a * Math.PI) / 180))
await page.mouse.up()
const carryOn = page.getByRole('button', { name: /Got it — carry on/ })
await carryOn.waitFor({ timeout: 60_000 })
check(true, 'the teacher explained what was circled and offers to carry on')
log('  she said: ' + (await page.locator('div[aria-live=polite] p').last().innerText().catch(() => '')).slice(0, 220))
await shot('3-explaining')
check((await page.getByRole('button', { name: 'Simpler, please' }).count()) === 1 && (await page.getByRole('button', { name: 'Tell me more' }).count()) === 1, 'she offers simpler / more / ask something else')
await carryOn.click(); await page.waitForTimeout(2500)
check((await chips().count()) >= n, 'carrying on did not rebuild or lose any section')
await shot('4-resumed')

// Go back to the first section.
await chips().first().click(); await page.waitForTimeout(1500); await shot('5-back-to-section-1')

// Let the lesson run to a check-in.
let sawCheck = false
for (let i = 0; i < 700 && !sawCheck; i++) {
  const p = page.getByRole('group', { name: 'Prediction' })
  if (await p.count()) { await p.getByRole('button').nth(1).click().catch(() => {}); await page.waitForTimeout(400); continue }
  if (await page.getByRole('button', { name: 'A bit tough' }).count()) { sawCheck = true; break }
  await page.waitForTimeout(400)
}
check(sawCheck, 'she checked in: "how is that going?"')
if (sawCheck) {
  await shot('6-checkin')
  await page.getByRole('button', { name: 'A bit tough' }).click()
  await page.waitForTimeout(3000); await shot('7-simplified')
  const speed = await page.getByTitle('Speed').innerText()
  check(!/1\.5x/.test(speed), `"a bit tough" slowed the lesson down (speed now ${speed.trim()})`)
}
await page.getByTitle('Close lesson').click().catch(() => {})
log(errors.length ? `page errors: ${errors.slice(0, 3).join(' | ').slice(0, 500)}` : '✔ no page errors')
await ctx.close()
process.exit(failed || errors.length ? 1 : 0)
