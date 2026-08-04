// Bridges the Properties panel to whichever text box is actively being
// edited on the canvas, so panel controls (bold, highlight, color…) can
// apply markdown formatting to the live selection inside that box's
// contentEditable — the panel lives in a different part of the DOM tree
// entirely, so it can't reach the editor any other way. Registered by
// RichTextArea (components/objects/text.tsx) while `editing` is true.

import { create } from 'zustand'

export interface TextEditorHandle {
  /** Wraps the current selection (or inserts at the caret) with markdown
   *  delimiters — e.g. `wrap('**')` for bold, `wrap('[', ']{color=blue}')`
   *  for a color span. Applies to the live selection only. */
  wrap: (before: string, after?: string) => void
  /** Prefixes the active LINE (heading, list marker, quote…). */
  prefixLine: (prefix: string) => void
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
