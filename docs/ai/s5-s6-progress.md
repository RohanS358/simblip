# S5 (photo → simulation) and S6 (tutor tools): status

All numbers below are on SYNTHETIC pictures or ink (generated hands rendered to pixels). No real photograph has been
evaluated, and no vision-language model was evaluated.

## S5 — photo path (built)
`lib/sketch/photo/`: `raster.ts` (grey, downscale to 900 px, adaptive threshold, despeckle, Zhang–Suen thinning,
distance transform) → `trace.ts` (skeleton → strokes: edges between ends and junctions, spur pruning, joining the
smoothest-continuing line ends, filled junction dots) → the **same reader as ink** (`readSketch(..., { all: true })`:
stroke splitting, SketchNet, wiring, values, preview, corrections). No extra model; transient memory is the image
buffers only. Runs in the reader worker (`photo` message), falling back to the page thread.

In the app: paste or place a picture on a board, open Properties → **Diagram → Read as circuit**: the preview appears
over the picture, **Make it live** builds it (one undo step), Play runs it. A blank or too-dark picture gets a failure
card that says what to do. `scripts/ai/sketch/e2e-photo-flow.mjs` drives exactly this in headless Chrome (7/7).

Measured (`npm run sketch:eval-photo`, 16 generated circuits, 2 px lines, light shading, noise):
- read as a circuit 16/16; parts found by position 62/67; of those, right class 47 (76 %);
- the whole scene right (parts, classes and wiring) only **1/16**. The plan's exit is ≥ 70 % scene-level on clean
  printed circuits: **not met**. The same circuits read from ink score about 60 %.
- With blur, strong shading, noise and a tilt (`--hard`) fewer circuits are found (13/16) and parts drop to 49/67.

Known limits / what remains for S5:
- accuracy (above): lines thinned from small symbols fuse or lose detail; class confusions (diode ↔ LED, zigzag ↔ switch);
- no perspective correction (page corners), so a photo taken at an angle is read as is;
- filled symbols (a solid diode triangle) are not handled — the skeleton of a filled shape is not its outline;
- no OCR (plan S3b, Tesseract) for printed labels; the handwriting character network is used if it fires;
- real-photo evaluation set not built; the nano-detector decision cannot be made without it.

## S6 — tutor tools (built)
`lib/tools/sketch.ts`, registered in `lib/tools/index.ts`:
- `sketch.recognize` (read): reads the page's ink (selection, else the newest sketch) or a picture (`object` id) and
  says what it read, which parts it is unsure of, and questions a tutor would ask;
- `sketch.to_scene` (write): builds a circuit / mechanics scene / optics bench in one undo step, refusing a reading
  that is only a guess, a lone symbol, or a failure (with the reason).
`lib/sketch/teach.ts` is the teaching moves ("here's what I read"; no source; a terminal joined to nothing, i.e. an
open circuit; direction of a diode/LED; battery + side; op-amp inputs). `lib/sketch/apply.ts` is the single "Make it
live" used by both the preview button and the tool, so they cannot drift. Tests: `lib/tools/sketch-tools.test.mjs`
(real store, real reader and compiler, 7 tests).

What remains for S6:
- VLM evaluation (SmolVLM-256M/500M on 100 real figures) was **not done**: no real figures, no model download. Until it
  is, nothing is shipped from it and S5 stays purely geometric (the plan says to ship a VLM only if it adds value);
- the model-lease memory arbitration is not involved (no model is loaded for a photo);
- the tools are in the registry (MCP/WebMCP/chat agent), but the on-device chat model's routing of "why does the LED not
  light?" onto them is untested, and teaching moves for an LED that is lit the wrong way round (needs netlist
  traversal) are not written.

## Update 2026-10-23: tutor + diagnosis, external datasets, SketchNet v5

**Tutor + sketch tools.** `lib/sketch/diagnose.ts` follows the current round (battery + to −): no source, open loop, terminal joined to
nothing, LED/diode in backwards, short circuit, LED/diode with no series resistor, DC blocked by a capacitor. `teach.ts` uses it, so
`sketch.recognize` answers "why does the LED not light?" from the reading. `lib/ai/tutor/router.ts` sends "read my drawing", "turn my drawing
into a circuit" and "why isn't my circuit working" to the sketch tools. `lib/tools/tutor-sketch-e2e.test.mjs` drives the real tutor loop (scripted
model) against ink drawn by synthetic hands. The scripted model means the tool loop and tools are tested, not any on-device model's wording.

**External datasets** (`docs/ai/external-datasets.md`): CktComDb originals and the Circuit and Component Dataset crops were converted
(`import-external.mjs`, source `public`, kept in `data/sketch/external/`, tracked by `meta.dataset` / `meta.domain`). Frozen test: CktComDb's own
Test split, 1 700 drawings, never trained on. Licences: aitee Apache-2.0 (not used); Digitize-HCD CC BY 4.0 (data not provided); CktComDb and
the Circuit and Component Dataset **unverified** (no licence in the archive, none found online). Use of them is local only until that is settled.

**SketchNet v5** = v4's generated + synthetic-photo data plus the external training crops (each seen 8 times). Frozen CktComDb test, per drawing:

| | v4 | v5 |
|---|---|---|
| top-1 / top-3 | 76.9 % / 91.5 % | **90.5 % / 98.5 %** |
| "sure" coverage, right when sure | 72 %, 89.4 % | 84 %, 96.3 % |
| switch | 3 % | 89 % |
| and-gate (weakest) | 36 % | 60 % |

Regression checks (v4 → v5): synthetic test 98.2 → 98.1 %; whole synthetic circuits exact 59.0 → 59.3 %; mechanics 92.6 → 92.6 %; optics benches
routed as optics 89.3 → 96.4 %; single-symbol routing 91.9 → 90.5 % (mostly MOSFET, which no external data covers); synthetic photos whole
scene 2/16, real-handwriting set (3 circuits, assistant-made labels) 6/16 parts found. A lone confident symbol no longer hides a drawing the
mechanics reader names as unsupported (a pulley was being read as a MOSFET).

Still open: no mechanics data exists in the provided datasets, so mechanics recognition is unchanged; no real phone photos; and/or/nand/nor gates
still confuse each other; classes with no external data (bulb, led, xor-gate, mosfet, opamp); the whole-circuit RAR and Digitize-HCD data were
not available.
