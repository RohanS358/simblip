# External circuit datasets (sketch recognition)

Inspected 2026-10-23. Raw files live outside the repo (`F:\simblip-datasets`); converted shards go to the git-ignored
`data/sketch/external/` (source `public`, `meta.dataset` / `meta.domain` keep each dataset separately trackable).
Converter: `scripts/ai/sketch/import-external.mjs`. Evaluation: `scripts/ai/sketch/eval-external.mjs`.

| Dataset | What it is | Size | Licence | Used |
|---|---|---|---|---|
| **CktComDb v1** (`archive.zip`) | Cropped hand-drawn symbols, scanned/photographed, 20 folders. Folders `.o` (originals), `.a` (augmented), `.oa` (mixed) | 3 000 originals (50/class train, 100/class test); 53 000 augmented copies | **Not in the zip. Unconfirmed.** | Originals only. `.a`/`.oa` are augmentations of the same drawings: using them double-counts and mixes train and test drawings |
| **Circuit and Component Dataset** | `components_all.zip`: 6 283 PNG crops, 5 classes × H/V orientation; `circuit_image_dataset.rar`: whole circuit images | 6 283 crops | **Not in the zip. Unconfirmed.** | Crops: train only (no writer or split info). The `.rar` could not be opened here (RAR4, no extractor installed) |
| **aitee_dataset** | YOLO detection set, 831 small images of hand-drawn circuits with boxes; 11 classes | 831 images | **Not in the zip. Unconfirmed.** | Not converted (see below) |
| **Digitize-HCD paper** (PDF) | Data-in-Brief article describing a dataset of 1 277 handwritten circuit diagrams, 17 symbol classes, text labels, port heatmaps. CC BY 4.0 | the dataset itself is **not** included; it is on Mendeley Data (10.17632/rngcz5wtv8.1) | CC BY 4.0 (stated in the paper) | Nothing yet: needs the data download |

## Class map (CktComDb folder → SketchNet class)
Folder meanings are not documented in the zip; they were identified by eye from samples (alphabetical order).
1 ac-source · 2 ammeter · 3 and-gate · 4 capacitor · 5 battery (several plates; least certain) · 6 gnd · 7 inductor · 8 nand-gate ·
9 nor-gate · 10 not-gate · 11 bjt (npn) · 12 or-gate · 13 diode · 14 bjt (pnp) · 16 resistor · 17 switch · 19 voltmeter.
No SketchNet class: 15 (circled +/- DC source), 18 (transformer), 20 (zener diode). They are counted and skipped.

Components: diode, resistor, inductor, capacitor. `4_DC_power` (a circle) has no class and is skipped.

## Coverage
Covered by at least one dataset: 17 of 21 SketchNet classes. **No data for**: bulb, led, xor-gate, mosfet, opamp.
aitee has R, V, I, GND and corner boxes plus text-label boxes (ident-*). Its boxes are whole-diagram detections on small, faint
images, so it would need a different path (symbol crops from boxes, then labels); `I` (current source) and `E` have no class here.

## Pose
Neither dataset says which way a symbol faces. Samples are exported with `pose: 0, meta.poseKnown: false`, and
`export-tensors.mjs` writes "no pose" (255) for them, so no wrong pose label is learned.

## Domains
Nothing provided is a phone photo with perspective, shadow and paper texture. CktComDb is `scan-hand`, the components set is
`digital-hand`. Real photo accuracy is still unmeasured.
