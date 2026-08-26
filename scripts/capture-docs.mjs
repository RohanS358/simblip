// Regenerates the /docs screenshots in public/docs/ from the REAL app.
//
// The manual's figures are captured, not drawn, so they cannot drift from the
// product — but they DO go stale when the UI changes, and this is how you
// refresh them.
//
// It drives a LOCAL-MODE build: with NEXT_PUBLIC_CLOUD unset the accounts live
// in the in-browser database (lib/auth/bootstrap.ts) and page content is
// local-only, so nothing here can touch the production database. Do not point
// it at a cloud build.
//
//   NEXT_PUBLIC_CLOUD=0 npm run build
//   NEXT_PUBLIC_CLOUD=0 npx next start -p 3114
//   node scripts/capture-docs.mjs                 # both themes -> public/docs
//
// Requires playwright-core + a chromium (npx playwright install chromium).

import { mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const pw = require('playwright-core')
const sharp = require('sharp')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEST = path.join(ROOT, 'public', 'docs')
const TMP = path.join(ROOT, '.docs-shots')
const BASE = process.env.DOCS_BASE ?? 'http://localhost:3114'

// The seeded local operator (lib/auth/bootstrap.ts). Local mode only.
const ACCOUNT = { email: 'aalubhentakobhi@simblip.dev', password: 'loonivaislobhi', id: 'user-operator' }
const TERMS_VERSION = '2026-08-13'

const VIEWPORT = { width: 1440, height: 900 }
const SIDEBAR = { x: 0, y: 60, width: 458, height: 800 }
const BOARD = { x: 700, y: 70, width: 620, height: 640 }

async function signIn(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type=text]').fill(ACCOUNT.email)
  await page.locator('input[type=password]').fill(ACCOUNT.password)
  await page.locator('button:has-text("Sign in")').click()
  await page.waitForTimeout(6000)
  const state = await ctx.storageState()
  await ctx.close()
  return state
}

/** First load of a fresh profile seeds the notebook AND auto-starts the guided
 *  walkthrough, which then clicks things on its own. Burn that first load here:
 *  stop the walkthrough, then hand back a state whose tree is non-empty, so
 *  seedFirstRun() is false for every capture that follows. */
async function warmUp(browser, storageState) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, storageState })
  await ctx.addInitScript(
    ([v, id]) => {
      try {
        localStorage.setItem(`simblip-consent:${id}`,
          JSON.stringify({ state: { acceptedVersion: v, analytics: false, storageNoticeSeen: true }, version: 0 }))
      } catch {}
    },
    [TERMS_VERSION, ACCOUNT.id]
  )
  const page = await ctx.newPage()
  await page.goto(`${BASE}/notebook`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(9000)
  const exit = page.locator('button[title="Exit Walkthrough"]')
  if (await exit.count()) { await exit.first().click({ force: true }); await page.waitForTimeout(1200) }
  const gallery = page.locator('button[aria-label="Note Gallery (Ctrl+N)"]')
  if ((await gallery.count()) && (await page.locator('text=Note Gallery').count())) {
    await gallery.first().click({ force: true }); await page.waitForTimeout(800)
  }
  await page.locator('button:has-text("Welcome")').first().click({ force: true }).catch(() => {})
  await page.waitForTimeout(1500)
  const state = await ctx.storageState()
  await ctx.close()
  return state
}

async function capture(browser, storageState, theme) {
  const out = path.join(TMP, theme)
  mkdirSync(out, { recursive: true })

  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    storageState,
  })
  // Consent and theme are per-account localStorage, seeded rather than clicked.
  await ctx.addInitScript(
    ([t, v, id]) => {
      try {
        localStorage.setItem(
          `simblip-consent:${id}`,
          JSON.stringify({ state: { acceptedVersion: v, analytics: false, storageNoticeSeen: true }, version: 0 })
        )
        localStorage.setItem('theme', t)
      } catch {}
    },
    [theme, TERMS_VERSION, ACCOUNT.id]
  )

  const page = await ctx.newPage()
  const shot = (name, clip) => page.screenshot({ path: path.join(out, `${name}.png`), ...(clip ? { clip } : {}) })

  const pressed = async (label) =>
    (await page.locator(`button[aria-label="${label}"]`).first().getAttribute('aria-pressed')) === 'true'
  const section = async (label) => {
    if (!(await pressed(label))) { await page.click(`button[aria-label="${label}"]`); await page.waitForTimeout(850) }
  }
  // Clicking the ACTIVE rail icon collapses the pane — that is how a board
  // shot gets the canvas to itself.
  const collapse = async () => {
    for (const l of ['Components', 'Notebook', 'Properties', 'Tools', 'Assistant', 'Library', 'Uploads']) {
      if (await pressed(l)) { await page.click(`button[aria-label="${l}"]`); await page.waitForTimeout(600); return }
    }
  }
  const newBoard = async (name) => {
    await section('Notebook')
    await page.locator('button[aria-label="Add page"]').first().click(); await page.waitForTimeout(1100)
    await page.locator('button:has-text("Whiteboard")').first().click(); await page.waitForTimeout(1100)
    const nb = page.locator('[role=dialog] input').first()
    if (await nb.count()) await nb.fill(name)
    await page.locator('[role=dialog] button:has-text("Create")').first().click(); await page.waitForTimeout(2600)
  }
  /** Arm a palette component, then drop one at each point. It stays armed. */
  const arm = async (name, ...points) => {
    await section('Components')
    const b = page.locator('button').filter({ hasText: new RegExp(`^${name}$`) }).first()
    await b.scrollIntoViewIfNeeded(); await page.waitForTimeout(200)
    await b.click({ force: true, timeout: 8000 }); await page.waitForTimeout(300)
    for (const [x, y] of points) { await page.mouse.click(x, y); await page.waitForTimeout(420) }
    await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  }

  await page.goto(`${BASE}/notebook`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(6500)

  // A genuinely empty profile makes shell.tsx's seedFirstRun() fire, which
  // auto-starts the guided walkthrough and then drives the UI on its own —
  // every click after that lands somewhere unintended. warmUp() below is what
  // normally prevents it; this is the belt-and-braces stop.
  const exit = page.locator('button[title="Exit Walkthrough"]')
  if (await exit.count()) { await exit.first().click({ force: true }); await page.waitForTimeout(1200) }

  await shot('workspace')

  // Element shots, not guessed clips: a hand-tuned clip silently crops the
  // dialog the moment its size changes.
  await section('Notebook')
  await page.locator('button[aria-label="Add page"]').first().click(); await page.waitForTimeout(1400)
  await page.locator('[data-slot=dialog-content], [role=dialog]').first()
    .screenshot({ path: path.join(out, 'add-page.png') })
  await page.keyboard.press('Escape'); await page.waitForTimeout(800)

  for (const [label, name] of [
    ['Notebook', 'panel-notebook'], ['Components', 'panel-components'], ['Tools', 'panel-tools'],
    ['Assistant', 'panel-assistant'], ['Library', 'panel-library'], ['Uploads', 'panel-uploads'],
  ]) { await section(label); await shot(name, SIDEBAR) }

  // Properties needs a body with behaviors on it, so place one deliberately
  // rather than clicking a remembered coordinate and hoping.
  await newBoard(`Props ${theme}`)
  await arm('Mass', [950, 320])
  await page.mouse.click(950, 320); await page.waitForTimeout(700)   // select it
  await section('Properties'); await page.waitForTimeout(1200)
  // Scroll the panel down to the Behaviors block — the part worth showing.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (e) => e.scrollHeight > e.clientHeight + 80 && e.clientHeight > 400 && e.getBoundingClientRect().left < 460
    )
    if (el) el.scrollTop = el.scrollHeight
  })
  await page.waitForTimeout(900)
  await shot('panel-properties', SIDEBAR)
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)

  await shot('dock', { x: 640, y: 800, width: 500, height: 72 })
  await page.locator('button[aria-label="Play"]').first().locator('xpath=..')
    .screenshot({ path: path.join(out, 'transport.png') })

  await page.click('button[aria-label="Account menu"]'); await page.waitForTimeout(800)
  await page.locator('[role=menuitem]').filter({ hasText: /Settings/ }).first().click()
  await page.waitForTimeout(1800)
  // Appearance rather than General: it is the richer tab, and General puts the
  // signed-in account's email address into a public screenshot.
  await page.locator('button').filter({ hasText: /^Appearance/ }).first().click({ force: true })
  await page.waitForTimeout(1200)
  await page.mouse.move(700, 500)          // drop the close button's focus ring
  await page.waitForTimeout(400)
  await page.locator('[data-slot=dialog-content], [role=dialog]').first()
    .screenshot({ path: path.join(out, 'settings.png') })
  await page.keyboard.press('Escape'); await page.waitForTimeout(900)

  // Three frames of ONE run — how a still image shows motion.
  await newBoard(`Mechanics ${theme}`)
  await arm('Ground', [950, 640])
  await arm('Mass', [850, 170], [990, 110])
  await arm('Block', [1080, 210])
  await collapse()
  await shot('sim-before', BOARD)
  await page.click('button[aria-label="Play"]'); await page.waitForTimeout(400)
  await shot('sim-during', BOARD)
  await page.waitForTimeout(2600)
  await shot('sim-after', BOARD)
  await page.click('button[aria-label="Reset simulation"]'); await page.waitForTimeout(700)

  await newBoard(`Circuit ${theme}`)
  await arm('Battery', [780, 300]); await arm('Resistor', [1000, 300]); await arm('Bulb', [1220, 300])
  await collapse()
  await shot('circuit-parts', { x: 700, y: 180, width: 640, height: 260 })

  await newBoard(`DSA ${theme}`)
  await arm('DSA Lab', [980, 380])
  await collapse(); await page.waitForTimeout(2500)
  await shot('dsa', { x: 480, y: 70, width: 940, height: 700 })

  await ctx.close()
  console.log(`  ${theme} captured`)
}

async function encode() {
  const { readdirSync } = await import('node:fs')
  mkdirSync(DEST, { recursive: true })
  let bytes = 0
  for (const theme of ['light', 'dark']) {
    const dir = path.join(TMP, theme)
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.png'))) {
      const info = await sharp(path.join(dir, f))
        .resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(path.join(DEST, `${f.replace(/\.png$/, '')}-${theme}.webp`))
      bytes += info.size
    }
  }
  console.log(`  encoded ${(bytes / 1024 / 1024).toFixed(2)} MB into public/docs`)
}

const browser = await pw.chromium.launch()
try {
  console.log('signing in (local mode)…')
  let state = await signIn(browser)
  console.log('warming the profile (seeds the notebook, stops the walkthrough)…')
  state = await warmUp(browser, state)
  for (const theme of ['light', 'dark']) await capture(browser, state, theme)
  await encode()
} finally {
  await browser.close()
  rmSync(TMP, { recursive: true, force: true })
}
console.log('done')
