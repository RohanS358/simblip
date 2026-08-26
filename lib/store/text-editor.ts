// Bridges the Properties panel to whichever text box is actively being
// edited on the canvas, so panel controls (bold, highlight, color…) can act
// on the live selection inside that box — the panel lives in a different
// part of the DOM tree entirely, so it can't reach the editor any other way.
// Registered by RichTextArea (components/objects/text.tsx) while `editing`
// is true.
//
// This used to carry a four-method handle (toggleMark / prefixLine / setSpan
// / snapshotSelection) built by hand on every render. All four are gone: a
// Tiptap command acts on the editor's OWN stored selection, which — unlike
// window.getSelection() — survives an <input> in the panel taking focus. The
// entire snapshot/restore state machine that existed only to work around
// that existed only because the old engine had no document selection of its
// own. See docs/tiptap-text-engine-plan.md §Phase D.

import { create } from 'zustand'
import type { Editor } from '@tiptap/react'

export const useActiveTextEditor = create<{
  objectId: string | null
  editor: Editor | null
  set: (objectId: string, editor: Editor | null) => void
  clear: (objectId: string) => void
}>((set, get) => ({
  objectId: null,
  editor: null,
  set: (objectId, editor) => set({ objectId, editor }),
  clear: (objectId) => {
    if (get().objectId === objectId) set({ objectId: null, editor: null })
  },
}))
