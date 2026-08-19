// Making the numbers in an answer true.
//
// The explain lane gets the PHYSICS right and the ARITHMETIC wrong. Measured
// on five course numericals with independently verified answers, the local
// 7B produced: H = 8.73 A/m (truth 5.69), then 100 A/m for the same question
// on a re-run, and one answer that concluded a DC motor's back EMF was
// "negative, which is not physically possible" — from a substitution it had
// itself written correctly one line above.
//
// The failure is not knowledge. In every case the model selected the right
// formula and substituted the right values; it then PREDICTED the digits of
// the result instead of computing them. That is what a language model does
// to "0.025 / 0.004394 =" — it emits plausible-looking digits. Re-running
// gives different ones, so no amount of prompting fixes it: at temperature
// 0.2 the same question yielded 8.73, then 100.
//
// So do not ask the model to be a calculator. Ask it to show its substitution
// — which it already does, and does correctly — and then evaluate that
// substitution with mathjs, the same hardened evaluator the notebook's own
// formula engine uses (lib/formula/engine.ts). Arithmetic becomes exact and
// deterministic; the model keeps the part it is good at.
//
// This corrects only what it can PROVE wrong: an expression that evaluates
// cleanly and disagrees with the stated result. Anything unparseable, or
// symbolic, or already correct, is left exactly as written — a checker that
// guesses is worse than none.

import { evalExpr } from '@/lib/formula/engine'

/** Relative tolerance for "the model's digits agree with the true value".
 *  Generous on purpose: a student writing 5.69 for 5.6857 has not made an
 *  error, and rewriting correctly-rounded work as a "correction" would be
 *  noise. Only a real arithmetic mistake clears this bar. */
const REL_TOL = 0.005

/** Lines of the form "… = <number> <maybe unit>" — a substitution the model
 *  has already completed. The left side is what we recompute.
 *
 *  Anchored on the LAST '=' so a chain "E = V - I*R = 250 - 11.5 = 238.5"
 *  checks the final arithmetic step, which is the one that produces the
 *  answer and the one that goes wrong. */
const TRAILING_RESULT_RE =
  /^(.*)=\s*\\?[$]?\s*([-+]?\d[\d,]*\.?\d*(?:\s*(?:[eE]|\\times\s*10\^)[-+]?\{?\d+\}?)?)\s*(.*)$/

/** Strip the notation a model writes but mathjs cannot read. Deliberately
 *  conservative: anything left unrecognised makes the line unparseable, and
 *  an unparseable line is skipped rather than guessed at. */
function toExpression(raw: string): string {
  let s = raw

  // LaTeX wrappers and inline-maths delimiters.
  s = s.replace(/\$/g, '')
  s = s.replace(/\\left|\\right/g, '')
  s = s.replace(/\\times|\\cdot/g, '*')
  s = s.replace(/\\div/g, '/')
  // Superscripts first: x^{2} -> x^(2). A brace group left inside a \frac
  // body would stop the brace-free [^{}]* body below from matching it.
  s = s.replace(/\^\s*\{([^{}]*)\}/g, '^($1)')

  // \frac{a}{b} -> (a)/(b), also \dfrac/\tfrac. Applied repeatedly so the
  // inner braces of a nested fraction resolve from the inside out; the
  // {[^{}]*} body deliberately matches only a brace-free innermost pair.
  for (let i = 0; i < 4; i++) {
    const before = s
    s = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))')
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
    if (s === before) break
  }
  // \text{...} and \mathrm{...} carry units, not maths.
  s = s.replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{[^{}]*\}/g, ' ')

  s = s.replace(/²/g, '^2').replace(/³/g, '^3')
  s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
  // π is a mathjs builtin under its ASCII name.
  s = s.replace(/π/g, 'pi')
  // Thousands separators: 1,234.5 -> 1234.5 (only between digits, so a real
  // argument list is untouched).
  s = s.replace(/(\d),(\d{3})\b/g, '$1$2')
  // A trailing unit or stray backslash command is not part of the arithmetic.
  s = s.replace(/\\[a-zA-Z]+/g, ' ')

  return s.trim()
}

/** Does this look like arithmetic we can actually check — digits and
 *  operators, no leftover symbols standing for unknowns?
 *
 *  A purely symbolic step ("E_b = V - I_a R_a") is correct as written and
 *  must be left alone; evalExpr would reject it anyway for unknown symbols,
 *  but rejecting it here keeps the intent explicit. */
function isCheckableArithmetic(expr: string): boolean {
  if (!/\d/.test(expr)) return false
  if (!/[-+*/^]/.test(expr)) return false // a bare restatement, nothing to compute
  // Any alphabetic run that is not a known function name means an unresolved
  // symbol — a variable the model never substituted.
  const words = expr.match(/[a-zA-Z_]+/g) ?? []
  const allowed = new Set(['sqrt', 'pi', 'e', 'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'abs'])
  return words.every((w) => allowed.has(w.toLowerCase()))
}

/** Format a corrected value the way the model wrote the one it replaces, so
 *  a fix reads as part of the answer rather than a machine's interjection. */
function formatLike(value: number, original: string): string {
  const dot = original.indexOf('.')
  const dp = dot === -1 ? 0 : original.length - dot - 1
  // Very large or small magnitudes read better in exponential form.
  if (value !== 0 && (Math.abs(value) >= 1e6 || Math.abs(value) < 1e-4)) {
    return value.toExponential(Math.min(Math.max(dp, 2), 6))
  }
  const fixed = value.toFixed(Math.min(Math.max(dp, 2), 6))
  // Trim trailing zeros we introduced, but never past the original precision.
  return dp === 0 ? String(Number(fixed)) : fixed
}

export interface ArithmeticFix {
  /** The line as the model wrote it. */
  line: string
  /** The expression that was evaluated. */
  expression: string
  /** What the model claimed. */
  claimed: number
  /** What the arithmetic actually gives. */
  actual: number
}

export interface CheckedAnswer {
  markdown: string
  fixes: ArithmeticFix[]
}

/**
 * Recompute every completed substitution in an answer and correct the ones
 * that are demonstrably wrong.
 *
 * Conservative by construction — a line is corrected only when ALL of:
 *   • it ends in "= <number>", so the model has committed to a result;
 *   • the left side parses as pure arithmetic with no unresolved symbols;
 *   • it evaluates to a finite number;
 *   • that number disagrees with the claim by more than rounding.
 *
 * Everything else passes through untouched. The cost of a missed error is a
 * wrong answer the model would have given anyway; the cost of a bad
 * "correction" is corrupting work that was right — so the bar is set to make
 * the second impossible.
 */
export function checkArithmetic(markdown: string): CheckedAnswer {
  const fixes: ArithmeticFix[] = []

  const lines = markdown.split('\n').map((line) => {
    const m = TRAILING_RESULT_RE.exec(line)
    if (!m) return line

    const [, lhsRaw, claimedRaw] = m
    const claimed = Number(claimedRaw.replace(/,/g, ''))
    if (!Number.isFinite(claimed)) return line

    // Take only the final segment of the chain. A worked line reads
    // "H = <formula> = <substitution> = 8.73": the named quantity and the
    // symbolic form are not arithmetic, and keeping them would make every
    // line fail the unresolved-symbol check. The substitution immediately
    // before the claimed result is the step that was actually computed.
    const segments = lhsRaw.split('=')
    const expr = toExpression(segments[segments.length - 1])
    if (!isCheckableArithmetic(expr)) return line

    // Evaluate against an empty scope: anything needing a variable is not a
    // completed substitution and was already filtered above.
    const { value, error } = evalExpr(expr, {})
    if (error || !Number.isFinite(value)) return line

    // Agreement is relative, with an absolute floor so values near zero do
    // not trip on their own noise.
    const tol = Math.max(Math.abs(value) * REL_TOL, 1e-9)
    if (Math.abs(value - claimed) <= tol) return line

    fixes.push({ line, expression: expr, claimed, actual: value })
    // Swap only the claimed number, keeping the unit and any surrounding
    // notation exactly as written. lastIndexOf, because the number we are
    // replacing is the trailing one the regex captured — an earlier
    // occurrence of the same digits belongs to the substitution itself.
    const corrected = formatLike(value, claimedRaw)
    const at = line.lastIndexOf(claimedRaw)
    return line.slice(0, at) + corrected + line.slice(at + claimedRaw.length)
  })

  return { markdown: lines.join('\n'), fixes }
}
