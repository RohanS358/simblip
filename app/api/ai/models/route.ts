// Which models the AI panel may choose between.
//
// Read-only, and only for the LIVE backend: local models come from Ollama's
// own tags endpoint (so a model the user pulls shows up with no config here),
// the hosted list from OpenRouter's catalogue.

import { NextResponse } from 'next/server'
import { listModels } from '@/lib/ai/generate'
import { authorizeAi, visibleModels } from '@/lib/server/ai-guard'

export async function GET(req: Request) {
  const auth = authorizeAi(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  // only names the server will actually accept (a cloud deployment honours an allow-list)
  return NextResponse.json(visibleModels(await listModels(), auth.caller))
}
