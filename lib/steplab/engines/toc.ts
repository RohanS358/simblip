// Theory of computation (ENCT 203): DFA, NFA (with ε), PDA, Turing machine, and
// context-free derivations with their parse trees.

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, pstr, pnum } from '../types'
import { act as clickable, box, dot, drawTree, heading, line, poly, selfLoop, trace, txt, type NNode } from '../draw'

const G = 'Theory of computation'
const EPS = new Set(['e', 'ε', 'eps', '', 'epsilon', 'λ'])

interface Machine { start: string; accept: Set<string>; acceptEmpty: boolean; blank: string; states: string[]; trans: { from: string; sym: string; extra?: string; to: string; write?: string; move?: string; push?: string }[] }

function parseMachine(kind: string, spec: string): Machine {
  const m: Machine = { start: '', accept: new Set(), acceptEmpty: false, blank: '_', states: [], trans: [] }
  const seen = (s: string) => { if (!m.states.includes(s)) m.states.push(s) }
  spec.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.replace(/(?:#|\/\/).*$/, '').trim()
    if (!l) return
    let x: RegExpExecArray | null
    if ((x = /^start\s*:\s*(\S+)$/i.exec(l))) { m.start = x[1]; seen(x[1]); return }
    if ((x = /^accept\s*:\s*(.+)$/i.exec(l))) { if (x[1].trim() === 'empty') m.acceptEmpty = true; else x[1].split(/[\s,]+/).filter(Boolean).forEach((s) => { m.accept.add(s); seen(s) }); return }
    if ((x = /^blank\s*:\s*(\S)$/i.exec(l))) { m.blank = x[1]; return }
    const arrow = /^(.+?)\s*(?:->|→)\s*(.+)$/.exec(l)
    if (!arrow) throw new LabError(`spec line ${i + 1}: "${l}" is not "start: q0", "accept: q1 q2" or a transition "q0,a -> q1"`)
    const lhs = arrow[1].split(',').map((s) => s.trim()), rhs = arrow[2].split(',').map((s) => s.trim())
    if (kind === 'tm') {
      if (lhs.length !== 2 || rhs.length !== 3) throw new LabError(`spec line ${i + 1}: a TM rule is "q0,read -> q1,write,L|R|S"`)
      if (!['L', 'R', 'S'].includes(rhs[2].toUpperCase())) throw new LabError(`spec line ${i + 1}: move must be L, R or S`)
      m.trans.push({ from: lhs[0], sym: lhs[1], to: rhs[0], write: rhs[1], move: rhs[2].toUpperCase() })
    } else if (kind === 'pda') {
      if (lhs.length !== 3 || rhs.length !== 2) throw new LabError(`spec line ${i + 1}: a PDA rule is "q0,input,stackTop -> q1,pushString" (e = empty)`)
      m.trans.push({ from: lhs[0], sym: EPS.has(lhs[1]) ? '' : lhs[1], extra: lhs[2], to: rhs[0], push: EPS.has(rhs[1]) ? '' : rhs[1] })
    } else {
      if (lhs.length !== 2) throw new LabError(`spec line ${i + 1}: a rule is "q0,a -> q1" (ε as e)`)
      for (const to of rhs) m.trans.push({ from: lhs[0], sym: EPS.has(lhs[1]) ? '' : lhs[1], to })
    }
    seen(lhs[0]); if (kind === 'tm' || kind === 'pda') seen(rhs[0]); else rhs.forEach(seen)
  })
  if (!m.start) throw new LabError('the spec needs "start: q0"')
  return m
}

/** Left-to-right layers by BFS from the start state, stacked vertically. */
function layoutStates(m: Machine, W: number, H: number): Map<string, [number, number]> {
  const layer = new Map<string, number>([[m.start, 0]])
  const q = [m.start]
  while (q.length) { const s = q.shift()!; for (const t of m.trans.filter((x) => x.from === s)) if (!layer.has(t.to)) { layer.set(t.to, layer.get(s)! + 1); q.push(t.to) } }
  for (const s of m.states) if (!layer.has(s)) layer.set(s, Math.max(...layer.values()) + 1)
  const cols = Math.max(...layer.values()) + 1
  const byLayer: string[][] = Array.from({ length: cols }, () => [])
  for (const s of m.states) byLayer[layer.get(s)!].push(s)
  const pos = new Map<string, [number, number]>()
  byLayer.forEach((ss, c) => ss.forEach((s, i) => pos.set(s, [40 + (cols === 1 ? W / 2 : (c * (W - 100)) / (cols - 1)), 40 + ((i + 1) * (H - 60)) / (ss.length + 1)])))
  return pos
}

const R = 18
function drawMachine(m: Machine, pos: Map<string, [number, number]>, active: Set<string>, usedEdge: number[], kind: string): Prim[] {
  const d: Prim[] = []
  // group parallel transitions by (from,to)
  const groups = new Map<string, { idx: number[]; labels: string[] }>()
  m.trans.forEach((t, i) => {
    const key = `${t.from}>${t.to}`
    const g = groups.get(key) ?? { idx: [], labels: [] }
    g.idx.push(i)
    g.labels.push(kind === 'tm' ? `${t.sym}→${t.write},${t.move}` : kind === 'pda' ? `${t.sym || 'ε'},${t.extra}→${t.push || 'ε'}` : t.sym || 'ε')
    groups.set(key, g)
  })
  for (const [key, g] of groups) {
    const [a, b] = key.split('>')
    const hot = g.idx.some((i) => usedEdge.includes(i))
    const tone: Tone = hot ? 'blue' : 'dim'
    const [x1, y1] = pos.get(a)!, [x2, y2] = pos.get(b)!
    const label = g.labels.join(' ')
    if (a === b) {
      d.push(selfLoop(x1, y1, R, tone)); d.push(txt(x1, y1 - R * 2.4, label, { size: 10.5, mono: true, anchor: 'middle', tone: hot ? 'blue' : 'amber' }))
    } else {
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1
      const nx = -dy / len, ny = dx / len
      const both = groups.has(`${b}>${a}`)
      const skips = Math.abs(dx) > 150 || (dx < 0)
      // Straight when it can be; bowed when the reverse edge exists or the edge would run through a state.
      const bow = both ? Math.min(34, len * 0.22) : skips ? Math.min(60, len * 0.28) * (dx < 0 ? 1 : -1) : 0
      const cxp = (x1 + x2) / 2 + nx * bow * 2, cyp = (y1 + y2) / 2 + ny * bow * 2
      const ua = Math.hypot(cxp - x1, cyp - y1) || 1, ub = Math.hypot(cxp - x2, cyp - y2) || 1
      const p0 = [x1 + ((cxp - x1) / ua) * R, y1 + ((cyp - y1) / ua) * R], p2 = [x2 + ((cxp - x2) / ub) * R, y2 + ((cyp - y2) / ub) * R]
      const pts: number[][] = []
      for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * cxp + t * t * p2[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * cyp + t * t * p2[1]]) }
      d.push({ k: 'poly', pts: bow === 0 ? [p0, p2] : pts, tone, arrow: true, w: hot ? 2.4 : 1.3 })
      const mx = 0.25 * p0[0] + 0.5 * cxp + 0.25 * p2[0], my = 0.25 * p0[1] + 0.5 * cyp + 0.25 * p2[1]
      d.push(txt(mx + (bow === 0 ? 0 : nx * Math.sign(bow) * 8), my + (bow === 0 ? -6 : ny * Math.sign(bow) * 8 + 3), label, { size: 10.5, mono: true, anchor: 'middle', tone: hot ? 'blue' : 'amber' }))
    }
  }
  for (const s of m.states) {
    const [x, y] = pos.get(s)!
    d.push(dot(x, y, R, s, active.has(s) ? 'blue' : m.accept.has(s) ? 'mint' : 'idle', { double: m.accept.has(s), solid: false }))
  }
  const [sx, sy] = pos.get(m.start)!
  d.push({ k: 'line', x1: sx - R - 26, y1: sy, x2: sx - R, y2: sy, tone: 'dim', arrow: true, w: 1.5 })
  return d
}

function closure(m: Machine, set: Set<string>): Set<string> {
  const out = new Set(set), st = [...set]
  while (st.length) { const s = st.pop()!; for (const t of m.trans) if (t.from === s && t.sym === '' && !out.has(t.to)) { out.add(t.to); st.push(t.to) } }
  return out
}

const DEFAULT_DFA = `# strings over {0,1} that end in 01
start: q0
accept: q2
q0,0 -> q1
q0,1 -> q0
q1,0 -> q1
q1,1 -> q2
q2,0 -> q1
q2,1 -> q0`

function fsmRun(p: Params, kind: 'dfa' | 'nfa') {
  const m = parseMachine(kind, pstr(p, 'spec', DEFAULT_DFA))
  const input = (p.input ?? '').replace(/\s+/g, '')
  const W = 640, H = 300
  const pos = layoutStates(m, 400, 200)
  const off = (d: Prim[]): Prim[] => d
  void off
  const frames: Frame[] = []
  const tape = (k: number): Prim[] => [
    clickable(heading(20, 232, 'input ✎'), { do: 'edit', param: 'input', hint: 'Click to type another input string' }),
    ...input.split('').map((c, i) => clickable(box(20 + i * 30, 240, 28, 28, c, i < k ? 'mint' : i === k ? 'blue' : 'idle'), { do: 'edit', param: 'input', hint: 'Click to type another input string' })),
  ]
  const shift = (d: Prim[]) => d
  void shift
  let cur = closure(m, new Set([m.start]))
  const path: string[] = [[...cur].join('|')]
  const draw0 = (act: Set<string>, used: number[], k: number, title: string): Prim[] => [heading(20, 14, title), ...drawMachine(m, pos, act, used, kind), ...tape(k)]
  if (kind === 'dfa') {
    // DFA: every (state,symbol) pair must have at most one transition.
    const seen = new Set<string>()
    for (const t of m.trans) { if (t.sym === '') throw new LabError('a DFA has no ε transitions — use the NFA engine'); const k = `${t.from},${t.sym}`; if (seen.has(k)) throw new LabError(`not deterministic: ${t.from} has two transitions on "${t.sym}"`); seen.add(k) }
  }
  frames.push({ draw: draw0(cur, [], 0, kind.toUpperCase()), note: kind === 'dfa' ? `Start in ${m.start}. Read the input one symbol at a time; each symbol moves the machine along exactly one arrow.` : `Start in the ε-closure of ${m.start}: ${[...cur].join(', ')}. An NFA is in a SET of states at once.` })
  let dead = false
  for (let k = 0; k < input.length; k++) {
    const c = input[k]
    const used: number[] = []
    const next = new Set<string>()
    m.trans.forEach((t, i) => { if (cur.has(t.from) && t.sym === c) { used.push(i); next.add(t.to) } })
    cur = kind === 'nfa' ? closure(m, next) : next
    if (kind === 'nfa') m.trans.forEach((t, i) => { if (t.sym === '' && (next.has(t.from) || cur.has(t.from)) && cur.has(t.to)) used.push(i) })
    path.push([...cur].join('|') || '∅')
    if (cur.size === 0) dead = true
    frames.push({ draw: draw0(cur, used, k + 1, kind.toUpperCase()), note: cur.size === 0 ? `Read "${c}": no transition — the machine is stuck, so the input is rejected.` : `Read "${c}" → ${[...cur].join(', ')}.` })
    if (dead) break
  }
  const acc = !dead && [...cur].some((s) => m.accept.has(s))
  const last = frames[frames.length - 1]
  last.draw.push(txt(430, 258, acc ? 'ACCEPTED' : 'REJECTED', { size: 15, bold: true, tone: acc ? 'mint' : 'rose' }))
  last.note += ` Input ends: ${acc ? 'an accepting state is active → accepted.' : 'no accepting state is active → rejected.'}`
  return trace(W, H, frames, { accepted: acc ? 'yes' : 'no', final: [...cur].join(','), path: path.join(' > ') })
}

// ── PDA ─────────────────────────────────────────────────────────────────────

const DEFAULT_PDA = `# a^n b^n  (accept by final state)
start: q0
accept: q3
q0,e,Z -> q3,Z
q0,a,Z -> q0,AZ
q0,a,A -> q0,AA
q0,b,A -> q1,e
q1,b,A -> q1,e
q1,e,Z -> q3,Z`

function pdaRun(p: Params) {
  const m = parseMachine('pda', pstr(p, 'spec', DEFAULT_PDA))
  const input = (p.input ?? '').replace(/\s+/g, '')
  const pos = layoutStates(m, 400, 200)
  interface Cfg { s: string; i: number; st: string; via: number; prev: number }
  const all: Cfg[] = [{ s: m.start, i: 0, st: 'Z', via: -1, prev: -1 }]
  let accepted = -1
  for (let q = 0; q < all.length && q < 4000 && accepted < 0; q++) {
    const c = all[q]
    if (c.i === input.length && (m.acceptEmpty ? c.st === '' : m.accept.has(c.s))) { accepted = q; break }
    m.trans.forEach((t, ti) => {
      if (t.from !== c.s) return
      if (c.st.length === 0 || c.st[0] !== t.extra) return
      if (t.sym !== '' && input[c.i] !== t.sym) return
      all.push({ s: t.to, i: c.i + (t.sym === '' ? 0 : 1), st: (t.push ?? '') + c.st.slice(1), via: ti, prev: q })
    })
  }
  const chain: Cfg[] = []
  let cur = accepted >= 0 ? accepted : Math.min(all.length - 1, 0)
  if (accepted >= 0) while (cur >= 0) { chain.unshift(all[cur]); cur = all[cur].prev } else chain.push(all[0])
  const W = 640, H = 320
  const frames: Frame[] = chain.map((c, k) => {
    const d: Prim[] = [heading(20, 14, 'Pushdown automaton'), ...drawMachine(m, pos, new Set([c.s]), c.via >= 0 ? [c.via] : [], 'pda')]
    d.push(clickable(heading(20, 232, 'input ✎'), { do: 'edit', param: 'input', hint: 'Click to type another input string' }), ...input.split('').map((ch, i) => clickable(box(20 + i * 30, 240, 28, 28, ch, i < c.i ? 'mint' : i === c.i ? 'blue' : 'idle'), { do: 'edit', param: 'input', hint: 'Click to type another input string' })))
    d.push(heading(470, 14, 'stack'))
    const cells = c.st.split('')
    cells.forEach((s, i) => d.push(box(480, 36 + i * 30, 60, 28, s, i === 0 ? 'amber' : 'idle')))
    if (k === chain.length - 1 && accepted >= 0) d.push(txt(430, 300, 'ACCEPTED', { size: 15, bold: true, tone: 'mint' }))
    if (accepted < 0) d.push(txt(430, 300, 'REJECTED', { size: 15, bold: true, tone: 'rose' }))
    return { draw: d, note: k === 0 ? `Start in ${m.start} with the stack holding only the bottom marker Z (top is drawn first).` : `Move ${chain[k - 1].s} → ${c.s}: ${m.trans[c.via].sym ? `read "${m.trans[c.via].sym}", ` : 'no input read (ε), '}pop ${m.trans[c.via].extra}, push "${m.trans[c.via].push || 'nothing'}".` }
  })
  return trace(W, H, frames, { accepted: accepted >= 0 ? 'yes' : 'no', configsExplored: String(all.length) })
}

// ── Turing machine ──────────────────────────────────────────────────────────

const DEFAULT_TM = `# binary increment: 1011 -> 1100
start: q0
accept: qf
blank: _
q0,0 -> q0,0,R
q0,1 -> q0,1,R
q0,_ -> q1,_,L
q1,1 -> q1,0,L
q1,0 -> qf,1,S
q1,_ -> qf,1,S`

function tmRun(p: Params) {
  const m = parseMachine('tm', pstr(p, 'spec', DEFAULT_TM))
  const maxSteps = pnum(p, 'maxSteps', 200)
  const tape = new Map<number, string>()
  ;(p.input ?? '').replace(/\s+/g, '').split('').forEach((c, i) => tape.set(i, c))
  let head = 0, state = m.start, steps = 0
  const snaps: { tape: Map<number, string>; head: number; state: string; via: number }[] = [{ tape: new Map(tape), head, state, via: -1 }]
  let outcome = 'halted'
  while (steps < maxSteps) {
    if (m.accept.has(state)) { outcome = 'accepted'; break }
    const sym = tape.get(head) ?? m.blank
    const ti = m.trans.findIndex((t) => t.from === state && t.sym === sym)
    if (ti < 0) { outcome = 'rejected'; break }
    const t = m.trans[ti]
    tape.set(head, t.write!)
    head += t.move === 'R' ? 1 : t.move === 'L' ? -1 : 0
    state = t.to; steps++
    snaps.push({ tape: new Map(tape), head, state, via: ti })
  }
  if (steps >= maxSteps) throw new LabError(`no halt after ${maxSteps} steps — an infinite loop (or a very long computation)`)
  const pos = layoutStates(m, 400, 170)
  const W = 640, H = 320
  const frames: Frame[] = snaps.map((s, k) => {
    const d: Prim[] = [heading(20, 14, 'Turing machine'), ...drawMachine(m, pos, new Set([s.state]), s.via >= 0 ? [s.via] : [], 'tm')]
    const lo = s.head - 8
    d.push(clickable(heading(20, 226, 'tape ✎'), { do: 'edit', param: 'input', hint: 'Click to type the starting tape' }))
    for (let i = 0; i < 17; i++) { const idx = lo + i; const v = s.tape.get(idx) ?? m.blank; d.push(clickable(box(20 + i * 34, 236, 32, 32, v === m.blank ? '' : v, idx === s.head ? 'blue' : 'idle', v === m.blank ? '_' : undefined), { do: 'edit', param: 'input', hint: 'Click to type the starting tape' })) }
    d.push({ k: 'line', x1: 20 + 8 * 34 + 16, y1: 288, x2: 20 + 8 * 34 + 16, y2: 270, tone: 'blue', arrow: true, w: 2 })
    d.push(txt(20 + 8 * 34 + 16, 304, s.state, { size: 12, mono: true, bold: true, anchor: 'middle', tone: 'blue' }))
    if (k === snaps.length - 1) d.push(txt(430, 200, outcome === 'accepted' ? 'HALT — ACCEPT' : 'HALT — REJECT', { size: 14, bold: true, tone: outcome === 'accepted' ? 'mint' : 'rose' }))
    const t = s.via >= 0 ? m.trans[s.via] : null
    return { draw: d, note: t ? `Step ${k}: in ${m.trans[s.via].from} reading "${t.sym}" → write "${t.write}", move ${t.move === 'L' ? 'left' : t.move === 'R' ? 'right' : 'stay'}, go to ${t.to}.` : `Start in ${m.start} with the head on the first tape symbol.` }
  })
  const keys = [...tape.keys()].sort((a, b) => a - b)
  const out = keys.map((i) => tape.get(i)).join('').replace(new RegExp(`^${m.blank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+|${m.blank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}+$`, 'g'), '')
  return trace(W, H, frames, { outcome, tape: out, steps: String(steps), state })
}

// ── Context-free grammar derivation ─────────────────────────────────────────

const DEFAULT_CFG = `S -> aSb | ab`

function cfgRun(p: Params) {
  const rules = new Map<string, string[]>()
  let startSym = ''
  pstr(p, 'grammar', DEFAULT_CFG).split(/\r?\n/).forEach((raw, i) => {
    const l = raw.replace(/#.*$/, '').trim(); if (!l) return
    const m = /^([A-Z])\s*(?:->|→)\s*(.+)$/.exec(l)
    if (!m) throw new LabError(`grammar line ${i + 1}: write  S -> aSb | ab   (uppercase = variable, ε as e)`)
    if (!startSym) startSym = m[1]
    rules.set(m[1], [...(rules.get(m[1]) ?? []), ...m[2].split('|').map((x) => { const t = x.trim(); return EPS.has(t) ? '' : t.replace(/\s+/g, '') })])
  })
  const target = (p.string ?? '').replace(/\s+/g, '')
  // Search over leftmost derivations, carrying the parse tree as we go.
  interface St { form: NNode[]; steps: { form: string; rule: string }[] }
  const text = (f: NNode[]) => f.map((n) => n.label).join('') || 'ε'
  const cloneNodes = (f: NNode[]): { list: NNode[]; map: Map<NNode, NNode> } => { const map = new Map<NNode, NNode>(); const c = (n: NNode): NNode => { const x = { label: n.label, kids: n.kids.map(c), tone: n.tone }; map.set(n, x); return x }; return { list: f.map(c), map } }
  const root: NNode = { label: startSym, kids: [] }
  const queue: { form: NNode[]; steps: { form: string; rule: string }[]; root: NNode }[] = [{ form: [root], steps: [{ form: startSym, rule: 'start symbol' }], root }]
  let found: (typeof queue)[number] | null = null
  const seen = new Set<string>()
  for (let qi = 0; qi < queue.length && qi < 20000 && !found; qi++) {
    const cur = queue[qi]
    const s = text(cur.form)
    if (s === (target || 'ε') && !cur.form.some((n) => /[A-Z]/.test(n.label))) { found = cur; break }
    const idx = cur.form.findIndex((n) => /^[A-Z]$/.test(n.label))
    if (idx < 0) continue
    // prune: terminals prefix must match, length bound
    const pre = cur.form.slice(0, idx).map((n) => n.label).join('')
    if (!target.startsWith(pre) || cur.form.length > target.length + 3) continue
    for (const rhs of rules.get(cur.form[idx].label) ?? []) {
      const copy = cloneNodes(cur.form)
      const rootCopy = (() => { const map = new Map<NNode, NNode>(); const c = (n: NNode): NNode => { const x = { label: n.label, kids: n.kids.map(c), tone: n.tone }; map.set(n, x); return x }; const r = c(cur.root); return { r, map } })()
      void copy
      const target2 = (() => { // locate the same node in the cloned tree by path
        const find = (a: NNode, b: NNode, want: NNode): NNode | null => { if (a === want) return b; for (let i = 0; i < a.kids.length; i++) { const f = find(a.kids[i], b.kids[i], want); if (f) return f } return null }
        return find(cur.root, rootCopy.r, cur.form[idx])!
      })()
      target2.kids = rhs === '' ? [{ label: 'ε', kids: [] }] : rhs.split('').map((ch) => ({ label: ch, kids: [] }))
      // rebuild the sentential form (frontier) from the cloned tree, keeping order
      const frontier: NNode[] = []
      const collect = (n: NNode) => { if (n.kids.length === 0) { if (n.label !== 'ε') frontier.push(n) } else n.kids.forEach(collect) }
      collect(rootCopy.r)
      const key = frontier.map((n) => n.label).join('')
      if (seen.has(key + '#' + cur.steps.length)) continue
      seen.add(key + '#' + cur.steps.length)
      queue.push({ form: frontier, root: rootCopy.r, steps: [...cur.steps, { form: text(frontier), rule: `${cur.form[idx].label} → ${rhs || 'ε'}` }] })
    }
  }
  if (!found) throw new LabError(`"${target}" cannot be derived from ${startSym} — not in the language (within the search limit)`)
  const W = 640, H = 340
  const frames: Frame[] = found.steps.map((s, k) => ({ draw: [clickable(heading(20, 14, `Leftmost derivation of "${target || 'ε'}" ✎`), { do: 'edit', param: 'string', hint: 'Click to type another string' }), ...found!.steps.slice(0, k + 1).map((st, i) => txt(20, 44 + i * 20, `${i === 0 ? '' : '⇒ '}${st.form}`, { size: 12.5, mono: true, tone: i === k ? 'blue' : 'idle', bold: i === k })), ...found!.steps.slice(0, k + 1).map((st, i) => txt(300, 44 + i * 20, i === 0 ? '' : st.rule, { size: 11, mono: true, tone: 'amber' }))], note: k === 0 ? `Start from ${startSym}. Each step rewrites the leftmost variable using one production.` : `Apply ${s.rule}.` }))
  const tree = drawTree(found.root, 34, 52, 400, 200, 13)
  const sc = 1
  void sc
  frames[frames.length - 1].draw.push(heading(400, 176, 'parse tree'), ...tree.prims.map((pm) => (pm.k === 'circle' ? { ...pm, y: pm.y - 130, x: pm.x - 250 } : pm.k === 'line' ? { ...pm, y1: pm.y1 - 130, y2: pm.y2 - 130, x1: pm.x1 - 250, x2: pm.x2 - 250 } : pm)))
  return trace(W, H, frames, { derivable: 'yes', steps: String(found.steps.length - 1), derivation: found.steps.map((s) => s.form).join(' => ') })
}

export const TOC_ENGINES: EngineDef[] = [
  { id: 'dfa', label: 'DFA', group: G, blurb: 'Deterministic finite automaton: draw the machine and run a string through it.',
    params: [{ name: 'spec', label: 'Machine', hint: 'start: q0 / accept: q2 / q0,a -> q1', def: DEFAULT_DFA, long: true }, { name: 'input', label: 'Input', hint: 'string to test', def: '1101', optional: true }], run: (p) => fsmRun(p, 'dfa') },
  { id: 'nfa', label: 'NFA / ε-NFA', group: G, blurb: 'Nondeterministic automaton: the set of active states, with ε-closure.',
    params: [{ name: 'spec', label: 'Machine', hint: 'q0,a -> q0,q1 ; q1,e -> q2 (e = ε)', def: `start: q0\naccept: q2\nq0,0 -> q0\nq0,1 -> q0,q1\nq1,0 -> q2\nq1,1 -> q2`, long: true }, { name: 'input', label: 'Input', hint: 'string to test', def: '0110', optional: true }], run: (p) => fsmRun(p, 'nfa') },
  { id: 'pda', label: 'Pushdown automaton', group: G, blurb: 'A finite automaton plus a stack: recognise aⁿbⁿ and other context-free languages.',
    params: [{ name: 'spec', label: 'Machine', hint: 'q0,input,stackTop -> q1,push (Z = bottom, e = ε)', def: DEFAULT_PDA, long: true }, { name: 'input', label: 'Input', hint: 'string to test', def: 'aaabbb', optional: true }], run: pdaRun },
  { id: 'tm', label: 'Turing machine', group: G, blurb: 'A tape, a head and a finite control: compute or decide by rewriting symbols.',
    params: [{ name: 'spec', label: 'Machine', hint: 'q0,read -> q1,write,L|R|S', def: DEFAULT_TM, long: true }, { name: 'input', label: 'Tape', hint: 'initial tape contents', def: '1011', optional: true }, { name: 'maxSteps', label: 'Step limit', hint: 'guard against loops', def: '200' }], run: tmRun },
  { id: 'cfg', label: 'Context-free grammar', group: G, blurb: 'Leftmost derivation and parse tree of a string.',
    params: [{ name: 'grammar', label: 'Grammar', hint: 'S -> aSb | ab  (uppercase = variable, e = ε)', def: DEFAULT_CFG, long: true }, { name: 'string', label: 'String', hint: 'string to derive', def: 'aaabbb' }], run: cfgRun },
]

void poly
