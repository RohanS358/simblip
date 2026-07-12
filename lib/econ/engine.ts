// Engineering-economics cash-flow math. A cash flow is an amount at an
// integer period (negative = outflow/cost, positive = inflow/benefit). The
// interest rate `i` is a fraction per period. Everything else — present
// value, future value, net present value — is discounting on that timeline.

export interface Flow {
  t: number
  amount: number
}

/** Parse "0:-1000; 1:300; 2:300" (period:amount, ; or , separated). */
export function parseFlows(text: string): Flow[] {
  const flows: Flow[] = []
  for (const tok of text.split(/[;,]/)) {
    const mm = /^\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/.exec(tok)
    if (mm) flows.push({ t: Number(mm[1]), amount: Number(mm[2]) })
  }
  return flows.sort((a, b) => a.t - b.t)
}

export const horizon = (flows: Flow[]): number =>
  flows.reduce((n, f) => Math.max(n, f.t), 0)

/** Net present value at t=0: Σ Aₜ / (1+i)ᵗ. */
export function npv(flows: Flow[], i: number): number {
  return flows.reduce((s, f) => s + f.amount / Math.pow(1 + i, f.t), 0)
}

/** Future value at period n (default: horizon): Σ Aₜ (1+i)^(n−t). */
export function fv(flows: Flow[], i: number, n = horizon(flows)): number {
  return flows.reduce((s, f) => s + f.amount * Math.pow(1 + i, n - f.t), 0)
}

/** Running compounded balance of everything up to and including period n. */
export function balanceAt(flows: Flow[], i: number, n: number): number {
  return flows
    .filter((f) => f.t <= n)
    .reduce((s, f) => s + f.amount * Math.pow(1 + i, n - f.t), 0)
}

/** Internal rate of return (NPV = 0), bisection on [-0.99, 10]; null if none. */
export function irr(flows: Flow[]): number | null {
  const f = (r: number) => npv(flows, r)
  let lo = -0.9999
  let hi = 10
  let flo = f(lo)
  const fhi = f(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (Math.abs(fm) < 1e-7) return mid
    if (flo * fm < 0) hi = mid
    else {
      lo = mid
      flo = fm
    }
  }
  return (lo + hi) / 2
}

export const fmtMoney = (v: number): string => {
  const a = Math.abs(v)
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k` : a.toFixed(0)
  return `${v < 0 ? '−' : ''}$${s}`
}
