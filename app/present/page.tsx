'use client'

// The presenter controller (teacher's phone). Reached by scanning a room
// board's QR (?board=…&code=…) or right after "Present on room board"
// (?session=…). Drives the whole lifecycle: pick a page → Present → live →
// End → merge the board's temporary copy back or discard it.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, Loader2, MonitorPlay, Square } from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { useWorkspaceStore } from '@/lib/store/workspace'
import { useDocStore } from '@/lib/store/document'
import {
  endSession,
  getSession,
  resolvePairing,
  resolveSession,
  startSession,
  subscribeBoardSessions,
} from '@/lib/data/boards'
import type { BoardRow, BoardSessionRow, RoomRow } from '@/lib/data/types'
import { importPageDoc } from '@/lib/store/import-page'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'

type Phase = 'resolving' | 'invalid' | 'pick' | 'live' | 'decide' | 'done'

function PresentController() {
  const params = useSearchParams()
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('resolving')
  const [board, setBoard] = useState<BoardRow | null>(null)
  const [room, setRoom] = useState<RoomRow | null>(null)
  const [session, setSession] = useState<BoardSessionRow | null>(null)
  const [busy, setBusy] = useState(false)

  const notebooks = useWorkspaceStore((s) => s.notebooks)
  const [nbId, setNbId] = useState('')
  const [secId, setSecId] = useState('')
  const [pageId, setPageId] = useState('')

  const notebook = useMemo(() => notebooks.find((n) => n.id === nbId), [notebooks, nbId])
  const section = useMemo(() => notebook?.sections.find((s) => s.id === secId), [notebook, secId])

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
        setPhase('pick')
        return
      }
      setPhase('invalid')
    })()
    // params are read once on mount by design
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // While live, follow the session (the board may end it from its side).
  const followSession = useCallback(async () => {
    if (!session) return
    const fresh = await getSession(session.id)
    if (!fresh) return
    setSession(fresh)
    if (fresh.status === 'ended') setPhase('decide')
    if (fresh.status === 'merged' || fresh.status === 'discarded') setPhase('done')
  }, [session])

  useEffect(() => {
    if (phase !== 'live' && phase !== 'decide') return
    return subscribeBoardSessions(() => void followSession())
  }, [phase, followSession])

  const present = async () => {
    if (!board || !pageId) return
    const page = section?.pages.find((p) => p.id === pageId)
    if (!page) return
    setBusy(true)
    try {
      const content = useDocStore.getState().pages[pageId] ?? { objects: {}, variables: [] }
      const s = await startSession({ boardId: board.id, pageId, pageName: page.name, snapshot: content })
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
        const edited = fresh.edited ?? fresh.snapshot
        const existsLocally = Boolean(useDocStore.getState().pages[fresh.page_id])
        if (existsLocally) {
          useDocStore.setState((s) => ({
            pages: { ...s.pages, [fresh.page_id]: JSON.parse(JSON.stringify(edited)) },
            scopes: { ...s.scopes, [fresh.page_id]: undefined as never },
          }))
          useDocStore.getState().ensurePage(fresh.page_id)
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
            <Label className="text-[12px]">Notebook</Label>
            <Select value={nbId} onValueChange={(v) => { setNbId(v); setSecId(''); setPageId('') }}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Notebook…" /></SelectTrigger>
              <SelectContent>
                {notebooks.map((n) => (
                  <SelectItem key={n.id} value={n.id}>{n.emoji} {n.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {notebook && (
            <div className="space-y-1.5">
              <Label className="text-[12px]">Section</Label>
              <Select value={secId} onValueChange={(v) => { setSecId(v); setPageId('') }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Section…" /></SelectTrigger>
                <SelectContent>
                  {notebook.sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {section && (
            <div className="space-y-1.5">
              <Label className="text-[12px]">Page</Label>
              <Select value={pageId} onValueChange={setPageId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Page…" /></SelectTrigger>
                <SelectContent>
                  {section.pages.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
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
        </div>
      )}

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

export default function PresentPage() {
  return (
    <RequireAuth allow={['admin', 'teacher', 'super_admin']}>
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
