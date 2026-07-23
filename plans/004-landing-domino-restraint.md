# 004 — Retire the 3D domino topple on the landing page

- **Status**: DONE (applied 2026-07-23)
- **Commit**: 9cb8091
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens
- **Estimated scope**: 2 files (`components/landing/scroll-fx.tsx`, `components/landing/showcase.tsx`), ~15 lines

## Problem

The landing page uses a "domino" scroll entrance — children topple in with a 38° 3D rotation and an overshooting `back.out(1.4)` ease — on **six** different sections (discipline strip, What's new, demos grid, light/quantum cards, classroom steps, features list). A theatrical effect repeated six times per scroll stops being a moment and becomes the page's texture, and it clashes with the product's positioning for a minimalist student audience: the workspace itself moves with restrained springs and `transition-colors` hovers, while its marketing page topples cards like a casino.

```ts
/* components/landing/scroll-fx.tsx:39-50 — current */
      gsap.utils.toArray<HTMLElement>('[data-fx="domino"]').forEach((el) => {
        gsap.from(el.children, {
          y: 70,
          opacity: 0,
          rotateX: -38,
          transformOrigin: '50% 0%',
          duration: 0.75,
          ease: 'back.out(1.4)',
          stagger: 0.13,
          scrollTrigger: { trigger: el, start: 'top 80%' },
        })
      })
```

The six consumer grids in `components/landing/showcase.tsx` carry a `[perspective:…]` utility that exists only to make the 3D rotation visible:

- `showcase.tsx:272` — `[perspective:900px]` (discipline strip)
- `showcase.tsx:297` — `[perspective:1100px]` (What's new)
- `showcase.tsx:322` — `[perspective:1100px]` (demos grid)
- `showcase.tsx:361` — `[perspective:900px]` (light/quantum cards)
- `showcase.tsx:387` — `[perspective:900px]` (classroom steps)
- `showcase.tsx:403` — `[perspective:900px]` (features list)

## Target

"Domino" keeps its name and its sequencing (that is its charm) but becomes a flat, staggered rise — same family as the existing `rise` and `hero` effects, which both use `power3.out`:

```ts
/* target — components/landing/scroll-fx.tsx */
      gsap.utils.toArray<HTMLElement>('[data-fx="domino"]').forEach((el) => {
        gsap.from(el.children, {
          y: 28,
          opacity: 0,
          duration: 0.6,
          ease: 'power3.out',
          stagger: 0.08,
          scrollTrigger: { trigger: el, start: 'top 80%' },
        })
      })
```

(Stagger 0.08s sits in the 30–80ms decorative-stagger band; `power3.out` is a strong ease-out, correct for entrances; no rotation, so no perspective needed.)

## Repo conventions to follow

- All landing scroll motion is declared in `components/landing/scroll-fx.tsx` via `data-fx` attributes — change behavior there, not per-section.
- Exemplar of the target feel already in the file: the `rise` block at `scroll-fx.tsx:30-38` (`y: 56, duration: 0.9, ease: 'power3.out'`).
- The reduced-motion guard at `scroll-fx.tsx:17-18` must remain the first thing in the effect.

## Steps

1. In `components/landing/scroll-fx.tsx`, replace the domino `gsap.from` config with the target block above (drop `rotateX`, `transformOrigin`; `y` 70→28, `duration` 0.75→0.6, `ease` `back.out(1.4)`→`'power3.out'`, `stagger` 0.13→0.08).
2. Update the file's header comment line `//   data-fx="domino"  — its CHILDREN topple in one after another` to `//   data-fx="domino"  — its CHILDREN rise in one after another`.
3. In `components/landing/showcase.tsx`, delete the ` [perspective:900px]` / ` [perspective:1100px]` fragment from the six class strings listed above (lines 272, 297, 322, 361, 387, 403). Delete only that fragment; every other class stays.

## Boundaries

- Do NOT touch the `hero` or `rise` blocks in `scroll-fx.tsx`.
- Do NOT remove any `data-fx` attribute — the sections keep their entrances.
- Do NOT touch the ballpit, the SVG demo keyframes, or any copy.
- Do NOT add new dependencies.
- If a step doesn't match the code you find (drift since the commit stamp), STOP and report instead of improvising.

## Verification

- **Mechanical**: `npx tsc --noEmit` and `npm run lint` pass; `grep -n "perspective" components/landing/showcase.tsx` returns nothing; `grep -n "rotateX" components/landing/scroll-fx.tsx` returns nothing.
- **Feel check**: run `npm run dev`, open `/`, scroll top to bottom:
  - Cards rise and fade in sequence — no tilt, no bounce-past-and-settle.
  - In DevTools set Animations playback to 10%: each child starts fast and decelerates (ease-out), never overshoots.
  - With prefers-reduced-motion emulated, the page renders with no scroll animations at all (existing guard).
- **Done when**: a full scroll of the landing page shows exactly one motion vocabulary — staggered rises — and the two greps are clean.
