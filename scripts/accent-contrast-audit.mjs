#!/usr/bin/env node
// Accent-color contrast audit (UX masterplan §22/§27.6): checks every
// --accent-* color against --background and --card in every theme in
// app/globals.css, so a new theme or a retuned accent can't silently ship
// text nobody can read. Parses the CSS directly (not a hand-copied snapshot
// of the values) so it can't drift out of sync with the source of truth.
//
// Run: node scripts/accent-contrast-audit.mjs
// Exits non-zero if any accent fails WCAG AA for normal text (4.5:1)
// against the surface it's most commonly rendered on (--background).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CSS_PATH = path.join(__dirname, '..', 'app', 'globals.css')

const ACCENTS = ['accent-blue', 'accent-violet', 'accent-mint', 'accent-amber', 'accent-rose']
const SURFACES = ['background', 'card']
const AA_TEXT = 4.5 // WCAG AA, normal text
const AA_LARGE = 3.0 // WCAG AA, large text / UI components

// ── oklch → linear sRGB (Björn Ottosson's reference matrices) ──────────────
function oklchToLinearSrgb(L, C, H) {
  const hRad = (H * Math.PI) / 180
  const a = C * Math.cos(hRad)
  const b = C * Math.sin(hRad)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  }
}

// WCAG relative luminance is defined over linear-light sRGB channels, which
// is exactly what the oklab conversion above already produces — clamp for
// out-of-gamut oklch values (some accent hues at high chroma clip slightly).
function relativeLuminance({ r, g, b }) {
  const c = (v) => Math.min(1, Math.max(0, v))
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}

function contrastRatio(oklchA, oklchB) {
  const lA = relativeLuminance(oklchToLinearSrgb(...oklchA))
  const lB = relativeLuminance(oklchToLinearSrgb(...oklchB))
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA]
  return (lighter + 0.05) / (darker + 0.05)
}

// ── Parse app/globals.css into { themeName: { varName: [L, C, H] } } ───────
function parseThemes(css) {
  const themes = {}
  const blockRe = /(:root|\.[\w-]+)\s*\{([^}]*)\}/g
  let m
  while ((m = blockRe.exec(css))) {
    const selector = m[1]
    const name = selector === ':root' ? 'default' : selector.slice(1)
    const body = m[2]
    const vars = {}
    const varRe = /--([\w-]+):\s*oklch\(([^)]+)\)/g
    let vm
    while ((vm = varRe.exec(body))) {
      const nums = vm[2].trim().split(/\s+/).map(Number)
      if (nums.length >= 3 && nums.every((n) => Number.isFinite(n))) vars[vm[1]] = nums
    }
    if (Object.keys(vars).length > 0) themes[name] = { ...themes[name], ...vars }
  }
  return themes
}

function fmt(ratio) {
  return ratio.toFixed(2).padStart(5) + ':1'
}

function main() {
  const css = readFileSync(CSS_PATH, 'utf8')
  const themes = parseThemes(css)
  let failures = 0
  let checked = 0

  for (const [themeName, vars] of Object.entries(themes)) {
    console.log(`\n${themeName}`)
    for (const accent of ACCENTS) {
      const accentVal = vars[accent]
      if (!accentVal) continue
      const cells = []
      for (const surface of SURFACES) {
        const surfaceVal = vars[surface]
        if (!surfaceVal) continue
        checked++
        const ratio = contrastRatio(accentVal, surfaceVal)
        const pass = ratio >= AA_TEXT
        if (!pass) failures++
        const badge = pass ? 'AA' : ratio >= AA_LARGE ? 'AA-large only' : 'FAIL'
        cells.push(`vs ${surface.padEnd(10)} ${fmt(ratio)}  ${badge}`)
      }
      console.log(`  ${accent.padEnd(14)} ${cells.join('   ')}`)
    }
  }

  console.log(`\n${checked} pairs checked, ${failures} below AA (4.5:1) for normal text.`)
  if (failures > 0) process.exit(1)
}

main()
