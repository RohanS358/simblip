'use client'

// Room announcements. Staff post to one room (or institution-wide with
// room = null); enrolled students receive them in the notification center.

import * as db from './db'
import { useAuthStore } from '@/lib/auth/store'
import type { AnnouncementRow } from './types'

export async function postAnnouncement(body: string, roomId: string | null): Promise<void> {
  const { profile } = useAuthStore.getState()
  if (!profile) throw new Error('Not signed in')
  const row: AnnouncementRow = {
    id: db.newId(),
    institution_id: profile.institution_id,
    room_id: roomId,
    author_id: profile.id,
    author_name: profile.full_name,
    body,
    created_at: new Date().toISOString(),
  }
  await db.insert('announcements', row)
}

/** Announcements visible to the signed-in user (their rooms + institution-wide). */
export async function listMyAnnouncements(): Promise<AnnouncementRow[]> {
  const { profile, myRoomIds } = useAuthStore.getState()
  if (!profile) return []
  const rows = await db.list<AnnouncementRow>('announcements', {
    institution_id: profile.institution_id,
  })
  return rows
    .filter((a) => a.room_id === null || myRoomIds.includes(a.room_id) || a.author_id === profile.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Announcements a room board surfaces on its idle screen: its own room's
 *  plus institution-wide ones. Boards aren't room members, so this filters
 *  by the board's room id instead of membership. */
export async function listBoardAnnouncements(roomId: string | null): Promise<AnnouncementRow[]> {
  const { profile } = useAuthStore.getState()
  if (!profile) return []
  const rows = await db.list<AnnouncementRow>('announcements', {
    institution_id: profile.institution_id,
  })
  return rows
    .filter((a) => a.room_id === null || (roomId !== null && a.room_id === roomId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export const subscribeAnnouncements = (fn: () => void) => db.subscribe('announcements', fn)
