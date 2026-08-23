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
  group: 'Tools' | 'Simulation' | 'Edit' | 'View' | 'Panels'
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

  { id: 'edit.selectAll', label: 'Select all on the page', group: 'Edit', default: { key: 'a', mods: ['mod'] } },

  // View
  { id: 'view.pan', label: 'Pan (hold + drag, or two fingers)', group: 'View', default: { key: ' ', mods: [] } },
  { id: 'view.measure', label: 'Hold to measure', group: 'View', default: { key: 'alt', mods: [] } },
  { id: 'view.search', label: 'Search everything', group: 'View', default: { key: 'k', mods: ['mod'] } },
  { id: 'view.shortcuts', label: 'This shortcuts list', group: 'View', default: { key: '?', mods: [] } },

  // Panels — every side surface is reachable from the keyboard. Bracket keys
  // for the two rails (the Figma/VS Code convention: [ left, ] right), and
  // mod-digit for the overlays.
  { id: 'panel.sidebar', label: 'Toggle the left sidebar', group: 'Panels', default: { key: '[', mods: ['mod'] } },
  { id: 'panel.inspector', label: 'Toggle Properties', group: 'Panels', default: { key: ']', mods: ['mod'] } },
  { id: 'panel.calculator', label: 'Toggle the calculator', group: 'Panels', default: { key: '1', mods: ['mod'] } },
  { id: 'panel.notes', label: 'Toggle the Note Gallery', group: 'Panels', default: { key: 'n', mods: ['mod'] } },
  { id: 'panel.zen', label: 'Hide every panel (zen mode)', group: 'Panels', default: { key: '.', mods: ['mod'] } },

  // Zoom — present on every device, but these are the keyboard path.
  { id: 'view.zoomIn', label: 'Zoom in', group: 'View', default: { key: '=', mods: ['mod'] } },
  { id: 'view.zoomOut', label: 'Zoom out', group: 'View', default: { key: '-', mods: ['mod'] } },
  { id: 'view.zoomReset', label: 'Reset zoom to 100%', group: 'View', default: { key: '0', mods: ['mod'] } },
  { id: 'view.zoomFit', label: 'Zoom to fit the page', group: 'View', default: { key: '9', mods: ['mod'] } },
]

export const SHORTCUT_GROUPS: ShortcutAction['group'][] = [
  'Tools',
  'Simulation',
  'Edit',
  'View',
  'Panels',
]

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** True if the event's key + modifier state matches combo exactly.
 *  'mod' means Cmd on Mac, Ctrl elsewhere — same normalization every
 *  existing handler already did ad-hoc via `e.metaKey || e.ctrlKey`. */
export function matchesCombo(e: KeyboardEvent, combo: KeyCombo): boolean {
  const key = e.key.toLowerCase()
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
  const key = e.key.toLowerCase()
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
