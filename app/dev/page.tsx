'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Building2, Loader2, Lock, Package, Plus, RefreshCw, School, Shield, Trash2, UserRound, Users, Wrench } from 'lucide-react'
import { RequireAuth } from '@/components/auth/require-auth'
import { PageShell } from '@/components/platform/page-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth/store'
import { getDbMode } from '@/lib/data/db'
import type { BoardRow, InstitutionRow, ProfileRow, RoomMemberRow, RoomRow } from '@/lib/data/types'
import { COMPONENT_PACKAGES } from '@/lib/packages/registry'
import {
  createAccount,
  createBoard,
  createInstitutionWithAdmin,
  createRoom,
  listBoards,
  listInstitutions,
  listMembers,
  listProfiles,
  listRooms,
  setMembership,
  updateInstitutionPackages,
  updateProfilePackages,
} from '@/lib/data/dev'

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string | number }) {
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

export default function DevPage() {
  const profile = useAuthStore((s) => s.profile)
  const institution = useAuthStore((s) => s.institution)
  const [institutions, setInstitutions] = useState<InstitutionRow[]>([])
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [boards, setBoards] = useState<BoardRow[]>([])
  const [members, setMembers] = useState<RoomMemberRow[]>([])
  const [selectedInstitutionId, setSelectedInstitutionId] = useState('')

  const [institutionName, setInstitutionName] = useState('')
  const [institutionSlug, setInstitutionSlug] = useState('')
  const [institutionAccent, setInstitutionAccent] = useState('#3b82f6')
  const [institutionLogo, setInstitutionLogo] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminDepartment, setAdminDepartment] = useState('')
  const [role, setRole] = useState<'admin' | 'teacher' | 'student'>('admin')
  const [accountName, setAccountName] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [accountDepartment, setAccountDepartment] = useState('')
  const [roomName, setRoomName] = useState('')
  const [roomDepartment, setRoomDepartment] = useState('')
  const [boardPassword, setBoardPassword] = useState('')
  const [boardRoomId, setBoardRoomId] = useState('')
  const [membershipRoomId, setMembershipRoomId] = useState('')
  const [membershipProfileId, setMembershipProfileId] = useState('')
  const [membershipRole, setMembershipRole] = useState<'teacher' | 'student'>('student')
  const [pkgTargetType, setPkgTargetType] = useState<'institution' | 'profile'>('institution')
  const [selectedPkgInstId, setSelectedPkgInstId] = useState('')
  const [selectedPkgProfileId, setSelectedPkgProfileId] = useState('')
  const [selectedPackages, setSelectedPackages] = useState<string[]>(COMPONENT_PACKAGES.map((p) => p.domain))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (pkgTargetType === 'institution') {
      const targetInst = institutions.find((i) => i.id === selectedPkgInstId)
      const settings = (targetInst?.settings as Record<string, unknown> | undefined) ?? {}
      const allowed = (settings.package_access as string[] | undefined) ?? COMPONENT_PACKAGES.map((p) => p.domain)
      setSelectedPackages(allowed)
    } else {
      const targetProf = profiles.find((p) => p.id === selectedPkgProfileId)
      const allowed = (targetProf?.package_access as string[] | undefined) ?? COMPONENT_PACKAGES.map((p) => p.domain)
      setSelectedPackages(allowed)
    }
  }, [pkgTargetType, selectedPkgInstId, selectedPkgProfileId, institutions, profiles])

  const savePackageAccess = async () => {
    setBusy(true)
    try {
      if (pkgTargetType === 'institution') {
        if (!selectedPkgInstId) return
        await updateInstitutionPackages(selectedPkgInstId, selectedPackages)
        toast.success('Updated institution package access')
      } else {
        if (!selectedPkgProfileId) return
        await updateProfilePackages(selectedPkgProfileId, selectedPackages)
        toast.success('Updated profile package access')
      }
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save package access')
    } finally {
      setBusy(false)
    }
  }

  const refresh = useCallback(() => {
    void listInstitutions().then((rows) => {
      setInstitutions(rows)
      setSelectedInstitutionId((current) => current || rows[0]?.id || '')
    })
    void listProfiles().then(setProfiles)
    void listRooms().then(setRooms)
    void listBoards().then(setBoards)
    void listMembers().then(setMembers)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const selectedInstitution = useMemo(
    () => institutions.find((item) => item.id === selectedInstitutionId) ?? null,
    [institutions, selectedInstitutionId]
  )
  const selectedRooms = useMemo(
    () => rooms.filter((room) => room.institution_id === selectedInstitutionId),
    [rooms, selectedInstitutionId]
  )
  const selectedProfiles = useMemo(
    () => profiles.filter((item) => item.institution_id === selectedInstitutionId),
    [profiles, selectedInstitutionId]
  )
  const selectedBoards = useMemo(
    () => boards.filter((item) => item.institution_id === selectedInstitutionId),
    [boards, selectedInstitutionId]
  )

  const createEnrollment = async () => {
    if (!institutionName.trim() || !adminName.trim() || !adminEmail.trim() || !adminPassword) return
    setBusy(true)
    try {
      const result = await createInstitutionWithAdmin({
        institution: {
          name: institutionName.trim(),
          slug: institutionSlug.trim() || undefined,
          accentColor: institutionAccent,
          logoUrl: institutionLogo.trim() || null,
        },
        admin: {
          fullName: adminName.trim(),
          email: adminEmail.trim(),
          password: adminPassword,
          department: adminDepartment.trim() || null,
        },
      })
      toast.success(`Created ${result.institution.name} and ${result.admin.email}`)
      setInstitutionName('')
      setInstitutionSlug('')
      setInstitutionLogo('')
      setAdminName('')
      setAdminEmail('')
      setAdminPassword('')
      setAdminDepartment('')
      refresh()
      setSelectedInstitutionId(result.institution.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the enrollment')
    } finally {
      setBusy(false)
    }
  }

  const createAccountForSelected = async () => {
    if (!selectedInstitutionId || !accountName.trim() || !accountEmail.trim() || !accountPassword) return
    setBusy(true)
    try {
      const created = await createAccount({
        institutionId: selectedInstitutionId,
        role,
        fullName: accountName.trim(),
        email: accountEmail.trim(),
        password: accountPassword,
        department: accountDepartment.trim() || null,
      })
      toast.success(`Created ${created.email}`)
      setAccountName('')
      setAccountEmail('')
      setAccountPassword('')
      setAccountDepartment('')
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the account')
    } finally {
      setBusy(false)
    }
  }

  const createRoomForSelected = async () => {
    if (!selectedInstitutionId || !roomName.trim()) return
    setBusy(true)
    try {
      const created = await createRoom({
        institutionId: selectedInstitutionId,
        name: roomName.trim(),
        department: roomDepartment.trim() || null,
      })
      toast.success(`Created room ${created.name}`)
      setRoomName('')
      setRoomDepartment('')
      setBoardRoomId(created.id)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the room')
    } finally {
      setBusy(false)
    }
  }

  const createBoardForSelected = async () => {
    if (!selectedInstitutionId || !boardRoomId || !boardPassword) return
    const room = selectedRooms.find((item) => item.id === boardRoomId)
    if (!room) return
    setBusy(true)
    try {
      const created = await createBoard({
        institutionId: selectedInstitutionId,
        roomId: boardRoomId,
        roomName: room.name,
        password: boardPassword,
      })
      toast.success(`Created ${created.profile.email}`)
      setBoardPassword('')
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the board')
    } finally {
      setBusy(false)
    }
  }

  const toggleMembership = async (roomId: string, profileId: string, memberRoleValue: 'teacher' | 'student', enrolled: boolean) => {
    setBusy(true)
    try {
      await setMembership({ roomId, profileId, memberRole: memberRoleValue, enrolled })
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update membership')
    } finally {
      setBusy(false)
    }
  }

  const resetLogin = () => {
    localStorage.removeItem('simblip-session')
    localStorage.removeItem('simblip-active-user')
    toast.success('Local session cleared')
    window.location.href = '/login'
  }

  return (
    <RequireAuth allow={['super_admin']}>
      <PageShell title="Dev console" backHref="/login">
        <div className="space-y-6 py-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Stat icon={Building2} label="Institutions" value={institutions.length} />
            <Stat icon={Shield} label="Admins" value={profiles.filter((item) => item.role === 'admin').length} />
            <Stat icon={Users} label="Profiles" value={profiles.length} />
            <Stat icon={School} label="Rooms" value={rooms.length} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" /> Platform controls</CardTitle>
              <CardDescription>
                Dev login: aalubhentakobhi / loonivaislobhi. Mode: {getDbMode()}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={refresh} variant="outline"><RefreshCw className="h-4 w-4" /> Refresh</Button>
              <Button onClick={resetLogin} variant="outline"><Lock className="h-4 w-4" /> Sign out</Button>
              <Button onClick={() => window.location.href = '/admin'} variant="outline">Open admin console</Button>
            </CardContent>
          </Card>

          <Tabs defaultValue="enrollment">
            <TabsList>
              <TabsTrigger value="enrollment">Enrollment</TabsTrigger>
              <TabsTrigger value="accounts">Accounts</TabsTrigger>
              <TabsTrigger value="rooms">Rooms</TabsTrigger>
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="packages">Package Access</TabsTrigger>
            </TabsList>

            <TabsContent value="enrollment">
              <Card>
                <CardHeader>
                  <CardTitle>Institution enrollment</CardTitle>
                  <CardDescription>Create a tenant and its first admin in one step.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2"><Label>Institution name</Label><Input value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} placeholder="Institution name" /></div>
                  <div className="space-y-1.5"><Label>Slug</Label><Input value={institutionSlug} onChange={(e) => setInstitutionSlug(e.target.value)} placeholder="institution-slug" /></div>
                  <div className="space-y-1.5"><Label>Accent color</Label><Input type="color" value={institutionAccent} onChange={(e) => setInstitutionAccent(e.target.value)} /></div>
                  <div className="space-y-1.5 md:col-span-2"><Label>Logo URL</Label><Input value={institutionLogo} onChange={(e) => setInstitutionLogo(e.target.value)} placeholder="https://…/logo.svg" /></div>
                  <div className="space-y-1.5"><Label>Admin name</Label><Input value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Prof. Ada Sharma" /></div>
                  <div className="space-y-1.5"><Label>Admin email</Label><Input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@simblip.local" /></div>
                  <div className="space-y-1.5"><Label>Admin password</Label><Input type="text" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="admin" /></div>
                  <div className="space-y-1.5"><Label>Admin department</Label><Input value={adminDepartment} onChange={(e) => setAdminDepartment(e.target.value)} placeholder="Physics" /></div>
                  <div className="md:col-span-2"><Button onClick={() => void createEnrollment()} disabled={busy || !institutionName.trim() || !adminName.trim() || !adminEmail.trim() || !adminPassword}><Plus className="h-4 w-4" /> Create institution + admin</Button></div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="accounts">
              <Card>
                <CardHeader>
                  <CardTitle>Add account</CardTitle>
                  <CardDescription>Create additional admins, teachers, or students for the selected institution.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Institution</Label>
                    <Select value={selectedInstitutionId} onValueChange={setSelectedInstitutionId}>
                      <SelectTrigger><SelectValue placeholder="Pick an institution" /></SelectTrigger>
                      <SelectContent>{institutions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Role</Label><Select value={role} onValueChange={(value) => setRole(value as 'admin' | 'teacher' | 'student')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="teacher">Teacher</SelectItem><SelectItem value="student">Student</SelectItem></SelectContent></Select></div>
                  <div className="space-y-1.5"><Label>Department</Label><Input value={accountDepartment} onChange={(e) => setAccountDepartment(e.target.value)} placeholder="Physics" /></div>
                  <div className="space-y-1.5"><Label>Full name</Label><Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Dr. Elena Vasquez" /></div>
                  <div className="space-y-1.5"><Label>Email</Label><Input value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} placeholder="teacher@simblip.local" /></div>
                  <div className="space-y-1.5"><Label>Password</Label><Input type="text" value={accountPassword} onChange={(e) => setAccountPassword(e.target.value)} placeholder="teacher" /></div>
                  <div className="md:col-span-2"><Button onClick={() => void createAccountForSelected()} disabled={busy || !selectedInstitutionId || !accountName.trim() || !accountEmail.trim() || !accountPassword}><Plus className="h-4 w-4" /> Create account</Button></div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="rooms">
              <Card>
                <CardHeader>
                  <CardTitle>Rooms and boards</CardTitle>
                  <CardDescription>Build physical classroom surfaces and their display accounts.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Institution</Label>
                    <Select value={selectedInstitutionId} onValueChange={setSelectedInstitutionId}>
                      <SelectTrigger><SelectValue placeholder="Pick an institution" /></SelectTrigger>
                      <SelectContent>{institutions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5"><Label>Room name</Label><Input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Room 201" /></div>
                  <div className="space-y-1.5"><Label>Department</Label><Input value={roomDepartment} onChange={(e) => setRoomDepartment(e.target.value)} placeholder="Physics" /></div>
                  <div className="md:col-span-2"><Button onClick={() => void createRoomForSelected()} disabled={busy || !selectedInstitutionId || !roomName.trim()}><Plus className="h-4 w-4" /> Create room</Button></div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Board room</Label>
                    <Select value={boardRoomId} onValueChange={setBoardRoomId}><SelectTrigger><SelectValue placeholder="Pick a room" /></SelectTrigger><SelectContent>{selectedRooms.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <div className="space-y-1.5 md:col-span-2"><Label>Board password</Label><Input type="text" value={boardPassword} onChange={(e) => setBoardPassword(e.target.value)} placeholder="board201" /></div>
                  <div className="md:col-span-2"><Button onClick={() => void createBoardForSelected()} disabled={busy || !boardRoomId || !boardPassword}><Plus className="h-4 w-4" /> Create board</Button></div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="members">
              <Card>
                <CardHeader>
                  <CardTitle>Membership controls</CardTitle>
                  <CardDescription>Enroll profiles into rooms and inspect the current selections.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Room</Label>
                      <Select value={membershipRoomId} onValueChange={setMembershipRoomId}>
                        <SelectTrigger><SelectValue placeholder="Pick a room" /></SelectTrigger>
                        <SelectContent>{selectedRooms.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Profile</Label>
                      <Select value={membershipProfileId} onValueChange={setMembershipProfileId}>
                        <SelectTrigger><SelectValue placeholder="Pick a profile" /></SelectTrigger>
                        <SelectContent>{selectedProfiles.map((item) => <SelectItem key={item.id} value={item.id}>{item.full_name} · {item.role}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Membership role</Label>
                      <Select value={membershipRole} onValueChange={(value) => setMembershipRole(value as 'teacher' | 'student')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="teacher">Teacher</SelectItem><SelectItem value="student">Student</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button
                    onClick={() => void toggleMembership(membershipRoomId, membershipProfileId, membershipRole, true)}
                    disabled={busy || !membershipRoomId || !membershipProfileId}
                  >
                    <BadgeCheck className="h-4 w-4" /> Enroll in room
                  </Button>

                  <div className="space-y-2 border-t border-border/60 pt-4">
                    {selectedRooms.map((room) => {
                      const roomMembers = members.filter((item) => item.room_id === room.id)
                      return (
                        <div key={room.id} className="glass rounded-2xl p-4">
                          <div className="mb-2 flex items-center gap-2">
                            <School className="h-4 w-4 text-[var(--accent-blue)]" />
                            <p className="font-semibold">{room.name}</p>
                          </div>
                          <div className="grid gap-1 md:grid-cols-2">
                            {selectedProfiles.filter((item) => item.role === 'teacher' || item.role === 'student').map((item) => {
                              const membership = roomMembers.find((value) => value.profile_id === item.id)
                              return (
                                <label key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/40">
                                  <Checkbox
                                    checked={Boolean(membership)}
                                    onCheckedChange={(checked) => void toggleMembership(room.id, item.id, item.role === 'teacher' ? 'teacher' : 'student', Boolean(checked))}
                                  />
                                  <span className="flex-1 truncate text-[12px]">{item.full_name}</span>
                                  <span className="text-[10px] uppercase text-muted-foreground">{item.role}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="packages">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-4 w-4" /> Package Access Controls
                  </CardTitle>
                  <CardDescription>
                    Configure which subject & component packages are accessible for an institution or user profile.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Target Type</Label>
                      <Select
                        value={pkgTargetType}
                        onValueChange={(val) => setPkgTargetType(val as 'institution' | 'profile')}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="institution">Institution-wide</SelectItem>
                          <SelectItem value="profile">Individual User Profile</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {pkgTargetType === 'institution' ? (
                      <div className="space-y-1.5">
                        <Label>Institution</Label>
                        <Select value={selectedPkgInstId} onValueChange={setSelectedPkgInstId}>
                          <SelectTrigger><SelectValue placeholder="Pick an institution" /></SelectTrigger>
                          <SelectContent>
                            {institutions.map((item) => (
                              <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label>Profile</Label>
                        <Select value={selectedPkgProfileId} onValueChange={setSelectedPkgProfileId}>
                          <SelectTrigger><SelectValue placeholder="Pick a profile" /></SelectTrigger>
                          <SelectContent>
                            {profiles.map((item) => (
                              <SelectItem key={item.id} value={item.id}>{item.full_name} ({item.email})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 border-t border-border/60 pt-3">
                    <Label className="text-[13px]">Available Packages</Label>
                    <div className="grid gap-2 md:grid-cols-3">
                      {COMPONENT_PACKAGES.map((pkg) => {
                        const isChecked = selectedPackages.includes(pkg.domain) || selectedPackages.includes(pkg.id)
                        return (
                          <label
                            key={pkg.id}
                            className="glass flex items-start gap-2.5 rounded-xl p-3 hover:bg-accent/40 cursor-pointer transition-colors"
                          >
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedPackages((prev) => [...prev, pkg.domain])
                                } else {
                                  setSelectedPackages((prev) =>
                                    prev.filter((id) => id !== pkg.domain && id !== pkg.id)
                                  )
                                }
                              }}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-semibold">{pkg.name}</p>
                              <p className="line-clamp-2 text-[10px] text-muted-foreground">{pkg.description}</p>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={() => void savePackageAccess()}
                      disabled={busy || (pkgTargetType === 'institution' ? !selectedPkgInstId : !selectedPkgProfileId)}
                    >
                      <BadgeCheck className="h-4 w-4" /> Save Package Access
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setSelectedPackages(COMPONENT_PACKAGES.map((p) => p.domain))}
                    >
                      Select All
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <Card>
            <CardHeader>
              <CardTitle>Current institution snapshot</CardTitle>
              <CardDescription>{institution?.name ?? 'No active institution'}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 p-4 text-[12px] text-muted-foreground">
                <p className="mb-1 text-foreground">Institution</p>
                <p>{selectedInstitution?.name ?? 'Pick one above'}</p>
              </div>
              <div className="rounded-2xl border border-border/60 p-4 text-[12px] text-muted-foreground">
                <p className="mb-1 text-foreground">Accounts</p>
                <p>{selectedProfiles.length} profiles, {selectedProfiles.filter((item) => item.role === 'admin').length} admins</p>
              </div>
              <div className="rounded-2xl border border-border/60 p-4 text-[12px] text-muted-foreground">
                <p className="mb-1 text-foreground">Rooms / boards</p>
                <p>{selectedRooms.length} rooms, {selectedBoards.length} boards</p>
              </div>
            </CardContent>
          </Card>

          {/* Storage GC card */}
          <StorageGcCard />
        </div>
      </PageShell>
    </RequireAuth>
  )
}

function StorageGcCard() {
  const [result, setResult] = useState<{ total: number; deleted: number; deletedIds: string[] } | null>(null)
  const [running, setRunning] = useState(false)

  const runGc = async () => {
    setRunning(true)
    setResult(null)
    try {
      const { useWorkspaceStore } = await import('@/lib/store/workspace')
      const { runStorageGc } = await import('@/lib/storage/gc')
      const nodes = useWorkspaceStore.getState().nodes
      const res = await runStorageGc(nodes)
      setResult(res)
      if (res.deleted > 0) {
        toast.success(`GC: freed ${res.deleted} orphaned file${res.deleted === 1 ? '' : 's'} from OPFS`)
      } else {
        toast.success('GC: storage is clean — no orphans found')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'GC failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-4 w-4" /> Storage Garbage Collector
        </CardTitle>
        <CardDescription>
          Scan OPFS local storage for blobs no longer referenced by any document, pptx,
          image, or upload. Deletes orphans to reclaim space.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => void runGc()} disabled={running}>
          {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Scanning…</> : 'Run Storage GC'}
        </Button>
        {result && (
          <div className="glass rounded-2xl p-4 text-[12px] space-y-1">
            <p><span className="text-foreground font-semibold">Total OPFS files:</span> {result.total}</p>
            <p><span className="text-foreground font-semibold">Orphans deleted:</span> {result.deleted}</p>
            {result.deletedIds.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-muted-foreground">View deleted IDs</summary>
                <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
                  {result.deletedIds.map((id) => <li key={id}>{id}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}