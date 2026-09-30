// Computer organisation, microprocessors and number systems
// (ENCT 303 COA, ENEX 201 Microprocessors, ENEX 152 Digital Logic).

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, fmt, pnum, pnums, pstr, plist } from '../types'
import { arrow, bits, box, cells, dot, heading, line, toneAt, trace, txt } from '../draw'

const hex = (v: number, w = 2) => v.toString(16).toUpperCase().padStart(w, '0')
const parseNum = (s: string): number => {
  const t = s.trim()
  let v: number
  if (/^0x[0-9a-f]+$/i.test(t)) v = parseInt(t.slice(2), 16)
  else if (/^[0-9a-f]+h$/i.test(t)) v = parseInt(t.slice(0, -1), 16)
  else if (/^0b[01]+$/i.test(t)) v = parseInt(t.slice(2), 2)
  else if (/^'.'$/.test(t)) v = t.charCodeAt(1)
  else if (/^-?\d+$/.test(t)) v = Number(t)
  else throw new LabError(`"${s}" is not a number (use 25, 19H, 0x19 or 0b11001)`)
  return v
}

// ── Cache ───────────────────────────────────────────────────────────────────

const log2i = (n: number): number => {
  const b = Math.log2(n)
  if (!Number.isInteger(b)) throw new LabError(`${n} must be a power of two`)
  return b
}

export function cacheSim(lines: number, ways: number, block: number, policy: string, addrs: number[]) {
  const sets = lines / ways
  const cache: { tag: number; t: number; ins: number }[][] = Array.from({ length: sets }, () => [])
  const out = addrs.map((a, i) => {
    const blk = Math.floor(a / block)
    const set = blk % sets
    const tag = Math.floor(blk / sets)
    const row = cache[set]
    const hit = row.findIndex((w) => w.tag === tag)
    let evicted: number | null = null
    let way: number
    if (hit >= 0) { row[hit].t = i; way = hit }
    else if (row.length < ways) { row.push({ tag, t: i, ins: i }); way = row.length - 1 }
    else {
      const victim = row.map((w, k) => ({ w, k })).sort((x, y) => (policy === 'fifo' ? x.w.ins - y.w.ins : x.w.t - y.w.t))[0].k
      evicted = row[victim].tag * sets + set
      row[victim] = { tag, t: i, ins: i }
      way = victim
    }
    return { a, blk, set, tag, hit: hit >= 0, way, evicted, snapshot: cache.map((r) => r.map((w) => w.tag)) }
  })
  return { out, sets }
}

function cacheRun(p: Params) {
  const lines = pnum(p, 'lines', 4)
  const mapping = pstr(p, 'mapping', 'direct')
  const ways = mapping === 'direct' ? 1 : mapping === 'full' ? lines : pnum(p, 'ways', 2)
  const block = pnum(p, 'block', 1)
  const policy = pstr(p, 'policy', 'lru')
  const addrs = plist(p, 'addrs', ['0', '8', '0', '6', '8'], /[\s,;]+/).map(parseNum)
  const tHit = pnum(p, 'hitTime', 1), penalty = pnum(p, 'missPenalty', 100)
  log2i(lines); log2i(block)
  if (lines % ways !== 0) throw new LabError('ways must divide the number of lines')
  const { out, sets } = cacheSim(lines, ways, block, policy, addrs)
  const offB = log2i(block), idxB = log2i(sets)
  const abits = Math.max(6, Math.ceil(Math.log2(Math.max(...addrs) + 1)))
  const tagB = Math.max(1, abits - idxB - offB)
  const W = 560, H = 120 + sets * 30 + 40
  const frames: Frame[] = []
  const hits = out.filter((o) => o.hit).length
  for (let k = 0; k <= out.length; k++) {
    const draw: Prim[] = [heading(20, 14, `${mapping === 'direct' ? 'direct-mapped' : mapping === 'full' ? 'fully associative' : `${ways}-way set associative`} · ${lines} lines · ${block}-byte blocks · ${policy.toUpperCase()}`)]
    const cur = k > 0 ? out[k - 1] : null
    // Address split
    if (cur) {
      const bin = cur.a.toString(2).padStart(abits, '0')
      const tagS = bin.slice(0, tagB), idxS = bin.slice(tagB, tagB + idxB), offS = bin.slice(tagB + idxB)
      const bw = 16
      draw.push(txt(20, 42, `address ${cur.a}`, { size: 11, mono: true, tone: 'amber' }))
      draw.push(...bits(tagS, 110, 26, bw, Array(tagS.length).fill('blue')))
      draw.push(...bits(idxS, 110 + tagS.length * bw + 6, 26, bw, Array(idxS.length).fill('violet')))
      draw.push(...bits(offS, 110 + (tagS.length + idxS.length) * bw + 12, 26, bw, Array(offS.length).fill('dim')))
      draw.push(txt(110, 66, 'tag', { size: 9.5, tone: 'blue' }), txt(110 + tagS.length * bw + 6, 66, 'index', { size: 9.5, tone: 'violet' }), txt(110 + (tagS.length + idxS.length) * bw + 12, 66, 'offset', { size: 9.5, tone: 'dim' }))
    }
    // Sets
    const top = 84
    for (let s = 0; s < sets; s++) {
      draw.push(txt(20, top + s * 30 + 19, `set ${s}`, { size: 10.5, mono: true, tone: 'dim' }))
      for (let w = 0; w < ways; w++) {
        const tag = k === 0 ? undefined : out[k - 1].snapshot[s][w]
        const isCur = cur && cur.set === s && cur.way === w
        const tone: Tone = tag === undefined ? 'dim' : isCur ? (cur!.hit ? 'mint' : 'rose') : 'idle'
        draw.push(box(70 + w * 96, top + s * 30, 90, 24, tag === undefined ? '—' : `tag ${tag}`, tone, undefined))
      }
    }
    const y = top + sets * 30 + 14
    draw.push(txt(20, y + 8, `hits ${out.slice(0, k).filter((o) => o.hit).length} · misses ${out.slice(0, k).filter((o) => !o.hit).length}`, { size: 12, mono: true, tone: 'amber' }))
    addrs.forEach((a, i) => draw.push(box(20 + i * 30, y + 22, 27, 20, String(a), i < k ? (out[i].hit ? 'mint' : 'rose') : i === k ? 'blue' : 'idle')))
    frames.push({
      draw,
      note: !cur ? 'Each address is split into tag | index | offset. The index picks the set; the tag is compared with every way in it.'
        : cur.hit ? `Address ${cur.a} → set ${cur.set}: tag ${cur.tag} is present — HIT.`
        : cur.evicted !== null ? `Address ${cur.a} → set ${cur.set}: tag ${cur.tag} absent — MISS. The set is full, so ${policy.toUpperCase()} evicts block ${cur.evicted}.`
        : `Address ${cur.a} → set ${cur.set}: tag ${cur.tag} absent — MISS (compulsory or empty way, nothing evicted).`,
    })
  }
  const missRate = 1 - hits / out.length
  return trace(W, H, frames, {
    hits: String(hits), misses: String(out.length - hits), hitRate: fmt((hits / out.length) * 100, 1),
    amat: fmt(tHit + missRate * penalty, 2),
  })
}

// ── Number systems and codes ────────────────────────────────────────────────

function numconvRun(p: Params) {
  const n = parseNum(pstr(p, 'n', '25'))
  const nb = pnum(p, 'bits', 8)
  if (nb < 2 || nb > 16) throw new LabError('bits must be 2–16')
  const mag = Math.abs(n)
  const bin = mag.toString(2)
  const twos = ((n < 0 ? (1 << nb) + n : n) & ((1 << nb) - 1)).toString(2).padStart(nb, '0')
  const ones = n < 0 ? (((1 << nb) - 1) & (~mag)).toString(2).padStart(nb, '0') : mag.toString(2).padStart(nb, '0')
  const signMag = (n < 0 ? '1' : '0') + mag.toString(2).padStart(nb - 1, '0')
  const bcd = String(mag).split('').map((d) => Number(d).toString(2).padStart(4, '0')).join(' ')
  const ex3 = String(mag).split('').map((d) => (Number(d) + 3).toString(2).padStart(4, '0')).join(' ')
  const gray = (mag ^ (mag >> 1)).toString(2).padStart(bin.length, '0')
  const rows: [string, string, Tone][] = [
    ['decimal', String(n), 'amber'], ['binary', bin, 'blue'], ['octal', mag.toString(8), 'violet'], ['hex', mag.toString(16).toUpperCase(), 'violet'],
    ['BCD (8421)', bcd, 'mint'], ['excess-3', ex3, 'mint'], ['Gray', gray, 'mint'],
    [`sign-magnitude ${nb}b`, signMag, 'idle'], [`1's complement ${nb}b`, ones, 'idle'], [`2's complement ${nb}b`, twos, 'idle'],
  ]
  const W = 560
  const steps: { draw: Prim[]; note: string }[] = []
  // Frame per representation: repeated division for the binary one first.
  const divs: string[] = []
  let q = mag
  do { divs.push(`${q} ÷ 2 = ${Math.floor(q / 2)} r ${q % 2}`); q = Math.floor(q / 2) } while (q > 0)
  const H = 60 + Math.max(rows.length * 24, divs.length * 18) + 30
  const table = (upto: number): Prim[] => {
    const d: Prim[] = [heading(20, 14, `${n} in every code`)]
    rows.slice(0, upto).forEach(([name, val, tone], i) => {
      d.push(txt(20, 42 + i * 24, name, { size: 11, tone: 'dim' }))
      d.push(txt(190, 42 + i * 24, val, { size: 13, mono: true, tone, bold: i === upto - 1 }))
    })
    return d
  }
  const notes = [
    '', 'Repeated division by 2: the remainders, read bottom to top, are the bits.', 'Group the binary bits in threes for octal…', '…and in fours for hexadecimal.',
    'BCD writes each decimal digit as its own 4-bit group.', 'Excess-3 is BCD with 3 added to every digit.', 'Gray code: b ⊕ (b >> 1) — neighbours differ in exactly one bit.',
    'Sign-magnitude: one sign bit then the magnitude.', "1's complement: invert every bit of the magnitude for a negative number.", "2's complement: invert and add 1 — the form adders use; the negative range is one larger.",
  ]
  for (let k = 1; k <= rows.length; k++) {
    const d = table(k)
    if (k === 2) divs.forEach((t, i) => d.push(txt(360, 42 + i * 18, t, { size: 11, mono: true, tone: 'blue' })))
    steps.push({ draw: d, note: notes[k] || `${rows[k - 1][0]}: ${rows[k - 1][1]}` })
  }
  return trace(W, H, steps, { binary: bin, octal: mag.toString(8), hex: mag.toString(16).toUpperCase(), bcd, excess3: ex3, gray, twos, ones, signMag })
}

// ── IEEE 754 ────────────────────────────────────────────────────────────────

function ieeeRun(p: Params) {
  const x = Number(pstr(p, 'value', '5.75'))
  if (!Number.isFinite(x)) throw new LabError('x must be a finite number')
  const dbl = pstr(p, 'format', 'single') === 'double'
  const buf = new DataView(new ArrayBuffer(8))
  if (dbl) buf.setFloat64(0, x); else buf.setFloat32(0, x)
  const eb = dbl ? 11 : 8, mb = dbl ? 52 : 23, bias = dbl ? 1023 : 127
  const all = dbl ? Array.from({ length: 8 }, (_, i) => buf.getUint8(i).toString(2).padStart(8, '0')).join('') : buf.getUint32(0).toString(2).padStart(32, '0')
  const s = all[0], e = all.slice(1, 1 + eb), m = all.slice(1 + eb)
  const eVal = parseInt(e, 2)
  const hexStr = dbl ? Array.from({ length: 8 }, (_, i) => hex(buf.getUint8(i))).join('') : hex(buf.getUint32(0), 8)
  const W = 620, H = 210
  const cw = dbl ? 8.4 : 13
  const row = (upto: number): Prim[] => {
    const d: Prim[] = [heading(20, 14, `${dbl ? 'binary64' : 'binary32'} · x = ${x}`)]
    const tones: Tone[] = [...Array(1).fill('rose'), ...Array(eb).fill('amber'), ...Array(mb).fill('blue')]
    const all2 = (s + e + m).split('')
    d.push(...cells(20, 34, all2.slice(0, Math.max(0, upto)), cw, 26, tones.slice(0, upto), { r: 2 }))
    d.push(txt(20, 78, 'sign', { size: 10, tone: 'rose' }), txt(20 + cw, 78, 'exponent', { size: 10, tone: 'amber' }), txt(20 + cw * (1 + eb) + 6, 78, 'fraction', { size: 10, tone: 'blue' }))
    return d
  }
  const norm = x === 0 ? 0 : Math.floor(Math.log2(Math.abs(x)))
  const total = 1 + eb + mb
  const steps: Frame[] = [
    { draw: row(0), note: `Write ${x} as ±1.f × 2^e. Then pack the sign, the biased exponent and the fraction.` },
    { draw: [...row(1), txt(20, 110, `sign bit = ${s}  (${s === '0' ? 'positive' : 'negative'})`, { size: 12, mono: true, tone: 'rose' })], note: 'Sign: 0 for positive, 1 for negative.' },
    { draw: [...row(1 + eb), txt(20, 110, `sign = ${s}`, { size: 12, mono: true, tone: 'rose' }), txt(20, 130, `e = ${norm},  biased exponent = ${norm} + ${bias} = ${eVal}  →  ${e}`, { size: 12, mono: true, tone: 'amber' })], note: `Normalise to 1.f × 2^${norm}; store the exponent plus the bias ${bias} so it is always non-negative.` },
    { draw: [...row(total), txt(20, 110, `sign = ${s}`, { size: 12, mono: true, tone: 'rose' }), txt(20, 130, `exponent = ${eVal} (e = ${eVal - bias})`, { size: 12, mono: true, tone: 'amber' }), txt(20, 150, `fraction = ${m.slice(0, 32)}${mb > 32 ? '…' : ''}`, { size: 12, mono: true, tone: 'blue' }), txt(20, 176, `0x${hexStr}`, { size: 15, mono: true, bold: true, tone: 'mint' })], note: 'The leading 1 of 1.f is implicit (hidden bit), so only the fraction after the point is stored.' },
  ]
  return trace(W, H, steps, { sign: s, exponent: e, fraction: m, hex: hexStr, biased: String(eVal), unbiased: String(eVal - bias) })
}

// ── Booth multiplication ────────────────────────────────────────────────────

function boothRun(p: Params) {
  const nb = pnum(p, 'bits', 4)
  const mcand = pnum(p, 'm', 7), mplier = pnum(p, 'q', -3)
  const lim = 1 << (nb - 1)
  if (mcand < -lim || mcand >= lim || mplier < -lim || mplier >= lim) throw new LabError(`with ${nb} bits both numbers must lie in ${-lim}…${lim - 1}`)
  if (mcand === -lim) throw new LabError(`−M would overflow: ${mcand} is the most negative ${nb}-bit number, so A − M is not representable. Use one more bit.`)
  const mask = (1 << nb) - 1
  const toBits = (v: number) => (v & mask).toString(2).padStart(nb, '0')
  let A = 0, Q = mplier & mask, q1 = 0
  const M = mcand & mask
  const rows: { step: string; A: string; Q: string; q1: number; op: string }[] = [{ step: 'init', A: toBits(0), Q: toBits(Q), q1: 0, op: '' }]
  for (let i = 0; i < nb; i++) {
    const pair = `${Q & 1}${q1}`
    let op = 'no change'
    if (pair === '10') { A = (A - M) & mask; op = 'A ← A − M' }
    else if (pair === '01') { A = (A + M) & mask; op = 'A ← A + M' }
    rows.push({ step: `${i + 1}a`, A: toBits(A), Q: toBits(Q), q1, op: `${pair}: ${op}` })
    const sign = A & (1 << (nb - 1))
    q1 = Q & 1
    Q = ((Q >> 1) | ((A & 1) << (nb - 1))) & mask
    A = ((A >> 1) | sign) & mask
    rows.push({ step: `${i + 1}b`, A: toBits(A), Q: toBits(Q), q1, op: 'arithmetic shift right (A,Q,Q₋₁)' })
  }
  const full = nb * 2
  const prod = ((A << nb) | Q)
  const p2 = prod >= 1 << (full - 1) ? prod - (1 << full) : prod
  const W = 600, H = 70 + rows.length * 22 + 30
  const frames: Frame[] = rows.map((_, k) => {
    const d: Prim[] = [heading(20, 14, `Booth · ${mcand} × ${mplier} · M = ${toBits(M)}`)]
    ;['step', 'A', 'Q', 'Q₋₁', 'operation'].forEach((h, i) => d.push(txt([20, 80, 190, 300, 340][i], 40, h, { size: 10, bold: true, tone: 'dim' })))
    rows.slice(0, k + 1).forEach((r, i) => {
      const y = 60 + i * 22
      const tone: Tone = i === k ? 'blue' : 'idle'
      d.push(txt(20, y, r.step, { size: 12, mono: true, tone }), txt(80, y, r.A, { size: 12, mono: true, tone }), txt(190, y, r.Q, { size: 12, mono: true, tone }), txt(300, y, String(r.q1), { size: 12, mono: true, tone }), txt(340, y, r.op, { size: 11.5, tone: i === k ? 'amber' : 'dim' }))
    })
    if (k === rows.length - 1) d.push(txt(20, H - 14, `A:Q = ${toBits(A)}${toBits(Q)} = ${p2}`, { size: 14, mono: true, bold: true, tone: 'mint' }))
    return { draw: d, note: k === 0 ? 'Booth looks at the last two multiplier bits (Q₀, Q₋₁): 10 subtracts M, 01 adds M, 00 and 11 do nothing; then everything shifts right.' : `${rows[k].op}` }
  })
  return trace(W, H, frames, { product: String(p2), binary: `${toBits(A)}${toBits(Q)}` })
}

// ── Pipeline ────────────────────────────────────────────────────────────────

interface Ins { text: string; dst: string | null; srcs: string[]; load: boolean }
const isReg = (a: string) => /^\$?[a-z]\w*$/i.test(a.trim())
const regOf = (a: string) => a.trim().replace('$', '')
function parseIns(line: string): Ins {
  const m = /^(\w+)\s*(.*)$/.exec(line.trim())
  if (!m) throw new LabError(`cannot read "${line}"`)
  const op = m[1].toLowerCase()
  const args = m[2].split(',').map((s) => s.trim()).filter(Boolean)
  const base = (a: string) => /\(([^)]+)\)/.exec(a)?.[1]
  if (op === 'lw') return { text: line.trim(), dst: isReg(args[0] ?? '') ? regOf(args[0]) : null, srcs: [base(args[1] ?? '') ?? ''].filter(isReg).map(regOf), load: true }
  if (op === 'sw') return { text: line.trim(), dst: null, srcs: [args[0], base(args[1] ?? '') ?? ''].filter((x) => x && isReg(x)).map(regOf), load: false }
  if (op === 'beq' || op === 'bne') return { text: line.trim(), dst: null, srcs: args.slice(0, 2).filter(isReg).map(regOf), load: false }
  if (op === 'nop') return { text: 'nop', dst: null, srcs: [], load: false }
  if (args.length === 0) throw new LabError(`"${line}" needs operands, e.g. add r3, r1, r4`)
  return { text: line.trim(), dst: isReg(args[0]) ? regOf(args[0]) : null, srcs: args.slice(1).filter(isReg).map(regOf), load: false }
}

/** In-order 5-stage pipeline with the register file written in the first half
 *  of WB and read in the second half of ID. Per instruction: the cycle it
 *  starts IF, the cycle it enters ID, and its EX/MEM/WB cycles. */
export function pipelineSim(prog: Ins[], forwarding: boolean) {
  const sched: { ifStart: number; id: number; ex: number; mem: number; wb: number; stall: number }[] = []
  prog.forEach((ins, i) => {
    const prev = sched[i - 1]
    const ifStart = prev ? prev.id : 1
    const id = Math.max(ifStart + 1, prev ? prev.ex : 0)
    let ex = id + 1
    for (const s of ins.srcs) {
      for (let j = i - 1; j >= 0; j--) {
        if (prog[j].dst === s) {
          const need = forwarding ? (prog[j].load ? sched[j].ex + 2 : sched[j].ex + 1) : sched[j].wb + 1
          ex = Math.max(ex, need)
          break
        }
      }
    }
    sched.push({ ifStart, id, ex, mem: ex + 1, wb: ex + 2, stall: ex - (id + 1) })
  })
  return sched
}

function pipelineRun(p: Params) {
  const src = plist(p, 'prog', ['lw r1, 0(r2)', 'add r3, r1, r4', 'sub r5, r3, r6', 'sw r5, 4(r2)'])
  const fwd = pstr(p, 'forwarding', 'on') === 'on'
  const prog = src.map(parseIns)
  const sched = pipelineSim(prog, fwd)
  const total = Math.max(...sched.map((s) => s.wb))
  const cw = Math.min(34, Math.floor(400 / total)), x0 = 190, ch = 26
  const W = x0 + total * cw + 20, H = 70 + prog.length * (ch + 4) + 50
  const frames: Frame[] = []
  const stalls = sched.reduce((a, s) => a + s.stall, 0)
  const tones = ['blue', 'violet', 'mint', 'amber', 'rose'] as Tone[]
  const names = ['IF', 'ID', 'EX', 'MEM', 'WB']
  const stageAt = (s: (typeof sched)[number], t: number): { st: number; repeat: boolean } | null => {
    if (t < s.ifStart || t > s.wb) return null
    if (t < s.id) return { st: 0, repeat: t > s.ifStart }
    if (t < s.ex) return { st: 1, repeat: t > s.id }
    return { st: 2 + (t - s.ex), repeat: false }
  }
  for (let c = 0; c <= total; c++) {
    const d: Prim[] = [heading(20, 14, `5-stage pipeline · forwarding ${fwd ? 'ON' : 'OFF'}`)]
    for (let t = 1; t <= total; t++) d.push(txt(x0 + (t - 1) * cw + cw / 2, 38, String(t), { size: 10, anchor: 'middle', mono: true, tone: t === c ? 'blue' : 'dim' }))
    prog.forEach((ins, i) => {
      const y = 46 + i * (ch + 4)
      d.push(txt(20, y + 17, ins.text, { size: 11.5, mono: true }))
      for (let t = 1; t <= Math.min(c, total); t++) {
        const at = stageAt(sched[i], t)
        if (at) d.push(box(x0 + (t - 1) * cw + 1, y, cw - 2, ch, names[at.st], at.repeat ? 'amber' : tones[at.st]))
      }
    })
    d.push(txt(20, H - 14, `cycles ${total} · stalls ${stalls} · CPI ${fmt(total / prog.length, 2)}`, { size: 12, mono: true, tone: 'amber' }))
    frames.push({
      draw: d,
      note: c === 0 ? 'Each instruction passes IF → ID → EX → MEM → WB, one stage per cycle; ideally a new instruction completes every cycle.'
        : `Cycle ${c}: ` + prog.map((ins, i) => { const at = stageAt(sched[i], c); return at ? `${ins.text.split(' ')[0]}#${i + 1} in ${names[at.st]}${at.repeat ? ' (stalled)' : ''}` : null }).filter(Boolean).join(' · '),
    })
  }
  return trace(W, H, frames, { cycles: String(total), stalls: String(stalls), cpi: fmt(total / prog.length, 2), speedup: fmt((prog.length * 5) / total, 2) })
}

// ── K-map & Quine–McCluskey ─────────────────────────────────────────────────

export interface Implicant { value: number; mask: number } // mask bit=1 → don't care in that position
export function primeImplicants(vars: number, ones: number[], dcs: number[]): Implicant[] {
  let cur = new Set([...ones, ...dcs].map((m) => `${m}:0`))
  const primes: Implicant[] = []
  for (;;) {
    const list = [...cur].map((s) => { const [v, m] = s.split(':').map(Number); return { value: v, mask: m } })
    const used = new Set<string>()
    const next = new Set<string>()
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      if (a.mask !== b.mask) continue
      const diff = a.value ^ b.value
      if (diff && (diff & (diff - 1)) === 0) {
        next.add(`${a.value & b.value}:${a.mask | diff}`)
        used.add(`${a.value}:${a.mask}`); used.add(`${b.value}:${b.mask}`)
      }
    }
    for (const s of cur) if (!used.has(s)) { const [v, m] = s.split(':').map(Number); primes.push({ value: v, mask: m }) }
    if (next.size === 0) break
    cur = next
  }
  return primes
}
const covers = (imp: Implicant, m: number) => ((m ^ imp.value) & ~imp.mask) === 0
export function minimise(vars: number, ones: number[], dcs: number[]): Implicant[] {
  if (ones.length === 0) return []
  const primes = primeImplicants(vars, ones, dcs)
  const chosen: Implicant[] = []
  let left = [...ones]
  // essential prime implicants
  for (const m of ones) {
    const c = primes.filter((pi) => covers(pi, m))
    if (c.length === 1 && !chosen.includes(c[0])) chosen.push(c[0])
  }
  left = left.filter((m) => !chosen.some((c) => covers(c, m)))
  while (left.length) {
    const best = primes.map((pi) => ({ pi, n: left.filter((m) => covers(pi, m)).length })).sort((a, b) => b.n - a.n)[0]
    chosen.push(best.pi)
    left = left.filter((m) => !covers(best.pi, m))
  }
  return chosen
}
export const implicantText = (imp: Implicant, vars: number): string => {
  const names = 'ABCD'.slice(0, vars).split('')
  const parts = names.map((n, i) => {
    const bit = 1 << (vars - 1 - i)
    if (imp.mask & bit) return ''
    return imp.value & bit ? n : `${n}'`
  }).join('')
  return parts || '1'
}

function kmapRun(p: Params) {
  const vars = pnum(p, 'vars', 4)
  if (![2, 3, 4].includes(vars)) throw new LabError('vars must be 2, 3 or 4')
  const ones = pnums(p, 'minterms', [0, 1, 2, 5, 6, 7, 8, 9, 10, 14])
  const dcs = pnums(p, 'dontcares', [])
  const max = 1 << vars
  if ([...ones, ...dcs].some((m) => m < 0 || m >= max || !Number.isInteger(m))) throw new LabError(`minterms must lie in 0…${max - 1}`)
  const chosen = minimise(vars, ones, dcs)
  const rowsV = vars === 4 ? 2 : vars === 3 ? 1 : 1
  const colsV = vars - rowsV
  const gray = (n: number) => n ^ (n >> 1)
  const R = 1 << rowsV, C = 1 << colsV
  const cellSz = 44, x0 = 90, y0 = 60
  const rowNames = 'ABCD'.slice(0, rowsV), colNames = 'ABCD'.slice(rowsV, vars)
  const W = x0 + C * cellSz + 220, H = y0 + R * cellSz + 60
  const mAt = (r: number, c: number) => (gray(r) << colsV) | gray(c)
  const frames: Frame[] = []
  const grid = (highlight: Implicant[]): Prim[] => {
    const d: Prim[] = [heading(20, 14, `K-map · ${vars} variables`)]
    d.push(txt(20, y0 - 30, `${rowNames}\\${colNames}`, { size: 11, mono: true, tone: 'dim' }))
    for (let c = 0; c < C; c++) d.push(txt(x0 + c * cellSz + cellSz / 2, y0 - 8, gray(c).toString(2).padStart(colsV, '0'), { size: 11, mono: true, anchor: 'middle', tone: 'dim' }))
    for (let r = 0; r < R; r++) d.push(txt(x0 - 10, y0 + r * cellSz + cellSz / 2 + 4, gray(r).toString(2).padStart(rowsV, '0'), { size: 11, mono: true, anchor: 'end', tone: 'dim' }))
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const m = mAt(r, c)
      const one = ones.includes(m), dc = dcs.includes(m)
      const hl = highlight.findIndex((imp) => covers(imp, m))
      d.push(box(x0 + c * cellSz, y0 + r * cellSz, cellSz - 2, cellSz - 2, one ? '1' : dc ? 'X' : '0', hl >= 0 ? toneAt(hl) : one ? 'mint' : 'idle', `m${m}`))
    }
    return d
  }
  frames.push({ draw: grid([]), note: 'Cells are arranged in Gray-code order so physical neighbours differ in one variable — including across the edges (the map wraps around).' })
  chosen.forEach((imp, i) => {
    const d = grid(chosen.slice(0, i + 1))
    chosen.slice(0, i + 1).forEach((c, k) => d.push(txt(x0 + C * cellSz + 24, y0 + 14 + k * 22, `${implicantText(c, vars)}   covers ${[...Array(max).keys()].filter((m) => covers(c, m) && (ones.includes(m) || dcs.includes(m))).join(',')}`, { size: 12, mono: true, tone: toneAt(k) })))
    frames.push({ draw: d, note: `Group ${i + 1}: ${implicantText(imp, vars)} — a group of ${2 ** [...Array(vars).keys()].filter((b) => imp.mask & (1 << b)).length} cells; the variables that change inside the group drop out.` })
  })
  const sop = chosen.map((c) => implicantText(c, vars)).join(' + ') || '0'
  const last = frames[frames.length - 1]
  last.draw.push(txt(20, H - 16, `F = ${sop}`, { size: 14, mono: true, bold: true, tone: 'mint' }))
  return trace(W, H, frames, { sop, terms: String(chosen.length) })
}

// ── Registry rows ───────────────────────────────────────────────────────────

export const COA_ENGINES: EngineDef[] = [
  {
    id: 'cache', label: 'Cache mapping', group: 'Computer organisation',
    blurb: 'Direct, set-associative and fully associative caches: tag/index/offset split, hits, misses, AMAT.',
    params: [
      { name: 'mapping', label: 'Mapping', hint: 'direct | set | full', def: 'direct', options: ['direct', 'set', 'full'] },
      { name: 'lines', label: 'Lines', hint: 'total cache lines (power of 2)', def: '4' },
      { name: 'ways', label: 'Ways', hint: 'for set mapping', def: '2' },
      { name: 'block', label: 'Block bytes', hint: 'power of 2', def: '1' },
      { name: 'policy', label: 'Replacement', hint: 'lru | fifo', def: 'lru', options: ['lru', 'fifo'] },
      { name: 'addrs', label: 'Addresses', hint: 'byte addresses, space separated', def: '0 8 0 6 8', long: true },
      { name: 'hitTime', label: 'Hit time', hint: 'cycles', def: '1' },
      { name: 'missPenalty', label: 'Miss penalty', hint: 'cycles', def: '100' },
    ],
    run: cacheRun,
  },
  {
    id: 'numconv', label: 'Number systems & codes', group: 'Digital logic',
    blurb: 'Binary, octal, hex, BCD, excess-3, Gray and the signed representations of one number.',
    params: [
      { name: 'n', label: 'Number', hint: 'decimal, 19H, 0x19 or 0b101 (negative allowed)', def: '25' },
      { name: 'bits', label: 'Word bits', hint: '2–16, for the signed forms', def: '8' },
    ],
    run: numconvRun,
  },
  {
    id: 'ieee754', label: 'IEEE 754 floating point', group: 'Computer organisation',
    blurb: 'Pack a decimal number into sign, biased exponent and fraction.',
    params: [
      { name: 'value', label: 'Value', hint: 'a decimal number', def: '5.75' },
      { name: 'format', label: 'Format', hint: 'single | double', def: 'single', options: ['single', 'double'] },
    ],
    run: ieeeRun,
  },
  {
    id: 'booth', label: "Booth's multiplication", group: 'Computer organisation',
    blurb: 'Signed multiplication by add/subtract and arithmetic shift.',
    params: [
      { name: 'bits', label: 'Bits', hint: 'word size', def: '4' },
      { name: 'm', label: 'Multiplicand', hint: 'signed integer', def: '7' },
      { name: 'q', label: 'Multiplier', hint: 'signed integer', def: '-3' },
    ],
    run: boothRun,
  },
  {
    id: 'pipeline', label: 'Instruction pipeline', group: 'Computer organisation',
    blurb: '5-stage pipeline: data hazards, stalls and forwarding.',
    params: [
      { name: 'prog', label: 'Program', hint: 'one instruction per line: lw r1,0(r2) / add r3,r1,r4 / sw r5,4(r2)', def: 'lw r1, 0(r2)\nadd r3, r1, r4\nsub r5, r3, r6\nsw r5, 4(r2)', long: true },
      { name: 'forwarding', label: 'Forwarding', hint: 'on | off', def: 'on', options: ['on', 'off'] },
    ],
    run: pipelineRun,
  },
  {
    id: 'kmap', label: 'Karnaugh map', group: 'Digital logic',
    blurb: 'Quine–McCluskey minimisation drawn as K-map groups.',
    params: [
      { name: 'vars', label: 'Variables', hint: '2, 3 or 4', def: '4', options: ['2', '3', '4'] },
      { name: 'minterms', label: 'Minterms', hint: 'where F = 1', def: '0 1 2 5 6 7 8 9 10 14' },
      { name: 'dontcares', label: "Don't cares", hint: 'optional', def: '', optional: true },
    ],
    run: kmapRun,
  },
]

void dot; void arrow; void line
