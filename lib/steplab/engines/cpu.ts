// Intel 8085 in a box (ENEX 201 Microprocessors, ENCT 303 COA).
//
// A real two-pass assembler for the teaching subset of the 8085 — the actual
// opcodes, so the listing a student sees is the machine code the chip would
// fetch — and an instruction-level executor with the five flags, T-state
// counts and a memory watch. One frame per executed instruction.

import type { EngineDef, Frame, Params, Prim, Tone } from '../types'
import { LabError, pnum, pstr } from '../types'
import { box, heading, trace, txt } from '../draw'

const hx = (v: number, w = 2) => (v & (w === 2 ? 0xff : 0xffff)).toString(16).toUpperCase().padStart(w, '0')

const REG: Record<string, number> = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, M: 6, A: 7 }
const RP: Record<string, number> = { B: 0, D: 1, H: 2, SP: 3, PSW: 3 }

/** Addresses and data in the memory/watch fields are HEX (no H needed). */
const hexIn = (s: string): number => {
  const v = parseInt(s.trim().replace(/h$/i, '').replace(/^0x/i, ''), 16)
  if (!Number.isFinite(v)) throw new LabError(`"${s}" is not a hex number`)
  return v
}

const SIMPLE: Record<string, { op: number; t: number }> = {
  NOP: { op: 0x00, t: 4 }, HLT: { op: 0x76, t: 5 }, RLC: { op: 0x07, t: 4 }, RRC: { op: 0x0f, t: 4 }, RAL: { op: 0x17, t: 4 }, RAR: { op: 0x1f, t: 4 },
  DAA: { op: 0x27, t: 4 }, CMA: { op: 0x2f, t: 4 }, STC: { op: 0x37, t: 4 }, CMC: { op: 0x3f, t: 4 }, XCHG: { op: 0xeb, t: 4 }, RET: { op: 0xc9, t: 10 },
}
const ALU_R: Record<string, number> = { ADD: 0x80, ADC: 0x88, SUB: 0x90, SBB: 0x98, ANA: 0xa0, XRA: 0xa8, ORA: 0xb0, CMP: 0xb8 }
const ALU_I: Record<string, number> = { ADI: 0xc6, ACI: 0xce, SUI: 0xd6, SBI: 0xde, ANI: 0xe6, XRI: 0xee, ORI: 0xf6, CPI: 0xfe }
const JUMPS: Record<string, number> = { JMP: 0xc3, JNZ: 0xc2, JZ: 0xca, JNC: 0xd2, JC: 0xda, JPO: 0xe2, JPE: 0xea, JP: 0xf2, JM: 0xfa, CALL: 0xcd }

export interface Line { addr: number; bytes: number[]; text: string; src: number; mnem: string; args: string[] }

function num(s: string, labels?: Map<string, number>): number {
  const t = s.trim()
  if (/^[0-9][0-9a-f]*h$/i.test(t)) return parseInt(t.slice(0, -1), 16)
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16)
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10)
  if (/^'.'$/.test(t)) return t.charCodeAt(1)
  if (labels?.has(t.toUpperCase())) return labels.get(t.toUpperCase())!
  if (labels) throw new LabError(`unknown label or number "${s}"`)
  return NaN
}

export function assemble(source: string): { lines: Line[]; mem: Uint8Array; end: number } {
  const raw = source.split(/\r?\n/).map((l) => l.replace(/;.*$/, '').trim())
  const labels = new Map<string, number>()
  const parsed: { src: number; mnem: string; args: string[]; text: string }[] = []
  // pass 1: sizes and labels
  let pc = 0
  const placed: { addr: number; p: (typeof parsed)[number] }[] = []
  raw.forEach((l, i) => {
    if (!l) return
    let rest = l
    const lab = /^([A-Za-z_]\w*):\s*(.*)$/.exec(rest)
    if (lab) { labels.set(lab[1].toUpperCase(), pc); rest = lab[2].trim() }
    if (!rest) return
    const m = /^(\w+)\s*(.*)$/.exec(rest)!
    const mnem = m[1].toUpperCase()
    const args = m[2] ? m[2].split(',').map((a) => a.trim()) : []
    if (mnem === 'ORG') { pc = num(args[0]); return }
    const p = { src: i + 1, mnem, args, text: rest }
    placed.push({ addr: pc, p })
    pc += lengthOf(mnem, args, i + 1)
  })
  // pass 2: bytes
  const mem = new Uint8Array(65536)
  const lines: Line[] = []
  for (const { addr, p } of placed) {
    const bytes = encode(p.mnem, p.args, labels, p.src)
    bytes.forEach((b, k) => { mem[addr + k] = b })
    lines.push({ addr, bytes, text: p.text, src: p.src, mnem: p.mnem, args: p.args })
  }
  return { lines, mem, end: pc }
}

function lengthOf(m: string, a: string[], line: number): number {
  if (m === 'DB') return a.length
  if (SIMPLE[m] || ALU_R[m] || m === 'MOV' || m === 'INR' || m === 'DCR' || m === 'INX' || m === 'DCX' || m === 'DAD' || m === 'PUSH' || m === 'POP' || m === 'LDAX' || m === 'STAX') return 1
  if (ALU_I[m] || m === 'MVI') return 2
  if (JUMPS[m] || m === 'LDA' || m === 'STA' || m === 'LXI' || m === 'LHLD' || m === 'SHLD') return 3
  throw new LabError(`line ${line}: unknown instruction "${m}"`)
}

function reg(a: string | undefined, line: number): number {
  const r = REG[(a ?? '').toUpperCase()]
  if (r === undefined) throw new LabError(`line ${line}: "${a}" is not a register (A B C D E H L or M)`)
  return r
}
function rp(a: string | undefined, line: number, psw = false): number {
  const k = (a ?? '').toUpperCase()
  if (k === 'PSW' && !psw) throw new LabError(`line ${line}: PSW only works with PUSH/POP`)
  if (k === 'SP' && psw) throw new LabError(`line ${line}: use PSW, not SP, with PUSH/POP`)
  const r = RP[k]
  if (r === undefined) throw new LabError(`line ${line}: "${a}" is not a register pair (B D H SP)`)
  return r
}

function encode(m: string, a: string[], labels: Map<string, number>, line: number): number[] {
  const need = (n: number) => { if (a.length !== n) throw new LabError(`line ${line}: ${m} takes ${n} operand${n === 1 ? '' : 's'}`) }
  const n8 = (s: string) => { const v = num(s, labels); if (v < -128 || v > 255) throw new LabError(`line ${line}: ${s} does not fit in 8 bits`); return v & 0xff }
  const n16 = (s: string) => { const v = num(s, labels); return v & 0xffff }
  if (m === 'DB') return a.map(n8)
  if (SIMPLE[m]) { need(0); return [SIMPLE[m].op] }
  if (m === 'MOV') { need(2); const d = reg(a[0], line), s = reg(a[1], line); if (d === 6 && s === 6) throw new LabError(`line ${line}: MOV M,M is HLT`); return [0x40 | (d << 3) | s] }
  if (m === 'MVI') { need(2); return [0x06 | (reg(a[0], line) << 3), n8(a[1])] }
  if (ALU_R[m]) { need(1); return [ALU_R[m] | reg(a[0], line)] }
  if (ALU_I[m]) { need(1); return [ALU_I[m], n8(a[0])] }
  if (m === 'INR') { need(1); return [0x04 | (reg(a[0], line) << 3)] }
  if (m === 'DCR') { need(1); return [0x05 | (reg(a[0], line) << 3)] }
  if (m === 'INX') { need(1); return [0x03 | (rp(a[0], line) << 4)] }
  if (m === 'DCX') { need(1); return [0x0b | (rp(a[0], line) << 4)] }
  if (m === 'DAD') { need(1); return [0x09 | (rp(a[0], line) << 4)] }
  if (m === 'LXI') { need(2); const v = n16(a[1]); return [0x01 | (rp(a[0], line) << 4), v & 0xff, v >> 8] }
  if (m === 'PUSH') { need(1); return [0xc5 | (rp(a[0], line, true) << 4)] }
  if (m === 'POP') { need(1); return [0xc1 | (rp(a[0], line, true) << 4)] }
  if (m === 'LDAX' || m === 'STAX') {
    need(1)
    const k = (a[0] ?? '').toUpperCase()
    if (k !== 'B' && k !== 'D') throw new LabError(`line ${line}: ${m} takes B or D`)
    return [(m === 'LDAX' ? 0x0a : 0x02) | ((k === 'D' ? 1 : 0) << 4)]
  }
  if (m === 'LDA') { need(1); const v = n16(a[0]); return [0x3a, v & 0xff, v >> 8] }
  if (m === 'STA') { need(1); const v = n16(a[0]); return [0x32, v & 0xff, v >> 8] }
  if (m === 'LHLD') { need(1); const v = n16(a[0]); return [0x2a, v & 0xff, v >> 8] }
  if (m === 'SHLD') { need(1); const v = n16(a[0]); return [0x22, v & 0xff, v >> 8] }
  if (JUMPS[m]) { need(1); const v = n16(a[0]); return [JUMPS[m], v & 0xff, v >> 8] }
  throw new LabError(`line ${line}: unknown instruction "${m}"`)
}

// ── Execution ───────────────────────────────────────────────────────────────

export interface Cpu {
  a: number; b: number; c: number; d: number; e: number; h: number; l: number
  sp: number; pc: number
  s: number; z: number; ac: number; p: number; cy: number
  halted: boolean
  t: number
}
const parity = (v: number) => { let n = 0; for (let i = 0; i < 8; i++) n += (v >> i) & 1; return n % 2 === 0 ? 1 : 0 }

function setFlags(c: Cpu, v: number, keepCY = false) {
  const r = v & 0xff
  c.s = r >> 7; c.z = r === 0 ? 1 : 0; c.p = parity(r)
  if (!keepCY) c.cy = v > 0xff || v < 0 ? 1 : 0
}

const getR = (c: Cpu, mem: Uint8Array, r: number): number => {
  switch (r) { case 0: return c.b; case 1: return c.c; case 2: return c.d; case 3: return c.e; case 4: return c.h; case 5: return c.l; case 6: return mem[(c.h << 8) | c.l]; default: return c.a }
}
const setR = (c: Cpu, mem: Uint8Array, r: number, v: number) => {
  v &= 0xff
  switch (r) { case 0: c.b = v; break; case 1: c.c = v; break; case 2: c.d = v; break; case 3: c.e = v; break; case 4: c.h = v; break; case 5: c.l = v; break; case 6: mem[(c.h << 8) | c.l] = v; break; default: c.a = v }
}
const getRP = (c: Cpu, k: number): number => k === 0 ? (c.b << 8) | c.c : k === 1 ? (c.d << 8) | c.e : k === 2 ? (c.h << 8) | c.l : c.sp
const setRP = (c: Cpu, k: number, v: number) => {
  v &= 0xffff
  if (k === 0) { c.b = v >> 8; c.c = v & 0xff } else if (k === 1) { c.d = v >> 8; c.e = v & 0xff } else if (k === 2) { c.h = v >> 8; c.l = v & 0xff } else c.sp = v
}
const flagsByte = (c: Cpu) => (c.s << 7) | (c.z << 6) | (c.ac << 4) | (c.p << 2) | 2 | c.cy

function alu(c: Cpu, op: string, v: number) {
  const a = c.a
  let r: number
  switch (op) {
    case 'ADD': case 'ADI': r = a + v; c.ac = ((a & 0xf) + (v & 0xf)) > 0xf ? 1 : 0; setFlags(c, r); c.a = r & 0xff; break
    case 'ADC': case 'ACI': r = a + v + c.cy; c.ac = ((a & 0xf) + (v & 0xf) + c.cy) > 0xf ? 1 : 0; setFlags(c, r); c.a = r & 0xff; break
    case 'SUB': case 'SUI': r = a - v; c.ac = (a & 0xf) - (v & 0xf) >= 0 ? 1 : 0; setFlags(c, r); c.a = r & 0xff; break
    case 'SBB': case 'SBI': r = a - v - c.cy; c.ac = (a & 0xf) - (v & 0xf) - c.cy >= 0 ? 1 : 0; setFlags(c, r); c.a = r & 0xff; break
    case 'CMP': case 'CPI': r = a - v; c.ac = (a & 0xf) - (v & 0xf) >= 0 ? 1 : 0; setFlags(c, r); break
    case 'ANA': case 'ANI': r = a & v; c.ac = 1; setFlags(c, r); c.cy = 0; c.a = r; break
    case 'XRA': case 'XRI': r = a ^ v; c.ac = 0; setFlags(c, r); c.cy = 0; c.a = r; break
    case 'ORA': case 'ORI': r = a | v; c.ac = 0; setFlags(c, r); c.cy = 0; c.a = r; break
  }
}

/** Execute the instruction at c.pc. Returns a sentence describing what it did. */
export function step(c: Cpu, mem: Uint8Array): { text: string; t: number } {
  const op = mem[c.pc]
  const fetch8 = () => mem[(c.pc + 1) & 0xffff]
  const fetch16 = () => mem[(c.pc + 1) & 0xffff] | (mem[(c.pc + 2) & 0xffff] << 8)
  const hexOp = hx(op)
  const next = (n: number) => { c.pc = (c.pc + n) & 0xffff }
  const push16 = (v: number) => { c.sp = (c.sp - 1) & 0xffff; mem[c.sp] = v >> 8; c.sp = (c.sp - 1) & 0xffff; mem[c.sp] = v & 0xff }
  const pop16 = () => { const lo = mem[c.sp]; c.sp = (c.sp + 1) & 0xffff; const hi = mem[c.sp]; c.sp = (c.sp + 1) & 0xffff; return (hi << 8) | lo }
  const names = ['B', 'C', 'D', 'E', 'H', 'L', 'M', 'A']
  const rpn = ['B', 'D', 'H', 'SP']
  let text = '', t = 4

  if (op === 0x00) { text = 'NOP — nothing happens'; next(1) }
  else if (op === 0x76) { text = 'HLT — the processor stops'; c.halted = true; t = 5; next(1) }
  else if ((op & 0xc0) === 0x40) {
    const d = (op >> 3) & 7, s = op & 7
    setR(c, mem, d, getR(c, mem, s)); t = d === 6 || s === 6 ? 7 : 4
    text = `MOV ${names[d]},${names[s]} — copy ${names[s]} (${hx(getR(c, mem, s))}H) into ${names[d]}`; next(1)
  }
  else if ((op & 0xc7) === 0x06) { const d = (op >> 3) & 7; setR(c, mem, d, fetch8()); t = d === 6 ? 10 : 7; text = `MVI ${names[d]},${hx(fetch8())}H — load the immediate byte`; next(2) }
  else if ((op & 0xc0) === 0x80) {
    const groups = ['ADD', 'ADC', 'SUB', 'SBB', 'ANA', 'XRA', 'ORA', 'CMP']
    const g = groups[(op >> 3) & 7], s = op & 7
    const before = c.a
    alu(c, g, getR(c, mem, s)); t = s === 6 ? 7 : 4
    text = `${g} ${names[s]} — A: ${hx(before)}H ${g === 'CMP' ? 'compared with' : 'with'} ${hx(getR(c, mem, s))}H${g === 'CMP' ? ' (flags only)' : ` → ${hx(c.a)}H`}`; next(1)
  }
  else if ((op & 0xc7) === 0xc6) {
    const groups = ['ADI', 'ACI', 'SUI', 'SBI', 'ANI', 'XRI', 'ORI', 'CPI']
    const g = groups[(op >> 3) & 7]; const v = fetch8(); const before = c.a
    alu(c, g, v); t = 7
    text = `${g} ${hx(v)}H — A: ${hx(before)}H${g === 'CPI' ? ' compared' : ` → ${hx(c.a)}H`}`; next(2)
  }
  else if ((op & 0xc7) === 0x04) { const d = (op >> 3) & 7; const v = getR(c, mem, d) + 1; const cy = c.cy; setR(c, mem, d, v); setFlags(c, v, true); c.cy = cy; c.ac = ((v - 1) & 0xf) + 1 > 0xf ? 1 : 0; t = d === 6 ? 10 : 4; text = `INR ${names[d]} — ${names[d]} = ${hx(getR(c, mem, d))}H (carry is not affected)`; next(1) }
  else if ((op & 0xc7) === 0x05) { const d = (op >> 3) & 7; const v = getR(c, mem, d) - 1; const cy = c.cy; setR(c, mem, d, v); setFlags(c, v, true); c.cy = cy; c.ac = ((v + 1) & 0xf) > 0 ? 1 : 0; t = d === 6 ? 10 : 4; text = `DCR ${names[d]} — ${names[d]} = ${hx(getR(c, mem, d))}H, Z = ${c.z}`; next(1) }
  else if ((op & 0xcf) === 0x01) { const k = (op >> 4) & 3; setRP(c, k, fetch16()); t = 10; text = `LXI ${rpn[k]},${hx(fetch16(), 4)}H — load the 16-bit immediate`; next(3) }
  else if ((op & 0xcf) === 0x03) { const k = (op >> 4) & 3; setRP(c, k, getRP(c, k) + 1); t = 6; text = `INX ${rpn[k]} — ${rpn[k]} = ${hx(getRP(c, k), 4)}H (no flags)`; next(1) }
  else if ((op & 0xcf) === 0x0b) { const k = (op >> 4) & 3; setRP(c, k, getRP(c, k) - 1); t = 6; text = `DCX ${rpn[k]} — ${rpn[k]} = ${hx(getRP(c, k), 4)}H`; next(1) }
  else if ((op & 0xcf) === 0x09) { const k = (op >> 4) & 3; const r = getRP(c, 2) + getRP(c, k); c.cy = r > 0xffff ? 1 : 0; setRP(c, 2, r); t = 10; text = `DAD ${rpn[k]} — HL = HL + ${rpn[k]} = ${hx(getRP(c, 2), 4)}H`; next(1) }
  else if (op === 0x0a || op === 0x1a) { c.a = mem[getRP(c, op === 0x1a ? 1 : 0)]; t = 7; text = `LDAX ${op === 0x1a ? 'D' : 'B'} — A ← memory[${hx(getRP(c, op === 0x1a ? 1 : 0), 4)}H]`; next(1) }
  else if (op === 0x02 || op === 0x12) { mem[getRP(c, op === 0x12 ? 1 : 0)] = c.a; t = 7; text = `STAX ${op === 0x12 ? 'D' : 'B'} — memory[${hx(getRP(c, op === 0x12 ? 1 : 0), 4)}H] ← A`; next(1) }
  else if (op === 0x3a) { c.a = mem[fetch16()]; t = 13; text = `LDA ${hx(fetch16(), 4)}H — A ← ${hx(c.a)}H`; next(3) }
  else if (op === 0x32) { mem[fetch16()] = c.a; t = 13; text = `STA ${hx(fetch16(), 4)}H — memory[${hx(fetch16(), 4)}H] ← ${hx(c.a)}H`; next(3) }
  else if (op === 0x2a) { const a = fetch16(); c.l = mem[a]; c.h = mem[(a + 1) & 0xffff]; t = 16; text = `LHLD ${hx(a, 4)}H — HL ← the word stored there`; next(3) }
  else if (op === 0x22) { const a = fetch16(); mem[a] = c.l; mem[(a + 1) & 0xffff] = c.h; t = 16; text = `SHLD ${hx(a, 4)}H — store HL`; next(3) }
  else if (op === 0x07) { c.cy = c.a >> 7; c.a = ((c.a << 1) | c.cy) & 0xff; text = `RLC — rotate A left; CY = old bit 7`; next(1) }
  else if (op === 0x0f) { c.cy = c.a & 1; c.a = (c.a >> 1) | (c.cy << 7); text = `RRC — rotate A right; CY = old bit 0`; next(1) }
  else if (op === 0x17) { const cy = c.cy; c.cy = c.a >> 7; c.a = ((c.a << 1) | cy) & 0xff; text = `RAL — rotate A left through the carry`; next(1) }
  else if (op === 0x1f) { const cy = c.cy; c.cy = c.a & 1; c.a = (c.a >> 1) | (cy << 7); text = `RAR — rotate A right through the carry`; next(1) }
  else if (op === 0x2f) { c.a = ~c.a & 0xff; text = `CMA — complement A → ${hx(c.a)}H`; next(1) }
  else if (op === 0x37) { c.cy = 1; text = 'STC — carry ← 1'; next(1) }
  else if (op === 0x3f) { c.cy ^= 1; text = 'CMC — complement the carry'; next(1) }
  else if (op === 0xeb) { [c.h, c.d] = [c.d, c.h];[c.l, c.e] = [c.e, c.l]; text = 'XCHG — swap HL and DE'; next(1) }
  else if (op === 0x27) {
    const lo = c.a & 0xf; let v = c.a
    if (lo > 9 || c.ac) { c.ac = lo + 6 > 0xf ? 1 : 0; v += 6; if (v > 0xff) c.cy = 1; v &= 0xff }
    if (((v >> 4) & 0xf) > 9 || c.cy) { v += 0x60; c.cy = 1; v &= 0xff }
    c.a = v; setFlags(c, v, true); text = `DAA — decimal adjust: A = ${hx(c.a)}H (each nibble is now a BCD digit)`; next(1)
  }
  else if ((op & 0xcf) === 0xc5) { const k = (op >> 4) & 3; push16(k === 3 ? (c.a << 8) | flagsByte(c) : getRP(c, k)); t = 12; text = `PUSH ${k === 3 ? 'PSW' : rpn[k]} — SP = ${hx(c.sp, 4)}H`; next(1) }
  else if ((op & 0xcf) === 0xc1) { const k = (op >> 4) & 3; const v = pop16(); if (k === 3) { c.a = v >> 8; const f = v & 0xff; c.s = f >> 7; c.z = (f >> 6) & 1; c.ac = (f >> 4) & 1; c.p = (f >> 2) & 1; c.cy = f & 1 } else setRP(c, k, v); t = 10; text = `POP ${k === 3 ? 'PSW' : rpn[k]} — SP = ${hx(c.sp, 4)}H`; next(1) }
  else if (op === 0xc9) { c.pc = pop16(); t = 10; text = `RET — PC ← ${hx(c.pc, 4)}H popped from the stack` }
  else if (op === 0xcd) { const a = fetch16(); push16((c.pc + 3) & 0xffff); c.pc = a; t = 18; text = `CALL ${hx(a, 4)}H — push the return address, jump` }
  else {
    const cond: Record<number, [string, () => boolean]> = {
      0xc3: ['JMP', () => true], 0xc2: ['JNZ', () => !c.z], 0xca: ['JZ', () => !!c.z], 0xd2: ['JNC', () => !c.cy], 0xda: ['JC', () => !!c.cy],
      0xe2: ['JPO', () => !c.p], 0xea: ['JPE', () => !!c.p], 0xf2: ['JP', () => !c.s], 0xfa: ['JM', () => !!c.s],
    }
    const j = cond[op]
    if (!j) throw new LabError(`opcode ${hexOp} at ${hx(c.pc, 4)}H is not part of the teaching subset — the program ran into data or unassembled memory`)
    const a = fetch16()
    if (j[1]()) { c.pc = a; t = 10; text = `${j[0]} ${hx(a, 4)}H — condition true, PC ← ${hx(a, 4)}H` }
    else { t = 7; text = `${j[0]} ${hx(a, 4)}H — condition false, fall through`; next(3) }
  }
  c.t += t
  return { text, t }
}

// ── Engine ──────────────────────────────────────────────────────────────────

const DEFAULT_PROG = `; add the bytes at 2050H and 2051H, store at 2052H
      LXI H,2050H
      MOV A,M
      INX H
      ADD M
      INX H
      MOV M,A
      HLT`

function cpuRun(p: Params) {
  const src = pstr(p, 'program', DEFAULT_PROG)
  const maxSteps = pnum(p, 'maxSteps', 300)
  const { lines, mem } = assemble(src)
  if (lines.length === 0) throw new LabError('the program is empty')
  // initial memory: "2050=25,17;3000=01"
  for (const seg of (p.memory ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [addr, list] = seg.split('=')
    let at = hexIn(addr)
    for (const b of (list ?? '').split(/[,\s]+/).filter(Boolean)) { mem[at & 0xffff] = hexIn(b) & 0xff; at++ }
  }
  const watch = (p.watch ?? '').split(/[,\s]+/).filter(Boolean).map(hexIn)
  const start = lines[0].addr
  const c: Cpu = { a: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, sp: 0xffff, pc: start, s: 0, z: 0, ac: 0, p: 0, cy: 0, halted: false, t: 0 }
  const snaps: { c: Cpu; changed: Set<string>; text: string; mem: number[]; addr: number | null }[] = [{ c: { ...c }, changed: new Set(), text: `Program assembled at ${hx(start, 4)}H (${lines.reduce((n, l) => n + l.bytes.length, 0)} bytes). PC points at the first instruction.`, mem: watch.map((w) => mem[w]), addr: start }]
  let steps = 0
  while (!c.halted && steps < maxSteps) {
    const before = { ...c }
    const beforeMem = watch.map((w) => mem[w])
    const r = step(c, mem)
    const changed = new Set<string>()
    for (const k of ['a', 'b', 'c', 'd', 'e', 'h', 'l', 'sp', 's', 'z', 'ac', 'p', 'cy'] as const) if (before[k] !== c[k]) changed.add(k)
    watch.forEach((w, i) => { if (beforeMem[i] !== mem[w]) changed.add(`m${i}`) })
    snaps.push({ c: { ...c }, changed, text: r.text, mem: watch.map((w) => mem[w]), addr: c.halted ? before.pc : c.pc })
    steps++
  }
  if (!c.halted) throw new LabError(`the program did not halt within ${maxSteps} instructions — is there an infinite loop?`)
  const codeRows = lines.length
  const W = 640, H = Math.max(300, 76 + codeRows * 20 + 40)
  const frames: Frame[] = snaps.map((s, k) => {
    const d: Prim[] = [heading(20, 14, 'Program · machine code')]
    const cur = k > 0 ? snaps[k - 1] : null
    lines.forEach((l, i) => {
      const y = 44 + i * 20
      const isPC = l.addr === s.addr && !(k === snaps.length - 1 && c.halted && false)
      const wasRun = cur && l.addr === (k > 0 ? snaps[k - 1].addr : null)
      d.push(txt(20, y, hx(l.addr, 4), { size: 11, mono: true, tone: isPC ? 'blue' : 'dim' }))
      d.push(txt(68, y, l.bytes.map((b) => hx(b)).join(' '), { size: 11, mono: true, tone: isPC ? 'blue' : 'dim' }))
      d.push(txt(150, y, l.text, { size: 12, mono: true, tone: isPC ? 'blue' : wasRun ? 'mint' : 'idle', bold: !!isPC }))
    })
    // registers
    const rx = 372
    d.push(heading(rx, 14, 'Registers'))
    const regs: [string, number, number, string][] = [['A', s.c.a, 2, 'a'], ['B', s.c.b, 2, 'b'], ['C', s.c.c, 2, 'c'], ['D', s.c.d, 2, 'd'], ['E', s.c.e, 2, 'e'], ['H', s.c.h, 2, 'h'], ['L', s.c.l, 2, 'l']]
    regs.forEach(([n, v, w, key], i) => {
      const col = i % 4, row = Math.floor(i / 4)
      const tone: Tone = s.changed.has(key) ? 'mint' : 'idle'
      d.push(box(rx + col * 64, 24 + row * 42, 58, 34, hx(v, w), tone, n))
    })
    d.push(box(rx, 110, 92, 30, `${hx(s.c.pc, 4)}H`, s.changed.size ? 'blue' : 'idle', 'PC'))
    d.push(box(rx + 100, 110, 92, 30, `${hx(s.c.sp, 4)}H`, s.changed.has('sp') ? 'mint' : 'idle', 'SP'))
    d.push(heading(rx, 160, 'Flags'))
    ;(['s', 'z', 'ac', 'p', 'cy'] as const).forEach((f, i) => d.push(box(rx + i * 50, 168, 44, 34, String(s.c[f]), s.changed.has(f) ? 'amber' : s.c[f] ? 'mint' : 'idle', f.toUpperCase())))
    d.push(heading(rx, 224, 'Memory watch'))
    watch.slice(0, 6).forEach((w, i) => d.push(box(rx + (i % 3) * 84, 232 + Math.floor(i / 3) * 40, 78, 34, hx(s.mem[i]), s.changed.has(`m${i}`) ? 'amber' : 'idle', `${hx(w, 4)}H`)))
    d.push(txt(20, H - 14, `instructions ${k} · T-states ${s.c.t} · at 3 MHz ≈ ${(s.c.t / 3).toFixed(2)} µs`, { size: 12, mono: true, tone: 'amber' }))
    return { draw: d, note: s.text }
  })
  const fin = snaps[snaps.length - 1]
  const summary: Record<string, string> = {
    A: hx(fin.c.a), B: hx(fin.c.b), C: hx(fin.c.c), D: hx(fin.c.d), E: hx(fin.c.e), H: hx(fin.c.h), L: hx(fin.c.l),
    Z: String(fin.c.z), CY: String(fin.c.cy), S: String(fin.c.s), P: String(fin.c.p), AC: String(fin.c.ac),
    tstates: String(fin.c.t), instructions: String(steps),
  }
  watch.forEach((w, i) => { summary[`m${hx(w, 4)}`] = hx(fin.mem[i]) })
  return trace(W, H, frames, summary)
}

export const CPU_ENGINES: EngineDef[] = [
  {
    id: 'cpu8085', label: 'Intel 8085 processor', group: 'Microprocessors',
    blurb: 'Assemble and single-step 8085 code: real opcodes, registers, flags, memory and T-states.',
    params: [
      { name: 'program', label: 'Program', hint: '8085 assembly; labels end with ":", ; starts a comment. Hex numbers end in H.', def: DEFAULT_PROG, long: true },
      { name: 'memory', label: 'Initial memory', hint: '2050=25,17;3000=01 (hex address = bytes)', def: '2050=25,17', optional: true },
      { name: 'watch', label: 'Memory watch', hint: 'hex addresses to display (up to 6)', def: '2050,2051,2052', optional: true },
      { name: 'maxSteps', label: 'Step limit', hint: 'safety limit for runaway loops', def: '300' },
    ],
    run: cpuRun,
  },
]
