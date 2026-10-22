// E2E: a question that asks to SEE something — the teacher draws it and teaches it mid-lesson, in new sections.
// Dev servers only; signs in with the local operator seed (lib/auth/bootstrap.ts).
//   npm run dev   (other terminal)   node scripts/e2e-aside.mjs [--out dir] [--headed]
import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1] ?? true) }
const OUT = resolve(arg('out', '.cache/e2e-aside')); mkdirSync(OUT, { recursive: true })
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
check(!!tb && tb.x + tb.width > 1100 && tb.y + tb.height > 600, `she stands at the bottom-right of the visible board, facing left (${Math.round(tb?.x)},${Math.round(tb?.y)} ${Math.round(tb?.width)}x${Math.round(tb?.height)})`)
await page.waitForTimeout(4000); await shot('1-teacher-talking')


// let the lesson get going, then interrupt with a request to draw something
await page.waitForTimeout(6000)
const secBefore = await page.evaluate(() => document.querySelectorAll('nav[aria-label="Sections of this lesson"] button').length)
await page.getByTitle(/Type a question for the teacher/).click()
const q = page.getByPlaceholder('Type your question…')
await q.waitFor({ timeout: 30_000 })
await q.fill('can you show me by drawing three parallel resistors and teach me what happens then?')
await page.keyboard.press('Enter')
check(true, 'asked the teacher to draw three resistors in parallel')
await shot('1-asked')
// she plans, draws and teaches: new sections appear on the board
const strip = page.getByRole('navigation', { name: 'Sections of this lesson' })
let secAfter = secBefore
for (let i = 0; i < 240 && secAfter <= secBefore + 1; i++) { await page.waitForTimeout(1000); secAfter = await strip.getByRole('button').count().catch(() => 0) }
check(secAfter > secBefore, `new sections were drawn mid-lesson (${secBefore} → ${secAfter})`)
await page.waitForTimeout(8000); await shot('2-drawing')
const glow = await page.locator('.lesson-spot').count()
log(`  glowing highlights on screen right now: ${glow}`)
const carry = page.getByRole('button', { name: /Got it — carry on/ })
await carry.waitFor({ timeout: 240_000 })
await shot('3-after-aside')
check(true, 'after drawing and teaching she offers to carry on')
await carry.click(); await page.waitForTimeout(4000); await shot('4-resumed')
check((await page.getByRole('progressbar', { name: /Lesson progress/ }).count()) === 1, 'the lesson resumed')
await page.getByTitle('Close lesson').click().catch(() => {})
log(errors.length ? `page errors: ${errors.slice(0, 3).join(' | ').slice(0, 500)}` : '✔ no page errors')
await ctx.close()
process.exit(failed || errors.length ? 1 : 0)
