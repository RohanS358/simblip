# AI decisions log

## 2026-10-18 — Sketch Model, Phase S0 (IR + compiler + gold tests)
- `lib/sketch/ir.ts` (zod Scene IR, plan Appendix A), `lib/sketch/compile.ts` (IR → SimScript, no model), `lib/sketch/units.ts` ("10 kΩ" → 10000).
- Circuit/digital emit `create()`/`connect()` with no x/y (auto-layout draws it). Mechanics/optics emit x/y from bboxes and wrap in a fitted `system` (the linter requires one).
- Pins that are not valid JS members (`in+`, `v-`, `ctrl+`) compile to their identifier aliases (`inp`, `vminus`, `ctrlp`).
- A battery with no written voltage compiles with the default and a doubt, so the ghost preview asks.
- Classes with no component (e.g. `incline`, `pulley`) are reported as errors, never invented.
- 40 gold IR in `scripts/ai/sketch/gold/` (regenerate: `node scripts/ai/sketch/make-gold.mjs`): all compile, lint clean, and execute in the real runtime (`lib/sketch/*.test.mjs`, part of `npm run test:ai`).
- Still open (Rohan's): symbol taxonomy/standards, data-collection session, dataset licences (none verified — nothing may be trained on third-party data until written here).
