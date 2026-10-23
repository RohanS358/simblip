// The guard for the narrative layer: a teacher's-voice rewrite may change HOW a section is told, never WHAT is true in it.
//   node scripts/narrative/check.mjs enct-351/02-search     (or --all)
// Compares each sidecar section with the prose it rewrites (content/narrative-orig, written when the narrative is first applied).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { normaliseHtml } from './apply.mjs'

const root = resolve(import.meta.dirname, '../..')
const ALLOWED = new Set(['div', 'p', 'em', 'b', 'i', 'sub', 'sup', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'code', 'strong', 'a', 'span', 'blockquote'])
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const numbers = (h) => new Set((text(h).replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []))
const BANNED = /\b(TODO|TKTK|lorem ipsum|placeholder|FIXME|XXX)\b/i
const YOU = /\b(you|your|you['’]re|you['’]ll|let['’]s|we)\b/i

export function checkSection(id, orig, nar) {
  const out = []
  const at = `[${id}]`
  const body = normaliseHtml(nar.body ?? '')
  const after = normaliseHtml(nar.after ?? '')
  const origAll = `${orig.body ?? ''} ${orig.after ?? ''}`
  const newAll = `${body} ${after}`
  const keep = (orig.body ?? '').trim().length > 0 && !nar.body // a section with no rewrite keeps its original prose
  if (nar.body !== undefined) {
    for (const t of body.matchAll(/<\/?([a-z0-9]+)/gi)) if (!ALLOWED.has(t[1].toLowerCase())) out.push(`${at} tag <${t[1]}> is not in the lesson HTML subset`)
    if (!/^\s*</.test(body)) out.push(`${at} body must be HTML (start with <p>, <ul>…)`)
    const open = (body.match(/<p[ >]/g) ?? []).length, close = (body.match(/<\/p>/g) ?? []).length
    if (open !== close) out.push(`${at} unbalanced <p> tags`)
    // facts: every number the original states survives
    const have = numbers(newAll)
    const lost = [...numbers(origAll)].filter((n) => !have.has(n))
    if (lost.length) out.push(`${at} numbers lost from the original: ${lost.slice(0, 8).join(', ')}`)
    // vocabulary: every defined term survives
    const terms = [...origAll.matchAll(/<em class="term">([^<]+)<\/em>/g)].map((m) => m[1])
    const lowered = text(newAll).toLowerCase()
    const missing = terms.filter((t) => !lowered.includes(t.toLowerCase()))
    if (missing.length) out.push(`${at} terms lost from the original: ${missing.slice(0, 6).join(', ')}`)
    // tables are data: kept verbatim
    for (const t of origAll.match(/<table[\s\S]*?<\/table>/g) ?? []) if (!newAll.includes(t)) out.push(`${at} a table from the original must be kept verbatim`)
    // voice + substance (a short recap list or a lone table may stay brief)
    const plainLen = text(orig.body ?? '').length
    const isTableOnly = /^<table/.test((orig.body ?? '').trim()) && !/<p>/.test(orig.body ?? '')
    if (!isTableOnly && plainLen >= 250) {
      if (text(body).length < plainLen * 1.15) out.push(`${at} the narrative is not richer than the original (${text(body).length} vs ${plainLen} chars)`)
      if (text(body).length > plainLen * 5 + 600) out.push(`${at} too long (${text(body).length} chars for a ${plainLen}-char section)`)
      if (!YOU.test(text(body))) out.push(`${at} nobody is being spoken to — address the student ("you", "let's")`)
    }
    if (BANNED.test(newAll)) out.push(`${at} filler text left in`)
  }
  // keynotes
  const kn = nar.keynotes ?? []
  const need = text(orig.body ?? '').length >= 250 || (orig.steps ?? '').length > 0 ? 3 : 2
  if (kn.length < need || kn.length > 5) out.push(`${at} needs ${need}–5 keynotes (has ${kn.length})`)
  const have = numbers(`${newAll} ${origAll} ${orig.steps ?? ''}`)
  for (const k of kn) {
    if (typeof k !== 'string' || k.length < 15 || k.length > 230) out.push(`${at} keynote length (${k?.length}): "${String(k).slice(0, 50)}"`)
    for (const n of numbers(String(k))) if (!have.has(n)) out.push(`${at} keynote states ${n}, which the section never says`)
    if (BANNED.test(k)) out.push(`${at} filler in a keynote`)
  }
  return out
}

export function checkLesson(course, lesson) {
  const nPath = join(root, 'content/narrative', course, `${lesson}.json`)
  const oPath = join(root, 'content/narrative-orig', course, `${lesson}.json`)
  const problems = []
  const nar = JSON.parse(readFileSync(nPath, 'utf8'))
  let orig
  if (existsSync(oPath)) orig = JSON.parse(readFileSync(oPath, 'utf8'))
  else {
    // not applied yet: the built lesson IS the original
    const l = JSON.parse(readFileSync(join(root, 'content/courses', course, `${lesson}.json`), 'utf8'))
    orig = { sections: Object.fromEntries(l.sections.map((s) => [s.id, { title: s.title, body: s.body ?? '', after: s.after ?? '', steps: [...(s.derivation ?? []), ...(s.worked ?? [])].map((x) => x.why).join(' ') }])) }
  }
  for (const [id, n] of Object.entries(nar.sections ?? {})) {
    if (!orig.sections[id]) { problems.push(`[${id}] no such section in the lesson`); continue }
    problems.push(...checkSection(id, orig.sections[id], n))
  }
  for (const id of Object.keys(orig.sections)) if (!(id in (nar.sections ?? {}))) problems.push(`[${id}] has no narrative yet`)
  return problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2]
  const targets = []
  if (arg === '--all') {
    const nroot = join(root, 'content/narrative')
    for (const c of readdirSync(nroot, { withFileTypes: true }).filter((d) => d.isDirectory())) for (const f of readdirSync(join(nroot, c.name)).filter((x) => x.endsWith('.json'))) targets.push([c.name, f.replace(/\.json$/, '')])
  } else targets.push(arg.split('/'))
  let bad = 0
  for (const [c, l] of targets) {
    const p = checkLesson(c, l)
    if (p.length) { bad++; console.log(`✖ ${c}/${l}\n  ` + p.join('\n  ')) }
    else console.log(`✔ ${c}/${l}`)
  }
  process.exit(bad ? 1 : 0)
}
