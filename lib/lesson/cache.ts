'use client'

// Generated films are kept per user: replaying costs nothing, and the same storyboard
// can later be shared with a class. Small on purpose — a film is ~20–60 KB of JSON.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'
import { storyboardSchema, type Storyboard } from './storyboard'

const MAX = 20
export const cacheKey = (topic: string, level: string) => `${level}:${topic.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`

interface State {
  films: Record<string, { at: number; storyboard: Storyboard }>
  get: (topic: string, level: string) => Storyboard | null
  put: (topic: string, level: string, sb: Storyboard) => void
}

export const useLessonCache = create<State>()(
  persist(
    (set, get) => ({
      films: {},
      get(topic, level) {
        const hit = get().films[cacheKey(topic, level)]
        const ok = hit && storyboardSchema.safeParse(hit.storyboard) // a stale format must not crash playback
        return ok?.success ? ok.data : null
      },
      put(topic, level, sb) {
        set((s) => {
          const films = { ...s.films, [cacheKey(topic, level)]: { at: Date.now(), storyboard: sb } }
          const keep = Object.entries(films).sort((a, b) => b[1].at - a[1].at).slice(0, MAX)
          return { films: Object.fromEntries(keep) }
        })
      },
    }),
    { name: 'simblip-lesson-cache', storage: scopedJSONStorage }
  )
)
