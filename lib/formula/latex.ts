// LaTeX → formula-engine expression.
//
// A Formula card stores LaTeX because that is what renders. Everything that
// wants a NUMBER out of it — the graph, page variables, the Variables panel —
// needs the same string as an expression instead. This is the one converter.
//
// Best effort by design: it returns null rather than handing the engine
// something that parses but means something else. Anything with an integral,
// a sum or a matrix in it has no scalar reading at all, so it bails early.

import { parse } from 'mathjs'

/** Commands with no scalar meaning — converting these would invent maths. */
const UNSUPPORTED = /\\(int|iint|oint|sum|prod|lim|begin|partial|nabla|infty)(?![a-zA-Z])/

/** \ln is natural log (mathjs `log`); \log is base 10. */
const FUNC_MAP: Record<string, string> = { ln: 'log', log: 'log10', arcsin: 'asin', arccos: 'acos', arctan: 'atan' }

/** Contents of the {...} group opening at `open`, and the index after it. */
function group(src: string, open: number): { body: string; end: number } | null {
  if (src[open] !== '{') return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 }
    }
  }
  return null
}

/** Skip spaces from `i`. */
const skipWs = (s: string, i: number) => {
  while (s[i] === ' ') i++
  return i
}

/**
 * Expand the commands that take brace arguments. Runs innermost-first by
 * recursing into each argument, so \frac{\frac{a}{b}}{c} comes out right.
 */
function expandArgs(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const m = /^\\([a-zA-Z]+)/.exec(src.slice(i))
    if (!m) {
      out += src[i++]
      continue
    }
    const cmd = m[1]
    let j = skipWs(src, i + m[0].length)

    const arg = () => {
      const g = group(src, j)
      if (!g) return null
      j = skipWs(src, g.end)
      return expandArgs(g.body)
    }

    if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
      const a = arg(), b = a === null ? null : arg()
      if (a !== null && b !== null) { out += `((${a})/(${b}))`; i = j; continue }
    } else if (cmd === 'sqrt') {
      let n: string | null = null
      if (src[j] === '[') {
        const close = src.indexOf(']', j)
        if (close > 0) { n = expandArgs(src.slice(j + 1, close)); j = skipWs(src, close + 1) }
      }
      const a = arg()
      if (a !== null) { out += n ? `nthRoot((${a}),(${n}))` : `sqrt(${a})`; i = j; continue }
    } else if (['text', 'mathrm', 'mathbf', 'mathit', 'operatorname', 'vec', 'hat', 'bar', 'overline', 'mathcal', 'boldsymbol'].includes(cmd)) {
      const a = arg()
      if (a !== null) { out += a; i = j; continue }
    }

    out += m[0]
    i += m[0].length
  }
  return out
}

export interface LatexExpr {
  /** Left-hand side, when the LaTeX is a definition ("E = \frac{...}"). */
  name?: string
  /** The right-hand side as a formula-engine expression. */
  expr: string
}

/**
 * Convert a LaTeX formula to an expression the formula engine can evaluate.
 * Returns null when the result would not parse — the caller should then leave
 * the formula as presentation-only rather than plot nonsense.
 */
export function latexToExpr(latex: string): LatexExpr | null {
  let s = (latex ?? '').trim()
  if (!s || UNSUPPORTED.test(s)) return null

  s = s
    .replace(/\$+/g, ' ')
    .replace(/\\left|\\right|\\displaystyle|\\limits|\\,|\\;|\\:|\\!|\\quad|\\qquad/g, ' ')
    .replace(/\\\\/g, ' ')

  s = expandArgs(s)

  s = s
    .replace(/\\(?:cdot|times|ast)\b/g, '*')
    .replace(/\\div\b/g, '/')
    .replace(/\\(?:le|leq)\b/g, '<=')
    .replace(/\\(?:ge|geq)\b/g, '>=')
    // Everything still backslashed is a name: a Greek letter, a function, a
    // constant. Strip the backslash; map the few whose meaning differs.
    .replace(/\\([a-zA-Z]+)/g, (_, w: string) => FUNC_MAP[w] ?? w)
    // |x| is the only bracket pair LaTeX overloads — mathjs spells it abs().
    .replace(/\|([^|]+)\|/g, 'abs($1)')
    .replace(/\^\s*\{([^{}]*)\}/g, '^($1)')
    .replace(/_\s*\{([^{}]*)\}/g, (_, w: string) => `_${w.replace(/[^0-9a-zA-Z]/g, '')}`)
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    .replace(/\s+/g, ' ')
    .trim()

  // A definition ("E = ..."): the left side names it, the right side is the
  // expression. Comparisons are not definitions.
  let name: string | undefined
  const eq = s.indexOf('=')
  if (eq > 0 && !/[<>=!]/.test(s[eq - 1]) && s[eq + 1] !== '=') {
    const lhs = s.slice(0, eq).trim()
    if (/^[a-zA-Z][0-9a-zA-Z_]*$/.test(lhs)) {
      name = lhs
      s = s.slice(eq + 1).trim()
    }
  }
  if (!s || s.includes('=')) return null

  try {
    parse(s)
  } catch {
    return null
  }
  return name ? { name, expr: s } : { expr: s }
}
