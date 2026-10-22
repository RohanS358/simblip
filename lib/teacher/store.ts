'use client'

// What the teacher is doing right now. The lesson stage sets these as it works (points at a
// formula, asks a question, hears a wrong answer); the painter eases her towards them.

import { create } from 'zustand'
import type { Mood, Pose, Pt } from './rig'

interface TeacherState {
  /** Shown beside the board during a lesson. */
  visible: boolean
  mood: Mood
  pose: Pose
  /** Screen point she is pointing at / looking towards while `pose` is 'point'. */
  aim: Pt | null
  set: (p: Partial<Omit<TeacherState, 'set'>>) => void
}

export const useTeacher = create<TeacherState>((set) => ({
  visible: true,
  mood: 'happy',
  pose: 'read',
  aim: null,
  set: (p) => set(p),
}))
