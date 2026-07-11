'use client'

// Clone-on-share. A share is a frozen PageDoc copy addressed to a room or a
// person; recipients import it into their own notebook and own the copy.
// The sender's original is never exposed or linked.

import * as db from './db'
import { useAuthStore } from '@/lib/auth/store'
import type { PageDoc } from '@/lib/scene/types'
import type { ShareRow } from './types'

export async function sharePage(
  title: string,
  content: PageDoc,
  target: { roomId?: string; profileId?: string }
): Promise<void> {
  const { profile } = useAuthStore.getState()
  if (!profile) throw new Error('Not signed in')
  const row: ShareRow = {
    id: db.newId(),
    institution_id: profile.institution_id,
    sender_id: profile.id,
    sender_name: profile.full_name,
    title,
    content: JSON.parse(JSON.stringify(content)) as PageDoc,
    target_room_id: target.roomId ?? null,
    target_profile_id: target.profileId ?? null,
    created_at: new Date().toISOString(),
  }
  await db.insert('shares', row)
}

/** Shares addressed to the signed-in user, directly or via room membership. */
export async function listIncomingShares(): Promise<ShareRow[]> {
  const { profile, myRoomIds } = useAuthStore.getState()
  if (!profile) return []
  const rows = await db.list<ShareRow>('shares', { institution_id: profile.institution_id })
  return rows
    .filter(
      (s) =>
        s.sender_id !== profile.id &&
        (s.target_profile_id === profile.id ||
          (s.target_room_id !== null && myRoomIds.includes(s.target_room_id)))
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function listSentShares(): Promise<ShareRow[]> {
  const { profile } = useAuthStore.getState()
  if (!profile) return []
  return db.list<ShareRow>('shares', { sender_id: profile.id })
}

/** Shares addressed to one room — the board's idle feed. Metadata only:
 *  the PageDoc content never needs to reach the classroom display. */
export async function listRoomShares(roomId: string): Promise<ShareRow[]> {
  const { profile } = useAuthStore.getState()
  if (!profile) return []
  const rows = await db.list<ShareRow>(
    'shares',
    { institution_id: profile.institution_id, target_room_id: roomId },
    'id,sender_id,sender_name,title,target_room_id,target_profile_id,created_at'
  )
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export const subscribeShares = (fn: () => void) => db.subscribe('shares', fn)

// ── Import bookkeeping (per user, per device) ───────────────────────────────

const importedKey = (userId: string) => `simblip-imported-shares:${userId}`

export function importedShareIds(userId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(importedKey(userId)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function markShareImported(userId: string, shareId: string) {
  const ids = importedShareIds(userId)
  ids.add(shareId)
  localStorage.setItem(importedKey(userId), JSON.stringify([...ids]))
}
