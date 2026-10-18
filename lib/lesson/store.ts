'use client'

// Live state of the lesson being played — what the overlay renders. Not
// persisted: a film is replayed, not resumed.

import { create } from 'zustand'
import type { Beat, Storyboard } from './storyboard'

export type PredictBeat = Extract<Beat, { t: 'predict' }>

interface LessonState {
  active: boolean
  storyboard: Storyboard | null
  pageId: string | null
  index: number
  paused: boolean
  caption: string
  card: { text: string; sub?: string } | null
  /** A prediction waiting for the student. */
  pending: PredictBeat | null
  chosen: number | null
  set: (p: Partial<Omit<LessonState, 'set'>>) => void
}

export const useLesson = create<LessonState>((set) => ({
  active: false,
  storyboard: null,
  pageId: null,
  index: 0,
  paused: false,
  caption: '',
  card: null,
  pending: null,
  chosen: null,
  set: (p) => set(p),
}))
