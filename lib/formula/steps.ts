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
  const main = text.split(',')[0]
  const mm = /^\s*([a-zA-Z]\w*)\s*\(\s*([a-zA-Z]\w*(?:\s*,\s*[a-zA-Z]\w*)*)\s*\)\s*=\s*(.+)$/.exec(main)
  if (!mm) return null
  const bounds: Record<string, [number, number]> = {}
  for (const bm of text.matchAll(/(-?\d+(?:\.\d+)?)\s*<\s*([a-zA-Z]\w*)\s*<\s*(-?\d+(?:\.\d+)?)/g))
    bounds[bm[2]] = [Number(bm[1]), Number(bm[3])]
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
      try {
        const val = (Fb.compile().evaluate({}) as number) - (Fa.compile().evaluate({}) as number)
        if (Number.isFinite(val)) lines.push(`= ${Number(val.toPrecision(6))}`)
      } catch {
        /* other symbols remain — symbolic answer above is the result */
      }
    }
  } else if (b) {
    // No closed form — composite Simpson over the given bounds.
    try {
      const c = node.compile()
      const S = 64
      const h = (b[1] - b[0]) / S
      let sum = 0
      for (let i = 0; i <= S; i++) {
        const y = c.evaluate({ [v]: b[0] + i * h }) as number
        if (typeof y !== 'number' || !Number.isFinite(y)) throw new Error('nan')
        sum += i === 0 || i === S ? y : i % 2 ? 4 * y : 2 * y
      }
      lines.push(`\\approx ${Number(((sum * h) / 3).toPrecision(6))}\\;\\text{(numeric)}`)
    } catch {
      lines.push(`\\text{numeric evaluation needs values for the other variables}`)
    }
  } else {
    lines.push(`\\text{no closed form found — add bounds (e.g. } 0<${v}<1\\text{) for a numeric result}`)
  }
  return lines.join(' \\\\[5pt] ')
}
