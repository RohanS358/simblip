import { NextResponse } from 'next/server'
import { pgConfigured, q } from '@/lib/server/pg'
import { bearerClaims } from '@/lib/server/auth'
import { usageOf } from '@/lib/server/quota'
import { PROJECT_QUOTA_BYTES } from '@/lib/storage/quota'

// The account's cloud storage picture for Settings → Storage: the 150 MB
// quota, what uses it by category, the biggest pages, and every file that has
// a cloud copy. Metadata only — no bytes, no page content.

export async function GET(req: Request) {
  if (!pgConfigured) return NextResponse.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const owner = claims.sub
  const [usage, files, pages] = await Promise.all([
    usageOf(q, owner),
    q<{ id: string; name: string; mime: string; size: string; updated_at: string }>(
      `select m.id, m.name, m.mime, b.size_bytes as size, m.updated_at
         from simblip_file_manifest m join simblip_file_blobs b on b.id = m.id
        where m.owner_id = $1 order by b.size_bytes desc limit 500`,
      [owner]
    ),
    q<{ id: string; size: string }>(
      `select id, size_bytes as size from simblip_pages where workspace_id = $1
        order by size_bytes desc limit 20`,
      [owner]
    ),
  ])
  return NextResponse.json({
    limit: PROJECT_QUOTA_BYTES,
    used: usage.total,
    categories: { tree: usage.tree, pages: usage.pages, account: usage.account, files: usage.files },
    files: files.map((f) => ({ ...f, size: Number(f.size) })),
    largestPages: pages.map((p) => ({ id: p.id, size: Number(p.size) })),
  })
}
