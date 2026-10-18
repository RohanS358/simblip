# Sketch Phase S3 — status (2026-10-19)

S3 is built end to end and verified on GENERATED sketches. It is **not** validated on real
handwriting: no real whole-circuit sketch exists yet, so every number below is synthetic.

## What exists
- **Whole-circuit reader** (`lib/sketch/extract.ts`): wires / dots / symbols, scale search, symbol grouping,
  SketchNet per group, pin matching (`pins.ts`), nets, op-amp +/- reading, stray-part pruning, doubts.
- **Values from handwriting**: a second tiny network (`inkchars-v1`, digits + k M m u n p V A F H Ω),
  character grouping/splitting, unit parsing, attachment to the nearest part (`values.ts`).
- **"Sketch → circuit" in the app** (select ink → *Recognize components*, experimental pen setting on):
  preview of every part with confidence, wires highlighted, loose ends circled, per-part class / turn / value
  editing, doubts list, "Keep my layout", **Make it live** (one undo step). Confirmed parts are saved on-device
  as real examples (never uploaded).
- Test tooling: synthetic circuit generator (`random-circuit`, `make-layouts`, `scene-synth`), `compare-ir`,
  `sketch:eval-scenes / debug-scenes / preview-scenes`.

## Measured (SYNTHETIC generated hands; tolerances tuned on this same set, so optimistic)
- Circuits read back exactly, values not drawn: **71 %** (100 circuits). Parts found 95 %, class correct 97 %.
- Same with values drawn beside parts: **31 %** exact; values read 57 %, read correctly 35 %. Reading without
  the character network at all: 15 %. So handwritten labels are the weakest part.
- Character network on generated handwriting: 99.8 % (easy, synthetic).
- End to end in the real engine: a circuit read exactly behaves identically to the one drawn (engine readings
  match) — `sketch-to-circuit.test.mjs`.

## Known limits / not done
- No real-handwriting accuracy for anything in S3. Collect real examples (saved corrections) and run
  `sketch:eval-real` before trusting it.
- Labels written next to parts are often mis-grouped (the 'k' of "kΩ", leads detached from a part, text touching
  wires). The preview lets a person correct values and classes; wires cannot yet be edited in it.
- A whole circuit drawn as ONE long stroke is not split. Op-amp +/- reading assumes '+' is two strokes.
- Only the main value of a part is read/editable (not AC frequency etc.).
- I did not verify "Make it live" by looking at the placed circuit in the app (new parts were not on screen
  after the build in my scripted test; the Node end-to-end test proves compile/run/placement bounds).
- The Next dev server slows evaluations badly; stop it first.

## Repo health
- `npm run test:ai`: 498 tests, 496 pass. The 2 failures (`pipeline.test.mjs`: a corpus slider sample and an
  inline-maths case) are older and unrelated to sketching.
- The older tests did not run on Windows (`npx` spawn, file-URL imports); fixed with `scripts/test/exec.mjs`.
- `tsc` clean; `npx next build` succeeds. `npm run build` stops in its `prebuild` licence check on this
  machine (unreviewed LGPL package `@img/sharp-win32-x64`), unrelated to this work.
