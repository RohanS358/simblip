'use client'

// Terms acceptance and storage/analytics consent.
//
// Both are per-account, so they persist under the scoped storage the notebook
// stores use (`<name>:<userId>`): a teacher and a student sharing a classroom
// machine each answer for themselves, and switching accounts re-reads the
// incoming user's answers rather than inheriting the previous one's.
//
// Acceptance is recorded client-side only. That is a deliberate, known ceiling:
// clearing browser data or signing in on a second device shows the gate again,
// and there is no server-side audit trail of who accepted which version.
// ponytail: client-only consent record; move `acceptedVersion`/`acceptedAt` to a
// simblip_profiles column when acceptance needs to be auditable or portable.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { scopedJSONStorage } from '@/lib/store/scoped-storage'

/**
 * Bump when the terms change materially. Users who accepted an older version
 * are re-prompted; the gate compares against this exact string.
 */
export const TERMS_VERSION = '2026-08-13'

/** Bump when the privacy policy changes materially (shown in Settings). */
export const PRIVACY_VERSION = '2026-08-13'

export interface ConsentState {
  /** Terms version this account accepted, or null if never accepted. */
  acceptedVersion: string | null
  /** ISO timestamp of acceptance — shown back to the user in Settings. */
  acceptedAt: string | null
  /**
   * Product analytics (Vercel Analytics). Defaults to false: analytics only
   * loads once the account opts in, so the notice is honest about the choice
   * rather than describing a decision already made for them.
   */
  analytics: boolean
  /** True once the account has answered the storage notice either way. */
  storageNoticeSeen: boolean

  acceptTerms: () => void
  setAnalytics: (on: boolean) => void
  dismissStorageNotice: () => void
  /** Withdraw acceptance — used by "Review terms again" in Settings. */
  resetTerms: () => void
}

export const useConsent = create<ConsentState>()(
  persist(
    (set) => ({
      acceptedVersion: null,
      acceptedAt: null,
      analytics: false,
      storageNoticeSeen: false,

      acceptTerms: () =>
        set({
          acceptedVersion: TERMS_VERSION,
          acceptedAt: new Date().toISOString(),
        }),
      setAnalytics: (on) => set({ analytics: on, storageNoticeSeen: true }),
      dismissStorageNotice: () => set({ storageNoticeSeen: true }),
      resetTerms: () => set({ acceptedVersion: null, acceptedAt: null }),
    }),
    { name: 'simblip-consent', storage: scopedJSONStorage },
  ),
)

/** True when this account still owes us an answer on the current terms. */
export const termsOutstanding = (s: ConsentState): boolean =>
  s.acceptedVersion !== TERMS_VERSION
