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

## 2026-10-18 — Sketch Phase S2: SketchNet v1

- **Model:** 116,570 parameters — four Conv-BN-ReLU-Pool blocks on a 2×32×32 image
  (whole drawing + lead-stripped body), a 64-unit GRU on 64 resampled stroke
  points (x, y, penUp, turn), a 128-unit class head (21 classes + `unknown`) and a
  4-way pose head. Label smoothing 0.05, pose loss 0.5, AdamW + one-cycle, 30
  epochs (~2.5 min on the RTX 4060). Class temperature fitted on the VALIDATION
  split and folded into the class head, so `softmax(logits)` is calibrated.
- **Preprocessing exists once, in TypeScript** (`lib/sketch/preprocess.ts`). The
  exporter runs it over the shards and Python only reads the resulting tensors —
  no Python port of `normalizeStrokes`/`stripLeads` to drift. Images are stored
  and used in whole 1/255 steps so browser and training agree exactly.
- **No ONNX Runtime in the browser** (deviation from plan §6.4). The network is
  small enough for a ~150-line hand-written forward pass, which avoids a ~10 MB
  WASM binary and a worker. The `.onnx` is still exported and checked against
  PyTorch (max logit difference 1.1e-5); the TypeScript pass is checked against
  the same PyTorch logits (golden vectors, max difference 3.5e-6 in Chrome).
- **No int8 quantisation:** the whole model is 465 KB as float32 (plan budget:
  ≤ 1.5 MB int8), and ORT-web's dynamic quantisation does not cover Conv/GRU. Ship
  float32.
- **Where things are:** `public/models/sketchnet-v1.{json,bin,onnx}`, golden
  vectors in `lib/sketch/golden/`, report in `docs/ai/reports/sketchnet-v1.json`.
  Checkpoints stay on D: (`D:\simblip-ml\runs`).
- **Evidence (SYNTHETIC ONLY):** on 31,050 samples from 75 synthetic writers the
  model never saw: top-1 98.82 %, top-3 99.95 %, ECE 0.0024 (0.0446 before
  calibration), pose 99.45 %, `unknown` precision 97.9 % / recall 97.6 %. The
  existing CART baseline scores 55.3 % on the same data. Weakest: battery
  (92.7 %) vs capacitor (95.0 %), `unknown` vs switch/resistor/inductor. A fresh
  seed (777) gives 99.3 %. **These say how well the model learned the generator's
  world. They are not a real-world accuracy, and no real-world accuracy exists.**
  The manifest records `evidence.real = null`.
- **Latency:** ~8–9 ms per symbol warm (preprocess 0.3 ms + forward), measured in
  Node and in Chrome on the dev laptop. The plan's 5 ms per-symbol target is
  MISSED by ~1.7×; the user-facing budget (< 150 ms after pen-up) is met by more
  than 10×, and recognition runs once per pen-hold, not per frame. Convolution
  is ~75 % of the time. If a mid-range device proves too slow: narrower channels
  (retrain) or a WASM-SIMD kernel.
- **Integration:** pen setting "Neural symbol recogniser (experimental)", OFF by
  default. On, a held symbol is named by SketchNet when it is not `unknown`, its
  confidence is ≥ 0.9 and the class maps to a component; otherwise the older
  template matcher decides exactly as before. Pose becomes the component's
  rotation. Off = behaviour unchanged. Not yet verified by drawing in the app.
- **Open:** the 55.3 % → 98.8 % jump is partly a sign the synthetic world is
  easy for a CNN. Real data is the test that matters; until then the setting
  stays off by default.

## 2026-10-18 — SketchNet v1 retrained after a real-use failure (bare symbols)

- **What happened:** Rohan enabled the setting, drew a resistor/diode and held the
  pen: nothing happened. A clean zigzag with leads I drove through the app myself
  DID convert, so the hook works. The generator (v1) almost never drew symbols
  without connecting leads, which is how people usually sketch a part. Measured:
  top-1 99.2 % with leads, **81.9 % without** (battery 21/40, switch 19/40, AND
  gate 40/40 wrong), and only 70.6 % of bare symbols cleared the 0.9 gate.
- **Fix:** generator v2 — each simulated writer has a `leadless` propensity
  (0–0.7) and draws the whole symbol bare with that probability. Retrained from
  scratch (same architecture, same recipe). Bare symbols now: top-1 97.9 %, 95.0 %
  both correct and ≥ 0.9. Standard synthetic test (75 unseen synthetic writers):
  top-1 98.32 %, top-3 99.93 %, ECE 0.0034. Slightly lower than before because
  the data is harder, not worse.
- **Declines are now visible:** when the setting is on and a hold is not
  accepted, a toast says why ("not sure enough (resistor 74 %, needs 90 %)" or
  "doesn't look like a known symbol"; or "still loading"). Silence looked broken
  and hid the evidence.
- **Lesson:** a high synthetic score hid a distribution gap that one honest use
  exposed. The remaining gaps are unknown until real strokes exist.
  Treat toasts reporting low confidence on real drawings as the first real data.

## 2026-10-18 — Held-symbol rules: intent-based bar, multi-stroke grouping

- **Evidence from real strokes** (the first, from Rohan's own notebook): a
  mouse-drawn resistor stroke scored resistor 0.59 / unknown 0.34 — correct, but
  under the 0.9 bar picked from synthetic calibration. Handwriting strokes on the
  same page scored unknown 0.9+, correctly. Conclusion: synthetic calibration
  does not transfer; the right class is usually ranked but at lower confidence.
- **Rule change (`lib/sketch/neural-pick.ts`):** holding the pen is intent, so the
  question is which symbol, not whether to convert. Accept the best non-`unknown`
  class when its probability ≥ 0.45 (a guess from ONE real data point — revisit
  with real data). The result is always announced in a toast, with its
  percentage, so a wrong guess is obvious.
- **Multi-stroke symbols:** a hold only carries the last stroke, but a battery,
  capacitor or gate is several. Plain ink drawn within 6 s and within 30 px of the
  held stroke (chained, ≤ 7 strokes) is tried as one drawing; the group replaces
  the lone stroke only if its best symbol is ≥ 0.45 and beats the lone stroke by
  > 0.1 (or the lone stroke is below the bar). The absorbed strokes are removed
  in one history step. Verified in the app: four hand-jittered strokes (two
  leads + two plates) became a battery.
- **Open:** grouping is by recency and proximity only; the full time/space
  grouping and the ghost-preview confirm step are Phase S3. Cases the user draws
  as one long stroke through several parts (a whole loop) are still not split.
