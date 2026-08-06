import { NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { bearerClaims } from '@/lib/server/auth'

// Vercel Blob client-upload token issuance — the ONE step that has to be
// bespoke (the generic /api/pg gateway has no way to mint a Blob upload
// token). The file's bytes never transit this function: the browser uploads
// straight to Blob using the token this route hands back, matching how the
// rest of this app avoids proxying large payloads through a serverless
// function (see lib/server/pg.ts's pool max:2 comment for why that matters
// here). Recording the resulting blob_url happens client-side afterward via
// a plain POST to /api/pg/simblip_file_manifest — same pattern already used
// for simblip_pages — so there is deliberately no onUploadCompleted/confirm
// route in this phase; see the storage migration plan for why that's an
// acceptable trust boundary (matches every other jsonb column this app
// already lets the client write).

export async function POST(req: Request) {
  const claims = bearerClaims(req)
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'BLOB_READ_WRITE_TOKEN is not configured' }, { status: 500 })
  }

  const body = (await req.json()) as HandleUploadBody
  try {
    const result = await handleUpload({
      body,
      request: req,
      // handleUpload's implicit process.env.BLOB_READ_WRITE_TOKEN pickup only
      // fires when it detects a Vercel deployment; on a custom domain
      // (simblip.rohan-singh.com.np) that detection can miss, silently
      // signing client tokens with an empty/invalid secret — the browser
      // then sees a generic 400 with no CORS header from vercel.com's real
      // API, since the request never gets far enough to attach one. Passing
      // the token explicitly removes the guesswork.
      token: process.env.BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async () => ({
        // Content-agnostic on purpose — uploads here are arbitrary user
        // files (PDFs, images, video, audio, office docs), not one fixed
        // MIME family.
        maximumSizeInBytes: 1024 * 1024 * 1024, // 1 GB — generous ceiling, not a design commitment; see plan's chunked-upload non-goal for large-file follow-up.
      }),
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload token error' }, { status: 400 })
  }
}
