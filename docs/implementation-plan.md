# SIMBLIP — Implementation Plan (Phase 1)

Ordered so every step leaves the app runnable.

1. **Fonts + tokens** — Plus Jakarta Sans via `next/font/local`; rewrite `globals.css` with the
   SIMBLIP token set (light/dark, glass utilities). Everything after inherits the look.
2. **Scene model** — `lib/scene/types.ts` + factory. The universal `SceneObject` is the contract
   everything else compiles against, so it goes first.
3. **Stores** — workspace tree store (persisted) and document store (objects, variables,
   selection, viewport, undo/redo). Persistence via storage adapter (localStorage now).
4. **Formula engine** — scope solver with dependency graph + cycle handling; object parameter
   evaluation helpers.
5. **Shell** — sidebar (tree CRUD), empty canvas, inspector shell, toolbar. App is navigable.
6. **Canvas interactions** — pan/zoom/grid → select/move/resize → marquee → keyboard map →
   undo/redo wiring. Interaction before content: every object type reuses these behaviors.
7. **Basic objects** — note, text, shape, ink (pen tool). The notebook is usable for notes.
8. **Physics runtime** — bus + fixed-step loop + mechanics simulators; simulation object with
   run/pause/reset; parameters live-bound to the formula engine.
9. **Graphs** — graph object bound to bus channels, throttled rendering, downsampling.
10. **Formula object + variables UI** — KaTeX block; Variables tab in inspector.
11. **AI architecture** — `lib/ai/schema.ts` (Simulation JSON, zod-validated), `/api/ai` stub
    that answers and can propose simulation payloads; AI panel with import-to-canvas.
12. **Polish** — motion on panels, empty states, focus rings, shortcuts help.
13. **Verify** — `next build`, manual flow: create notebook → page → notes → pendulum →
    change `g` → watch graph respond.

## Definition of done (per step)
Type-checks, no console errors, works at 100%/50%/200% zoom, undo-safe, dark-mode correct.
