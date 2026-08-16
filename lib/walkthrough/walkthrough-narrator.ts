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

  public speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      useWalkthroughStore.getState().setSubtitles(text)

      const isMuted = useWalkthroughStore.getState().muted
      const speed = useWalkthroughStore.getState().speed || 0.75

      if (isMuted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        const words = text.split(' ').length
        const baseDuration = Math.max(2000, (words / 150) * 60 * 1000)
        const duration = baseDuration / speed
        setTimeout(() => resolve(), duration)
        return
      }

      if (!this.isInitialized) this.initVoices()

      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)
      if (this.preferredVoice) utterance.voice = this.preferredVoice
      utterance.rate = 0.85 * speed // Slower, calmer speech rate
      utterance.pitch = 1.0

      utterance.onend = () => {
        this.currentUtterance = null
        resolve()
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
