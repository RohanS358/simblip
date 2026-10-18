'use client'

// Learner state — local-first, per user, deliberately NOT in the chat store
// (docs/ai-plans D9): a student's mistakes are sensitive and the audience
// includes minors. Nothing here leaves the device unless page-sync is on.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'
import { uid } from '@/lib/scene/types'
import { lintCard, makeCard, MAX_NEW_PER_SESSION, type Card } from './cards'
import { review as fsrsReview, type Rating } from './fsrs'
import { updateMastery, type Mastery } from './mastery'
import type { Rung } from './hints'

export interface Review { cardId: string; at: number; rating: Rating; hintRung?: Rung; context: 'recall' | 'quiz' | 'inline' }
export interface Prefs { level: 'new' | 'basic' | 'exam'; mode: 'learn' | 'answer'; voice: boolean; dailyNewCards: number }

interface State {
  cards: Record<string, Card>
  reviews: Review[]
  mastery: Record<string, Mastery>
  prefs: Prefs
  /** New cards created today: [yyyy-mm-dd, count] — enforces the daily cap. */
  newToday: [string, number]
  addCard: (c: Omit<Card, 'fsrs' | 'id' | 'createdBy'> & { createdBy?: Card['createdBy'] }) => { ok: true; card: Card } | { ok: false; problems: string[] }
  grade: (cardId: string, rating: Rating, ctx?: Review['context'], hintRung?: Rung) => void
  record: (conceptId: string, correct: boolean, hintRung?: Rung) => void
  due: (now?: number) => Card[]
  setPrefs: (p: Partial<Prefs>) => void
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10)
const MAX_REVIEWS = 5000 // old reviews are dropped; card state already holds the schedule

export const useLearner = create<State>()(
  persist(
    (set, get) => ({
      cards: {},
      reviews: [],
      mastery: {},
      prefs: { level: 'basic', mode: 'learn', voice: false, dailyNewCards: MAX_NEW_PER_SESSION },
      newToday: ['', 0],
      addCard(c) {
        const problems = lintCard(c)
        if (problems.length) return { ok: false, problems }
        const now = Date.now()
        const [d, n] = get().newToday
        const count = d === day(now) ? n : 0
        if (count >= get().prefs.dailyNewCards) return { ok: false, problems: [`daily limit of ${get().prefs.dailyNewCards} new cards reached — review first`] }
        const card = makeCard(c, uid(), now)
        set((s) => ({ cards: { ...s.cards, [card.id]: card }, newToday: [day(now), count + 1] }))
        return { ok: true, card }
      },
      grade(cardId, rating, context = 'recall', hintRung) {
        const c = get().cards[cardId]
        if (!c) return
        const now = Date.now()
        set((s) => ({
          cards: { ...s.cards, [cardId]: { ...c, fsrs: fsrsReview(c.fsrs, rating, now) } },
          reviews: [...s.reviews, { cardId, at: now, rating, hintRung, context }].slice(-MAX_REVIEWS),
          mastery: { ...s.mastery, [c.conceptId]: updateMastery(s.mastery[c.conceptId], c.conceptId, rating >= 3, hintRung, now) },
        }))
      },
      record(conceptId, correct, hintRung) {
        set((s) => ({ mastery: { ...s.mastery, [conceptId]: updateMastery(s.mastery[conceptId], conceptId, correct, hintRung, Date.now()) } }))
      },
      due(now = Date.now()) {
        return Object.values(get().cards).filter((c) => c.fsrs.due <= now).sort((a, b) => a.fsrs.due - b.fsrs.due)
      },
      setPrefs: (p) => set((s) => ({ prefs: { ...s.prefs, ...p } })),
    }),
    { name: 'simblip-learner', storage: scopedJSONStorage }
  )
)
