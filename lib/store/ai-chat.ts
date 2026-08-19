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
import { deriveTitle, loadSession, saveSession, type AiSession } from '@/lib/store/ai-sessions'

/** Old turns are dropped rather than allowed to crowd out page archives. */
const MAX_TURNS = 30

/** A file the user attached to a prompt, already reduced to text.
 *
 *  Only the EXTRACTED TEXT is kept, never the file itself: the bytes are of
 *  no further use once read, and storing a 20MB PDF per turn would blow out
 *  the session history this thread is saved into. */
export interface ChatAttachment {
  name: string
  /** Extracted content. Empty when extraction found nothing usable. */
  text: string
  /** Why it is empty, when it is — shown beside the attachment chip. */
  warning?: string
}

export interface AiTurn {
  id: string
  prompt: string
  /** Files sent with this prompt. */
  attachments?: ChatAttachment[]
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
  /** A proposed set of edits to the page, awaiting confirmation. Typed as
   *  unknown so the store stays free of the op vocabulary; ai-panel.tsx
   *  narrows it and re-verifies before applying. */
  editPlan?: { ops: unknown[]; summary: string }
  /** Has the edit plan been applied? Stops a double-apply. */
  editApplied?: boolean
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
  /** Which saved session these turns belong to. Null until the first prompt
   *  of a fresh thread, which creates one — an empty session is never
   *  written, so opening the panel and closing it leaves no clutter. */
  sessionId: string | null
  /** Its name, kept here so the header can show it without a DB read. */
  sessionTitle: string
  /** Replace the whole thread with a session loaded from IndexedDB. */
  openSession: (session: AiSession) => void
  /** Abandon the current thread and start an unsaved empty one. The old
   *  session stays on disk — this is "new chat", not "delete". */
  newSession: () => void
  setSessionTitle: (title: string) => void
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
      sessionId: null,
      sessionTitle: '',
      auto: false, // review-first by default; opting into Auto is deliberate
      setAuto: (auto) => set({ auto }),
      openSession: (session) =>
        set({ turns: session.turns, sessionId: session.id, sessionTitle: session.title }),
      newSession: () => set({ turns: [], sessionId: null, sessionTitle: '' }),
      setSessionTitle: (title) => {
        set({ sessionTitle: title })
        void persistSession()
      },
      addTurn: (turn) => {
        const id = uid()
        set((s) => {
          // The first prompt names the thread and creates its session.
          const isFirst = s.sessionId === null
          return {
            turns: [...s.turns, { ...turn, id }].slice(-MAX_TURNS),
            sessionId: isFirst ? uid() : s.sessionId,
            sessionTitle: isFirst ? deriveTitle(turn.prompt) : s.sessionTitle,
          }
        })
        void persistSession()
        return id
      },
      patchTurn: (id, patch) => {
        set((s) => ({
          turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }))
        void persistSession()
      },
      clear: () => set({ turns: [], sessionId: null, sessionTitle: '' }),
    }),
    {
      name: 'simblip-ai-chat',
      storage: scopedJSONStorage,
      // Only the live thread pointer belongs in localStorage — the turns
      // themselves are mirrored to IndexedDB by persistSession(), and
      // writing them twice would put the chat log back in competition with
      // page content for the 5MB quota this store was capped to avoid.
      partialize: (s) => ({
        turns: s.turns,
        auto: s.auto,
        sessionId: s.sessionId,
        sessionTitle: s.sessionTitle,
      }),
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

/** Mirror the live thread into its saved session.
 *
 *  Debounced: a streaming turn patches on every chunk, and an IDB write per
 *  token would be both wasteful and pointless — only the settled state is
 *  worth resuming. A trailing write means the last patch always lands.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null
function persistSession(): void {
  if (typeof window === 'undefined') return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const { turns, sessionId, sessionTitle } = useAiChat.getState()
    // An empty or unnamed thread is not a session yet.
    if (!sessionId || turns.length === 0) return
    const now = Date.now()
    // Read the existing row first so createdAt survives. Overwriting it on
    // every save would make every session look like it was created seconds
    // ago, which is exactly the field a student uses to find an old thread.
    void loadSession(sessionId).then((prev) =>
      saveSession({
        id: sessionId,
        title: sessionTitle || deriveTitle(turns[0].prompt),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        turns,
      })
    )
  }, 400)
}
