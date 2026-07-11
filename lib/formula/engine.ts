// Formula engine: page-scoped variables with spreadsheet semantics.
// Definition order is irrelevant — a dependency graph is built from parsed
// expressions and solved in topological order. Cycles become inline errors,
// never exceptions (see docs/formula-engine.md).

import {
  create,
  all,
  type MathNode,
  type EvalFunction,
  type FunctionNode,
  type SymbolNode,
  type ConstantNode,
} from 'mathjs'
import type { Variable } from '@/lib/scene/types'

const math = create(all, { matrix: 'Array' })

// Capture the real parser (and symbolic differentiator, used only by our own
// compile-time rewrite below), then disable security-relevant functions so
// user expressions can't reach them (mathjs's documented sandbox hardening).
const parse = math.parse.bind(math)
const symbolicDerivative = math.derivative.bind(math)
try {
  math.import(
    {
      import: () => { throw new Error('import is not allowed') },
      createUnit: () => { throw new Error('createUnit is not allowed') },
      evaluate: () => { throw new Error('evaluate is not allowed') },
      parse: () => { throw new Error('parse is not allowed') },
      simplify: () => { throw new Error('simplify is not allowed') },
      derivative: () => { throw new Error('derivative is not allowed') },
    },
    { override: true }
  )
} catch {
  /* restriction already applied */
}

export type Scope = Record<string, number>

function dependenciesOf(node: MathNode): string[] {
  const deps: string[] = []
  node.traverse((n) => {
    if (n.type === 'SymbolNode') deps.push((n as unknown as { name: string }).name)
  })
  return deps
}

// ---------------------------------------------------------------------------
// Calculus. `derivative`/`simplify` stay disabled in the eval sandbox above;
// instead calculus calls are rewritten out of the parsed tree at compile time:
//   derivative(f, x [, n])  → symbolic n-th derivative of f wrt x
//   integral(f, x)          → numeric antiderivative ∫₀ˣ f  (Simpson's rule)
//   integral(f, x, a)       → ∫ₐˣ f
//   integral(f, x, a, b)    → definite ∫ₐᵇ f
// Aliases: diff ≡ derivative; integrate/antiderivative ≡ integral.
// Differentiating or integrating wrt one variable of a multi-variable
// expression treats the other symbols as constants, so partial derivatives
// and partial antiderivatives come for free — the "partial" variable just
// has to be bound elsewhere (page variable, channel, or the graph's x sweep).

interface IntegralSpec {
  name: string // injected scope function, e.g. "__int0"
  varName: string // integration variable
  f: EvalFunction // compiled integrand
  deps: string[] // free symbols of the integrand (integration var excluded)
}

const DERIV_FNS = new Set(['derivative', 'diff'])
const INT_FNS = new Set(['integral', 'integrate', 'antiderivative'])
const INT_STEPS = 64 // Simpson intervals per integral evaluation (must be even)

/** Replace calculus calls bottom-up. Integrals become calls to generated
 * `__intN` scope functions; their specs accumulate in `ints`. Throws on
 * malformed calls so the error surfaces like a parse error. */
function rewriteCalculus(node: MathNode, ints: IntegralSpec[]): MathNode {
  const mapped = node.map((child) => rewriteCalculus(child, ints))
  if (mapped.type !== 'FunctionNode') return mapped
  const call = mapped as FunctionNode
  const name = 'name' in call.fn ? String((call.fn as SymbolNode).name) : ''
  if (!DERIV_FNS.has(name) && !INT_FNS.has(name)) return mapped
  const [f, v] = call.args
  if (!f || v?.type !== 'SymbolNode') {
    throw new Error(`${name}(expr, variable, …) needs a variable as its 2nd argument`)
  }
  const varName = (v as SymbolNode).name
  if (DERIV_FNS.has(name)) {
    if (call.args.length > 3) throw new Error(`${name}() takes at most 3 arguments`)
    let order = 1
    const ord = call.args[2]
    if (ord) {
      const val = ord.type === 'ConstantNode' ? (ord as ConstantNode).value : NaN
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
        throw new Error(`${name}() order must be a positive integer`)
      }
      order = val
    }
    let out: MathNode = f
    for (let i = 0; i < order; i++) out = symbolicDerivative(out, varName)
    return out
  }
  if (call.args.length > 4) throw new Error(`${name}() takes at most 4 arguments`)
  const spec: IntegralSpec = {
    name: `__int${ints.length}`,
    varName,
    f: f.compile(),
    deps: [...new Set(dependenciesOf(f))].filter((d) => d !== varName && !d.startsWith('__int')),
  }
  ints.push(spec)
  const lower = call.args[2] ?? new math.ConstantNode(0)
  const upper = call.args[3] ?? new math.SymbolNode(varName)
  return new math.FunctionNode(spec.name, [lower, upper])
}

/** Composite Simpson's rule. Integrand errors surface as NaN, never throws. */
function numericIntegral(
  spec: IntegralSpec,
  lo: number,
  hi: number,
  ambient: Record<string, unknown>
): number {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return NaN
  if (lo === hi) return 0
  const h = (hi - lo) / INT_STEPS
  const s = { ...ambient }
  let sum = 0
  for (let i = 0; i <= INT_STEPS; i++) {
    s[spec.varName] = lo + h * i
    let y: unknown
    try {
      y = spec.f.evaluate(s)
    } catch {
      return NaN
    }
    if (typeof y !== 'number' || !Number.isFinite(y)) return NaN
    sum += i === 0 || i === INT_STEPS ? y : i % 2 ? 4 * y : 2 * y
  }
  return (sum * h) / 3
}

/** Scope copy carrying the numeric-integral closures the rewritten tree
 * calls. Closures capture the merged object so nested integrals resolve. */
function withCalculus(ints: IntegralSpec[], scope: Scope): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...scope }
  for (const spec of ints) {
    merged[spec.name] = (lo: number, hi: number) => numericIntegral(spec, lo, hi, merged)
  }
  return merged
}

/** Free symbols of a rewritten tree plus its integrands' (for dependency
 * checks) — generated `__intN` names excluded. */
function freeDependencies(node: MathNode, ints: IntegralSpec[]): string[] {
  const free = new Set(dependenciesOf(node).filter((d) => !d.startsWith('__int')))
  for (const spec of ints) for (const d of spec.deps) free.add(d)
  return [...free]
}

function isBuiltin(name: string): boolean {
  try {
    const v = (math as unknown as Record<string, unknown>)[name]
    return typeof v === 'function' || typeof v === 'number' || name === 'pi' || name === 'e'
  } catch {
    return false
  }
}

/**
 * Evaluate all page variables. Returns new variable array (with values/errors)
 * plus the resolved numeric scope for parameter evaluation.
 */
export function solveScope(variables: Variable[]): { variables: Variable[]; scope: Scope } {
  const parsed = new Map<
    string,
    { node?: MathNode; ints: IntegralSpec[]; deps: string[]; error?: string }
  >()

  for (const v of variables) {
    try {
      const ints: IntegralSpec[] = []
      const node = rewriteCalculus(parse(v.expr), ints)
      const deps = freeDependencies(node, ints).filter(
        (d) => variables.some((o) => o.name === d) // only user vars form graph edges
      )
      parsed.set(v.name, { node, ints, deps })
    } catch (e) {
      parsed.set(v.name, { ints: [], deps: [], error: e instanceof Error ? e.message : 'Parse error' })
    }
  }

  // Topological sort (Kahn). Unresolved nodes are cycle members.
  const order: string[] = []
  const remaining = new Set(parsed.keys())
  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) =>
      parsed.get(name)!.deps.every((d) => !remaining.has(d))
    )
    if (ready.length === 0) break // cycle
    for (const name of ready) {
      order.push(name)
      remaining.delete(name)
    }
  }

  const scope: Scope = {}
  const out = variables.map((v) => ({ ...v }))
  const byName = new Map(out.map((v) => [v.name, v]))

  for (const name of order) {
    const v = byName.get(name)!
    const p = parsed.get(name)!
    if (p.error || !p.node) {
      v.error = p.error ?? 'Parse error'
      continue
    }
    try {
      const result = p.node.evaluate(withCalculus(p.ints, scope))
      if (typeof result !== 'number' || !Number.isFinite(result)) {
        v.error = 'Not a finite number'
      } else {
        v.value = result
        v.error = undefined
        scope[name] = result
      }
    } catch (e) {
      v.error = e instanceof Error ? e.message : 'Evaluation error'
    }
  }

  for (const name of remaining) {
    const v = byName.get(name)
    if (v) v.error = 'Circular reference'
  }

  return { variables: out, scope }
}

/**
 * Evaluate one expression against a scope. Invalid input returns the fallback —
 * a running simulation must not explode mid-keystroke.
 */
export function evalExpr(
  expr: string,
  scope: Scope,
  fallback = 0
): { value: number; error?: string } {
  try {
    const ints: IntegralSpec[] = []
    const node = rewriteCalculus(parse(expr), ints)
    // Reject unknown symbols early so typos surface as errors, not NaN physics.
    for (const dep of freeDependencies(node, ints)) {
      if (!(dep in scope) && !isBuiltin(dep)) {
        return { value: fallback, error: `Unknown variable "${dep}"` }
      }
    }
    const result = node.evaluate(withCalculus(ints, scope))
    if (typeof result !== 'number' || !Number.isFinite(result)) {
      return { value: fallback, error: 'Not a finite number' }
    }
    return { value: result }
  } catch (e) {
    return { value: fallback, error: e instanceof Error ? e.message : 'Invalid expression' }
  }
}

/**
 * Compile an expression once for per-frame evaluation (Play mode evaluates
 * behavior expressions every frame; parsing each frame would melt the budget).
 * The returned function is error-safe and falls back to the last good value.
 */
export function compileExpr(expr: string, fallback = 0): (scope: Scope) => number {
  let last = fallback
  try {
    const ints: IntegralSpec[] = []
    const compiled = rewriteCalculus(parse(expr), ints).compile()
    return (scope: Scope) => {
      try {
        const v = compiled.evaluate(withCalculus(ints, scope))
        if (typeof v === 'number' && Number.isFinite(v)) last = v
        return last
      } catch {
        return last
      }
    }
  } catch {
    return () => last
  }
}
