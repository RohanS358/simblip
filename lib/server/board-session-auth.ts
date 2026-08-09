// Fine-grained board_sessions authorization. The REST gateway
// (app/api/pg/[table]/route.ts) only enforces institution-level scoping for
// this table — it has no "is this caller the teacher, the board, or a room
// member" check. This is that check, written once for the WS route.

import { q } from './pg'
import type { Claims } from './auth'
import type { BoardSessionRow } from '@/lib/data/types'
import type { BoardLiveRole } from '@/lib/data/board-live-types'

export interface BoardSessionAuth {
  session: BoardSessionRow
  as: BoardLiveRole
}

interface SessionJoinRow extends BoardSessionRow {
  room_id: string
  board_profile_id: string
}

export async function authorizeBoardSession(
  sessionId: string,
  claims: Claims,
  wantRole?: 'desktop'
): Promise<BoardSessionAuth | null> {
  const rows = await q<SessionJoinRow>(
    `select s.*, b.room_id as room_id, b.profile_id as board_profile_id
       from simblip_board_sessions s
       join simblip_boards b on b.id = s.board_id
      where s.id = $1`,
    [sessionId]
  )
  const row = rows[0]
  if (!row) return null
  const { room_id, board_profile_id, ...session } = row
  const isOperator = claims.role === 'super_admin'
  if (!isOperator && claims.inst !== session.institution_id) return null

  if (isOperator || claims.sub === session.teacher_id) {
    // Same identity check as 'teacher' — 'desktop' is that same presenting
    // teacher connecting a second time from their own workspace tab, not a
    // separate identity with separate privileges.
    return { session, as: wantRole === 'desktop' ? 'desktop' : 'teacher' }
  }
  if (claims.role === 'board' && claims.sub === board_profile_id) {
    return { session, as: 'board' }
  }
  const membership = await q<{ profile_id: string }>(
    'select profile_id from simblip_room_members where room_id = $1 and profile_id = $2',
    [room_id, claims.sub]
  )
  if (membership[0]) return { session, as: 'student' }
  return null
}
