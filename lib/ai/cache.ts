// Generation cache — the model round we don't have to run at all.
//
// The cheapest way to make a small model faster is to not call it. SIMBLIP's
// real load is a classroom working through one syllabus: thirty students, the
// same course question set (public/100_Questions_All_Subjects.md), the same
// "simulate a pendulum" from a fresh page. Every one of those is currently a
// full ~2.2s generation on the same GPU, producing the same text.
//
// This memoizes the GENERATOR, not the pipeline — the key is the exact tuple
// that goes to the model (backend, system prompt, user prompt, examples,
// token budget), so a hit is a pure memo and cannot be wrong. Nothing about
// the page, the intent or the placement needs to be reasoned about: if any of
// it differed, the prompt text differed, so the key differed.
//
// Verification still runs on a hit. Lint is microseconds and the repair loop
// is unchanged, so a cached script goes through exactly the checks a fresh
// one does — the cache buys GPU time, never a shortcut past the linter.
//
// Degrades to a no-op with no REDIS_URL, and every Redis call is wrapped: a
// cache that can break generation is worse than no cache.

import { createHash } from 'node:crypto'
import { redisConfigured, getRedisPub } from '@/lib/server/redis'
import type { SimScriptGenerator } from './generate'

/** Bump when the cached VALUE's meaning changes. The prompt and model are
 *  already part of the key, so a corpus or system-prompt edit invalidates on
 *  its own — this is only for a change in what we store. */
const CACHE_VERSION = 'v1'

/** A week. Generations are deterministic-ish given the same prompt, and the
 *  corpus edits that would change an answer already change the key. */
const TTL_SECONDS = 7 * 24 * 60 * 60

/** Redis here is a 30MB free tier shared with board pub/sub and presence
 *  (lib/server/redis.ts). A scene is ~1KB and a derivation a few KB; anything
 *  much larger is a runaway generation not worth a week of that budget. */
const MAX_VALUE_BYTES = 32_000

function keyFor(parts: unknown[]): string {
  const hash = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `aigen:${CACHE_VERSION}:${hash}`
}

/**
 * Wrap a generator so identical calls are served from Redis.
 *
 * On a hit the cached text is replayed through `onToken` before returning, so
 * the panel still animates the script being written. Replaying instantly
 * rather than not at all keeps the UI's one moving part honest: the user sees
 * the same thing, it just arrives immediately.
 */
export function withCache(inner: SimScriptGenerator): SimScriptGenerator {
  if (!redisConfigured) return inner

  return {
    name: `${inner.name}+cache`,
    async generate(system, user, onToken, shots, maxTokens) {
      const key = keyFor([inner.name, system, user, shots ?? null, maxTokens ?? null])

      try {
        const hit = await getRedisPub().get(key)
        if (hit !== null) {
          onToken?.(hit)
          return hit
        }
      } catch {
        // Unreachable Redis is a slow path, not a failure — fall through and
        // generate. Never let a cache outage take the feature down.
      }

      const text = await inner.generate(system, user, onToken, shots, maxTokens)

      // Only store something worth storing. An empty completion is a failed
      // generation and caching it would make one bad round permanent.
      if (text.trim().length > 0 && Buffer.byteLength(text) <= MAX_VALUE_BYTES) {
        try {
          await getRedisPub().set(key, text, 'EX', TTL_SECONDS)
        } catch {
          // Same: a write that fails costs nothing but the next generation.
        }
      }
      return text
    },
  }
}
