#!/usr/bin/env node
// Expand content/courses-src/<course>/*.mjs into content/courses/<course>/*.json
// and lint them.   node scripts/build-courses.mjs [course-id …]
//
// A source module exports  `default (kit) => lessonObject`  and its course
// directory holds course.mjs (the catalogue entry). The JSON is what
// publish-course.mjs ships; the sources exist so a lesson can be regenerated
// when an engine changes (every quoted number is read from the engine).

import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'courses-'))
execFileSync('npx', ['esbuild', join(root, 'lib/steplab/registry.ts'), '--bundle', '--format=esm', `--outfile=${tmp}/r.mjs`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { runEngine } = await import(pathToFileURL(`${tmp}/r.mjs`).href)
const { makeKit } = await import(pathToFileURL(join(root, 'content/courses-src/kit.mjs')).href)

const run = (engine, params) => {
  const r = runEngine({ engine, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })
  if (!r.ok) throw new Error(`${engine}: ${r.error}`)
  return r.trace.summary
}

const only = process.argv.slice(2)
const srcRoot = join(root, 'content/courses-src')
const built = []
for (const dir of readdirSync(srcRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  if (only.length && !only.includes(dir.name)) continue
  const cdir = join(srcRoot, dir.name)
  const { default: manifest } = await import(pathToFileURL(join(cdir, 'course.mjs')).href)
  const out = join(root, 'content/courses', dir.name)
  mkdirSync(out, { recursive: true })
  const order = []
  const lessons = {}
  for (const f of readdirSync(cdir).filter((f) => f.endsWith('.mjs') && f !== 'course.mjs').sort()) {
    const slug = f.replace(/\.mjs$/, '')
    const mod = await import(pathToFileURL(join(cdir, f)).href)
    const kit = makeKit(run)
    const doc = mod.default(kit)
    writeFileSync(join(out, `${slug}.json`), JSON.stringify(doc, null, 2) + '\n')
    const meta = manifest.lessons[slug] ?? {}
    order.push(slug)
    lessons[slug] = { path: meta.path ?? '', title: meta.title ?? doc.title }
    built.push(join('content/courses', dir.name, `${slug}.json`))
  }
  const { lessons: _l, ...rest } = manifest
  writeFileSync(join(out, 'course.json'), JSON.stringify({ ...rest, published: true, order: order.sort((a, b) => (manifest.order ?? []).indexOf(a) - (manifest.order ?? []).indexOf(b)), lessons }, null, 2) + '\n')
  console.log(`${dir.name}: ${order.length} lesson(s)`)
}
if (built.length && !process.env.NO_LINT) {
  execFileSync(process.execPath, [join(root, '.claude/skills/course-author/lint-course.mjs'), ...built], { cwd: root, stdio: 'inherit' })
}
