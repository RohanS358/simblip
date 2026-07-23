# 003 — Unify press feedback; replace transition-all with explicit properties

- **Status**: DONE (applied 2026-07-23)
- **Commit**: 9cb8091
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Performance
- **Estimated scope**: 8 files, ~15 one-line class edits

## Problem

Press feedback is hand-rolled per call-site at four different strengths — `active:scale-90` (settings tint swatches), `active:scale-95` (calculator, mobile shell), `active:scale-[0.97]` (landing CTAs) — while the shared `Button` primitive has none at all. Buttons in dialogs and panels feel dead next to buttons that respond.

Separately, `transition-all` appears on live components in 10 places. It animates every property that ever changes (including box-shadow and layout properties, off the compositor), and in two spots it is provably inert. Each element should transition exactly the properties it changes.

Current code:

```tsx
/* components/ui/button.tsx:8 — current (no press feedback, transition-all) */
"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 …"
```

```tsx
/* components/workspace/toolbar.tsx:138 — current (every tool button, all day) */
'flex shrink-0 items-center justify-center rounded-xl transition-all',
```

```tsx
/* components/workspace/settings-dialog.tsx:243 — current (0.90 is too strong) */
className="flex h-7 w-7 items-center justify-center rounded-full transition-transform active:scale-90"
```

```tsx
/* components/landing/showcase.tsx:214, 241, 431 — current (3 CTAs) */
"… transition-all hover:opacity-90 active:scale-[0.97]"
```

```tsx
/* components/workspace/shell.tsx:387 — current (inert: the element mounts/unmounts
   and swaps left-2/right-2 classes; nothing ever transitions) */
'pointer-events-none absolute inset-y-2 z-50 w-1/2 rounded-2xl border-2 border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 transition-all',
```

```tsx
/* components/workspace/tutorial.tsx:66 — current (spotlight travels between
   anchor rects via left/top/width/height — deliberate, but transition-all
   also animates border-color and box-shadow) */
className="pointer-events-none fixed z-[60] animate-pulse rounded-xl border-2 border-[var(--accent-blue)] shadow-[0_0_0_5px_color-mix(in_oklch,var(--accent-blue)_25%,transparent)] transition-all duration-300"
```

```tsx
/* components/ui/progress.tsx:24 — current (indicator moves via transform) */
className="bg-primary h-full w-full flex-1 transition-all"
```

```tsx
/* components/ui/switch.tsx:16 — current (root only changes colors; thumb already uses transition-transform) */
'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input … transition-all outline-none …'
```

```tsx
/* components/objects/dsa-tree.tsx:134 — current (only fill/stroke change) */
className="transition-all duration-200"
```

```tsx
/* components/objects/dsa-memory.tsx:41 and :81 — current (only colors change) */
'flex min-w-9 flex-col items-center px-1.5 py-1 transition-all duration-300',
'flex flex-col overflow-hidden rounded-lg border bg-[var(--card)] shadow-sm transition-all duration-300',
```

## Target

One press-feedback standard, applied at the primitive: **`active:scale-[0.97]` with a 150ms ease-out transform transition** (press feedback budget is 100–160ms). Call-sites already inside 0.95–0.98 keep their value; only the out-of-range `scale-90` is corrected. Every `transition-all` on a live component becomes an explicit property list.

Exact replacements (old class fragment → new class fragment, everything else on the line unchanged):

| File:line | Old | New |
| --- | --- | --- |
| `components/ui/button.tsx:8` | `transition-all` | `transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out active:scale-[0.97]` |
| `components/workspace/toolbar.tsx:138` | `transition-all` | `transition-[color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]` |
| `components/workspace/settings-dialog.tsx:243` | `transition-transform active:scale-90` | `transition-transform duration-150 ease-out active:scale-95` |
| `components/landing/showcase.tsx:214` | `transition-all` | `transition-[opacity,transform] duration-150 ease-out` |
| `components/landing/showcase.tsx:241` | `transition-all` | `transition-[opacity,transform] duration-150 ease-out` |
| `components/landing/showcase.tsx:431` | `transition-all` | `transition-[opacity,transform] duration-150 ease-out` |
| `components/workspace/shell.tsx:387` | `transition-all` | *(delete the class entirely)* |
| `components/workspace/tutorial.tsx:66` | `transition-all duration-300` | `transition-[left,top,width,height] duration-300 ease-out` |
| `components/ui/progress.tsx:24` | `transition-all` | `transition-transform duration-300 ease-out` |
| `components/ui/switch.tsx:16` | `transition-all` | `transition-colors` |
| `components/objects/dsa-tree.tsx:134` | `transition-all duration-200` | `transition-[fill,stroke] duration-200` |
| `components/objects/dsa-memory.tsx:41` | `transition-all duration-300` | `transition-colors duration-300` |
| `components/objects/dsa-memory.tsx:81` | `transition-all duration-300` | `transition-colors duration-300` |

## Repo conventions to follow

- The compliant exemplar already in the repo: `components/workspace/calculator.tsx:158` — `transition-[transform,background-color] duration-100 active:scale-95`. Leave it as-is.
- Framer `whileTap={{ scale: 0.95 }}` in `components/workspace/mobile-shell.tsx` is in range — leave it.
- Class lists are Tailwind v4 strings inside `cn()`/`cva()` — edit the string fragments in place; never reorder other classes.

## Steps

1. Apply each row of the table above as a single in-place string edit.
2. Leave `transition-all` untouched in files that are not imported by any page: `components/ui/accordion.tsx`, `navigation-menu.tsx`, `toast.tsx`, `sidebar.tsx`, `input-otp.tsx`, `sheet.tsx` (dead code — out of scope).

## Boundaries

- Do NOT touch `components/workspace/calculator.tsx` or `components/workspace/mobile-shell.tsx`.
- Do NOT change markup, variants, sizes, or any non-transition class.
- Do NOT add press feedback to the `link` Button variant via extra code — the primitive-level `active:scale-[0.97]` applying to it too is accepted.
- Do NOT add new dependencies.
- If a step doesn't match the code you find (drift since the commit stamp), STOP and report instead of improvising.

## Verification

- **Mechanical**: `npx tsc --noEmit` and `npm run lint` pass; `grep -rn "transition-all" components app --include='*.tsx'` returns only the dead-code files listed in Step 2.
- **Feel check**: run `npm run dev`:
  - Press-hold any dialog button, a toolbar tool, and a landing CTA: each dips subtly (~0.97) within ~150ms and springs back on release; nothing feels mushy or delayed.
  - Press-hold a tint swatch in Settings → Appearance: it dips less violently than before (0.95, not 0.90).
  - Run the tutorial: the spotlight still glides between targets over 300ms.
  - Toggle a Switch: thumb slides, track color changes — identical to before.
  - Run a DSA visualization: node/cell highlights still crossfade over 200–300ms.
- **Done when**: the grep in Mechanical is clean and press feedback is visibly uniform across dialogs, toolbar, and landing.
