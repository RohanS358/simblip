// A tiny arithmetic-expression evaluator and a seeded PRNG, shared by the
// numerical engines. Engines are pure and must run in Node with no packages
// (the lesson gate bundles them alone), so this is deliberately NOT mathjs.
//
// Grammar:  expr = term (('+'|'-') term)* ;  term = unary (('*'|'/') unary)* ;
//           unary = '-' unary | power ;  power = atom ('^' unary)? ;
//           atom = number | name | name '(' expr ')' | '(' expr ')'
// Names: variables passed in, `pi`, `e`, and sin cos tan asin acos atan exp ln
// log sqrt abs floor ceil sinh cosh tanh.

import { LabError } from './types'

const FN: Record<string, (x: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, ln: Math.log, log: Math.log10, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
}

export type Expr = (vars: Record<string, number>) => number

export function compile(src: string): Expr {
  const s = src.replace(/\s+/g, '').replace(/\*\*/g, '^').replace(/(\d)([a-z(])/gi, '$1*$2').replace(/\)(\d|[a-z(])/gi, ')*$1')
  let i = 0
  const peek = () => s[i]
  const fail = (m: string): never => { throw new LabError(`cannot read "${src}": ${m}`) }
  const number = (): Expr => {
    const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(s.slice(i))
    if (!m) return fail(`expected a number at "${s.slice(i, i + 6)}"`)
    i += m[0].length
    const v = Number(m[0])
    return () => v
  }
  const atom = (): Expr => {
    const c = peek()
    if (c === undefined) return fail('the expression ends early')
    if (c === '(') { i++; const e = expr(); if (peek() !== ')') fail('missing )'); i++; return e }
    if (/[\d.]/.test(c)) return number()
    const m = /^[a-z_][a-z_0-9]*/i.exec(s.slice(i))
    if (!m) return fail(`unexpected "${c}"`)
    i += m[0].length
    const name = m[0].toLowerCase()
    if (peek() === '(') {
      const f = FN[name]
      if (!f) return fail(`unknown function ${name}`)
      i++; const arg = expr(); if (peek() !== ')') fail('missing )'); i++
      return (v) => f(arg(v))
    }
    if (name === 'pi') return () => Math.PI
    if (name === 'e') return () => Math.E
    return (v) => { if (!(name in v)) throw new LabError(`unknown variable "${name}"`); return v[name] }
  }
  const power = (): Expr => { const b = atom(); if (peek() === '^') { i++; const e = unary(); return (v) => Math.pow(b(v), e(v)) } return b }
  const unary = (): Expr => { if (peek() === '-') { i++; const u = unary(); return (v) => -u(v) } if (peek() === '+') { i++; return unary() } return power() }
  const term = (): Expr => {
    let l = unary()
    while (peek() === '*' || peek() === '/') { const op = s[i++]; const r = unary(); const a = l; l = op === '*' ? (v) => a(v) * r(v) : (v) => a(v) / r(v) }
    return l
  }
  const expr = (): Expr => {
    let l = term()
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); const a = l; l = op === '+' ? (v) => a(v) + r(v) : (v) => a(v) - r(v) }
    return l
  }
  const out = expr()
  if (i < s.length) fail(`unexpected "${s.slice(i, i + 6)}"`)
  return out
}

export const fx = (src: string): ((x: number) => number) => { const e = compile(src); return (x) => e({ x }) }
export const deriv = (f: (x: number) => number, x: number, h = 1e-6) => (f(x + h) - f(x - h)) / (2 * h)

/** mulberry32 — a tiny seeded generator, so every "random" figure is the same figure. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Standard normal via Box–Muller. */
export const gauss = (r: () => number): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
