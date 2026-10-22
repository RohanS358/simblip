'use client'

// What the teacher is listening for right now: a circle on the board, a typed question, a
// "how is that going?" check, and how the student's answers have set the pace.

import { create } from 'zustand'
import { START_PACE, type Pace } from './tutor-core'

export interface Chip { id: string; label: string }
export interface Ring { left: number; top: number; width: number; height: number }

interface TutorState {
  /** idle · selecting (drawing a circle) · thinking · answering (waiting on a chip) · checkin */
  mode: 'idle' | 'selecting' | 'thinking' | 'answering' | 'checkin'
  /** Screen rectangle of what the teacher is explaining — drawn as a ring on the board. */
  ring: Ring | null
  chips: Chip[]
  /** A free-text question box is open. */
  typing: boolean
  pace: Pace
  missesInRow: number
  /** Beat index of the last check-in. */
  lastCheck: number
  /** Where the lesson was when it was interrupted; null when it is not. */
  resumeAt: number | null
  set: (p: Partial<Omit<TutorState, 'set'>>) => void
}

export const useTutor = create<TutorState>((set) => ({
  mode: 'idle',
  ring: null,
  chips: [],
  typing: false,
  pace: START_PACE,
  missesInRow: 0,
  lastCheck: 0,
  resumeAt: null,
  set: (p) => set(p),
}))

/** Resolver for whichever chip row is on screen. */
let waiting: ((id: string) => void) | null = null

/** Show a row of answers and wait for one (or for `timeoutMs`, which answers `fallback`). */
export function chooseChip(chips: Chip[], fallback: string, timeoutMs = 25_000): Promise<string> {
  return new Promise((resolve) => {
    const t = setTimeout(() => answerChip(fallback), timeoutMs)
    waiting = (id) => { clearTimeout(t); waiting = null; useTutor.getState().set({ chips: [] }); resolve(id) }
    useTutor.getState().set({ chips })
  })
}
export function answerChip(id: string) { waiting?.(id) }
/** Drop a pending choice without answering (the lesson was closed). */
export function cancelChoice() { waiting = null; useTutor.getState().set({ chips: [], typing: false }) }

let typed: ((text: string) => void) | null = null
export function waitForQuestion(): Promise<string> {
  return new Promise((resolve) => { typed = (t) => { typed = null; useTutor.getState().set({ typing: false }); resolve(t) }; useTutor.getState().set({ typing: true, chips: [] }) })
}
export function submitQuestion(text: string) { typed?.(text.trim()) }
