import { create } from 'zustand'

/** Which canvas object a picker row is pointing at right now — the object
 *  glows (canvas.tsx ObjectView) so you can SEE what a dropdown entry means. */
export const useHoverHighlight = create<{ id: string | null; set: (id: string | null) => void }>((set) => ({
  id: null,
  set: (id) => set({ id }),
}))
