// Message protocol shared by the board-live WS route (server) and
// board-live-client (browser). No dependency on 'ws' or Node APIs here —
// this file is imported client-side too.

import type { SceneObject } from '@/lib/scene/types'
import type { RemoteCommand, BoardSessionStatus } from './types'
import type { PageBundle } from '@/lib/store/page-bundle'

/** 'desktop' = the presenting teacher's own workspace tab driving a live
 *  session directly (not the phone remote) — additive alongside teacher's
 *  existing role, same auth (session.teacher_id), just a second connection
 *  kind on the same session. */
export type BoardLiveRole = 'teacher' | 'board' | 'student' | 'desktop'

// ── Client → server ──────────────────────────────────────────────────────────

export type BoardLiveClientMsg =
  /** Whole-object replace (obj set) or delete (obj null). Board-kind
   *  sessions only — teacher, board AND student may all send these. */
  | { type: 'obj-patch'; objectId: string; obj: SceneObject | null }
  /** Teacher's phone → board transport/selection/param commands. Teacher-only. */
  | { type: 'remote'; cmd: Omit<RemoteCommand, 'seq'> }
  /** Whole-bundle replace — non-board-kind sessions (doc/pdf), any role. */
  | { type: 'bundle'; bundle: PageBundle }
  /** Live pointer position — desktop and board only (never students: with
   *  ~50 clients/board, broadcasting every viewer's cursor isn't useful and
   *  isn't cheap). Never persisted — pure pub/sub, no Postgres write. */
  | { type: 'cursor'; x: number; y: number; pageId: string }
  /** Desktop's pan/zoom — board's camera follows it (one-way: desktop
   *  drives). Never persisted, same ephemeral pub/sub-only path as cursor. */
  | { type: 'viewport'; x: number; y: number; zoom: number }

// ── Server → client ──────────────────────────────────────────────────────────

export type BoardLiveServerMsg =
  | { type: 'obj-patch'; objectId: string; obj: SceneObject | null; origin: BoardLiveRole }
  | { type: 'remote'; cmd: RemoteCommand }
  | { type: 'bundle'; bundle: PageBundle; origin: BoardLiveRole }
  | { type: 'status'; status: BoardSessionStatus }
  /** State may have drifted or a payload was too large to fan out inline —
   *  go re-pull full state via the existing REST call. */
  | { type: 'resync' }
  | { type: 'cursor'; x: number; y: number; pageId: string; origin: BoardLiveRole }
  | { type: 'viewport'; x: number; y: number; zoom: number; origin: BoardLiveRole }
