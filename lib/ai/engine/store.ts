'use client'

// What the UI shows about the engine, and the one preference that matters.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Tier } from './catalog'
import type { Capabilities } from './probe'

export type EngineState =
  | 'unknown'     // not probed yet
  | 'absent'      // supported, model not downloaded
  | 'downloading'
  | 'loading'     // reading weights into memory
  | 'ready'       // in memory, idle
  | 'generating'
  | 'unloaded'    // downloaded; freed from memory after idling
  | 'error'

interface EngineStore {
  state: EngineState
  tier: Tier | null
  /** 0..1 while downloading or loading. */
  progress: number
  /** Which tiers are fully in the browser cache. */
  cached: Tier[]
  accel: 'webgpu' | 'cpu' | null
  threads: number | null
  /** Decode speed of the last reply, tokens/second. */
  tps: number | null
  caps: Capabilities | null
  error: string | null
  patch: (p: Partial<Omit<EngineStore, 'patch'>>) => void
}

export const useEngine = create<EngineStore>((set) => ({
  state: 'unknown',
  tier: null,
  progress: 0,
  cached: [],
  accel: null,
  threads: null,
  tps: null,
  caps: null,
  error: null,
  patch: (p) => set(p),
}))

/** Where requests go. `auto` = on this device when a model is downloaded,
 *  otherwise the server. Persisted: it is a choice about privacy. */
export type Backend = 'auto' | 'device' | 'server'

interface Prefs {
  backend: Backend
  tier: Tier | null
  setBackend: (b: Backend) => void
  setTier: (t: Tier) => void
}

export const useEnginePrefs = create<Prefs>()(
  persist(
    (set) => ({
      backend: 'auto',
      tier: null,
      setBackend: (backend) => set({ backend }),
      setTier: (tier) => set({ tier }),
    }),
    { name: 'simblip-ai-engine', storage: createJSONStorage(() => localStorage) }
  )
)
