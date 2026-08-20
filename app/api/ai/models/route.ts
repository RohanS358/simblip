// Which models the AI panel may choose between.
//
// Read-only, and only for the LIVE backend: local models come from Ollama's
// own tags endpoint (so a model the user pulls shows up with no config here),
// the hosted list from OpenRouter's catalogue.

import { NextResponse } from 'next/server'
import { listModels } from '@/lib/ai/generate'

export async function GET() {
  return NextResponse.json(await listModels())
}
