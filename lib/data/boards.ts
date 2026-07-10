'use client'

// Virtual classroom boards. Each physical room has one board account that
// stays signed in on the classroom display, showing a rotating pairing code
// as a QR. A teacher scans it, picks a page, presses Present — the board
// then works on a TEMPORARY copy (`edited`); the teacher's original notebook
// only changes if they explicitly merge when the presentation ends.

import * as db from './db'
import { useAuthStore } from '@/lib/auth/store'
import type { PageDoc } from '@/lib/scene/types'
import type { BoardRow, BoardSessionRow, BoardSessionStatus, RoomRow } from './types'

export const newPairingCode = () => Math.random().toString(36).slice(2, 8).toUpperCase()

export async function myBoard(): Promise<{ board: BoardRow; room: RoomRow | null } | null> {
  const { profile } = useAuthStore.getState()
  if (!profile || profile.role !== 'board') return null
  const boards = await db.list<BoardRow>('boards', { profile_id: profile.id })
  const board = boards[0]
  if (!board) return null
  const rooms = await db.list<RoomRow>('rooms', { id: board.room_id })
  return { board, room: rooms[0] ?? null }
}

export async function rotatePairingCode(boardId: string): Promise<string> {
  const code = newPairingCode()
  await db.update('boards', boardId, {
    pairing_code: code,
    pairing_rotated_at: new Date().toISOString(),
  })
  return code
}

/** Resolve a scanned QR (board id + code) to a board, or null if stale. */
export async function resolvePairing(boardId: string, code: string): Promise<{ board: BoardRow; room: RoomRow | null } | null> {
  const boards = await db.list<BoardRow>('boards', { id: boardId })
  const board = boards[0]
  if (!board || board.pairing_code.toUpperCase() !== code.toUpperCase()) return null
  const rooms = await db.list<RoomRow>('rooms', { id: board.room_id })
  return { board, room: rooms[0] ?? null }
}

export async function startSession(input: {
  boardId: string
  pageId: string
  pageName: string
  snapshot: PageDoc
}): Promise<BoardSessionRow> {
  const { profile } = useAuthStore.getState()
  if (!profile) throw new Error('Not signed in')
  // One live session per board: end any leftovers first.
  const live = await db.list<BoardSessionRow>('board_sessions', {
    board_id: input.boardId,
    status: 'live',
  })
  await Promise.all(
    live.map((s) => db.update('board_sessions', s.id, { status: 'discarded', ended_at: new Date().toISOString() }))
  )
  const snapshot = JSON.parse(JSON.stringify(input.snapshot)) as PageDoc
  const row: BoardSessionRow = {
    id: db.newId(),
    institution_id: profile.institution_id,
    board_id: input.boardId,
    teacher_id: profile.id,
    page_id: input.pageId,
    page_name: input.pageName,
    snapshot,
    edited: snapshot,
    status: 'live',
    started_at: new Date().toISOString(),
  }
  await db.insert('board_sessions', row)
  return row
}

export const liveSessionFor = async (boardId: string): Promise<BoardSessionRow | null> =>
  (await db.list<BoardSessionRow>('board_sessions', { board_id: boardId, status: 'live' }))[0] ?? null

export const getSession = async (sessionId: string): Promise<BoardSessionRow | null> =>
  (await db.list<BoardSessionRow>('board_sessions', { id: sessionId }))[0] ?? null

/** Board pushes its working copy (debounced by the caller). */
export const saveSessionEdits = (sessionId: string, edited: PageDoc) =>
  db.update('board_sessions', sessionId, { edited })

export const endSession = (sessionId: string) =>
  db.update('board_sessions', sessionId, { status: 'ended', ended_at: new Date().toISOString() })

/** Teacher's post-presentation decision: merge back or discard. */
export const resolveSession = (sessionId: string, decision: 'merged' | 'discarded') =>
  db.update('board_sessions', sessionId, { status: decision satisfies BoardSessionStatus })

export const subscribeBoards = (fn: () => void) => db.subscribe('boards', fn)
export const subscribeBoardSessions = (fn: () => void) => db.subscribe('board_sessions', fn)
