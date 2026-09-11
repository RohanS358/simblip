'use client'

// "Ask about this" — a passage the reader selected, queued for the assistant.
//
// A student stuck on one sentence of a derivation has nobody to raise a hand
// to. Selecting the sentence and sending it here is that raised hand: the
// assistant receives the exact wording plus the section it came from, so the
// answer is about THIS line rather than the topic in general.
//
// The passage rides in as a ChatAttachment (lib/store/ai-chat.ts) — the same
// channel a dropped PDF uses — so nothing in the composer, the request
// builder, or the session history needs to know that quoting exists.

import { create } from 'zustand'
import { useSidebarSection } from './sidebar-sections'
import { useWorkspaceStore } from './workspace'

export interface AiReference {
  /** The selected text, trimmed and length-capped by the caller. */
  text: string
  /** Where it came from: "The Simple Pendulum · Deriving the period". */
  source: string
}

interface RefState {
  /** Waiting to be picked up by the composer. Cleared once consumed. */
  pending: AiReference | null
  set: (ref: AiReference | null) => void
}

export const useAiReference = create<RefState>((set) => ({
  pending: null,
  set: (pending) => set({ pending }),
}))

/** Longer than this and the "quote" is really a chapter — it would crowd the
 *  model's context with material it can already read from the page. */
const MAX = 1200

/** Queue a passage and bring the assistant into view, wherever it lives on
 *  this device. Mirrors openProperties() in sidebar-sections.ts. */
export function askAboutSelection(text: string, source: string) {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (!trimmed) return
  useAiReference.getState().set({
    text: trimmed.length > MAX ? trimmed.slice(0, MAX) + '…' : trimmed,
    source,
  })
  useSidebarSection.getState().setSection('assistant')
  useWorkspaceStore.setState({ sidebarOpen: true })
}
