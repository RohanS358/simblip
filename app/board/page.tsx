'use client'

// The virtual classroom board. Each physical room's display stays signed in
// with its dedicated board account. Idle: room identity + the pairing QR
// (always fixed bottom-left). A teacher scans the QR, picks a page, presses
// Present — the board loads a TEMPORARY copy for annotating and simulating.
// The teacher's original notebook is only touched if they merge afterwards.

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { motion as fm, AnimatePresence } from 'framer-motion'
import {
  BookOpen,
  ClipboardList,
  GraduationCap,
  Megaphone,
  MonitorPlay,
  Moon,
  PenLine,
  QrCode as QrCodeIcon,
  Search,
  Square,
  Sun,
  X,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { isDarkTheme } from '@/components/theme-provider'
import { RequireAuth } from '@/components/auth/require-auth'
import { QrCode } from '@/components/platform/qr-code'
import { PageView } from '@/components/workspace/page-view'
import { CanvasControls } from '@/components/workspace/canvas-controls'
import { Dock } from '@/components/workspace/dock'
import { Sidebar, RailButton } from '@/components/workspace/sidebar'
import { CommandPalette } from '@/components/workspace/command-palette'
import { SettingsDialog } from '@/components/workspace/settings-dialog'
import { TutorialPanel } from '@/components/workspace/tutorial'
import { Calculator } from '@/components/workspace/calculator'
import { UndoRedo } from '@/components/workspace/undo-redo'
import { SyncStatus } from '@/components/workspace/sync-status'
import { NotificationCenter } from '@/components/workspace/notifications'
import { ProfileMenu } from '@/components/workspace/profile-menu'
import { useDockClearance } from '@/hooks/use-dock-clearance'
import { useAuthStore } from '@/lib/auth/store'
import { ROLE_LABEL } from '@/lib/auth/types'
import { useDocStore } from '@/lib/store/document'
import { useWorkspaceStore, findPageMeta } from '@/lib/store/workspace'
import { usePrefs } from '@/lib/store/preferences'
import {
  bundleMetaPatch,
  bundlePage,
  writeBundleContent,
  type PageBundle,
} from '@/lib/store/page-bundle'
import * as pageArchive from '@/lib/store/page-archive'
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
import { listRoomShares, subscribeShares } from '@/lib/data/shares'
import { listRoomAssignments, subscribeAssignments } from '@/lib/data/assignments'
import { num } from '@/lib/scene/types'
import type { BoardRow, BoardSessionRow, RemoteCommand, RoomRow } from '@/lib/data/types'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { FileObject } from '@/components/objects/file-view'
import { cn } from '@/lib/utils'

// A remote command names an object; on a doc/pdf session that object may
// live on a sheet rather than the main content page — target whichever
// loaded page actually holds it.
function pageHolding(mainId: string, objectId: string): string {
  const pages = useDocStore.getState().pages
  if (pages[mainId]?.objects[objectId]) return mainId
  const meta = findPageMeta(useWorkspaceStore.getState().notebooks, mainId)
  for (const id of [
    ...(meta?.docPages ?? []),
    ...(meta?.notesPages ?? []).filter(Boolean),
    ...(meta?.annotPages ?? []).filter(Boolean),
  ])
    if (pages[id]?.objects[objectId]) return id
  return mainId
}

// The teacher's phone drives the board through commands stamped on the
// session row — each seq is applied exactly once.
function applyRemote(cmd: RemoteCommand, pageId: string) {
  const doc = useDocStore.getState()
  if (cmd.objectId && (cmd.kind === 'param' || cmd.kind === 'toggle'))
    pageId = pageHolding(pageId, cmd.objectId)
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

// The board account has no real notebook tree, but DocView/PdfView resolve a
// page's kind and sheets through workspace metadata — so a presented page is
// materialized as a real (temporary) tree entry, and every page kind renders
// on the board exactly as it does in the notebook. Sheet ids are kept as the
// teacher sent them, so edits round-trip back into the session bundle.
const BOARD_NB = '__board-session'

function registerSessionPage(tempId: string, name: string, bundle: PageBundle) {
  useWorkspaceStore.setState((s) => ({
    notebooks: [
      ...s.notebooks.filter((n) => n.name !== BOARD_NB),
      {
        id: BOARD_NB,
        name: BOARD_NB,
        emoji: '🖥️',
        sections: [
          {
            id: `${BOARD_NB}-sec`,
            name: 'Live',
            color: 'blue',
            pages: [{ id: tempId, name, ...(bundle.bundle ? bundleMetaPatch(bundle.bundle) : { kind: 'board' as const }) }],
          },
        ],
      },
    ],
    activePageId: tempId,
  }))
  writeBundleContent(tempId, bundle)
}

function clearSessionPage(tempId: string) {
  const meta = findPageMeta(useWorkspaceStore.getState().notebooks, tempId)
  const ids = [
    tempId,
    ...(meta?.docPages ?? []),
    ...(meta?.notesPages ?? []).filter(Boolean),
    ...(meta?.annotPages ?? []).filter(Boolean),
    ...(meta?.notesDocId ? [meta.notesDocId] : []),
  ]
  // NOT forgetPage — these ids belong to the teacher's pages; marking them
  // deleted here would delete the originals from the cloud.
  useDocStore.setState((s) => {
    const pages = { ...s.pages }
    const scopes = { ...s.scopes }
    for (const id of ids) {
      delete pages[id]
      delete scopes[id]
    }
    return { pages, scopes }
  })
  ids.forEach((id) => pageArchive.dropPage(id))
  useWorkspaceStore.setState((s) => ({
    notebooks: s.notebooks.filter((n) => n.name !== BOARD_NB),
    activePageId: s.activePageId === tempId ? null : s.activePageId,
    activeSheetId: null,
    pdfToolsActive: false,
  }))
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// Everything the class was sent — announcements, shared notebook pages and
// assignments — as one stacked card pile on the idle screen. The board
// doubles as the room's notice display between classes.
interface BoardNotice {
  id: string
  kind: 'announcement' | 'share' | 'assignment'
  title?: string
  body?: string
  author: string
  scope: 'room' | 'institution'
  created_at: string
  due_at?: string | null
}

const NOTICE_META = {
  announcement: { label: 'Announcement', color: 'var(--accent-amber)', Icon: Megaphone },
  share: { label: 'Notebook shared', color: 'var(--accent-blue)', Icon: BookOpen },
  assignment: { label: 'Assignment', color: 'var(--accent-violet)', Icon: ClipboardList },
} as const

function NoticeStack({ items }: { items: BoardNotice[] }) {
  if (items.length === 0) return null
  return (
    <div className="absolute right-6 top-1/2 z-30 hidden w-[min(360px,26vw)] -translate-y-1/2 lg:block">
      <p className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        <Megaphone className="h-3.5 w-3.5" /> Class notices
      </p>
      <div className="space-y-3">
        {items.slice(0, 4).map((n, i) => {
          const meta = NOTICE_META[n.kind]
          return (
            <div
              key={`${n.kind}-${n.id}`}
              className="glass-strong rounded-2xl p-4 text-left shadow-lg"
              style={{
                // stacked-pile look: cards behind the newest tuck in slightly
                transform: `scale(${1 - i * 0.02})`,
                opacity: 1 - i * 0.16,
                transformOrigin: 'top center',
              }}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span
                  className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: meta.color }}
                >
                  <meta.Icon className="h-3.5 w-3.5 shrink-0" /> {meta.label}
                </span>
                <span className="shrink-0 text-[10.5px] text-muted-foreground">
                  {n.scope === 'institution' ? 'Institution · ' : ''}
                  {timeAgo(n.created_at)}
                </span>
              </div>
              {n.title && <p className="text-[13.5px] font-bold leading-snug">{n.title}</p>}
              {n.body && (
                <p className="line-clamp-3 text-[12.5px] leading-relaxed text-foreground/90">{n.body}</p>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {n.author}
                {n.due_at
                  ? ` · due ${new Date(n.due_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                  : ''}
              </p>
            </div>
          )
        })}
        {items.length > 4 && (
          <p className="text-center text-[11px] text-muted-foreground">+{items.length - 4} more</p>
        )}
      </div>
    </div>
  )
}

function BoardSurface() {
  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const [board, setBoard] = useState<BoardRow | null>(null)
  const [room, setRoom] = useState<RoomRow | null>(null)
  const [session, setSession] = useState<BoardSessionRow | null>(null)
  const [qrBig, setQrBig] = useState(false)
  const [qrCardOpen, setQrCardOpen] = useState(true)
  const [scratch, setScratch] = useState(false) // temporary whiteboard, never saved
  const [clock, setClock] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [docSplitW, setDocSplitW] = useState(0.5)
  const { resolvedTheme, setTheme } = useTheme()
  const pageIdRef = useRef<string | null>(null)
  // The pairing QR must never hide behind a bottom-docked toolbar.
  const qrPillRef = useRef<HTMLDivElement>(null)
  const qrPillShift = useDockClearance(qrPillRef, [session])
  // Remote replay guard: only commands newer than this seq run.
  const remoteSeqRef = useRef(0)
  const remoteSessionRef = useRef<string | null>(null)

  // Interface UI scale matches workspace shell settings
  const uiScale = usePrefs((s) => s.notebook.uiScale)
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale * 100}%`
    return () => {
      document.documentElement.style.fontSize = ''
    }
  }, [uiScale])

  // Global command palette keybindings (⌘K / Ctrl+K)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Board identity. Also sweep any session page a crash left behind.
  useEffect(() => {
    const leftover = useWorkspaceStore
      .getState()
      .notebooks.find((n) => n.name === BOARD_NB)
      ?.sections[0]?.pages[0]?.id
    if (leftover) clearSessionPage(leftover)
    void myBoard().then((res) => {
      if (res) {
        setBoard(res.board)
        setRoom(res.room)
      }
    })
  }, [])

  // Idle-screen notice feed: announcements + notebook shares + assignments
  // addressed to this board's room (or the whole institution).
  const [notices, setNotices] = useState<BoardNotice[]>([])
  useEffect(() => {
    if (!board) return
    const load = () =>
      void (async () => {
        const [ann, shares, assigns] = await Promise.all([
          listBoardAnnouncements(board.room_id),
          listRoomShares(board.room_id),
          listRoomAssignments(board.room_id),
        ])
        const merged: BoardNotice[] = [
          ...ann.map((a) => ({
            id: a.id,
            kind: 'announcement' as const,
            body: a.body,
            author: a.author_name,
            scope: a.room_id === null ? ('institution' as const) : ('room' as const),
            created_at: a.created_at,
          })),
          ...shares.map((s) => ({
            id: s.id,
            kind: 'share' as const,
            title: s.title,
            author: s.sender_name,
            scope: 'room' as const,
            created_at: s.created_at,
          })),
          ...assigns.map((a) => ({
            id: a.id,
            kind: 'assignment' as const,
            title: a.title,
            body: a.description ?? undefined,
            author: a.teacher_name,
            scope: 'room' as const,
            created_at: a.created_at,
            due_at: a.due_at,
          })),
        ].sort((x, y) => y.created_at.localeCompare(x.created_at))
        setNotices(merged)
      })()
    load()
    const t = setInterval(load, 60_000) // cloud poll only runs while subscribed; refresh timestamps too
    const unsubs = [subscribeAnnouncements(load), subscribeShares(load), subscribeAssignments(load)]
    return () => {
      clearInterval(t)
      unsubs.forEach((u) => u())
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
        // New presentation: materialize the temporary copy — content, sheets
        // AND page kind — so docs and PDFs present as themselves.
        const tempId = `board-${live.id}`
        pageIdRef.current = tempId
        registerSessionPage(tempId, live.page_name, (live.edited ?? live.snapshot) as PageBundle)
        return live
      }
      if (!live && prev) {
        // Presentation over: drop the temp copy, rotate the pairing code.
        stop()
        const tempId = pageIdRef.current
        if (tempId) {
          clearSessionPage(tempId)
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
  // merge decision sees the latest state. Edits on a doc land in its SHEETS,
  // and PDF ink lands in per-page annot canvases — so watch every content
  // page the session owns and always send the composed bundle back.
  useEffect(() => {
    if (!session) return
    const tempId = `board-${session.id}`
    let timer: ReturnType<typeof setTimeout> | null = null
    const ownIds = () => {
      const meta = findPageMeta(useWorkspaceStore.getState().notebooks, tempId)
      return new Set([
        tempId,
        ...(meta?.docPages ?? []),
        ...(meta?.notesPages ?? []).filter(Boolean),
        ...(meta?.annotPages ?? []).filter(Boolean),
        ...(meta?.notesDocId ? [meta.notesDocId] : []),
      ])
    }
    const unsub = useDocStore.subscribe((s, prev) => {
      if (s.pages === prev.pages) return
      const ids = ownIds()
      let changed = false
      for (const id of ids) if (s.pages[id] !== prev.pages[id]) changed = true
      if (!changed) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void saveSessionEdits(session.id, bundlePage(tempId)), 1000)
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

  // Session takes over the surface; a scratch whiteboard yields to it.
  const activeBoardPage = session ? `board-${session.id}` : scratch ? 'board-scratch' : null

  // Same targeting rules as the notebook shell: boards act on themselves,
  // docs act on the focused sheet, PDFs draw through the real board dock
  // once their reader has claimed an ink/notes canvas.
  const activeSheetId = useWorkspaceStore((s) => s.activeSheetId)
  const pdfToolsActive = useWorkspaceStore((s) => s.pdfToolsActive)
  const boardKind = useWorkspaceStore((s) =>
    activeBoardPage ? (findPageMeta(s.notebooks, activeBoardPage)?.kind ?? 'board') : 'board'
  )
  const pdfToolsOn = boardKind === 'pdf' && pdfToolsActive
  const boardContentId =
    activeBoardPage && (boardKind === 'doc' || pdfToolsOn)
      ? (activeSheetId ?? activeBoardPage)
      : activeBoardPage

  // Split-screen document: same store as the notebook shell, so a teacher
  // can present a handout side-by-side with the canvas on the board.
  const splitScreenDocumentId = useWorkspaceStore((s) => s.splitScreenDocumentId)
  const syncScroll = useWorkspaceStore((s) => s.syncScroll)
  const calcOpen = useWorkspaceStore((s) => s.calcOpen)
  const togglePanel = useWorkspaceStore((s) => s.togglePanel)

  const activePageObjects = useDocStore((s) =>
    boardContentId ? s.pages[boardContentId]?.objects : null
  )
  const splitScreenObject =
    activeBoardPage && splitScreenDocumentId && activePageObjects
      ? activePageObjects[splitScreenDocumentId] ?? null
      : null

  const objectCount = useDocStore((s) =>
    boardContentId ? Object.keys(s.pages[boardContentId]?.objects ?? {}).length : 0
  )

  // Drive the board's canvas viewport from the PDF's scroll position when
  // sync-scroll is on — mirrors the workspace shell so the two stay aligned.
  useEffect(() => {
    if (!syncScroll || !activeBoardPage) return
    const onPdfScroll = (e: Event) => {
      const { pct } = (e as CustomEvent).detail
      const s = useDocStore.getState()
      const box = s.viewports[activeBoardPage] || { x: 0, y: 0, zoom: 1 }
      const canvasHeight = 10000
      s.setViewport(activeBoardPage, { ...box, y: -pct * canvasHeight * box.zoom })
    }
    window.addEventListener('simblip-pdf-scroll', onPdfScroll)
    return () => window.removeEventListener('simblip-pdf-scroll', onPdfScroll)
  }, [syncScroll, activeBoardPage])

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

  const openScratch = () => {
    useDocStore.setState((s) => ({
      pages: { ...s.pages, 'board-scratch': { objects: {}, variables: [] } },
    }))
    useDocStore.getState().ensurePage('board-scratch')
    useWorkspaceStore.setState({ activePageId: 'board-scratch' })
    setScratch(true)
  }
  const closeScratch = () => {
    stop()
    useDocStore.setState((s) => {
      const pages = { ...s.pages }
      delete pages['board-scratch']
      return { pages }
    })
    useWorkspaceStore.setState({ activePageId: null })
    setScratch(false)
  }

  // When QR card is closed, show QR button in the bottom of the sidebar rail
  const sidebarQrButton =
    pairUrl && !qrCardOpen ? (
      <fm.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.5 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      >
        <RailButton
          label="Show pairing QR"
          tooltipSide="right"
          active={false}
          onClick={() => setQrCardOpen(true)}
        >
          <QrCodeIcon className="h-[18px] w-[18px]" />
        </RailButton>
      </fm.div>
    ) : null

  return (
    <div className="relative h-dvh overflow-hidden bg-background">
      {activeBoardPage ? (
        <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
          <header className="z-40 flex h-12 shrink-0 items-center gap-2 px-4 border-b border-border/40">
            {institution?.logo_url ? (
              <Image
                src={String(institution.logo_url)}
                alt={institution.name}
                width={20}
                height={20}
                unoptimized
                className="h-5 w-5 rounded object-contain"
              />
            ) : null}
            <span className="text-[14px] font-extrabold tracking-tight">
              SIM<span className="text-[var(--accent-blue)]">BLIP</span>
            </span>
            {institution && (
              <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
                · {institution.name}
              </span>
            )}
            <span className="hidden text-muted-foreground/50 sm:inline">/</span>

            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <span className="glass truncate rounded-lg px-2.5 py-1 text-[12px] font-medium text-foreground">
                {session
                  ? `${session.page_name} · presented by ${room?.name ?? 'room'}`
                  : 'Temporary whiteboard — nothing is saved'}
              </span>
              {session ? (
                <button
                  type="button"
                  aria-label="End presentation"
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/20"
                  onClick={() => void endSession(session.id)}
                >
                  <Square className="h-3.5 w-3.5" />
                  <span>End presentation</span>
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Close whiteboard"
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={closeScratch}
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Close whiteboard</span>
                </button>
              )}
            </div>

            <div className="relative z-10 flex shrink-0 items-center gap-2 bg-background pl-2 shadow-[-12px_0_16px_-4px_rgba(0,0,0,0.12)] dark:shadow-[-12px_0_16px_-4px_rgba(0,0,0,0.5)] [clip-path:inset(0_0_0_-20px)]">
              <button
                type="button"
                aria-label="Search (Ctrl+K)"
                className="hidden items-center gap-2 rounded-lg border border-border/60 px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
                onClick={() => setCommandOpen(true)}
              >
                <Search className="h-3.5 w-3.5" />
                Search
                <Kbd className="text-[10px]">⌘K</Kbd>
              </button>
              <button
                type="button"
                aria-label="Search"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
                onClick={() => setCommandOpen(true)}
              >
                <Search className="h-4 w-4" />
              </button>

              {boardContentId && <UndoRedo pageId={boardContentId} />}
              <SyncStatus />
              <NotificationCenter />
              <button
                type="button"
                aria-label="Tutorials"
                className={cn(
                  'rounded-lg p-1.5 transition-colors hover:bg-accent',
                  tutorialOpen ? 'text-foreground' : 'text-muted-foreground'
                )}
                onClick={() => setTutorialOpen((o) => !o)}
              >
                <GraduationCap className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Toggle theme"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setTheme(isDarkTheme(resolvedTheme) ? 'light' : 'dark')}
              >
                {isDarkTheme(resolvedTheme) ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1">
            <Dock
              side="left"
              panels={['pages']}
              render={() => <Sidebar hideNotebook bottomRailContent={sidebarQrButton} />}
            />

            {splitScreenObject && (
              <>
                <div
                  className="flex min-w-0 flex-col bg-muted/30 p-2"
                  style={{ width: `${docSplitW * 100}%` }}
                >
                  <FileObject object={splitScreenObject} pageId={boardContentId!} />
                </div>
                <div
                  role="separator"
                  aria-label="Resize document pane"
                  className="w-1.5 shrink-0 cursor-col-resize bg-border/50 transition-colors hover:bg-[var(--accent-blue)]/50"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    const host = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                    const move = (ev: PointerEvent) =>
                      setDocSplitW(Math.min(0.75, Math.max(0.25, (ev.clientX - host.left) / host.width)))
                    const up = () => {
                      window.removeEventListener('pointermove', move)
                      window.removeEventListener('pointerup', up)
                    }
                    window.addEventListener('pointermove', move)
                    window.addEventListener('pointerup', up)
                  }}
                />
              </>
            )}

            <main className="relative min-w-0 flex-1">
              <PageView key={activeBoardPage} pageId={activeBoardPage} />
              {(boardKind !== 'pdf' || pdfToolsOn) && boardContentId && (
                <CanvasControls pageId={boardContentId} showTransport={true} />
              )}
              {calcOpen && <Calculator onClose={() => togglePanel('calc')} />}
            </main>
          </div>

          <footer className="z-40 flex h-6 shrink-0 items-center gap-3 border-t border-border/40 px-4 text-[10.5px] text-muted-foreground">
            {profile && (
              <span className="font-medium">
                {profile.full_name} · {ROLE_LABEL[profile.role]}
              </span>
            )}
            {institution && <span className="hidden sm:inline">{institution.name}</span>}
            <div className="flex-1" />
            {boardContentId && <span>{objectCount} objects</span>}
            <span>SIMBLIP · Built by Rohan Singh</span>
          </footer>

          <CommandPalette
            open={commandOpen}
            onOpenChange={setCommandOpen}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
          {tutorialOpen && <TutorialPanel pageId={activeBoardPage} onClose={() => setTutorialOpen(false)} />}
        </div>
      ) : (
        <div className="flex h-full flex-col">
          {/* Same top header as the active whiteboard view */}
          <header className="z-40 flex h-12 shrink-0 items-center gap-2 bg-background px-4">
            {institution?.logo_url ? (
              <Image
                src={String(institution.logo_url)}
                alt={institution.name}
                width={20}
                height={20}
                unoptimized
                className="h-5 w-5 rounded object-contain"
              />
            ) : null}
            <span className="text-[14px] font-extrabold tracking-tight">
              SIM<span className="text-[var(--accent-blue)]">BLIP</span>
            </span>
            {institution && (
              <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
                · {institution.name}
              </span>
            )}
            <div className="flex-1" />
            <div className="relative z-10 flex shrink-0 items-center gap-2 bg-background">
              <button
                type="button"
                aria-label="Toggle theme"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setTheme(isDarkTheme(resolvedTheme) ? 'light' : 'dark')}
              >
                {isDarkTheme(resolvedTheme) ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </header>

          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
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
            <NoticeStack items={notices} />
          </div>

          <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
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

      {/* Floating QR button on idle screen when popup is closed */}
      {pairUrl && !qrCardOpen && !activeBoardPage && (
        <AnimatePresence>
          <fm.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute bottom-4 left-4 z-50"
          >
            <button
              type="button"
              aria-label="Show pairing QR"
              onClick={() => setQrCardOpen(true)}
              className="glass-strong flex h-10 w-10 items-center justify-center rounded-2xl text-muted-foreground shadow-lg transition-colors hover:bg-accent hover:text-foreground"
            >
              <QrCodeIcon className="h-5 w-5" />
            </button>
          </fm.div>
        </AnimatePresence>
      )}

      {/* The pairing QR pill popup with close button and shrinking animation */}
      <AnimatePresence>
        {pairUrl && qrCardOpen && (
          <fm.div
            key="qr-card-popup"
            ref={qrPillRef}
            style={{ translate: `${qrPillShift.x}px ${qrPillShift.y}px` }}
            initial={{ opacity: 0, scale: 0.2, x: -40, y: 30 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, scale: 0.1, x: -50, y: 40 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="glass-strong absolute bottom-4 left-4 z-50 flex items-start gap-3 rounded-2xl p-3 shadow-xl transition-[translate] duration-200"
          >
            <button
              type="button"
              aria-label="Enlarge QR to full screen"
              className="cursor-zoom-in shrink-0"
              onClick={() => setQrBig(true)}
            >
              <QrCode value={pairUrl} size={session ? 72 : 128} className="rounded-lg" />
            </button>
            <div className="pr-1 text-left min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  Pair to present
                </p>
                <button
                  type="button"
                  aria-label="Close QR popup"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setQrCardOpen(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="font-mono text-[15px] font-bold tracking-[0.2em]">{board.pairing_code}</p>
              {!session && (
                <p className="mt-0.5 max-w-40 text-[10.5px] leading-snug text-muted-foreground">
                  Scan with your phone, pick a page, press Present.
                </p>
              )}
            </div>
          </fm.div>
        )}
      </AnimatePresence>
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
