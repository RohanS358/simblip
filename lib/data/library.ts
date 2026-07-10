'use client'

// Institution Library — reusable teaching assets (lesson pages, simulations,
// circuit templates). Teachers and admins publish; admins approve; students
// browse approved assets read-only. Inserting an asset always clones it.

import * as db from './db'
import { useAuthStore } from '@/lib/auth/store'
import { can } from '@/lib/auth/types'
import type { PageDoc, SceneObject } from '@/lib/scene/types'
import type { AssetKind, LibraryAssetRow } from './types'

export async function publishAsset(input: {
  title: string
  description?: string
  category: string
  tags: string[]
  kind: AssetKind
  content: PageDoc | SceneObject[]
}): Promise<void> {
  const { profile } = useAuthStore.getState()
  if (!profile || !can(profile.role, 'publish-library'))
    throw new Error('Only teachers and admins can publish to the library.')
  const now = new Date().toISOString()
  const row: LibraryAssetRow = {
    id: db.newId(),
    institution_id: profile.institution_id,
    uploader_id: profile.id,
    uploader_name: profile.full_name,
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    tags: input.tags,
    kind: input.kind,
    content: JSON.parse(JSON.stringify(input.content)) as PageDoc | SceneObject[],
    // teacher/admin uploads are institution-visible immediately; the
    // `approved` flag additionally opens them to students.
    approved: profile.role === 'admin',
    version: 1,
    created_at: now,
    updated_at: now,
  }
  await db.insert('library_assets', row)
}

/** Role-aware listing: students only ever see approved assets. */
export async function listAssets(): Promise<LibraryAssetRow[]> {
  const { profile } = useAuthStore.getState()
  if (!profile) return []
  const rows = await db.list<LibraryAssetRow>('library_assets', {
    institution_id: profile.institution_id,
  })
  const visible = profile.role === 'student' ? rows.filter((a) => a.approved) : rows
  return visible.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export const setApproved = (id: string, approved: boolean) =>
  db.update('library_assets', id, { approved, updated_at: new Date().toISOString() })

export const removeAsset = (id: string) => db.removeById('library_assets', id)

export const subscribeLibrary = (fn: () => void) => db.subscribe('library_assets', fn)

// ── Favorites (per user, per device) ────────────────────────────────────────

const favKey = (userId: string) => `simblip-library-favorites:${userId}`

export function favoriteIds(userId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(favKey(userId)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function toggleFavorite(userId: string, assetId: string): Set<string> {
  const ids = favoriteIds(userId)
  if (ids.has(assetId)) ids.delete(assetId)
  else ids.add(assetId)
  localStorage.setItem(favKey(userId), JSON.stringify([...ids]))
  return ids
}
