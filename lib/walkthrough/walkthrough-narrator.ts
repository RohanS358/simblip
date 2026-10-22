'use client'

import { useWalkthroughStore } from '../store/walkthrough-store'

class WalkthroughNarrator {
  private currentUtterance: SpeechSynthesisUtterance | null = null
  private preferredVoice: SpeechSynthesisVoice | null = null
  private isInitialized = false

  private initVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const updateVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      this.preferredVoice =
        voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Premium'))) ||
        voices.find((v) => v.lang.startsWith('en')) ||
        voices[0] ||
        null
    }
    updateVoices()
    if (typeof window !== 'undefined' && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices
    }
    this.isInitialized = true
  }

  /** `onProgress(chars)` reports how much of `text` has been spoken so far, so captions can be
   *  written out in step with the voice. Driven by the speech engine's word boundaries when it
   *  has them, and by the reading-time estimate when muted or when no voice is available. */
  public speak(text: string, onProgress?: (chars: number) => void): Promise<void> {
    return new Promise((resolve) => {
      useWalkthroughStore.getState().setSubtitles(text)

      const isMuted = useWalkthroughStore.getState().muted
      const speed = useWalkthroughStore.getState().speed || 0.75

      if (isMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        const words = text.split(' ').length
        const baseDuration = Math.max(2000, (words / 150) * 60 * 1000)
        const duration = baseDuration / speed
        if (onProgress) {
          const t0 = Date.now()
          const iv = setInterval(() => {
            const f = Math.min(1, (Date.now() - t0) / (duration * 0.92)) // finish writing just before the line ends
            onProgress(Math.round(text.length * f))
            if (f >= 1) clearInterval(iv)
          }, 50)
        }
        setTimeout(() => { onProgress?.(text.length); resolve() }, duration)
        return
      }

      if (!this.isInitialized) this.initVoices()

      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      if (this.preferredVoice) utterance.voice = this.preferredVoice
      utterance.rate = 0.85 * speed // Slower, calmer speech rate
      utterance.pitch = 1.0

      let boundaries = 0
      utterance.onboundary = (e) => {
        boundaries++
        onProgress?.(Math.min(text.length, e.charIndex + (e.charLength || 0)))
      }
      utterance.onend = () => {
        this.currentUtterance = null
        onProgress?.(text.length)
        resolve()
      }
      // Some voices (and most mobile ones) never fire boundaries: fall back to the timed estimate.
      if (onProgress) {
        const est = ((text.split(' ').length / 150) * 60 * 1000) / (0.85 * speed)
        const t0 = Date.now()
        const iv = setInterval(() => {
          if (boundaries > 0 || !this.currentUtterance) return clearInterval(iv)
          onProgress(Math.round(text.length * Math.min(0.95, (Date.now() - t0) / est)))
        }, 80)
      }

      utterance.onerror = (e) => {
        console.warn('TTS error or cancelled:', e)
        this.currentUtterance = null
        resolve()
      }

      this.currentUtterance = utterance
      window.speechSynthesis.speak(utterance)
    })
  }

  public pause() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause()
    }
  }

  public resume() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume()
    }
  }

  public stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    this.currentUtterance = null
    useWalkthroughStore.getState().setSubtitles('')
  }
}

export const narrator = new WalkthroughNarrator()
