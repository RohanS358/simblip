// Analyze an AI sweep: run the REAL placement / lint / slide-building code
// over every captured response and report what would actually land where.
//
// This is the part a screenshot cannot do at scale — it checks every object's
// rect against the surface's real frame, so "it goes out of the visible
// slide" becomes a number instead of an impression.
//
// Usage: node scripts/ai-sweep-analyze.mjs [.sweep/raw.json]

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = mkdtempSync(join(tmpdir(), 'simblip-sweep-'))
const entry = join(dir, 'entry.ts')
const bundle = join(dir, 'b.mjs')

writeFileSync(entry, `
export { placeAnswerAndScene, clampToBounds } from '@/lib/ai/placement'
export { answerColumnSize, blocksToSimScript } from '@/lib/ai/explain'
export { blocksToSlides, deckTitle } from '@/lib/ai/slides'
export { lintSimScript } from '@/lib/ai/simscript-lint'
export { classifyIntent, wantsSlides } from '@/lib/ai/route-intent'
export { SLIDE_W, SLIDE_H, SHEET_W, SHEET_H } from '@/lib/scene/frames'
`)
execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${bundle}`,
  `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })

const M = await import(bundle)
const {
  placeAnswerAndScene, answerColumnSize, blocksToSlides, deckTitle,
  lintSimScript, classifyIntent, wantsSlides, SLIDE_W, SLIDE_H, SHEET_W, SHEET_H,
} = M

const BOARD = { w: 1200, h: 800 }
const frameFor = (s) =>
  s === 'slides' ? { w: SLIDE_W, h: SLIDE_H } : s === 'doc' ? { w: SHEET_W, h: SHEET_H } : BOARD
const boundsFor = (s) => { const f = frameFor(s); return { left: 0, top: 0, right: f.w, bottom: f.h } }


/** Actual footprint the script declares, read from the `system` box it
 *  creates (the corpus tells the model to size that box to fit the scene).
 *  Falls back to the max extent of any positioned create() call. */
function scriptExtent(src) {
  const sys = /create\(\s*["']system["']\s*,\s*\{([^}]*)\}/.exec(src)
  if (sys) {
    const w = /width:\s*(\d+)/.exec(sys[1]), h = /height:\s*(\d+)/.exec(sys[1])
    if (w && h) return { w: +w[1], h: +h[1], from: 'system' }
  }
  let mx = 0, my = 0, seen = false
  const re = /create\(\s*["'][^"']+["']\s*,\s*\{([^}]*)\}/g
  let m
  while ((m = re.exec(src))) {
    const x = /(?:^|[,{\s])x:\s*(-?\d+)/.exec(m[1]), y = /(?:^|[,{\s])y:\s*(-?\d+)/.exec(m[1])
    const w = /width:\s*(\d+)/.exec(m[1]), h = /height:\s*(\d+)/.exec(m[1])
    if (!x && !y) continue
    seen = true
    mx = Math.max(mx, (x ? +x[1] : 0) + (w ? +w[1] : 120))
    my = Math.max(my, (y ? +y[1] : 0) + (h ? +h[1] : 80))
  }
  return seen ? { w: mx, h: my, from: 'extent' } : null
}

const raw = JSON.parse(readFileSync(process.argv[2] || '.sweep/raw.json', 'utf8'))
const rows = []

for (const r of raw) {
  const issues = []
  const b = boundsFor(r.surface)
  const frame = frameFor(r.surface)
  const intent = classifyIntent(r.prompt)

  // --- lane sanity: did the router send it where the surface needs it? ---
  if (r.surface === 'canvas' && !r.hasScript) issues.push('CANVAS-NO-SCRIPT')
  if (r.surface === 'slides' && !r.blockCount) issues.push('SLIDES-NO-BLOCKS')
  if (r.surface === 'doc' && !r.blockCount) issues.push('DOC-NO-BLOCKS')
  if (/error|failed|unavailable/i.test(r.message || '')) issues.push('ERROR-MSG')

  // --- lint the script the way the pipeline does ---
  let lint = null
  if (r.script) {
    try {
      lint = lintSimScript(r.script)
      const errs = lint?.errors ?? lint ?? []
      if (Array.isArray(errs) && errs.length) issues.push(`LINT(${errs.length})`)
    } catch (e) { issues.push(`LINT-THREW:${e.message.slice(0, 40)}`) }
  }

  // --- how big is the scene REALLY, vs the 520x400 placement assumes? ---
  const ext = r.script ? scriptExtent(r.script) : null
  if (ext) {
    if (ext.w > 520 || ext.h > 400) issues.push(`SCENE-BIGGER-THAN-ASSUMED(${ext.w}x${ext.h} vs 520x400)`)
    if (ext.w > frame.w || ext.h > frame.h) issues.push(`SCENE-BIGGER-THAN-FRAME(${ext.w}x${ext.h} vs ${frame.w}x${frame.h})`)
  }

  // --- placement: where would this actually land on this surface? ---
  //
  // A slides prompt does NOT place the answer column: blocksToSlides() splits
  // it into a deck and each slide is checked against the 960x540 frame above.
  // Measuring the un-split column against one slide reports a 1300px
  // "overflow" for a deck that is actually fine, so skip the answer here and
  // let the deck check speak.
  let place = null
  const placesAnswer = r.surface !== 'slides'
  if ((r.blockCount && placesAnswer) || r.hasScript) {
    const size = r.blockCount && placesAnswer ? answerColumnSize(r.blocks) : null
    place = placeAnswerAndScene(size, !!r.script, b)
    if (place.answer && size) {
      const right = place.answer.x + size.w, bottom = place.answer.y + size.h
      if (place.answer.x < b.left - 0.5 || right > b.right + 0.5) issues.push('ANSWER-OFF-X')
      if (place.answer.y < b.top - 0.5) issues.push('ANSWER-OFF-TOP')
      if (bottom > b.bottom + 0.5) issues.push(`ANSWER-OVERFLOW-Y(${Math.round(bottom - b.bottom)}px)`)
    }
    if (place.scene) {
      const S = { w: 520, h: 400 }
      if (place.scene.x < b.left - 0.5 || place.scene.x + S.w > b.right + 0.5) issues.push('SCENE-OFF-X')
      if (place.scene.y + S.h > b.bottom + 0.5) issues.push(`SCENE-OVERFLOW-Y(${Math.round(place.scene.y + S.h - b.bottom)}px)`)
    }
  }

  // --- slides: build the real deck and check every object against the frame ---
  let deck = null
  if (r.surface === 'slides' && r.blockCount) {
    try {
      const slides = blocksToSlides(r.blocks, deckTitle(r.answer || "", r.prompt))
      deck = { count: slides.length, empty: 0, off: 0, maxBottom: 0 }
      slides.forEach((objs, si) => {
        if (!objs || objs.length === 0) { deck.empty++; return }
        for (const o of objs) {
          const x = o.position?.x ?? 0, y = o.position?.y ?? 0
          const w = o.size?.w ?? 0, h = o.size?.h ?? 0
          deck.maxBottom = Math.max(deck.maxBottom, y + h)
          if (x < -0.5 || y < -0.5 || x + w > SLIDE_W + 0.5 || y + h > SLIDE_H + 0.5) deck.off++
        }
      })
      if (deck.count === 0) issues.push('DECK-EMPTY')
      if (deck.empty) issues.push(`DECK-EMPTY-SLIDES(${deck.empty})`)
      if (deck.off) issues.push(`DECK-OFF-FRAME(${deck.off} objs, maxBottom=${Math.round(deck.maxBottom)}/${SLIDE_H})`)
    } catch (e) { issues.push(`DECK-THREW:${e.message.slice(0, 60)}`) }
  }

  rows.push({
    i: r.i, config: r.config ?? 'default', surface: r.surface, prompt: r.prompt, ms: r.ms, intent,
    wantsSlides: wantsSlides(r.prompt),
    blocks: r.blockCount, script: r.hasScript,
    answerH: r.blockCount ? answerColumnSize(r.blocks).h : 0,
    frameH: frame.h,
    place, deck, ext, issues,
  })
}

writeFileSync('.sweep/analysis.json', JSON.stringify(rows, null, 2))

// ---- report ----
const tally = {}
for (const r of rows) for (const is of r.issues) {
  const k = is.replace(/\(.*\)/, '')
  tally[k] = (tally[k] || 0) + 1
}
const bad = rows.filter((r) => r.issues.length)
console.log(`\n=== AI SWEEP: ${rows.length} prompts, ${bad.length} with issues ===\n`)
for (const s of ['canvas', 'slides', 'doc']) {
  const sub = rows.filter((r) => r.surface === s)
  if (!sub.length) continue
  const nbad = sub.filter((r) => r.issues.length).length
  console.log(`${s.toUpperCase()}: ${sub.length} prompts, ${nbad} with issues`)
  for (const r of sub) {
    const flag = r.issues.length ? '✗' : '✓'
    console.log(`  ${flag} [${r.i}] ${r.intent.padEnd(8)} blocks=${String(r.blocks).padStart(2)} script=${r.script ? 'y' : 'n'} ext=${r.ext ? r.ext.w + 'x' + r.ext.h : '-'} answerH=${String(r.answerH).padStart(5)}/${r.frameH}${r.deck ? ` deck=${r.deck.count}` : ''} ${r.issues.join(' ')}`)
  }
  console.log('')
}
console.log('ISSUE TALLY:')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`)

// ---- configuration leaderboard ----
//
// The point of a multi-config run. Clean-rate against median latency is the
// whole trade: a smaller model with more examples that holds its clean rate
// is strictly better, because the compute saved is real and the quality lost
// is zero. Median, not mean — one cold start would otherwise decide the
// ranking.
const configs = [...new Set(rows.map((r) => r.config))]
if (configs.length > 1) {
  const median = (xs) => {
    const a = [...xs].sort((x, y) => x - y)
    return a.length ? Math.round(a[Math.floor(a.length / 2)]) : 0
  }
  console.log('\nCONFIGURATION LEADERBOARD (clean = no issues of any kind):')
  console.log(`  ${'config'.padEnd(34)} ${'n'.padStart(4)} ${'clean'.padStart(7)} ${'lint-clean'.padStart(11)} ${'median ms'.padStart(10)}`)
  const table = configs.map((c) => {
    const sub = rows.filter((r) => r.config === c)
    const scripts = sub.filter((r) => r.script)
    return {
      c,
      n: sub.length,
      clean: sub.filter((r) => !r.issues.length).length / sub.length,
      // Reported separately because it is the number the SimScript lane is
      // actually tuned against — placement and deck issues are a different
      // lane's problem and would muddy the comparison.
      lint: scripts.length
        ? scripts.filter((r) => !r.issues.some((i) => i.startsWith('LINT'))).length / scripts.length
        : null,
      ms: median(sub.map((r) => r.ms)),
    }
  }).sort((a, b) => b.clean - a.clean || a.ms - b.ms)
  for (const t of table) {
    const pct = (v) => (v === null ? '    n/a' : `${(v * 100).toFixed(0).padStart(5)}%`)
    console.log(`  ${t.c.padEnd(34)} ${String(t.n).padStart(4)} ${pct(t.clean).padStart(7)} ${pct(t.lint).padStart(11)} ${String(t.ms).padStart(10)}`)
  }
}
