'use client'

import { create } from 'zustand'

export interface WalkthroughState {
  active: boolean
  currentActIndex: number
  currentStepIndex: number
  paused: boolean
  muted: boolean
  speed: number // Speed multiplier e.g. 0.5, 0.75, 1.0, 1.5
  subtitles: string
  targetSelector: string | null
  demoPageId: string | null
  
  // Actions
  start: (actIndex?: number) => void
  stop: () => void
  pause: () => void
  resume: () => void
  setMuted: (muted: boolean) => void
  toggleMute: () => void
  setSpeed: (speed: number) => void
  setActIndex: (index: number) => void
  setStepIndex: (index: number) => void
  setSubtitles: (text: string) => void
  setTargetSelector: (selector: string | null) => void
  setDemoPageId: (id: string | null) => void
}

export const useWalkthroughStore = create<WalkthroughState>((set) => ({
  active: false,
  currentActIndex: 0,
  currentStepIndex: 0,
  paused: false,
  muted: false,
  speed: 0.75, // Default slower, comfortable playback speed
  subtitles: '',
  targetSelector: null,
  demoPageId: null,

  start: (actIndex = 0) => set({ active: true, currentActIndex: actIndex, currentStepIndex: 0, paused: false }),
  stop: () => set({ active: false, currentActIndex: 0, currentStepIndex: 0, paused: false, subtitles: '', targetSelector: null }),
  pause: () => set({ paused: true }),
  resume: () => set({ paused: false }),
  setMuted: (muted) => set({ muted }),
  toggleMute: () => set((state) => ({ muted: !state.muted })),
  setSpeed: (speed) => set({ speed }),
  setActIndex: (currentActIndex) => set({ currentActIndex, currentStepIndex: 0 }),
  setStepIndex: (currentStepIndex) => set({ currentStepIndex }),
  setSubtitles: (subtitles) => set({ subtitles }),
  setTargetSelector: (targetSelector) => set({ targetSelector }),
  setDemoPageId: (demoPageId) => set({ demoPageId }),
}))
