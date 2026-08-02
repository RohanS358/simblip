import { experimental_upgradeWebSocket } from '@vercel/functions'
import type { WebSocket, WebSocketData } from '@vercel/functions'
import { verifyToken } from '@/lib/server/auth'
import { q } from '@/lib/server/pg'
import { authorizeBoardSession } from '@/lib/server/board-session-auth'
import { registerSocket, publish, ensureBoardLiveListener, type LocalSocket } from '@/lib/server/board-live-bus'
import type { BoardLiveClientMsg, BoardLiveServerMsg } from '@/lib/data/board-live-types'

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
  const token = new URL(req.url).searchParams.get('token')
  const claims = token ? verifyToken(token, 'access') : null
  if (!claims) return new Response('Unauthorized', { status: 401 })

  const auth = await authorizeBoardSession(sessionId, claims)
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
  role: 'teacher' | 'board' | 'student',
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
    if (msg.obj === null) {
      await q(
        `update simblip_board_sessions
            set edited = coalesce(edited, snapshot) #- array['objects', $2]
          where id = $1 and status = 'live'`,
        [sessionId, msg.objectId]
      )
    } else {
      await q(
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
    }
    const evt: BoardLiveServerMsg = { type: 'obj-patch', objectId: msg.objectId, obj: msg.obj, origin: role }
    await publish(sessionId, evt, socket)
    return
  }

  if (msg.type === 'remote') {
    if (role !== 'teacher') return // board/student sending themselves a command is meaningless
    const seq = Date.now()
    const cmd = { ...msg.cmd, seq }
    await q(
      `update simblip_board_sessions set remote = $2::jsonb where id = $1 and status = 'live'`,
      [sessionId, JSON.stringify(cmd)]
    )
    const evt: BoardLiveServerMsg = { type: 'remote', cmd }
    await publish(sessionId, evt, socket)
    return
  }

  if (msg.type === 'bundle') {
    await q(
      `update simblip_board_sessions set edited = $2::jsonb where id = $1 and status = 'live'`,
      [sessionId, JSON.stringify(msg.bundle)]
    )
    const evt: BoardLiveServerMsg = { type: 'bundle', bundle: msg.bundle, origin: role }
    // publish() size-guards NOTIFY automatically; same-instance peers still
    // get the full bundle synchronously regardless.
    await publish(sessionId, evt, socket)
  }
}
