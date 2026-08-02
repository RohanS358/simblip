// Shortcut reference — display only. Each shortcut below is still owned and
// implemented by its own existing keydown listener (canvas.tsx's global key
// map, undo-redo.tsx, shell.tsx's Cmd/Ctrl+K) — this file doesn't rewire any
// of them, it's just the one place that lists what already exists, so a `?`
// cheat sheet has something to render instead of nothing (UX masterplan §12).
// If this list keeps growing, promote it to a real registry the handlers
// register into (catches collisions at authoring time) — not needed yet.

export interface ShortcutEntry {
  keys: string
  label: string
  group: 'Tools' | 'Simulation' | 'Edit' | 'View'
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: 'V', label: 'Select', group: 'Tools' },
  { keys: 'P', label: 'Pen', group: 'Tools' },
  { keys: 'S', label: 'Shaper', group: 'Tools' },
  { keys: 'E', label: 'Eraser (while editing)', group: 'Tools' },
  { keys: 'C', label: 'Circle', group: 'Tools' },
  { keys: 'L', label: 'Line', group: 'Tools' },
  { keys: 'T', label: 'Text', group: 'Tools' },
  { keys: 'N', label: 'Note', group: 'Tools' },
  { keys: 'F', label: 'Formula', group: 'Tools' },
  { keys: 'G', label: 'Graph', group: 'Tools' },
  { keys: 'B', label: 'Grid Table', group: 'Tools' },
  { keys: 'K', label: 'Code', group: 'Tools' },
  { keys: 'R', label: 'Rectangle (while editing)', group: 'Tools' },
  { keys: '/', label: 'Quick-insert menu at the cursor', group: 'Tools' },
  { keys: 'Q', label: 'Play / Pause', group: 'Simulation' },
  { keys: 'W', label: 'Step back (while paused)', group: 'Simulation' },
  { keys: 'E', label: 'Step forward (while paused)', group: 'Simulation' },
  { keys: 'R', label: 'Reset (while paused or stopped)', group: 'Simulation' },
  { keys: 'Esc', label: 'Deselect, back to Select', group: 'Edit' },
  { keys: 'Delete / Backspace', label: 'Delete selection', group: 'Edit' },
  { keys: 'Ctrl/⌘ Z', label: 'Undo', group: 'Edit' },
  { keys: 'Ctrl/⌘ ⇧ Z', label: 'Redo', group: 'Edit' },
  { keys: 'Ctrl/⌘ C', label: 'Copy', group: 'Edit' },
  { keys: 'Ctrl/⌘ X', label: 'Cut', group: 'Edit' },
  { keys: 'Ctrl/⌘ V', label: 'Paste', group: 'Edit' },
  { keys: 'Space + drag', label: 'Pan (or two fingers)', group: 'View' },
  { keys: 'Scroll / pinch', label: 'Zoom', group: 'View' },
  { keys: 'Ctrl/⌘ K', label: 'Search everything', group: 'View' },
  { keys: '?', label: 'This shortcuts list', group: 'View' },
]

export const SHORTCUT_GROUPS: ShortcutEntry['group'][] = ['Tools', 'Simulation', 'Edit', 'View']
