# 002 — Honor OS-level prefers-reduced-motion everywhere

- **Status**: DONE (applied 2026-07-23)
- **Commit**: 9cb8091
- **Severity**: HIGH
- **Category**: Accessibility
- **Estimated scope**: 2 files (`lib/motion.ts`, `app/globals.css`), ~40 lines

## Problem

The OS "reduce motion" setting is honored in exactly two places — the landing scroll effects (`components/landing/scroll-fx.tsx:17`) and the route loader (`app/loading.tsx:18`). The entire workspace ignores it:

1. The app's own motion preference defaults to full bouncy springs regardless of the OS setting:

   ```ts
   /* lib/store/preferences.ts:80 — current */
   export const DEFAULT_APPEARANCE: AppearancePrefs = { motion: 'bouncy', focusOnEdit: true, accent: 'blue' }
   ```

2. All Framer Motion springs go through `lib/motion.ts`, which reads only that preference:

   ```ts
   /* lib/motion.ts:54-64 — current */
   export function useSpring(kind: MotionKind = 'default'): Transition {
     const style = usePrefs((s) => s.appearance.motion)
     return pick(kind, style)
   }

   export const spring = (kind: MotionKind = 'default'): Transition =>
     pick(kind, usePrefs.getState().appearance.motion)

   export const useMotionOff = (): boolean => usePrefs((s) => s.appearance.motion) === 'none'
   ```

3. Even when the user picks "none" in Appearance, the CSS-driven animations (tw-animate `animate-in`/`animate-out` on dialogs, popovers, dropdowns, tooltips, selects, context menus; `animate-pulse`; the tutorial spotlight) keep running — there is no `prefers-reduced-motion` rule anywhere in `app/globals.css`.

A vestibular-sensitive student who set reduce-motion at the OS level still gets overshooting springs and zooming popovers on every interaction.

## Target

- OS reduce-motion forces the spring system to the existing `'none'` style (instant), overriding the stored preference. The Appearance setting still works normally for everyone else.
- A global CSS rule makes all CSS animations/transitions effectively instant under reduce-motion, with two deliberate exceptions kept alive because they communicate state: `animate-spin` (loading spinners) and `animate-pulse` (live-status dots). Reduced motion means fewer and gentler animations, not broken loading indicators.

## Repo conventions to follow

- `lib/motion.ts` is the single source of truth for spring motion — put the OS check there, not in individual components.
- The file is `'use client'` and already imports from `@/lib/store/preferences`; keep its exported API (`useSpring`, `spring`, `useMotionOff`, `POP`) unchanged in shape.
- Global CSS lives in `app/globals.css`; utilities are appended in the `@layer utilities` block or after it.
- Exemplar for the media-query check: `components/landing/scroll-fx.tsx:17` (`window.matchMedia('(prefers-reduced-motion: reduce)').matches`).

## Steps

1. In `lib/motion.ts`, add an SSR-safe reactive media-query check (import `useSyncExternalStore` from `react`):

   ```ts
   const REDUCED = '(prefers-reduced-motion: reduce)'
   const subscribeReduced = (cb: () => void) => {
     const mq = window.matchMedia(REDUCED)
     mq.addEventListener('change', cb)
     return () => mq.removeEventListener('change', cb)
   }
   const osReduced = () => window.matchMedia(REDUCED).matches

   /** OS-level reduce-motion. False on the server. */
   export function useOsReducedMotion(): boolean {
     return useSyncExternalStore(subscribeReduced, osReduced, () => false)
   }
   ```

2. Route every consumer through it, OS setting winning:

   ```ts
   export function useSpring(kind: MotionKind = 'default'): Transition {
     const style = usePrefs((s) => s.appearance.motion)
     const reduced = useOsReducedMotion()
     return pick(kind, reduced ? 'none' : style)
   }

   export const spring = (kind: MotionKind = 'default'): Transition =>
     pick(
       kind,
       typeof window !== 'undefined' && window.matchMedia(REDUCED).matches
         ? 'none'
         : usePrefs.getState().appearance.motion
     )

   export const useMotionOff = (): boolean => {
     const off = usePrefs((s) => s.appearance.motion) === 'none'
     return useOsReducedMotion() || off
   }
   ```

3. Append to the end of `app/globals.css` (after the `@layer utilities` block):

   ```css
   /* OS-level reduce-motion: movement becomes instant app-wide. Spinners and
      live-status pulses keep animating — they communicate state, and reduced
      motion means gentler, not broken. */
   @media (prefers-reduced-motion: reduce) {
     *,
     ::before,
     ::after {
       animation-duration: 0.01ms !important;
       animation-iteration-count: 1 !important;
       transition-duration: 0.01ms !important;
       scroll-behavior: auto !important;
     }
     .animate-spin {
       animation: spin 1s linear infinite !important;
     }
     .animate-pulse {
       animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite !important;
     }
   }
   ```

## Boundaries

- Do NOT change `DEFAULT_APPEARANCE` or anything in `lib/store/preferences.ts` — the stored preference stays as-is; the override lives in `lib/motion.ts`.
- Do NOT touch `components/landing/scroll-fx.tsx` or `app/loading.tsx` — they already handle it.
- Do NOT remove or rename any export from `lib/motion.ts`.
- Do NOT add new dependencies.
- If a step doesn't match the code you find (drift since the commit stamp), STOP and report instead of improvising.

## Verification

- **Mechanical**: `npx tsc --noEmit` and `npm run lint` pass.
- **Feel check**: run `npm run dev`, open DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce", then:
  - Open `/notebook`: toolbar/sidebar/panels appear with no slide-in; opening the component palette, inspector, and focus view is instant.
  - Dropdowns, tooltips, selects and dialogs appear with no zoom/slide (they may hard-cut — that is correct here).
  - A loading spinner (sign-in button on `/login`) still spins; the "Live on the board" pulse dot on `/present` still pulses.
  - Toggle the emulation off: bouncy springs and popover animations return exactly as before.
  - With emulation on, flip Appearance → motion between bouncy/smooth: springs stay off (OS wins).
- **Done when**: with reduce-motion emulated, the Animations panel shows no transform/translate animations during normal workspace use, and spinners/pulses still run.
