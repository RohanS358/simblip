// End-to-end check of the Done-drawing flow in the REAL app, with real mouse events (headless Chrome).
// SYNTHETIC ink (generated hands) is replayed stroke by stroke through page.mouse.
//
// Needs a LOCAL-MODE dev server (accounts live in the browser; nothing touches a database):
//   node scripts/dev-local.mjs 3114
//   node --experimental-strip-types --import ./scripts/test/register.mjs scripts/ai/sketch/e2e-done-flow.mjs
// Uses the project's seeded local operator (lib/auth/bootstrap.ts) and pre-accepts the consent dialog
// the way scripts/capture-docs.mjs does; do not point it at a cloud build.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { drawScene } from '../../../lib/sketch/scene-synth.ts'
import { makeWriter } from '../../../lib/sketch/synth.ts'
import { makeRng } from '../../../lib/sketch/rng.ts'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const BASE = process.env.E2E_BASE ?? 'http://localhost:3114'
const ACCOUNT = { email: 'aalubhentakobhi@simblip.dev', password: 'loonivaislobhi', id: 'user-operator' }
const TERMS_VERSION = '2026-09-27'
const { layouts } = JSON.parse(readFileSync(resolve('lib/sketch/golden/scene-layouts.json'), 'utf8'))

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(([v, id]) => {
  try {
    localStorage.setItem(`simblip-consent:${id}`, JSON.stringify({ state: { acceptedVersion: v, analytics: false, storageNoticeSeen: true }, version: 0 }))
  } catch {}
}, [TERMS_VERSION, ACCOUNT.id])
const page = await ctx.newPage()
const consoleErrors = []
const sketchLogs = []
page.on('console', (m) => { if (m.text().startsWith('[sketch]')) { sketchLogs.push(m.text()); if (process.env.E2E_LOGS) console.log('      ' + m.text().slice(0, 200)) } })
page.on('pageerror', (e) => consoleErrors.push(String(e)))

// ── sign in, blank whiteboard ────────────────────────────────────────────────────
await ctx.addInitScript(() => {
  try { localStorage.setItem('simblip-debug-sketch', '1') } catch {}
  document.addEventListener('click', (e) => { const c = e.target?.closest?.('[aria-label="Finish drawing"]'); if (c) console.info('[sketch] CLICK on Done chip at', Math.round(e.clientX), Math.round(e.clientY)) }, true)
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') console.info('[sketch] Enter keydown, target', e.target?.tagName) }, true)
})
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
check('blank whiteboard open', /0 objects/.test(await page.locator('body').innerText()))
const collapse = page.locator('button[aria-label="Collapse sidebar"]')
if (await collapse.count()) await collapse.first().click({ force: true }).catch(() => {})

const penBtn = page.getByRole('button', { name: /^Pen —/ })

// ── settings toggle ──────────────────────────────────────────────────────────────
await penBtn.dblclick()
const toggle = page.getByRole('switch', { name: /Neural symbol recogniser/ })
await toggle.waitFor({ timeout: 10000 })
check('settings toggle shows ON by default', (await toggle.getAttribute('aria-checked')) === 'true')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await penBtn.click()

// ── draw helpers ────────────────────────────────────────────────────────────────
const OX = 300, OY = 150
async function drawStrokes(strokes, { dx = 0, dy = 0, upTo = strokes.length } = {}) {
  for (let i = 0; i < upTo; i++) {
    const pts = strokes[i]
    if (pts.length < 2) continue
    await page.mouse.move(pts[0][0] + OX + dx, pts[0][1] + OY + dy)
    await page.mouse.down()
    for (const p of pts.slice(1)) await page.mouse.move(p[0] + OX + dx, p[1] + OY + dy)
    await page.mouse.up()
    await page.waitForTimeout(40)
  }
}
const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false)
const chip = '[aria-label="Finish drawing"]'
const circuitPreview = '[aria-label="Sketch to circuit"]'
const symbolPreview = '[aria-label="Confirm recognised symbol"]'
const failureCard = '[aria-label="Sketch not recognised"]'
const inkCount = async () => Number((await page.locator('body').innerText()).match(/(\d+) objects?/)?.[1] ?? -1)

// a labelled circuit whose value labels are drawn LAST, apart from the wiring (the Done-scope case)
const rng = makeRng(500)
const scene = drawScene(layouts[0], rng.fork('s'), makeWriter(rng.fork('w'), 'dm-0-mouse', 'mouse'), undefined, undefined, { text: true })
const idxs = scene.strokes.map((_, k) => k)
const isText = (k) => scene.roles[k].role === 'text'
const ordered = [...idxs.filter((k) => !isText(k)), ...idxs.filter(isText)].map((k) => scene.strokes[k])
const xs = ordered.flat().map((p) => p[0]), ys = ordered.flat().map((p) => p[1])
console.log(`circuit: ${ordered.length} strokes (${idxs.filter(isText).length} label strokes drawn last), ${Math.round(Math.max(...xs) - Math.min(...xs))}x${Math.round(Math.max(...ys) - Math.min(...ys))} px`)
const norm = ordered.map((s) => s.map(([x, y]) => [x - Math.min(...xs), y - Math.min(...ys)]))

// ── 1. nothing is read while drawing; a chip appears; holding does not read ─────────
let early = false
await drawStrokes(norm, { upTo: norm.length - 1 })
early = (await visible(circuitPreview)) || (await visible(symbolPreview)) || (await visible(failureCard))
check('no preview/failure while still drawing (all but the last stroke)', !early)
await drawStrokes(norm.slice(norm.length - 1).map((s) => s), {})
await page.waitForTimeout(1500) // hold still after the last stroke
check('Done chip appears after the strokes', await visible(chip))
console.log('   chip box', JSON.stringify(await page.locator(chip).first().boundingBox().catch(() => null)))
if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + '/chip.png' })
check('pausing (hold) does NOT start a read', !(await visible(circuitPreview)) && !(await visible(symbolPreview)) && !(await visible(failureCard)))

// ── 2. Enter = Done: processing, then the circuit preview ────────────────────────
if (process.env.E2E_SHOTS) await page.screenshot({ path: process.env.E2E_SHOTS + '/before-enter.png' })
await page.keyboard.press('Enter')
const sawReading = await page.getByText('Reading your sketch').first().isVisible().catch(() => false)
await page.locator(circuitPreview).waitFor({ timeout: 30000 }).catch(() => {})
if (!(await visible(circuitPreview))) {
  for (const [n, sel] of [['symbol preview', symbolPreview], ['failure card', failureCard], ['mechanics', '[aria-label="Sketch to mechanics"]'], ['optics', '[aria-label="Sketch to optics"]']]) if (await visible(sel)) console.log('   instead showed:', n, '—', (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').slice(0, 200))
}
check('Done (Enter) → ONE circuit preview of the whole drawing', await visible(circuitPreview))
const partRows = await page.locator('[aria-label^="Part "][aria-label$=" symbol"]').count()
check('the preview lists the circuit parts (not just the label)', partRows >= layouts[0].ir.nodes.length - 1, `${partRows} parts listed, drawn ${layouts[0].ir.nodes.length}`)
console.log(`   (processing state seen at the first instant: ${sawReading})`)
check('preview offers Make it live', await page.getByRole('button', { name: /Make it live/ }).first().isVisible().catch(() => false))

// ── 3. Escape closes the preview and does NOT switch tool ────────────────────────
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
check('Escape closes the circuit preview', !(await visible(circuitPreview)))
const inkBeforeEsc = await inkCount()
await drawStrokes([[[0, 0], [40, 10], [80, 0]]], { dx: 0, dy: 440 })
check('after Escape the Pen is still the tool (a new stroke is ink)', (await inkCount()) === inkBeforeEsc + 1, `objects ${inkBeforeEsc} → ${await inkCount()}`)

// ── 4. Done again → Make it live → circuit is built ──────────────────────────────
const objsBefore = Number((await page.locator('body').innerText()).match(/(\d+) objects?/)?.[1] ?? -1)
// ink is still there; drawing one more tiny stroke re-arms the chip, or the chip may still be hidden: press Enter via a tiny dot
await drawStrokes([[[5, 5], [8, 8]]], { dx: 0, dy: 400 })
await page.keyboard.press('Enter')
await page.locator(circuitPreview).waitFor({ timeout: 30000 }).catch(() => {})
const reread = await visible(circuitPreview)
check('second Done reads again', reread)
if (reread) {
  await page.getByRole('button', { name: /Make it live/ }).first().click()
  await page.waitForTimeout(2500)
  const objsAfter = Number((await page.locator('body').innerText()).match(/(\d+) objects?/)?.[1] ?? -1)
  check('Make it live replaces the ink with circuit parts', objsAfter !== objsBefore && objsAfter > 0, `objects ${objsBefore} → ${objsAfter}`)
  await page.getByRole('button', { name: 'Play' }).first().click().catch(() => {})
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()
  check('Play starts the simulation (Pause is offered) with no page error', (await page.getByRole('button', { name: /^Pause/ }).count()) > 0 && consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' ; '))
}

// ── 5. toggle OFF persists and disables the chip ─────────────────────────────────
await penBtn.dblclick()
const t2 = page.getByRole('switch', { name: /Neural symbol recogniser/ })
await t2.waitFor({ timeout: 10000 })
await t2.click()
check('toggle flips to OFF', (await t2.getAttribute('aria-checked')) === 'false')
await page.keyboard.press('Escape')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.getByRole('button', { name: /^Pen —/ }).dblclick()
const t3 = page.getByRole('switch', { name: /Neural symbol recogniser/ })
await t3.waitFor({ timeout: 10000 })
check('OFF persists after reload', (await t3.getAttribute('aria-checked')) === 'false')
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /^Pen —/ }).click()
await drawStrokes([[[0, 0], [60, 12], [120, 0]]], { dx: 0, dy: 600 })
await page.waitForTimeout(800)
check('with the setting OFF no Done chip is offered (old instant behaviour)', !(await visible(chip)))

if (process.env.E2E_LOGS) console.log(sketchLogs.join(' ;; '))
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`)
if (consoleErrors.length) console.log('page errors:', consoleErrors.slice(0, 5))
await browser.close()
process.exit(results.every((r) => r.ok) ? 0 : 1)
