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
  /** Why there is (or isn't) GPU acceleration, in words a person can act on. */
  gpuNote: string
  /** WebAssembly JSPI + Memory64: what the GPU build of the runtime needs. */
  modernWasm: boolean
  /** Tier we would pick, or null → this device should use the server. */
  recommended: Tier | null
  reason: string
}

interface GpuAdapterLike {
  isFallbackAdapter?: boolean
  info?: { vendor?: string; architecture?: string; description?: string }
}

/** An adapter that exists is not an adapter that is FAST. Without a working
 *  Vulkan/D3D/Metal driver Chrome still hands out a SOFTWARE rasteriser
 *  (SwiftShader / llvmpipe) as a "WebGPU adapter" — it runs the model on the CPU,
 *  slower than the CPU path, while reporting `gpu`. Measured: 22 tok/s prefill
 *  through SwiftShader vs 40 on the plain CPU build. */
export function isRealGpu(a: GpuAdapterLike | null | undefined): boolean {
  if (!a) return false
  if (a.isFallbackAdapter) return false
  const text = `${a.info?.vendor ?? ''} ${a.info?.architecture ?? ''} ${a.info?.description ?? ''}`.toLowerCase()
  return !/swiftshader|llvmpipe|software|lavapipe|softpipe/.test(text)
}

export function decide(c: Omit<Capabilities, 'recommended' | 'reason' | 'gpuNote' | 'modernWasm'>): Pick<Capabilities, 'recommended' | 'reason'> {
  if (!c.wasm) return { recommended: null, reason: 'This browser cannot run WebAssembly.' }
  if (c.memGB !== null && c.memGB < 2) return { recommended: null, reason: `Only ~${c.memGB} GB of memory — too little for an on-device model.` }
  // Standard wants ~1.6 GB for the model alone, so insist on headroom for the app.
  const roomy = c.memGB === null || c.memGB >= 8
  const fast = c.webgpu || (c.isolated && c.cores >= 6)
  if (roomy && fast) return { recommended: 'standard', reason: c.webgpu ? 'GPU acceleration available.' : 'Fast multi-core CPU.' }
  return { recommended: 'lite', reason: c.webgpu ? 'Lite keeps memory free for your notebook.' : 'No GPU here — Lite stays responsive on the CPU.' }
}

/** Explain a missing GPU. "Hardware acceleration" in a browser's settings only
 *  covers page rendering (2D/WebGL); WebGPU is a separate switch, and on Linux it
 *  is off by default — so a machine can have one on and still report no GPU here. */
export function explainGpu(state: 'no-api' | 'no-adapter' | 'software' | 'no-wasm-support' | 'ok', linux: boolean): string {
  switch (state) {
    case 'ok':
      return 'GPU acceleration is available.'
    case 'no-api':
      return linux
        ? 'This browser does not expose WebGPU (browser "hardware acceleration" is a different switch). In Chrome/Edge/Vivaldi open chrome://flags, enable "Unsafe WebGPU Support" and "Vulkan", then restart the browser.'
        : 'This browser does not expose WebGPU. Update it (Chrome/Edge 113+, Safari 26+), or turn on hardware acceleration in its settings and restart.'
    case 'no-adapter':
      return 'WebGPU is present but the browser was not given a graphics adapter — usually a blocklisted or outdated graphics driver. Update the driver and restart the browser.'
    case 'software':
      return linux
        ? 'Only a software renderer is reachable (SwiftShader), not your graphics card. In chrome://flags enable "Vulkan" and "Unsafe WebGPU Support", then restart the browser.'
        : 'Only a software renderer is reachable, not your graphics card. Update the graphics driver and the browser.'
    case 'no-wasm-support':
      return 'The GPU is reachable, but this browser version lacks WebAssembly features the GPU build needs (JSPI, Memory64). Update to Chrome/Edge/Vivaldi 137 or newer.'
  }
}

export async function probeCapabilities(): Promise<Capabilities> {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number; gpu?: { requestAdapter(): Promise<unknown | null> } }
  const wa = (typeof WebAssembly === 'undefined' ? {} : WebAssembly) as { Suspending?: unknown }
  // JSPI is what lets the GPU build wait on the GPU; without it the runtime wants a
  // separate "compat" build from a CDN, which this app does not ship.
  let memory64 = false
  try {
    new (WebAssembly as unknown as { Memory: new (d: object) => unknown }).Memory({ address: 'i64', initial: BigInt(1) })
    memory64 = true
  } catch {
    memory64 = false
  }
  const modernWasm = typeof wa.Suspending !== 'undefined' && memory64
  let gpu: 'no-api' | 'no-adapter' | 'software' | 'ok' = 'no-api'
  try {
    if (nav.gpu) {
      const adapter = (await nav.gpu.requestAdapter()) as GpuAdapterLike | null
      gpu = !adapter ? 'no-adapter' : isRealGpu(adapter) ? 'ok' : 'software'
    }
  } catch {
    gpu = 'no-adapter'
  }
  const linux = typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)
  const webgpu = gpu === 'ok' && modernWasm
  const base = {
    webgpu,
    isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    cores: nav.hardwareConcurrency ?? 2,
    memGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    wasm: typeof WebAssembly !== 'undefined',
    modernWasm,
    gpuNote: explainGpu(gpu === 'ok' && !modernWasm ? 'no-wasm-support' : gpu, linux),
  }
  return { ...base, ...decide(base) }
}

export const ramNote = (t: Tier) => `≈ ${(estimateRamMB(MODELS[t]) / 1000).toFixed(1)} GB`
