// Step-by-step calculus for the Formula card. Input format:
//   f(x) = x^2 + 3*x, 10<x<20            (bounds optional)
//   g(x,y) = x^2*y + sin(y), 2<y<10      (multi-var → partials)
// Derivatives/partials are fully symbolic (mathjs). Integrals use a
// term-by-term rule set (power rule, sin/cos/exp, 1/x); anything without a
// closed form falls back to a numeric Simpson result when bounds exist.
// Output is a LaTeX line stack the card renders under the formula.

import { create, all, type MathNode } from 'mathjs'

const m = create(all, {})

export interface ParsedFormula {
  name: string
  vars: string[]
  body: string
  bounds: Record<string, [number, number]>
}

export function parseFormula(text: string): ParsedFormula | null {
  // Pull bound clauses out FIRST (they're comma-separated, but so is a
  // multi-variable signature g(x,y) — splitting on comma would break it).
  const bounds: Record<string, [number, number]> = {}
  const boundRe = /(-?\d+(?:\.\d+)?)\s*<\s*([a-zA-Z]\w*)\s*<\s*(-?\d+(?:\.\d+)?)/g
  for (const bm of text.matchAll(boundRe)) bounds[bm[2]] = [Number(bm[1]), Number(bm[3])]
  // The definition is whatever's left once the bounds (and their commas) go.
  const main = text.replace(boundRe, '').replace(/,\s*$/g, '').replace(/,\s*,/g, ',').trim().replace(/,\s*$/, '')
  const mm = /^\s*([a-zA-Z]\w*)\s*\(\s*([a-zA-Z]\w*(?:\s*,\s*[a-zA-Z]\w*)*)\s*\)\s*=\s*(.+?)\s*,?\s*$/.exec(main)
  if (!mm) return null
  try {
    m.parse(mm[3])
  } catch {
    return null
  }
  return { name: mm[1], vars: mm[2].split(',').map((s) => s.trim()), body: mm[3].trim(), bounds }
}

const tex = (n: string | MathNode) =>
  (typeof n === 'string' ? m.parse(n) : n).toTex({ parenthesis: 'auto' })

/** Flatten top-level additions so steps go term by term. */
function terms(n: MathNode): MathNode[] {
  const o = n as unknown as { type: string; op?: string; args?: MathNode[] }
  if (o.type === 'OperatorNode' && o.op === '+' && o.args?.length === 2)
    return [...terms(o.args[0]), ...terms(o.args[1])]
  return [n]
}

export function derivativeSteps(p: ParsedFormula, v: string): string {
  const partial = p.vars.length > 1
  const D = partial ? `\\frac{\\partial}{\\partial ${v}}` : `\\frac{d}{d${v}}`
  const node = m.parse(p.body)
  const ts = terms(node)
  const lines: string[] = [`${D}\\left[${tex(node)}\\right]`]
  if (ts.length > 1)
    for (const t of ts)
      lines.push(`${D}\\left(${tex(t)}\\right) = ${tex(m.simplify(m.derivative(t, v)))}`)
  const total = m.simplify(m.derivative(node, v))
  const head = partial ? `\\frac{\\partial ${p.name}}{\\partial ${v}}` : `${p.name}'(${v})`
  lines.push(`${head} = ${tex(total)}`)
  return lines.join(' \\\\[5pt] ')
}

const isConstIn = (n: MathNode, v: string) =>
  n.filter((c) => c.type === 'SymbolNode' && (c as unknown as { name: string }).name === v)
    .length === 0

/** Term antiderivative via classic rules, or null when no closed form. */
function antideriv(term: MathNode, v: string): MathNode | null {
  try {
    const s = term.toString()
    if (isConstIn(term, v)) return m.parse(`(${s}) * ${v}`)
    const o = term as unknown as { type: string; op?: string; args?: MathNode[] }
    if (o.type === 'OperatorNode' && (o.op === '*' || o.op === '/') && o.args?.length === 2) {
      const [a, b] = o.args
      if (o.op === '*' && isConstIn(a, v)) {
        const r = antideriv(b, v)
        return r ? m.parse(`(${a.toString()}) * (${r.toString()})`) : null
      }
      if (o.op === '*' && isConstIn(b, v)) {
        const r = antideriv(a, v)
        return r ? m.parse(`(${b.toString()}) * (${r.toString()})`) : null
      }
      if (o.op === '/' && isConstIn(b, v)) {
        const r = antideriv(a, v)
        return r ? m.parse(`(${r.toString()}) / (${b.toString()})`) : null
      }
    }
    if (s === v) return m.parse(`${v}^2 / 2`)
    const pw = new RegExp(`^${v}\\s*\\^\\s*\\(?(-?\\d+(?:\\.\\d+)?)\\)?$`).exec(s)
    if (pw) {
      const n = Number(pw[1])
      return n === -1 ? m.parse(`log(${v})`) : m.parse(`${v}^${n + 1} / ${n + 1}`)
    }
    if (s === `sin(${v})`) return m.parse(`-cos(${v})`)
    if (s === `cos(${v})`) return m.parse(`sin(${v})`)
    if (s === `exp(${v})` || s.replace(/\s/g, '') === `e^${v}`) return m.parse(`exp(${v})`)
    if (s.replace(/\s/g, '') === `1/${v}`) return m.parse(`log(${v})`)
  } catch {
    /* fall through */
  }
  return null
}

/** Free symbols of a body other than the given integration variables and the
 *  built-in constants — these are the ones a numeric result would still need. */
function otherFreeVars(node: MathNode, ignore: string[]): string[] {
  const skip = new Set([...ignore, 'e', 'pi', 'E', 'PI', 'i', 'Infinity'])
  const found = new Set<string>()
  node.filter((n) => n.type === 'SymbolNode').forEach((n) => {
    const name = (n as unknown as { name: string }).name
    if (!skip.has(name) && typeof (m as unknown as Record<string, unknown>)[name] !== 'function')
      found.add(name)
  })
  return [...found]
}

/** Evaluate to a real number, taking the real part of complex results (a
 *  function like sin(x)^x goes complex where sin(x)<0). Returns NaN if the
 *  value can't be reduced to a finite real. */
function realAt(compiled: { evaluate: (s: Record<string, number>) => unknown }, scope: Record<string, number>): number {
  try {
    const y = compiled.evaluate(scope)
    if (typeof y === 'number') return Number.isFinite(y) ? y : NaN
    if (y && typeof y === 'object' && 're' in y) {
      const re = (y as { re: number }).re
      return Number.isFinite(re) ? re : NaN
    }
    return NaN
  } catch {
    return NaN
  }
}

/** Composite Simpson (real part), tolerant of a few undefined sample points. */
function simpson(compiled: { evaluate: (s: Record<string, number>) => unknown }, v: string, a: number, b: number, base: Record<string, number> = {}): number {
  const S = 128
  const h = (b - a) / S
  let sum = 0
  let bad = 0
  for (let i = 0; i <= S; i++) {
    const y = realAt(compiled, { ...base, [v]: a + i * h })
    const yy = Number.isFinite(y) ? y : (bad++, 0)
    sum += i === 0 || i === S ? yy : i % 2 ? 4 * yy : 2 * yy
  }
  return bad > S / 2 ? NaN : (sum * h) / 3
}

export function integralSteps(p: ParsedFormula, v: string): string {
  const node = m.parse(p.body)
  const b = p.bounds[v]
  const sign = b ? `\\int_{${b[0]}}^{${b[1]}}` : `\\int`
  const ts = terms(node)
  const lines: string[] = [`${sign} ${tex(node)}\\, d${v}`]
  const antis = ts.map((t) => ({ t, F: antideriv(m.simplify(t), v) }))

  if (antis.every((a) => a.F)) {
    if (ts.length > 1)
      for (const a of antis)
        lines.push(`\\int ${tex(a.t)}\\, d${v} = ${tex(m.simplify(a.F!))}`)
    const Fstr = antis.map((a) => `(${a.F!.toString()})`).join(' + ')
    const F = m.simplify(Fstr)
    if (!b) {
      lines.push(`= ${tex(F)} + C`)
    } else {
      const sub = (val: number) =>
        m.simplify(
          m.parse(Fstr).transform((n) =>
            n.type === 'SymbolNode' && (n as unknown as { name: string }).name === v
              ? new m.ConstantNode(val)
              : n
          )
        )
      const Fb = sub(b[1])
      const Fa = sub(b[0])
      lines.push(`F(${v}) = ${tex(F)}`)
      lines.push(`= F(${b[1]}) - F(${b[0]}) = ${tex(Fb)} - \\left(${tex(Fa)}\\right)`)
      const val = realAt(Fb.compile(), {}) - realAt(Fa.compile(), {})
      if (Number.isFinite(val)) lines.push(`= ${Number(val.toPrecision(6))}`)
    }
  } else {
    // No closed form. Report the antiderivative symbolically as best we can,
    // and give a numeric value whenever bounds exist and no OTHER free
    // variable blocks it.
    const missing = otherFreeVars(node, [v])
    lines.push(`\\text{No elementary antiderivative}${missing.length ? '' : '\\text{ — numeric result:}'}`)
    if (missing.length > 0) {
      lines.push(
        `\\text{Define }${missing.join(', ')}\\text{ (as page variables) to evaluate numerically.}`
      )
    } else if (b) {
      const val = simpson(node.compile(), v, b[0], b[1])
      lines.push(
        Number.isFinite(val)
          ? `\\int_{${b[0]}}^{${b[1]}} ${tex(node)}\\, d${v} \\approx ${Number(val.toPrecision(6))}`
          : `\\text{The function is undefined over much of }[${b[0]},\\,${b[1]}]`
      )
    } else {
      lines.push(`\\text{Add bounds (e.g. } 0<${v}<1\\text{) for a definite numeric value.}`)
    }
  }
  return lines.join(' \\\\[5pt] ')
}

/** Iterated (double/triple) definite integral over every bounded variable,
 *  innermost first. Symbolic where each inner integral has a closed form,
 *  else nested numeric Simpson. Requires ≥2 variables with bounds. */
export function iteratedIntegralSteps(p: ParsedFormula): string {
  const vars = p.vars.filter((v) => p.bounds[v])
  if (vars.length < 2) return `\\text{Give bounds for at least two variables (e.g. }0<x<1,\;0<y<2\\text{).}`
  const sign = vars.map((v) => `\\int_{${p.bounds[v][0]}}^{${p.bounds[v][1]}}`).join('')
  const dvs = vars.map((v) => `\\,d${v}`).join('')
  const node = m.parse(p.body)
  const lines: string[] = [`${sign} ${tex(node)}${dvs}`]

  // Try fully symbolic, innermost variable first.
  let cur: MathNode | null = node
  let symbolic = true
  for (const v of vars) {
    if (!cur) break
    const parts: (MathNode | null)[] = terms(cur).map((t) => antideriv(m.simplify(t), v))
    if (parts.some((F) => !F)) {
      symbolic = false
      break
    }
    const Fstr: string = parts.map((F) => `(${(F as MathNode).toString()})`).join(' + ')
    const sub = (val: number): MathNode =>
      m.parse(Fstr).transform((n: MathNode) =>
        n.type === 'SymbolNode' && (n as unknown as { name: string }).name === v
          ? new m.ConstantNode(val)
          : n
      )
    const [a, bb] = p.bounds[v]
    cur = m.simplify(m.parse(`(${sub(bb).toString()}) - (${sub(a).toString()})`))
    lines.push(`\\text{after }d${v}:\; ${tex(cur)}`)
  }

  if (symbolic && cur) {
    const val = realAt(cur.compile(), {})
    lines.push(Number.isFinite(val) ? `= ${Number(val.toPrecision(6))}` : `= ${tex(cur)}`)
    return lines.join(' \\\\[5pt] ')
  }

  // Nested numeric Simpson over the bounded variables.
  const compiled = node.compile()
  const nest = (idx: number, base: Record<string, number>): number => {
    const v = vars[idx]
    const [a, bb] = p.bounds[v]
    if (idx === vars.length - 1) return simpson(compiled, v, a, bb, base)
    const S = 40
    const h = (bb - a) / S
    let sum = 0
    for (let i = 0; i <= S; i++) {
      const inner = nest(idx + 1, { ...base, [v]: a + i * h })
      sum += i === 0 || i === S ? inner : i % 2 ? 4 * inner : 2 * inner
    }
    return (sum * h) / 3
  }
  const missing = otherFreeVars(node, vars)
  if (missing.length > 0) {
    lines.push(`\\text{Define }${missing.join(', ')}\\text{ to evaluate numerically.}`)
  } else {
    const val = nest(0, {})
    lines.push(Number.isFinite(val) ? `\\approx ${Number(val.toPrecision(6))}\;\\text{(numeric)}` : `\\text{undefined over the region}`)
  }
  return lines.join(' \\\\[5pt] ')
}
