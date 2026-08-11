# Rebindable Hotkeys & Tunable Gesture Settings

Date: 2026-08-11
Status: approved (pending user review of this doc)

## Problem

Keyboard shortcuts today are string-literal `if (e.key === ...)` checks scattered across `canvas.tsx` (~15 checks), `shell.tsx` (2), and a few per-editor inline handlers. `lib/shortcuts.ts` is a read-only display list shown in Settings → Hotkeys, disconnected from the actual key handling — editing it changes nothing. There's no way for a user to rebind a key, and no conflict detection.

Gesture behavior (pinch sensitivity, hold-before-drag timing, tap-vs-drag distance, palm rejection) is hardcoded as magic numbers in two independent places: `hooks/use-pinch-zoom.ts` (paged surfaces — Doc/PDF view) and inline in `canvas.tsx` (the infinite pannable canvas). There's no settings surface and no shared source of truth for thresholds.

This is explicitly foundational work ("we will work more in hotkeys and gestures now") — the registry needs to be a real dispatch table other actions plug into going forward, not a one-off patch.

## Goals

- Every keyboard shortcut becomes a first-class entry in a keymap registry with a stable action id, default key combo, and group — the registry drives both the actual key handling AND the Settings display (single source of truth).
- Users can rebind any action to a new key combo from Settings, with save-time conflict blocking (can't bind a key already claimed by another action).
- Users can reset an individual binding, or all bindings, to default.
- A new "Gestures" tab in Settings exposes tunable thresholds: pinch sensitivity, hold-before-drag delay, tap-vs-drag distance, palm rejection radius. Both gesture implementations (canvas.tsx inline, use-pinch-zoom.ts) read the same threshold values from prefs.
- Rebinds and gesture thresholds persist via the existing `usePrefs` zustand store, following its established slice pattern.

## Non-goals

- Not unifying canvas.tsx's inline pinch/pan machinery with `use-pinch-zoom.ts` into one hook. They're architecturally different: `use-pinch-zoom.ts` is Touch-Events-only palm-rejection-by-radius feeding a ratio callback for a paged DOM-scroll surface; canvas.tsx's pinch is Pointer-Events-based, operates on a live viewport-transform (zoom/pan) with three gesture sources (pointer pinch, ctrl+wheel, Safari `gesturechange`), plus two-finger object-rotate detection. Forcing these into one implementation risks the canvas gesture state machine for no user-visible benefit. Instead: both read the *same* named threshold constants from prefs, and palm-rejection logic is extracted to one shared helper function both call. This satisfies "one set of thresholds controls both" without an unsafe rewrite.
- Not adding new gesture *types* (no new multi-finger gestures). Tuning existing ones only.
- Not rebinding the in-editor context keys (Tab/Enter/Escape inside code/formula/table cell editors) — those are editing-context conventions, not app shortcuts, and aren't in `lib/shortcuts.ts` today.
- Not supporting chorded/sequence hotkeys (e.g. "g then g") or per-platform (Win/Mac) divergent defaults beyond the existing mod-key normalization (⌘ on Mac reads as Ctrl elsewhere, already handled ad-hoc today — the registry will formalize this, not change it).

## Design

### 1. Keymap registry (`lib/keymap.ts`, replaces `lib/shortcuts.ts`)

```ts
export type ModKey = 'mod' | 'shift' | 'alt' // 'mod' = Cmd on Mac, Ctrl elsewhere
export interface KeyCombo { key: string; mods: ModKey[] }
export interface ShortcutAction {
  id: string                 // stable id, e.g. 'tool.select', 'edit.undo'
  label: string
  group: 'Tools' | 'Simulation' | 'Edit' | 'View'
  default: KeyCombo
  when?: 'always' | 'editing' | 'not-editing' | 'paused' | 'not-edit-mode'
}
export const ACTIONS: ShortcutAction[] = [ /* ~28+ entries, one per current check */ ]
```

Every `e.key === X` check found in canvas.tsx/shell.tsx becomes one `ACTIONS` entry, including the three previously-undocumented ones the survey found (Alt-hold measurement, mod+D duplicate, Space-drag as its own row instead of folded into "Scroll/pinch"). `when` captures the existing contextual gating (e.g. 'w'/'e'/'r' behave differently while paused vs mid-simulation) as data instead of leaving it implicit in code order — the handler still contains the actual gating logic, `when` is descriptive metadata for the Settings UI tooltip ("only while paused"), not a re-implementation of the gate.

A pure helper `matchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean` centralizes the mod-key normalization (⌘/Ctrl) that's currently duplicated per-check.

### 2. Prefs slice: `HotkeyPrefs` and `GesturePrefs` (`lib/store/preferences.ts`)

```ts
export interface HotkeyPrefs {
  overrides: Record<string, KeyCombo>  // action id -> rebound combo; absent = use default
}
export const DEFAULT_HOTKEYS: HotkeyPrefs = { overrides: {} }

export interface GesturePrefs {
  pinchSensitivity: number      // multiplier on pinch ratio, default 1.0, range 0.5-2.0
  holdBeforeDragMs: number      // default 150, range 50-500
  tapVsDragPx: number           // default 8, range 2-24
  palmRejectRadiusPx: number    // default 20, range 0-60
}
export const DEFAULT_GESTURES: GesturePrefs = {
  pinchSensitivity: 1, holdBeforeDragMs: 150, tapVsDragPx: 8, palmRejectRadiusPx: 20,
}
```

Added to `PrefsState` alongside existing slices, with `setHotkeys`/`setGestures` following the exact `set((s) => ({ x: { ...s.x, ...p } }))` merge pattern already used by `setAppearance` etc. `reset()` extended to spread the two new `DEFAULT_*` consts. Persist `version` bumps to 4; `migrate()` extended with the same defensive-default pattern (missing slice → `DEFAULT_HOTKEYS`/`DEFAULT_GESTURES`, no numeric clamping needed beyond what the UI already range-limits via sliders).

A resolver function `resolveCombo(actionId): KeyCombo` (in `lib/keymap.ts`, reading `usePrefs.getState().hotkeys.overrides`) returns the override if present, else the action's `default`. Non-reactive, for use inside imperative keydown handlers — mirrors the existing `penPrefs()`/`dockPrefs()` getters at the bottom of `preferences.ts`.

### 3. Rewiring canvas.tsx / shell.tsx

Each existing `if (e.key === 'x' && ...)` becomes `if (matchesCombo(e, resolveCombo('action.id')) && ...)`. The surrounding gating logic (`!locked`, `isTyping`, `rt.mode === 'paused'`, tool-key-map lookup, etc.) is untouched — only the key-matching predicate changes. This keeps the diff mechanical and low-risk: no behavior changes for users who never rebind anything, since `resolveCombo` returns each action's existing default when `overrides` is empty.

The `toolKeys` map (v/p/s/c/r/l/t/n/f/g/k/b/e → tool name) becomes a loop over `ACTIONS` filtered by group `'Tools'`, matching against each resolved combo, instead of a hardcoded object literal — this is the one non-mechanical change, needed so a rebound tool key actually takes effect.

### 4. Gesture threshold reads

- `hooks/use-pinch-zoom.ts`: `PALM_RADIUS` constant becomes `usePrefs.getState().gestures.palmRejectRadiusPx` (read once per gesture start, not per-frame — matches existing baseline-capture-once pattern). `ratio` computation multiplies by `gestures.pinchSensitivity`.
- `canvas.tsx`: `HOLD_MS`/`DRAG_HOLD_MS`/`DRAG_HOLD_STILL_PX` constants replaced with reads from `gesturePrefs()` (new non-reactive getter, same pattern as `penPrefs()`). Pinch ratio (pointer-based, wheel-based, and Safari `gesturechange`-based — all three paths) multiplied by `pinchSensitivity`.
- Shared helper `isPalmTouch(touch: Touch, radiusPx: number): boolean` extracted to a small new file `lib/pointer/palm-reject.ts`, called from both `use-pinch-zoom.ts` (already does this) and `canvas.tsx` (currently doesn't do radius-based rejection at all, only the `penActive` flag — this is a minor behavior addition, not a regression, and directly justified by "reconcile now").

### 5. Settings UI

**Hotkeys tab** (`components/workspace/settings-dialog.tsx`, replaces the current read-only render): each `ACTIONS` entry renders as an `ObsidianPrefRow` with the label on the left and a `Kbd`-styled button showing the current combo (override or default) on the right. Clicking the button enters "listening" mode (button shows "Press a key…"); the next keydown is captured, normalized into a `KeyCombo`, checked against every other action's resolved combo:
- Collision found → inline error under the row ("Already used by {other action label}"), binding not saved, still listening for a different key.
- No collision → saved via `setHotkeys({ overrides: { ...current, [id]: combo } })`, listening mode exits.
- Escape while listening cancels without changing the binding.

A small "Reset" icon-button per row (visible only when that action has an override) clears just that one override. A "Reset all to defaults" button at the tab's bottom clears `overrides` entirely.

**Gestures tab** (new `NAV_ITEMS` entry, id `'gestures'`, icon `Hand` or similar from lucide-react, placed directly after Hotkeys): one `SettingCard` with four `ObsidianPrefRow` + `Slider` pairs (reusing the existing `Slider` component already used elsewhere in this dialog, e.g. `panelFontScale`), one per `GesturePrefs` field, each showing the current numeric value and a short description of what it affects. Values write through `setGestures` on slider commit, matching the existing debounce/commit pattern other sliders in this file use.

## Data flow summary

```
User presses key while listening in Settings
  → normalize to KeyCombo
  → check against resolveCombo() for every other ACTIONS entry
  → if clear: setHotkeys({ overrides: {...} }) → usePrefs persists
  
User presses key during normal app use (canvas.tsx/shell.tsx)
  → matchesCombo(e, resolveCombo(actionId)) for each relevant action
  → resolveCombo reads hotkeys.overrides[actionId] ?? action.default

User adjusts a gesture slider in Settings
  → setGestures({ field: value }) → usePrefs persists
  
Gesture fires (pinch/hold/drag) in canvas.tsx or use-pinch-zoom.ts
  → reads gesturePrefs() (non-reactive getter) at gesture-start/per-computation
  → applies sensitivity multiplier / threshold comparison
```

## Testing

- `lib/keymap.ts`: unit test `matchesCombo` against synthetic `KeyboardEvent`-shaped objects for each mod combination (mod-only, mod+shift, no-mod single letter), and `resolveCombo` for override-present vs. override-absent.
- Conflict detection: unit test that binding an action to a combo already used by another returns a collision and does not mutate `overrides`.
- Manual verification: rebind a tool key (e.g. 'v' → 'j'), confirm tool switching follows the new key and the old default no longer switches tools; rebind mod+Z, confirm undo follows; drag a gesture slider to an extreme and confirm the corresponding canvas/doc-view interaction visibly changes (e.g. `holdBeforeDragMs` to 500 makes touch-drag noticeably more sticky).
- No test framework currently runs in this repo beyond ad-hoc `tsc --noEmit` checks per prior sessions — this matches existing project convention (verify via typecheck + manual QA, not a new test harness).
