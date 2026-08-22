# 010 — Scale the floating palette from its dock, not its own centre

- **Status**: TODO
- **Commit**: d20a080
- **Severity**: MEDIUM
- **Category**: Physicality & origin
- **Estimated scope**: 1 file (`components/workspace/palette.tsx`), ~10 lines

## Problem

`FloatingPalette` is the dock-anchored flyout used by the room-board presenter
(`app/board/page.tsx`) — a kiosk view with no sidebar rail to dock into. It slides in from
whichever edge the dock is on, and simultaneously scales up from `0.96`. The slide is
direction-aware; the scale is not.

```tsx
/* components/workspace/palette.tsx:199-208 — current */
    <AnimatePresence>
      {open && (
        <fm.div
          initial={{ ...slideFrom, opacity: 0, scale: 0.96 }}
          animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          exit={{ ...slideFrom, opacity: 0, scale: 0.96 }}
          transition={motion}
          className={cn(
            'glass-strong absolute z-40 max-h-[70vh] rounded-2xl',
```

With no `transform-origin`, the scale runs from the element's centre. The panel therefore grows
outward in all four directions from its own middle while translating in from one edge — it
reads as "appeared in the middle of itself and drifted", not as "grew out of the dock button
I just pressed". The file's own comment at line 191 states the intent explicitly — *"Grow out of
the dock rather than up from the floor"* — so this is a bug against stated intent, not a
design decision to re-litigate.

The `dock` value is already computed at line 180 and is one of `'left' | 'right' | 'top' | 'bottom'`.

## Target

Anchor the scale to the dock edge, so the growth direction and the slide direction agree.

```tsx
/* target — components/workspace/palette.tsx, inserted after the slideFrom block (line 196) */
  // The scale must grow FROM the dock edge, or the panel reads as expanding
  // out of its own middle while drifting sideways — two unrelated motions.
  const originFrom =
    dock === 'left'
      ? 'left center'
      : dock === 'right'
        ? 'right center'
        : dock === 'top'
          ? 'center top'
          : 'center bottom'
```

```tsx
/* target — components/workspace/palette.tsx:203, add one prop to the fm.div */
          style={{ transformOrigin: originFrom }}
```

The mapping mirrors `slideFrom` at lines 189-196 exactly: a panel docked left slides in from
`x: -16` and must grow from `left center`; docked bottom it slides from `y: 16` and grows from
`center bottom`. Do not invent a different mapping — read `slideFrom` and match it edge for edge.

Values are plain CSS `transform-origin` keywords. This is **not** a Radix or Base UI popover, so
there is no `--radix-*-transform-origin` variable available; do not reach for one.

## A latent issue to check, not to fix blindly

The same element carries Tailwind centering classes at lines 210-213:

```tsx
            vertical
              ? 'top-1/2 w-[min(22rem,calc(100vw-6rem))] -translate-y-1/2 overflow-y-auto'
              : 'left-1/2 w-[min(26rem,calc(100vw-1rem))] -translate-x-1/2',
```

Framer Motion writes an inline `transform` to drive `x`/`y`/`scale`, and an inline style beats a
class. So `-translate-y-1/2` / `-translate-x-1/2` may already be overridden while the animation
runs, meaning the flyout could be mis-centered by half its own size during motion. **Verify this
visually before changing anything about it.** If the flyout is visibly off-centre mid-animation,
report it as a separate finding with a screenshot; do not attempt to fix centering inside this
plan. The `transform-origin` change here is independent and safe either way.

## Repo conventions to follow

- `motion` at `components/workspace/palette.tsx:181` is `useSpring()`; Framer is imported as
  `motion as fm` at line 15. Keep `transition={motion}` untouched.
- The inline `style` prop is the right vehicle here — the origin is computed at runtime from
  `dock`, so it cannot be a static Tailwind class.
- Reduced motion is inherited from `lib/motion.ts:71`, which collapses the spring to
  `{ duration: 0 }`. Nothing to add.

## Steps

1. In `components/workspace/palette.tsx`, insert the `originFrom` block from Target 1
   immediately after the `slideFrom` declaration that ends at line 196, before the `return (`
   at line 198.
2. Add `style={{ transformOrigin: originFrom }}` to the `fm.div` — put it directly after the
   `transition={motion}` prop on line 205.
3. Change nothing else in the component. `initial`, `animate`, `exit`, and every className stay
   exactly as they are.

## Boundaries

- Do NOT touch the `Palette` component (`palette.tsx:51-174`) — plan 009 owns its class strings.
- Do NOT change `slideFrom`, the `dock`/`vertical` derivation, or the `isMobile` override at
  lines 186-190.
- Do NOT change the `scale: 0.96` value. It is already inside the correct 0.9–0.97 range;
  scaling from `0` would be the violation, and this code does not do that.
- Do NOT attempt to fix the `-translate-x-1/2` / `-translate-y-1/2` interaction described above —
  report it instead.
- Do NOT touch `app/board/page.tsx` or any other consumer.
- Do NOT add dependencies.
- If the excerpts do not match (drift since commit `d20a080`), STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit`, no errors mentioning `palette.tsx`.
- **Feel check**: this component renders only in the room-board presenter, so open
  `/board` (not `/notebook`) and open the component palette from the dock. Then:
  - With the dock on the left, the flyout must appear to unfold rightward *out of* the dock
    button, its left edge staying put. It must not balloon symmetrically.
  - Move the dock to each of the other three sides (the dock side comes from
    `usePrefs(s => s.notebook.dock)`) and repeat. Each time, the edge nearest the dock should be
    the anchored one.
  - In DevTools → Animations at 10% playback, watch the first 3 frames: the anchored edge should
    be motionless while the opposite edge travels. This is the single clearest tell that
    `transform-origin` took effect.
  - On a narrow viewport, confirm the mobile override still forces `dock === 'bottom'` (line 189)
    and the flyout grows upward from the bottom bar.
- **Done when**: for all four dock positions, the flyout's dock-side edge is stationary through
  the entrance in slow motion.
