# SIMBLIP — Roadmap

## Phase 1 — Foundation (this iteration)
- Design system (liquid glass, Plus Jakarta Sans, tokens)
- Workspace tree: notebooks → sections → pages, local-first autosave
- Infinite canvas: pan/zoom/grid, select/move/resize, undo/redo, marquee
- Pen drawing, sticky notes, text, shapes
- Formula engine + page variables (mathjs dependency graph)
- Mechanics module v1: pendulum, spring–mass (damped/forced), projectile — RK4, live params
- Graph objects bound to simulation channels
- AI API architecture: `/api/ai` returning Simulation JSON; import-to-canvas flow

## Phase 2 — Depth
- Supabase: auth, schema from `database.md`, autosave adapter, multi-device
- Rich text blocks (headings, lists, KaTeX inline)
- Connections v1: visual links that create physics (spring↔mass, rope, joints)
- Matter.js backend for contact-rich mechanics (blocks, inclined planes, pulleys)
- PDF/image/video embeds; asset library
- Real AI server integration (streaming, context = page snapshot)

## Phase 3 — Domains
- Electrical module: MNA solver, R/L/C, sources, meters, RC/RL/RLC transients, Bode plots
- Electronics: diode/BJT/MOSFET companion models, op-amp ideal model, rectifiers, amplifiers
- Digital logic: event-driven gates, flip-flops, counters, timing diagrams, K-maps, FSMs
- Engineering physics demos: Newton's rings, diffraction, fields, LCR resonance, wave optics

## Phase 4 — Platform
- Realtime multiplayer (Supabase channels), comments, sharing
- Code blocks execution (JS sandbox → Python via Pyodide)
- Detached graph windows, experiment runner (parameter sweeps, CSV export)
- Template gallery per syllabus; instructor mode
- Performance: worker-side physics, canvas2d/WebGL renderers per object type, viewport culling

## Ordering rationale
Foundation before domains because every domain module rides the same scene graph, formula engine
and bus; getting those contracts right is 10× cheaper before three modules depend on them.
