'use client'

// Live state of the lesson being played — what the overlay renders. Not
// persisted: a film is replayed, not resumed.

import { create } from 'zustand'
import type { Beat, Storyboard } from './storyboard'
import type { Section } from './sections'

export type PredictBeat = Extract<Beat, { t: 'predict' }>

interface LessonState {
  active: boolean
  storyboard: Storyboard | null
  pageId: string | null
  index: number
  paused: boolean
  caption: string
  /** How many characters of `caption` have been spoken — the caption writes itself out to match the voice. */
  spoken: number
  card: { text: string; sub?: string } | null
  /** A prediction waiting for the student. */
  pending: PredictBeat | null
  chosen: number | null
  /** The board's sections, in the order they were opened. Kept for the whole film. */
  sections: Section[]
  /** A film being generated: what the director is doing now. */
  preparing: { topic: string; message: string } | null
  set: (p: Partial<Omit<LessonState, 'set'>>) => void
}

export const useLesson = create<LessonState>((set) => ({
  active: false,
  storyboard: null,
  pageId: null,
  index: 0,
  paused: false,
  caption: '',
  spoken: 0,
  card: null,
  pending: null,
  chosen: null,
  sections: [],
  preparing: null,
  set: (p) => set(p),
}))
