# 011 — Replace the keyframe on the streaming script block with a transition

- **Status**: TODO
- **Commit**: d20a080
- **Severity**: MEDIUM
- **Category**: Interruptibility
- **Estimated scope**: 1 file (`components/workspace/ai-panel.tsx`), ~4 lines

## Problem

`ScriptBlock` renders syntax-highlighted SimScript in the AI panel. While a response streams in,
it applies a **keyframe** animation:

```tsx
/* components/workspace/ai-panel.tsx:83-90 — current */
function ScriptBlock({ source, streaming }: { source: string; streaming?: boolean }) {
  const lines = tokenizeSimScript(source)
  return (
    <pre
      className={cn(
        'overflow-x-auto rounded-lg border border-border/60 bg-[var(--card)] p-2.5 font-mono text-ui-xs leading-[1.6]',
        streaming && 'animate-in fade-in-0'
      )}
    >
```

The same pattern appears again at `components/workspace/ai-panel.tsx:948`.

`animate-in fade-in-0` (from `tailwindcss-animate`) is a CSS `@keyframes` animation. Keyframes
**restart from zero** when re-applied; CSS transitions retarget from wherever they currently are.
This element re-renders on every streamed token. As long as React keeps the same DOM node the
keyframe will not restart — but that guarantee is invisible from the call-site and holds only
until someone adds a `key`, a conditional wrapper, or a virtualised list above it. A fade that
restarts mid-stream flashes the whole code block.

The rest of this codebase is transition-and-spring throughout; these two are the only keyframes
on dynamic content. Independent of the restart risk, a transition is the correct primitive for
something whose trigger condition (`streaming`) toggles at runtime.

## Target

A transition on `opacity` — GPU-composited, interruptible, and retargeting rather than restarting.

```tsx
/* target — components/workspace/ai-panel.tsx:83-90 */
function ScriptBlock({ source, streaming }: { source: string; streaming?: boolean }) {
  const lines = tokenizeSimScript(source)
  return (
    <pre
      className={cn(
        'overflow-x-auto rounded-lg border border-border/60 bg-[var(--card)] p-2.5 font-mono text-ui-xs leading-[1.6]',
        // A transition, not `animate-in`: this element re-renders on every
        // streamed token, and a keyframe restarts from zero where a transition
        // retargets from its current value.
        'transition-opacity duration-150 ease-strong',
        streaming ? 'opacity-90' : 'opacity-100'
      )}
    >
```

Exact values:

- `duration-150` — the repo's standard for small state changes; see
  `components/workspace/tools-panel.tsx:89`.
- `ease-strong` → `cubic-bezier(0.23, 1, 0.32, 1)`, already defined at `app/globals.css:725`.
  Do not add a token, do not write a raw cubic-bezier.
- `opacity-90` while streaming, `opacity-100` when settled. This preserves the original intent —
  the block reads as provisional while it fills in, then commits — without a keyframe. It is a
  deliberately smaller effect than a full `fade-in-0` from zero, because a code block fading up
  from invisible on every response is more motion than a streaming indicator needs.

Apply the identical change at `components/workspace/ai-panel.tsx:948`, which carries the same
`streaming && 'animate-in fade-in-0'` fragment.

## Feel uncertainty — read this before starting

Whether `opacity-90` is the right resting value cannot be judged from source. If it looks washed
out against `bg-[var(--card)]` in dark mode, `opacity-95` is an acceptable substitute — but make
that call by looking at it, and note which value you chose in your report. Do **not** silently
pick a third approach such as reintroducing a keyframe or animating a colour.

## Repo conventions to follow

- Exemplar of an explicit, correctly-eased transition in this same file:
  `components/workspace/ai-panel.tsx:891`, which reads
  `transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.97]`.
- `cn()` is already imported in this file; the conditional-class pattern above matches its
  existing usage.
- `app/globals.css:1143` clamps transition durations to `0.01ms` under
  `prefers-reduced-motion: reduce`, and explicitly preserves `animate-spin` and `animate-pulse`
  because they communicate state. Converting this to a transition means it now honours reduced
  motion, which the keyframe did too — no regression either way.

## Boundaries

- Do NOT touch the streaming caret at `components/workspace/ai-panel.tsx:100`
  (`<span className="… animate-pulse bg-[var(--accent-blue)] …" />`). `animate-pulse` is a
  deliberate, continuous state indicator and is explicitly preserved by the reduced-motion block
  at `app/globals.css:1154`. It is correct as-is.
- Do NOT touch any `<Loader2 … animate-spin />` (lines 800, 1034) — same reasoning.
- Do NOT change `tokenizeSimScript`, the token colouring, or any markup structure.
- Do NOT touch any other file.
- Do NOT add dependencies, and do not remove `tailwindcss-animate` from the project — other
  components still use it.
- If the excerpts do not match (drift since commit `d20a080`), STOP and report.

## Verification

- **Mechanical**: `npx tsc --noEmit`, no errors mentioning `ai-panel.tsx`. Then
  `grep -n "animate-in fade-in-0" components/workspace/ai-panel.tsx` returns nothing.
- **Feel check**: run the app, open `/notebook`, open the Assistant panel, and send a prompt
  that returns SimScript (e.g. *"A 9V battery lighting a bulb through a switch"*). Then:
  - Watch the code block fill in. It should sit slightly dimmed while streaming and settle to
    full opacity when the response completes — one continuous change, no flash, no restart.
  - Send several prompts back to back without waiting. The block must never blink to
    transparent between them; that blink is exactly the keyframe-restart this plan removes.
  - Confirm the blue caret at the end of the streaming text still pulses. If it stopped, the
    boundary above was violated.
  - In DevTools → Rendering, enable `prefers-reduced-motion: reduce` and send another prompt:
    the opacity change becomes instant, the spinner and caret keep animating.
- **Done when**: no `animate-in` remains in `ai-panel.tsx`, and back-to-back streamed responses
  produce no visible flash on the code block.
