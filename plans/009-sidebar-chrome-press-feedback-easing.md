# 009 — Restore press feedback and `ease-strong` across the sidebar's chrome

- **Status**: TODO
- **Commit**: d20a080
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Easing
- **Estimated scope**: 2 files (`components/workspace/panel-header.tsx`, `components/workspace/palette.tsx`), 4 class-string edits

## Problem

Plan `003-press-feedback-and-transition-all.md` (applied 2026-07-23) established two conventions
for this codebase: every pressable gets an `active:scale-*`, and every transition names an
explicit easing — `ease-strong`, defined as `cubic-bezier(0.23, 1, 0.32, 1)` at
`app/globals.css:725`. Four call-sites added since then missed both, and they are the sidebar's
most-touched controls.

**1. `railButtonClass` — the shared recipe for every rail icon and the AI mode toggle.**

```tsx
/* components/workspace/panel-header.tsx:69-79 — current */
export function railButtonClass(active: boolean) {
  return cn(
    'border transition-[color,box-shadow,background-color] duration-150',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring',
    'focus-visible:ring-[3px] focus-visible:outline-1',
    active
      ? 'border-border bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground'
      : 'border-transparent text-muted-foreground hover:text-foreground'
  )
}
```

No easing is named, so Tailwind falls back to its default `cubic-bezier(0.4, 0, 0.2, 1)` — a
weak ease-in-out whose slow start is exactly what the repo adopted `ease-strong` to avoid. And
there is no press feedback at all, while every sibling pressable has some: `active:scale-90`
on `components/workspace/notebook-panel.tsx:97`, `active:scale-[0.99]` on
`components/workspace/tools-panel.tsx:89`. The rail buttons and the AI mode toggle
(`components/workspace/ai-panel.tsx:122`) are the two surfaces that consume this recipe, so both
are currently dead to the touch.

**2. Palette component tiles — the panel's primary pressable.**

```tsx
/* components/workspace/palette.tsx:129-136 — current */
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-ui-xs transition-colors',
                armed
                  ? 'border-[var(--accent-blue)] bg-[color-mix(in_oklch,var(--accent-blue)_10%,transparent)] text-foreground'
                  : 'border-border/60 text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-foreground'
              )}
```

Clicking a tile arms a component for placement — a deliberate, consequential press with no
tactile response, sitting one rail-click away from `tools-panel.tsx:89` rows that do respond.

**3 & 4. Palette domain filter chips.**

```tsx
/* components/workspace/palette.tsx:90-97 and 104-111 — current (two near-identical buttons) */
              'shrink-0 rounded-full px-2.5 py-1 text-ui-xs font-medium transition-colors',
```

Bare `transition-colors`, weak default curve. The equivalent chip rows elsewhere already do
this correctly: `components/workspace/uploads-panel.tsx:365` and
`components/workspace/library-panel.tsx:348`.

## Target

```tsx
/* target — components/workspace/panel-header.tsx:71 */
    'border transition-[color,box-shadow,background-color,transform] duration-150 ease-strong active:scale-[0.97]',
```

```tsx
/* target — components/workspace/palette.tsx:130 */
                'flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-ui-xs transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.97]',
```

```tsx
/* target — components/workspace/palette.tsx:93 and :107 (both buttons, identical string) */
              'shrink-0 rounded-full px-2.5 py-1 text-ui-xs font-medium transition-colors duration-150 ease-strong',
```

Exact values, none of them negotiable:

- `ease-strong` → `cubic-bezier(0.23, 1, 0.32, 1)`, already registered as `--ease-strong` in
  `app/globals.css:725`. Do **not** add a new token; do **not** write a raw cubic-bezier.
- `duration-150` — matches every sibling in these panels.
- `active:scale-[0.97]` on both `railButtonClass` and the palette tiles. The repo's press scale
  is `active:scale-90` for bare icon buttons and `[0.97]`–`[0.99]` for bordered cards and rows;
  both of these are bordered surfaces, so `[0.97]`.
- `transform` **must** appear inside the `transition-[…]` bracket list or the `active:scale`
  snaps with no transition. This is the same defect plan 007 fixes on the collapse bulge — do
  not repeat it.

## Repo conventions to follow

- Exemplar to imitate verbatim, a row that already does all of this correctly:
  ```tsx
  /* components/workspace/tools-panel.tsx:89 */
  'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-ui-sm transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.99]',
  ```
- Hover is globally safe: `app/globals.css:27` redefines the `hover` variant to wrap
  `@media (hover: hover)`, so every `hover:` class in these files is already gated against
  false hovers on touch. Do not add media queries.
- Reduced motion is global: `app/globals.css:1143` clamps every `transition-duration` to
  `0.01ms` under `prefers-reduced-motion: reduce`. Do not add per-component handling.

## Steps

1. In `components/workspace/panel-header.tsx`, replace line 71 with the Target 1 string. Leave
   the `focus-visible:` lines, the `active`/inactive ternary, and the doc comment above the
   function unchanged.
2. In `components/workspace/palette.tsx`, replace line 130 with the Target 2 string. Leave the
   `armed` ternary below it unchanged.
3. In `components/workspace/palette.tsx`, replace line 93 with the Target 3 string.
4. In `components/workspace/palette.tsx`, replace line 107 with the Target 3 string — the same
   text as step 3. These two buttons are the "All" pill and the per-domain pills; both change.

## Boundaries

- Do NOT touch any file other than `panel-header.tsx` and `palette.tsx`.
- Do NOT touch the `PanelHeader` component itself (`panel-header.tsx:19-58`) — only the
  `railButtonClass` helper below it.
- Do NOT touch `FloatingPalette` (`palette.tsx:176-236`) — that is plan 010.
- Do NOT change colours, borders, radii, spacing, or the `active`/`armed` state logic. Motion
  properties only.
- Do NOT add a new easing token or a raw `cubic-bezier(...)` anywhere.
- Do NOT add dependencies.
- If any excerpt does not match the code you find (drift since commit `d20a080`), STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit`, no errors in either file. Then
  `grep -n "ease-strong" components/workspace/panel-header.tsx components/workspace/palette.tsx`
  returns 4 lines.
- **Feel check**: run the app, open `/notebook`, and:
  - Press and hold a rail icon in the left strip: it should dip to 97% and spring back. Before
    this change it does nothing. Check both an active (selected) and an inactive icon.
  - Open the Assistant panel and press the Manual/Auto toggle — same dip. It shares the recipe.
  - Open the Components panel and press a component tile: same dip, and the armed border/tint
    should ease in rather than cutting.
  - Click through the domain filter pills. The colour change should start fast and settle soft
    (`ease-strong`), not drift in symmetrically.
  - In DevTools → Animations at 10% playback, press a rail button and confirm the scale
    interpolates rather than snapping — if it snaps, `transform` was left out of the bracket list.
  - In DevTools → Rendering, enable `prefers-reduced-motion: reduce` and confirm the colour and
    border states still change (instantly) — reduced motion must not remove the state feedback,
    only its duration.
- **Done when**: all four sites name `ease-strong`, both pressables carry `active:scale-[0.97]`
  with `transform` inside their transition list, and a slow-motion press shows interpolation.
