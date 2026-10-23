// The reading view of a lesson, for rewriting its prose: everything a teacher needs, none of the figure scripts.
//   node scripts/narrative/read.mjs enct-351/02-search
import { existsSync, readFileSync, readdirSync } from 'node:fs'
// node scripts/narrative/read.mjs enct-351/02-search   |   node scripts/narrative/read.mjs enct-351   (every lesson not yet narrated)
const [course, one] = (process.argv[2] ?? '').split('/')
const todo = one ? [one] : readdirSync(`content/courses/${course}`).filter((f) => f.endsWith('.json') && f !== 'course.json' && !existsSync(`content/narrative/${course}/${f}`)).map((f) => f.replace(/\.json$/, ''))
for (const lesson of todo) {
const d = JSON.parse(readFileSync(`content/courses/${course}/${lesson}.json`, 'utf8'))
console.log(`\n=================== ${course}/${lesson}`)
console.log(`# ${d.title}\nkicker: ${d.kicker ?? ''}\nsubtitle: ${d.subtitle ?? ''}\n`)
for (const s of d.sections) {
  console.log(`## [${s.id}] ${s.locator ?? ''} ${s.title}  (eyebrow: ${s.eyebrow ?? ''})`)
  if (s.body) console.log('BODY:', s.body)
  for (const f of s.figures ?? []) console.log(`FIGURE: ${f.caption}${f.note ? ' — note: ' + f.note : ''}`)
  for (const st of s.derivation ?? []) console.log(`DERIV: ${st.why}${st.math ? '  [math: ' + st.math + ']' : ''}`)
  for (const st of s.worked ?? []) console.log(`WORKED: ${st.why}${st.math ? '  [math: ' + st.math + ']' : ''}`)
  if (s.after) console.log('AFTER:', s.after)
  for (const q of s.questions ?? (s.question ? [s.question] : [])) console.log(`QUESTION: ${q.prompt}`)
  console.log()
}
}
