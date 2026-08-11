'use client'

// Authentication is mandatory: no workspace is reachable anonymously.
//
//   cloud — the app's own /api/auth token endpoint (JWT over fetch, backed
//           by Postgres). Sessions persist in localStorage and refresh
//           before expiry; the access token is fed to the data layer so
//           the gateway sees the real user.
//
//   local — NEXT_PUBLIC_CLOUD unset: accounts live in the in-browser
//           database, bootstrapped from lib/auth/bootstrap.ts. Admin-created
//           users work exactly like the seeded operator.
//
// Offline authentication:
//   Once a user has successfully authenticated online, the app grants a
//   7-day offline authentication lease. During that lease, an expired JWT
//   or unavailable network must NOT force the user to log in again.
//
// On login we record the user id under ACTIVE_USER_KEY before navigating;
// the notebook stores key their localStorage persistence off it, giving each
// account on a device its own isolated workspace.

import { create } from 'zustand'
import * as db from '@/lib/data/db'
import type {
  ProfileRow,
  InstitutionRow,
  RoomMemberRow,
  RoomRow,
  BoardRow,
} from '@/lib/data/types'
import { OPERATOR_ACCOUNT, PLATFORM_TENANT } from './bootstrap'
import { homeFor, type Role } from './types'

export const ACTIVE_USER_KEY = 'simblip-active-user'
const SESSION_KEY = 'simblip-session'

/**
 * A successfully authenticated user may continue using the application
 * completely offline for this long.
 *
 * IMPORTANT:
 * This is an authentication grace/lease period, not a JWT lifetime.
 * The JWT may expire while the offline lease is still valid.
 */
const OFFLINE_LEASE_SECONDS = 60 * 60 * 24 * 7 // 7 days

interface StoredSession {
  userId: string

  /**
   * Cloud authentication tokens.
   * These are optional because local mode does not use JWTs.
   */
  accessToken?: string
  refreshToken?: string
  expiresAt?: number // epoch seconds

  /**
   * Last time the user successfully authenticated/refreshed with the server.
   *
   * This is the anchor for the offline authentication lease.
   */
  lastOnline?: number // epoch seconds

  /**
   * Hard deadline until which the previously authenticated user may continue
   * using the app without contacting the authentication server.
   *
   * Example:
   *
   *   lastOnline = Monday 10:00
   *   offlineUntil = next Monday 10:00
   */
  offlineUntil?: number // epoch seconds
}

export type AuthStatus = 'loading' | 'anon' | 'authed'

interface AuthState {
  status: AuthStatus
  profile: ProfileRow | null
  institution: InstitutionRow | null

  /** rooms the signed-in user belongs to */
  myRoomIds: string[]

  error: string | null

  init: () => Promise<void>
  login: (email: string, password: string) => Promise<ProfileRow | null>
  logout: () => void
}

// ── Session persistence ─────────────────────────────────────────────────────

const loadSession = (): StoredSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

const saveSession = (s: StoredSession | null) => {
  try {
    if (s) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    } else {
      localStorage.removeItem(SESSION_KEY)
    }
  } catch {
    // localStorage may be unavailable in unusual browser/private-mode cases.
  }
}

// The data layer signs cloud requests with this token.
db.registerTokenSource(() => loadSession()?.accessToken ?? null)

/** Current access token (cloud mode) — used by the notebook sync engine. */
export const getAccessToken = (): string | null =>
  loadSession()?.accessToken ?? null

/**
 * Returns true when the locally stored authentication lease is still valid.
 *
 * This is intentionally independent from the JWT expiration time.
 *
 * A JWT can expire while the user is offline, but the user can continue
 * using their already-authenticated local workspace until offlineUntil.
 */
export const hasOfflineAuthLease = (): boolean => {
  const session = loadSession()

  if (!session) return false

  // Local-mode sessions do not have a server-issued offline lease.
  // They are already backed by the local database.
  if (!db.cloudConfigured) return true

  const now = Math.floor(Date.now() / 1000)
  const offlineUntil = session.offlineUntil ?? 0

  return now < offlineUntil
}

/**
 * Returns the timestamp at which offline authentication expires.
 */
export const getOfflineAuthExpiry = (): number | null => {
  const session = loadSession()

  if (!session?.offlineUntil) return null

  return session.offlineUntil
}

/**
 * Create/extend the offline authentication lease.
 *
 * This should only be called after a successful online authentication or
 * token refresh.
 */
const createOfflineLease = (): number => {
  return Math.floor(Date.now() / 1000) + OFFLINE_LEASE_SECONDS
}

// ── Token endpoint (cloud only) ──────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string }
}

/**
 * Thrown when the server was reached and explicitly rejected the request —
 * as opposed to a network/fetch failure, which throws plain Error.
 *
 * Only an explicit server rejection should invalidate authentication
 * immediately.
 */
class AuthRejectedError extends Error {}

async function tokenGrant(body: unknown): Promise<TokenResponse> {
  let res: Response

  try {
    res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    // Network failure (offline, DNS, timeout) — not a rejection.
    throw err instanceof Error ? err : new Error('Network error')
  }

  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as {
      msg?: string
    } | null

    throw new AuthRejectedError(
      detail?.msg ?? `Sign-in failed (${res.status})`,
    )
  }

  return (await res.json()) as TokenResponse
}

/**
 * Convert a successful server token response into a stored session.
 *
 * IMPORTANT:
 * Every successful token grant starts a fresh 7-day offline lease.
 */
const adoptTokens = (t: TokenResponse): StoredSession => {
  const now = Math.floor(Date.now() / 1000)

  return {
    userId: t.user.id,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: now + t.expires_in,

    // Successful online authentication.
    lastOnline: now,

    // User may now remain authenticated offline for 7 days.
    offlineUntil: now + OFFLINE_LEASE_SECONDS,
  }
}

/**
 * Refresh the access token when needed.
 *
 * There are three possible situations:
 *
 * 1. Token is still valid
 *    → keep using it.
 *
 * 2. Token needs refreshing and refresh succeeds
 *    → adopt new tokens and reset the 7-day offline lease.
 *
 * 3. Token needs refreshing but network is unavailable
 *    → if the 7-day offline lease is still valid, keep the existing
 *      session and allow offline use.
 *
 * 4. Server explicitly rejects the refresh
 *    → authentication is genuinely invalid, so sign out.
 */
async function refreshIfNeeded(
  session: StoredSession,
): Promise<StoredSession | null> {
  if (!db.cloudConfigured) return session

  const now = Date.now() / 1000

  // Access token is still comfortably valid.
  if (session.expiresAt && session.expiresAt - now > 60) {
    return session
  }

  // There is no refresh token.
  //
  // If the offline lease is still valid, the user can continue offline.
  // Otherwise authentication has expired.
  if (!session.refreshToken) {
    const offlineUntil = session.offlineUntil ?? 0

    if (now < offlineUntil) {
      return session
    }

    return null
  }

  try {
    /**
     * Online refresh succeeded.
     *
     * adoptTokens() creates a completely new 7-day offline lease.
     */
    const next = adoptTokens(
      await tokenGrant({
        grant: 'refresh',
        refresh_token: session.refreshToken,
      }),
    )

    saveSession(next)

    return next
  } catch (err) {
    if (err instanceof AuthRejectedError) {
      /**
       * The server was reachable and explicitly told us the refresh token
       * is invalid/revoked.
       *
       * This should invalidate authentication immediately.
       */
      return null
    }

    /**
     * Network failure.
     *
     * DO NOT immediately log the user out.
     *
     * Check whether the 7-day offline authentication lease is still valid.
     */
    const offlineUntil = session.offlineUntil ?? 0

    if (now < offlineUntil) {
      return session
    }

    /**
     * The user has been offline longer than the allowed 7-day period.
     *
     * They must reconnect and authenticate again.
     */
    return null
  }
}

// Access tokens are only good for an hour (ACCESS_TTL in app/api/auth).
//
// A tab left open longer than that would otherwise 401 on every request
// forever. This loop checks the token periodically and refreshes it when
// possible.
//
// If the network is unavailable, refreshIfNeeded() will preserve the
// session while the 7-day offline lease is still valid.
const REFRESH_CHECK_MS = 60_000

let refreshTimer: ReturnType<typeof setInterval> | null = null

function stopRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

function startRefreshLoop() {
  if (!db.cloudConfigured || refreshTimer) return

  refreshTimer = setInterval(async () => {
    const session = loadSession()

    if (!session) {
      return stopRefreshLoop()
    }

    const next = await refreshIfNeeded(session)

    if (!next) {
      stopRefreshLoop()
      useAuthStore.getState().logout()
    }
  }, REFRESH_CHECK_MS)
}

// ── Local bootstrap ─────────────────────────────────────────────────────────

/**
 * Local mode only: seed the platform pseudo-tenant + operator so /dev can
 * provision real institutions. Never clobbers rows that already exist.
 */
export function seedLocalOperator() {
  db.seedTable('institutions', [
    {
      id: PLATFORM_TENANT.id,
      name: PLATFORM_TENANT.name,
      slug: PLATFORM_TENANT.slug,
      logo_url: null,
      accent_color: PLATFORM_TENANT.accentColor,
      active: true,
    },
  ])

  const a = OPERATOR_ACCOUNT

  const operatorRow = {
    id: a.id,
    institution_id: a.institutionId,
    role: a.role,
    full_name: a.fullName,
    email: a.email,
    department: null,
    active: a.active,
    password: a.password,
  }

  db.seedTable('profiles', [operatorRow])

  // Backfill into browsers whose local db predates the operator account.
  void db.list<ProfileRow>('profiles').then((existing) => {
    if (!existing.some((p) => p.id === operatorRow.id)) {
      void db.insert('profiles', [operatorRow])
    }
  })
}

// ── Store ───────────────────────────────────────────────────────────────────

type AuthContext = {
  profile: ProfileRow
  institution: InstitutionRow | null
  myRoomIds: string[]
}

const CONTEXT_CACHE_KEY = 'simblip-auth-context'

const loadCachedContext = (userId: string): AuthContext | null => {
  try {
    const raw = localStorage.getItem(CONTEXT_CACHE_KEY)

    if (!raw) return null

    const ctx = JSON.parse(raw) as AuthContext

    return ctx.profile?.id === userId ? ctx : null
  } catch {
    return null
  }
}

const saveCachedContext = (ctx: AuthContext) => {
  try {
    localStorage.setItem(CONTEXT_CACHE_KEY, JSON.stringify(ctx))
  } catch {
    // Ignore localStorage failures.
  }
}

/**
 * Cloud mode normally loads the profile/institution/rooms from the server.
 *
 * If the network is unavailable but the user has a valid offline
 * authentication lease, fall back to the last successfully loaded
 * authentication context.
 */
async function loadContext(userId: string): Promise<AuthContext | null> {
  try {
    const profiles = await db.list<ProfileRow>('profiles', {
      id: userId,
    })

    const profile = profiles[0]

    if (!profile || !profile.active) {
      return null
    }

    const [institutions, memberships] = await Promise.all([
      db.list<InstitutionRow>('institutions', {
        id: profile.institution_id,
      }),

      db.list<RoomMemberRow>('room_members', {
        profile_id: userId,
      }),
    ])

    const ctx: AuthContext = {
      profile,
      institution: institutions[0] ?? null,
      myRoomIds: memberships.map((m) => m.room_id),
    }

    /**
     * Successful context load means the server/data layer was reachable.
     *
     * Keep the cached context fresh.
     */
    saveCachedContext(ctx)

    return ctx
  } catch (err) {
    /**
     * The network/database request failed.
     *
     * Try the previously cached context.
     */
    const cached = loadCachedContext(userId)

    if (cached) {
      return cached
    }

    throw err
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',

  profile: null,

  institution: null,

  myRoomIds: [],

  error: null,

  // ── Initialize existing session ────────────────────────────────────────────

  init: async () => {
    if (typeof window === 'undefined') return

    if (!db.cloudConfigured) {
      seedLocalOperator()
    }

    let session = loadSession()

    /**
     * Attempt to refresh an expired/near-expired token.
     *
     * If offline, refreshIfNeeded() will keep the session alive as long as
     * the 7-day offline lease has not expired.
     */
    if (session) {
      session = await refreshIfNeeded(session)
    }

    /**
     * No valid session AND no valid offline lease.
     */
    if (!session) {
      saveSession(null)

      set({
        status: 'anon',
        profile: null,
        institution: null,
        myRoomIds: [],
      })

      return
    }

    try {
      /**
       * Try to load fresh profile/institution/room data.
       *
       * If offline, loadContext() falls back to the cached context.
       */
      const ctx = await loadContext(session.userId)

      if (!ctx) {
        /**
         * IMPORTANT:
         *
         * A server-side account deactivation/rejection should invalidate
         * the session.
         *
         * If there was simply a network failure, loadContext() should have
         * already fallen back to the cached context.
         */
        saveSession(null)

        set({
          status: 'anon',
          profile: null,
          institution: null,
          myRoomIds: [],
        })

        return
      }

      /**
       * This is the account used by the local notebook/document storage.
       */
      localStorage.setItem(
        ACTIVE_USER_KEY,
        ctx.profile.id,
      )

      set({
        status: 'authed',
        ...ctx,
        error: null,
      })

      startRefreshLoop()
    } catch (err) {
      /**
       * If the session's 7-day offline lease is still valid, preserve the
       * authenticated state using cached context.
       */
      if (hasOfflineAuthLease()) {
        const cached = loadCachedContext(session.userId)

        if (cached) {
          localStorage.setItem(
            ACTIVE_USER_KEY,
            cached.profile.id,
          )

          set({
            status: 'authed',
            ...cached,
            error: null,
          })

          startRefreshLoop()

          return
        }
      }

      set({
        status: 'anon',
        error: err instanceof Error
          ? err.message
          : String(err),
      })
    }
  },

  // ── Login ──────────────────────────────────────────────────────────────────

  login: async (email, password) => {
    set({
      error: null,
    })

    try {
      let session: StoredSession

      if (db.cloudConfigured) {
        /**
         * Online authentication.
         *
         * adoptTokens() automatically creates a fresh 7-day offline lease.
         */
        session = adoptTokens(
          await tokenGrant({
            grant: 'password',
            email,
            password,
          }),
        )
      } else {
        /**
         * Local development mode.
         */
        seedLocalOperator()

        const needle = email.trim().toLowerCase()

        const rows = await db.list<ProfileRow>('profiles')

        // Local nicety: a bare username matches its email's local part.
        const account = rows.find(
          (p) =>
            p.email === needle ||
            (
              !needle.includes('@') &&
              p.email.split('@')[0] === needle
            ),
        )

        if (!account || account.password !== password) {
          throw new Error('Invalid email or password.')
        }

        if (!account.active) {
          throw new Error('This account has been deactivated.')
        }

        /**
         * Local mode doesn't need a JWT or server lease.
         */
        session = {
          userId: account.id,
        }
      }

      /**
       * Persist the session BEFORE loading the profile.
       *
       * The data layer reads the JWT from storage, and RLS only reveals
       * the profile row to its authenticated owner.
       */
      saveSession(session)

      const ctx = await loadContext(session.userId)

      if (!ctx) {
        throw new Error(
          'No profile found for this account. Ask your institution admin.',
        )
      }

      localStorage.setItem(
        ACTIVE_USER_KEY,
        ctx.profile.id,
      )

      set({
        status: 'authed',
        ...ctx,
        error: null,
      })

      startRefreshLoop()

      return ctx.profile
    } catch (err) {
      /**
       * Never keep a partially authenticated session.
       */
      saveSession(null)

      set({
        error: err instanceof Error
          ? err.message
          : String(err),
      })

      return null
    }
  },

  // ── Logout ─────────────────────────────────────────────────────────────────

  logout: () => {
    /**
     * Tokens are stateless JWTs — signing out is dropping them client-side.
     *
     * Attached documents live only until sign-out.
     */
    void import('@/lib/store/ephemeral-storage').then(
      ({ clearSessionFiles }) =>
        clearSessionFiles(
          localStorage.getItem(ACTIVE_USER_KEY),
        ),
    )

    stopRefreshLoop()

    saveSession(null)

    localStorage.removeItem(ACTIVE_USER_KEY)

    set({
      status: 'anon',
      profile: null,
      institution: null,
      myRoomIds: [],
    })

    window.location.href = '/login'
  },
}))

/** Convenience selectors. */
export const useRole = (): Role | null =>
  useAuthStore((s) => s.profile?.role ?? null)

export { homeFor }