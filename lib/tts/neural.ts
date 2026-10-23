'use client'

// Neural narration: fetch audio for a line from /api/ai/tts, play it, and report how much has been spoken —
// from the audio clock, so a caption written out to it is exactly in time (unlike the browser's boundary
// events, which many voices never fire). Lines are cached in memory and prefetched ahead of the player.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { speakable } from './speakable'

export interface VoicePrefs { voice: string; setVoice: (v: string) => void }
export const useVoicePrefs = create<VoicePrefs>()(
  persist((set) => ({ voice: 'af_heart', setVoice: (voice) => set({ voice }) }), { name: 'simblip-voice', storage: createJSONStorage(() => localStorage) })
)

/** Curated women's voices, best first. `af_heart` is Kokoro's top-rated voice. */
export const WOMEN_VOICES: { id: string; label: string }[] = [
  { id: 'af_heart', label: 'Heart — warm, natural' },
  { id: 'af_bella', label: 'Bella — bright' },
  { id: 'af_nicole', label: 'Nicole — calm, soft' },
  { id: 'af_sarah', label: 'Sarah — clear' },
  { id: 'af_nova', label: 'Nova — energetic' },
  { id: 'bf_emma', label: 'Emma — British' },
  { id: 'bf_isabella', label: 'Isabella — British, warm' },
]

let availability: Promise<boolean> | null = null
let probedAt = 0
/** Is the neural voice reachable? A yes is remembered for the page; a NO is re-checked after 10 s, so a voice service
 *  that was down when the lesson started (or comes up later) is picked up without a reload. */
export const neuralAvailable = async (): Promise<boolean> => {
  if (availability && (Date.now() - probedAt < 10_000 || (await availability))) return availability
  probedAt = Date.now()
  return (availability = fetch('/api/ai/tts').then((r) => r.json()).then((j: { available: boolean }) => j.available).catch(() => false))
}
export const resetNeuralProbe = () => { availability = null }

const clips = new Map<string, Promise<Blob>>()
const MAX_CLIPS = 120
const keyOf = (text: string, voice: string, speed: number) => `${voice}|${speed.toFixed(2)}|${text}`

function load(text: string, voice: string, speed: number): Promise<Blob> {
  const key = keyOf(text, voice, speed)
  let p = clips.get(key)
  if (!p) {
    p = fetch('/api/ai/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: speakable(text), voice, speed }) }).then((r) => {
      if (!r.ok) throw new Error(`speech ${r.status}`)
      return r.blob()
    })
    p.catch(() => clips.delete(key)) // a failure must not be remembered
    clips.set(key, p)
    if (clips.size > MAX_CLIPS) clips.delete(clips.keys().next().value as string)
  }
  return p
}

/** Warm the cache for lines that are about to be spoken. */
export const prefetch = (texts: string[], speed = 1) => {
  const voice = useVoicePrefs.getState().voice
  for (const t of texts) if (t.trim()) void load(t, voice, speed).catch(() => {})
}

/** The progress a caption should show at time `t` of a clip `dur` long: slightly ahead of the voice, finishing a hair early. */
export const charsAt = (len: number, t: number, dur: number) => (dur > 0 ? Math.min(len, Math.round(len * Math.min(1, (t / dur) * 1.04 + 0.01))) : 0)

/** Playback rate for the app's speed control: the app's default 0.75 was tuned for slow browser voices;
 *  a neural voice sounds best near its natural pace, so the whole range is shifted up. */
export const rateFor = (speed: number) => Math.max(0.8, Math.min(1.7, 0.95 + (speed - 0.75) * 0.6))

let current: HTMLAudioElement | null = null
let finish: (() => void) | null = null
export const pauseNeural = () => current?.pause()
export const resumeNeural = () => void current?.play().catch(() => {})
/** Stop and RESOLVE the pending line, so nothing awaiting it hangs. */
export const stopNeural = () => { if (current) { current.pause(); current.src = '' ; current = null } finish?.(); finish = null }

/** Speak a line. Resolves when the audio ends. Rejects if the voice is unavailable, so the caller can fall back. */
export async function speakNeural(text: string, speed: number, onProgress?: (chars: number) => void): Promise<void> {
  stopNeural()
  const voice = useVoicePrefs.getState().voice
  const blob = await load(text, voice, 1)
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.playbackRate = rateFor(speed) // applied on playback, so one cached clip serves every speed
  current = audio
  await new Promise<void>((resolve, reject) => {
    finish = resolve
    audio.ontimeupdate = () => onProgress?.(charsAt(text.length, audio.currentTime, audio.duration))
    audio.onended = () => { onProgress?.(text.length); resolve() }
    audio.onerror = () => reject(new Error('audio failed'))
    audio.play().catch(reject) // autoplay can be blocked until the first user gesture
  }).finally(() => { URL.revokeObjectURL(url); if (current === audio) current = null; finish = null })
}
