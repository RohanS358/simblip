# Animation improvement plans

Written by the `improve-animations` audit at commit `9cb8091` (2026-07-23). Each plan is self-contained — an executor needs no other context. Run one with `improve-animations execute <plan>` or hand it to any agent.

| # | Plan | Severity | Category | Status |
| --- | --- | --- | --- | --- |
| 001 | [Command palette opens instantly](001-command-palette-instant.md) | HIGH | Purpose & frequency | DONE |
| 002 | [Honor OS prefers-reduced-motion](002-os-reduced-motion.md) | HIGH | Accessibility | DONE |
| 003 | [Unify press feedback; kill transition-all](003-press-feedback-and-transition-all.md) | MEDIUM | Cohesion / Performance | DONE |
| 004 | [Retire the landing 3D domino topple](004-landing-domino-restraint.md) | MEDIUM | Cohesion | DONE |
| 005 | [Animate tree & assignments expand/collapse](005-expand-collapse-motion.md) | MEDIUM | Missed opportunity | DONE |
| 006 | [Canvas UX overhaul: selection, dock actions, unified left panel](006-canvas-ux-overhaul.md) | — (feature program) | UX | DONE |

## Recommended execution order

1. **001** — smallest diff, highest daily impact (every Ctrl+K).
2. **002** — accessibility fix; also makes 005's fold instant under reduced motion for free.
3. **003** — mechanical class-string sweep across 8 files.
4. **005** — adds the `--ease-strong` token to `app/globals.css`.
5. **004** — landing-only, independent of everything else.

## Dependencies & conflicts

- 002 and 005 both edit `app/globals.css` in different places (media query at end vs. `@theme inline` token) — no conflict, but apply sequentially, not in parallel worktrees.
- 003 and 004 both edit `components/landing/showcase.tsx` (different class fragments on overlapping lines 214/241/431 vs. grid lines) — apply sequentially.
- No plan depends on another's code; each is verifiable alone.

## Explicitly NOT planned (audit notes)

- `lib/motion.ts` spring system (bouncy default, user-selectable) — deliberate, documented design; respected.
- The `/loading` cannon simulation and landing SVG demo loops — the product in miniature; correct use of the delight budget.
- Focus-view width/height animation (`focus-object.tsx`) — documented tradeoff to keep zoomed content live and crisp.
- Dead shadcn primitives that carry motion (`toast`, `toaster`, `sheet`, `sidebar`, `carousel`, `navigation-menu`, `menubar`, `hover-card`, `input-otp`, `drawer`) and the unused `POP` export in `lib/motion.ts` — never imported by app code; deleting them is a cleanup task, not a motion fix.
