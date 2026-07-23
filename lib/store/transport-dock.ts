'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface TransportDockState {
  /** Whether the simulation transport is floating (standalone pill) or merged in top bar */
  floating: boolean
  /** Stored position { x, y } when floating. Null means default top-center floating position. */
  position: { x: number; y: number } | null
  setFloating: (floating: boolean) => void
  setPosition: (position: { x: number; y: number } | null) => void
}

export const useTransportDockStore = create<TransportDockState>()(
  persist(
    (set) => ({
      floating: false,
      position: null,
      setFloating: (floating) => set({ floating }),
      setPosition: (position) => set({ position }),
    }),
    {
      name: 'simblip-transport-dock',
    }
  )
)
