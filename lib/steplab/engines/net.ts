// Data communication and computer networks (ENCT 253, ENCT 304): error
// detection and correction, sliding-window protocols, addressing, line coding,
// modulation, sampling, Fourier series, routing and TCP congestion control.

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, fmt, pnum, pnums, pstr, plist } from '../types'
import { arrow, bits, box, dot, heading, line, poly, toneAt, trace, txt } from '../draw'

const bitsOnly = (s: string, what: string) => {
  const t = s.replace(/\s+/g, '')
  if (!/^[01]+$/.test(t)) throw new LabError(`${what} must be 0s and 1s, got "${s}"`)
  return t
}

// ── CRC ─────────────────────────────────────────────────────────────────────

export function crcDivide(data: string, gen: string): { rem: string; steps: string[]; work: string } {
  const r = gen.length - 1
  const work = (data + '0'.repeat(r)).split('')
  const steps: string[] = []
  for (let i = 0; i <= work.length - gen.length; i++) {
    if (work[i] === '1') {
      for (let j = 0; j < gen.length; j++) work[i + j] = work[i + j] === gen[j] ? '0' : '1'
      steps.push(' '.repeat(i) + gen)
    }
  }
  return { rem: work.slice(work.length - r).join(''), steps, work: work.join('') }
}

function crcRun(p: Params) {
  const data = bitsOnly(pstr(p, 'data', '1101011011'), 'data')
  const gen = bitsOnly(pstr(p, 'generator', '10011'), 'generator')
  if (gen.length < 2 || gen[0] !== '1') throw new LabError('the generator must start with 1 and have at least 2 bits')
  const flip = pnum(p, 'flip', 0) // 1-based bit to corrupt in transit; 0 = none
  const r = gen.length - 1
  const { rem } = crcDivide(data, gen)
  const sent = data + rem
  const recv = sent.split('').map((b, i) => (i === flip - 1 ? (b === '1' ? '0' : '1') : b)).join('')
  const recvRem = (() => {
    const w = recv.split('')
    for (let i = 0; i <= w.length - gen.length; i++) if (w[i] === '1') for (let j = 0; j < gen.length; j++) w[i + j] = w[i + j] === gen[j] ? '0' : '1'
    return w.slice(w.length - r).join('')
  })()
  const padded = data + '0'.repeat(r)
  const cw = Math.min(20, Math.floor(540 / (padded.length + 1)))
  // Every XOR step: where the generator sits and what the working row becomes.
  const steps: { at: number; after: string }[] = []
  {
    const w = padded.split('')
    for (let i = 0; i <= w.length - gen.length; i++) if (w[i] === '1') {
      for (let j = 0; j < gen.length; j++) w[i + j] = w[i + j] === gen[j] ? '0' : '1'
      steps.push({ at: i, after: w.join('') })
    }
  }
  const rowH = cw + 8, x0 = 30
  const W = x0 + padded.length * cw + 40, H = 90 + (steps.length * 2 + 2) * rowH + 60
  const base: Prim[] = [heading(20, 14, `CRC · generator ${gen} (degree ${r})`)]
  const dataTones: (Tone | undefined)[] = [...Array(data.length).fill('blue'), ...Array(r).fill('amber')]
  const frames: Frame[] = [{ draw: [...base, ...bits(padded, x0, 30, cw, dataTones)], note: `Append ${r} zeros (one fewer than the generator's length), then divide by ${gen} using XOR — no carries, no borrows.` }]
  steps.forEach((st, k) => {
    const d: Prim[] = [...base, ...bits(padded, x0, 30, cw, dataTones)]
    for (let q = 0; q <= k; q++) {
      const y = 30 + (2 * q + 1) * rowH
      d.push(...bits(gen, x0 + steps[q].at * cw, y, cw, Array(gen.length).fill('violet')))
      d.push(line(x0, y + cw + 5, x0 + padded.length * cw, y + cw + 5, 'dim', { w: 0.7 }))
      d.push(...bits(steps[q].after, x0, y + rowH, cw, steps[q].after.split('').map((_, i) => (i >= steps[q].at && i < steps[q].at + gen.length ? 'mint' : undefined))))
    }
    frames.push({ draw: d, note: `Step ${k + 1}: the leading 1 is at bit ${st.at + 1}, so XOR the generator under it.` })
  })
  const y2 = 30 + (steps.length * 2 + 2) * rowH
  frames.push({
    draw: [...base, txt(x0, 40, 'codeword sent = data + CRC', { size: 11, tone: 'dim' }), ...bits(sent, x0, 50, cw, [...Array(data.length).fill('blue'), ...Array(r).fill('mint')]), txt(x0, 50 + cw + 34, `remainder (the CRC) = ${rem}`, { size: 14, mono: true, bold: true, tone: 'mint' })],
    note: `The remainder ${rem} replaces the appended zeros: the codeword ${sent} is now exactly divisible by ${gen}.`,
  })
  void y2
  frames.push({
    draw: [...base, txt(x0, 40, flip ? `received (bit ${flip} flipped)` : 'received (no error)', { size: 11, tone: 'dim' }), ...bits(recv, x0, 50, cw, recv.split('').map((_, i) => (i === flip - 1 ? 'rose' : undefined))),
      txt(x0, 50 + cw + 34, `remainder at the receiver = ${recvRem}`, { size: 14, mono: true, bold: true, tone: /^0+$/.test(recvRem) ? 'mint' : 'rose' }),
      txt(x0, 50 + cw + 58, /^0+$/.test(recvRem) ? 'zero → accepted' : 'non-zero → error detected, frame discarded', { size: 12, tone: /^0+$/.test(recvRem) ? 'mint' : 'rose' })],
    note: /^0+$/.test(recvRem) ? 'The receiver divides the whole word by G: remainder 0 means no detectable error.' : 'A non-zero remainder proves the word was corrupted.',
  })
  return trace(W, Math.max(H, 170), frames, { crc: rem, codeword: sent, receiverRemainder: recvRem, detected: /^0+$/.test(recvRem) ? 'no' : 'yes' })
}

// ── Hamming code ────────────────────────────────────────────────────────────

function hammingRun(p: Params) {
  const data = bitsOnly(pstr(p, 'data', '1011'), 'data')
  const k = data.length
  let r = 0
  while ((1 << r) < k + r + 1) r++
  const n = k + r
  const word: number[] = Array(n + 1).fill(0) // 1-indexed
  let di = 0
  for (let i = 1; i <= n; i++) if ((i & (i - 1)) !== 0) word[i] = Number(data[di++])
  const covered = (pos: number) => Array.from({ length: n }, (_, i) => i + 1).filter((i) => i & pos)
  for (let pb = 1; pb <= n; pb <<= 1) word[pb] = covered(pb).filter((i) => i !== pb).reduce((a, i) => a ^ word[i], 0)
  const enc = word.slice(1).join('')
  const errPos = pnum(p, 'error', 0)
  if (errPos < 0 || errPos > n) throw new LabError(`error position must be 0 (none) or 1…${n}`)
  const recv = [...word]
  if (errPos) recv[errPos] ^= 1
  let syndrome = 0
  const checks: number[] = []
  for (let pb = 1; pb <= n; pb <<= 1) { const c = covered(pb).reduce((a, i) => a ^ recv[i], 0); checks.push(c); if (c) syndrome |= pb }
  const cw = Math.min(40, Math.floor(540 / n))
  const W = 30 + n * cw + 20, H = 230
  const label = (i: number) => ((i & (i - 1)) === 0 ? `p${Math.log2(i) + 1}` : `d${i - Math.floor(Math.log2(i)) - 1}`)
  const draw = (vals: (number | null)[], tones: (Tone | undefined)[], extra: Prim[] = []): Prim[] => [
    heading(20, 14, `Hamming(${n},${k}) · even parity`),
    ...Array.from({ length: n }, (_, i) => box(30 + i * cw, 44, cw - 3, 34, vals[i + 1] === null ? '' : String(vals[i + 1]), tones[i + 1] ?? 'idle', undefined)),
    ...Array.from({ length: n }, (_, i) => txt(30 + i * cw + (cw - 3) / 2, 96, label(i + 1), { size: 10.5, anchor: 'middle', mono: true, tone: (i + 1 & i) === 0 ? 'amber' : 'dim' })),
    ...Array.from({ length: n }, (_, i) => txt(30 + i * cw + (cw - 3) / 2, 34, String(i + 1), { size: 9.5, anchor: 'middle', mono: true, tone: 'dim' })),
    ...extra,
  ]
  const frames: Frame[] = []
  const partial: (number | null)[] = Array(n + 1).fill(null)
  for (let i = 1; i <= n; i++) if ((i & (i - 1)) !== 0) partial[i] = word[i]
  const tonesData: (Tone | undefined)[] = Array(n + 1).fill(undefined).map((_, i) => ((i & (i - 1)) !== 0 && i > 0 ? 'blue' : undefined))
  frames.push({ draw: draw(partial, tonesData), note: `Data bits go in the positions that are NOT powers of two; positions 1, 2, 4, 8… are reserved for ${r} parity bits.` })
  for (let pb = 1; pb <= n; pb <<= 1) {
    partial[pb] = word[pb]
    const cov = covered(pb)
    const tones = [...tonesData]
    for (const i of cov) tones[i] = i === pb ? 'amber' : 'violet'
    frames.push({ draw: draw(partial, tones, [txt(30, 130, `p${Math.log2(pb) + 1} covers positions ${cov.join(', ')}`, { size: 12, mono: true, tone: 'violet' }), txt(30, 152, `even parity → p${Math.log2(pb) + 1} = ${word[pb]}`, { size: 12, mono: true, tone: 'amber' })]), note: `Parity bit ${pb} checks every position whose binary index has bit ${Math.log2(pb)} set.` })
  }
  frames.push({ draw: draw(word.map((v, i) => (i ? v : null)), Array(n + 1).fill('mint'), [txt(30, 130, `codeword = ${enc}`, { size: 14, mono: true, bold: true, tone: 'mint' })]), note: 'The encoded word: every parity group now has an even number of 1s.' })
  if (errPos) {
    const tones: (Tone | undefined)[] = Array(n + 1).fill(undefined); tones[errPos] = 'rose'
    frames.push({ draw: draw(recv.map((v, i) => (i ? v : null)), tones, [txt(30, 130, `bit ${errPos} flipped in transit`, { size: 12, tone: 'rose' })]), note: `A single bit error at position ${errPos}.` })
    const sd = [...checks].reverse().join('')
    frames.push({ draw: draw(recv.map((v, i) => (i ? v : null)), tones, [txt(30, 130, `parity checks (p${r}…p1) = ${sd} = ${syndrome}`, { size: 13, mono: true, bold: true, tone: 'amber' }), txt(30, 154, `syndrome ${syndrome} → position ${syndrome} is wrong`, { size: 12, mono: true, tone: 'rose' })]), note: 'The failing parity checks, read as a binary number, spell the position of the flipped bit.' })
    const fixed = [...recv]; if (syndrome) fixed[syndrome] ^= 1
    frames.push({ draw: draw(fixed.map((v, i) => (i ? v : null)), fixed.map((_, i) => (i === syndrome ? 'mint' : undefined)), [txt(30, 130, `corrected = ${fixed.slice(1).join('')}`, { size: 14, mono: true, bold: true, tone: 'mint' })]), note: 'Flip the indicated bit back — single-error correction.' })
  }
  return trace(W, H, frames, { codeword: enc, parityBits: String(r), syndrome: String(syndrome), corrected: String(syndrome === errPos && errPos > 0 ? 'yes' : errPos ? 'no' : 'n/a') })
}

// ── Sliding window ARQ ──────────────────────────────────────────────────────

interface Ev { t: number; kind: 'data' | 'ack'; seq: number; lost: boolean; retx: boolean; arrive: number }

export function arqSim(protocol: string, n: number, w: number, prop: number, loseData: number[], loseAck: number[]) {
  const timeout = 2 * prop + 2
  const events: Ev[] = []
  const acked = Array(n).fill(false)
  const sentAt: (number | null)[] = Array(n).fill(null)
  const lostOnce = new Set(loseData), ackLostOnce = new Set(loseAck)
  const received = Array(n).fill(false)
  let base = 0, next = 0, expected = 0
  const pendingAcks: { at: number; seq: number }[] = []
  const inFlight: { at: number; seq: number }[] = []
  let retx = 0, t = 0
  const gbn = protocol !== 'sr'
  const win = protocol === 'stopwait' ? 1 : w
  const send = (seq: number, isRetx: boolean) => {
    const lost = !isRetx && lostOnce.has(seq) ? true : false
    events.push({ t, kind: 'data', seq, lost, retx: isRetx, arrive: t + prop })
    sentAt[seq] = t
    if (!lost) inFlight.push({ at: t + prop, seq })
    if (isRetx) retx++
  }
  let guard = 0
  while (base < n && guard++ < 2000) {
    // deliveries
    for (const f of inFlight.filter((f) => f.at === t)) {
      let ackSeq: number | null = null
      if (gbn) {
        if (f.seq === expected) { received[f.seq] = true; expected++ }
        ackSeq = expected - 1
        if (ackSeq < 0) ackSeq = null
      } else { received[f.seq] = true; ackSeq = f.seq }
      if (ackSeq !== null) {
        const lost = ackLostOnce.has(ackSeq) && !events.some((e) => e.kind === 'ack' && e.seq === ackSeq && e.lost)
        events.push({ t, kind: 'ack', seq: ackSeq, lost, retx: false, arrive: t + prop })
        if (!lost) pendingAcks.push({ at: t + prop, seq: ackSeq })
      }
    }
    for (const a of pendingAcks.filter((a) => a.at === t)) {
      if (gbn) { for (let s = base; s <= a.seq; s++) acked[s] = true; base = Math.max(base, a.seq + 1) }
      else { acked[a.seq] = true; while (base < n && acked[base]) base++ }
    }
    if (base >= n) break
    // timeouts
    if (gbn) {
      if (sentAt[base] !== null && !acked[base] && t - (sentAt[base] as number) >= timeout) { for (let s = base; s < next; s++) send(s, true); }
    } else {
      for (let s = base; s < next; s++) if (!acked[s] && sentAt[s] !== null && t - (sentAt[s] as number) >= timeout) send(s, true)
    }
    // new transmissions
    if (next < n && next < base + win) { send(next, false); next++ }
    t++
  }
  return { events, total: t, retx, timeout }
}

function arqRun(p: Params) {
  const protocol = pstr(p, 'protocol', 'gbn')
  const n = pnum(p, 'frames', 8), w = pnum(p, 'window', 4), prop = pnum(p, 'prop', 2)
  const loseData = pnums(p, 'lose', []), loseAck = pnums(p, 'loseAck', [])
  if (!['stopwait', 'gbn', 'sr'].includes(protocol)) throw new LabError('protocol is stopwait, gbn or sr')
  const { events, total, retx, timeout } = arqSim(protocol, n, w, prop, loseData, loseAck)
  const W = 560, H = 60 + (total + 1) * 18 + 30
  const xs = 110, xr = 450
  const frames: Frame[] = []
  for (let k = 0; k <= total; k++) {
    const d: Prim[] = [heading(20, 14, `${protocol === 'stopwait' ? 'Stop-and-wait' : protocol === 'gbn' ? 'Go-Back-N' : 'Selective Repeat'} · window ${protocol === 'stopwait' ? 1 : w} · timeout ${timeout}`)]
    d.push(txt(xs, 36, 'SENDER', { size: 10, anchor: 'middle', bold: true, tone: 'dim' }), txt(xr, 36, 'RECEIVER', { size: 10, anchor: 'middle', bold: true, tone: 'dim' }))
    d.push(line(xs, 44, xs, H - 20, 'dim'), line(xr, 44, xr, H - 20, 'dim'))
    for (const e of events.filter((e) => e.t <= k)) {
      const y1 = 50 + e.t * 18, y2 = 50 + Math.min(e.arrive, k) * 18
      const partial = e.arrive > k
      const [x1, x2] = e.kind === 'data' ? [xs, xr] : [xr, xs]
      const frac = partial ? (k - e.t) / (e.arrive - e.t) : 1
      const tone: Tone = e.kind === 'data' ? (e.retx ? 'amber' : 'blue') : 'mint'
      if (e.lost) {
        d.push(arrow(x1, y1, x1 + (x2 - x1) * 0.55, y1 + (e.arrive - e.t) * 18 * 0.55, 'rose', { dash: true }))
        d.push(txt(x1 + (x2 - x1) * 0.55, y1 + (e.arrive - e.t) * 18 * 0.55 + 4, '✕', { size: 13, tone: 'rose', anchor: 'middle', bold: true }))
      } else d.push(arrow(x1, y1, x1 + (x2 - x1) * frac, y1 + (y2 - y1 + (partial ? 0 : 0)) * (partial ? 1 : 1) * 1, tone))
      d.push(txt(e.kind === 'data' ? x1 - 8 : x1 + 8, y1 + 4, e.kind === 'data' ? `F${e.seq}${e.retx ? '′' : ''}` : `A${e.seq}`, { size: 10, mono: true, anchor: e.kind === 'data' ? 'end' : 'start', tone }))
    }
    frames.push({ draw: d, note: k === 0 ? 'Time runs downward. Blue = new frame, amber = retransmission, green = acknowledgement, ✕ = lost.' : `t = ${k}: ${events.filter((e) => e.t === k).map((e) => (e.kind === 'data' ? `send F${e.seq}${e.retx ? ' (retransmit)' : ''}${e.lost ? ' — lost' : ''}` : `receiver acks ${e.seq}${e.lost ? ' — ack lost' : ''}`)).join('; ') || 'waiting…'}` })
  }
  return trace(W, H, frames, { totalTime: String(total), transmissions: String(events.filter((e) => e.kind === 'data').length), retransmissions: String(retx) })
}

// ── IPv4 addressing ─────────────────────────────────────────────────────────

const ip2n = (s: string): number => {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s.trim())
  if (!m || [1, 2, 3, 4].some((i) => Number(m[i]) > 255)) throw new LabError(`"${s}" is not an IPv4 address`)
  return ((Number(m[1]) << 24) | (Number(m[2]) << 16) | (Number(m[3]) << 8) | Number(m[4])) >>> 0
}
const n2ip = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
const maskOf = (p: number) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0)

function subnetRun(p: Params) {
  const [ipS, pre] = pstr(p, 'address', '192.168.10.77/26').split('/')
  const prefix = Number(pre)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new LabError('write the address as a.b.c.d/prefix, e.g. 192.168.10.77/26')
  const ip = ip2n(ipS), mask = maskOf(prefix)
  const net = (ip & mask) >>> 0, bc = (net | ~mask) >>> 0
  const hosts = prefix >= 31 ? (prefix === 31 ? 2 : 1) : Math.pow(2, 32 - prefix) - 2
  const cls = ip >>> 31 === 0 ? 'A' : ip >>> 30 === 2 ? 'B' : ip >>> 29 === 6 ? 'C' : ip >>> 28 === 14 ? 'D' : 'E'
  const bin = (n: number) => n.toString(2).padStart(32, '0')
  const oct = (b: string) => [b.slice(0, 8), b.slice(8, 16), b.slice(16, 24), b.slice(24)]
  const cw = 13.5
  const row = (label: string, v: number, y: number, tone: Tone, split = prefix): Prim[] => {
    const b = bin(v), out: Prim[] = [txt(20, y + 15, label, { size: 10.5, tone: 'dim' })]
    for (let i = 0; i < 32; i++) out.push(box(120 + i * cw + Math.floor(i / 8) * 8, y, cw - 1, 22, b[i], i < split ? tone : 'idle'))
    return out
  }
  const vlsm = plist(p, 'hosts', [], /[\s,;]+/).map(Number)
  const W = 620, H = vlsm.length ? 240 + vlsm.length * 24 : 240
  const frames: Frame[] = []
  const head = (extra: Prim[]) => [heading(20, 14, `${n2ip(ip)}/${prefix} · class ${cls}`), ...extra]
  frames.push({ draw: head([...row('address', ip, 34, 'blue'), ...row('mask', mask, 66, 'violet')]), note: `A /${prefix} mask has ${prefix} ones then ${32 - prefix} zeros: the first ${prefix} bits name the network, the last ${32 - prefix} name the host.` })
  frames.push({ draw: head([...row('address', ip, 34, 'blue'), ...row('mask', mask, 66, 'violet'), ...row('network', net, 102, 'mint'), txt(20, 144, `network address = address AND mask = ${n2ip(net)}`, { size: 12, mono: true, tone: 'mint' })]), note: 'Bitwise AND of the address with the mask clears the host bits: that is the network address.' })
  frames.push({ draw: head([...row('network', net, 34, 'mint'), ...row('broadcast', bc, 66, 'amber'), txt(20, 112, `broadcast = network OR NOT(mask) = ${n2ip(bc)}`, { size: 12, mono: true, tone: 'amber' }), txt(20, 136, `first host ${n2ip((net + 1) >>> 0)}   last host ${n2ip((bc - 1) >>> 0)}`, { size: 12, mono: true }), txt(20, 160, `usable hosts = 2^${32 - prefix} − 2 = ${hosts}`, { size: 12, mono: true, bold: true, tone: 'blue' })]), note: 'Setting every host bit to 1 gives the broadcast address; the first and last addresses of the block are reserved.' })
  const allocs: { need: number; prefix: number; net: number }[] = []
  if (vlsm.length) {
    let cursor = net
    for (const need of [...vlsm].sort((a, b) => b - a)) {
      let host = 2; while (Math.pow(2, host) - 2 < need) host++
      const pr = 32 - host
      if (cursor + Math.pow(2, host) - 1 > bc) throw new LabError(`the hosts ${vlsm.join(', ')} do not fit in ${n2ip(net)}/${prefix}`)
      allocs.push({ need, prefix: pr, net: cursor })
      cursor += Math.pow(2, host)
    }
    const d = head([heading(20, 34, 'VLSM — largest subnet first')])
    allocs.forEach((a, i) => d.push(txt(20, 62 + i * 24, `${a.need} hosts → ${n2ip(a.net)}/${a.prefix}  (${Math.pow(2, 32 - a.prefix) - 2} usable)`, { size: 12.5, mono: true, tone: toneAt(i) })))
    frames.push({ draw: d, note: 'Variable-length subnet masks: give each network the smallest block that holds its hosts, largest first so blocks stay aligned.' })
  }
  return trace(W, H, frames, { network: n2ip(net), broadcast: n2ip(bc), mask: n2ip(mask), hosts: String(hosts), first: n2ip((net + 1) >>> 0), last: n2ip((bc - 1) >>> 0), class: cls, ...(allocs.length ? { vlsm: allocs.map((a) => `${n2ip(a.net)}/${a.prefix}`).join(' ') } : {}) })
}

// ── Line coding ─────────────────────────────────────────────────────────────

/** Levels per half-bit (2 per bit) so Manchester fits the same shape. */
export function lineCode(code: string, data: string, oneHigh = true): number[] {
  const out: number[] = []
  const b = data.split('').map(Number)
  const hi = oneHigh ? 1 : -1
  let last = -1
  let lastPulse = -1 // AMI polarity of the previous pulse (−1 = negative so first 1 is +)
  if (code === 'nrzl') for (const x of b) out.push(x ? hi : -hi, x ? hi : -hi)
  else if (code === 'nrzi') { let lvl = -1; for (const x of b) { if (x) lvl = -lvl; out.push(lvl, lvl) } }
  else if (code === 'rz') for (const x of b) out.push(x ? 1 : -1, 0)
  else if (code === 'manchester') for (const x of b) out.push(...(x ? [-1, 1] : [1, -1]))
  else if (code === 'diffmanchester') { let lvl = -1; for (const x of b) { if (!x) lvl = -lvl; out.push(lvl, -lvl); lvl = -lvl } }
  else if (code === 'ami') for (const x of b) { if (x) { lastPulse = -lastPulse; out.push(lastPulse, lastPulse) } else out.push(0, 0) }
  else if (code === 'b8zs') {
    const lv: number[] = []
    let i = 0, pol = -1
    while (i < b.length) {
      if (b.slice(i, i + 8).length === 8 && b.slice(i, i + 8).every((x) => !x)) {
        const p = pol
        lv.push(0, 0, 0, p, -p, 0, -p, p) // 000VB0VB: V has the polarity of the previous pulse
        pol = p
        i += 8
      } else { if (b[i]) { pol = -pol; lv.push(pol) } else lv.push(0); i++ }
    }
    for (const v of lv) out.push(v, v)
  } else if (code === 'hdb3') {
    const lv: number[] = []
    let i = 0, pol = -1, pulsesSinceSub = 0
    while (i < b.length) {
      if (b.slice(i, i + 4).length === 4 && b.slice(i, i + 4).every((x) => !x)) {
        if (pulsesSinceSub % 2 === 0) { const B = -pol; lv.push(B, 0, 0, B); pol = B }  // B00V: B alternates, V repeats B
        else lv.push(0, 0, 0, pol)                                                    // 000V: V repeats the last pulse
        pulsesSinceSub = 0
        i += 4
      } else { if (b[i]) { pol = -pol; lv.push(pol); pulsesSinceSub++ } else lv.push(0); i++ }
    }
    for (const v of lv) out.push(v, v)
  } else throw new LabError(`unknown code "${code}" — use nrzl, nrzi, rz, manchester, diffmanchester, ami, b8zs or hdb3`)
  void last
  return out
}

const CODE_NAMES: Record<string, string> = { nrzl: 'NRZ-L', nrzi: 'NRZ-I', rz: 'RZ', manchester: 'Manchester', diffmanchester: 'Differential Manchester', ami: 'Bipolar AMI', b8zs: 'B8ZS', hdb3: 'HDB3' }

function linecodeRun(p: Params) {
  const data = bitsOnly(pstr(p, 'bits', '01001100011'), 'bits')
  const codes = plist(p, 'codes', ['nrzl', 'manchester', 'ami'], /[\s,;]+/)
  const oneHigh = pstr(p, 'oneHigh', '1') !== '0'
  const bw = Math.min(40, Math.floor(480 / data.length))
  const rowH = 74
  const W = 70 + data.length * bw + 30, H = 40 + codes.length * rowH + 20
  const waves = codes.map((c) => lineCode(c, data, oneHigh))
  const frames: Frame[] = []
  for (let k = 0; k <= data.length; k++) {
    const d: Prim[] = [heading(20, 14, 'Line coding')]
    data.split('').forEach((b, i) => d.push(txt(70 + i * bw + bw / 2, 34, b, { size: 12, mono: true, anchor: 'middle', tone: i < k ? 'blue' : 'dim', bold: i === k - 1 })))
    codes.forEach((c, ci) => {
      const y0 = 60 + ci * rowH, mid = y0 + 30, amp = 20
      d.push(txt(20, mid + 4, CODE_NAMES[c] ?? c, { size: 10.5, tone: 'dim' }))
      d.push(line(70, mid, 70 + data.length * bw, mid, 'dim', { dash: true, w: 0.8 }))
      const w = waves[ci]
      const pts: number[][] = []
      const half = bw / 2
      for (let h = 0; h < Math.min(w.length, k * 2); h++) {
        const y = mid - w[h] * amp
        pts.push([70 + h * half, y], [70 + (h + 1) * half, y])
      }
      if (pts.length) d.push(poly(pts, toneAt(ci), { w: 2 }))
      for (let i = 1; i < k; i++) d.push(line(70 + i * bw, y0 + 4, 70 + i * bw, y0 + 56, 'dim', { dash: true, w: 0.5 }))
    })
    frames.push({ draw: d, note: k === 0 ? `Each code turns the bits into voltage levels. Convention: NRZ-L 1 = ${oneHigh ? 'high' : 'low'}; Manchester 1 = low→high mid-bit; AMI 1s alternate + and −.` : `Bit ${k} = ${data[k - 1]}: ${codes.map((c) => `${CODE_NAMES[c]} ${waves[codes.indexOf(c)].slice((k - 1) * 2, k * 2).map((v) => (v > 0 ? '+' : v < 0 ? '−' : '0')).join('')}`).join(' · ')}` })
  }
  const summary: Record<string, string> = {}
  codes.forEach((c, i) => { summary[c] = waves[i].filter((_, j) => j % 2 === 0).map((v) => (v > 0 ? '+' : v < 0 ? '-' : '0')).join('') })
  return trace(W, H, frames, summary)
}

// ── Modulation ──────────────────────────────────────────────────────────────

function modulationRun(p: Params) {
  const scheme = pstr(p, 'scheme', 'fsk')
  const data = bitsOnly(pstr(p, 'bits', '1011001'), 'bits')
  const cyc = pnum(p, 'cycles', 3) // carrier cycles per bit
  const bw = 64, H = 200, W = 40 + data.length * bw + 30
  const mid = 120, amp = 44
  const wave = (bitsUpTo: number): number[][] => {
    const pts: number[][] = []
    const N = 24
    for (let i = 0; i < bitsUpTo; i++) {
      const b = Number(data[i])
      for (let s = 0; s <= N; s++) {
        const u = s / N
        const ph = 2 * Math.PI * cyc * u
        let y: number
        if (scheme === 'ask') y = b ? Math.sin(ph) : 0.15 * Math.sin(ph)
        else if (scheme === 'fsk') y = Math.sin(b ? ph * 1.9 : ph * 0.95)
        else if (scheme === 'psk') y = b ? Math.sin(ph) : -Math.sin(ph)
        else if (scheme === 'am') y = (0.5 + 0.5 * (b ? 1 : 0.35)) * Math.sin(ph)
        else if (scheme === 'fm') y = Math.sin(ph * (b ? 1.9 : 0.95))
        else throw new LabError('scheme is ask, fsk, psk, am or fm')
        pts.push([20 + i * bw + u * bw, mid - y * amp])
      }
    }
    return pts
  }
  wave(1)
  const frames: Frame[] = []
  const meaning: Record<string, string> = {
    ask: 'Amplitude-shift keying: the carrier amplitude carries the bit (bit 0 ≈ off).', fsk: 'Frequency-shift keying: bit 1 uses a higher carrier frequency than bit 0.',
    psk: 'Phase-shift keying: the carrier is inverted (180°) for bit 0.', am: 'Amplitude modulation: the message scales the carrier amplitude (envelope follows the message).', fm: 'Frequency modulation: the message shifts the carrier frequency; amplitude stays constant.',
  }
  for (let k = 0; k <= data.length; k++) {
    const d: Prim[] = [heading(20, 14, `${scheme.toUpperCase()} · ${cyc} carrier cycles per bit`)]
    data.split('').forEach((b, i) => {
      d.push(box(20 + i * bw + 2, 26, bw - 4, 22, b, i < k ? 'blue' : 'idle'))
      d.push(line(20 + i * bw, 60, 20 + i * bw, H - 20, 'dim', { dash: true, w: 0.5 }))
    })
    d.push(line(20, mid, 20 + data.length * bw, mid, 'dim', { dash: true, w: 0.8 }))
    if (k > 0) d.push(poly(wave(k), 'mint', { w: 1.8 }))
    frames.push({ draw: d, note: k === 0 ? meaning[scheme] : `Bit ${k} = ${data[k - 1]}.` })
  }
  return trace(W, H, frames, { scheme })
}

// ── PCM ─────────────────────────────────────────────────────────────────────

function pcmRun(p: Params) {
  const fm = pnum(p, 'fm', 1), fs = pnum(p, 'fs', 8), nb = pnum(p, 'bits', 3), vmax = pnum(p, 'amp', 1)
  if (nb < 1 || nb > 8) throw new LabError('bits must be 1–8')
  const levels = 1 << nb, step = (2 * vmax) / levels
  const W = 600, H = 300, x0 = 40, sw = 520, mid = 130, amp = 90
  const cycles = 2, T = cycles / fm
  const nSamp = Math.floor(T * fs)
  const sigAt = (t: number) => vmax * Math.sin(2 * Math.PI * fm * t)
  const q = (v: number) => Math.min(levels - 1, Math.max(0, Math.floor((v + vmax) / step)))
  const xOf = (t: number) => x0 + (t / T) * sw
  const yOf = (v: number) => mid - (v / vmax) * amp
  const codes: string[] = []
  const frames: Frame[] = []
  const curve: number[][] = []
  for (let i = 0; i <= 200; i++) { const t = (i / 200) * T; curve.push([xOf(t), yOf(sigAt(t))]) }
  const base = (): Prim[] => {
    const d: Prim[] = [heading(20, 14, `PCM · fs = ${fs} Hz · ${nb} bits · ${levels} levels`), poly(curve, 'dim', { w: 1.5 })]
    for (let l = 0; l <= levels; l++) d.push(line(x0, yOf(-vmax + l * step), x0 + sw, yOf(-vmax + l * step), 'dim', { w: 0.4, dash: true }))
    return d
  }
  frames.push({ draw: base(), note: `Sampling ${fm} Hz signal at ${fs} Hz: ${fs >= 2 * fm ? 'Nyquist satisfied (fs ≥ 2·fmax)' : 'fs < 2·fmax → aliasing!'} Quantise each sample to one of ${levels} levels, then encode as ${nb} bits.` })
  for (let i = 0; i < nSamp; i++) {
    const t = i / fs, v = sigAt(t), lv = q(v), vq = -vmax + (lv + 0.5) * step
    codes.push(lv.toString(2).padStart(nb, '0'))
    const d = base()
    for (let j = 0; j <= i; j++) {
      const tj = j / fs, vj = sigAt(tj), qj = -vmax + (q(vj) + 0.5) * step
      d.push(line(xOf(tj), yOf(0), xOf(tj), yOf(vj), 'blue', { w: 1.2 }), dot(xOf(tj), yOf(vj), 3, undefined, 'blue', { solid: true }), dot(xOf(tj), yOf(qj), 3, undefined, 'mint', { solid: true }))
    }
    d.push(txt(20, H - 40, `bits: ${codes.join(' ')}`, { size: 12, mono: true, tone: 'mint' }))
    frames.push({ draw: d, note: `Sample ${i + 1} at t = ${fmt(t, 3)} s: ${fmt(v, 3)} V → level ${lv} → ${codes[i]} (quantisation error ${fmt(Math.abs(vq - v), 3)} V).` })
  }
  return trace(W, H, frames, { bitRate: String(fs * nb), snrDb: fmt(6.02 * nb + 1.76, 2), nyquistOk: fs >= 2 * fm ? 'yes' : 'no', codes: codes.join(' ') })
}

// ── Fourier series ──────────────────────────────────────────────────────────

function fourierRun(p: Params) {
  const shape = pstr(p, 'shape', 'square')
  const N = pnum(p, 'harmonics', 9)
  if (N < 1 || N > 99) throw new LabError('harmonics must be 1–99')
  const term = (n: number, x: number): number => {
    if (shape === 'square') return n % 2 ? (4 / (Math.PI * n)) * Math.sin(n * x) : 0
    if (shape === 'sawtooth') return (2 / (Math.PI * n)) * (n % 2 ? 1 : -1) * Math.sin(n * x)
    if (shape === 'triangle') return n % 2 ? (8 / (Math.PI * Math.PI * n * n)) * (((n - 1) / 2) % 2 ? -1 : 1) * Math.sin(n * x) : 0
    throw new LabError('shape is square, sawtooth or triangle')
  }
  const target = (x: number) => {
    const u = ((x + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
    if (shape === 'square') return u > 0 ? 1 : u < 0 ? -1 : 0
    if (shape === 'sawtooth') return u / Math.PI
    return u >= 0 ? (u < Math.PI / 2 ? (2 * u) / Math.PI : (2 * (Math.PI - u)) / Math.PI) : -(Math.abs(u) < Math.PI / 2 ? (2 * Math.abs(u)) / Math.PI : (2 * (Math.PI - Math.abs(u))) / Math.PI)
  }
  const W = 600, H = 300, x0 = 30, sw = 540, mid = 140, amp = 85
  const xs = Array.from({ length: 261 }, (_, i) => -Math.PI + (i / 260) * 2 * Math.PI)
  const frames: Frame[] = []
  const stops = [1, 2, 3, 5, 9, 15, 25, 49, 99].filter((n) => n <= N)
  if (!stops.includes(N)) stops.push(N)
  let lastErr = 0
  for (const n of stops) {
    const pts = xs.map((x) => { let s = 0; for (let k = 1; k <= n; k++) s += term(k, x); return [x0 + ((x + Math.PI) / (2 * Math.PI)) * sw, mid - s * amp] })
    const tgt = xs.map((x) => [x0 + ((x + Math.PI) / (2 * Math.PI)) * sw, mid - target(x) * amp])
    lastErr = Math.sqrt(xs.reduce((a, x) => { let s = 0; for (let k = 1; k <= n; k++) s += term(k, x); return a + (s - target(x)) ** 2 }, 0) / xs.length)
    const d: Prim[] = [heading(20, 14, `Fourier series · ${shape} wave`), line(x0, mid, x0 + sw, mid, 'dim', { dash: true, w: 0.6 }), poly(tgt, 'dim', { w: 1.2, dash: true }), poly(pts, 'blue', { w: 2 }),
      txt(20, H - 20, `harmonics 1…${n}   rms error ${fmt(lastErr, 3)}`, { size: 12, mono: true, tone: 'amber' })]
    frames.push({ draw: d, note: `Sum of the first ${n} harmonic${n > 1 ? 's' : ''}${shape === 'square' && n >= 9 ? ' — note the overshoot at each jump that never disappears (Gibbs phenomenon)' : ''}.` })
  }
  return trace(W, H, frames, { rmsError: fmt(lastErr, 3) })
}

// ── Routing ─────────────────────────────────────────────────────────────────

function parseGraph(s: string): { nodes: string[]; edges: { a: string; b: string; w: number }[] } {
  const edges = s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((e) => {
    const m = /^(\w+)\s*-\s*(\w+)\s*:\s*(\d+(?:\.\d+)?)$/.exec(e)
    if (!m) throw new LabError(`edge "${e}" — write A-B:4`)
    return { a: m[1], b: m[2], w: Number(m[3]) }
  })
  const nodes = [...new Set(edges.flatMap((e) => [e.a, e.b]))]
  return { nodes, edges }
}
const circleLayout = (nodes: string[], cx: number, cy: number, r: number) => new Map(nodes.map((n, i) => [n, [cx + r * Math.cos((2 * Math.PI * i) / nodes.length - Math.PI / 2), cy + r * Math.sin((2 * Math.PI * i) / nodes.length - Math.PI / 2)]]))

function routingRun(p: Params) {
  const { nodes, edges } = parseGraph(pstr(p, 'graph', 'u-v:2;u-x:1;u-w:5;v-x:2;v-w:3;x-w:3;x-y:1;w-y:1;w-z:5;y-z:2'))
  const srcRaw = pstr(p, 'source', nodes[0])
  const algo = pstr(p, 'algo', 'dijkstra')
  // "u" is only the placeholder default for the textbook graph; a replaced graph starts at its first node.
  const src = nodes.includes(srcRaw) ? srcRaw : srcRaw === 'u' ? nodes[0] : (() => { throw new LabError(`source "${srcRaw}" is not in the graph (${nodes.join(', ')})`) })()
  const pos = circleLayout(nodes, 170, 150, 105)
  const W = 620, H = 320
  const frames: Frame[] = []
  if (algo === 'dijkstra') {
    const dist = new Map(nodes.map((n) => [n, Infinity])), prev = new Map<string, string | null>(nodes.map((n) => [n, null])), done = new Set<string>()
    dist.set(src, 0)
    const draw = (cur: string | null, relaxed: string[], treeEdges: Set<string>): Prim[] => {
      const d: Prim[] = [heading(20, 14, `Dijkstra · source ${src}`)]
      for (const e of edges) {
        const [x1, y1] = pos.get(e.a)!, [x2, y2] = pos.get(e.b)!
        const inTree = treeEdges.has(`${e.a}-${e.b}`) || treeEdges.has(`${e.b}-${e.a}`)
        d.push(line(x1, y1, x2, y2, inTree ? 'mint' : 'dim', { w: inTree ? 3 : 1.2 }))
        d.push(txt((x1 + x2) / 2, (y1 + y2) / 2 - 3, String(e.w), { size: 11, mono: true, anchor: 'middle', tone: 'amber' }))
      }
      for (const n of nodes) { const [x, y] = pos.get(n)!; d.push(dot(x, y, 17, n, n === cur ? 'blue' : done.has(n) ? 'mint' : relaxed.includes(n) ? 'amber' : 'idle')) }
      d.push(txt(340, 44, 'node   D(v)   via', { size: 10, bold: true, tone: 'dim', mono: true }))
      nodes.forEach((n, i) => d.push(txt(340, 66 + i * 22, `${n.padEnd(6)} ${(dist.get(n)! === Infinity ? '∞' : fmt(dist.get(n)!)).padEnd(6)} ${prev.get(n) ?? '—'}`, { size: 12, mono: true, tone: done.has(n) ? 'mint' : 'idle' })))
      return d
    }
    frames.push({ draw: draw(null, [], new Set()), note: `Start: D(${src}) = 0, everything else ∞. Repeatedly settle the nearest unsettled node, then relax its neighbours.` })
    const tree = new Set<string>()
    while (done.size < nodes.length) {
      const cur = nodes.filter((n) => !done.has(n)).sort((a, b) => dist.get(a)! - dist.get(b)!)[0]
      if (dist.get(cur) === Infinity) break
      done.add(cur)
      if (prev.get(cur)) tree.add(`${prev.get(cur)}-${cur}`)
      const relaxed: string[] = []
      for (const e of edges) {
        const other = e.a === cur ? e.b : e.b === cur ? e.a : null
        if (other && !done.has(other) && dist.get(cur)! + e.w < dist.get(other)!) { dist.set(other, dist.get(cur)! + e.w); prev.set(other, cur); relaxed.push(other) }
      }
      frames.push({ draw: draw(cur, relaxed, tree), note: `Settle ${cur} (D = ${fmt(dist.get(cur)!)}).${relaxed.length ? ` Shorter routes found to ${relaxed.join(', ')}.` : ' No neighbour improves.'}` })
    }
    const path = (t: string) => { const out = [t]; let c = t; while (prev.get(c)) { c = prev.get(c)!; out.unshift(c) } return out.join('→') }
    const s: Record<string, string> = {}
    nodes.forEach((n) => { s[`d_${n}`] = fmt(dist.get(n)!); s[`path_${n}`] = path(n) })
    return trace(W, H, frames, s)
  }
  if (algo === 'dv') {
    const idx = new Map(nodes.map((n, i) => [n, i]))
    const n = nodes.length
    let D: number[][] = nodes.map((a) => nodes.map((b) => (a === b ? 0 : Infinity)))
    for (const e of edges) { D[idx.get(e.a)!][idx.get(e.b)!] = e.w; D[idx.get(e.b)!][idx.get(e.a)!] = e.w }
    const direct = D.map((r) => [...r])
    const table = (M: number[][], round: number, changed: Set<string>): Prim[] => {
      const d: Prim[] = [heading(20, 14, `Distance vector · round ${round}`)]
      d.push(txt(70, 40, nodes.join('     '), { size: 11, mono: true, tone: 'dim', bold: true }))
      nodes.forEach((a, i) => { d.push(txt(30, 64 + i * 22, a, { size: 12, mono: true, bold: true, tone: 'blue' })); nodes.forEach((_, j) => d.push(txt(70 + j * 39.4, 64 + i * 22, M[i][j] === Infinity ? '∞' : fmt(M[i][j]), { size: 12, mono: true, tone: changed.has(`${i},${j}`) ? 'amber' : 'idle', bold: changed.has(`${i},${j}`) }))) })
      return d
    }
    frames.push({ draw: table(D, 0, new Set()), note: 'Each router starts knowing only its directly connected neighbours. Row = router, column = destination.' })
    for (let round = 1; round <= n + 1; round++) {
      const next = D.map((r) => [...r]); const changed = new Set<string>()
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
        if (k !== i && direct[i][k] < Infinity && direct[i][k] + D[k][j] < next[i][j]) { next[i][j] = direct[i][k] + D[k][j]; changed.add(`${i},${j}`) }
      }
      D = next
      if (changed.size === 0) { frames.push({ draw: table(D, round, changed), note: `Round ${round}: no entry changed — the tables have converged.` }); break }
      frames.push({ draw: table(D, round, changed), note: `Round ${round}: every router recomputes D(i,j) = min over neighbours k of [cost(i,k) + D(k,j)] using the neighbours' tables. Amber = improved.` })
    }
    const s: Record<string, string> = {}
    nodes.forEach((a, i) => { s[`row_${a}`] = D[i].map((v) => fmt(v)).join(' ') })
    return trace(W, Math.max(H, 90 + n * 22), frames, s)
  }
  throw new LabError('algo is dijkstra or dv')
}

// ── TCP congestion control ──────────────────────────────────────────────────

export function tcpCwnd(variant: string, rounds: number, ssthresh0: number, losses: number[], timeouts: number[]): { cwnd: number[]; ssthresh: number[]; phase: string[] } {
  let cwnd = 1, ss = ssthresh0
  const out = { cwnd: [] as number[], ssthresh: [] as number[], phase: [] as string[] }
  for (let r = 1; r <= rounds; r++) {
    out.cwnd.push(cwnd); out.ssthresh.push(ss)
    const phase = cwnd < ss ? 'slow start' : 'congestion avoidance'
    out.phase.push(phase)
    if (timeouts.includes(r) || (losses.includes(r) && variant === 'tahoe')) { ss = Math.max(2, Math.floor(cwnd / 2)); cwnd = 1; out.phase[out.phase.length - 1] = (timeouts.includes(r) ? 'timeout' : 'loss') }
    else if (losses.includes(r)) { ss = Math.max(2, Math.floor(cwnd / 2)); cwnd = ss; out.phase[out.phase.length - 1] = 'fast recovery' }
    else cwnd = cwnd < ss ? Math.min(cwnd * 2, ss) : cwnd + 1
  }
  return out
}

function tcpRun(p: Params) {
  const variant = pstr(p, 'variant', 'reno'), rounds = pnum(p, 'rounds', 24), ss = pnum(p, 'ssthresh', 16)
  const losses = pnums(p, 'dupacks', []), timeouts = pnums(p, 'timeouts', [])
  if (!['tahoe', 'reno'].includes(variant)) throw new LabError('variant is tahoe or reno')
  const { cwnd, ssthresh, phase } = tcpCwnd(variant, rounds, ss, losses, timeouts)
  const W = 600, H = 300, x0 = 50, y0 = 30, pw = 520, ph = 210
  const maxC = Math.max(...cwnd, ...ssthresh) + 2
  const X = (r: number) => x0 + ((r - 1) / Math.max(1, rounds - 1)) * pw, Y = (v: number) => y0 + ph - (v / maxC) * ph
  const frames: Frame[] = []
  for (let k = 0; k <= rounds; k++) {
    const d: Prim[] = [heading(20, 14, `TCP ${variant.toUpperCase()} · cwnd (segments) per RTT`), line(x0, y0 + ph, x0 + pw, y0 + ph, 'dim'), line(x0, y0, x0, y0 + ph, 'dim')]
    for (let v = 0; v <= maxC; v += Math.max(1, Math.ceil(maxC / 6))) d.push(txt(x0 - 8, Y(v) + 4, String(v), { size: 10, anchor: 'end', mono: true, tone: 'dim' }))
    if (k > 0) {
      d.push(poly(cwnd.slice(0, k).map((v, i) => [X(i + 1), Y(v)]), 'blue', { w: 2.2 }))
      d.push(poly(ssthresh.slice(0, k).map((v, i) => [X(i + 1), Y(v)]), 'amber', { w: 1.2, dash: true }))
      cwnd.slice(0, k).forEach((v, i) => d.push(dot(X(i + 1), Y(v), 3, undefined, phase[i] === 'slow start' ? 'mint' : phase[i] === 'congestion avoidance' ? 'blue' : 'rose', { solid: true })))
    }
    d.push(txt(50, H - 30, '● slow start   ● congestion avoidance   ● loss event   ┄ ssthresh', { size: 10.5, tone: 'dim' }))
    frames.push({ draw: d, note: k === 0 ? 'cwnd doubles each RTT in slow start until it reaches ssthresh, then grows by 1 per RTT (additive increase). A loss halves ssthresh.' : `RTT ${k}: cwnd = ${cwnd[k - 1]}, ssthresh = ${ssthresh[k - 1]} — ${phase[k - 1]}.` })
  }
  return trace(W, H, frames, { maxCwnd: String(Math.max(...cwnd)), finalCwnd: String(cwnd[cwnd.length - 1]), cwnd: cwnd.join(' ') })
}

// ── Registry rows ───────────────────────────────────────────────────────────

const G_DC = 'Data communication', G_NET = 'Computer networks'
export const NET_ENGINES: EngineDef[] = [
  { id: 'crc', label: 'CRC error detection', group: G_DC, blurb: 'Polynomial division by XOR: compute the CRC, send it, and watch a flipped bit get caught.',
    params: [{ name: 'data', label: 'Data bits', hint: '0s and 1s', def: '1101011011' }, { name: 'generator', label: 'Generator', hint: 'bits of G(x), e.g. 10011 = x⁴+x+1', def: '10011' }, { name: 'flip', label: 'Corrupt bit', hint: '1-based bit to flip in transit (0 = none)', def: '0' }], run: crcRun },
  { id: 'hamming', label: 'Hamming code', group: G_DC, blurb: 'Single-error correction: parity placement, encoding, syndrome and repair.',
    params: [{ name: 'data', label: 'Data bits', hint: '0s and 1s', def: '1011' }, { name: 'error', label: 'Error position', hint: 'bit to corrupt (0 = none)', def: '5' }], run: hammingRun },
  { id: 'linecode', label: 'Line coding', group: G_DC, blurb: 'NRZ-L, NRZ-I, RZ, Manchester, differential Manchester, AMI, B8ZS and HDB3 waveforms.',
    params: [{ name: 'bits', label: 'Bits', hint: '0s and 1s', def: '01001100011' }, { name: 'codes', label: 'Codes', hint: 'nrzl nrzi rz manchester diffmanchester ami b8zs hdb3', def: 'nrzl manchester ami' }, { name: 'oneHigh', label: 'NRZ-L 1 = high', hint: '1 or 0', def: '1' }], run: linecodeRun },
  { id: 'modulation', label: 'Modulation', group: G_DC, blurb: 'ASK, FSK, PSK for digital data; AM and FM for the message.',
    params: [{ name: 'scheme', label: 'Scheme', hint: 'ask | fsk | psk | am | fm', def: 'fsk', options: ['ask', 'fsk', 'psk', 'am', 'fm'] }, { name: 'bits', label: 'Bits', hint: '0s and 1s', def: '1011001' }, { name: 'cycles', label: 'Cycles / bit', hint: 'carrier cycles per bit', def: '3' }], run: modulationRun },
  { id: 'pcm', label: 'Sampling & PCM', group: G_DC, blurb: 'Nyquist sampling, quantisation levels, PCM bit stream and SNR.',
    params: [{ name: 'fm', label: 'Signal Hz', hint: 'sine frequency', def: '1' }, { name: 'fs', label: 'Sampling Hz', hint: 'sampling rate', def: '8' }, { name: 'bits', label: 'Bits / sample', hint: '1–8', def: '3' }, { name: 'amp', label: 'Amplitude', hint: 'peak volts', def: '1' }], run: pcmRun },
  { id: 'fourier', label: 'Fourier series', group: G_DC, blurb: 'Build square, triangle and sawtooth waves from sine harmonics.',
    params: [{ name: 'shape', label: 'Wave', hint: 'square | triangle | sawtooth', def: 'square', options: ['square', 'triangle', 'sawtooth'] }, { name: 'harmonics', label: 'Harmonics', hint: '1–99', def: '9' }], run: fourierRun },
  { id: 'arq', label: 'Sliding window / ARQ', group: G_NET, blurb: 'Stop-and-wait, Go-Back-N and Selective Repeat with lost frames and acknowledgements.',
    params: [{ name: 'protocol', label: 'Protocol', hint: 'stopwait | gbn | sr', def: 'gbn', options: ['stopwait', 'gbn', 'sr'] }, { name: 'frames', label: 'Frames', hint: 'how many to send', def: '8' }, { name: 'window', label: 'Window', hint: 'sender window', def: '4' }, { name: 'prop', label: 'Propagation', hint: 'one-way delay in frame times', def: '2' }, { name: 'lose', label: 'Lose frames', hint: 'first transmission of these frame numbers is lost', def: '2', optional: true }, { name: 'loseAck', label: 'Lose acks', hint: 'acks with these numbers are lost once', def: '', optional: true }], run: arqRun },
  { id: 'subnet', label: 'IPv4 subnetting & VLSM', group: G_NET, blurb: 'Network, broadcast, hosts from address/prefix — and VLSM allocation.',
    params: [{ name: 'address', label: 'Address/prefix', hint: 'a.b.c.d/n', def: '192.168.10.77/26' }, { name: 'hosts', label: 'VLSM hosts', hint: 'optional host counts to allocate inside the block, e.g. 20 10 5', def: '', optional: true }], run: subnetRun },
  { id: 'routing', label: 'Routing algorithms', group: G_NET, blurb: 'Dijkstra link-state and Bellman-Ford distance-vector on a weighted graph.',
    params: [{ name: 'algo', label: 'Algorithm', hint: 'dijkstra | dv', def: 'dijkstra', options: ['dijkstra', 'dv'] }, { name: 'graph', label: 'Links', hint: 'A-B:cost ; …', def: 'u-v:2;u-x:1;u-w:5;v-x:2;v-w:3;x-w:3;x-y:1;w-y:1;w-z:5;y-z:2', long: true }, { name: 'source', label: 'Source', hint: 'node name', def: 'u' }], run: routingRun },
  { id: 'tcp', label: 'TCP congestion control', group: G_NET, blurb: 'Slow start, congestion avoidance, fast recovery: cwnd against RTT.',
    params: [{ name: 'variant', label: 'Variant', hint: 'tahoe | reno', def: 'reno', options: ['tahoe', 'reno'] }, { name: 'rounds', label: 'RTTs', hint: 'how many', def: '24' }, { name: 'ssthresh', label: 'ssthresh', hint: 'initial threshold', def: '16' }, { name: 'dupacks', label: '3 dup-ACK at', hint: 'RTT numbers', def: '12', optional: true }, { name: 'timeouts', label: 'Timeouts at', hint: 'RTT numbers', def: '', optional: true }], run: tcpRun },
]

