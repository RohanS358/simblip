'use client'

// Course catalogue and grants, for the admin console.
//
// These go through the dedicated /api/courses endpoints rather than the
// generic /api/pg gateway, because a grant is not a plain row read: reaching a
// course means "granted to me, OR to a room I belong to", and that join has to
// be resolved on the server so a client can never ask for a course it was not
// given. The endpoints also enforce that an admin only grants within their own
// institution.

import { getAccessToken } from '@/lib/auth/store'

export interface CourseRow {
  id: string
  code: string
  title: string
  subject: string
  semester: number | null
  version: number
}

export interface GrantRow {
  id: string
  course_id: string
  target_room_id: string | null
  target_profile_id: string | null
  granted_at: string
  code: string
  title: string
  semester: number | null
  room_name: string | null
  profile_name: string | null
}

function authHeaders(): HeadersInit {
  const t = getAccessToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

/** This institution's grants, plus every course that could be granted. */
export async function listGrants(): Promise<{ grants: GrantRow[]; catalogue: CourseRow[] }> {
  return json(await fetch('/api/courses/grants', { headers: authHeaders() }))
}

/** Grant a course to a whole room (a class) or to one profile. */
export async function grantCourse(
  courseId: string,
  target: { roomId: string } | { profileId: string }
): Promise<void> {
  await json(
    await fetch('/api/courses/grants', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ courseId, ...target }),
    })
  )
}

/** Revoke one grant. Progress survives — it is keyed by page id, not by grant. */
export async function revokeGrant(id: string): Promise<void> {
  await json(
    await fetch(`/api/courses/grants?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
  )
}
