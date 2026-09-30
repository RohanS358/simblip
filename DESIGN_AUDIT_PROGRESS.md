# Design audit — progress tracker

Last updated 2026-09-30 (pass 1). Findings and evidence: `DESIGN_AUDIT_REPORT.md`.

## Done
- [x] Baseline: repo state, tsc, contrast audit script, live workspace inspection
- [x] Target-size sweep on the workspace shell (U-01): 103 → 8 under 24 px
- [x] Light-theme dimmed prose contrast (U-02, U-03)
- [x] Keyboard reveal of hover-only controls (U-04)
- [x] Narrow desktop dock + status bar (U-05, U-06)

## Next, in order
1. Keyboard-only walkthrough of `/notebook` (tab order, focus rings on glass chrome, dialogs, focus return).
2. Install `axe-core` (dev only) or use Playwright + axe to scan each route; add a script under `scripts/`.
3. Other routes: landing, `/login`, `/board`, `/present`, `/assignments`, `/admin`, `/dev`, `/docs`, `/tutorial`.
4. Themes: dark, midnight, sepia, contrast, solarized visual pass (screenshots).
5. Editors: Doc, PDF, Slides, Sheet, Course reader at 375 / 768 / 1280 / 1920.
6. Motion: execute plans 007–011 (sidebar bulge/layout animations, press feedback, palette origin, AI stream block); audit `transition-all` leftovers; confirm reduced-motion on each.
7. Forms and content design: login, admin people/rooms, assignment creation, settings; error and empty states.
8. Fix `npm run lint` (ESLint flat config).
9. Regenerate diagrams (design system, component tree, journeys, motion) from the final code.

## Rules held
No brand change; no dependency added; user data untouched; nothing committed or deployed.
