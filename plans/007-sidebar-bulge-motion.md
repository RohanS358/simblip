# 007 — Fix the sidebar collapse bulge: spring sync, GPU, dead press feedback

- **Status**: TODO
- **Commit**: d20a080
- **Severity**: HIGH
- **Category**: Easing & duration / Performance / Cohesion
- **Estimated scope**: 1 file (`components/workspace/sidebar.tsx`), ~15 lines

## Problem

The collapse handle is a half-disc welded to the sidebar panel's right edge. It has three
independent motion defects, all in one element.

```tsx
/* components/workspace/sidebar.tsx:348-361 — current */
      <button
        type="button"
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        onClick={() => togglePanel('sidebar')}
        className={cn(
          'group/bulge absolute top-1/2 z-30 flex h-7 w-4 -translate-y-1/2',
          'items-center justify-center border-y border-r border-border/60 bg-sidebar/85 backdrop-blur-xl shadow-sm',
          'transition-[left,height,width,border-color,box-shadow] duration-200 ease-out hover:h-8 hover:w-[18px] hover:border-sky-400 hover:shadow-md',
          'active:scale-95'
        )}
        style={{
          left: sidebarOpen ? panelW + 40 : 40,
          borderRadius: '0 50% 50% 0 / 0 50% 50% 0',
        }}
      >
```

**Defect 1 — timing desync (the feel-breaking one).** `left` animates on a 200ms
`ease-out`, but the panel edge this handle is attached to folds on a Framer spring
(`components/workspace/sidebar.tsx:310-314`, config `{ stiffness: 420, damping: 26, mass: 0.9 }`
from `lib/motion.ts:41`). That spring is *under-damped* — it overshoots past its target and
settles over roughly 450ms. The handle finishes its 200ms trip and sits still while the edge
it is bonded to is still moving, then the edge overshoots past it. Two different timing
systems driving one visual seam.

**Defect 2 — layout properties on the GPU-critical path.** `left`, `height`, and `width` are
all in the transition list. Each triggers layout → paint → composite on every frame. `height`
and `width` animate on plain `:hover`, on the element the pointer crosses whenever it travels
to or from the canvas.

**Defect 3 — press feedback that does nothing.** `active:scale-95` is present, but `transform`
is **not** in `transition-[left,height,width,border-color,box-shadow]`. The scale therefore
applies with no transition at all: it snaps to 0.95 and snaps back. The press reads as a
glitch, not as feedback.

## Target

One spring, one GPU property, working press feedback.

```tsx
/* target — components/workspace/sidebar.tsx */
      <fm.button
        type="button"
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        onClick={() => togglePanel('sidebar')}
        // The handle is welded to the panel's right edge, so it MUST ride the
        // same spring the panel fold uses (see the fm.div above) — a separate
        // duration-based transition desyncs from the spring's overshoot.
        animate={{ transform: `translate(${sidebarOpen ? panelW + 40 : 40}px, -50%)` }}
        transition={motion}
        whileTap={{ scale: 0.95 }}
        className={cn(
          'group/bulge absolute left-0 top-1/2 z-30 flex h-7 w-4',
          'items-center justify-center border-y border-r border-border/60 bg-sidebar/85 backdrop-blur-xl shadow-sm',
          'transition-[border-color,box-shadow] duration-200 ease-strong hover:border-sky-400 hover:shadow-md'
        )}
        style={{ borderRadius: '0 50% 50% 0 / 0 50% 50% 0' }}
      >
```

Key values, all already present in this repo — do not invent alternatives:

- `motion` is the spring already in scope at `components/workspace/sidebar.tsx:99`
  (`const motion = useSpring()`). Reuse that exact variable.
- `ease-strong` is `cubic-bezier(0.23, 1, 0.32, 1)`, defined at `app/globals.css:725` as
  `--ease-strong`. It is the repo's standard UI curve.
- `whileTap={{ scale: 0.95 }}` replaces `active:scale-95`. Framer's `whileTap` is spring-driven
  and interruptible; the CSS `active:` variant was inert here.

## Critical detail the executor must not miss

The current markup centers the handle vertically with the Tailwind class `-translate-y-1/2`.
Moving horizontal position into a `transform` **replaces** that class's transform. The target
therefore:

1. **Removes** `-translate-y-1/2` from the className.
2. Writes the full transform string `translate(<x>px, -50%)` — the `-50%` reproduces exactly
   what `-translate-y-1/2` did.
3. Adds `left-0` and **deletes** the `left` key from the `style` object, so the element's
   layout origin is the parent's left edge and all horizontal movement is transform-only.

Getting this wrong makes the handle jump to vertically-centered-on-its-own-top-edge, i.e.
half a handle-height too low. Verify this visually before considering the plan done.

## Repo conventions to follow

- Framer Motion is imported in this file as `import { motion as fm, AnimatePresence } from 'framer-motion'`
  (`components/workspace/sidebar.tsx:26`). Use `fm.button`, never `motion.button` — `motion` is
  shadowed by the local spring variable.
- Full transform strings, not `x`/`y`/`scale` shorthands: Framer's shorthands are not
  hardware-accelerated and drop frames under load.
- Exemplar of the pattern done right in this same file: `components/workspace/sidebar.tsx:310-314`,
  where the panel fold takes `transition={motion}` from `useSpring()`.
- Press feedback strength in this repo is `active:scale-90` for icon buttons and
  `active:scale-[0.97]`–`[0.99]` for wide rows (see `plans/003-press-feedback-and-transition-all.md`,
  applied). `0.95` on this small handle is within that family — keep it.

## Steps

1. In `components/workspace/sidebar.tsx`, change the element at line 348 from `<button>` to
   `<fm.button>` and its closing tag at line 369 from `</button>` to `</fm.button>`.
2. Add the props `animate={{ transform: \`translate(${sidebarOpen ? panelW + 40 : 40}px, -50%)\` }}`,
   `transition={motion}`, and `whileTap={{ scale: 0.95 }}`.
3. In the className: remove `-translate-y-1/2`, add `left-0`, and replace the third class line
   entirely with `'transition-[border-color,box-shadow] duration-200 ease-strong hover:border-sky-400 hover:shadow-md'`.
   This deletes `hover:h-8`, `hover:w-[18px]`, and `active:scale-95`.
4. In the `style` object, delete the `left:` key. Keep `borderRadius` exactly as it is.
5. Leave the `<ChevronLeft>` child at lines 362-368 untouched.

## Boundaries

- Do NOT touch any other element in `sidebar.tsx` — the panel fold at 310-314, the phone sheet
  at 258-285, and the resize separator at 320-344 are covered by plan 008 and are out of scope here.
- Do NOT touch any file under `components/workspace/` other than `sidebar.tsx`.
- Do NOT change the `borderRadius` value, the `aria-label` logic, or the `onClick` handler.
- Do NOT add dependencies. Framer Motion is already installed and imported.
- If the code at line 348 does not match the excerpt above (drift since commit `d20a080`),
  STOP and report rather than improvising.

## Verification

- **Mechanical**: `npx tsc --noEmit` from the repo root completes with no errors mentioning
  `sidebar.tsx`.
- **Feel check**: run the app, open `/notebook`, and:
  - Click the handle to collapse and expand several times. The handle must stay glued to the
    panel's right edge for the **entire** motion, including through the spring's slight
    overshoot at the end. Any moment where the handle is ahead of or behind the edge means
    step 2 was not applied.
  - Confirm the handle is still vertically centered on the panel — the `-50%` check. Compare
    against the pre-change build if unsure.
  - Press and hold the handle: it should shrink smoothly to 95% and spring back on release,
    not snap.
  - Hover it: only the border colour and shadow should change. It must no longer grow.
  - In Chrome DevTools → Animations, set playback speed to 10%, then toggle the sidebar.
    Handle and edge must move as one object.
  - In DevTools → Rendering, enable `prefers-reduced-motion: reduce` and toggle again: the
    fold becomes instant (via `lib/motion.ts:71`) and the handle jumps with it, still glued.
- **Done when**: no `left`, `height`, or `width` appears in any `transition-[…]` on this
  element, and the handle tracks the panel edge frame-for-frame in 10% slow motion.
