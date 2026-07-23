# 001 — Make the command palette open instantly

- **Status**: DONE (applied 2026-07-23)
- **Commit**: 9cb8091
- **Severity**: HIGH
- **Category**: Purpose & frequency
- **Estimated scope**: 2 files, ~10 lines

## Problem

The command palette (Ctrl/Cmd+K) is a keyboard-initiated, many-times-a-day surface. It currently inherits the standard Dialog entrance: a 200ms zoom + fade on open and close, plus a 200ms overlay fade. High-frequency keyboard actions must not animate — the animation delays the exact moment the user wants to start typing, and by the tenth open per session it reads as lag, not polish. (Raycast, the reference command palette, has zero open animation.)

`components/workspace/command-palette.tsx` renders `CommandDialog`, which wraps the shared `DialogContent`:

```tsx
/* components/ui/command.tsx:51 — current */
      <DialogContent
        className={cn('overflow-hidden p-0', className)}
        showCloseButton={showCloseButton}
      >
```

```tsx
/* components/ui/dialog.tsx:63 — current (the animation the palette inherits) */
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg',
          className,
        )}
```

```tsx
/* components/ui/dialog.tsx:41 — current (overlay, rendered inside DialogContent) */
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
```

## Target

The palette (content AND overlay) appears and disappears with no animation at all. Ordinary dialogs (settings, page actions, confirmations) keep their current 200ms zoom+fade — only the command palette changes.

## Repo conventions to follow

- UI primitives live in `components/ui/` and merge classes with `cn()` from `@/lib/utils`; `cn` uses tailwind-merge, so a later `data-[state=open]:animate-none` class overrides the earlier `data-[state=open]:animate-in` in the same variant group.
- Do not fork the Dialog component; extend it with an optional prop, defaulting to current behavior.

## Steps

1. In `components/ui/dialog.tsx`, allow `DialogContent` to style its overlay. Add an `overlayClassName` prop and pass it through:

   ```tsx
   function DialogContent({
     className,
     children,
     showCloseButton = true,
     overlayClassName,
     ...props
   }: React.ComponentProps<typeof DialogPrimitive.Content> & {
     showCloseButton?: boolean
     overlayClassName?: string
   }) {
     return (
       <DialogPortal data-slot="dialog-portal">
         <DialogOverlay className={overlayClassName} />
   ```

   (`DialogOverlay` in this file already accepts and merges a `className` prop — verify, then just forward it.)

2. In `components/ui/command.tsx` (`CommandDialog`, line ~51), kill both animations for the palette only:

   ```tsx
   <DialogContent
     className={cn(
       'overflow-hidden p-0 data-[state=open]:animate-none data-[state=closed]:animate-none',
       className,
     )}
     overlayClassName="data-[state=open]:animate-none data-[state=closed]:animate-none"
     showCloseButton={showCloseButton}
   >
   ```

## Boundaries

- Do NOT change the animation classes in `dialog.tsx` itself — every other dialog keeps its motion.
- Do NOT touch `components/workspace/command-palette.tsx`.
- Do NOT add new dependencies.
- If a step doesn't match the code you find (drift since the commit stamp), STOP and report instead of improvising.

## Verification

- **Mechanical**: `npx tsc --noEmit` passes (repo has no test suite; `npm run lint` should also stay clean).
- **Feel check**: run `npm run dev`, open `/notebook`, press Ctrl+K repeatedly:
  - The palette and its dark overlay appear the same frame the key is pressed — no zoom, no fade, in either direction.
  - Spamming Ctrl+K / Esc never shows a half-faded overlay.
  - Open the Settings dialog and confirm it still zooms+fades in over 200ms (unchanged).
- **Done when**: DevTools → Animations panel records no animation when the palette opens, and other dialogs still record theirs.
