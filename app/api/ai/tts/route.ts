// Speech for the app. Browsers on Linux ship no speech voices, so narration is synthesised by the AI
// server's neural voice (ai-server/tts, Kokoro) and streamed back as WAV. The browser never holds the
// server key: this route adds it. No text is logged.

import { NextResponse } from 'next/server'
import { z } from 'zod'

const bodySchema = z.object({
  text: z.string().min(1).max(800),
  voice: z.string().regex(/^[a-z]{2}_[a-z]+$/).default('af_heart'),
  speed: z.number().min(0.6).max(1.6).default(1),
})

const upstream = () => {
  const host = process.env.OLLAMA_HOST
  if (!host || process.env.AI_BACKEND === 'openrouter') return null
  return { host, headers: { 'Content-Type': 'application/json', ...(process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {}) } }
}

/** Is a neural voice available, and which? The player probes this once to decide browser vs neural speech. */
export async function GET() {
  const u = upstream()
  if (!u) return NextResponse.json({ available: false, voices: [] })
  try {
    const r = await fetch(`${u.host}/v1/tts/voices`, { headers: u.headers, signal: AbortSignal.timeout(2500) })
    if (!r.ok) return NextResponse.json({ available: false, voices: [] })
    const { voices } = (await r.json()) as { voices: string[] }
    return NextResponse.json({ available: true, voices })
  } catch {
    return NextResponse.json({ available: false, voices: [] })
  }
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const u = upstream()
  if (!u) return NextResponse.json({ error: 'No speech service configured' }, { status: 503 })
  try {
    const r = await fetch(`${u.host}/v1/tts`, { method: 'POST', headers: u.headers, body: JSON.stringify(parsed.data), signal: AbortSignal.timeout(30_000) })
    if (!r.ok) return NextResponse.json({ error: 'Speech service error' }, { status: r.status === 503 ? 503 : 502 })
    return new Response(r.body, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=86400' } })
  } catch {
    return NextResponse.json({ error: 'Speech service unreachable' }, { status: 503 })
  }
}
