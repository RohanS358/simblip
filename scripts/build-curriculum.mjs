#!/usr/bin/env node
// Turns content/curriculum/<program>.mjs into the coverage matrix
// (docs/curriculum/<program>.md) and content/curriculum/index.json.
//   node scripts/build-curriculum.mjs
// Fails if a row names an engine (sim=/neu=) that lib/steplab does not have,
// so the matrix can never claim coverage the app cannot deliver.

import { readdirSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'curr-'))
execFileSync('npx', ['esbuild', join(root, 'lib/steplab/registry.ts'), '--bundle', '--format=esm', `--outfile=${tmp}/r.mjs`, `--alias:@=${root}`], { cwd: root, stdio: 'pipe' })
const { ENGINES } = await import(pathToFileURL(`${tmp}/r.mjs`).href)
const engineIds = new Set(ENGINES.map((e) => e.id))
// Tags that name an existing component/engine outside Step Lab.
const EXISTING = new Set(['circuit', 'mechanics', 'optics', 'waves', 'quantum', 'fields', 'charges', 'thermal', 'cashflow', 'graph', 'formula', 'surface3d', 'table', 'chart', 'dsa', 'diagram', 'truthtable', 'shapes', 'heatSource', 'charge', 'efield', 'bfield', 'dielectric', 'dc-machine', 'induction-motor', 'wave-source', 'wave-boundary', 'transmission-line', 'linecode'])

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const parse = (tags) => {
  const o = { short: '1' }
  for (const t of tags.split(/\s+/).filter(Boolean)) { const [k, v = ''] = t.split('='); o[k] = v }
  const list = (v) => (v && v !== '0' && v !== '1' ? v.split(',').filter(Boolean) : [])
  return { short: o.short !== '0', sim: list(o.sim), simFlag: !!o.sim && o.sim !== '0', diag: o.diag && o.diag !== '0' ? o.diag : '', reuse: list(o.reuse), enh: list(o.enh), neu: list(o.neu) }
}

// Which subjects already have chapter-wise notes (a CourseDoc set under content/courses/<id>/).
const notes = new Map()
for (const d of readdirSync(join(root, 'content/courses'), { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const f = join(root, 'content/courses', d.name, 'course.json')
  if (!existsSync(f)) continue
  const c = JSON.parse(readFileSync(f, 'utf8'))
  notes.set(String(c.code).replace(/\s+/g, ' '), { id: d.name, lessons: (c.order ?? []).length })
}
const files = readdirSync(join(root, 'content/curriculum')).filter((f) => f.endsWith('.mjs'))
const index = []
let problems = 0
for (const f of files) {
  const { program } = await import(pathToFileURL(join(root, 'content/curriculum', f)).href)
  const lines = [`# ${program.title} — coverage matrix`, '', `${program.body}. Generated from \`content/curriculum/${f}\` by \`node scripts/build-curriculum.mjs\` — edit that file, not this one.`, '',
    'Every chapter is put through the six questions:', '',
    '| # | Question | Meaning |', '|---|---|---|', '| Q1 | Short & simple? | can it be explained simply and briefly |', '| Q2 | Simulation? | can a simulation teach the concept better than prose |', '| Q3 | Diagram? | does a flow / sequence / UML / block / animated diagram help |', '| Q4 | Reuse | which existing component or engine serves it |', '| Q5 | Enhance | which existing component had to be extended |', '| Q6 | New | which new component or engine was built |', '']
  let totals = { ch: 0, sim: 0, diag: 0, neu: 0, enh: 0, reuse: 0 }
  const usedNew = new Set()
  for (const s of program.subjects) {
    const nt = notes.get(s.code)
    lines.push(`## Semester ${s.sem} · ${s.code} — ${s.title}`, '', nt ? `**Notes:** ${nt.lessons} lessons in \`content/courses/${nt.id}/\`` : '**Notes:** not written yet (matrix only)', '', s.note ? `> ${s.note}\n` : '', '| Chapter | h | Q1 | Q2 | Q3 | Q4 reuse | Q5 enhance | Q6 new | Realised by |', '|---|--:|:-:|:-:|:-:|---|---|---|---|')
    s.chapters.forEach(([title, hours, tags, how], i) => {
      const t = parse(tags)
      for (const id of [...t.sim, ...t.neu]) if (!engineIds.has(id) && !EXISTING.has(id) && id !== 'diagram-v2') { console.error(`✗ ${s.code} ch${i + 1} "${title}": unknown engine/component "${id}"`); problems++ }
      for (const id of t.neu) { if (id !== 'diagram-v2' && !engineIds.has(id)) { console.error(`✗ ${s.code} ch${i + 1}: neu=${id} is not a Step Lab engine`); problems++ } usedNew.add(id) }
      totals.ch++; if (t.simFlag) totals.sim++; if (t.diag) totals.diag++; if (t.neu.length) totals.neu++; if (t.enh.length) totals.enh++; if (t.reuse.length) totals.reuse++
      lines.push(`| ${i + 1}. ${title} | ${hours} | ${t.short ? 'Y' : 'N'} | ${t.simFlag ? 'Y' : '—'} | ${t.diag ? 'Y ' + t.diag : '—'} | ${t.reuse.join(', ') || '—'} | ${t.enh.join(', ') || '—'} | ${t.neu.join(', ') || '—'} | ${how} |`)
    })
    lines.push('')
  }
  if (program.reserved?.length) {
    lines.push('## Reserved — syllabus not yet published', '', '| Code | Course | Sem | Planned coverage |', '|---|---|--:|---|', ...program.reserved.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`), '')
  }
  const covered = program.subjects.filter((x) => notes.has(x.code)).length
  lines.splice(3, 0, `**Notes written for ${covered} of ${program.subjects.length} subjects.**`, '')
  lines.splice(3, 0, `**${totals.ch} chapters** · simulation on ${totals.sim} · diagram on ${totals.diag} · existing components reused on ${totals.reuse} · existing components enhanced on ${totals.enh} · new engines on ${totals.neu}.`, '')
  mkdirSync(join(root, 'docs/curriculum'), { recursive: true })
  writeFileSync(join(root, `docs/curriculum/${program.id}.md`), lines.join('\n') + '\n')
  index.push({ id: program.id, title: program.title, status: program.status, subjects: program.subjects.length, chapters: totals.ch, newEngines: [...usedNew].sort() })
  console.log(`${program.id}: ${program.subjects.length} subjects, ${totals.ch} chapters, ${usedNew.size} new engines named`)
}
writeFileSync(join(root, 'content/curriculum/index.json'), JSON.stringify(index, null, 2) + '\n')
if (problems) { console.error(`${problems} problem(s)`); process.exit(1) }
