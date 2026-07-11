# SIMBLIP — Formula Engine

## Purpose

Every numeric parameter in SIMBLIP accepts a **number, a variable, or an expression**:

```
m = density * volume
g = 9.81
F = m * g
velocity = sqrt(2 * g * h)
```

Changing one variable updates the entire page — object parameters, running simulations, graphs.

## Design

Built on **mathjs** (parse + evaluate), wrapped in `lib/formula/engine.ts`:

1. **Page scope**: variables are global to a page (spec requirement). Each variable is
   `{ name, expr, value, error? }`.
2. **Dependency graph**: each expression is parsed once; `SymbolNode`s give its dependencies.
   We topologically sort variables and evaluate in order. Why: naive re-evaluation order makes
   `F = m*g` fail if `m` is defined "below" it; topo sort makes definition order irrelevant,
   like a spreadsheet.
3. **Cycle detection**: cycles (`a = b`, `b = a`) mark all members with an error instead of
   hanging — errors are data, shown inline in the Variables panel, never thrown to the UI.
4. **Object parameters** store `{ expr: string, value: number }`. The cached `value` is what
   renderers/physics read; re-evaluation happens on variable change or expression edit, not per
   frame render.
5. **Constants**: `pi`, `e`, `g` fallback etc. resolve via mathjs; user variables shadow them.

## Why mathjs (and not a custom parser)

Units, matrices, complex numbers and symbolic derivatives are on the roadmap (circuits need
complex impedance; "show derivation" needs symbolic steps). mathjs covers this trajectory;
a hand-rolled parser would be rewritten within two modules.

## Calculus

Expressions anywhere (variables, parameters, graph formulas, behaviors) support:

| Syntax | Meaning |
| --- | --- |
| `derivative(f, x)` / `diff(f, x)` | symbolic derivative of `f` wrt `x`, evaluated at the current `x` |
| `derivative(f, x, n)` | n-th derivative |
| `integral(f, x)` / `integrate(...)` / `antiderivative(...)` | numeric antiderivative ∫₀ˣ `f` |
| `integral(f, x, a)` | ∫ₐˣ `f` |
| `integral(f, x, a, b)` | definite ∫ₐᵇ `f` (bounds may be expressions) |

Differentiating or integrating wrt one variable of a multi-variable expression treats the other
symbols as constants — i.e. **partial** derivatives/antiderivatives come for free
(`derivative(x^2*y^3, y)`, `integral(x*y, y, 0, 3)`). On a graph with no series bound, use the
X-axis channel as the sweep variable to plot `f'` or `∫f` as a function.

Implementation: mathjs's `derivative`/`simplify` stay **disabled at eval time** (see Security);
instead `rewriteCalculus` in `lib/formula/engine.ts` rewrites the parsed tree at compile time.
Derivatives are substituted symbolically (via the captured pre-sandbox `math.derivative`);
integrals become generated `__intN` scope closures that run composite Simpson's rule (64
intervals) with the ambient scope's other variables held fixed. Nested integrals work (cost
multiplies); a symbolic derivative *of* an integral does not — it fails like a parse error and
the fallback value applies.

## Failure behavior

An invalid expression keeps the **last good value** and carries an `error` string. Rationale: a
running simulation must not explode because the user is mid-keystroke in `sqrt(2*g*`.

## Security

`math.evaluate` is used with a restricted scope object; no access to `import`, `createUnit` or
JS globals from user expressions (mathjs's expression sandbox, plus we strip dangerous symbols).
