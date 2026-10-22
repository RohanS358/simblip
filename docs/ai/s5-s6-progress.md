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
