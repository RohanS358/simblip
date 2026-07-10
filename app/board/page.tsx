'use client'

// The virtual classroom board. Each physical room's display stays signed in
// with its dedicated board account. Idle: room identity + the pairing QR
// (always fixed bottom-left). A teacher scans the QR, picks a page, presses
// Present — the board loads a TEMPORARY copy for annotating and simulating.
// The teacher's original notebook is only touched if they merge afterwards.

import { useCallback, useEffect, useRef, useState } from 'react'
import { MonitorPlay, Square } from 'lucide-react'
import { RequireAuth } from '@/components/auth/require-auth'
import { QrCode } from '@/components/platform/qr-code'
import { InfiniteCanvas } from '@/components/workspace/canvas'
import { Transport } from '@/components/workspace/transport'
import { Toolbar } from '@/components/workspace/toolbar'
import { Palette } from '@/components/workspace/palette'
import { useAuthStore } from '@/lib/auth/store'
import { useDocStore } from '@/lib/store/document'
import { stop } from '@/lib/physics/world'
import {
  endSession,
  liveSessionFor,
  myBoard,
  rotatePairingCode,
  saveSessionEdits,
  subscribeBoardSessions,
} from '@/lib/data/boards'
import type { BoardRow, BoardSessionRow, RoomRow } from '@/lib/data/types'
import { Button } from '@/components/ui/button'

function BoardSurface() {
  const institution = useAuthStore((s) => s.institution)
  const [board, setBoard] = useState<BoardRow | null>(null)
  const [room, setRoom] = useState<RoomRow | null>(null)
  const [session, setSession] = useState<BoardSessionRow | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [clock, setClock] = useState('')
  const pageIdRef = useRef<string | null>(null)

  // Board identity.
  useEffect(() => {
    void myBoard().then((res) => {
      if (res) {
        setBoard(res.board)
        setRoom(res.room)
      }
    })
  }, [])

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

  return (
    <div className="relative h-dvh overflow-hidden bg-background">
      {session ? (
        <>
          <InfiniteCanvas key={session.id} pageId={`board-${session.id}`} />
          <Transport pageId={`board-${session.id}`} />
          <Toolbar paletteOpen={paletteOpen} onTogglePalette={() => setPaletteOpen((o) => !o)} showAi={false} />
          <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

          <div className="absolute right-4 top-4 z-40 flex items-center gap-2">
            <span className="glass rounded-xl px-3 py-1.5 text-[12.5px] font-semibold">
              {session.page_name} · presented by {room?.name ?? 'room'}
            </span>
            <Button size="sm" variant="outline" className="h-8" onClick={() => void endSession(session.id)}>
              <Square className="h-3.5 w-3.5" /> End presentation
            </Button>
          </div>
        </>
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
        </div>
      )}

      {/* The pairing QR is ALWAYS visible, fixed bottom-left. */}
      {pairUrl && (
        <div className="glass-strong absolute bottom-4 left-4 z-50 flex items-center gap-3 rounded-2xl p-3">
          <QrCode value={pairUrl} size={session ? 72 : 128} className="rounded-lg" />
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
