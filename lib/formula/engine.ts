// Formula engine: page-scoped variables with spreadsheet semantics.
// Definition order is irrelevant — a dependency graph is built from parsed
// expressions and solved in topological order. Cycles become inline errors,
// never exceptions (see docs/formula-engine.md).

import { create, all, type MathNode } from 'mathjs'
import type { Variable } from '@/lib/scene/types'

const math = create(all, { matrix: 'Array' })

// Capture the real parser, then disable security-relevant functions so user
// expressions can't reach them (mathjs's documented sandbox hardening).
const parse = math.parse.bind(math)
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
  const parsed = new Map<string, { node?: MathNode; deps: string[]; error?: string }>()

  for (const v of variables) {
    try {
      const node = parse(v.expr)
      const deps = dependenciesOf(node).filter(
        (d) => variables.some((o) => o.name === d) // only user vars form graph edges
      )
      parsed.set(v.name, { node, deps })
    } catch (e) {
      parsed.set(v.name, { deps: [], error: e instanceof Error ? e.message : 'Parse error' })
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
      const result = p.node.evaluate({ ...scope })
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
    const node = parse(expr)
    // Reject unknown symbols early so typos surface as errors, not NaN physics.
    for (const dep of dependenciesOf(node)) {
      if (!(dep in scope) && !isBuiltin(dep)) {
        return { value: fallback, error: `Unknown variable "${dep}"` }
      }
    }
    const result = node.evaluate({ ...scope })
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
    const compiled = parse(expr).compile()
    return (scope: Scope) => {
      try {
        const v = compiled.evaluate({ ...scope })
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
