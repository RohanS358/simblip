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
  if (vars.length < 2) return `\\text{Give bounds for at least two variables (e.g. }0<x<1,\\;0<y<2\\text{).}`
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
    lines.push(`\\text{after }d${v}:\\; ${tex(cur)}`)
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
    lines.push(Number.isFinite(val) ? `\\approx ${Number(val.toPrecision(6))};\\text{(numeric)}` : `\\text{undefined over the region}`)
  }
  return lines.join(' \\\\[5pt] ')
}

// ── Transforms ──────────────────────────────────────────────────────────────
// Laplace  L{f(t)} → F(s)  and  Fourier  F{f(t)} → F(ω), both term-by-term
// against a standard table (the classic engineering pairs). Constant factors
// are pulled out by linearity, so 3*exp(-2*t) works even though only exp does.
// Fourier uses the F(ω) = ∫ f(t) e^{-iωt} dt convention; write u(t) for the
// unit step when the signal is causal.

interface Factored {
  coeff: MathNode | null // constant multiplier (w.r.t. the variable)
  factors: MathNode[] // the rest, flattened over '*'
}

/** Flatten a product, splitting off everything constant in `v`. Division by
 *  a constant folds into the coefficient; division by anything else fails. */
function factorTerm(term: MathNode, v: string): Factored | null {
  const consts: MathNode[] = []
  const rest: MathNode[] = []
  const walk = (n: MathNode, invert: boolean): boolean => {
    const o = n as unknown as { type: string; op?: string; args?: MathNode[]; content?: MathNode }
    if (o.type === 'ParenthesisNode' && o.content) return walk(o.content, invert)
    if (o.type === 'OperatorNode' && o.args?.length === 2 && (o.op === '*' || o.op === '/')) {
      if (!walk(o.args[0], invert)) return false
      return walk(o.args[1], o.op === '/' ? !invert : invert)
    }
    if (isConstIn(n, v)) {
      consts.push(invert ? m.parse(`1 / (${n.toString()})`) : n)
      return true
    }
    if (invert) return false // 1 / f(v) isn't in either table
    rest.push(n)
    return true
  }
  if (!walk(term, false)) return null
  const coeff =
    consts.length === 0 ? null : m.simplify(consts.map((c) => `(${c.toString()})`).join(' * '))
  return { coeff, factors: rest.length === 0 ? [m.parse('1')] : rest }
}

/** `a` when `arg` is exactly a·v (linear, no constant term); else null. */
function linearCoeff(arg: MathNode, v: string): MathNode | null {
  try {
    const a = m.simplify(m.derivative(arg, v))
    if (!isConstIn(a, v)) return null
    const c0 = m.simplify(m.parse(`(${arg.toString()}) - (${a.toString()}) * ${v}`))
    const val = realAt(c0.compile(), {})
    if (c0.toString() === '0' || (Number.isFinite(val) && Math.abs(val) < 1e-12)) return a
    return null
  } catch {
    return null
  }
}

/** `a` when `arg` is exactly a·v² ; else null. */
function quadCoeff(arg: MathNode, v: string): MathNode | null {
  try {
    const d2 = m.simplify(m.derivative(m.derivative(arg, v), v))
    if (!isConstIn(d2, v)) return null
    const a = m.simplify(m.parse(`(${d2.toString()}) / 2`))
    const rem = m.simplify(m.parse(`(${arg.toString()}) - (${a.toString()}) * ${v}^2`))
    return rem.toString() === '0' ? a : null
  } catch {
    return null
  }
}

const fnName = (n: MathNode): string => {
  const o = n as unknown as { type: string; fn?: { name?: string }; args?: MathNode[] }
  return o.type === 'FunctionNode' ? (o.fn?.name ?? '') : ''
}
const fnArg = (n: MathNode): MathNode | null =>
  (n as unknown as { args?: MathNode[] }).args?.[0] ?? null

/** exp(x) written either as exp(x) or e^x. */
function expArg(n: MathNode, v: string): MathNode | null {
  if (fnName(n) === 'exp') return fnArg(n)
  const o = n as unknown as { type: string; op?: string; args?: MathNode[] }
  if (o.type === 'OperatorNode' && o.op === '^' && o.args?.length === 2) {
    const base = o.args[0] as unknown as { type: string; name?: string }
    if (base.type === 'SymbolNode' && base.name === 'e' && !isConstIn(o.args[1], v) === false) return o.args[1]
    if (base.type === 'SymbolNode' && base.name === 'e') return o.args[1]
  }
  return null
}

/** Power of `v` carried by a factor: v → 1, v^3 → 3, otherwise null. */
function powOf(n: MathNode, v: string): number | null {
  const s = n.toString().replace(/\s/g, '')
  if (s === v) return 1
  const pw = new RegExp(`^${v}\\^\\(?(\\d+)\\)?$`).exec(s)
  return pw ? Number(pw[1]) : null
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1))

/** Numeric value of a constant node, or NaN when it stays symbolic. */
const constVal = (n: MathNode): number => realAt(n.compile(), {})

/** "s", "s + 2", "s - 3", or "s - (a)" — never mathjs's \mathrm{s}. */
function shifted(sym: string, a: MathNode | null): string {
  if (!a) return sym
  const val = constVal(a)
  if (Number.isFinite(val)) {
    if (val === 0) return sym
    const mag = Number(Math.abs(val).toPrecision(6))
    return `${sym} ${val < 0 ? '+' : '-'} ${mag}`
  }
  return `${sym} - \\left(${tex(a)}\\right)`
}
/** Wrap only when the expression isn't a bare symbol. */
const grp = (e: string) => (/^[a-z]$/i.test(e.trim()) ? e.trim() : `\\left(${e}\\right)`)
/** Square, folded to a number when possible (3² → 9). */
function sq(n: MathNode): string {
  const val = constVal(n)
  return Number.isFinite(val) ? String(Number((val * val).toPrecision(6))) : `${grp(tex(n))}^2`
}
const withCoeff = (coeff: MathNode | null, body: string): string =>
  !coeff || coeff.toString() === '1' ? body : `${tex(coeff)} \\cdot ${body}`

/** Laplace of one term (LaTeX), or null when it isn't in the table. */
function laplaceTerm(term: MathNode, v: string): string | null {
  const f = factorTerm(m.simplify(term), v)
  if (!f) return null
  let n = 0
  let a: MathNode | null = null
  let trig: { fn: string; w: MathNode } | null = null
  for (const g of f.factors) {
    if (g.toString() === '1') continue
    const p = powOf(g, v)
    if (p !== null) {
      n += p
      continue
    }
    const ea = expArg(g, v)
    if (ea) {
      const c = linearCoeff(ea, v)
      if (!c) return null
      a = a ? m.simplify(m.parse(`(${a.toString()}) + (${c.toString()})`)) : c
      continue
    }
    const name = fnName(g)
    if (['sin', 'cos', 'sinh', 'cosh'].includes(name)) {
      if (trig) return null
      const arg = fnArg(g)
      const w = arg && linearCoeff(arg, v)
      if (!w) return null
      trig = { fn: name, w }
      continue
    }
    return null
  }

  // s, shifted by a when the term carries e^{a t} (first shifting theorem).
  const S = shifted('s', a)
  if (trig) {
    if (n > 0) return null // t·sin(ωt) etc. — beyond the basic table
    const W = tex(trig.w)
    const hyp = trig.fn === 'sinh' || trig.fn === 'cosh'
    const den = `${grp(S)}^2 ${hyp ? '-' : '+'} ${sq(trig.w)}`
    const numer = trig.fn === 'sin' || trig.fn === 'sinh' ? W : grp(S)
    return withCoeff(f.coeff, `\\dfrac{${numer}}{${den}}`)
  }
  // t^n e^{a t}  →  n! / (s − a)^{n+1}
  const num = factorial(n)
  const den = n === 0 ? grp(S) : `${grp(S)}^{${n + 1}}`
  return withCoeff(f.coeff, `\\dfrac{${num}}{${den}}`)
}

export function laplaceSteps(p: ParsedFormula, v: string): string {
  const node = m.parse(p.body)
  const ts = terms(node)
  const lines: string[] = [`\\mathcal{L}\\left\\{${tex(node)}\\right\\}(s) = \\int_0^{\\infty} ${tex(node)}\\, e^{-s${v}}\\, d${v}`]
  const parts = ts.map((t) => ({ t, T: laplaceTerm(t, v) }))
  if (parts.some((x) => !x.T)) {
    const bad = parts.filter((x) => !x.T).map((x) => tex(x.t))
    lines.push(`\\text{Not in the Laplace table: } ${bad.join(',\\; ')}`)
    lines.push(`\\text{Supported: } c,\\; ${v}^n,\\; e^{a${v}},\\; \\sin/\\cos/\\sinh/\\cosh(\\omega ${v}),\\; \\text{and } e^{a${v}} \\text{ times those.}`)
    return lines.join(' \\\\[5pt] ')
  }
  if (ts.length > 1)
    for (const x of parts) lines.push(`\\mathcal{L}\\left\\{${tex(x.t)}\\right\\} = ${x.T}`)
  lines.push(`F(s) = ${parts.map((x) => x.T).join(' + ')}`)
  return lines.join(' \\\\[5pt] ')
}

/** Fourier of one term (LaTeX) under F(ω)=∫f e^{−iωt} dt, or null. */
function fourierTerm(term: MathNode, v: string): string | null {
  const f = factorTerm(m.simplify(term), v)
  if (!f) return null
  const core = f.factors.filter((g) => g.toString() !== '1')
  const C = f.coeff

  // constant
  if (core.length === 0) return withCoeff(C, `2\\pi\\,\\delta(\\omega)`)

  // causal signals: anything multiplied by the unit step u(t)
  const stepIdx = core.findIndex((g) => ['u', 'heaviside', 'step'].includes(fnName(g)))
  if (stepIdx >= 0) {
    const rest = core.filter((_, k) => k !== stepIdx)
    if (rest.length === 0) return withCoeff(C, `\\pi\\,\\delta(\\omega) + \\dfrac{1}{i\\omega}`)
    if (rest.length === 1) {
      const ea = expArg(rest[0], v)
      const a = ea && linearCoeff(ea, v)
      if (a) {
        // e^{a t} u(t) → 1/(iω − a)   (converges for Re a < 0)
        return withCoeff(C, `\\dfrac{1}{${shifted('i\\omega', a)}}`)
      }
    }
    return null
  }

  if (core.length === 1) {
    const g = core[0]
    // δ(t) → 1
    if (['delta', 'dirac'].includes(fnName(g))) return withCoeff(C, `1`)

    const name = fnName(g)
    const arg = fnArg(g)
    // cos(ω₀t), sin(ω₀t) → impulse pairs
    if ((name === 'cos' || name === 'sin') && arg) {
      const w = linearCoeff(arg, v)
      if (w) {
        const W = tex(w)
        return name === 'cos'
          ? withCoeff(C, `\\pi\\left[\\delta(\\omega - ${W}) + \\delta(\\omega + ${W})\\right]`)
          : withCoeff(C, `i\\pi\\left[\\delta(\\omega + ${W}) - \\delta(\\omega - ${W})\\right]`)
      }
    }

    const ea = expArg(g, v)
    if (ea) {
      // Gaussian e^{−a t²} → √(π/a) e^{−ω²/(4a)}
      const q = quadCoeff(ea, v)
      if (q) {
        const aNode = m.simplify(m.parse(`-(${q.toString()})`))
        const A = tex(aNode)
        const four = Number.isFinite(constVal(aNode))
          ? String(Number((4 * constVal(aNode)).toPrecision(6)))
          : `4${grp(A)}`
        return withCoeff(C, `\\sqrt{\\dfrac{\\pi}{${A}}}\\; e^{-\\omega^2 / ${four}}`)
      }
      // e^{i ω₀ t} → 2π δ(ω − ω₀)
      const lin = linearCoeff(ea, v)
      if (lin) {
        const s = lin.toString().replace(/\s/g, '')
        const im = /^i\*?(.*)$|^(.*)\*i$/.exec(s)
        if (im) {
          const w0 = (im[1] || im[2] || '1').replace(/^\*|\*$/g, '') || '1'
          return withCoeff(C, `2\\pi\\,\\delta(\\omega - ${tex(m.parse(w0))})`)
        }
      }
    }
    // e^{−a·|t|}: mathjs parses abs() inside exp — handled here
    const eaAbs = expArg(g, v)
    if (eaAbs) {
      const o = eaAbs as unknown as { type: string; op?: string; args?: MathNode[] }
      const factors =
        o.type === 'OperatorNode' && o.op === '*' && o.args?.length === 2 ? o.args : []
      const absF = factors.find((x) => fnName(x) === 'abs')
      const coefF = factors.find((x) => fnName(x) !== 'abs')
      if (absF && coefF && fnArg(absF)?.toString() === v && isConstIn(coefF, v)) {
        const aNode = m.simplify(m.parse(`-(${coefF.toString()})`))
        const A = tex(aNode)
        return withCoeff(C, `\\dfrac{2${grp(A)}}{${grp(A)}^2 + \\omega^2}`)
      }
    }
  }
  return null
}

export function fourierSteps(p: ParsedFormula, v: string): string {
  const node = m.parse(p.body)
  const ts = terms(node)
  const lines: string[] = [
    `\\mathcal{F}\\left\\{${tex(node)}\\right\\}(\\omega) = \\int_{-\\infty}^{\\infty} ${tex(node)}\\, e^{-i\\omega ${v}}\\, d${v}`,
  ]
  const parts = ts.map((t) => ({ t, T: fourierTerm(t, v) }))
  if (parts.some((x) => !x.T)) {
    const bad = parts.filter((x) => !x.T).map((x) => tex(x.t))
    lines.push(`\\text{Not in the Fourier table: } ${bad.join(',\\; ')}`)
    lines.push(
      `\\text{Supported: } c,\\; \\sin/\\cos(\\omega_0 ${v}),\\; e^{i\\omega_0 ${v}},\\; e^{-a${v}^2},\\; e^{-a\\,|${v}|},\\; \\delta(${v}),\\; \\text{and } f(${v})\\,u(${v}).`
    )
    return lines.join(' \\\\[5pt] ')
  }
  if (ts.length > 1)
    for (const x of parts) lines.push(`\\mathcal{F}\\left\\{${tex(x.t)}\\right\\} = ${x.T}`)
  lines.push(`F(\\omega) = ${parts.map((x) => x.T).join(' + ')}`)
  return lines.join(' \\\\[5pt] ')
}
