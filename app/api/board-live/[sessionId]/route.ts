import { experimental_upgradeWebSocket } from '@vercel/functions'
import type { WebSocket, WebSocketData } from '@vercel/functions'
import { verifyToken } from '@/lib/server/auth'
import { q } from '@/lib/server/pg'
import { authorizeBoardSession } from '@/lib/server/board-session-auth'
import { registerSocket, publish, ensureBoardLiveListener, type LocalSocket } from '@/lib/server/board-live-bus'
import type { BoardLiveClientMsg, BoardLiveRole, BoardLiveServerMsg } from '@/lib/data/board-live-types'

// Realtime push for a single board session: teacher, board and students all
// read/write the same simblip_board_sessions row live. See
// docs — this replaces the 4s/1.1s polls in app/board/page.tsx with a push
// channel, degrading back to those polls automatically when disconnected.
//
// Browsers can't set custom headers on a WS handshake, so auth travels as
// ?token=<access_token> instead — verified with the same verifyToken() the
// REST gateway uses. No change to token format.

type Params = { params: Promise<{ sessionId: string }> }

export async function GET(req: Request, { params }: Params) {
  const { sessionId } = await params
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const claims = token ? verifyToken(token, 'access') : null
  if (!claims) return new Response('Unauthorized', { status: 401 })

  const wantDesktop = url.searchParams.get('role') === 'desktop'
  const auth = await authorizeBoardSession(sessionId, claims, wantDesktop ? 'desktop' : undefined)
  if (!auth) return new Response('Forbidden', { status: 403 })
  if (auth.session.status !== 'live') return new Response('Session is not live', { status: 409 })

  await ensureBoardLiveListener()

  return experimental_upgradeWebSocket((ws: WebSocket) => {
    const local: LocalSocket = { sessionId, send: (data) => ws.send(data) }
    const unregister = registerSocket(local)

    ws.on('message', (data: WebSocketData) => {
      void handleMessage(sessionId, auth.as, local, data).catch((err) => {
        console.error('board-live message error', err)
      })
    })
    ws.on('close', unregister)
    ws.on('error', unregister)
  })
}

async function handleMessage(
  sessionId: string,
  role: BoardLiveRole,
  socket: LocalSocket,
  data: WebSocketData
): Promise<void> {
  let msg: BoardLiveClientMsg
  try {
    msg = JSON.parse(data.toString()) as BoardLiveClientMsg
  } catch {
    return
  }

  if (msg.type === 'obj-patch') {
    // Any of teacher/board/student may edit board-kind canvas objects —
    // this is the whole point of the feature.
    //
    // Broadcast first, persist after: live latency must not depend on
    // Postgres round-trip time. The DB write still happens, just off the
    // critical path — a lost write on crash is an acceptable tradeoff for
    // an ephemeral live session (snapshot/edited is periodically resynced
    // anyway on reconnect).
    const evt: BoardLiveServerMsg = { type: 'obj-patch', objectId: msg.objectId, obj: msg.obj, origin: role }
    await publish(sessionId, evt, socket)
    const write =
      msg.obj === null
        ? q(
            `update simblip_board_sessions
                set edited = coalesce(edited, snapshot) #- array['objects', $2]
              where id = $1 and status = 'live'`,
            [sessionId, msg.objectId]
          )
        : q(
            `update simblip_board_sessions
                set edited = jsonb_set(
                  coalesce(edited, snapshot, '{"objects":{},"variables":[]}'::jsonb),
                  array['objects', $2],
                  $3::jsonb,
                  true
                )
              where id = $1 and status = 'live'`,
            [sessionId, msg.objectId, JSON.stringify(msg.obj)]
          )
    write.catch((err) => console.error('board-live obj-patch persist error', err))
    return
  }

  if (msg.type === 'remote') {
    // 'desktop' is the presenting teacher's own screen (same identity check
    // as 'teacher' in authorizeBoardSession) — board/student sending
    // themselves a command is meaningless, desktop driving the board is not.
    if (role !== 'teacher' && role !== 'desktop') return
    const seq = Date.now()
    const cmd = { ...msg.cmd, seq }
    const evt: BoardLiveServerMsg = { type: 'remote', cmd }
    await publish(sessionId, evt, socket)
    q(
      `update simblip_board_sessions set remote = $2::jsonb where id = $1 and status = 'live'`,
      [sessionId, JSON.stringify(cmd)]
    ).catch((err) => console.error('board-live remote persist error', err))
    return
  }

  if (msg.type === 'bundle') {
    const evt: BoardLiveServerMsg = { type: 'bundle', bundle: msg.bundle, origin: role }
    await publish(sessionId, evt, socket)
    q(
      `update simblip_board_sessions set edited = $2::jsonb where id = $1 and status = 'live'`,
      [sessionId, JSON.stringify(msg.bundle)]
    ).catch((err) => console.error('board-live bundle persist error', err))
    return
  }

  if (msg.type === 'cursor') {
    // Only desktop and board drive a pointer worth showing (students never
    // send this). Never touches Postgres — pure ephemeral fan-out, same
    // path obj-patch uses minus the DB write.
    if (role !== 'desktop' && role !== 'board') return
    const evt: BoardLiveServerMsg = { type: 'cursor', x: msg.x, y: msg.y, pageId: msg.pageId, origin: role }
    await publish(sessionId, evt, socket)
    return
  }

  if (msg.type === 'viewport') {
    // Desktop drives, board follows — one-way, board never sends this.
    if (role !== 'desktop') return
    const evt: BoardLiveServerMsg = { type: 'viewport', x: msg.x, y: msg.y, zoom: msg.zoom, origin: role }
    await publish(sessionId, evt, socket)
  }
}
