# 008 — Move the sidebar's fold animations off layout properties onto the GPU

- **Status**: TODO
- **Commit**: d20a080
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file (`components/workspace/sidebar.tsx`), ~20 lines

## Problem

Three animations in the sidebar animate properties that force the browser through layout →
paint → composite on every frame, when `transform` and `opacity` would skip straight to
composite on the GPU.

**1. The desktop panel fold animates `width`.**

```tsx
/* components/workspace/sidebar.tsx:310-315 — current */
      <fm.div
        initial={false}
        animate={{ width: sidebarOpen ? panelW : 0, opacity: sidebarOpen ? 1 : 0 }}
        transition={motion}
        className="relative z-30 min-h-0 overflow-hidden"
      >
```

This is the costliest of the three. The panel's child is whichever section is open — that can
be the notebook tree, or `components/workspace/inspector.tsx`, a ~3,700-line component. Animating
the container's `width` relayouts that entire subtree on every frame of the fold.

**2. The phone sheet animates `height: auto`.**

```tsx
/* components/workspace/sidebar.tsx:271-285 — current */
          <AnimatePresence initial={false}>
            {sidebarOpen && (
              <fm.div
                key="panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={motion}
                className="min-h-0 overflow-hidden border-b border-border/50"
              >
                <div className="flex max-h-[38dvh] min-h-0 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1 overflow-y-auto">{panelSections}</div>
                </div>
              </fm.div>
            )}
          </AnimatePresence>
```

Same class of problem, on the device with the least CPU headroom. `height: auto` additionally
forces Framer to measure the natural height each frame.

**3. Two mount entrances use Framer's non-accelerated shorthands.**

```tsx
/* components/workspace/sidebar.tsx:258-260 — current (phone bar) */
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={motion}

/* components/workspace/sidebar.tsx:297-299 — current (desktop aside) */
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={motion}
```

Framer Motion's `x`/`y`/`scale` props are driven on the main thread through
`requestAnimationFrame` and are **not** hardware-accelerated. Both of these fire at app mount —
exactly when the main thread is busiest parsing, hydrating, and painting the workspace.

## Target

**1. Panel fold — translate inside a clipped wrapper.** The outer element keeps a fixed width
and `overflow-hidden`; the inner panel slides out of it. `opacity` stays as-is (already GPU).

```tsx
/* target — components/workspace/sidebar.tsx, replacing lines 310-315 */
      <div
        className="relative z-30 min-h-0 overflow-hidden"
        style={{ width: sidebarOpen ? panelW : 0, transition: 'width 0ms' }}
      >
        <fm.div
          initial={false}
          animate={{
            transform: `translateX(${sidebarOpen ? 0 : -panelW}px)`,
            opacity: sidebarOpen ? 1 : 0,
          }}
          transition={motion}
          className="h-full"
        >
```

The outer `width` still changes — it must, or the canvas would not reclaim the space — but it
changes **instantly** (`0ms`), in a single layout pass, instead of being interpolated across
~30 frames. The motion the eye follows is the inner `translateX`, which is pure compositor work.

**2. Phone sheet — translate inside a fixed-height clip.**

```tsx
/* target — components/workspace/sidebar.tsx, replacing lines 271-285 */
          <AnimatePresence initial={false}>
            {sidebarOpen && (
              <fm.div
                key="panel"
                initial={{ transform: 'translateY(100%)', opacity: 0 }}
                animate={{ transform: 'translateY(0%)', opacity: 1 }}
                exit={{ transform: 'translateY(100%)', opacity: 0 }}
                transition={motion}
                className="h-[38dvh] min-h-0 overflow-hidden border-b border-border/50"
              >
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <div className="min-h-0 flex-1 overflow-y-auto">{panelSections}</div>
                </div>
              </fm.div>
            )}
          </AnimatePresence>
```

`translateY(100%)` is relative to the element's own height, so it always travels exactly one
sheet-height regardless of content — this is the same technique Vaul and Sonner use for
drawers and toasts. Note the height becomes fixed `h-[38dvh]` rather than `max-h-[38dvh]`:
a percentage translate needs a known height. This is a deliberate, visible tradeoff — the
sheet no longer shrinks to fit short content. If that is unacceptable, keep the `height`
animation and mark this sub-item WONTFIX; do not invent a third approach.

**3. Mount entrances — full transform strings.**

```tsx
/* target — line 258-259 */
          initial={{ transform: 'translateY(16px)', opacity: 0 }}
          animate={{ transform: 'translateY(0px)', opacity: 1 }}

/* target — line 297-298 */
      initial={{ transform: 'translateX(-16px)', opacity: 0 }}
      animate={{ transform: 'translateX(0px)', opacity: 1 }}
```

## Repo conventions to follow

- `motion` in this file is the spring from `useSpring()` (`components/workspace/sidebar.tsx:99`),
  config `{ type: 'spring', stiffness: 420, damping: 26, mass: 0.9 }` from `lib/motion.ts:41`.
  Every `transition={motion}` stays exactly as it is — this plan changes *what* animates, never
  *how fast*.
- Framer is imported as `motion as fm` (line 26) because `motion` is taken by the spring.
- `lib/motion.ts:71` already collapses every spring to `{ duration: 0 }` under OS reduced-motion.
  Do not add reduced-motion handling here; it is inherited.

## Steps

1. Replace `components/workspace/sidebar.tsx:310-315` with the Target 1 block. The inner
   `<div style={{ width: panelW }} className="relative flex h-full …">` at lines 316-319 stays
   as-is and becomes a child of the new `fm.div`. Add the matching `</fm.div>` before the
   existing `</fm.div>` at line 348 — the nesting gains one level.
2. Replace `components/workspace/sidebar.tsx:271-285` with the Target 2 block.
3. Replace the two `initial`/`animate` pairs at lines 258-259 and 297-298 with the Target 3
   values. Leave `transition={motion}` on both.
4. Re-run the typecheck before the feel check — the added nesting level in step 1 is the most
   likely place to produce an unbalanced-JSX error.

## Boundaries

- Do NOT touch the collapse-bulge button at lines 348-369 — that is plan 007. If 007 has already
  been applied, its `fm.button` sits *after* the fold `fm.div`; leave it alone either way.
- Do NOT touch the resize separator at lines 320-344.
- Do NOT change any spring config, any `transition={motion}`, or anything in `lib/motion.ts`.
- Do NOT change `panelW`, its `localStorage` persistence, or the resize drag handler.
- Do NOT touch any other file.
- Do NOT add dependencies.
- If any excerpt above does not match the code you find (drift since commit `d20a080`), STOP
  and report rather than improvising.

## Verification

- **Mechanical**: `npx tsc --noEmit` from the repo root, no errors mentioning `sidebar.tsx`.
  JSX nesting from step 1 is the main risk — a balanced tree typechecks, an unbalanced one does not.
- **Feel check**: run the app, open `/notebook`, and:
  - Toggle the sidebar. The panel must slide out from under its own left edge and be clipped
    by the fold, not squash horizontally. If text reflows or line-wraps mid-motion, the inner
    fixed-width div was lost in step 1.
  - Open the Properties section (the heaviest panel), then toggle repeatedly. Compare against
    the pre-change build: the fold should hold frame rate where it previously stuttered.
  - Open DevTools → Performance, record a fold, and confirm the frames show compositing without
    a per-frame Layout entry for the panel subtree. This is the whole point of the plan.
  - On a phone viewport (DevTools device toolbar, ≤767px wide **and** touch emulation on — both
    are required, see the `isPhone` derivation at line 112), toggle the bottom sheet. It must
    slide up from below the rail, not unfurl. Confirm the fixed `38dvh` height is acceptable
    for a short panel; if it leaves an obvious empty gap, report it rather than reverting alone.
  - In DevTools → Rendering, enable `prefers-reduced-motion: reduce`: all three become instant.
- **Done when**: `width`, `height`, `x`, and `y` appear in no `animate`/`initial`/`exit` object
  in this file, and a recorded fold shows no per-frame layout for the panel subtree.
