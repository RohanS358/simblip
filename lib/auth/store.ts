'use client'

// Authentication is mandatory: no workspace is reachable anonymously.
//
//   cloud — the app's own /api/auth token endpoint (JWT over fetch, backed
//           by Postgres). Sessions persist in localStorage and refresh
//           before expiry; the access token is fed to the data layer so the
//           gateway sees the real user.
//   local — NEXT_PUBLIC_CLOUD unset: accounts live in the in-browser
//           database, bootstrapped from lib/auth/bootstrap.ts. Admin-created
//           users work exactly like the seeded operator.
//
// On login we record the user id under ACTIVE_USER_KEY *before* navigating;
// the notebook stores key their localStorage persistence off it, giving each
// account on a device its own isolated workspace.

import { create } from 'zustand'
import * as db from '@/lib/data/db'
import type { ProfileRow, InstitutionRow, RoomMemberRow, RoomRow, BoardRow } from '@/lib/data/types'
import { OPERATOR_ACCOUNT, PLATFORM_TENANT } from './bootstrap'
import { homeFor, type Role } from './types'

export const ACTIVE_USER_KEY = 'simblip-active-user'
const SESSION_KEY = 'simblip-session'

interface StoredSession {
  userId: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number // epoch seconds
  lastOnline?: number // epoch seconds; last time a token grant actually reached the server
}

/** Offline grace period: stay signed in this long past the last successful
 *  server contact, even once the access token has expired, so a dead network
 *  doesn't force a re-login mid-session. */
const OFFLINE_GRACE_SECONDS = 60 * 60 * 24

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
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else localStorage.removeItem(SESSION_KEY)
}

// The data layer signs cloud requests with this token.
db.registerTokenSource(() => loadSession()?.accessToken ?? null)

/** Current access token (cloud mode) — used by the notebook sync engine. */
export const getAccessToken = (): string | null => loadSession()?.accessToken ?? null

// ── Token endpoint (cloud only) ─────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string }
}

/** Thrown when the server was reached and explicitly rejected the request —
 *  as opposed to a network/fetch failure, which throws plain Error. Only this
 *  should ever force a sign-out. */
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
    const detail = (await res.json().catch(() => null)) as { msg?: string } | null
    throw new AuthRejectedError(detail?.msg ?? `Sign-in failed (${res.status})`)
  }
  return (await res.json()) as TokenResponse
}

const adoptTokens = (t: TokenResponse): StoredSession => ({
  userId: t.user.id,
  accessToken: t.access_token,
  refreshToken: t.refresh_token,
  expiresAt: Math.floor(Date.now() / 1000) + t.expires_in,
  lastOnline: Math.floor(Date.now() / 1000),
})

async function refreshIfNeeded(session: StoredSession): Promise<StoredSession | null> {
  if (!db.cloudConfigured) return session
  if (session.expiresAt && session.expiresAt - Date.now() / 1000 > 60) return session
  if (!session.refreshToken) return null
  try {
    const next = adoptTokens(await tokenGrant({ grant: 'refresh', refresh_token: session.refreshToken }))
    saveSession(next)
    return next
  } catch (err) {
    if (err instanceof AuthRejectedError) return null // server said no — sign out for real
    // Offline or unreachable: keep the session alive on its last known-good
    // state until OFFLINE_GRACE_SECONDS since we last actually talked to the
    // server, rather than logging out on every dropped connection.
    const lastOnline = session.lastOnline ?? 0
    if (Date.now() / 1000 - lastOnline > OFFLINE_GRACE_SECONDS) return null
    return session
  }
}

// Access tokens are only good for an hour (ACCESS_TTL in app/api/auth); a tab
// left open longer than that would otherwise 401 on every request forever —
// nothing else re-checks the token once init() has run. This loop keeps the
// session alive for as long as the tab stays open and the refresh token is
// still valid, and signs the user out the moment it genuinely can't.
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
    if (!session) return stopRefreshLoop()
    if (!(await refreshIfNeeded(session))) {
      stopRefreshLoop()
      useAuthStore.getState().logout()
    }
  }, REFRESH_CHECK_MS)
}

// ── Local bootstrap ─────────────────────────────────────────────────────────

/** Local mode only: seed the platform pseudo-tenant + operator so /dev can
 *  provision real institutions. Never clobbers rows that already exist. */
export function seedLocalOperator() {
  db.seedTable('institutions', [{
    id: PLATFORM_TENANT.id, name: PLATFORM_TENANT.name, slug: PLATFORM_TENANT.slug,
    logo_url: null, accent_color: PLATFORM_TENANT.accentColor, active: true,
  }])
  const a = OPERATOR_ACCOUNT
  const operatorRow = {
    id: a.id, institution_id: a.institutionId, role: a.role, full_name: a.fullName,
    email: a.email, department: null, active: a.active, password: a.password,
  }
  db.seedTable('profiles', [operatorRow])
  // Backfill into browsers whose local db predates the operator account.
  void db.list<ProfileRow>('profiles').then((existing) => {
    if (!existing.some((p) => p.id === operatorRow.id)) void db.insert('profiles', [operatorRow])
  })
}

// ── Store ───────────────────────────────────────────────────────────────────

async function loadContext(userId: string): Promise<{
  profile: ProfileRow
  institution: InstitutionRow | null
  myRoomIds: string[]
} | null> {
  const profiles = await db.list<ProfileRow>('profiles', { id: userId })
  const profile = profiles[0]
  if (!profile || !profile.active) return null
  const [institutions, memberships] = await Promise.all([
    db.list<InstitutionRow>('institutions', { id: profile.institution_id }),
    db.list<RoomMemberRow>('room_members', { profile_id: userId }),
  ])
  return {
    profile,
    institution: institutions[0] ?? null,
    myRoomIds: memberships.map((m) => m.room_id),
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  profile: null,
  institution: null,
  myRoomIds: [],
  error: null,

  init: async () => {
    if (typeof window === 'undefined') return
    if (!db.cloudConfigured) seedLocalOperator()
    let session = loadSession()
    if (session) session = await refreshIfNeeded(session)
    if (!session) {
      saveSession(null)
      set({ status: 'anon', profile: null, institution: null, myRoomIds: [] })
      return
    }
    try {
      const ctx = await loadContext(session.userId)
      if (!ctx) {
        saveSession(null)
        set({ status: 'anon', profile: null })
        return
      }
      localStorage.setItem(ACTIVE_USER_KEY, ctx.profile.id)
      set({ status: 'authed', ...ctx, error: null })
      startRefreshLoop()
    } catch (err) {
      set({ status: 'anon', error: err instanceof Error ? err.message : String(err) })
    }
  },

  login: async (email, password) => {
    set({ error: null })
    try {
      let session: StoredSession
      if (db.cloudConfigured) {
        session = adoptTokens(await tokenGrant({ grant: 'password', email, password }))
      } else {
        seedLocalOperator()
        const needle = email.trim().toLowerCase()
        const rows = await db.list<ProfileRow>('profiles')
        // Local nicety: a bare username matches its email's local part.
        const account = rows.find(
          (p) => p.email === needle || (!needle.includes('@') && p.email.split('@')[0] === needle)
        )
        if (!account || account.password !== password) throw new Error('Invalid email or password.')
        if (!account.active) throw new Error('This account has been deactivated.')
        session = { userId: account.id }
      }
      // Persist the session BEFORE loading the profile: the data layer reads
      // the JWT from storage, and RLS only reveals the profile row to its
      // authenticated owner — an anon query would come back empty.
      saveSession(session)
      const ctx = await loadContext(session.userId)
      if (!ctx) throw new Error('No profile found for this account. Ask your institution admin.')
      localStorage.setItem(ACTIVE_USER_KEY, ctx.profile.id)
      set({ status: 'authed', ...ctx, error: null })
      startRefreshLoop()
      return ctx.profile
    } catch (err) {
      saveSession(null) // never keep a session that couldn't resolve a profile
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  logout: () => {
    // Tokens are stateless JWTs — signing out is dropping them client-side.
    // Attached documents live only until sign-out.
    void import('@/lib/store/ephemeral-storage').then(({ clearSessionFiles }) =>
      clearSessionFiles(localStorage.getItem(ACTIVE_USER_KEY))
    )
    stopRefreshLoop()
    saveSession(null)
    localStorage.removeItem(ACTIVE_USER_KEY)
    set({ status: 'anon', profile: null, institution: null, myRoomIds: [] })
    window.location.href = '/login'
  },
}))

/** Convenience selectors. */
export const useRole = (): Role | null => useAuthStore((s) => s.profile?.role ?? null)

export { homeFor }
