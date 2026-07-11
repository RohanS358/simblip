'use client'

// The virtual classroom board. Each physical room's display stays signed in
// with its dedicated board account. Idle: room identity + the pairing QR
// (always fixed bottom-left). A teacher scans the QR, picks a page, presses
// Present — the board loads a TEMPORARY copy for annotating and simulating.
// The teacher's original notebook is only touched if they merge afterwards.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, LibraryBig, Megaphone, MonitorPlay, PenLine, Square, X } from 'lucide-react'
import { RequireAuth } from '@/components/auth/require-auth'
import { QrCode } from '@/components/platform/qr-code'
import { InfiniteCanvas } from '@/components/workspace/canvas'
import { Transport } from '@/components/workspace/transport'
import { Toolbar } from '@/components/workspace/toolbar'
import { Palette } from '@/components/workspace/palette'
import { LibraryPanel } from '@/components/workspace/library-panel'
import { Inspector } from '@/components/workspace/inspector'
import { useAuthStore } from '@/lib/auth/store'
import { useDocStore } from '@/lib/store/document'
import { play, pause, stop } from '@/lib/physics/world'
import {
  endSession,
  liveSessionFor,
  myBoard,
  pollRemote,
  rotatePairingCode,
  saveSessionEdits,
  subscribeBoardSessions,
} from '@/lib/data/boards'
import { dbMode } from '@/lib/data/db'
import { listBoardAnnouncements, subscribeAnnouncements } from '@/lib/data/announcements'
import type { AnnouncementRow } from '@/lib/data/types'
import { num } from '@/lib/scene/types'
import type { BoardRow, BoardSessionRow, RemoteCommand, RoomRow } from '@/lib/data/types'
import { Button } from '@/components/ui/button'

// The teacher's phone drives the board through commands stamped on the
// session row — each seq is applied exactly once.
function applyRemote(cmd: RemoteCommand, pageId: string) {
  const doc = useDocStore.getState()
  switch (cmd.kind) {
    case 'play':
      play(pageId)
      break
    case 'pause':
      pause()
      break
    case 'stop':
      stop()
      break
    case 'pdf':
      window.dispatchEvent(
        new CustomEvent('simblip-remote-pdf', { detail: { dir: cmd.dir ?? 1, objectId: cmd.objectId } })
      )
      break
    case 'select':
      doc.setSelection(cmd.objectId ? [cmd.objectId] : [])
      break
    case 'param':
      if (cmd.objectId && cmd.behaviorId && cmd.param)
        doc.setBehaviorParam(pageId, cmd.objectId, cmd.behaviorId, cmd.param, cmd.value ?? '0')
      break
    case 'toggle': {
      // Flip an interactive component (switch/logic input) exactly like a
      // tap on the board — flipping the board's CURRENT value keeps it
      // correct even when the phone's mirror of the doc is a little stale.
      if (!cmd.objectId || !cmd.param) break
      const obj = doc.pages[pageId]?.objects[cmd.objectId]
      if (!obj) break
      const p = obj.parameters[cmd.param]
      const cur = p?.kind === 'number' ? p.value : cmd.param === 'closed' ? 1 : 0
      const next = cur >= 0.5 ? '0' : '1'
      if (p) doc.setParam(pageId, cmd.objectId, cmd.param, next)
      else
        doc.updateObject(pageId, cmd.objectId, {
          parameters: { ...obj.parameters, [cmd.param]: num(next) },
        })
      break
    }
  }
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// Room + institution announcements as a stacked card pile on the idle
// screen — the board doubles as the room's notice display between classes.
function AnnouncementStack({ items }: { items: AnnouncementRow[] }) {
  if (items.length === 0) return null
  return (
    <div className="absolute right-6 top-1/2 z-30 hidden w-[min(360px,26vw)] -translate-y-1/2 lg:block">
      <p className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        <Megaphone className="h-3.5 w-3.5" /> Announcements
      </p>
      <div className="space-y-3">
        {items.slice(0, 4).map((a, i) => (
          <div
            key={a.id}
            className="glass-strong rounded-2xl p-4 text-left shadow-lg"
            style={{
              // stacked-pile look: cards behind the newest tuck in slightly
              transform: `scale(${1 - i * 0.02})`,
              opacity: 1 - i * 0.16,
              transformOrigin: 'top center',
            }}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <p className="truncate text-[12px] font-bold">{a.author_name}</p>
              <p className="shrink-0 text-[10.5px] text-muted-foreground">
                {a.room_id === null ? 'Institution · ' : ''}
                {timeAgo(a.created_at)}
              </p>
            </div>
            <p className="line-clamp-4 text-[13px] leading-relaxed text-foreground/90">{a.body}</p>
          </div>
        ))}
        {items.length > 4 && (
          <p className="text-center text-[11px] text-muted-foreground">
            +{items.length - 4} more
          </p>
        )}
      </div>
    </div>
  )
}

function BoardSurface() {
  const institution = useAuthStore((s) => s.institution)
  const [board, setBoard] = useState<BoardRow | null>(null)
  const [room, setRoom] = useState<RoomRow | null>(null)
  const [session, setSession] = useState<BoardSessionRow | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [qrBig, setQrBig] = useState(false)
  const [libOpen, setLibOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [scratch, setScratch] = useState(false) // temporary whiteboard, never saved
  const [clock, setClock] = useState('')
  const pageIdRef = useRef<string | null>(null)
  // Remote replay guard: only commands newer than this seq run.
  const remoteSeqRef = useRef(0)
  const remoteSessionRef = useRef<string | null>(null)

  // Board identity.
  useEffect(() => {
    void myBoard().then((res) => {
      if (res) {
        setBoard(res.board)
        setRoom(res.room)
      }
    })
  }, [])

  // Announcement feed for the idle screen (room + institution-wide).
  const [annos, setAnnos] = useState<AnnouncementRow[]>([])
  useEffect(() => {
    if (!board) return
    const load = () => void listBoardAnnouncements(board.room_id).then(setAnnos)
    load()
    const t = setInterval(load, 60_000) // cloud poll only runs while subscribed; refresh timestamps too
    const unsub = subscribeAnnouncements(load)
    return () => {
      clearInterval(t)
      unsub()
    }
  }, [board])

  // Idle clock.
  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    tick()
    const t = setInterval(tick, 10_000)
    return () => clearInterval(t)
  }, [])

  // Watch for sessions addressed to this board.
  const syncSession = useCallback(async () => {
    if (!board) return
    const live = await liveSessionFor(board.id)
    if (live) {
      if (remoteSessionRef.current !== live.id) {
        // New session: adopt its current seq WITHOUT firing stale commands.
        remoteSessionRef.current = live.id
        remoteSeqRef.current = live.remote?.seq ?? 0
      } else if (live.remote && live.remote.seq > remoteSeqRef.current) {
        remoteSeqRef.current = live.remote.seq
        applyRemote(live.remote, `board-${live.id}`)
      }
    }
    setSession((prev) => {
      if (live && prev?.id !== live.id) {
        // New presentation: load the temporary copy into a scratch page.
        const tempId = `board-${live.id}`
        pageIdRef.current = tempId
        useDocStore.setState((s) => ({
          pages: { ...s.pages, [tempId]: JSON.parse(JSON.stringify(live.edited ?? live.snapshot)) },
        }))
        useDocStore.getState().ensurePage(tempId)
        return live
      }
      if (!live && prev) {
        // Presentation over: drop the temp copy, rotate the pairing code.
        stop()
        const tempId = pageIdRef.current
        if (tempId) {
          useDocStore.setState((s) => {
            const pages = { ...s.pages }
            delete pages[tempId]
            return { pages }
          })
          pageIdRef.current = null
        }
        void rotatePairingCode(board.id).then((code) =>
          setBoard((b) => (b ? { ...b, pairing_code: code } : b))
        )
        return null
      }
      return prev
    })
  }, [board])

  useEffect(() => {
    if (!board) return
    void syncSession()
    return subscribeBoardSessions(() => void syncSession())
  }, [board, syncSession])

  // Fast remote lane (cloud only — local mode is already instant over
  // BroadcastChannel): poll just the tiny remote/status columns at ~1 Hz so
  // phone commands land in about a second instead of riding the 4 s
  // full-session poll.
  useEffect(() => {
    if (!session || dbMode !== 'cloud') return
    let busy = false
    const t = setInterval(async () => {
      if (busy) return
      busy = true
      try {
        const r = await pollRemote(session.id)
        if (!r) return
        if (r.status !== 'live') {
          void syncSession() // ended/merged elsewhere — tear down promptly
        } else if (r.remote && r.remote.seq > remoteSeqRef.current) {
          remoteSeqRef.current = r.remote.seq
          applyRemote(r.remote, `board-${session.id}`)
        }
      } catch {
        /* transient network error — next tick retries */
      } finally {
        busy = false
      }
    }, 1100)
    return () => clearInterval(t)
  }, [session, syncSession])

  // Push the board's edits into the session row (debounced) so the teacher's
  // merge decision sees the latest state.
  useEffect(() => {
    if (!session) return
    const tempId = `board-${session.id}`
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useDocStore.subscribe((s, prev) => {
      const page = s.pages[tempId]
      if (!page || page === prev.pages[tempId]) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void saveSessionEdits(session.id, page), 1000)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsub()
    }
  }, [session])

  const pairUrl =
    board && typeof window !== 'undefined'
      ? `${window.location.origin}/present?board=${board.id}&code=${board.pairing_code}`
      : null

  if (!board) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 bg-background text-center">
        <MonitorPlay className="h-6 w-6 text-muted-foreground/60" />
        <p className="text-[14px] font-semibold">No board configured for this account</p>
        <p className="max-w-72 text-[12.5px] text-muted-foreground">
          Ask your institution admin to create a room board and sign in with its credentials.
        </p>
      </div>
    )
  }

  // Session takes over the surface; a scratch whiteboard yields to it.
  const activeBoardPage = session ? `board-${session.id}` : scratch ? 'board-scratch' : null

  const openScratch = () => {
    useDocStore.setState((s) => ({
      pages: { ...s.pages, 'board-scratch': { objects: {}, variables: [] } },
    }))
    useDocStore.getState().ensurePage('board-scratch')
    setScratch(true)
  }
  const closeScratch = () => {
    stop()
    useDocStore.setState((s) => {
      const pages = { ...s.pages }
      delete pages['board-scratch']
      return { pages }
    })
    setScratch(false)
  }

  return (
    <div className="relative h-dvh overflow-hidden bg-background">
      {activeBoardPage ? (
        <div className="flex h-full">
          <div className="relative min-w-0 flex-1">
          <InfiniteCanvas key={activeBoardPage} pageId={activeBoardPage} />
          <Transport pageId={activeBoardPage} />
          <Toolbar
            paletteOpen={paletteOpen}
            onTogglePalette={() => setPaletteOpen((o) => !o)}
            showAi={false}
            pageId={activeBoardPage}
          />
          <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

          {/* Mid-edge handle, same affordance as the notebook shell. */}
          <button
            type="button"
            aria-label={inspectorOpen ? 'Close inspector' : 'Open inspector'}
            className="glass-strong absolute right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl px-0.5 py-4 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setInspectorOpen((o) => !o)}
          >
            {inspectorOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          <div className="absolute right-4 top-4 z-40 flex items-center gap-2">
            <span className="glass rounded-xl px-3 py-1.5 text-[12.5px] font-semibold">
              {session
                ? `${session.page_name} · presented by ${room?.name ?? 'room'}`
                : 'Temporary whiteboard — nothing is saved'}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              aria-label="Toggle library"
              onClick={() => setLibOpen((o) => !o)}
            >
              <LibraryBig className="h-3.5 w-3.5" /> Library
            </Button>
            {session ? (
              <Button size="sm" variant="outline" className="h-8" onClick={() => void endSession(session.id)}>
                <Square className="h-3.5 w-3.5" /> End presentation
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-8" onClick={closeScratch}>
                <X className="h-3.5 w-3.5" /> Close whiteboard
              </Button>
            )}
          </div>

          {libOpen && (
            <div className="absolute bottom-4 right-4 top-16 z-40 flex">
              <LibraryPanel open onClose={() => setLibOpen(false)} pageId={activeBoardPage} />
            </div>
          )}
          </div>
          {inspectorOpen && <Inspector pageId={activeBoardPage} />}
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <p className="text-[13px] uppercase tracking-[0.2em] text-muted-foreground">
            {institution?.name ?? 'SIMBLIP'}
          </p>
          <h1 className="text-5xl font-extrabold tracking-tight">{room?.name ?? 'Room board'}</h1>
          <p className="text-[15px] text-muted-foreground">{clock}</p>
          <p className="mt-6 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
            Scan the QR code with your phone to present a notebook page on this board.
          </p>
          <Button variant="outline" className="mt-4" onClick={openScratch}>
            <PenLine className="h-4 w-4" /> Open temporary whiteboard
          </Button>
          <AnnouncementStack items={annos} />
        </div>
      )}

      {/* Tap the QR to blow it up edge-to-edge for the back rows. */}
      {pairUrl && qrBig && (
        <button
          type="button"
          aria-label="Close large QR"
          className="fixed inset-0 z-[70] flex cursor-zoom-out flex-col items-center justify-center gap-4 bg-white"
          onClick={() => setQrBig(false)}
        >
          <QrCode value={pairUrl} size={2048} className="h-[min(84vmin,84%)] w-[min(84vmin,84%)]" />
          <p className="font-mono text-[clamp(20px,4vmin,44px)] font-bold tracking-[0.3em] text-black">
            {board.pairing_code}
          </p>
        </button>
      )}

      {/* The pairing QR is ALWAYS visible, fixed bottom-left. */}
      {pairUrl && (
        <div className="glass-strong absolute bottom-4 left-4 z-50 flex items-center gap-3 rounded-2xl p-3">
          <button
            type="button"
            aria-label="Enlarge QR to full screen"
            className="cursor-zoom-in"
            onClick={() => setQrBig(true)}
          >
            <QrCode value={pairUrl} size={session ? 72 : 128} className="rounded-lg" />
          </button>
          <div className="pr-1 text-left">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Pair to present
            </p>
            <p className="font-mono text-[15px] font-bold tracking-[0.2em]">{board.pairing_code}</p>
            {!session && (
              <p className="mt-0.5 max-w-40 text-[10.5px] leading-snug text-muted-foreground">
                Scan with your phone, pick a page, press Present.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function BoardPage() {
  return (
    <RequireAuth allow={['board']}>
      <BoardSurface />
    </RequireAuth>
  )
}
