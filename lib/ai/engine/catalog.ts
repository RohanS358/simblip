// The on-device models. One GGUF per tier, Apache-2.0, hosted where the
// browser can fetch it. Sizes are the files' real sizes (Hugging Face tree
// listing, Oct 2026) — the UI shows them BEFORE anything downloads.
//
// Hosting: Hugging Face for now. Production should serve the same files from
// our own object storage (Cloudflare R2, free egress — docs/ai-plans) and only
// this table changes.

export type Tier = 'standard' | 'lite'

export interface ModelSpec {
  tier: Tier
  label: string
  repo: string
  file: string
  /** Download size, megabytes (10^6 bytes). */
  sizeMB: number
  /** Context window. Sizes the KV cache, which is the other half of RAM. */
  nCtx: number
  /** KV-cache bytes per token at 8-bit (layers × kv-heads × head-dim × 2 × 1). */
  kvBytesPerToken: number
  blurb: string
}

export const MODELS: Record<Tier, ModelSpec> = {
  standard: {
    tier: 'standard',
    label: 'Standard',
    repo: 'unsloth/Qwen3-1.7B-GGUF',
    file: 'Qwen3-1.7B-Q4_K_M.gguf',
    sizeMB: 1107,
    nCtx: 6144,
    kvBytesPerToken: 28 * 8 * 128 * 2,
    blurb: 'Best answers.',
  },
  lite: {
    tier: 'lite',
    label: 'Lite',
    repo: 'unsloth/Qwen3-0.6B-GGUF',
    file: 'Qwen3-0.6B-Q4_K_M.gguf',
    sizeMB: 397,
    nCtx: 6144,
    kvBytesPerToken: 28 * 8 * 128 * 2,
    blurb: 'Fast and small.',
  },
}

export const modelUrl = (m: ModelSpec) => `https://huggingface.co/${m.repo}/resolve/main/${m.file}`

/** Honest planning estimate of resident memory for a loaded tier, MB:
 *  weights + 8-bit KV cache + ~200 MB of compute buffers and runtime. */
export const estimateRamMB = (m: ModelSpec) =>
  Math.round(m.sizeMB + (m.nCtx * m.kvBytesPerToken) / 1e6 + 200)
