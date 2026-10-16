# AI decisions log

Append-only. One entry per decision, newest last. Source plan: *SIMBLIP AI Plan,
Document 2 — The Sketch Model* (10 Oct 2026).

## 2026-10-16 — Sketch Phase S0: IR, compiler, gold set

- **Scene IR** lives in `lib/sketch/ir.ts` (zod), exactly as Appendix A.
- **Compiler** (`lib/sketch/compile.ts`) handles `circuit` and `digital`. Other
  domains return an `unsupported-domain` error until Phase S4 — never a guess.
- **No x/y in auto mode.** The sketch only has to be topologically right; the
  schematic layout draws it. `layout: 'keep'` places by bbox + pose instead.
- **Pins are validated against `ANCHOR_INDEX`** (the same table the SimScript
  linter reads), not a second copy. Pins that are not JS identifiers (`in+`,
  `ctrl-`, `secondary+` …) are emitted as the alias the runtime resolves.
- **Every emitted script is run through `lintSimScript`.** A lint failure is
  reported as a compiler bug (`code: 'lint'`), never blamed on the IR.
- **Doubts the compiler adds:** battery with no readable voltage (defaults to
  9 V — the one default we allow); any value that cannot be parsed
  (`unreadable-value`); node confidence < 0.6 (`low-confidence`); edge
  confidence < 0.6 (`ambiguous-junction`).
- **Values:** `values` keys must be parameters the part actually has
  (`PARAMS` in compile.ts, from `simscript-component-reference.md`). A bare label
  beside a part fills its main parameter only if its unit (if any) agrees.
- **Gold set:** 44 IR files in `scripts/ai/sketch/gold/`, generated from compact
  netlists by `build-gold.mjs` (re-run it after editing; commit the JSON).
  Each carries numeric `expect`ations that the *real* circuit engine must meet.
- **Exit test:** `node --experimental-strip-types --test lib/sketch/compile.test.mjs`
  (also in `npm run test:ai`). Asserts compile < 20 ms, lint clean, one scene
  part per node, one wire per edge, finite readings, and expectations.
- **No feature flag in S0:** nothing user-visible changed. Flags start in S2
  (SketchNet in the pen+hold path).
- **Open:** pin ↔ pose mapping for `layout: 'keep'` is not derived from
  `terminalsOf()` yet — rotation is passed through. Revisit with Phase S3's ghost UI.
