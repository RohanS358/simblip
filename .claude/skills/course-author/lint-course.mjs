#!/usr/bin/env node
// Gate for an authored lesson: every figure's SimScript must be executable,
// and the lesson's own structure must be sound.
//
// Runs headless in plain Node with no model and no browser, against the SAME
// linter the app's AI pipeline uses (lib/ai/simscript-lint.ts) — so a check
// here cannot drift from what actually happens on the canvas.
//
//   node .claude/skills/course-author/lint-course.mjs content/courses/*/*.json
//
// Exit 0 = shippable. Exit 1 = a named repair for every failure.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
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

let failures = 0
const problem = (where, msg) => { failures++; console.error(`  ✗ ${where}: ${msg}`) }

for (const file of files) {
  console.log(`\n${file}`)
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
  let figures = 0, questions = 0, worked = 0, derivations = 0

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

    if (s.question) {
      questions++
      const q = s.question
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
    }

    for (const f of s.figures ?? []) {
      figures++
      const where = `${at} ${f.id ?? '(no id)'}`
      if (!f.id) problem(where, 'figure has no `id`')
      if (!f.caption?.trim()) problem(where, 'figure has no `caption`')
      if (!f.script?.trim()) { problem(where, 'figure has no `script`'); continue }
      if (f.locked && !s.question) {
        problem(where, '`locked` figure in a section with no question — nothing can ever unlock it')
      }
      const r = lintSimScript(f.script)
      if (!r.ok) for (const e of r.errors) problem(where, e)
      for (const w of r.warnings ?? []) console.warn(`  ~ ${where}: ${w}`)
    }
  }

  // Depth: the skill's whole point is that a lesson is not a handout.
  if (doc.sections.length < 6) {
    problem(file, `only ${doc.sections.length} sections — a lesson wants 8-14`)
  }
  if (figures === 0) problem(file, 'no figures at all')
  if (questions === 0) problem(file, 'no MCQ — a lesson with nothing to answer is a handout')
  if (worked === 0) problem(file, 'no worked numerical')

  if (failures === 0) {
    console.log(`  ✓ ${doc.sections.length} sections · ${figures} figures · ${derivations} derivations · ${worked} worked · ${questions} questions`)
  }
}

rmSync(dir, { recursive: true, force: true })

if (failures) {
  console.error(`\n${failures} problem${failures === 1 ? '' : 's'} — not shippable.`)
  process.exit(1)
}
console.log('\nAll lessons pass.')
