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
| 007 | [Fix the sidebar collapse bulge](007-sidebar-bulge-motion.md) | HIGH | Easing / Performance | TODO |
| 008 | [Sidebar fold animations off layout properties](008-sidebar-layout-property-animations.md) | HIGH | Performance | TODO |
| 009 | [Press feedback + ease-strong in sidebar chrome](009-sidebar-chrome-press-feedback-easing.md) | MEDIUM | Cohesion & tokens | TODO |
| 010 | [Floating palette scales from its dock](010-floating-palette-origin.md) | MEDIUM | Physicality & origin | TODO |
| 011 | [Streaming script block: keyframe → transition](011-ai-streaming-block-transition.md) | MEDIUM | Interruptibility | TODO |

## Recommended execution order

1. **001** — smallest diff, highest daily impact (every Ctrl+K).
2. **002** — accessibility fix; also makes 005's fold instant under reduced motion for free.
3. **003** — mechanical class-string sweep across 8 files.
4. **005** — adds the `--ease-strong` token to `app/globals.css`.
5. **004** — landing-only, independent of everything else.

### Second pass — sidebar & panels audit, commit `d20a080` (2026-08-22)

Scope: `components/workspace/sidebar.tsx`, `panel-header.tsx`, and all seven panels it routes
(`notebook-panel`, `notebook-tree`, `ai-panel`, `palette`, `tools-panel`, `uploads-panel`,
`library-panel`, `inspector`).

1. **007** — highest leverage: the collapse handle is the sidebar's most-clicked control and
   desyncs from the panel spring it is welded to. Smallest diff of the three HIGHs.
2. **008** — same file as 007; apply **after** 007 to avoid overlapping edits (see below).
3. **009** — mechanical class-string sweep, 4 edits, zero risk.
4. **011** — independent, single-file.
5. **010** — `/board` only; lowest reach, and its feel check needs the presenter view.

## Dependencies & conflicts

- 002 and 005 both edit `app/globals.css` in different places (media query at end vs. `@theme inline` token) — no conflict, but apply sequentially, not in parallel worktrees.
- 003 and 004 both edit `components/landing/showcase.tsx` (different class fragments on overlapping lines 214/241/431 vs. grid lines) — apply sequentially.
- No plan depends on another's code; each is verifiable alone.
- **007 and 008 both edit `components/workspace/sidebar.tsx`** in adjacent regions (the bulge at
  348-369 vs. the fold at 258-315). 008 adds a JSX nesting level that shifts the bulge's line
  numbers, so run **007 first**, then re-read the file before starting 008. Never run these two
  in parallel worktrees.
- 009 and 010 both touch `components/workspace/palette.tsx` in disjoint components (`Palette`
  class strings vs. `FloatingPalette` transform-origin) — no conflict, but apply sequentially.

## Explicitly NOT planned (audit notes)

- `lib/motion.ts` spring system (bouncy default, user-selectable) — deliberate, documented design; respected.
- `components/workspace/notebook-tree.tsx:415` `transition-[grid-template-rows]` — a layout
  animation, but it is the deliberate output of plan 005: children stay mounted so a re-click
  retargets mid-fold, which a keyframe could not do. Respected. If a deep tree ever drops
  frames, the GPU equivalent is `clip-path: inset(0 0 100% 0)`.
- Instant (un-animated) section swaps when clicking the sidebar rail — correct. Rail clicks are
  a tens-per-day action; per the frequency table that earns no animation. Do not add one.
- `animate-pulse` on the AI streaming caret and `animate-spin` on loaders — continuous state
  indicators, explicitly preserved under reduced motion at `app/globals.css:1154`. Correct.
- Accessibility across the whole surface: `app/globals.css:1143` (reduced motion),
  `app/globals.css:27` (`hover` variant wrapped in `@media (hover: hover)`), and
  `lib/motion.ts:71` (OS reduce-motion overriding the in-app setting) are all in place. The
  audit found nothing to fix here.
- The `/loading` cannon simulation and landing SVG demo loops — the product in miniature; correct use of the delight budget.
- Focus-view width/height animation (`focus-object.tsx`) — documented tradeoff to keep zoomed content live and crisp.
- Dead shadcn primitives that carry motion (`toast`, `toaster`, `sheet`, `sidebar`, `carousel`, `navigation-menu`, `menubar`, `hover-card`, `input-otp`, `drawer`) and the unused `POP` export in `lib/motion.ts` — never imported by app code; deleting them is a cleanup task, not a motion fix.
