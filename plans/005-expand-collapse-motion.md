# 005 — Animate expand/collapse in the notebook tree and assignments list

- **Status**: DONE (applied 2026-07-23)
- **Commit**: 9cb8091
- **Severity**: MEDIUM
- **Category**: Missed opportunities / Interruptibility
- **Estimated scope**: 3 files (`app/globals.css`, `components/workspace/notebook-tree.tsx`, `app/assignments/page.tsx`), ~30 lines

## Problem

Both disclosure surfaces animate their chevron but teleport their content — the row's icon promises motion the content doesn't deliver, and a tall subtree vanishing in one frame is a jarring layout jump.

```tsx
/* components/workspace/notebook-tree.tsx:185 — chevron animates… */
className={cn('h-3.5 w-3.5 transition-transform', !collapsed[nb.id] && 'rotate-90')}

/* components/workspace/notebook-tree.tsx:220-221 — …content pops (mount/unmount) */
            {!collapsed[nb.id] &&
              nb.sections.map((sec) => (
```

```tsx
/* app/assignments/page.tsx:302 — chevron animates… */
<ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />

/* app/assignments/page.tsx:325-326 — …content pops */
            {expanded && (
              <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
```

## Target

Content height animates via the CSS grid-rows technique — a *transition* (not keyframes), so rapid re-clicks retarget smoothly from the current height instead of restarting. 200ms with a strong ease-out, exposed as a shared easing token so future work reuses it:

```css
/* target token — app/globals.css, inside the `@theme inline` block */
  --ease-strong: cubic-bezier(0.23, 1, 0.32, 1);
```

```tsx
/* target pattern (wrapper stays mounted; rows collapse to 0fr) */
<div className={cn(
  'grid transition-[grid-template-rows] duration-200 ease-strong',
  open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
)}>
  <div className="min-h-0 overflow-hidden">{children}</div>
</div>
```

## Repo conventions to follow

- Design tokens live in the `@theme inline` block of `app/globals.css` (starts at line 354); Tailwind v4 turns `--ease-strong` into the `ease-strong` utility automatically.
- Class merging uses `cn()` from `@/lib/utils` (already imported in both files).
- Duration budget: dropdown-class UI is 150–250ms; use 200ms.

## Steps

1. In `app/globals.css`, add to the `@theme inline` block (after the `--radius-*` lines, ~line 389):

   ```css
   --ease-strong: cubic-bezier(0.23, 1, 0.32, 1);
   ```

2. In `components/workspace/notebook-tree.tsx` (~line 220), replace the conditional render of sections with an always-mounted animated wrapper:

   ```tsx
   <div
     className={cn(
       'grid transition-[grid-template-rows] duration-200 ease-strong',
       collapsed[nb.id] ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
     )}
   >
     <div className="min-h-0 overflow-hidden">
       {nb.sections.map((sec) => (
         /* …existing section JSX, completely unchanged… */
       ))}
     </div>
   </div>
   ```

   The `nb.sections.map(...)` body itself must not change — only the wrapper around it. Remove the `{!collapsed[nb.id] && …}` guard.

3. In `app/assignments/page.tsx` (~line 325), same pattern:

   ```tsx
   <div
     className={cn(
       'grid transition-[grid-template-rows] duration-200 ease-strong',
       expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
     )}
   >
     <div className="min-h-0 overflow-hidden">
       <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
         {/* …existing expanded JSX, completely unchanged… */}
       </div>
     </div>
   </div>
   ```

   Remove the `{expanded && (…)}` guard. Note: the assignments content stays mounted after this change; its data fetching already happens at the page level, so this is display-only.

## Boundaries

- Do NOT touch the chevron classes — they are already correct.
- Do NOT animate with Framer Motion or JS height measurement — the grid-rows transition is the whole mechanism.
- Do NOT change anything inside the mapped children.
- Do NOT add new dependencies.
- If a step doesn't match the code you find (drift since the commit stamp), STOP and report instead of improvising.

## Verification

- **Mechanical**: `npx tsc --noEmit` and `npm run lint` pass.
- **Feel check**: run `npm run dev`:
  - In `/notebook`'s sidebar, collapse/expand a notebook with many pages: content folds and unfolds over ~200ms, decelerating (fast start, soft landing), in sync with the chevron.
  - Click the same header rapidly: the fold reverses mid-motion from wherever it is — it never snaps closed and replays from zero (that is the transitions-vs-keyframes point of this plan).
  - On `/assignments` (teacher role), expand a row with several students: same behavior; the border-top line reveals with the fold rather than popping.
  - With prefers-reduced-motion emulated (and plan 002 applied), the fold is instant.
- **Done when**: no disclosure surface in the tree or assignments list changes height in a single frame, and mid-animation re-clicks retarget smoothly.
