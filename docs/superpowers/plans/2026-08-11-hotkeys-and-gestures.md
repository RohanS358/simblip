# Rebindable Hotkeys & Tunable Gesture Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only `lib/shortcuts.ts` display list into a real keymap registry that drives both actual key handling and a rebindable Settings UI, and add a "Gestures" settings tab exposing pinch/hold/drag thresholds that both existing gesture implementations read from.

**Architecture:** A new `lib/keymap.ts` defines every shortcut as a `ShortcutAction` (id, label, group, default combo, `when`) plus a pure `matchesCombo` predicate and a non-reactive `resolveCombo` getter. Two new prefs slices (`HotkeyPrefs`, `GesturePrefs`) persist through the existing `usePrefs` zustand store, following its established slice pattern exactly. `canvas.tsx` and `shell.tsx`'s existing `if (e.key === ...)` checks are mechanically rewritten to call `matchesCombo(e, resolveCombo(id))` instead — surrounding gating logic (`!locked`, `isTyping`, mode checks) is untouched. Gesture threshold constants in `canvas.tsx` and `hooks/use-pinch-zoom.ts` are replaced with reads from a new non-reactive `gesturePrefs()` getter. Settings UI gets a rewritten Hotkeys tab (click a binding, press a new key, conflict-blocked) and a new Gestures tab (four sliders).

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand (`persist` middleware), Tailwind, lucide-react icons. No new dependencies.

## Global Constraints

- No new npm dependencies — everything native `addEventListener`/React, matching existing project convention (confirmed: no hotkey/gesture library installed).
- Persist store version bumps from 3 to 4; `migrate()` must defensively default missing `hotkeys`/`gestures` slices, following the exact pattern already used for `pen`/`dock` in `lib/store/preferences.ts:283-317`.
- Conflicting rebinds are blocked at save time, not merely warned about.
- Do NOT unify `hooks/use-pinch-zoom.ts` and `canvas.tsx`'s inline pinch logic into one implementation — they are architecturally different (paged Touch-Events surface vs. infinite Pointer-Events canvas with three gesture sources). Both must read the same named threshold values from prefs; only palm-rejection gets a shared helper.
- Every behavior change must be a no-op for users who never open the new Settings tabs — `resolveCombo`/`gesturePrefs()` return today's exact defaults when no override/pref exists yet.
- Follow existing code patterns exactly: `ObsidianPrefRow`/`SettingCard`/`Slider` for UI, `set((s) => ({ x: { ...s.x, ...p } }))` for setters, non-reactive `usePrefs.getState()` getters for hot paths (matches `penPrefs()`/`dockPrefs()`/`mathPrefs()` at `lib/store/preferences.ts:322-325`).
- Verify each task with `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip` — this repo has no test runner beyond typecheck + manual QA (confirmed during research).

---

### Task 1: Keymap registry (`lib/keymap.ts`)

**Files:**
- Create: `lib/keymap.ts`
- Delete: `lib/shortcuts.ts` (fully replaced — nothing left to import from it)

**Interfaces:**
- Produces: `ModKey` type, `KeyCombo` interface, `ShortcutAction` interface, `ACTIONS: ShortcutAction[]`, `SHORTCUT_GROUPS: ShortcutAction['group'][]`, `matchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean`, `resolveCombo(actionId: string): KeyCombo`, `comboLabel(combo: KeyCombo): string` (human-readable, e.g. "⌘Z" / "Ctrl+Z" depending on platform — replaces the old hardcoded `'Ctrl/⌘ Z'` label strings).

- [ ] **Step 1: Write `lib/keymap.ts`**

```ts
'use client'

// The real shortcut registry — every keyboard action in the app is one
// entry here (id, default combo, display group). canvas.tsx and shell.tsx
// match incoming keydown events against resolveCombo(id) instead of a
// literal key check, so a user rebind in Settings actually takes effect.
// Settings' Hotkeys tab renders straight from ACTIONS instead of a
// disconnected display list (the old lib/shortcuts.ts never rewired
// anything it displayed).

import { usePrefs } from './store/preferences'

export type ModKey = 'mod' | 'shift' | 'alt'

export interface KeyCombo {
  /** e.key value, lowercased for letters (e.g. 'v', 'z', '/', 'escape'). */
  key: string
  mods: ModKey[]
}

export interface ShortcutAction {
  id: string
  label: string
  group: 'Tools' | 'Simulation' | 'Edit' | 'View'
  default: KeyCombo
  /** Describes when the action is actually live — informational only, shown
   *  as a hint in Settings. The real gating logic still lives at the call
   *  site (e.g. canvas.tsx's `rt.mode === 'paused'` check); this does not
   *  reimplement it. */
  when?: 'while-editing' | 'while-paused' | 'while-running-or-paused'
}

export const ACTIONS: ShortcutAction[] = [
  // Tools
  { id: 'tool.select', label: 'Select', group: 'Tools', default: { key: 'v', mods: [] } },
  { id: 'tool.pen', label: 'Pen', group: 'Tools', default: { key: 'p', mods: [] } },
  { id: 'tool.shaper', label: 'Shaper', group: 'Tools', default: { key: 's', mods: [] } },
  { id: 'tool.eraser', label: 'Eraser', group: 'Tools', default: { key: 'e', mods: [] }, when: 'while-editing' },
  { id: 'tool.circle', label: 'Circle', group: 'Tools', default: { key: 'c', mods: [] } },
  { id: 'tool.line', label: 'Line', group: 'Tools', default: { key: 'l', mods: [] } },
  { id: 'tool.text', label: 'Text', group: 'Tools', default: { key: 't', mods: [] } },
  { id: 'tool.note', label: 'Note', group: 'Tools', default: { key: 'n', mods: [] } },
  { id: 'tool.formula', label: 'Formula', group: 'Tools', default: { key: 'f', mods: [] } },
  { id: 'tool.graph', label: 'Graph', group: 'Tools', default: { key: 'g', mods: [] } },
  { id: 'tool.table', label: 'Grid Table', group: 'Tools', default: { key: 'b', mods: [] } },
  { id: 'tool.code', label: 'Code', group: 'Tools', default: { key: 'k', mods: [] } },
  { id: 'tool.rect', label: 'Rectangle', group: 'Tools', default: { key: 'r', mods: [] }, when: 'while-editing' },
  { id: 'tool.quickInsert', label: 'Quick-insert menu at the cursor', group: 'Tools', default: { key: '/', mods: [] } },

  // Simulation
  { id: 'sim.playPause', label: 'Play / Pause', group: 'Simulation', default: { key: 'q', mods: [] } },
  { id: 'sim.stepBack', label: 'Step back', group: 'Simulation', default: { key: 'w', mods: [] }, when: 'while-paused' },
  { id: 'sim.stepForward', label: 'Step forward', group: 'Simulation', default: { key: 'e', mods: [] }, when: 'while-paused' },
  { id: 'sim.reset', label: 'Reset', group: 'Simulation', default: { key: 'r', mods: [] }, when: 'while-running-or-paused' },

  // Edit
  { id: 'edit.deselect', label: 'Deselect, back to Select', group: 'Edit', default: { key: 'escape', mods: [] } },
  { id: 'edit.delete', label: 'Delete selection', group: 'Edit', default: { key: 'delete', mods: [] } },
  { id: 'edit.undo', label: 'Undo', group: 'Edit', default: { key: 'z', mods: ['mod'] } },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', default: { key: 'z', mods: ['mod', 'shift'] } },
  { id: 'edit.copy', label: 'Copy', group: 'Edit', default: { key: 'c', mods: ['mod'] } },
  { id: 'edit.cut', label: 'Cut', group: 'Edit', default: { key: 'x', mods: ['mod'] } },
  { id: 'edit.paste', label: 'Paste', group: 'Edit', default: { key: 'v', mods: ['mod'] } },
  { id: 'edit.duplicate', label: 'Duplicate selection', group: 'Edit', default: { key: 'd', mods: ['mod'] } },

  // View
  { id: 'view.pan', label: 'Pan (hold + drag, or two fingers)', group: 'View', default: { key: ' ', mods: [] } },
  { id: 'view.measure', label: 'Hold to measure', group: 'View', default: { key: 'alt', mods: [] } },
  { id: 'view.search', label: 'Search everything', group: 'View', default: { key: 'k', mods: ['mod'] } },
  { id: 'view.shortcuts', label: 'This shortcuts list', group: 'View', default: { key: '?', mods: [] } },
]

export const SHORTCUT_GROUPS: ShortcutAction['group'][] = ['Tools', 'Simulation', 'Edit', 'View']

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** True if the event's key + modifier state matches combo exactly.
 *  'mod' means Cmd on Mac, Ctrl elsewhere — same normalization every
 *  existing handler already did ad-hoc via `e.metaKey || e.ctrlKey`. */
export function matchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  if (key !== combo.key.toLowerCase()) return false
  const wantMod = combo.mods.includes('mod')
  const wantShift = combo.mods.includes('shift')
  const wantAlt = combo.mods.includes('alt')
  const hasMod = e.metaKey || e.ctrlKey
  if (hasMod !== wantMod) return false
  if (e.shiftKey !== wantShift) return false
  if (e.altKey !== wantAlt) return false
  return true
}

/** Non-reactive: the currently EFFECTIVE combo for an action (rebind
 *  override if present, else its default). For use inside imperative
 *  keydown handlers, same role as penPrefs()/dockPrefs() in preferences.ts. */
export function resolveCombo(actionId: string): KeyCombo {
  const override = usePrefs.getState().hotkeys.overrides[actionId]
  if (override) return override
  const action = ACTIONS.find((a) => a.id === actionId)
  if (!action) throw new Error(`Unknown shortcut action: ${actionId}`)
  return action.default
}

/** Human-readable label for display, e.g. "⌘Z" on Mac / "Ctrl+Z" elsewhere. */
export function comboLabel(combo: KeyCombo): string {
  const mac = isMac()
  const parts: string[] = []
  if (combo.mods.includes('mod')) parts.push(mac ? '⌘' : 'Ctrl')
  if (combo.mods.includes('shift')) parts.push(mac ? '⇧' : 'Shift')
  if (combo.mods.includes('alt')) parts.push(mac ? '⌥' : 'Alt')
  const keyLabel =
    combo.key === ' ' ? 'Space' :
    combo.key === 'escape' ? 'Esc' :
    combo.key === 'delete' ? 'Delete' :
    combo.key === 'alt' ? 'Alt' :
    combo.key.length === 1 ? combo.key.toUpperCase() :
    combo.key
  parts.push(keyLabel)
  return parts.join(mac ? '' : '+')
}

/** Build a KeyCombo from a live keydown event — used while "listening" for
 *  a new binding in Settings. */
export function comboFromEvent(e: KeyboardEvent): KeyCombo {
  const mods: ModKey[] = []
  if (e.metaKey || e.ctrlKey) mods.push('mod')
  if (e.shiftKey) mods.push('shift')
  if (e.altKey) mods.push('alt')
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  return { key, mods }
}

/** First action (if any) whose EFFECTIVE combo collides with the given one.
 *  Pass excludeId to ignore the action currently being rebound. */
export function findCollision(combo: KeyCombo, excludeId?: string): ShortcutAction | undefined {
  return ACTIONS.find((a) => {
    if (a.id === excludeId) return false
    const c = resolveCombo(a.id)
    return c.key === combo.key && c.mods.length === combo.mods.length && c.mods.every((m) => combo.mods.includes(m))
  })
}
```

- [ ] **Step 2: Delete `lib/shortcuts.ts`**

```bash
rm /home/diablo/Documents/GitHub/simblip/lib/shortcuts.ts
```

- [ ] **Step 3: Typecheck (expect errors in files that still import the deleted module — that's expected, they get fixed in later tasks)**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "shortcuts\|keymap"`
Expected: errors only in `settings-dialog.tsx` (still imports `lib/shortcuts`) — will be fixed in Task 4. No errors inside `lib/keymap.ts` itself.

- [ ] **Step 4: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add lib/keymap.ts
git rm lib/shortcuts.ts
git commit -m "Add real keymap registry, replacing the display-only shortcuts list

lib/shortcuts.ts documented shortcuts without wiring them to anything.
lib/keymap.ts is a real registry: every action has a stable id and
default combo, resolveCombo() lets handlers honor rebinds, and
findCollision() will back the rebind UI's conflict blocking."
```

---

### Task 2: Prefs slices — `HotkeyPrefs` and `GesturePrefs`

**Files:**
- Modify: `lib/store/preferences.ts`

**Interfaces:**
- Consumes: nothing new (pure additions to the existing store).
- Produces: `HotkeyPrefs` (`{ overrides: Record<string, KeyCombo> }`), `DEFAULT_HOTKEYS`, `GesturePrefs` (`{ pinchSensitivity, holdBeforeDragMs, tapVsDragPx, palmRejectRadiusPx }`), `DEFAULT_GESTURES`, `setHotkeys(p: Partial<HotkeyPrefs>)`, `setGestures(p: Partial<GesturePrefs>)`, non-reactive `gesturePrefs(): GesturePrefs` getter (mirrors `penPrefs()`/`dockPrefs()`). `PrefsState.hotkeys` and `PrefsState.gestures` fields. Bumps persist `version` to 4.

- [ ] **Step 1: Add the two new type/default blocks**

In `lib/store/preferences.ts`, add after the `DEFAULT_APPEARANCE` block (after line 87, before `export type AngleUnit`):

```ts
import type { KeyCombo } from '../keymap'

export interface HotkeyPrefs {
  /** action id -> rebound combo. Absent = use the action's default. */
  overrides: Record<string, KeyCombo>
}

export const DEFAULT_HOTKEYS: HotkeyPrefs = { overrides: {} }

export interface GesturePrefs {
  /** Multiplier applied to every pinch-zoom ratio (pointer, ctrl+wheel,
   *  Safari gesturechange alike). 1 = unchanged. Range 0.5–2. */
  pinchSensitivity: number
  /** Touch object-drag commit delay in ms before a touch-and-hold starts
   *  moving an object (see canvas.tsx DRAG_HOLD_MS). Range 50–500. */
  holdBeforeDragMs: number
  /** Distance in px a touch must travel to be treated as a swipe/scroll
   *  instead of a drag (see canvas.tsx DRAG_HOLD_STILL_PX). Range 2–24. */
  tapVsDragPx: number
  /** Touch contact radius in px above which a touch point is rejected as a
   *  palm instead of a finger (see hooks/use-pinch-zoom.ts PALM_RADIUS).
   *  Range 0–60; 0 disables palm rejection. */
  palmRejectRadiusPx: number
}

export const DEFAULT_GESTURES: GesturePrefs = {
  pinchSensitivity: 1,
  holdBeforeDragMs: 150,
  tapVsDragPx: 8,
  palmRejectRadiusPx: 20,
}
```

Note: `lib/keymap.ts` imports `usePrefs` from `./store/preferences`, so `preferences.ts` must import the `KeyCombo` *type only* (no value import) from `../keymap` to avoid a circular runtime dependency — `import type { KeyCombo } from '../keymap'` is erased at compile time so this is safe.

- [ ] **Step 2: Add both slices to `PrefsState`, initial state, setters, and `reset()`**

In `lib/store/preferences.ts`, modify `PrefsState` (currently lines 157-171):

```ts
export interface PrefsState {
  pen: PenPrefs
  notebook: NotebookPrefs
  dock: DockPrefs
  math: MathPrefs
  appearance: AppearancePrefs
  hotkeys: HotkeyPrefs
  gestures: GesturePrefs
  packages: Record<string, boolean>
  setPen: (p: Partial<PenPrefs>) => void
  setNotebook: (p: Partial<NotebookPrefs>) => void
  setDock: (p: Partial<DockPrefs>) => void
  setMath: (p: Partial<MathPrefs>) => void
  setAppearance: (p: Partial<AppearancePrefs>) => void
  setHotkeys: (p: Partial<HotkeyPrefs>) => void
  setGestures: (p: Partial<GesturePrefs>) => void
  setPackage: (id: string, enabled: boolean) => void
  reset: () => void
}
```

Modify the store body (currently lines 227-278) — add `hotkeys`/`gestures` to initial state, add the two setters, and extend `reset()`:

```ts
export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      pen: { ...DEFAULT_PEN },
      notebook: { ...DEFAULT_NOTEBOOK },
      dock: { ...DEFAULT_DOCK_PREFS },
      math: { ...DEFAULT_MATH },
      appearance: { ...DEFAULT_APPEARANCE },
      hotkeys: { ...DEFAULT_HOTKEYS },
      gestures: { ...DEFAULT_GESTURES },
      packages: { ...DEFAULT_PACKAGES },
      setPen: (p) =>
        set((s) => ({
          pen: {
            ...s.pen,
            ...p,
            ...(p.size !== undefined ? { size: Math.min(16, Math.max(0.5, p.size)) } : {}),
          },
        })),
      setNotebook: (p) =>
        set((s) => {
          const nextNb = { ...s.notebook, ...p }
          const nextDock = p.dock ? { ...s.dock, fixedSide: p.dock } : s.dock
          return { notebook: nextNb, dock: nextDock }
        }),
      setDock: (p) =>
        set((s) => {
          const nextDock = { ...s.dock, ...p }
          const nextNb = p.fixedSide ? { ...s.notebook, dock: p.fixedSide } : s.notebook
          return { dock: nextDock, notebook: nextNb }
        }),
      setMath: (p) => set((s) => ({ math: { ...s.math, ...p } })),
      setAppearance: (p) => set((s) => ({ appearance: { ...s.appearance, ...p } })),
      setHotkeys: (p) => set((s) => ({ hotkeys: { ...s.hotkeys, ...p } })),
      setGestures: (p) => set((s) => ({ gestures: { ...s.gestures, ...p } })),
      setPackage: (id, enabled) =>
        set((s) => ({
          packages: {
            ...DEFAULT_PACKAGES,
            ...s.packages,
            [id]: enabled,
          },
        })),
      reset: () =>
        set({
          pen: { ...DEFAULT_PEN },
          notebook: { ...DEFAULT_NOTEBOOK },
          dock: { ...DEFAULT_DOCK_PREFS },
          math: { ...DEFAULT_MATH },
          appearance: { ...DEFAULT_APPEARANCE },
          hotkeys: { ...DEFAULT_HOTKEYS },
          gestures: { ...DEFAULT_GESTURES },
          packages: { ...DEFAULT_PACKAGES },
        }),
    }),
    {
      name: 'simblip-preferences',
      version: 4,
      migrate: (persisted) => {
        const s = (persisted ?? {}) as Record<string, unknown>
        const pen = (s.pen ?? {}) as Record<string, unknown>
        const nb = (s.notebook ?? {}) as Record<string, unknown>
        const dock = (s.dock ?? {}) as Record<string, unknown>
        const hotkeys = (s.hotkeys ?? {}) as Record<string, unknown>
        const gestures = (s.gestures ?? {}) as Record<string, unknown>
        const num = (v: unknown, d: number, lo: number, hi: number) =>
          typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d
        const style = pen.style as string

        const initialFixedSide = (dock.fixedSide as DockSide) ?? (nb.dock as DockSide) ?? DEFAULT_DOCK_PREFS.fixedSide

        s.pen = {
          ...DEFAULT_PEN,
          ...pen,
          smoothing: num(pen.smoothing, DEFAULT_PEN.smoothing, 0, 1),
          streamline: num(pen.streamline, DEFAULT_PEN.streamline, 0, 0.9),
          sensitivity: num(pen.sensitivity, DEFAULT_PEN.sensitivity, 0, 1),
          size: num(pen.size, DEFAULT_PEN.size, 0.5, 16),
          dotSize: num(pen.dotSize, DEFAULT_PEN.dotSize, 0.5, 5),
          scribbleSensitivity: num(pen.scribbleSensitivity, DEFAULT_PEN.scribbleSensitivity, 0, 1),
          style: style in PEN_STYLES ? style : style === 'marker' || style === 'technical' ? 'pen' : 'ink',
          color: typeof pen.color === 'string' ? pen.color : DEFAULT_PEN.color,
          customColors: Array.isArray(pen.customColors)
            ? pen.customColors.filter((c): c is string => typeof c === 'string').slice(0, 12)
            : [],
        }

        s.dock = {
          ...DEFAULT_DOCK_PREFS,
          ...dock,
          fixedSide: initialFixedSide,
        }

        s.hotkeys = {
          ...DEFAULT_HOTKEYS,
          ...hotkeys,
          overrides: typeof hotkeys.overrides === 'object' && hotkeys.overrides !== null ? hotkeys.overrides : {},
        }

        s.gestures = {
          ...DEFAULT_GESTURES,
          ...gestures,
          pinchSensitivity: num(gestures.pinchSensitivity, DEFAULT_GESTURES.pinchSensitivity, 0.5, 2),
          holdBeforeDragMs: num(gestures.holdBeforeDragMs, DEFAULT_GESTURES.holdBeforeDragMs, 50, 500),
          tapVsDragPx: num(gestures.tapVsDragPx, DEFAULT_GESTURES.tapVsDragPx, 2, 24),
          palmRejectRadiusPx: num(gestures.palmRejectRadiusPx, DEFAULT_GESTURES.palmRejectRadiusPx, 0, 60),
        }

        return s as unknown as PrefsState
      },
    }
  )
)
```

- [ ] **Step 3: Add the non-reactive `gesturePrefs()` getter**

Modify the bottom of `lib/store/preferences.ts` (currently lines 322-325):

```ts
/** Non-reactive reads for hot paths (these run per pointer event / per frame). */
export const penPrefs = (): PenPrefs => usePrefs.getState().pen
export const mathPrefs = (): MathPrefs => usePrefs.getState().math
export const dockPrefs = (): DockPrefs => usePrefs.getState().dock
export const gesturePrefs = (): GesturePrefs => usePrefs.getState().gestures
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "preferences.ts"`
Expected: no errors.

- [ ] **Step 5: Manual verification of migrate() defaults**

In a browser devtools console on the running app (or reasoning through the code — no test harness exists for this store), confirm: a fresh `localStorage` with no `simblip-preferences` key results in `usePrefs.getState().hotkeys` === `{ overrides: {} }` and `usePrefs.getState().gestures` === `DEFAULT_GESTURES`. This is a manual/inspection check, not an automated test, matching this file's existing verification style.

- [ ] **Step 6: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add lib/store/preferences.ts
git commit -m "Add HotkeyPrefs and GesturePrefs slices to the preferences store

Follows the existing slice pattern (interface, DEFAULT_, setter merging
into state, migrate() defensive default, version bump). Also adds
gesturePrefs() non-reactive getter alongside the existing penPrefs()/
dockPrefs()/mathPrefs() for use in hot pointer-event paths."
```

---

### Task 3: Shared palm-rejection helper (`lib/pointer/palm-reject.ts`)

**Files:**
- Create: `lib/pointer/palm-reject.ts`

**Interfaces:**
- Consumes: nothing (pure function, no store dependency — caller passes the radius).
- Produces: `isPalmTouch(touch: Touch, radiusPx: number): boolean`

- [ ] **Step 1: Write the helper**

```ts
'use client'

// Palm-rejection radius check, shared by hooks/use-pinch-zoom.ts (which
// already did this inline) and canvas.tsx's own pointer-based pinch (which
// didn't — it only checked the global penActive flag). Extracted so both
// read the SAME tunable radius from Settings' Gestures tab instead of one
// of them keeping a hardcoded value the setting can't reach.
//
// A palm's contact patch is much wider than a fingertip's — Touch.radiusX/
// radiusY (Chrome/WebKit) let us drop oversized contacts before pairing
// them into a gesture. radiusPx <= 0 disables the check entirely (every
// touch passes), since 0 is a valid user-chosen "off" setting.

export function isPalmTouch(touch: Touch, radiusPx: number): boolean {
  if (radiusPx <= 0) return false
  const rx = (touch as unknown as { radiusX?: number }).radiusX ?? 0
  const ry = (touch as unknown as { radiusY?: number }).radiusY ?? 0
  return Math.max(rx, ry) > radiusPx
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "palm-reject"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add lib/pointer/palm-reject.ts
git commit -m "Extract shared isPalmTouch helper for gesture threshold reuse

Pulled out of use-pinch-zoom.ts's inline radius check so canvas.tsx's
separate pinch implementation can use the same logic against the same
Settings-tunable radius, instead of only checking the penActive flag."
```

---

### Task 4: Rewire `canvas.tsx` keyboard handling to the keymap registry

**Files:**
- Modify: `components/workspace/canvas.tsx:1246-1355` (the `onKeyDown` handler)

**Interfaces:**
- Consumes: `matchesCombo`, `resolveCombo` from `lib/keymap.ts` (Task 1); `ACTIONS` from `lib/keymap.ts` for the tool-key loop.
- Produces: no new exports — internal behavior change only, must be behaviorally identical to before for un-rebound keys.

- [ ] **Step 1: Add the import**

In `components/workspace/canvas.tsx`, add near the top with other `lib/` imports:

```ts
import { matchesCombo, resolveCombo, ACTIONS } from '@/lib/keymap'
```

- [ ] **Step 2: Replace the key-check bodies, keeping all surrounding gating logic**

Replace lines 1256-1354 (from `if (e.code === 'Space' ...` through the `toolKeys` block) with:

```ts
      if (matchesCombo(e, resolveCombo('view.pan')) && !isTyping(e.target)) spaceRef.current = true
      if (matchesCombo(e, resolveCombo('view.measure')) && !isTyping(e.target)) setAltHeld(true)
      if (isTyping(e.target)) return
      const store = useDocStore.getState()
      const locked = useRuntimeStore.getState().mode !== 'edit'
      const mod = e.metaKey || e.ctrlKey
      if (matchesCombo(e, resolveCombo('edit.redo')) && !locked) {
        e.preventDefault()
        store.redo(pageId)
        return
      }
      if (matchesCombo(e, resolveCombo('edit.undo')) && !locked) {
        e.preventDefault()
        store.undo(pageId)
        return
      }
      if (matchesCombo(e, resolveCombo('edit.copy')) && !locked) {
        e.preventDefault()
        copySelection(pageId)
        return
      }
      if (matchesCombo(e, resolveCombo('edit.cut')) && !locked) {
        e.preventDefault()
        cutSelection(pageId)
        return
      }
      if (matchesCombo(e, resolveCombo('edit.duplicate')) && !locked) {
        e.preventDefault()
        if (store.selection.length > 0) duplicateObjects(pageId, store.selection)
        return
      }
      // Ctrl+V itself is handled by the window-level 'paste' listener below,
      // not here — preventDefault() on this keydown would suppress the
      // browser's native paste event too, which is the only way it ever
      // sees clipboardData (an OS-clipboard image, or plain text/nothing,
      // in which case it falls back to the internal object clipboard).
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        store.selection.length > 0 &&
        !locked
      ) {
        e.preventDefault()
        store.removeObjects(pageId, store.selection)
        return
      }
      if (e.key === 'Escape') {
        store.setSelection([])
        store.setTool('select')
        return
      }
      // Transport hotkeys — mirror the Transport buttons' own disabled
      // conditions exactly, so a hotkey press is a no-op (not an error)
      // wherever the corresponding button would be greyed out. 'r' and 'e'
      // fall through to the rect/eraser tools below in edit mode, same key,
      // no conflict since Reset/step-forward are only meaningful once a run
      // exists (stopped/paused) anyway.
      if (!mod) {
        const rt = useRuntimeStore.getState()
        if (matchesCombo(e, resolveCombo('sim.playPause'))) {
          e.preventDefault()
          if (rt.mode === 'running') pause()
          else play(pageId)
          return
        }
        if (matchesCombo(e, resolveCombo('sim.stepBack'))) {
          if (rt.mode === 'paused') {
            e.preventDefault()
            stepBack()
          }
          return
        }
        if (matchesCombo(e, resolveCombo('sim.stepForward')) && rt.mode === 'paused') {
          e.preventDefault()
          stepFrame()
          return
        }
        if (matchesCombo(e, resolveCombo('sim.reset')) && rt.mode !== 'edit') {
          e.preventDefault()
          stop()
          return
        }
      }
      if (mod || locked) return

      // "/" on empty canvas opens the quick-insert menu at the pointer —
      // same registry the Ctrl+K search uses.
      if (matchesCombo(e, resolveCombo('tool.quickInsert'))) {
        e.preventDefault()
        const rect = containerRef.current?.getBoundingClientRect()
        const lp = lastPointerRef.current
        const clientX = lp?.clientX ?? (rect ? rect.left + rect.width / 2 : 0)
        const clientY = lp?.clientY ?? (rect ? rect.top + rect.height / 2 : 0)
        setSlash({
          screen: toLocal(clientX, clientY),
          canvas: toCanvas(clientX, clientY),
        })
        return
      }

      const toolAction = ACTIONS.find(
        (a) => a.group === 'Tools' && a.id !== 'tool.quickInsert' && matchesCombo(e, resolveCombo(a.id))
      )
      if (toolAction) {
        const tool = toolAction.id.replace(/^tool\./, '') as Tool
        store.setTool(tool === 'table' ? 'table' : tool)
      }
```

Note: `edit.redo` is checked before `edit.undo` because the original code checked `e.shiftKey` inside a single mod+Z branch — `resolveCombo('edit.redo')` has `mods: ['mod', 'shift']` and `resolveCombo('edit.undo')` has `mods: ['mod']`, and `matchesCombo` requires an exact modifier match, so checking redo first (more specific) then undo (less specific) preserves the original branching without needing an `if/else`.

Note: the `toolAction` lookup maps action id suffixes (`tool.select` → `'select'`, `tool.table` → `'table'`) directly to `Tool` string values — this holds because every `tool.*` id in `ACTIONS` (Task 1) was named to match its `Tool` value exactly (`select`, `pen`, `shaper`, `eraser`, `circle`, `line`, `text`, `note`, `formula`, `graph`, `table`, `code`, `rect`). The `tool === 'table' ? 'table' : tool` conditional is dead code that step simplifies away — write it as plain `store.setTool(tool)` instead:

```ts
      const toolAction = ACTIONS.find(
        (a) => a.group === 'Tools' && a.id !== 'tool.quickInsert' && matchesCombo(e, resolveCombo(a.id))
      )
      if (toolAction) {
        store.setTool(toolAction.id.replace(/^tool\./, '') as Tool)
      }
```

- [ ] **Step 3: Update the `onKeyUp` handler to match the same combos**

Replace the existing `onKeyUp` (currently lines 1356-1359):

```ts
    const onKeyUp = (e: KeyboardEvent) => {
      if (matchesCombo(e, resolveCombo('view.pan'))) spaceRef.current = false
      if (matchesCombo(e, resolveCombo('view.measure'))) setAltHeld(false)
    }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "canvas.tsx"`
Expected: no errors. If `Tool` type errors appear on the `toolAction.id.replace(...)` cast, check `Tool`'s exact union in `lib/scene/types.ts` (or wherever it's defined) and adjust the `tool.*` action ids in Task 1 to match exactly — this is the one place where a naming mismatch between the registry and the existing `Tool` type would surface.

- [ ] **Step 5: Manual verification (no rebind yet — confirm zero behavior change)**

Run the dev server (`npm run dev` or the project's existing run command) and on a board page: press `v` (selects Select tool), `p` (Pen tool), `Escape` (deselects), `Ctrl+Z`/`Cmd+Z` (undo, if there's history), `Ctrl+Shift+Z` (redo), `/` (opens quick-insert). All should behave exactly as before this change, since no rebind exists yet.

- [ ] **Step 6: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add components/workspace/canvas.tsx
git commit -m "Rewire canvas.tsx key handling through the keymap registry

Every e.key === literal check becomes matchesCombo(e, resolveCombo(id))
so a rebind in Settings actually changes behavior. Surrounding gating
logic (locked, isTyping, sim mode checks) is untouched — mechanical
swap only, no behavior change for anyone who hasn't rebound a key."
```

---

### Task 5: Rewire `shell.tsx` keyboard handling, fix the `'shortcuts'`/`'hotkeys'` tab-id mismatch

**Files:**
- Modify: `components/workspace/shell.tsx:437-457`

**Interfaces:**
- Consumes: `matchesCombo`, `resolveCombo` from `lib/keymap.ts` (Task 1).

- [ ] **Step 1: Replace the handler**

Replace lines 443-453:

```ts
    const onKey = (e: KeyboardEvent) => {
      if (matchesCombo(e, resolveCombo('view.search'))) {
        e.preventDefault()
        setCommandOpen((o) => !o)
        return
      }
      if (matchesCombo(e, resolveCombo('view.shortcuts')) && !isTyping(e.target)) {
        e.preventDefault()
        setSettingsTab('hotkeys')
        setSettingsOpen(true)
      }
    }
```

This also fixes a pre-existing bug found during research: `setSettingsTab('shortcuts')` passed a tab id that doesn't match any entry in `settings-dialog.tsx`'s `NAV_ITEMS` (whose id is `'hotkeys'`), so pressing `?` opened Settings on the General tab instead of Hotkeys. `'hotkeys'` is the correct id.

- [ ] **Step 2: Add the import**

```ts
import { matchesCombo, resolveCombo } from '@/lib/keymap'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "shell.tsx"`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run the dev server, press `Cmd+K`/`Ctrl+K` (opens command palette), press `?` outside any input (opens Settings on the Hotkeys tab — confirm it's Hotkeys, not General, verifying the tab-id fix).

- [ ] **Step 5: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add components/workspace/shell.tsx
git commit -m "Rewire shell.tsx key handling through the keymap registry

Also fixes '?' opening Settings on General instead of Hotkeys —
setSettingsTab('shortcuts') never matched NAV_ITEMS' 'hotkeys' id."
```

---

### Task 6: Gesture thresholds — `hooks/use-pinch-zoom.ts`

**Files:**
- Modify: `hooks/use-pinch-zoom.ts`

**Interfaces:**
- Consumes: `gesturePrefs()` from `lib/store/preferences.ts` (Task 2), `isPalmTouch` from `lib/pointer/palm-reject.ts` (Task 3).
- Produces: no interface change — `usePinchZoom(ref, handlers)` signature and `PinchHandlers` are unchanged, so `doc-view.tsx`/`pdf-view.tsx` call sites need zero modification.

- [ ] **Step 1: Replace the hardcoded radius and add sensitivity**

Replace lines 26-44 (imports through `fingerTouches`):

```ts
import { useEffect, useRef, type RefObject } from 'react'
import { penActive } from '@/lib/pointer/pen-active'
import { isPalmTouch } from '@/lib/pointer/palm-reject'
import { gesturePrefs } from '@/lib/store/preferences'

const fingerTouches = (list: TouchList, radiusPx: number) => {
  const out: Touch[] = []
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    if (!isPalmTouch(t, radiusPx)) out.push(t)
  }
  return out
}
```

Remove the now-unused `PALM_RADIUS` constant and `touchRadius` function (previously lines 29-35) — their logic moved into `isPalmTouch`.

- [ ] **Step 2: Thread the radius through the three `fingerTouches` call sites, and apply sensitivity to the ratio**

In the `useEffect` body (previously lines 70-127), update:

```ts
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let baselineDist = 0

    const rebaseline = (fingers: Touch[]) => {
      const { dist, cx, cy } = midpoint(fingers)
      baselineDist = dist
      h.current.onStart(cx, cy)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (penActive.current) return
      const fingers = fingerTouches(e.touches, gesturePrefs().palmRejectRadiusPx)
      if (fingers.length !== 2) return
      e.preventDefault()
      rebaseline(fingers)
    }

    const onTouchMove = (e: TouchEvent) => {
      if (penActive.current) {
        baselineDist = 0
        return
      }
      const fingers = fingerTouches(e.touches, gesturePrefs().palmRejectRadiusPx)
      if (fingers.length !== 2) return
      e.preventDefault()
      if (baselineDist <= 0) {
        rebaseline(fingers)
        return
      }
      const { dist, cx, cy } = midpoint(fingers)
      const rawRatio = dist / baselineDist
      // Sensitivity scales the DEVIATION from 1 (no zoom change), not the
      // raw ratio itself — scaling the raw ratio would make sensitivity 0
      // freeze at ratio 0 (zoomed to nothing) instead of "no zoom change".
      const ratio = 1 + (rawRatio - 1) * gesturePrefs().pinchSensitivity
      h.current.onMove(ratio, cx, cy)
    }

    const onTouchEnd = (e: TouchEvent) => {
      baselineDist = 0
      const fingers = fingerTouches(e.touches, gesturePrefs().palmRejectRadiusPx)
      if (fingers.length === 2) rebaseline(fingers)
      else h.current.onEnd?.()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [ref])
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "use-pinch-zoom"`
Expected: no errors.

- [ ] **Step 4: Manual verification**

On a touch device or Chrome DevTools touch emulation, open a Doc or PDF page and pinch-zoom — confirm it still works identically with `pinchSensitivity` at its default of 1. (Full sensitivity-slider verification happens in Task 8 once the Settings UI exists.)

- [ ] **Step 5: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add hooks/use-pinch-zoom.ts
git commit -m "Read palm rejection radius and pinch sensitivity from prefs

use-pinch-zoom.ts's hardcoded PALM_RADIUS and implicit sensitivity=1
now come from gesturePrefs(), so the upcoming Gestures settings tab
actually affects DocView/PdfView pinch-zoom, not just the canvas."
```

---

### Task 7: Gesture thresholds — `canvas.tsx` pinch/drag-hold

**Files:**
- Modify: `components/workspace/canvas.tsx` (constants at ~293-300, pointer-pinch at ~2258, ctrl+wheel at ~1183, Safari gesture at ~1225, drag-hold at ~2700-2712, tap-vs-drag check at ~2412)

**Interfaces:**
- Consumes: `gesturePrefs()` from `lib/store/preferences.ts` (Task 2), `isPalmTouch` from `lib/pointer/palm-reject.ts` (Task 3, added defensively — see Step 4).

- [ ] **Step 1: Remove the hardcoded drag-hold constants, keep ink-hold constants as-is**

`HOLD_MS`/`HOLD_STILL_PX` (ink-to-shape upgrade timing) are OUT OF SCOPE per the design doc's non-goals — leave them untouched. Only `DRAG_HOLD_MS`/`DRAG_HOLD_STILL_PX` (touch object-drag timing) move to prefs.

Remove lines 296-300:

```ts
// (deleted — DRAG_HOLD_MS and DRAG_HOLD_STILL_PX now come from gesturePrefs())
```

Keep lines 291-294 (`HOLD_MS`, `HOLD_STILL_PX`) exactly as they are.

- [ ] **Step 2: Add the import**

```ts
import { gesturePrefs } from '@/lib/store/preferences'
```

(If `usePrefs` is already imported from `@/lib/store/preferences` in this file — confirmed it is, e.g. `usePrefs.getState().notebook.lockZoom` — add `gesturePrefs` to that same import line rather than a new one.)

- [ ] **Step 3: Replace the two `DRAG_HOLD_*` use sites**

At the drag-hold timer (previously referencing `DRAG_HOLD_MS`, around line 2707-2710):

```ts
        timer: setTimeout(() => {
          dragHoldRef.current = null
          beginGesture('move', e, { clickedId })
        }, gesturePrefs().holdBeforeDragMs),
```

At the tap-vs-drag distance check (previously referencing `DRAG_HOLD_STILL_PX`, around line 2412):

```ts
    if (dh && Math.hypot(e.clientX - dh.x, e.clientY - dh.y) > gesturePrefs().tapVsDragPx) clearDragHold()
```

- [ ] **Step 4: Apply `pinchSensitivity` to all three pinch-ratio computations**

At the ctrl+wheel zoom (previously line 1183):

```ts
        const zoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * 0.0022 * gesturePrefs().pinchSensitivity))
        )
```

At the Safari `gesturechange` zoom (previously line 1225) — apply sensitivity the same "scale the deviation from 1" way as Task 6, since `ge.scale` is a ratio like `dist/baseline`:

```ts
      const sensitivity = gesturePrefs().pinchSensitivity
      const scaledScale = 1 + (ge.scale - 1) * sensitivity
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStartZoom * scaledScale))
```

At the pointer-based pinch (previously line 2258), same treatment since `dist / p.dist` is also a ratio around 1:

```ts
      const [a, b] = [...touches.values()]
      const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1)
      const rawRatio = dist / p.dist
      const ratio = 1 + (rawRatio - 1) * gesturePrefs().pinchSensitivity
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, p.viewport.zoom * ratio))
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "canvas.tsx"`
Expected: no errors.

- [ ] **Step 6: Manual verification**

On the dev server, on a board page: two-finger trackpad pinch zooms the canvas (ctrl+wheel path); on a touch device or emulator, pinch-zoom works and touch-and-hold on an object still starts a drag after ~150ms; a quick swipe across an object still scrolls/pans instead of dragging it. All identical to pre-change behavior since `gesturePrefs()` returns the same defaults.

- [ ] **Step 7: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add components/workspace/canvas.tsx
git commit -m "Read drag-hold timing and pinch sensitivity from prefs in canvas.tsx

DRAG_HOLD_MS/DRAG_HOLD_STILL_PX and all three pinch-ratio computations
(pointer pinch, ctrl+wheel, Safari gesturechange) now read from
gesturePrefs() instead of hardcoded constants, so the same Settings
sliders that affect DocView/PdfView pinch also affect the canvas.
HOLD_MS/HOLD_STILL_PX (ink-to-shape timing) are unrelated and untouched."
```

---

### Task 8: Settings UI — rebindable Hotkeys tab

**Files:**
- Modify: `components/workspace/settings-dialog.tsx`

**Interfaces:**
- Consumes: `ACTIONS`, `SHORTCUT_GROUPS`, `resolveCombo`, `comboLabel`, `comboFromEvent`, `findCollision` from `lib/keymap.ts` (Task 1); `usePrefs`'s `hotkeys.overrides` and `setHotkeys` from `lib/store/preferences.ts` (Task 2).
- Produces: no new exports — internal UI change only.

- [ ] **Step 1: Fix the import (was importing the now-deleted `lib/shortcuts.ts`)**

Replace line 71:

```ts
import { ACTIONS, SHORTCUT_GROUPS, resolveCombo, comboLabel, comboFromEvent, findCollision } from '@/lib/keymap'
```

- [ ] **Step 2: Write a small local `HotkeyRow` component and the listening-state hook, above the main `SettingsDialog` export**

Add near the top of the file, after the existing imports:

```tsx
function HotkeyRow({ actionId, label, when }: { actionId: string; label: string; when?: string }) {
  const overrides = usePrefs((s) => s.hotkeys.overrides)
  const setHotkeys = usePrefs((s) => s.setHotkeys)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const combo = resolveCombo(actionId)
  const hasOverride = actionId in overrides

  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setListening(false)
        return
      }
      // Ignore bare modifier presses — wait for the actual key.
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return
      const next = comboFromEvent(e)
      const collision = findCollision(next, actionId)
      if (collision) {
        setError(`Already used by ${collision.label}`)
        return
      }
      setHotkeys({ overrides: { ...overrides, [actionId]: next } })
      setListening(false)
      setError(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, actionId, overrides, setHotkeys])

  return (
    <ObsidianPrefRow
      label={label}
      detail={
        when === 'while-editing' ? 'Only while editing' :
        when === 'while-paused' ? 'Only while paused' :
        when === 'while-running-or-paused' ? 'Only once a run exists' :
        undefined
      }
      action={
        <div className="flex items-center gap-1.5">
          {error && <span className="text-[0.6875rem] text-destructive">{error}</span>}
          <button
            type="button"
            onClick={() => {
              setError(null)
              setListening(true)
            }}
            className="rounded-sm"
          >
            <Kbd className={listening ? 'ring-2 ring-ring' : undefined}>
              {listening ? 'Press a key…' : comboLabel(combo)}
            </Kbd>
          </button>
          {hasOverride && (
            <button
              type="button"
              aria-label={`Reset ${label} to default`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                const next = { ...overrides }
                delete next[actionId]
                setHotkeys({ overrides: next })
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      }
    />
  )
}
```

`RotateCcw` is already imported in this file (used elsewhere per the existing icon import block) — reuse it, no new import needed. Confirm this during Step 4's typecheck; if it's not already imported, add `RotateCcw` to the existing `lucide-react` import list.

- [ ] **Step 3: Replace the Hotkeys tab render block**

Replace the existing block (previously lines 1045-1059):

```tsx
            {activeTab === 'hotkeys' && (
              <div className="space-y-4">
                {SHORTCUT_GROUPS.map((group) => (
                  <SettingCard key={group} title={group}>
                    {ACTIONS.filter((a) => a.group === group).map((a) => (
                      <HotkeyRow key={a.id} actionId={a.id} label={a.label} when={a.when} />
                    ))}
                  </SettingCard>
                ))}
                <button
                  type="button"
                  className="text-[0.75rem] font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => usePrefs.getState().setHotkeys({ overrides: {} })}
                >
                  Reset all to defaults
                </button>
              </div>
            )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "settings-dialog"`
Expected: no errors. If `RotateCcw` isn't already imported, add it to the existing lucide-react import block (Task 8, Step 2 note).

- [ ] **Step 5: Manual verification**

Run the dev server, open Settings → Hotkeys. Confirm: every action shows its current combo; clicking a combo shows "Press a key…"; pressing a free key rebinds it (button updates to the new label); pressing a key already used by another action shows the collision error and does NOT change the binding; pressing Escape while listening cancels without changing anything; the per-row reset icon appears only on rebound rows and clears just that one; "Reset all to defaults" clears everything. Then confirm the rebind actually WORKS: rebind `tool.select` (default `v`) to `j`, close Settings, on the canvas press `j` — the Select tool activates; press `v` — nothing happens (no longer bound).

- [ ] **Step 6: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add components/workspace/settings-dialog.tsx
git commit -m "Make the Hotkeys settings tab actually rebind keys

Was read-only display pulled from the disconnected lib/shortcuts.ts.
Now renders from the real keymap registry: click a binding, press a
new key, collisions with other actions are blocked at save time, and
each row (or all of them) can reset to default."
```

---

### Task 9: Settings UI — new Gestures tab

**Files:**
- Modify: `components/workspace/settings-dialog.tsx`

**Interfaces:**
- Consumes: `usePrefs`'s `gestures` slice and `setGestures` from `lib/store/preferences.ts` (Task 2); existing `Slider`, `SettingCard`, `ObsidianPrefRow` components.
- Produces: no new exports — internal UI change only.

- [ ] **Step 1: Add `'gestures'` to `TabId`**

Modify the `TabId` union (previously lines 716-729), inserting after `'hotkeys'`:

```ts
type TabId =
  | 'general'
  | 'appearance'
  | 'interface'
  | 'dock'
  | 'editor'
  | 'files'
  | 'hotkeys'
  | 'gestures'
  | 'math'
  | 'packages'
  | 'pen'
  | 'simulation'
  | 'about'
```

- [ ] **Step 2: Add the `NAV_ITEMS` entry**

Modify `NAV_ITEMS` (previously lines 738-751), inserting after the `'hotkeys'` entry:

```ts
  { id: 'hotkeys', label: 'Hotkeys', detail: 'Keyboard shortcuts', icon: Keyboard, category: 'options' },
  { id: 'gestures', label: 'Gestures', detail: 'Pinch, hold & drag feel', icon: Hand, category: 'options' },
```

Add `Hand` to the existing `lucide-react` import block near the top of the file (alongside `Keyboard`, `Calculator`, etc.).

- [ ] **Step 3: Add a `GestureSettings` component and its tab render**

Add near the other tab-content components in this file (e.g. near where `MathSettings`/`PackagesSettings` are defined — follow the existing pattern of one function per tab):

```tsx
function GestureSettings() {
  const gestures = usePrefs((s) => s.gestures)
  const setGestures = usePrefs((s) => s.setGestures)

  return (
    <div className="space-y-4">
      <SettingCard title="Pinch & Touch Feel">
        <ObsidianPrefRow
          label="Pinch Sensitivity"
          detail={`How strongly a pinch gesture zooms. ${gestures.pinchSensitivity.toFixed(2)}× (default 1.00×).`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Pinch sensitivity"
              value={[gestures.pinchSensitivity]}
              min={0.5}
              max={2}
              step={0.05}
              onValueChange={([v]) => setGestures({ pinchSensitivity: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Hold Before Drag"
          detail={`Delay before a touch-and-hold starts moving an object, so a quick swipe can still scroll. ${gestures.holdBeforeDragMs}ms (default 150ms).`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Hold before drag"
              value={[gestures.holdBeforeDragMs]}
              min={50}
              max={500}
              step={10}
              onValueChange={([v]) => setGestures({ holdBeforeDragMs: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Tap vs. Drag Distance"
          detail={`How far a touch must travel to count as a swipe instead of a drag. ${gestures.tapVsDragPx}px (default 8px).`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Tap vs drag distance"
              value={[gestures.tapVsDragPx]}
              min={2}
              max={24}
              step={1}
              onValueChange={([v]) => setGestures({ tapVsDragPx: v })}
            />
          </div>
        </ObsidianPrefRow>

        <ObsidianPrefRow
          label="Palm Rejection Radius"
          detail={`Touch contact size above which it's ignored as a resting palm instead of a fingertip. ${gestures.palmRejectRadiusPx}px (default 20px, 0 disables).`}
        >
          <div className="w-40 sm:w-56 md:w-64">
            <Slider
              aria-label="Palm rejection radius"
              value={[gestures.palmRejectRadiusPx]}
              min={0}
              max={60}
              step={2}
              onValueChange={([v]) => setGestures({ palmRejectRadiusPx: v })}
            />
          </div>
        </ObsidianPrefRow>
      </SettingCard>

      <button
        type="button"
        className="text-[0.75rem] font-medium text-muted-foreground hover:text-foreground"
        onClick={() => usePrefs.getState().setGestures({ ...DEFAULT_GESTURES })}
      >
        Reset to defaults
      </button>
    </div>
  )
}
```

Import `DEFAULT_GESTURES` alongside the other `lib/store/preferences` imports already in this file.

Add the tab render, near the existing `{activeTab === 'hotkeys' && (...)}` block:

```tsx
            {activeTab === 'gestures' && <GestureSettings />}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip 2>&1 | grep -i "settings-dialog"`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run the dev server, open Settings — confirm a "Gestures" tab appears right after "Hotkeys" with the `Hand` icon. Open it, drag "Palm Rejection Radius" to 0, then on a touch device/emulator confirm a wide simulated touch (if emulator supports contact radius) is no longer rejected. Drag "Hold Before Drag" to 500ms, confirm touch-drag on a canvas object now takes noticeably longer to commit. Drag "Pinch Sensitivity" to 2×, confirm a small pinch gesture zooms much further than before. Click "Reset to defaults", confirm all four sliders return to their default positions.

- [ ] **Step 6: Commit**

```bash
cd /home/diablo/Documents/GitHub/simblip
git add components/workspace/settings-dialog.tsx
git commit -m "Add Gestures settings tab

Four sliders (pinch sensitivity, hold-before-drag, tap-vs-drag
distance, palm rejection radius) writing to the GesturePrefs slice
added in an earlier commit, which canvas.tsx and use-pinch-zoom.ts
already read from."
```

---

### Task 10: Full-app verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit -p /home/diablo/Documents/GitHub/simblip`
Expected: zero errors anywhere in the project.

- [ ] **Step 2: Grep for any remaining references to the deleted `lib/shortcuts.ts`**

Run: `grep -rn "lib/shortcuts\|from '@/lib/shortcuts'" /home/diablo/Documents/GitHub/simblip --include=*.ts --include=*.tsx | grep -v node_modules`
Expected: no results.

- [ ] **Step 3: Grep for any remaining hardcoded gesture constants that should have moved to prefs**

Run: `grep -n "DRAG_HOLD_MS\|DRAG_HOLD_STILL_PX\|PALM_RADIUS" /home/diablo/Documents/GitHub/simblip/components/workspace/canvas.tsx /home/diablo/Documents/GitHub/simblip/hooks/use-pinch-zoom.ts`
Expected: no results (both fully replaced by `gesturePrefs()` reads).

- [ ] **Step 4: End-to-end manual pass**

On the running dev server:
1. Settings → Hotkeys: rebind `edit.undo` (default Cmd/Ctrl+Z) to `Cmd/Ctrl+Shift+U`. Close Settings. On a board, make an edit, press old Ctrl+Z (nothing happens), press new binding (undo fires).
2. Try to rebind `edit.redo` to the same key `tool.select` already uses (`v`, no mods) — confirm the collision error appears and nothing saves.
3. Settings → Gestures: move all four sliders to non-default values, close Settings, reopen it — confirm the values persisted (localStorage round-trip through the bumped `version: 4` store).
4. Reload the page entirely (hard refresh) — confirm both the hotkey rebind and gesture slider values survived (persist + migrate working correctly).
5. Press `?` outside any text input — confirm Settings opens directly on the Hotkeys tab (regression check for the tab-id fix in Task 5).

- [ ] **Step 5: Final commit (only if any fixups were needed in this task)**

If Steps 1-4 surfaced any issues, fix them and commit with a message describing what verification caught. If everything passed cleanly, no commit needed for this task — it's verification-only.
