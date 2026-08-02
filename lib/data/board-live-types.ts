// Message protocol shared by the board-live WS route (server) and
// board-live-client (browser). No dependency on 'ws' or Node APIs here —
// this file is imported client-side too.

import type { SceneObject } from '@/lib/scene/types'
import type { RemoteCommand, BoardSessionStatus } from './types'
import type { PageBundle } from '@/lib/store/page-bundle'

export type BoardLiveRole = 'teacher' | 'board' | 'student'

// ── Client → server ──────────────────────────────────────────────────────────

export type BoardLiveClientMsg =
  /** Whole-object replace (obj set) or delete (obj null). Board-kind
   *  sessions only — teacher, board AND student may all send these. */
  | { type: 'obj-patch'; objectId: string; obj: SceneObject | null }
  /** Teacher's phone → board transport/selection/param commands. Teacher-only. */
  | { type: 'remote'; cmd: Omit<RemoteCommand, 'seq'> }
  /** Whole-bundle replace — non-board-kind sessions (doc/pdf), any role. */
  | { type: 'bundle'; bundle: PageBundle }

// ── Server → client ──────────────────────────────────────────────────────────

export type BoardLiveServerMsg =
  | { type: 'obj-patch'; objectId: string; obj: SceneObject | null; origin: BoardLiveRole }
  | { type: 'remote'; cmd: RemoteCommand }
  | { type: 'bundle'; bundle: PageBundle; origin: BoardLiveRole }
  | { type: 'status'; status: BoardSessionStatus }
  /** State may have drifted or a payload was too large to fan out inline —
   *  go re-pull full state via the existing REST call. */
  | { type: 'resync' }
