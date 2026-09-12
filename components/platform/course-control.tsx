'use client'

// Course control for the platform operator (/dev).
//
// THE TIER THIS FILLS IN. Course Mode had dev publishing from a shell and an
// institution's admin granting inside their own institution, and nothing in
// between: a published course was grantable by every institution, and getting
// one into the database at all meant a checkout, a DATABASE_URL and a CLI. So
// a course authored in the repo simply did not appear anywhere in the product.
//
// This is the missing middle, in one place: what the checkout holds, what the
// database holds, one button to move the first into the second, and per course
// the institutions it is licensed to — with `Everyone` for a core subject that
// should reach a whole institution without its admin granting room by room.

import { useCallback, useEffect, useState } from 'react'
import { Building2, Check, GraduationCap, Loader2, RefreshCw, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { getAccessToken } from '@/lib/auth/store'
import { cn } from '@/lib/utils'

interface RepoCourse {
  id: string
  code: string
  title: string
  subject: string
  semester: number | null
  lessons: number
}
interface PublishedCourse extends RepoCourse {
  version: number
  published: boolean
  updated_at: string
}
interface Institution {
  id: string
  name: string
}
interface Allowance {
  id: string
  course_id: string
  institution_id: string
  institution_name: string
  all_members: boolean
}
interface Payload {
  mode: 'local' | 'cloud'
  migrated?: boolean
  repo: RepoCourse[]
  published: PublishedCourse[]
  institutions: Institution[]
  allowances: Allowance[]
}

const authHeaders = (): HeadersInit => {
  const t = getAccessToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export function CourseControl() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** Which institution the next "Allow" applies to, per course row. */
  const [pick, setPick] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/courses/allowances', { headers: authHeaders() })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'Could not load the course catalogue.')
      }
      setData((await res.json()) as Payload)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const publish = useCallback(
    async (courseId?: string) => {
      setBusy(courseId ?? 'all')
      try {
        const res = await fetch('/api/courses/publish', {
          method: 'POST',
          headers: { ...authHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ fromRepo: courseId ?? true }),
        })
        const body = (await res.json()) as { error?: string; published?: unknown[] }
        if (!res.ok) throw new Error(body.error ?? 'Publish failed.')
        toast.success(
          courseId
            ? `Published ${courseId}.`
            : `Published ${body.published?.length ?? 0} course(s) from the repository.`
        )
        await load()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [load]
  )

  const allow = useCallback(
    async (courseId: string, institutionId: string, allMembers: boolean) => {
      setBusy(`${courseId}:${institutionId}`)
      try {
        const res = await fetch('/api/courses/allowances', {
          method: 'POST',
          headers: { ...authHeaders(), 'content-type': 'application/json' },
          body: JSON.stringify({ courseId, institutionId, allMembers }),
        })
        const body = (await res.json()) as { error?: string }
        if (!res.ok) throw new Error(body.error ?? 'Could not save that.')
        await load()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [load]
  )

  const withdraw = useCallback(
    async (id: string) => {
      setBusy(id)
      try {
        const res = await fetch(`/api/courses/allowances?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: authHeaders(),
        })
        if (!res.ok) throw new Error('Could not withdraw that allowance.')
        await load()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [load]
  )

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4" /> Courses
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-ui-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the catalogue…
        </CardContent>
      </Card>
    )
  }

  const publishedById = new Map(data.published.map((c) => [c.id, c]))
  // The repo is the source of truth for what EXISTS; the database adds state.
  // A course published once and later deleted from the checkout still shows,
  // because it is still what students are being served.
  const rows: (RepoCourse & { db?: PublishedCourse; inRepo: boolean })[] = [
    ...data.repo.map((c) => ({ ...c, db: publishedById.get(c.id), inRepo: true })),
    ...data.published
      .filter((c) => !data.repo.some((r) => r.id === c.id))
      .map((c) => ({ ...c, db: c, inRepo: false })),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4" /> Courses
        </CardTitle>
        <CardDescription>
          Every course in this build, whether it has reached the database, and which institutions
          may use it. An institution&rsquo;s own admin then decides which rooms and people get it —
          unless <b>Everyone</b> is set here, which reaches the whole institution directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.mode === 'local' && (
          <p className="glass rounded-xl p-3 text-ui-xs leading-relaxed text-muted-foreground">
            <b className="text-foreground">Local mode.</b> There is no database, so there is nothing
            to license: every course below is served straight from this build and is already open in
            the Courses panel on this device. Allowances appear once{' '}
            <code className="text-ui-3xs">DATABASE_URL</code> is set.
          </p>
        )}
        {data.mode === 'cloud' && data.migrated === false && (
          <p className="glass rounded-xl border border-[var(--accent-amber)]/40 p-3 text-ui-xs leading-relaxed">
            <b>One migration outstanding.</b> Run{' '}
            <code className="text-ui-3xs">db/migrations/002-course-allowances.sql</code> against this
            database to turn on institution allowances. Publishing works without it.
          </p>
        )}

        {data.mode === 'cloud' && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void publish()} disabled={busy !== null}>
              {busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Publish every course from this build
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={busy !== null}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        )}

        {rows.length === 0 && (
          <p className="py-6 text-center text-ui-sm text-muted-foreground">
            No courses in this build. Lessons live in <code className="text-ui-3xs">content/courses/</code>.
          </p>
        )}

        <div className="space-y-3">
          {rows.map((c) => {
            const mine = data.allowances.filter((a) => a.course_id === c.id)
            const free = data.institutions.filter((i) => !mine.some((a) => a.institution_id === i.id))
            const stale = c.inRepo && c.db && c.db.lessons !== c.lessons
            return (
              <div key={c.id} className="glass rounded-xl p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 text-ui-sm font-semibold">
                      {c.code} <span className="font-normal text-muted-foreground">{c.title}</span>
                    </p>
                    <p className="m-0 text-ui-2xs text-muted-foreground">
                      {c.lessons} lesson{c.lessons === 1 ? '' : 's'}
                      {c.semester ? ` · semester ${c.semester}` : ''}
                      {data.mode === 'local'
                        ? ' · served from this build'
                        : c.db
                          ? ` · published v${c.db.version}${stale ? ' · the build has newer lessons' : ''}`
                          : ' · not published'}
                      {!c.inRepo && ' · not in this build'}
                    </p>
                  </div>
                  {data.mode === 'cloud' && c.inRepo && (
                    <Button
                      size="sm"
                      variant={c.db ? 'outline' : 'default'}
                      onClick={() => void publish(c.id)}
                      disabled={busy !== null}
                    >
                      {busy === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {c.db ? 'Republish' : 'Publish'}
                    </Button>
                  )}
                </div>

                {data.mode === 'cloud' && (
                  <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                    {mine.length === 0 ? (
                      <p className="m-0 text-ui-2xs text-muted-foreground">
                        Not allowed on any institution yet — nobody can be granted it.
                      </p>
                    ) : (
                      mine.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center gap-2.5">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-ui-xs">{a.institution_name}</span>
                          <label className="flex items-center gap-1.5 text-ui-2xs text-muted-foreground">
                            <Switch
                              checked={a.all_members}
                              disabled={busy !== null}
                              onCheckedChange={(v) => void allow(c.id, a.institution_id, v)}
                            />
                            Everyone
                          </label>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => void withdraw(a.id)}
                            aria-label={`Withdraw ${c.code} from ${a.institution_name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))
                    )}

                    {free.length > 0 && c.db && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Select
                          value={pick[c.id] ?? ''}
                          onValueChange={(v) => setPick((p) => ({ ...p, [c.id]: v }))}
                        >
                          <SelectTrigger className={cn('h-8 w-full max-w-xs text-ui-xs')}>
                            <SelectValue placeholder="Allow on an institution…" />
                          </SelectTrigger>
                          <SelectContent>
                            {free.map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null || !pick[c.id]}
                          onClick={() => void allow(c.id, pick[c.id], false)}
                        >
                          <Check className="h-3.5 w-3.5" /> Allow
                        </Button>
                      </div>
                    )}
                    {!c.db && (
                      <p className="m-0 text-ui-2xs text-muted-foreground">
                        Publish it before licensing it to anyone.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
