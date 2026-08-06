// Bridges the Properties panel to whichever text box is actively being
// edited on the canvas, so panel controls (bold, highlight, color…) can
// apply a style MARK (see lib/text/marks.ts — an offset range over the
// text, never a delimiter character) to the live selection inside that
// box's contentEditable — the panel lives in a different part of the DOM
// tree entirely, so it can't reach the editor any other way. Registered by
// RichTextArea (components/objects/text.tsx) while `editing` is true.

import { create } from 'zustand'
import type { MarkKind } from '@/lib/text/marks'

export interface TextEditorHandle {
  /** Toggles `kind` (bold/italic/underline/strike/highlight/code) over the
   *  current selection — applying it again over the exact same range turns
   *  it back off, the standard "click Bold on bold text" behavior. No-op on
   *  a collapsed caret (nothing selected to mark) or a cross-line selection. */
  toggleMark: (kind: MarkKind) => void
  /** Prefixes the active LINE (heading, list marker, quote…) — block type
   *  stays plain text on the line, unlike the inline marks above. */
  prefixLine: (prefix: string) => void
  /** Applies an exclusive "pick one value" mark (size/color/font/weight) to
   *  the current selection — clips/replaces any existing mark of the SAME
   *  kind already covering the selection instead of stacking (so a later
   *  size always wins over an earlier one on the same text), and keeps the
   *  applied range selected afterward so clicking a stepper/swatch
   *  repeatedly adjusts the SAME range. If a selection was captured via
   *  snapshotSelection() and not yet consumed, uses that instead of
   *  re-reading window.getSelection() live — see snapshotSelection's doc
   *  comment for why. */
  setSpan: (kind: 'size' | 'color' | 'font' | 'weight' | 'link', value: string) => void
  /** Remembers the CURRENT live text selection so a later setSpan() call can
   *  use it even after focus has moved elsewhere. Needed for controls that
   *  must themselves take focus to work — the Size field's number input,
   *  which you have to type into — because focusing any real <input>
   *  collapses window.getSelection() out of the contentEditable, and no
   *  amount of preventDefault on its own pointerdown stops that (unlike a
   *  plain <button>, which never needs focus to register a click). Call this
   *  on the input's onFocus/onPointerDown, BEFORE the browser's focus-shift
   *  actually lands, then setSpan() on blur/Enter consumes and clears it. */
  snapshotSelection: () => void
}

export const useActiveTextEditor = create<{
  objectId: string | null
  handleRef: React.RefObject<TextEditorHandle | null> | null
  set: (objectId: string, handleRef: React.RefObject<TextEditorHandle | null>) => void
  clear: (objectId: string) => void
}>((set, get) => ({
  objectId: null,
  handleRef: null,
  set: (objectId, handleRef) => set({ objectId, handleRef }),
  clear: (objectId) => {
    if (get().objectId === objectId) set({ objectId: null, handleRef: null })
  },
}))
