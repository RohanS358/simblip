'use client'

// What can THIS device run? Decided once, shown to the user, overridable.
// Never blocks anyone: the worst answer is "use the server".

import { MODELS, estimateRamMB, type Tier } from './catalog'

export interface Capabilities {
  /** A real WebGPU adapter (not just the API). */
  webgpu: boolean
  /** SharedArrayBuffer available — multi-threaded CPU inference. */
  isolated: boolean
  cores: number
  /** Chrome reports 0.25–8; null elsewhere. */
  memGB: number | null
  wasm: boolean
  /** Tier we would pick, or null → this device should use the server. */
  recommended: Tier | null
  reason: string
}

export function decide(c: Omit<Capabilities, 'recommended' | 'reason'>): Pick<Capabilities, 'recommended' | 'reason'> {
  if (!c.wasm) return { recommended: null, reason: 'This browser cannot run WebAssembly.' }
  if (c.memGB !== null && c.memGB < 2) return { recommended: null, reason: `Only ~${c.memGB} GB of memory — too little for an on-device model.` }
  // Standard wants ~1.6 GB for the model alone, so insist on headroom for the app.
  const roomy = c.memGB === null || c.memGB >= 8
  const fast = c.webgpu || (c.isolated && c.cores >= 6)
  if (roomy && fast) return { recommended: 'standard', reason: c.webgpu ? 'GPU acceleration available.' : 'Fast multi-core CPU.' }
  return { recommended: 'lite', reason: c.webgpu ? 'Lite keeps memory free for your notebook.' : 'No GPU here — Lite stays responsive on the CPU.' }
}

export async function probeCapabilities(): Promise<Capabilities> {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(): Promise<unknown | null> } }
  let webgpu = false
  try {
    webgpu = !!nav.gpu && !!(await nav.gpu.requestAdapter())
  } catch {
    webgpu = false
  }
  const base = {
    webgpu,
    isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    cores: nav.hardwareConcurrency ?? 2,
    memGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    wasm: typeof WebAssembly !== 'undefined',
  }
  return { ...base, ...decide(base) }
}

export const ramNote = (t: Tier) => `≈ ${(estimateRamMB(MODELS[t]) / 1000).toFixed(1)} GB`
