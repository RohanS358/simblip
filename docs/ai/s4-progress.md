# Sketch Phase S4 — Mechanics and optics (2026-10-19)

S4 is built end to end and verified on GENERATED sketches. Like S3 it is **not** validated on real
handwriting: no real mechanics or optics sketch exists yet, so every rate below is synthetic.

## What exists
- **Mechanics reader** (`lib/sketch/mech.ts`): hatched ground / walls / ceilings, ramps (a wedge's slanted edge,
  slope fitted from the middle of the edge so rounded corners do not skew it), blocks (turned to lie on a ramp they
  touch), balls, hinges (a small circle), springs (zigzags, also when the hand lifted mid-way), ropes, rods (a line
  from a hinge, and any line hanging off the end of a rod), force and velocity arrows (a shaft with two heads, or a V).
  Free spring/rope ends become fixed anchors. A **pulley** is recognised and reported as unsupported (no component).
- **Optics reader** (`lib/sketch/optics.ts`): light source (a circle; its beam arrow gives the direction), lens (a lens
  outline, or a vertical double-headed arrow: heads folding in = converging, out = diverging), plane mirror (hatched
  line, any tilt), screen (the rightmost bare vertical line), the principal axis (not a part) and focal marks on it
  (they set f).
- **Compilers** (`compile-mech.ts`, `compile-optics.ts`): deterministic, lint-gated, positions exactly as drawn.
  Defaults when nothing was typed: block 2 kg, ball 1 kg, push 4 N per kg, launch 1.5 m/s (the canvas is 1 px = 1 mm).
- **Domain choice** (`read-sketch.ts`): a lens ⇒ optics; a block, a confidently hatched ground or a wedge ⇒ mechanics;
  a pendulum (hinge + rod + hanging ball) when no circuit reading competes; otherwise the circuit reading. A circuit is
  never read as mechanics: after the router fix, 64/64 unlabelled and 60/64 labelled generated circuits stay circuits
  (before it, labelled circuits were misrouted 36 % of the time: the earlier "16/16" bypassed labels).
- **Preview** (`components/workspace/mech-ghost.tsx`): parts drawn over the ink, numbered; kind, mass / force / f typed
  per part; links editable; Make it live in one undo step, built where it was drawn. After building, the real scene
  verifier (`verifyScene`, mechanics) or the ray tracer (optics) says whether it will work.
- **Test tooling**: `mech-synth.ts` / `optics-synth.ts` (gold situations), `compare-mech.ts`, `eval-mech.mjs`,
  `eval-optics.mjs`, `dump-mech.mjs`, `dump-optics.mjs`, `advanceWorld` (headless physics step, `lib/physics/world.ts`).

## Measured (SYNTHETIC generated hands; thresholds tuned on this same set, so optimistic)
- Mechanics: 21 situations × 8 writers drawn → **163/176 = 92.6 %** read back exactly (parts, slope angles, links);
  pulley reported as a gap 8/8. Optics: 10 situations × 8 → **74/80 = 92.5 %**; focal length right where marked 29/30.
- Domain choice through the full Done flow (`scripts/ai/sketch/audit-router.mjs`, 4 writers each): single symbols read
  right 96.2 % (2 of 504 sent to mechanics, was 42); circuits without labels 100 %, with labels 93.8 % → circuit;
  mechanics benches 97.8 %; optics benches that contain a lens 96.4 %. Known misses: a label drawn last and far from the
  circuit is read alone (Done reads the last stroke's cluster); weak circuit readings (<3 confident parts) can lose to
  the mechanics reader.
- **It behaves as drawn on the real engines** (readings that were exact): a block on a 30° ramp slides DOWN the slope;
  a block on level ground stays put; a dropped ball lands on the ground and rests there; a hung or pulled spring holds
  its mass and settles; a pendulum swings; a force arrow pushes the block the way it points; a convex lens brings a
  parallel beam to a focus at exactly f behind it; a concave lens spreads it from a virtual focus exactly f in front;
  a plane mirror sends the beam straight back, or turns it through 90° at 45°.

## Known limits / not done
- No real-handwriting accuracy for anything in S4. Collect real mechanics/optics sketches before trusting these numbers.
- Masses, strengths, speeds and focal lengths without marks are typed in the preview — handwriting values are not
  read (S3's value reading is still weak). Force vs velocity arrows need a label or one tap: both read as "force".
- Not built: pulley (no component), curved mirrors, slits/prisms, rects drawn in several strokes (two-stroke loops are
  joined, more are not), a block on a ramp drawn far from it. Wires/links beyond spring/rope/rod are out of scope.
- The engine's own springs are heavily damped (a hung mass settles, it does not oscillate) and its scale is 1 px = 1 mm,
  so a block on a ramp leaves a sketch-sized scene in a blink. That is the engine's behaviour, not the reader's.
- `create()` now honours `height`/`width` for optics lines (lens, mirror, screen): before, a requested aperture was
  silently dropped and every lens came out 120 px.
- The in-app animation could not be watched in the automation pane (it does not paint animation frames); motion was
  verified headlessly on the real physics, and the built scenes were inspected in the app.
- A generated vertical spring was once read as an optics lens (1 of 88): optics wins whenever it finds a lens.
