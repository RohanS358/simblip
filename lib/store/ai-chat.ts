'use client'

// The assistant's conversation.
//
// A turn is a prompt plus the script it produced — kept together, because the
// script IS the answer here. Holding the thread lets you compare two attempts,
// re-run an earlier prompt, or copy a script into the Code IDE later.
//
// Persisted per user (scopedJSONStorage, like every other workspace store) so
// a reload doesn't erase what you just built. Capped at MAX_TURNS: scripts are
// small, but an unbounded chat log in localStorage competes for the same
// 5MB quota as page content, and page content must always win.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'
import { uid } from '@/lib/scene/types'

/** Old turns are dropped rather than allowed to crowd out page archives. */
const MAX_TURNS = 30

export interface AiTurn {
  id: string
  prompt: string
  /** While streaming this is the live PREVIEW (unverified). Once status is
   *  'ok' it is the verified script — the only form allowed on the canvas. */
  script: string
  status: 'streaming' | 'ok' | 'error'
  /** The model's rationale, or the failure explanation. */
  message?: string
  /** Which lane answered. Most coursework is not a simulation — of the
   *  course's own 100 questions, 44 are derivations and 37 numericals — so a
   *  turn very often carries prose instead of (or as well as) a script. */
  intent?: 'simulate' | 'explain' | 'both'
  /** A written answer in Markdown: derivation, numerical or short note.
   *  While streaming this is the live text; the terminating event replaces it
   *  with the cleaned version (LaTeX delimiters normalised for the notebook). */
  answer?: string
  /** The answer pre-split into notebook objects, ready to drop onto a page. */
  blocks?: { kind: 'text' | 'formula'; content: string }[]
  /** Has this script been executed onto a page? Set by Add, or immediately in
   *  Auto mode. Stops the same scene being added twice by accident. */
  added?: boolean
  /** Has a presentation already been built from this turn's blocks? Purely
   *  informational (unlike `added`, making slides again is never blocked —
   *  see "Place again" in ai-panel.tsx) — just lets the button read "Slides
   *  made" instead of always "Make slides". */
  slidesMade?: boolean
}

interface AiChatState {
  turns: AiTurn[]
  /** Auto mode executes a verified script the instant it arrives. Safe only
   *  because the verifier gates it — see components/workspace/ai-panel.tsx. */
  auto: boolean
  setAuto: (auto: boolean) => void
  addTurn: (turn: Omit<AiTurn, 'id'>) => string
  patchTurn: (id: string, patch: Partial<AiTurn>) => void
  clear: () => void
}

export const useAiChat = create<AiChatState>()(
  persist(
    (set) => ({
      turns: [],
      auto: false, // review-first by default; opting into Auto is deliberate
      setAuto: (auto) => set({ auto }),
      addTurn: (turn) => {
        const id = uid()
        set((s) => ({ turns: [...s.turns, { ...turn, id }].slice(-MAX_TURNS) }))
        return id
      },
      patchTurn: (id, patch) =>
        set((s) => ({
          turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      clear: () => set({ turns: [] }),
    }),
    {
      name: 'simblip-ai-chat',
      storage: scopedJSONStorage,
      // A turn left mid-stream when the tab closed can never resume, so it
      // would rehydrate as a spinner that never stops. Land it as an error.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.turns = state.turns.map((t) =>
          t.status === 'streaming' ? { ...t, status: 'error' as const, message: 'Interrupted.' } : t
        )
      },
    }
  )
)
