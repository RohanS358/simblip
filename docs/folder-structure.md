# SIMBLIP — Folder Structure

```
app/
  layout.tsx              # Plus Jakarta Sans (next/font/local), theme provider, metadata
  page.tsx                # the workspace — the notebook IS the app
  globals.css             # design tokens, liquid-glass utilities
  api/ai/route.ts         # AI gateway: validates requests, returns Simulation JSON

lib/
  scene/
    types.ts              # SceneObject, Connection, ParamValue — the universal object model
    factory.ts            # createObject(type) with per-type defaults
  formula/
    engine.ts             # mathjs wrapper: scope solving, dependency graph, cycles
  physics/
    bus.ts                # simulation ring buffers, subscription (outside React)
    loop.ts               # single fixed-step rAF loop per page
    mechanics.ts          # RK4 simulators: pendulum, spring-mass, projectile
  modules/
    registry.ts           # module + object-type registry; components resolve by type
  store/
    workspace.ts          # notebooks → sections → pages tree (persisted)
    document.ts           # active page: objects, variables, selection, viewport, undo/redo
  ai/
    schema.ts             # Simulation JSON contract shared by API route and importer

components/
  ui/                     # shadcn primitives (existing — reused, never forked)
  workspace/
    shell.tsx             # layout: sidebar + canvas + inspector + AI panel
    sidebar.tsx           # notebook/section/page tree
    toolbar.tsx           # floating tool switcher
    inspector.tsx         # properties / variables panels
    canvas.tsx            # infinite viewport: pan, zoom, grid, tools, marquee
    ai-panel.tsx          # chat UI; imports returned Simulation JSON
  objects/
    index.tsx             # type → renderer registry
    note.tsx text.tsx shape.tsx ink.tsx formula.tsx graph.tsx simulation.tsx

public/fonts/             # PlusJakartaSans-Variable.woff2 (+ italic)
docs/                     # this documentation set
```

## Rules (WHY the structure holds up)

1. **`lib/` never imports `components/`** — engines stay pure, testable, worker-portable.
2. **Renderers resolve by `object.type` through one registry** — adding an object type never
   edits the canvas; it registers itself.
3. **Modules are self-contained** under `lib/modules/<domain>` + their renderers; the core scene
   graph, store and canvas are module-agnostic.
4. **Landing page components** (`components/landing`) are the previous product's marketing site;
   kept for reference, not routed. Delete when a real marketing site exists.
