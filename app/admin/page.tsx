'use client'

// Institution admin console: people, rooms & boards, library approval,
// announcements and branding. Provisioning of the institution itself is done
// by the SIMBLIP operator (enterprise licensing) — everything inside the
// tenant is managed here.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  GraduationCap,
  KeyRound,
  LibraryBig,
  Loader2,
  Megaphone,
  MonitorPlay,
  Plus,
  School,
  UserRound,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { useAuthStore } from '@/lib/auth/store'
import { ROLE_LABEL, type Role } from '@/lib/auth/types'
import {
  createBoard,
  createPerson,
  createRoom,
  listBoards,
  listPeople,
  listRooms,
  listAllMembers,
  resetPassword,
  setMembership,
  setPersonActive,
  subscribeMembers,
  subscribeProfiles,
  subscribeRooms,
  updateInstitution,
} from '@/lib/data/admin'
import { listAssets, setApproved, subscribeLibrary } from '@/lib/data/library'
import { listMyAnnouncements, postAnnouncement } from '@/lib/data/announcements'
import { dbMode } from '@/lib/data/db'
import type {
  AnnouncementRow,
  BoardRow,
  LibraryAssetRow,
  ProfileRow,
  RoomMemberRow,
  RoomRow,
} from '@/lib/data/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ── Overview ────────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="glass flex items-center gap-3 rounded-2xl p-4">
      <Icon className="h-5 w-5 text-[var(--accent-blue)]" />
      <div>
        <p className="text-[20px] font-extrabold leading-none">{value}</p>
        <p className="mt-1 text-[11.5px] text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function Overview({ people, rooms, boards, assets }: { people: ProfileRow[]; rooms: RoomRow[]; boards: BoardRow[]; assets: LibraryAssetRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 pt-4 md:grid-cols-4">
      <Stat icon={GraduationCap} label="Teachers" value={people.filter((p) => p.role === 'teacher').length} />
      <Stat icon={UserRound} label="Students" value={people.filter((p) => p.role === 'student').length} />
      <Stat icon={School} label="Rooms" value={rooms.length} />
      <Stat icon={MonitorPlay} label="Room boards" value={boards.length} />
      <div className="col-span-2 md:col-span-4">
        <div className="glass rounded-2xl p-4 text-[12.5px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">Provisioning</p>
          {dbMode === 'local' ? (
            <p>
              Local demo tenant — accounts you create below work immediately on this device. In cloud
              mode, institutions and their auth users are provisioned by the SIMBLIP operator
              (enterprise licensing, no self-service sign-up).
            </p>
          ) : (
            <p>
              Cloud tenant. New auth accounts are provisioned by the SIMBLIP operator with the service
              role (supabase/provision.sql); everything else — rooms, enrollment, boards, library,
              announcements — is managed here.
            </p>
          )}
          <p className="mt-1">{assets.length} assets in the institution library.</p>
        </div>
      </div>
    </div>
  )
}

// ── People ──────────────────────────────────────────────────────────────────

function PeopleTab({ people, refresh }: { people: ProfileRow[]; refresh: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'teacher' | 'student'>('student')
  const [department, setDepartment] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!name.trim() || !email.trim() || !password) return
    setBusy(true)
    try {
      await createPerson({ fullName: name.trim(), email: email.trim(), role, department: department.trim() || undefined, password })
      toast.success(`${ROLE_LABEL[role]} account created for ${name.trim()}`)
      setName(''); setEmail(''); setDepartment(''); setPassword('')
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the account')
    } finally {
      setBusy(false)
    }
  }

  const doReset = async (p: ProfileRow) => {
    const pw = window.prompt(`New password for ${p.full_name}:`)
    if (!pw) return
    try {
      await resetPassword(p.id, pw)
      toast.success(`Password reset for ${p.full_name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed')
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="glass rounded-2xl p-4">
        <p className="mb-3 text-[13px] font-semibold">Invite a person</p>
        <div className="grid gap-2 md:grid-cols-2">
          <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Select value={role} onValueChange={(v) => setRole(v as 'teacher' | 'student')}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="student">Student</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Department (optional)" value={department} onChange={(e) => setDepartment(e.target.value)} />
          <Input placeholder="Initial password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button onClick={() => void add()} disabled={busy || !name.trim() || !email.trim() || !password}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4" /> Create account</>}
          </Button>
        </div>
      </div>

      <div className="glass overflow-hidden rounded-2xl">
        {people.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2.5 last:border-0">
            <div className="min-w-40">
              <p className="text-[13px] font-semibold">{p.full_name}</p>
              <p className="text-[11px] text-muted-foreground">{p.email}</p>
            </div>
            <Badge variant="secondary" className="text-[10.5px]">{ROLE_LABEL[p.role as Role]}</Badge>
            {p.department && <span className="text-[11px] text-muted-foreground">{p.department}</span>}
            <div className="flex-1" />
            {dbMode === 'local' && p.role !== 'admin' && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void doReset(p)}>
                <KeyRound className="h-3 w-3" /> Reset password
              </Button>
            )}
            {p.role !== 'admin' && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                Active
                <Switch
                  checked={p.active}
                  onCheckedChange={(v) => void setPersonActive(p.id, v).then(refresh)}
                  aria-label={`${p.full_name} active`}
                />
              </label>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Rooms & boards ──────────────────────────────────────────────────────────

function RoomsTab({
  people,
  rooms,
  boards,
  members,
  refresh,
}: {
  people: ProfileRow[]
  rooms: RoomRow[]
  boards: BoardRow[]
  members: RoomMemberRow[]
  refresh: () => void
}) {
  const [roomName, setRoomName] = useState('')
  const [boardPw, setBoardPw] = useState<Record<string, string>>({})

  const addRoom = async () => {
    if (!roomName.trim()) return
    await createRoom(roomName.trim())
    setRoomName('')
    toast.success('Room created')
    refresh()
  }

  const addBoard = async (room: RoomRow) => {
    const pw = boardPw[room.id]
    if (!pw) return
    try {
      const { email } = await createBoard(room.id, room.name, pw)
      toast.success(`Board account ${email} created — sign the classroom display in with it.`)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the board')
    }
  }

  const enrollable = people.filter((p) => (p.role === 'teacher' || p.role === 'student') && p.active)

  return (
    <div className="space-y-4 pt-4">
      <div className="glass flex gap-2 rounded-2xl p-4">
        <Input placeholder="New room, e.g. “Room 305”" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
        <Button onClick={() => void addRoom()} disabled={!roomName.trim()}>
          <Plus className="h-4 w-4" /> Add room
        </Button>
      </div>

      {rooms.map((room) => {
        const board = boards.find((b) => b.room_id === room.id)
        const boardProfile = board && people.find((p) => p.id === board.profile_id)
        const roomMembers = members.filter((m) => m.room_id === room.id)
        return (
          <div key={room.id} className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <School className="h-4 w-4 text-[var(--accent-blue)]" />
              <p className="flex-1 text-[14px] font-bold">{room.name}</p>
              {board ? (
                <Badge variant="secondary" className="text-[10.5px]">
                  <MonitorPlay className="mr-1 h-3 w-3" /> Board: {boardProfile?.email ?? 'configured'} · code{' '}
                  <span className="ml-1 font-mono">{board.pairing_code}</span>
                </Badge>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Input
                    placeholder="Board password"
                    className="h-7 w-36 text-[11.5px]"
                    value={boardPw[room.id] ?? ''}
                    onChange={(e) => setBoardPw((s) => ({ ...s, [room.id]: e.target.value }))}
                  />
                  <Button size="sm" variant="outline" className="h-7 text-[11.5px]" disabled={!boardPw[room.id]} onClick={() => void addBoard(room)}>
                    <MonitorPlay className="h-3.5 w-3.5" /> Create board
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-3 grid gap-1 border-t border-border/50 pt-3 sm:grid-cols-2">
              {enrollable.map((p) => {
                const m = roomMembers.find((x) => x.profile_id === p.id)
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] hover:bg-accent/40">
                    <Checkbox
                      checked={Boolean(m)}
                      onCheckedChange={(v) =>
                        void setMembership(room.id, p.id, p.role === 'teacher' ? 'teacher' : 'student', Boolean(v)).then(refresh)
                      }
                    />
                    <span className="flex-1 truncate">{p.full_name}</span>
                    <span className="text-[10.5px] uppercase text-muted-foreground">{p.role}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Library approval ────────────────────────────────────────────────────────

function LibraryTab({ assets, refresh }: { assets: LibraryAssetRow[]; refresh: () => void }) {
  return (
    <div className="space-y-2 pt-4">
      <p className="text-[12.5px] text-muted-foreground">
        Approved assets are visible to students. Teachers always see everything in the library.
      </p>
      {assets.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <LibraryBig className="h-6 w-6 text-muted-foreground/50" />
          <p className="text-[13px] text-muted-foreground">The library is empty.</p>
        </div>
      )}
      {assets.map((a) => (
        <div key={a.id} className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold">
              {a.title}
              {a.approved && <BadgeCheck className="h-3.5 w-3.5 text-[var(--accent-mint)]" />}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {a.uploader_name} · <span className="capitalize">{a.category.replace('-', ' ')}</span>
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            Student-visible
            <Switch checked={a.approved} onCheckedChange={(v) => void setApproved(a.id, v).then(refresh)} />
          </label>
        </div>
      ))}
    </div>
  )
}

// ── Announcements ───────────────────────────────────────────────────────────

function AnnouncementsTab({ rooms }: { rooms: RoomRow[] }) {
  const [body, setBody] = useState('')
  const [roomId, setRoomId] = useState<string>('all')
  const [items, setItems] = useState<AnnouncementRow[]>([])

  const refresh = useCallback(() => void listMyAnnouncements().then(setItems), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const post = async () => {
    if (!body.trim()) return
    await postAnnouncement(body.trim(), roomId === 'all' ? null : roomId)
    setBody('')
    toast.success('Announcement posted')
    refresh()
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="glass space-y-2 rounded-2xl p-4">
        <Textarea rows={2} placeholder="Write an announcement…" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex gap-2">
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Whole institution</SelectItem>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void post()} disabled={!body.trim()}>
            <Megaphone className="h-4 w-4" /> Post
          </Button>
        </div>
      </div>
      {items.map((a) => (
        <div key={a.id} className="glass rounded-2xl px-4 py-3">
          <p className="text-[13px]">{a.body}</p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {a.room_id ? rooms.find((r) => r.id === a.room_id)?.name ?? 'Room' : 'Whole institution'} ·{' '}
            {new Date(a.created_at).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  )
}

// ── Branding ────────────────────────────────────────────────────────────────

function BrandingTab() {
  const institution = useAuthStore((s) => s.institution)
  const [name, setName] = useState('')
  const [logo, setLogo] = useState('')
  const [accent, setAccent] = useState('#3b82f6')

  useEffect(() => {
    if (!institution) return
    setName(institution.name)
    setLogo(String(institution.logo_url ?? ''))
    setAccent(String(institution.accent_color ?? '#3b82f6'))
  }, [institution])

  const save = async () => {
    await updateInstitution({ name: name.trim(), logo_url: logo.trim() || null, accent_color: accent })
    toast.success('Branding updated')
  }

  return (
    <div className="glass mt-4 max-w-md space-y-3 rounded-2xl p-4">
      <div className="space-y-1.5">
        <Label className="text-[12px]">Institution name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[12px]">Logo URL</Label>
        <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.svg" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[12px]">Accent color</Label>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Accent color"
            className="h-8 w-12 cursor-pointer rounded-md border border-border bg-transparent"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
          />
          <Input value={accent} onChange={(e) => setAccent(e.target.value)} className="w-28 font-mono text-[12px]" />
        </div>
      </div>
      <Button onClick={() => void save()} disabled={!name.trim()}>Save branding</Button>
    </div>
  )
}

// ── Console ─────────────────────────────────────────────────────────────────

function AdminConsole() {
  const [people, setPeople] = useState<ProfileRow[]>([])
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [boards, setBoards] = useState<BoardRow[]>([])
  const [members, setMembers] = useState<RoomMemberRow[]>([])
  const [assets, setAssets] = useState<LibraryAssetRow[]>([])

  const refresh = useCallback(() => {
    void listPeople().then(setPeople).catch(() => {})
    void listRooms().then(setRooms).catch(() => {})
    void listBoards().then(setBoards).catch(() => {})
    void listAllMembers().then(setMembers).catch(() => {})
    void listAssets().then(setAssets).catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const unsubs = [
      subscribeProfiles(refresh),
      subscribeRooms(refresh),
      subscribeMembers(refresh),
      subscribeLibrary(refresh),
    ]
    return () => unsubs.forEach((u) => u())
  }, [refresh])

  const pendingApprovals = useMemo(() => assets.filter((a) => !a.approved).length, [assets])

  return (
    <PageShell title="Admin console">
      <Tabs defaultValue="overview" className="pt-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="rooms">Rooms & Boards</TabsTrigger>
          <TabsTrigger value="library">
            Library{pendingApprovals > 0 ? ` (${pendingApprovals})` : ''}
          </TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview people={people} rooms={rooms} boards={boards} assets={assets} />
        </TabsContent>
        <TabsContent value="people">
          <PeopleTab people={people} refresh={refresh} />
        </TabsContent>
        <TabsContent value="rooms">
          <RoomsTab people={people} rooms={rooms} boards={boards} members={members} refresh={refresh} />
        </TabsContent>
        <TabsContent value="library">
          <LibraryTab assets={assets} refresh={refresh} />
        </TabsContent>
        <TabsContent value="announcements">
          <AnnouncementsTab rooms={rooms} />
        </TabsContent>
        <TabsContent value="branding">
          <BrandingTab />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}

export default function AdminPage() {
  return (
    <RequireAuth allow={['admin', 'super_admin']}>
      <AdminConsole />
    </RequireAuth>
  )
}
