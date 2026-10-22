// S5 in the REAL app: a (synthetic) photo of a circuit is pasted onto a whiteboard, "Read as circuit" is pressed,
// the preview appears over the picture, Make it live builds it, Play runs it. Headless Chrome, real events.
//   node scripts/dev-local.mjs 3114          (local-mode server; accounts live in the browser)
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/e2e-photo-flow.mjs
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'
import { renderPhoto } from '../../../lib/sketch/photo/synth-photo.ts'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const sharp = require('sharp')
const BASE = process.env.E2E_BASE ?? 'http://localhost:3114'
const ACCOUNT = { email: 'aalubhentakobhi@simblip.dev', password: 'loonivaislobhi', id: 'user-operator' }
const TERMS_VERSION = '2026-09-27'
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

// the picture: layout 0, rendered like a photo, as a PNG
const rng = makeRng(900)
const sc = drawScene(layouts[0], rng.fork('s'), makeWriter(rng.fork('w'), 'ph-0', 'pen'), undefined, undefined, { text: false })
const photo = renderPhoto(sc.strokes, rng.fork('p'), { width: 2, blur: 1, shade: 0.12, noise: 4 })
const grey = Buffer.alloc(photo.width * photo.height)
for (let i = 0; i < grey.length; i++) grey[i] = photo.data[4 * i]
const png = await sharp(grey, { raw: { width: photo.width, height: photo.height, channels: 1 } }).png().toBuffer()
const blank = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#f0f0f0' } }).png().toBuffer()

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([v, id]) => { try { localStorage.setItem(`simblip-consent:${id}`, JSON.stringify({ state: { acceptedVersion: v, analytics: false, storageNoticeSeen: true }, version: 0 })) } catch {} }, [TERMS_VERSION, ACCOUNT.id])
await ctx.addInitScript(() => { try { localStorage.setItem('simblip-debug-sketch', '1') } catch {} })
const page = await ctx.newPage()
if (process.env.E2E_LOGS) page.on('console', (m) => { if (m.text().startsWith('[sketch]')) console.log('      ' + m.text().slice(0, 200)) })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
if (process.env.E2E_LOGS) page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('      [console.' + m.type() + ']', m.text().slice(0, 240)) })
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.locator('input[type=text]').fill(ACCOUNT.email)
await page.locator('input[type=password]').fill(ACCOUNT.password)
await page.locator('button:has-text("Sign in")').click()
await page.waitForURL('**/notebook', { timeout: 60000 })
await page.waitForTimeout(6000)
const exit = page.locator('button[title="Exit Walkthrough"]')
if (await exit.count()) await exit.first().click({ force: true }).catch(() => {})
await page.locator('button[aria-label="Add page"]').last().click({ force: true })
await page.locator('button:has-text("Whiteboard")').first().click()
await page.locator('button:has-text("Create")').first().click()
await page.waitForTimeout(2500)
const collapse = page.locator('button[aria-label="Collapse sidebar"]')
if (await collapse.count()) await collapse.first().click({ force: true }).catch(() => {})
const objectsN = async () => Number((await page.locator('body').innerText()).match(/(\d+) objects?/)?.[1] ?? -1)

const paste = async (buf) => {
  await page.mouse.click(700, 500) // focus the canvas
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'photo.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    window.dispatchEvent(ev)
  }, buf.toString('base64'))
  await page.waitForTimeout(2500)
}

// ── a blank picture: refused, with words ─────────────────────────────────────────
await paste(blank)
check('a picture was pasted (object added)', (await objectsN()) === 1, `objects ${await objectsN()}`)
await page.getByRole('button', { name: 'Properties' }).first().click().catch(() => {})
const readBtn = page.getByRole('button', { name: 'Read as circuit' })
await readBtn.waitFor({ timeout: 10000 }).catch(() => {})
if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + '/photo1.png' })
check('the inspector offers "Read as circuit" for a picture', await readBtn.isVisible().catch(() => false))
await readBtn.click().catch(() => {})
if (process.env.E2E_LOGS) { await page.waitForTimeout(3000); console.log('      toasts:', JSON.stringify(await page.locator('[data-sonner-toast]').allInnerTexts())); console.log('      dialogs:', JSON.stringify(await page.locator('[role=dialog]').allInnerTexts().then((a) => a.map((t) => t.slice(0, 80))))) }
const card = page.locator('[aria-label="Sketch not recognised"]')
await card.waitFor({ timeout: 20000 }).catch(() => {})
if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + '/photo2.png' })
check('a blank picture gets a failure card that says what to do', /could not find any drawing/.test(await card.innerText().catch(() => '')))
await page.keyboard.press('Escape')
await page.keyboard.press('Delete')
await page.waitForTimeout(500)

// ── the circuit photo ────────────────────────────────────────────────────────────
await paste(png)
const readBtn2 = page.getByRole('button', { name: 'Read as circuit' })
await readBtn2.waitFor({ timeout: 10000 }).catch(() => {})
await readBtn2.click()
const preview = page.locator('[aria-label="Sketch to circuit"]')
await preview.waitFor({ timeout: 60000 }).catch(() => {})
check('Read as circuit → circuit preview over the picture', await preview.isVisible().catch(() => false))
const parts = await page.locator('[aria-label^="Part "][aria-label$=" symbol"]').count()
check('the preview lists the parts it read', parts >= layouts[0].ir.nodes.length - 1, `${parts} parts listed, drawn ${layouts[0].ir.nodes.length}`)
const before = await objectsN()
await page.getByRole('button', { name: /Make it live/ }).first().click()
await page.waitForTimeout(2500)
const after = await objectsN()
check('Make it live builds the circuit (more objects than the lone picture)', after > before, `objects ${before} → ${after}`)
await page.getByRole('button', { name: 'Play' }).first().click().catch(() => {})
await page.waitForTimeout(2000)
check('Play starts the simulation with no page error', (await page.getByRole('button', { name: /^Pause/ }).count()) > 0 && errors.length === 0, errors.slice(0, 2).join(' ; '))

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
