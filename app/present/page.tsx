'use client'

// The presenter controller (teacher's phone or desktop). Reached by scanning
// a room board's QR (?board=…&code=…) or right after "Present on room board"
// (?session=…). Drives the whole lifecycle: pick a page → Present → live →
// End → merge the board's temporary copy back or discard it.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MonitorPlay,
  Pause,
  Play,
  RotateCcw,
  Square,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { useWorkspaceStore, childrenOf, descendantsOf } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import {
  endSession,
  getSession,
  liveSessionFor,
  resolvePairing,
  resolveSession,
  sendRemote,
  startSession,
  subscribeBoardSessions,
} from '@/lib/data/boards'
import { followSession } from '@/lib/data/board-follow'
import { useAuthStore } from '@/lib/auth/store'
import { dbMode } from '@/lib/data/db'
import { useBoardLive } from '@/lib/data/board-live-client'
import { useSendCursor, usePeerCursor } from '@/lib/data/board-live-cursor'
import { PeerCursorOverlay } from '@/components/workspace/peer-cursor'
import { registerSessionPage, clearSessionPage } from '@/lib/data/board-session-page'
import { applyObjectPatch, diffObjects } from '@/lib/scene/diff'
import { PageView } from '@/components/workspace/page-view'
import type { BoardLiveServerMsg } from '@/lib/data/board-live-types'
import type { BoardRow, BoardSessionRow, RoomRow } from '@/lib/data/types'
import { importPageDoc } from '@/lib/store/import-page'
import {
  flattenBundleObjects,
  writeBundleContent,
  bundleMetaPatch,
  type PageBundle,
} from '@/lib/store/page-bundle'
import type { SceneObject } from '@/lib/scene/types'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'

type Phase =
  | 'resolving'
  | 'invalid'
  | 'pick'
  | 'live'
  | 'decide'
  | 'done'
  // student class-follow phases
  | 'classIdle'
  | 'classLive'
  | 'classEnded'

function PresentController() {
  const params = useSearchParams()
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('resolving')
  const [board, setBoard] = useState<BoardRow | null>(null)
  const [room, setRoom] = useState<RoomRow | null>(null)
  const [session, setSession] = useState<BoardSessionRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [followPageId, setFollowPageId] = useState<string | null>(null)
  const [desktopLive, setDesktopLive] = useState(false)

  const nodes = useWorkspaceStore((s) => s.nodes)
  const [pageId, setPageId] = useState('')

  // Every page in the tree, labeled with its full folder breadcrumb — a
  // single searchable list instead of a fixed notebook/section cascade,
  // since folders now nest to arbitrary depth (no fixed number of pickers
  // to render). Same "flatten to breadcrumb-labeled leaves" approach
  // command-palette.tsx uses for its own page search.
  const pickablePages = useMemo(
    () =>
      childrenOf(nodes, null).flatMap((nb) =>
        descendantsOf(nodes, nb.id)
          .filter((n) => n.kind === 'page')
          .map((p) => {
            const trail: string[] = []
            for (let cur = nodes[p.parentId ?? '']; cur; cur = nodes[cur.parentId ?? '']) trail.unshift(cur.name)
            return { id: p.id, name: p.name, path: trail.join(' / ') }
          })
      ),
    [nodes]
  )
  const chosenPage = useMemo(() => pickablePages.find((p) => p.id === pageId), [pickablePages, pageId])

  // Entry: either a pairing scan or an existing session.
  useEffect(() => {
    const sessionId = params.get('session')
    const boardId = params.get('board')
    const code = params.get('code')
    void (async () => {
      if (sessionId) {
        const s = await getSession(sessionId)
        if (!s) return setPhase('invalid')
        setSession(s)
        setPhase(s.status === 'live' ? 'live' : s.status === 'ended' ? 'decide' : 'done')
        return
      }
      if (boardId && code) {
        const resolved = await resolvePairing(boardId, code)
        if (!resolved) return setPhase('invalid')
        setBoard(resolved.board)
        setRoom(resolved.room)
        // Free board: anyone who can resolve the pairing may present, not
        // just a pre-designated teacher — first to press Present wins.
        // Board already live: everyone else (any role) joins as a viewer —
        // their own mirrored copy, until the presenter ends it. The
        // presenting teacher rejoining their own session (e.g. tab reload)
        // still lands in 'live' via the sessionId-in-URL flow above.
        const live = await liveSessionFor(resolved.board.id)
        if (live) {
          setSession(live)
          setFollowPageId(followSession(live))
          setPhase('classLive')
          return
        }
        setPhase('pick')
        return
      }
      setPhase('invalid')
    })()
    // params are read once on mount by design
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // While live, follow the session (the board may end it from its side).
  const followSessionState = useCallback(async () => {
    if (!session) return
    const fresh = await getSession(session.id)
    if (!fresh) return
    setSession(fresh)
    if (fresh.status === 'ended') setPhase('decide')
    if (fresh.status === 'merged' || fresh.status === 'discarded') setPhase('done')
  }, [session])

  useEffect(() => {
    if (phase !== 'live' && phase !== 'decide') return
    return subscribeBoardSessions(() => void followSessionState())
  }, [phase, followSessionState])

  // Student: watch for the class ending (the mirror itself runs globally).
  useEffect(() => {
    if (phase !== 'classLive' || !session) return
    return subscribeBoardSessions(() => {
      void getSession(session.id).then((fresh) => {
        if (fresh && fresh.status !== 'live') setPhase('classEnded')
      })
    })
  }, [phase, session])

  const present = async () => {
    if (!board || !pageId) return
    const page = chosenPage
    if (!page) return
    setBusy(true)
    try {
      const { bundlePage } = await import('@/lib/store/page-bundle')
      const s = await startSession({ boardId: board.id, pageId, pageName: page.name, snapshot: bundlePage(pageId) })
      setSession(s)
      setPhase('live')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the presentation')
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!session) return
    setBusy(true)
    await endSession(session.id)
    setSession({ ...session, status: 'ended' })
    setPhase('decide')
    setBusy(false)
  }

  const decide = async (decision: 'merged' | 'discarded') => {
    if (!session) return
    setBusy(true)
    try {
      if (decision === 'merged') {
        const fresh = (await getSession(session.id)) ?? session
        const edited = (fresh.edited ?? fresh.snapshot) as PageBundle
        const existsLocally = Boolean(useDocStore.getState().pages[fresh.page_id])
        if (existsLocally) {
          // Sessions keep the original sheet ids, so a doc/PDF merge writes
          // every sheet and ink layer straight back in place; sheets added
          // on the board arrive through the meta patch.
          if (edited.bundle)
            useWorkspaceStore.getState().updatePageMeta(fresh.page_id, bundleMetaPatch(edited.bundle))
          writeBundleContent(fresh.page_id, edited)
          toast.success(`Board changes merged into “${fresh.page_name}”`)
        } else {
          importPageDoc({
            notebookName: 'Presentations',
            notebookEmoji: '🖥️',
            sectionName: room?.name ?? 'Boards',
            pageName: `${fresh.page_name} (presented)`,
            content: edited,
          })
          toast.success('Board changes saved as a new page (original not on this device).')
        }
      }
      await resolveSession(session.id, decision)
      // Shared presentation documents are ephemeral — clean them up now
      // (a 3-hour server sweep catches anything this misses).
      const { cleanupSessionFiles } = await import('@/lib/data/session-upload')
      void cleanupSessionFiles(session.id, session.snapshot)
      setPhase('done')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 pt-8">
      {phase === 'resolving' && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Connecting to the board…
        </div>
      )}

      {phase === 'invalid' && (
        <div className="glass rounded-2xl p-5 text-center">
          <p className="text-[14px] font-semibold">This pairing code is no longer valid</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Codes rotate after each presentation. Scan the QR currently shown on the board.
          </p>
        </div>
      )}

      {phase === 'pick' && (
        <div className="glass space-y-4 rounded-2xl p-5">
          <div>
            <p className="flex items-center gap-2 text-[15px] font-bold">
              <MonitorPlay className="h-4 w-4 text-[var(--accent-blue)]" />
              {room?.name ?? 'Room board'}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Paired. Choose what to present — the board gets a temporary copy.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Page</Label>
            <Command className="rounded-lg border border-input">
              <CommandInput placeholder="Search pages…" />
              <CommandList className="max-h-52">
                <CommandEmpty>No pages found.</CommandEmpty>
                {pickablePages.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.name} ${p.path}`}
                    onSelect={() => setPageId(p.id)}
                    className={cn(pageId === p.id && 'bg-accent')}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto truncate text-[11px] text-muted-foreground">{p.path}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </div>
          <Button className="w-full" disabled={!pageId || busy} onClick={() => void present()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Present'}
          </Button>
        </div>
      )}

      {phase === 'live' && session && (
        <div className="glass space-y-4 rounded-2xl p-5 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_oklch,var(--accent-mint)_15%,transparent)] px-3 py-1 text-[12px] font-semibold text-[var(--accent-mint)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-mint)]" /> Live on the board
          </span>
          <p className="text-[16px] font-bold">{session.page_name}</p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            The board is working on a temporary copy. Your notebook stays untouched until you decide
            otherwise.
          </p>
          <Button variant="outline" className="w-full" disabled={busy} onClick={() => void finish()}>
            <Square className="h-4 w-4" /> End presentation
          </Button>
          <Button
            variant={desktopLive ? 'default' : 'outline'}
            className="w-full"
            onClick={() => setDesktopLive((v) => !v)}
          >
            <MonitorPlay className="h-4 w-4" />
            {desktopLive ? 'Driving from this screen' : 'Drive from this screen'}
          </Button>
        </div>
      )}

      {phase === 'live' && session && desktopLive && <DesktopLivePanel session={session} />}

      {phase === 'live' && session && !desktopLive && <RemotePanel session={session} />}

      {phase === 'decide' && session && (
        <div className="glass space-y-4 rounded-2xl p-5 text-center">
          <p className="text-[15px] font-bold">Presentation ended</p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Keep the annotations and changes made on the board, or discard the temporary copy and
            leave “{session.page_name}” exactly as it was?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void decide('discarded')}>
              Discard changes
            </Button>
            <Button disabled={busy} onClick={() => void decide('merged')}>
              Merge into notebook
            </Button>
          </div>
        </div>
      )}

      {phase === 'classIdle' && (
        <div className="glass rounded-2xl p-5 text-center">
          <MonitorPlay className="mx-auto h-6 w-6 text-muted-foreground/60" />
          <p className="mt-2 text-[14px] font-semibold">{room?.name ?? 'This board'} is idle</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Nothing is being presented right now. Scan again once someone starts presenting — you'll
            get your own live copy of the whiteboard.
          </p>
        </div>
      )}

      {phase === 'classLive' && session && (
        <div className="glass space-y-4 rounded-2xl p-5 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-[color-mix(in_oklch,var(--accent-mint)_15%,transparent)] px-3 py-1 text-[12px] font-semibold text-[var(--accent-mint)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-mint)]" /> Following the presentation
          </span>
          <p className="text-[16px] font-bold">{session.page_name}</p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            A live copy is now in your notebook under{' '}
            <span className="font-medium text-foreground">Shared with me → Whiteboard</span>. It
            mirrors everything the presenter writes until it ends, then saves itself with the date
            and time.
          </p>
          <Button
            className="w-full"
            onClick={() => {
              if (followPageId) useWorkspaceStore.getState().setActivePage(followPageId)
              router.push('/notebook')
            }}
          >
            Open my live copy
          </Button>
        </div>
      )}

      {phase === 'classEnded' && (
        <div className="glass space-y-3 rounded-2xl p-5 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-[var(--accent-mint)]" />
          <p className="text-[14px] font-semibold">Class ended — your copy is saved</p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Find it in Shared with me → Whiteboard, stamped with today's date and time. It's yours
            to annotate and extend.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              if (followPageId) useWorkspaceStore.getState().setActivePage(followPageId)
              router.push('/notebook')
            }}
          >
            Open it in my notebook
          </Button>
        </div>
      )}

      {phase === 'done' && (
        <div className="glass space-y-3 rounded-2xl p-5 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-[var(--accent-mint)]" />
          <p className="text-[14px] font-semibold">All set</p>
          <Button variant="outline" className="w-full" onClick={() => router.push('/notebook')}>
            Back to notebook
          </Button>
        </div>
      )}
    </div>
  )
}

// Desktop-live: the teacher's own screen shows the actual live page (same
// PageView the board renders) instead of the phone-style button panel —
// fully editable, with edits flowing both ways over the same obj-patch/
// bundle sync the board already uses, plus a live cursor overlay so each
// side sees where the other is pointing. Connects as role:'desktop', a
// second WS connection on the same session alongside the board's own.
function DesktopLivePanel({ session }: { session: BoardSessionRow }) {
  const tempId = `board-${session.id}`
  const registeredRef = useRef(false)
  const [lastCursorEvt, setLastCursorEvt] = useState<BoardLiveServerMsg | null>(null)

  useEffect(() => {
    registerSessionPage(tempId, session.page_name, (session.edited ?? session.snapshot) as PageBundle)
    registeredRef.current = true
    return () => {
      clearSessionPage(tempId)
      registeredRef.current = false
    }
    // Materialize once per session id — the session's own live updates flow
    // in over the WS below, not by re-registering on every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  const handleLiveEvent = useCallback(
    (evt: BoardLiveServerMsg) => {
      switch (evt.type) {
        case 'obj-patch':
          applyObjectPatch(tempId, evt.objectId, evt.obj)
          break
        case 'bundle':
          if (evt.origin !== 'desktop') writeBundleContent(tempId, evt.bundle)
          break
        case 'cursor':
          if (evt.origin !== 'desktop') setLastCursorEvt(evt)
          break
      }
    },
    [tempId]
  )

  const wsHandle = useBoardLive(
    dbMode === 'cloud' ? session.id : null,
    handleLiveEvent,
    () => {
      // Resync: re-pull the session and re-materialize its latest content.
      void getSession(session.id).then((fresh) => {
        if (fresh) registerSessionPage(tempId, fresh.page_name, (fresh.edited ?? fresh.snapshot) as PageBundle)
      })
    },
    'desktop'
  )

  const sendCursor = useSendCursor(wsHandle, tempId)
  const peerCursor = usePeerCursor(lastCursorEvt)

  // Mirror local edits back out — same per-object patch pattern app/board
  // uses, just the other direction.
  useEffect(() => {
    if (!wsHandle?.connected) return
    return useDocStore.subscribe((s, prev) => {
      if (s.pages[tempId] === prev.pages[tempId]) return
      const { changed, removed } = diffObjects(prev.pages[tempId]?.objects ?? {}, s.pages[tempId]?.objects ?? {})
      for (const obj of Object.values(changed)) wsHandle.sendPatch(obj.id, obj)
      for (const id of removed) wsHandle.sendPatch(id, null)
    })
  }, [tempId, wsHandle, wsHandle?.connected])

  return (
    <div
      className="glass relative h-[70vh] w-full overflow-hidden rounded-2xl"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        sendCursor((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
      }}
    >
      <PeerCursorOverlay cursor={peerCursor} anchor="absolute" />
      <PageView key={tempId} pageId={tempId} />
    </div>
  )
}

// Phone remote for the live board: drive the simulation transport, page any
// presented document, and nudge object properties — all without leaving the
// lectern... or while walking the aisles. Commands ride the session row; the
// object list mirrors the board's own working copy as it syncs back.
function RemotePanel({ session }: { session: BoardSessionRow }) {
  const [objId, setObjId] = useState('')
  // Optimistic mirror of toggle states — the session row only syncs back
  // every few seconds, and a button that answers late feels broken.
  const [flips, setFlips] = useState<Record<string, boolean>>({})
  const doc = (session.edited ?? session.snapshot) as PageBundle | null
  const isPresentation = doc?.bundle?.kind === 'pptx'
  // Docs/PDFs keep their objects on sheets — flatten so the remote sees them.
  const objects = Object.values(doc ? flattenBundleObjects(doc) : {}) as SceneObject[]
  const files = objects.filter((o) => o.metadata?.render === 'file')
  const chosen = objects.find((o) => o.id === objId) ?? null
  // The teacher's phone only needs to SEND remote commands here — incoming
  // session content already refreshes through this component's own poll.
  const wsHandle = useBoardLive(dbMode === 'cloud' ? session.id : null, () => {}, () => {})
  const send = (cmd: Parameters<typeof sendRemote>[1]) =>
    wsHandle?.connected ? wsHandle.sendRemote(cmd) : void sendRemote(session.id, cmd)

  // The same components a tap toggles on the board itself: switches and
  // logic inputs. They get real buttons here — not a number field.
  const toggables = objects
    .map((o) => {
      const sym = o.geometry.kind === 'symbol' ? o.geometry.symbol : undefined
      const param = sym === 'switch' ? 'closed' : sym === 'input' ? 'value' : undefined
      if (!param) return null
      const p = o.parameters[param]
      const docOn = (p?.kind === 'number' ? p.value : param === 'closed' ? 1 : 0) >= 0.5
      const key = `${o.id}:${param}`
      return {
        id: o.id,
        param,
        key,
        label: o.name || (param === 'closed' ? 'Switch' : 'Input'),
        on: key in flips ? flips[key] : docOn,
      }
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)

  // Once the synced doc agrees with an optimistic flip, the doc becomes the
  // source of truth again (also picks up taps made on the board itself).
  useEffect(() => {
    setFlips((f) => {
      let changed = false
      const next = { ...f }
      for (const t of toggables) {
        const p = objects.find((o) => o.id === t.id)?.parameters[t.param]
        const docOn = (p?.kind === 'number' ? p.value : t.param === 'closed' ? 1 : 0) >= 0.5
        if (t.key in next && next[t.key] === docOn) {
          delete next[t.key]
          changed = true
        }
      }
      return changed ? next : f
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  return (
    <div className="glass space-y-4 rounded-2xl p-5">
      <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Board remote
      </p>

      <div className="space-y-1.5">
        <Label className="text-[12px]">Simulation</Label>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" onClick={() => send({ kind: 'play' })}>
            <Play className="h-4 w-4" /> Play
          </Button>
          <Button variant="outline" size="sm" onClick={() => send({ kind: 'pause' })}>
            <Pause className="h-4 w-4" /> Pause
          </Button>
          <Button variant="outline" size="sm" onClick={() => send({ kind: 'stop' })}>
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
        </div>
      </div>

      {toggables.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[12px]">Controls</Label>
          <div className="grid grid-cols-2 gap-2">
            {toggables.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={t.on}
                onClick={() => {
                  setFlips((f) => ({ ...f, [t.key]: !t.on }))
                  send({ kind: 'toggle', objectId: t.id, param: t.param })
                }}
                className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-[12.5px] font-semibold transition-colors ${
                  t.on
                    ? 'border-[var(--accent-mint)] bg-[color-mix(in_oklch,var(--accent-mint)_14%,transparent)] text-foreground'
                    : 'border-border/70 bg-background text-muted-foreground'
                }`}
              >
                <span className="min-w-0 truncate">{t.label}</span>
                {t.on ? (
                  <ToggleRight className="h-5 w-5 shrink-0 text-[var(--accent-mint)]" />
                ) : (
                  <ToggleLeft className="h-5 w-5 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {isPresentation && (
        <div className="space-y-1.5">
          <Label className="text-[12px]">Slides — {session.page_name}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" onClick={() => send({ kind: 'pptx', dir: -1 })}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => send({ kind: 'pptx', dir: 1 })}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[12px]">Slides — {files[0].name || 'Document'}</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => send({ kind: 'pdf', dir: -1, objectId: files[0].id })}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => send({ kind: 'pdf', dir: 1, objectId: files[0].id })}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {objects.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-[12px]">Object properties</Label>
          <Select
            value={objId}
            onValueChange={(v) => {
              setObjId(v)
              send({ kind: 'select', objectId: v })
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick an object to control…" />
            </SelectTrigger>
            <SelectContent>
              {objects.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name || o.id.slice(0, 6)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {chosen &&
            chosen.behaviors.map((b) => {
              const numeric = Object.entries(b.params).filter(([, p]) => p.kind === 'number')
              if (numeric.length === 0) return null
              return (
                <div key={b.id} className="space-y-1 rounded-xl border border-border/60 p-2.5">
                  <p className="text-[11px] font-semibold capitalize text-muted-foreground">{b.type}</p>
                  {numeric.map(([name, p]) => (
                    <div key={`${b.id}:${name}`} className="flex items-center gap-2">
                      <span className="w-24 truncate text-[11.5px] text-muted-foreground">{name}</span>
                      <input
                        defaultValue={p.kind === 'number' ? p.expr : ''}
                        className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[12px] outline-none focus:border-[var(--ring)]"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v && (p.kind !== 'number' || v !== p.expr))
                            send({ kind: 'param', objectId: chosen.id, behaviorId: b.id, param: name, value: v })
                        }}
                      />
                    </div>
                  ))}
                </div>
              )
            })}
          {chosen && chosen.behaviors.every((b) => Object.values(b.params).every((p) => p.kind !== 'number')) && (
            <p className="text-[11.5px] text-muted-foreground">This object has no tunable numbers.</p>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Commands reach the board instantly in local mode and within about a second in cloud mode.
      </p>
    </div>
  )
}

export default function PresentPage() {
  return (
    <RequireAuth allow={['admin', 'teacher', 'student', 'super_admin']}>
      <PageShell title="Present">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          }
        >
          <PresentController />
        </Suspense>
      </PageShell>
    </RequireAuth>
  )
}
