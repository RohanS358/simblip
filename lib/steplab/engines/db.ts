// Database management (ENCT 301): functional dependencies and normal forms,
// transaction schedules and serialisability, relational algebra.

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, pstr, plist } from '../types'
import { box, dot, heading, line, toneAt, trace, txt } from '../draw'

const G = 'Databases'

// ── Functional dependencies ─────────────────────────────────────────────────

export function closure(x: string, fds: [string, string][]): { set: string; steps: { fd: string; add: string }[] } {
  const set = new Set(x.split('')); const steps: { fd: string; add: string }[] = []
  let grew = true
  while (grew) { grew = false; for (const [l, r] of fds) if ([...l].every((c) => set.has(c))) { const add = [...r].filter((c) => !set.has(c)); if (add.length) { add.forEach((c) => set.add(c)); steps.push({ fd: `${l}→${r}`, add: add.join('') }); grew = true } } }
  return { set: [...set].sort().join(''), steps }
}

function fdRun(p: Params) {
  const attrs = pstr(p, 'attrs', 'ABCDE').replace(/[\s,]/g, '').toUpperCase()
  const fds = plist(p, 'fds', ['A->B', 'B->C', 'CD->E'], /[;\n]/).map((f): [string, string] => { const m = /^([A-Z]+)\s*(?:->|→)\s*([A-Z]+)$/i.exec(f.replace(/\s/g, '')); if (!m) throw new LabError(`dependency "${f}" — write AB->C`); return [m[1].toUpperCase(), m[2].toUpperCase()] })
  for (const [l, r] of fds) for (const c of l + r) if (!attrs.includes(c)) throw new LabError(`attribute ${c} in ${l}→${r} is not in the relation (${attrs})`)
  const target = pstr(p, 'closureOf', attrs[0]).replace(/[\s,]/g, '').toUpperCase()
  const all = attrs.split('')
  const subsets: string[] = []; for (let m = 1; m < 1 << all.length; m++) subsets.push(all.filter((_, i) => m & (1 << i)).join(''))
  const supers = subsets.filter((s) => closure(s, fds).set === attrs.split('').sort().join(''))
  const keys = supers.filter((s) => !supers.some((t) => t !== s && t.length < s.length && [...t].every((c) => s.includes(c))))
  const prime = new Set(keys.flatMap((k) => k.split('')))
  const isSuper = (x: string) => closure(x, fds).set === attrs.split('').sort().join('')
  const violations: { fd: string; nf: string; why: string }[] = []
  for (const [l, r] of fds) for (const a of r) {
    if (l.includes(a)) continue
    const partial = keys.some((k) => l.length < k.length && [...l].every((c) => k.includes(c)))
    if (!prime.has(a) && partial) violations.push({ fd: `${l}→${a}`, nf: '2NF', why: `${a} is not prime and depends on ${l}, only PART of a key` })
    if (!isSuper(l) && !prime.has(a)) violations.push({ fd: `${l}→${a}`, nf: '3NF', why: `${l} is not a superkey and ${a} is not prime (transitive dependency)` })
    if (!isSuper(l)) violations.push({ fd: `${l}→${a}`, nf: 'BCNF', why: `${l} is not a superkey` })
  }
  const nf = violations.some((v) => v.nf === '2NF') ? '1NF' : violations.some((v) => v.nf === '3NF') ? '2NF' : violations.some((v) => v.nf === 'BCNF') ? '3NF' : 'BCNF'
  const cl = closure(target, fds)
  const W = 620, H = 330
  const frames: Frame[] = []
  frames.push({ draw: [heading(20, 14, `R(${attrs.split('').join(', ')})`), ...fds.map((f, i) => txt(20, 44 + i * 20, `${f[0]} → ${f[1]}`, { size: 13, mono: true, tone: toneAt(i) }))], note: 'A functional dependency X → Y says: two rows that agree on X must agree on Y.' })
  const cd: Prim[] = [heading(20, 14, `Attribute closure (${target})⁺`), box(20, 34, 40 + target.length * 12, 28, target, 'blue')]
  let cur = target
  cl.steps.forEach((s, i) => { cur += s.add; frames.push({ draw: [heading(20, 14, `Attribute closure (${target})⁺`), ...cl.steps.slice(0, i + 1).map((q, k) => txt(20, 50 + k * 22, `use ${q.fd}: add ${q.add}   →   {${[...new Set((target + cl.steps.slice(0, k + 1).map((z) => z.add).join('')).split(''))].sort().join(', ')}}`, { size: 12.5, mono: true, tone: k === i ? 'blue' : 'idle' }))], note: `Because ${s.fd.split('→')[0]} is already inside the set, ${s.fd} lets us add ${s.add}.` }) })
  frames.push({ draw: [...cd, txt(20, 100, `(${target})⁺ = {${cl.set.split('').join(', ')}}`, { size: 15, mono: true, bold: true, tone: 'mint' }), txt(20, 128, cl.set === [...attrs].sort().join('') ? `${target} determines every attribute → ${target} is a superkey` : `${target} does NOT determine ${[...attrs].filter((c) => !cl.set.includes(c)).join(', ')}`, { size: 12, tone: 'dim' })], note: 'Keep applying dependencies until nothing new can be added.' })
  frames.push({ draw: [heading(20, 14, 'Candidate keys'), ...keys.map((k, i) => box(20 + i * 90, 36, 80, 30, k, 'mint')), txt(20, 100, `prime attributes: ${[...prime].sort().join(', ') || '—'}`, { size: 13, mono: true }), txt(20, 124, `non-prime: ${[...attrs].filter((c) => !prime.has(c)).join(', ') || '—'}`, { size: 13, mono: true, tone: 'dim' })], note: 'A candidate key is a minimal set of attributes whose closure is everything.' })
  frames.push({ draw: [heading(20, 14, `Normal form check → highest: ${nf}`), ...(violations.length ? violations.slice(0, 8).map((v, i) => txt(20, 44 + i * 22, `${v.nf} ✗  ${v.fd}: ${v.why}`, { size: 11.5, tone: 'rose' })) : [txt(20, 50, 'Every dependency has a superkey on its left side → BCNF', { size: 13, tone: 'mint' })]), txt(20, 260, `Highest normal form satisfied: ${nf}`, { size: 16, bold: true, tone: nf === 'BCNF' ? 'mint' : 'amber' })], note: '2NF: no partial dependency on a key; 3NF: every non-key dependency goes through a key (or targets a prime attribute); BCNF: the left side of every dependency is a superkey.' })
  return trace(W, H, frames, { closure: cl.set, keys: keys.sort().join(' '), prime: [...prime].sort().join(''), normalForm: nf })
}

// ── Schedules and serialisability ───────────────────────────────────────────

function serialRun(p: Params) {
  const ops = plist(p, 'schedule', ['r1(x)', 'w2(x)', 'w1(x)'], /[\s;,]+/).map((o) => { const m = /^([rw])(\d+)\((\w+)\)$/i.exec(o); if (!m) throw new LabError(`operation "${o}" — write r1(x) or w2(y)`); return { rw: m[1].toLowerCase(), t: Number(m[2]), item: m[3], text: o } })
  const txs = [...new Set(ops.map((o) => o.t))].sort((a, b) => a - b)
  const edges: { from: number; to: number; item: string; why: string }[] = []
  ops.forEach((a, i) => ops.slice(i + 1).forEach((b) => { if (a.t !== b.t && a.item === b.item && (a.rw === 'w' || b.rw === 'w')) if (!edges.some((e) => e.from === a.t && e.to === b.t && e.item === a.item)) edges.push({ from: a.t, to: b.t, item: a.item, why: `${a.text} before ${b.text}` }) }))
  // cycle detection / topological order
  const indeg = new Map(txs.map((t) => [t, 0])); edges.forEach((e) => indeg.set(e.to, indeg.get(e.to)! + 1))
  const order: number[] = []; const q = txs.filter((t) => indeg.get(t) === 0); const ind = new Map(indeg)
  while (q.length) { const t = q.shift()!; order.push(t); for (const e of edges.filter((x) => x.from === t)) { ind.set(e.to, ind.get(e.to)! - 1); if (ind.get(e.to) === 0) q.push(e.to) } }
  const serial = order.length === txs.length
  const cx = (i: number) => 480 + 80 * Math.cos((2 * Math.PI * i) / txs.length - Math.PI / 2), cy = (i: number) => 130 + 80 * Math.sin((2 * Math.PI * i) / txs.length - Math.PI / 2)
  const W = 640, H = 60 + ops.length * 24 + 30
  const sched = (upto: number, hi: number[] = []): Prim[] => [
    ...txs.map((t, ti) => txt(60 + ti * 110, 34, `T${t}`, { size: 12, bold: true, anchor: 'middle', tone: toneAt(ti) })),
    ...ops.slice(0, upto).map((o, i) => box(60 + txs.indexOf(o.t) * 110 - 40, 44 + i * 24, 80, 20, o.text, hi.includes(i) ? 'amber' : toneAt(txs.indexOf(o.t)))),
  ]
  const frames: Frame[] = [{ draw: [heading(20, 14, 'Schedule (time runs downward)'), ...sched(ops.length)], note: 'A schedule interleaves the operations of several transactions. Two operations CONFLICT if they belong to different transactions, touch the same item, and at least one is a write.' }]
  const shown: typeof edges = []
  edges.forEach((e) => {
    shown.push(e)
    const iA = ops.findIndex((o) => o.t === e.from && e.why.startsWith(o.text)), iB = ops.findIndex((o, k) => k > iA && o.t === e.to && e.why.endsWith(o.text))
    const d: Prim[] = [heading(20, 14, 'Precedence (conflict) graph'), ...sched(ops.length, [iA, iB]), ...txs.map((t, i) => dot(cx(i), cy(i), 18, `T${t}`, 'blue'))]
    shown.forEach((s) => { const a = txs.indexOf(s.from), b = txs.indexOf(s.to); const ang = Math.atan2(cy(b) - cy(a), cx(b) - cx(a)); d.push(line(cx(a) + 18 * Math.cos(ang), cy(a) + 18 * Math.sin(ang), cx(b) - 18 * Math.cos(ang), cy(b) - 18 * Math.sin(ang), 'amber', { arrow: true, w: 1.6 }), txt((cx(a) + cx(b)) / 2, (cy(a) + cy(b)) / 2 - 6, s.item, { size: 10, mono: true, anchor: 'middle', tone: 'amber' })) })
    frames.push({ draw: d, note: `${e.why} conflict on ${e.item}: add the edge T${e.from} → T${e.to} (T${e.from} must come first in any equivalent serial order).` })
  })
  const fin: Prim[] = [heading(20, 14, serial ? 'Acyclic → conflict-serializable' : 'Cycle → NOT conflict-serializable'), ...sched(ops.length), ...txs.map((t, i) => dot(cx(i), cy(i), 18, `T${t}`, serial ? 'mint' : 'rose'))]
  edges.forEach((s) => { const a = txs.indexOf(s.from), b = txs.indexOf(s.to); const ang = Math.atan2(cy(b) - cy(a), cx(b) - cx(a)); fin.push(line(cx(a) + 18 * Math.cos(ang), cy(a) + 18 * Math.sin(ang), cx(b) - 18 * Math.cos(ang), cy(b) - 18 * Math.sin(ang), serial ? 'mint' : 'rose', { arrow: true, w: 1.8 })) })
  fin.push(txt(330, H - 14, serial ? `equivalent serial order: ${order.map((t) => `T${t}`).join(' → ')}` : 'no serial order can reproduce these conflicts', { size: 12.5, mono: true, tone: serial ? 'mint' : 'rose' }))
  frames.push({ draw: fin, note: serial ? 'The precedence graph has no cycle, so the schedule is conflict-equivalent to a serial one.' : 'A cycle means each transaction must precede the other — impossible in any serial schedule.' })
  return trace(W, Math.max(H, 250), frames, { serializable: serial ? 'yes' : 'no', order: serial ? order.map((t) => `T${t}`).join(' ') : '', edges: edges.map((e) => `T${e.from}->T${e.to}`).join(' ') })
}

// ── Relational algebra ──────────────────────────────────────────────────────

type Table = { cols: string[]; rows: string[][] }
function parseTable(raw: string, name: string): Table {
  const lines = raw.split(/[;\n]/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(',').map((c) => c.trim()))
  if (lines.length < 1) throw new LabError(`table ${name} is empty — first row is the header: name,dept ; Ann,CS`)
  const cols = lines[0]
  if (lines.slice(1).some((r) => r.length !== cols.length)) throw new LabError(`every row of ${name} needs ${cols.length} values`)
  return { cols, rows: lines.slice(1) }
}
const cmp = (a: string, op: string, b: string) => { const na = Number(a), nb = Number(b), num = a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb); const x = num ? na : a, y = num ? nb : b; return op === '=' ? x === y : op === '!=' ? x !== y : op === '>' ? x > y : op === '<' ? x < y : op === '>=' ? x >= y : x <= y }

function relRun(p: Params) {
  const R = parseTable(pstr(p, 'r', 'name,dept,salary;Ann,CS,50;Bob,EE,40;Cy,CS,60;Di,ME,45'), 'R')
  const S = parseTable(pstr(p, 's', 'dept,building;CS,A;EE,B;CE,C'), 'S')
  const op = pstr(p, 'op', 'join'), arg = pstr(p, 'arg', '')
  let out: Table = { cols: [], rows: [] }
  const matches: { left: number; rights: number[] }[] = []
  let sym = ''
  if (op === 'select') {
    const m = /^(\w+)\s*(>=|<=|!=|=|>|<)\s*'?([^']*)'?$/.exec(arg.trim() || 'salary > 45'); if (!m) throw new LabError('condition looks like  salary > 45  or  dept = CS')
    const ci = R.cols.indexOf(m[1]); if (ci < 0) throw new LabError(`no column ${m[1]} in R (${R.cols.join(', ')})`)
    out = { cols: R.cols, rows: R.rows.filter((r, i) => { const ok = cmp(r[ci], m[2], m[3]); matches.push({ left: i, rights: ok ? [i] : [] }); return ok }) }; sym = `σ ${arg || 'salary > 45'} (R)`
  } else if (op === 'project') {
    const cs = (arg || 'name,dept').split(/[\s,]+/).filter(Boolean); const idx = cs.map((c) => { const i = R.cols.indexOf(c); if (i < 0) throw new LabError(`no column ${c} in R`); return i })
    const seen = new Set<string>(); const rows: string[][] = []; R.rows.forEach((r, i) => { const t = idx.map((k) => r[k]); const key = t.join('|'); const dup = seen.has(key); if (!dup) { seen.add(key); rows.push(t) } matches.push({ left: i, rights: dup ? [] : [rows.length - 1] }) })
    out = { cols: cs, rows }; sym = `π ${cs.join(', ')} (R)`
  } else if (op === 'join' || op === 'leftjoin') {
    const common = R.cols.filter((c) => S.cols.includes(c)); if (!common.length) throw new LabError('R and S share no column — a natural join needs one (use product for a Cartesian product)')
    const sRest = S.cols.filter((c) => !common.includes(c)); out = { cols: [...R.cols, ...sRest], rows: [] }
    R.rows.forEach((r, i) => { const rights: number[] = []; S.rows.forEach((s, j) => { if (common.every((c) => r[R.cols.indexOf(c)] === s[S.cols.indexOf(c)])) { rights.push(j); out.rows.push([...r, ...sRest.map((c) => s[S.cols.indexOf(c)])]) } }); if (!rights.length && op === 'leftjoin') out.rows.push([...r, ...sRest.map(() => 'NULL')]); matches.push({ left: i, rights }) })
    sym = op === 'join' ? `R ⋈ S  (on ${common.join(', ')})` : `R ⟕ S  (on ${common.join(', ')})`
  } else if (op === 'product') {
    out = { cols: [...R.cols.map((c) => `R.${c}`), ...S.cols.map((c) => `S.${c}`)], rows: R.rows.flatMap((r, i) => S.rows.map((s) => { return [...r, ...s] })) }; R.rows.forEach((_, i) => matches.push({ left: i, rights: S.rows.map((__, j) => j) })); sym = 'R × S'
  } else if (op === 'union' || op === 'intersect' || op === 'diff') {
    if (R.cols.length !== S.cols.length) throw new LabError('set operations need union-compatible tables (same number of columns)')
    const k = (r: string[]) => r.join('|'); const inS = new Set(S.rows.map(k)), inR = new Set(R.rows.map(k))
    out = { cols: R.cols, rows: op === 'union' ? [...R.rows, ...S.rows.filter((s) => !inR.has(k(s)))] : op === 'intersect' ? R.rows.filter((r) => inS.has(k(r))) : R.rows.filter((r) => !inS.has(k(r))) }
    R.rows.forEach((_, i) => matches.push({ left: i, rights: [] })); sym = `R ${op === 'union' ? '∪' : op === 'intersect' ? '∩' : '−'} S`
  } else if (op === 'group') {
    const m = /^(\w+)\s*:\s*(count|sum|avg|min|max)\((\w+|\*)\)$/.exec(arg.trim() || 'dept:sum(salary)'); if (!m) throw new LabError('group looks like  dept:sum(salary)  or  dept:count(*)')
    const gi = R.cols.indexOf(m[1]), ai = m[3] === '*' ? -1 : R.cols.indexOf(m[3]); if (gi < 0 || (m[3] !== '*' && ai < 0)) throw new LabError('unknown column in group')
    const groups = new Map<string, number[]>(); R.rows.forEach((r, i) => { groups.set(r[gi], [...(groups.get(r[gi]) ?? []), i]) })
    out = { cols: [m[1], `${m[2]}(${m[3]})`], rows: [...groups].map(([g, is]) => { const vals = is.map((i) => Number(R.rows[i][ai])); const v = m[2] === 'count' ? is.length : m[2] === 'sum' ? vals.reduce((a, b) => a + b, 0) : m[2] === 'avg' ? vals.reduce((a, b) => a + b, 0) / vals.length : m[2] === 'min' ? Math.min(...vals) : Math.max(...vals); return [g, String(Math.round(v * 100) / 100)] }) }
    R.rows.forEach((r, i) => matches.push({ left: i, rights: [[...groups.keys()].indexOf(r[gi])] })); sym = `γ ${arg || 'dept:sum(salary)'} (R)`
  } else throw new LabError('op is select, project, join, leftjoin, product, union, intersect, diff or group')
  const cw = 64, rh = 22
  const tbl = (t: Table, x: number, y: number, title: string, hiRow: number[] = [], tone: Tone = 'blue'): Prim[] => [txt(x, y - 8, title, { size: 10.5, bold: true, tone: 'dim' }), ...t.cols.map((c, j) => box(x + j * cw, y, cw - 2, rh, c, 'dim')), ...t.rows.flatMap((r, i) => r.map((v, j) => box(x + j * cw, y + (i + 1) * rh + 2, cw - 2, rh - 2, v, hiRow.includes(i) ? tone : 'idle')))]
  const W = 660, H = 60 + Math.max(R.rows.length, S.rows.length, out.rows.length) * rh + 200
  const rightX = 20 + R.cols.length * cw + 30, outY = 60 + (Math.max(R.rows.length, S.rows.length) + 2) * rh + 24
  const frames: Frame[] = [{ draw: [heading(20, 14, sym), ...tbl(R, 20, 46, 'R'), ...(['join', 'leftjoin', 'product', 'union', 'intersect', 'diff'].includes(op) ? tbl(S, rightX, 46, 'S') : [])], note: 'The operator takes one or two relations and produces a new relation (a set of rows).' }]
  const emitted: number[] = []
  matches.forEach((m, k) => {
    const rowsSoFar = op === 'join' || op === 'leftjoin' || op === 'product' ? out.rows.slice(0, matches.slice(0, k + 1).reduce((a, x) => a + Math.max(x.rights.length, op === 'leftjoin' ? 1 : 0), 0)) : op === 'select' ? out.rows.filter((_, i) => matches.slice(0, k + 1).filter((z) => z.rights.length).length > i) : op === 'project' ? out.rows.slice(0, matches.slice(0, k + 1).filter((z) => z.rights.length).length) : op === 'group' ? out.rows : out.rows
    void emitted
    frames.push({ draw: [heading(20, 14, sym), ...tbl(R, 20, 46, 'R', [m.left]), ...(['join', 'leftjoin', 'product'].includes(op) ? tbl(S, rightX, 46, 'S', m.rights, 'mint') : []), ...tbl({ cols: out.cols, rows: rowsSoFar }, 20, outY, 'result', rowsSoFar.length ? [rowsSoFar.length - 1] : [], 'amber')], note: op === 'select' ? `Row ${m.left + 1}: ${m.rights.length ? 'satisfies the condition → kept' : 'fails the condition → dropped'}.` : op === 'project' ? `Row ${m.left + 1}: keep only the chosen columns${m.rights.length ? '' : ' — a duplicate of an earlier row, removed (relations are sets)'}.` : op === 'join' || op === 'leftjoin' ? `Row ${m.left + 1} of R matches ${m.rights.length} row${m.rights.length === 1 ? '' : 's'} of S on the common column${m.rights.length === 0 ? (op === 'leftjoin' ? ' — none, so a left join keeps it padded with NULL' : ' — none, so an inner join drops it') : ''}.` : op === 'group' ? `Row ${m.left + 1} joins its group.` : 'Combining rows.' })
  })
  frames.push({ draw: [heading(20, 14, sym), ...tbl(out, 20, 46, `result — ${out.rows.length} row${out.rows.length === 1 ? '' : 's'}`, [], 'amber')], note: `Result: ${out.rows.length} row${out.rows.length === 1 ? '' : 's'}.` })
  return trace(W, H, frames, { rows: String(out.rows.length), columns: out.cols.join(','), result: out.rows.map((r) => r.join(':')).join(' ') })
}

export const DB_ENGINES: EngineDef[] = [
  { id: 'fd', label: 'Functional dependencies & normal forms', group: G, blurb: 'Attribute closure, candidate keys, and the highest normal form a relation satisfies.',
    params: [{ name: 'attrs', label: 'Attributes', hint: 'letters, e.g. ABCDE', def: 'ABCDE' }, { name: 'fds', label: 'Dependencies', hint: 'A->B ; B->C ; CD->E', def: 'A->B;B->C;CD->E', long: true }, { name: 'closureOf', label: 'Closure of', hint: 'attribute set', def: 'A' }], run: fdRun },
  { id: 'serializability', label: 'Transaction schedules', group: G, blurb: 'Conflicts, the precedence graph, and conflict-serializability.',
    params: [{ name: 'schedule', label: 'Schedule', hint: 'r1(x) w2(x) w1(x) …', def: 'r1(x) w2(x) w1(x)', long: true }], run: serialRun },
  { id: 'relalg', label: 'Relational algebra', group: G, blurb: 'Select, project, join, set operations and grouping, row by row.',
    params: [{ name: 'op', label: 'Operator', hint: 'select project join leftjoin product union intersect diff group', def: 'join', options: ['select', 'project', 'join', 'leftjoin', 'product', 'union', 'intersect', 'diff', 'group'] }, { name: 'arg', label: 'Argument', hint: 'condition (salary > 45), columns (name,dept) or group (dept:sum(salary))', def: '', optional: true }, { name: 'r', label: 'Table R', hint: 'header row first, rows separated by ;', def: 'name,dept,salary;Ann,CS,50;Bob,EE,40;Cy,CS,60;Di,ME,45', long: true }, { name: 's', label: 'Table S', hint: 'second relation', def: 'dept,building;CS,A;EE,B;CE,C', long: true }], run: relRun },
]
