'use client'

// Page-level enterprise actions: share a copy (to a room or a person),
// create an assignment from a page, and present a page on a room board.
// All three ship frozen copies — the original page is never exposed.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MonitorPlay } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth/store'
import { useDocStore } from '@/lib/store/document'
import { sharePage } from '@/lib/data/shares'
import { createAssignment } from '@/lib/data/assignments'
import { startSession } from '@/lib/data/boards'
import { listRooms, listBoards } from '@/lib/data/admin'
import * as db from '@/lib/data/db'
import type { BoardRow, ProfileRow, RoomRow } from '@/lib/data/types'
import type { PageDoc } from '@/lib/scene/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface PageRef {
  id: string
  name: string
}

const pageContent = (pageId: string): PageDoc =>
  useDocStore.getState().pages[pageId] ?? { objects: {}, variables: [] }

/** Download a page (name + content) as a portable JSON file. */
export function exportPageJson(page: PageRef) {
  const blob = new Blob(
    [JSON.stringify({ simblip: 2, name: page.name, content: pageContent(page.id) }, null, 2)],
    { type: 'application/json' }
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${page.name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'page'}.simblip.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Share ───────────────────────────────────────────────────────────────────

export function ShareDialog({
  page,
  onOpenChange,
}: {
  page: PageRef | null
  onOpenChange: (open: boolean) => void
}) {
  const profile = useAuthStore((s) => s.profile)
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [people, setPeople] = useState<ProfileRow[]>([])
  const [target, setTarget] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!page || !profile) return
    void listRooms().then(setRooms).catch(() => {})
    // Teachers can share to anyone in the institution.
    void db
      .list<ProfileRow>('profiles', { institution_id: profile.institution_id })
      .then((rows) => setPeople(rows.filter((p) => p.role !== 'board' && p.id !== profile.id && p.active)))
      .catch(() => {})
  }, [page, profile])

  const share = async () => {
    if (!page || !target) return
    setBusy(true)
    try {
      const [kind, id] = target.split(':', 2)
      await sharePage(page.name, pageContent(page.id), kind === 'room' ? { roomId: id } : { profileId: id })
      const label =
        kind === 'room' ? rooms.find((r) => r.id === id)?.name : people.find((p) => p.id === id)?.full_name
      toast.success(`Copy of “${page.name}” shared to ${label ?? 'recipient'}`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Share failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={page !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share “{page?.name}”</DialogTitle>
          <DialogDescription>
            Recipients get their own copy to reorganize and extend — your original stays untouched.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-[12px]">Send a copy to</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a room or a person…" />
            </SelectTrigger>
            <SelectContent>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={`room:${r.id}`}>
                  🏫 {r.name} (everyone enrolled)
                </SelectItem>
              ))}
              {people.map((p) => (
                <SelectItem key={p.id} value={`person:${p.id}`}>
                  👤 {p.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void share()} disabled={busy || !target}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Share copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Assign ──────────────────────────────────────────────────────────────────

export function AssignDialog({
  page,
  onOpenChange,
}: {
  page: PageRef | null
  onOpenChange: (open: boolean) => void
}) {
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [roomIds, setRoomIds] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!page) return
    setTitle(page.name)
    void listRooms().then(setRooms).catch(() => {})
  }, [page])

  const assign = async () => {
    if (!page || roomIds.size === 0 || !title.trim()) return
    setBusy(true)
    try {
      await createAssignment({
        title: title.trim(),
        instructions: instructions.trim() || undefined,
        content: pageContent(page.id),
        roomIds: [...roomIds],
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      })
      toast.success(`Assignment “${title.trim()}” published to ${roomIds.size} room${roomIds.size === 1 ? '' : 's'}`)
      onOpenChange(false)
      setInstructions('')
      setDueAt('')
      setRoomIds(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create assignment')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={page !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign “{page?.name}”</DialogTitle>
          <DialogDescription>
            Each student gets their own working copy of this page and submits from their notebook.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[12px]">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Instructions</Label>
            <Textarea
              rows={3}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="What should students do and hand in?"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Due date</Label>
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px]">Rooms</Label>
            <div className="space-y-1.5">
              {rooms.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <Checkbox
                    checked={roomIds.has(r.id)}
                    onCheckedChange={(v) =>
                      setRoomIds((prev) => {
                        const next = new Set(prev)
                        if (v) next.add(r.id)
                        else next.delete(r.id)
                        return next
                      })
                    }
                  />
                  {r.name}
                </label>
              ))}
              {rooms.length === 0 && (
                <p className="text-[12px] text-muted-foreground">No rooms yet — ask your admin to create one.</p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void assign()} disabled={busy || roomIds.size === 0 || !title.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Present on a room board ─────────────────────────────────────────────────

export function PresentDialog({
  page,
  onOpenChange,
}: {
  page: PageRef | null
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [boards, setBoards] = useState<Array<BoardRow & { roomName: string }>>([])
  const [boardId, setBoardId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!page) return
    void Promise.all([listBoards(), listRooms()])
      .then(([bs, rooms]) =>
        setBoards(
          bs.map((b) => ({ ...b, roomName: rooms.find((r) => r.id === b.room_id)?.name ?? 'Unknown room' }))
        )
      )
      .catch(() => {})
  }, [page])

  const present = async () => {
    if (!page || !boardId) return
    setBusy(true)
    try {
      const session = await startSession({
        boardId,
        pageId: page.id,
        pageName: page.name,
        snapshot: pageContent(page.id),
      })
      onOpenChange(false)
      // The presenter controller drives the live session (end / merge / discard).
      router.push(`/present?session=${session.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the presentation')
      setBusy(false)
    }
  }

  return (
    <Dialog open={page !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            <MonitorPlay className="mr-1.5 inline h-4 w-4 text-[var(--accent-blue)]" />
            Present “{page?.name}”
          </DialogTitle>
          <DialogDescription>
            The board works on a temporary copy. When you end the presentation you choose to merge the
            board's changes back or discard them — your notebook is safe either way.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-[12px]">Room board</Label>
          <Select value={boardId} onValueChange={setBoardId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a room…" />
            </SelectTrigger>
            <SelectContent>
              {boards.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.roomName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="pt-1 text-[11.5px] text-muted-foreground">
            In the classroom? Scan the QR on the board with your phone instead.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void present()} disabled={busy || !boardId}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Present'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
