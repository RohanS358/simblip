'use client'

// Authentication is mandatory: no workspace is reachable anonymously.
//
//   cloud — Supabase GoTrue (password grant over fetch, zero dependencies).
//           Sessions persist in localStorage and refresh before expiry; the
//           access token is fed to the data layer so RLS sees the real user.
//   local — demo mode (no Supabase keys): accounts live in the local demo
//           database, seeded from lib/auth/demo.ts. Admin-created users work
//           exactly like seeded ones.
//
// On login we record the user id under ACTIVE_USER_KEY *before* navigating;
// the notebook stores key their localStorage persistence off it, giving each
// account on a device its own isolated workspace.

import { create } from 'zustand'
import * as db from '@/lib/data/db'
import type { ProfileRow, InstitutionRow, RoomMemberRow, RoomRow, BoardRow } from '@/lib/data/types'
import { DEMO_ACCOUNTS, DEMO_BOARDS, DEMO_INSTITUTION, DEMO_MEMBERS, DEMO_ROOMS } from './demo'
import { homeFor, type Role } from './types'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const ACTIVE_USER_KEY = 'simblip-active-user'
const SESSION_KEY = 'simblip-session'

interface StoredSession {
  userId: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number // epoch seconds
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
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  else localStorage.removeItem(SESSION_KEY)
}

// The data layer signs cloud requests with this token.
db.registerTokenSource(() => loadSession()?.accessToken ?? null)

/** Current access token (cloud mode) — used by the notebook sync engine. */
export const getAccessToken = (): string | null => loadSession()?.accessToken ?? null

// ── GoTrue (cloud only) ─────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string }
}

async function gotrue(path: string, body: unknown): Promise<TokenResponse> {
  const res = await fetch(`${URL_}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error_description?: string; msg?: string } | null
    throw new Error(detail?.error_description ?? detail?.msg ?? `Sign-in failed (${res.status})`)
  }
  return (await res.json()) as TokenResponse
}

const adoptTokens = (t: TokenResponse): StoredSession => ({
  userId: t.user.id,
  accessToken: t.access_token,
  refreshToken: t.refresh_token,
  expiresAt: Math.floor(Date.now() / 1000) + t.expires_in,
})

async function refreshIfNeeded(session: StoredSession): Promise<StoredSession | null> {
  if (!db.cloudConfigured) return session
  if (session.expiresAt && session.expiresAt - Date.now() / 1000 > 60) return session
  if (!session.refreshToken) return null
  try {
    const next = adoptTokens(await gotrue('token?grant_type=refresh_token', { refresh_token: session.refreshToken }))
    saveSession(next)
    return next
  } catch {
    return null
  }
}

// ── Demo seeding ────────────────────────────────────────────────────────────

export function seedDemoTenant() {
  db.seedTable('institutions', [DEMO_INSTITUTION].map((i) => ({
    id: i.id, name: i.name, slug: i.slug, logo_url: i.logoUrl ?? null,
    accent_color: i.accentColor ?? null, active: true,
  })))
  db.seedTable('profiles', DEMO_ACCOUNTS.map((a) => ({
    id: a.id, institution_id: a.institutionId, role: a.role, full_name: a.fullName,
    email: a.email, department: a.department ?? null, active: a.active, password: a.password,
  })))
  db.seedTable('rooms', DEMO_ROOMS.map((r) => ({
    id: r.id, institution_id: r.institutionId, name: r.name, department: r.department ?? null,
  })))
  db.seedTable('room_members', DEMO_MEMBERS.map((m) => ({
    id: `${m.roomId}:${m.profileId}`, room_id: m.roomId, profile_id: m.profileId, member_role: m.memberRole,
  })))
  db.seedTable('boards', DEMO_BOARDS.map((b) => ({
    id: b.id, institution_id: b.institutionId, room_id: b.roomId, profile_id: b.profileId,
    pairing_code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    pairing_rotated_at: new Date().toISOString(),
  })))
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
    if (!db.cloudConfigured) seedDemoTenant()
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
    } catch (err) {
      set({ status: 'anon', error: err instanceof Error ? err.message : String(err) })
    }
  },

  login: async (email, password) => {
    set({ error: null })
    try {
      let session: StoredSession
      if (db.cloudConfigured) {
        session = adoptTokens(await gotrue('token?grant_type=password', { email, password }))
      } else {
        seedDemoTenant()
        const rows = await db.list<ProfileRow>('profiles', { email: email.trim().toLowerCase() })
        const account = rows[0]
        if (!account || account.password !== password) throw new Error('Invalid email or password.')
        if (!account.active) throw new Error('This account has been deactivated.')
        session = { userId: account.id }
      }
      const ctx = await loadContext(session.userId)
      if (!ctx) throw new Error('No profile found for this account. Ask your institution admin.')
      saveSession(session)
      localStorage.setItem(ACTIVE_USER_KEY, ctx.profile.id)
      set({ status: 'authed', ...ctx, error: null })
      return ctx.profile
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      return null
    }
  },

  logout: () => {
    const session = loadSession()
    if (db.cloudConfigured && session?.accessToken) {
      void fetch(`${URL_}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: KEY!, Authorization: `Bearer ${session.accessToken}` },
      }).catch(() => {})
    }
    saveSession(null)
    localStorage.removeItem(ACTIVE_USER_KEY)
    set({ status: 'anon', profile: null, institution: null, myRoomIds: [] })
    window.location.href = '/login'
  },
}))

/** Convenience selectors. */
export const useRole = (): Role | null => useAuthStore((s) => s.profile?.role ?? null)

export { homeFor }
