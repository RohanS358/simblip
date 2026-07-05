# SIMBLIP

**The engineering notebook that simulates.**

Notes, physics, circuits, equations and live graphs on one infinite canvas. Draw a shape, give it a behavior, press **Play** — your sketch becomes a running simulation.

Designed and developed by **Rohan Singh**.

---

## What it does

- **Infinite canvas notebook** — notebooks → sections → pages, with pen, shapes, sticky notes, rich text (bold/italic/underline, colors, highlighter), LaTeX formulas and live graphs.
- **Everything is a drawing with behaviors** — a circle is just a circle until you attach *Rigid Body*; then it falls and collides. Springs, ropes, rods, dampers, hinges and motors connect what they touch. This geometry + behaviors split is the core architecture (see `docs/architecture.md`).
- **Live physics** — Matter.js-backed rigid-body engine at 120 Hz with gravity, drag and time-scale as live page variables you can change *while it runs*.
- **Circuits** — electrical (MNA solver), electronics and digital logic: batteries, resistors, capacitors, BJTs, op-amps, gates, flip-flops… drawn wires become nets; terminals snap together.
- **System boundaries** — declare a region *mechanics / electrical / electronics / digital* and doodles inside it are recognized as that domain's components. Scribble `100kΩ` next to a resistor to set its value; write a word to rename it (tablet handwriting supported via OS scribble input).
- **Formula engine** — every numeric field accepts expressions against shared page variables (`0.5*m*v^2`), re-evaluated live.
- **Graphs** — plot any channels from multiple objects on one chart, formulas as overlays, phase plots, reference lines; a visual series editor in the Inspector.
- **AI assistant** — describe a system ("a pendulum") and it assembles the same primitives you'd draw by hand.
- **Offline-first, cloud-synced** — works fully offline in the browser; add Supabase keys and notebooks sync across devices.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
```

The landing page is `/`, the workspace is `/notebook`. No accounts, no setup — the notebook persists in your browser (offline mode).

## Cloud sync (Supabase)

1. Create a [Supabase](https://supabase.com) project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Copy `.env.example` → `.env.local` and set:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   ```
4. Restart the dev server. The cloud icon in the workspace header shows sync status.

Sync is last-write-wins per page, debounced 2 s after each change; if the network drops, changes queue locally and retry. Without the env vars the app stays in offline mode — nothing else changes.

## Project map

```
app/                Next.js App Router: landing, /notebook, /api/ai, SEO (sitemap, robots, manifest)
components/
  landing/          Marketing site sections
  workspace/        Shell, infinite canvas, toolbar, inspector, palette, AI panel, sync badge
  objects/          Geometry-kind → renderer registry (shapes, symbols, notes, text, formula, graph)
lib/
  scene/            Entity/component scene model, factories, annotation parser
  behaviors/        Behavior registry (rigid body, spring, wire, …)
  physics/          Matter.js world runtime + sample bus (120 Hz writes, ≤12 Hz chart reads)
  circuit/          MNA + digital logic solver, terminals, nets
  formula/          Expression compiler/evaluator (mathjs)
  sketch/           Stroke recognizer (circle/rect/line/zigzag/polygon)
  store/            Zustand stores: document content, workspace tree
  sync/             Supabase sync engine (fetch-based, offline-first)
docs/               Architecture, physics/graph/formula engine internals, roadmap
supabase/           schema.sql for cloud sync
```

## Tech stack

Next.js 16 · React 19 · TypeScript · Tailwind 4 · Zustand · Matter.js · mathjs · KaTeX · Recharts · Framer Motion · Supabase (PostgREST)

## Credits

**SIMBLIP is created, designed and developed by [Rohan Singh](https://github.com/rohansingh).**

© Rohan Singh. All rights reserved.
