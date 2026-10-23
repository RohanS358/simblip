// Merge the narrative layer into the built lessons.
//
// The narrative (content/narrative/<course>/<lesson>.json) holds, per section, a teacher's-voice rewrite of the prose
// (`body`, optionally `after`) and its `keynotes`. It is a SEPARATE layer on purpose: the sources and their engine-derived
// numbers stay untouched, a course can be regenerated, and the narrative is re-applied over it (build-courses.mjs calls
// this). Idempotent. Anything not in the sidecar stays exactly as authored.
//
//   node scripts/narrative/apply.mjs [course …]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
/** Sidecar HTML may use single-quoted attributes (class='term'): far easier to write inside a JSON string. Lessons use double quotes. */
export const normaliseHtml = (h) => (h ?? '').replace(/<([a-z][a-z0-9]*)((?:\s+[a-z-]+='[^']*')+)\s*>/gi, (m, tag, attrs) => `<${tag}${attrs.replace(/([a-z-]+)='([^']*)'/gi, '$1="$2"')}>`)
export function applyNarrative(only = []) {
  let applied = 0
  const nroot = join(root, 'content/narrative')
  if (!existsSync(nroot)) return 0
  for (const course of readdirSync(nroot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    if (only.length && !only.includes(course.name)) continue
    for (const f of readdirSync(join(nroot, course.name)).filter((x) => x.endsWith('.json'))) {
      const target = join(root, 'content/courses', course.name, f)
      if (!existsSync(target)) { console.warn(`narrative: no lesson ${course.name}/${f}`); continue }
      const lesson = JSON.parse(readFileSync(target, 'utf8'))
      const nar = JSON.parse(readFileSync(join(nroot, course.name, f), 'utf8'))
      // The prose as it was authored, kept once, so the guard can always check a rewrite against what it rewrites.
      const orig = join(root, 'content/narrative-orig', course.name, f)
      if (!existsSync(orig)) {
        mkdirSync(join(root, 'content/narrative-orig', course.name), { recursive: true })
        writeFileSync(orig, JSON.stringify({ title: lesson.title, subtitle: lesson.subtitle ?? '', sections: Object.fromEntries(lesson.sections.map((s) => [s.id, { title: s.title, body: s.body ?? '', after: s.after ?? '', steps: [...(s.derivation ?? []), ...(s.worked ?? [])].map((x) => x.why).join(' ') }])) }, null, 2) + '\n')
      }
      if (nar.subtitle) lesson.subtitle = nar.subtitle
      for (const s of lesson.sections) {
        const n = nar.sections?.[s.id]
        if (!n) continue
        if (n.body) s.body = normaliseHtml(n.body)
        if (n.after) s.after = normaliseHtml(n.after)
        if (n.keynotes?.length) s.keynotes = n.keynotes
      }
      writeFileSync(target, JSON.stringify(lesson, null, 2) + '\n')
      applied++
    }
  }
  return applied
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(`narrative applied to ${applyNarrative(process.argv.slice(2))} lesson(s)`)
