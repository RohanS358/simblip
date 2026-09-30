# Design & UX audit — report (pass 1, 2026-09-30)

Companion: `DESIGN_AUDIT_PROGRESS.md` (what is done and what is next).
Existing design docs this builds on, not replaces: `docs/design-system.md`,
`docs/ux-masterplan.md`, `plans/README.md` (motion plans 007–011 still TODO).

## Scope of this pass — read this first

Done: measured accessibility checks (WCAG 2.2 target size, contrast tiers, keyboard
reveal of hover-only controls) on the workspace at 1024 px, the mobile touch shell
at 375 px, and a narrow desktop window at 371 px; fixes for what those found.

**Not done:** the other routes (landing, `/login` beyond one screenshot, `/board`,
`/present`, `/assignments`, `/admin`, `/dev`, `/docs`, `/tutorial`), the dark and other
themes visually, Doc/PDF/Slides/Sheet editors, motion audit, forms audit, content
audit, visual-regression tooling, cross-browser, screen-reader testing. The full
prompt is a multi-session programme; this pass covers a slice of it and I have not
claimed more.

## Baseline

- Rendering: existing dev server on :3000, browser pane already signed in as the
  workspace owner (read-only inspection, no user data changed).
- `tsc --noEmit`: 0 errors before and after. `next build` (previous session) passes.
- ESLint cannot run: `npm run lint` fails because there is no flat config
  (`eslint.config.*`), a pre-existing tooling gap (finding U-09).
- Existing design identity (kept): Plus Jakarta Sans + JetBrains Mono, calm pastel
  accents with one blue, glass chrome, 10/16/20 px radii, spring motion.

## Findings

| ID | Pri | Area | Finding (evidence) | Status |
|---|---|---|---|---|
| U-01 | P1 | A11y 2.5.8 | 103 of 189 visible controls were under 24×24 px on the workspace (tab close/pane buttons 16×16, sidebar row actions 14–16 px, chat/note delete 12 px, notebook "+" 22 px, zoom 17 px tall). | Fixed for tabs, notebook tree, AI chat sessions, library assets, notes/todo delete, zoom, new-notebook via a `.hit-24` utility (visual size unchanged). Re-measured: **103 → 8**. |
| U-02 | P1 | A11y 1.4.3 | Dimmed secondary text in light themes fails AA: `text-muted-foreground/70` = 2.37:1, `/80` = 2.94:1 (default theme; audit script output). 31 call sites of prose. | Fixed: in light themes `/70` and `/80` now use the full muted token (5.71:1 default). Verified in the browser (computed colour changed from 70 % alpha to full). Dark themes untouched. |
| U-03 | P2 | A11y 1.4.3 | `im-just-a-girl` muted text was 4.06:1 even at full strength. | Fixed: lightness 0.58 → 0.55 (4.60:1). `solarized` is still 4.14:1; it is Solarized's canonical base00, so left. |
| U-04 | P1 | A11y 2.4.7 | Hover-revealed controls stayed at `opacity: 0` for keyboard users: tab "open in pane", chat-session delete, library-asset delete, doc page delete. | Fixed: `focus-visible:opacity-100`. Not yet tested with a real keyboard walk. |
| U-05 | P1 | Responsive | Desktop window narrower than ~600 px kept the full dock, so tools clipped off the right edge and a draggable dock was placed off-screen; only touch devices condensed. | Fixed: dock condenses to the More flyout by width, whatever the input (`toolbar.tsx`, `canvas-controls.tsx` kept in sync). Verified at 371 px. **Behavior change:** narrow desktop windows now get the condensed dock and a bottom dock side. |
| U-06 | P2 | Layout | Status bar wrapped to three lines and overlapped the dev badge at 371 px. | Fixed: name truncates, object count hides under 480 px, the author credit stays on one line. |
| U-07 | P3 | A11y | Sidebar collapse handle is 16×28 px (target < 24 wide). | Not changed: it is the subject of motion plans 007/008; do together. |
| U-08 | P3 | Perf/UX | Cold load of `/notebook` in dev showed "Checking your session…" for ~15 s with a half-drawn logo animation. | Not investigated: dev-server compile time, needs a production measurement. |
| U-09 | P3 | Tooling | `npm run lint` is broken (no ESLint flat config). | Open. |

## Verification

- Automated DOM checks (no axe-core installed, so these are my own scripts, not a
  full axe scan): target-size counts, accessible-name and label presence (0 unnamed
  controls, 0 unlabeled inputs, 0 duplicate ids, 0 positive tabindex, `lang` set,
  one main/nav/header landmark), horizontal-overflow check (none at 375 px).
- `scripts/accent-contrast-audit.mjs`: 132 enforced pairs, 0 below AA.
- `tsc --noEmit`: 0 errors.
- Screenshots before/after: workspace at 371 px (dock, footer). Not archived as
  regression baselines.

**Not verified:** keyboard-only walkthrough, screen reader, dark/other themes after
the CSS floor (light-only rule by construction), other pages, other browsers.

## Files changed

`app/globals.css` (light-theme dimmed-prose floor, `.hit-24`, `im-just-a-girl`
token), `components/workspace/{tabs-bar,notebook-tree,notebook-panel,ai-panel,library-panel,doc-view,notes-gallery,page-controls-menu,toolbar,canvas-controls,shell}.tsx`.

## Design decisions still open

1. Whether the Web tab's dimming hierarchy in light themes matters enough to
   retune the palettes so `/70` can stay dimmed (this pass flattened it to full
   muted instead).
2. Solarized muted text (4.14:1): canonical palette vs AA.
