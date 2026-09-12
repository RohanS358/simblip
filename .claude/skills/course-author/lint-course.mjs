#!/usr/bin/env node
// Gate for an authored lesson: every figure's SimScript must be executable,
// the numbers the prose claims must be the numbers the SOLVER produces, and
// the lesson's own structure must be sound.
//
// Runs headless in plain Node with no model and no browser, against the SAME
// linter the app's AI pipeline uses (lib/ai/simscript-lint.ts) and the SAME
// circuit solver the canvas runs (lib/circuit/engine.ts) — so a check here
// cannot drift from what actually happens on the canvas.
//
//   node .claude/skills/course-author/lint-course.mjs content/courses/*/*.json
//
// Exit 0 = shippable. Exit 1 = a named repair for every failure.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const files = process.argv.slice(2)

if (files.length === 0) {
  console.error('usage: lint-course.mjs <lesson.json> [...]')
  process.exit(2)
}

// Build the real linter once, then reuse it for every figure.
const dir = mkdtempSync(join(tmpdir(), 'course-lint-'))
const bundle = join(dir, 'lint.mjs')
try {
  execFileSync('npx', ['esbuild', resolve(ROOT, 'lib/ai/simscript-lint.ts'),
    '--bundle', '--format=esm', '--outfile=' + bundle, '--alias:@=' + ROOT],
    { stdio: 'pipe' })
} catch (e) {
  console.error('could not build the linter:', e.message)
  process.exit(2)
}
const { lintSimScript } = await import(bundle)

// ── The solver, headless ────────────────────────────────────────────────────
//
// A figure's `expect` names what an instrument in it must read. Checking that
// by eye is how a lesson ends up asserting 9 V beside a meter showing 0 V —
// which is exactly what happened here, for months, because nothing ran the
// circuits. So the gate runs them: the real executeSimScript builds the scene,
// the real buildCircuit/stepCircuit solve it, and the reading is compared to
// the authored one.
//
// The doc store is a browser module (zustand + persistence), so it is aliased
// to the same minimal stub lib/scene/simscript-connect.test.mjs uses. Nothing
// else is faked: the layout pass, the wire router and the solver are the
// shipping code.
const storeStub = join(dir, 'stub-store.mjs')
writeFileSync(storeStub, `
let pages = {}
export const useDocStore = {
  getState: () => ({
    pages,
    addObject(pageId, obj) { (pages[pageId] ??= { objects: {} }).objects[obj.id] = obj },
    updateObject(pageId, id, patch) {
      const cur = pages[pageId]?.objects?.[id]
      if (cur) pages[pageId].objects[id] = { ...cur, ...patch }
    },
    ensurePage(pageId) { pages[pageId] ??= { objects: {} } },
    upsertVariable(pageId, name, expr) {
      const vars = (pages[pageId].variables ??= [])
      const existing = vars.find((v) => v.name === name)
      if (existing) existing.expr = expr
      else vars.push({ id: name, name, expr, value: 0 })
    },
  }),
  setState: (fn) => { if (typeof fn === 'function') { const r = fn({ pages }); if (r?.pages) for (const k of Object.keys(r.pages)) pages[k] = r.pages[k] } },
  __reset: () => { pages = {} },
  __objects: (pageId) => Object.values(pages[pageId]?.objects ?? {}),
}
`)
const wsStub = join(dir, 'ws-stub.ts')
writeFileSync(wsStub, `
export const findPageMeta = () => undefined
export const useWorkspaceStore = { getState: () => ({ nodes: {} }) }
`)
const solveEntry = join(dir, 'solve-entry.ts')
writeFileSync(solveEntry, `
export { executeSimScript } from '@/lib/scene/simscript'
export { useDocStore } from '@/lib/store/document'
export { buildCircuit, stepCircuit } from '@/lib/circuit/engine'
`)
const solveBundle = join(dir, 'solve.mjs')
let solver = null
try {
  execFileSync('npx', ['esbuild', solveEntry, '--bundle', '--format=esm', '--outfile=' + solveBundle,
    '--alias:@/lib/store/document=' + storeStub, '--alias:@/lib/store/workspace=' + wsStub,
    '--alias:@=' + ROOT, '--external:react', '--external:zustand'], { stdio: 'pipe' })
  solver = await import(solveBundle)
} catch (e) {
  // Not fatal: the structural and SimScript checks still run. `expect` blocks
  // then report as unverifiable rather than silently passing.
  console.warn('  ~ could not build the headless solver, so `expect` cannot be checked:', e.message)
}

let runSeq = 0

/** Run one figure's script and return every instrument reading in it, keyed by
 *  the object `name` the script gave. Steps for a simulated second: the solver
 *  integrates capacitors and machines, so a reading is only meaningful once
 *  it has settled. */
function readInstruments(script) {
  const pageId = `lint-${runSeq++}`
  solver.useDocStore.getState().ensurePage(pageId)
  solver.executeSimScript(pageId, script, { x: 0, y: 0 })
  const objects = solver.useDocStore.getState().pages[pageId].objects
  const circuit = solver.buildCircuit(Object.values(objects))
  if (!circuit) return null
  const dt = 1 / 120
  for (let t = 0; t < 1; t += dt) solver.stepCircuit(circuit, dt, t, objects)
  const out = new Map()
  for (const [id, r] of circuit.frame.readings) {
    const o = objects[id]
    if (o?.name && r.text !== undefined) out.set(o.name, r.text)
  }
  return out
}

/** Build and (where there is a circuit) solve one figure.
 *
 *  EVERY figure is run, not just the ones with `expect`. The SimScript linter
 *  reads a script; only running it catches what reading cannot — a diagram
 *  whose source has a typo'd edge, a control aimed at an object that was
 *  removed, anything that throws. A lesson figure that throws renders as its
 *  caption and nothing else, which is exactly the failure a reader cannot
 *  report and the author never sees. */
function checkFigureRuns(where, f) {
  if (!solver) return null
  try {
    return { readings: readInstruments(f.script) }
  } catch (e) {
    problem(where, `the script throws when run: ${e.message}`)
    return null
  }
}

/** `expect: { "am": "27.3 mA" }` — every named instrument must read exactly
 *  that once the circuit settles. Exact, not approximate: the reading is what
 *  a student sees, and "about right" is how a lesson drifts away from its own
 *  figures. */
function checkExpect(where, f, run) {
  if (!f.expect) return
  if (!solver) { problem(where, '`expect` cannot be checked — the headless solver did not build'); return }
  if (!run) return // it already failed to build; one report is enough
  const readings = run.readings
  if (!readings) {
    problem(where, '`expect` is set but the figure builds no circuit — only circuit figures have instrument readings')
    return
  }
  for (const [name, want] of Object.entries(f.expect)) {
    const got = readings.get(name)
    if (got === undefined) {
      const known = [...readings.keys()]
      problem(where, `expect names "${name}", which reads nothing — instruments in this figure: ${known.length ? known.join(', ') : '(none named; give the meter a `name`)'}`)
    } else if (got !== want) {
      problem(where, `expect "${name}" = ${want}, but the solver reads ${got} — fix the figure or fix the number the prose quotes`)
    }
  }
}

let failures = 0
const problem = (where, msg) => { failures++; console.error(`  ✗ ${where}: ${msg}`) }

for (const file of files) {
  console.log(`\n${file}`)
  const failuresBefore = failures
  let doc
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    problem(file, `not valid JSON — ${e.message}`)
    continue
  }

  if (!doc.title) problem(file, 'no `title`')
  if (!Array.isArray(doc.sections) || doc.sections.length === 0) {
    problem(file, 'no `sections` array')
    continue
  }

  const ids = new Set()
  const figureIds = new Set()
  let figures = 0, questions = 0, problems = 0, worked = 0, derivations = 0

  // Every figure — section figure, a question's `verify`, a problem's
  // `verify` — goes through the same checks, because every one of them is
  // built into its own scratch page and run by the reader.
  const checkFigure = (at, f, { unlockable }) => {
    figures++
    const where = `${at} ${f.id ?? '(no id)'}`
    if (!f.id) problem(where, 'figure has no `id`')
    else if (figureIds.has(f.id)) {
      problem(where, `duplicate figure id "${f.id}" — figures share one scratch-page namespace per lesson, so a repeat renders the wrong scene`)
    } else figureIds.add(f.id)
    if (!f.caption?.trim()) problem(where, 'figure has no `caption`')
    if (!f.script?.trim()) { problem(where, 'figure has no `script`'); return }
    if (f.locked && !unlockable) {
      problem(where, '`locked` figure in a section with no question — nothing can ever unlock it')
    }
    const r = lintSimScript(f.script)
    if (!r.ok) for (const e of r.errors) problem(where, e)
    for (const w of r.warnings ?? []) console.warn(`  ~ ${where}: ${w}`)
    if (r.ok) checkExpect(where, f, checkFigureRuns(where, f))
  }

  const checkQuestion = (at, q) => {
    questions++
    if (!q.prompt?.trim()) problem(at, 'question has no `prompt`')
    if (!Array.isArray(q.choices) || q.choices.length < 2) {
      problem(at, 'question needs at least two `choices`')
    } else {
      const right = q.choices.filter((c) => c.correct).length
      if (right !== 1) problem(at, `question has ${right} correct choices — exactly one is required`)
      if (!Array.isArray(q.responses) || q.responses.length !== q.choices.length) {
        problem(at, 'every choice needs its own response — a wrong answer routes to ITS misconception, never to a score')
      } else {
        q.responses.forEach((r, i) => {
          if (!r?.title?.trim() || !r?.body?.trim()) problem(at, `response ${i + 1} is empty`)
          if (/^(incorrect|wrong|try again)\b/i.test(r?.title ?? '')) {
            problem(at, `response ${i + 1} scolds ("${r.title}") — name the misconception instead`)
          }
        })
      }
    }
    // A verification figure is held back until the reader answers, so it is
    // never "given away" and never needs `locked`.
    if (q.verify) {
      if (q.verify.locked) problem(at, `verify figure "${q.verify.id}" sets \`locked\` — it is already held back until the question is answered`)
      checkFigure(at, q.verify, { unlockable: true })
    }
  }

  for (const s of doc.sections) {
    const at = `${file} §${s.locator ?? '?'}`
    if (!s.id) problem(at, 'section has no `id`')
    else if (ids.has(s.id)) problem(at, `duplicate section id "${s.id}"`)
    else ids.add(s.id)
    if (!s.title) problem(at, 'section has no `title`')

    // Placeholder text is the one thing a human reviewer reliably misses.
    const prose = [s.body, s.after].filter(Boolean).join(' ')
    const filler = prose.match(/\b(TODO|TKTK|lorem ipsum|placeholder|FIXME|XXX)\b/i)
    if (filler) problem(at, `filler text left in prose: "${filler[0]}"`)

    if (s.derivation?.length) {
      derivations++
      s.derivation.forEach((d, i) => {
        if (!d.why?.trim()) problem(at, `derivation step ${i + 1} has no \`why\` — every step is justified before its algebra`)
      })
    }
    if (s.worked?.length) {
      worked++
      s.worked.forEach((w, i) => {
        if (!w.why?.trim()) problem(at, `worked step ${i + 1} has no \`why\``)
      })
    }

    if (s.question) checkQuestion(at, s.question)
    for (const q of s.questions ?? []) checkQuestion(at, q)

    for (const pr of s.problems ?? []) {
      problems++
      if (!pr.prompt?.trim()) problem(at, 'problem has no `prompt`')
      if (!pr.answer?.trim()) {
        problem(at, 'problem has no `answer` — a problem whose answer is never shown is homework, not notes')
      }
      if (pr.verify) checkFigure(at, pr.verify, { unlockable: true })
    }

    const unlockable = !!s.question || !!s.questions?.length
    for (const f of s.figures ?? []) checkFigure(at, f, { unlockable })
  }

  // Depth: the skill's whole point is that a lesson is not a handout.
  if (doc.sections.length < 6) {
    problem(file, `only ${doc.sections.length} sections — a lesson wants 8-14`)
  }
  if (figures === 0) problem(file, 'no figures at all')
  if (questions === 0) problem(file, 'no MCQ — a lesson with nothing to answer is a handout')
  if (worked === 0) problem(file, 'no worked numerical')

  // Per FILE, not per run: linting a directory where one lesson fails used to
  // hide the tick on every lesson that passed, which reads as "nothing
  // worked" when the truth is "one thing did not".
  if (failures === failuresBefore) {
    console.log(`  ✓ ${doc.sections.length} sections · ${figures} figures · ${derivations} derivations · ${worked} worked · ${questions} questions · ${problems} problems`)
  }
}

rmSync(dir, { recursive: true, force: true })

if (failures) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} — not shippable.`)
  process.exit(1)
}
console.log('\nAll lessons pass.')
