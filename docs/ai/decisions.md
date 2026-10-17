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

## 2026-10-17 — Sketch Phase S1: synthetic-first data, real data kept separate

- **Priority change (Rohan):** the collection session is not a blocker. Build and
  evaluate on synthetic data first; `/train` stays the way to collect real
  sketches later.
- **Audience:** engineering students; ANSI zigzag resistor and ANSI/US curved
  gates; devices mouse/touchpad > finger > pen. Writer mix in the generator is
  40 % mouse, 30 % touchpad, 25 % finger, 5 % pen.
- **Wave-1 classes (21 + unknown):** battery resistor capacitor inductor switch
  bulb led diode gnd ac-source voltmeter ammeter and/or/xor/nand/nor/not-gate
  bjt mosfet opamp. `lib/sketch/classes.ts`; every id is checked against
  `KNOWN_KINDS` in the tests. Resistor, capacitor, inductor, bulb, ac-source and
  the meters are 180°-symmetric, so their pose labels fold (0/90 only).
- **Glyphs are hand-authored stroke skeletons** (`lib/sketch/glyphs.ts`), not
  extracted from `part-art.tsx`: that file returns JSX, and a rendered symbol is
  not how a hand draws (pen lifts between lead and body). Deviation from the
  plan's §5.1 wording; the plan's intent (class shapes → strokes, with variants)
  is kept.
- **One record format for every source** (`lib/sketch/dataset.ts`): `source` is
  `synthetic | synthetic-negative | real | public`. Training reads any mix;
  **every metric is reported per source** (`groupOf` in
  `scripts/ai/sketch/dataset.mjs`). A synthetic number is never pooled with, or
  quoted as, a real one. Real shards are just another directory of
  `*.jsonl.gz` — no pipeline change.
- **Splits are by writer** even for synthetic data (70/15/15 of simulated
  writers), and `iterDir` checks each shard against `MANIFEST.json`.
- **Data lives in `data/sketch/` (git-ignored).** Regenerate with
  `npm run sketch:synth -- --seed 1 --writers 500 --reps 18` (207,000 samples,
  ~100 MB, ~70 s). Look at it with `npm run sketch:preview`.
- **Collection data must NOT go into `simblip_sketch_templates`.** That table
  feeds every user's live matcher and stores the contributor's full name. The
  guided `/train` mode will write to a separate table with an anonymous writer
  code and a consent version; nothing is uploaded without explicit consent
  (`docs/ai/sketch-consent.md`, draft).
- **Baseline (SYNTHETIC only):** the existing feature + CART recogniser scores
  55.3 % top-1 / 73.9 % top-3 on 31,050 samples from 75 unseen synthetic writers
  (trained on ≤100 samples/class). Weakest: gates with bubbles/curves, meters,
  ac-source, bjt. This is a baseline for SketchNet on the synthetic world only;
  the **real-world baseline does not exist yet** and the report says so.
  The $P template matcher is not included (it lives behind the cloud store);
  add it when real data exists.
- **Open:** the generator's realism is unverified against real strokes. Look at
  the contact sheet; weight real data heavily as soon as any exists.
