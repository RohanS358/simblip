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

## Failure behavior

An invalid expression keeps the **last good value** and carries an `error` string. Rationale: a
running simulation must not explode because the user is mid-keystroke in `sqrt(2*g*`.

## Security

`math.evaluate` is used with a restricted scope object; no access to `import`, `createUnit` or
JS globals from user expressions (mathjs's expression sandbox, plus we strip dangerous symbols).
