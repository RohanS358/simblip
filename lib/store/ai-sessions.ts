'use client'

// Named, resumable AI conversations.
//
// The assistant already remembered the current thread (lib/ai/route.ts folds
// recent turns into the prompt) but there was only ever ONE thread: clearing
// it was the only way to start a new topic, and it was gone for good. A
// student revising three subjects had no way to keep three conversations.
//
// A session is the unit here — named, listed, reopened, with its full turn
// history restored so the model picks up exactly where it left off.
//
// STORAGE: IndexedDB, per signed-in user, local only. Deliberately NOT the
// synced app database:
//   • a thread is working context, not a document — it should not consume
//     sync bandwidth or the 40GB database budget (docs/deployment-cost-plan);
//   • turns hold whole generated scripts and derivations, so a heavy user's
//     thread history dwarfs their actual pages;
//   • localStorage was not an option — the AI chat already competes with
//     page content for the same 5MB quota (see lib/store/scoped-storage.ts),
//     and page content must always win. IDB has no such ceiling, the same
//     reason lib/store/ephemeral-storage.ts moved there.
//
// Unlike ephemeral-storage, these SURVIVE sign-out on this device and are
// keyed per user, so several accounts on one machine keep separate histories.

import { ACTIVE_USER_KEY } from '@/lib/auth/store'
import type { AiTurn } from '@/lib/store/ai-chat'

export interface AiSession {
  id: string
  /** Shown in the list. Auto-derived from the first prompt, user-renamable. */
  title: string
  createdAt: number
  updatedAt: number
  turns: AiTurn[]
}

/** What the session list needs — everything except the turns, which are the
 *  expensive part and are only read when a session is actually opened. */
export type AiSessionMeta = Omit<AiSession, 'turns'> & { turnCount: number }

const DB_NAME = 'simblip-ai-sessions'
const STORE = 'sessions'

const userId = () =>
  typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_USER_KEY) ?? 'anon' : 'anon'

/** Keys are `${user}:${sessionId}` so one range scan lists a user's sessions
 *  and never another account's — same scheme as ephemeral-storage. */
const key = (id: string, user = userId()) => `${user}:${id}`

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

/** '￿' sorts after any printable character, so this spans exactly the
 *  keys belonging to one user. */
const userRange = (user = userId()) => IDBKeyRange.bound(`${user}:`, `${user}:￿`)

/** A readable name from the opening prompt — the thing a student actually
 *  recognises in a list. Truncated on a word boundary so it does not end
 *  mid-syllable. */
export function deriveTitle(prompt: string): string {
  const flat = prompt.trim().replace(/\s+/g, ' ')
  if (flat.length <= 40) return flat || 'New session'
  const cut = flat.slice(0, 40)
  const space = cut.lastIndexOf(' ')
  return `${space > 20 ? cut.slice(0, space) : cut}…`
}

export async function listSessions(): Promise<AiSessionMeta[]> {
  if (typeof indexedDB === 'undefined') return []
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll(userRange())
    req.onsuccess = () => {
      const rows = (req.result as AiSession[]) ?? []
      resolve(
        rows
          .map(({ turns, ...meta }) => ({ ...meta, turnCount: turns.length }))
          // Most recently used first: that is the one being resumed.
          .sort((a, b) => b.updatedAt - a.updatedAt)
      )
    }
    req.onerror = () => reject(req.error)
  })
}

export async function loadSession(id: string): Promise<AiSession | null> {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key(id))
    req.onsuccess = () => resolve((req.result as AiSession | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function saveSession(session: AiSession): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(session, key(session.id))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteSession(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key(id))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function renameSession(id: string, title: string): Promise<void> {
  const existing = await loadSession(id)
  if (!existing) return
  await saveSession({ ...existing, title: title.trim() || existing.title, updatedAt: Date.now() })
}
