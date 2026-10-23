// Builds a narrative sidecar for a lesson whose prose is already deep: keeps every original word and adds a warm
// hook before it, an "intuition check" after it and the keynotes. node scripts/narrative/frame.mjs <course>/<lesson> <spec.json>
// spec: { subtitle?, sections: { id: { hook, close, keynotes[] } } }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const [target, specPath] = process.argv.slice(2)
const [course, lesson] = target.split('/')
const lessonDoc = JSON.parse(readFileSync(`content/courses/${course}/${lesson}.json`, 'utf8'))
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const out = { sections: {} }
if (spec.subtitle) out.subtitle = spec.subtitle
for (const s of lessonDoc.sections) {
  const f = spec.sections[s.id]
  if (!f) continue
  const body = s.body ?? ''
  const hook = f.hook ?? ''
  const close = f.close ? `<p>${f.close}</p>` : ''
  const framed = (body.startsWith('<p>') ? `<p>${hook} ${body.slice(3)}` : `<p>${hook}</p>${body}`) + close
  out.sections[s.id] = { body: framed, keynotes: f.keynotes }
  if (s.after) out.sections[s.id].after = s.after
}
mkdirSync(`content/narrative/${course}`, { recursive: true })
writeFileSync(`content/narrative/${course}/${lesson}.json`, JSON.stringify(out, null, 2) + '\n')
console.log(`framed ${target}: ${Object.keys(out.sections).length} sections`)
