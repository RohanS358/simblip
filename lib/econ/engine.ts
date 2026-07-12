// Engineering-economics cash-flow math. The card holds a structured spec
// (discrete investments, annuities, salvage, MARR) rather than a raw string,
// so the Inspector can edit it as real fields. Times are in years and may be
// fractional ("1/2" = semiannual, "1/4" = quarterly); the interest rate is
// compounded per year, so a flow at t = 0.5 discounts by (1+i)^0.5.

export interface Discrete {
  t: number
  amount: number // + = inflow (up arrow), − = outflow (down arrow)
}

export interface Annuity {
  start: number // first payment lands at start + every
  periods: number // duration in years after start
  every: number // spacing between payments (1 = yearly, 0.5 = semiannual)
  amount: number
}

export interface CashflowSpec {
  description: string
  marr: number // percent per year
  discrete: Discrete[]
  annuities: Annuity[]
  salvage: number // received at the analysis horizon (0 = none)
}

export const EMPTY_SPEC: CashflowSpec = {
  description: '',
  marr: 8,
  discrete: [{ t: 0, amount: -1000 }],
  annuities: [{ start: 0, periods: 4, every: 1, amount: 300 }],
  salvage: 0,
}

/** "1/2", "0.25", "3" → number. Blank/invalid → fallback. */
export function parseYear(s: string, fallback = 0): number {
  const t = s.trim()
  if (!t) return fallback
  const frac = /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t)
  if (frac) {
    const d = Number(frac[2])
    return d === 0 ? fallback : Number(frac[1]) / d
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : fallback
}

/** Pretty-print a year the way it was likely typed (0.5 → "1/2"). */
export function fmtYear(v: number): string {
  const known: [number, string][] = [[0.5, '1/2'], [0.25, '1/4'], [0.75, '3/4'], [1 / 3, '1/3']]
  for (const [n, s] of known) if (Math.abs(v - n) < 1e-9) return s
  return String(Number(v.toFixed(4)))
}

export function readSpec(json: string): CashflowSpec {
  try {
    const p = JSON.parse(json) as Partial<CashflowSpec>
    return {
      description: p.description ?? '',
      marr: Number.isFinite(p.marr) ? (p.marr as number) : 8,
      discrete: Array.isArray(p.discrete) ? p.discrete : [],
      annuities: Array.isArray(p.annuities) ? p.annuities : [],
      salvage: Number.isFinite(p.salvage) ? (p.salvage as number) : 0,
    }
  } catch {
    return { ...EMPTY_SPEC }
  }
}

export interface Flow {
  t: number
  amount: number
  kind: 'discrete' | 'annuity' | 'salvage'
}

/** The analysis horizon: the last year anything happens. */
export function horizonOf(spec: CashflowSpec): number {
  let n = 0
  for (const d of spec.discrete) n = Math.max(n, d.t)
  for (const a of spec.annuities) n = Math.max(n, a.start + a.periods)
  return Math.max(n, 1)
}

/** Expand the spec into the individual arrows on the timeline. Payments that
 *  land on the same instant are merged so the diagram stays readable. */
export function expandFlows(spec: CashflowSpec): Flow[] {
  const out: Flow[] = []
  for (const d of spec.discrete) if (d.amount) out.push({ t: d.t, amount: d.amount, kind: 'discrete' })
  for (const a of spec.annuities) {
    const every = a.every > 0 ? a.every : 1
    const count = Math.floor(a.periods / every + 1e-9)
    for (let k = 1; k <= count; k++) {
      if (!a.amount) break
      out.push({ t: Number((a.start + k * every).toFixed(6)), amount: a.amount, kind: 'annuity' })
    }
  }
  if (spec.salvage) out.push({ t: horizonOf(spec), amount: spec.salvage, kind: 'salvage' })

  const merged = new Map<number, Flow>()
  for (const f of out) {
    const cur = merged.get(f.t)
    if (cur) cur.amount += f.amount
    else merged.set(f.t, { ...f })
  }
  return [...merged.values()].sort((a, b) => a.t - b.t)
}

const disc = (amount: number, i: number, t: number) => amount / Math.pow(1 + i, t)

/** Present worth at t = 0 (this is also the NPV at the MARR). */
export const presentWorth = (flows: Flow[], i: number) =>
  flows.reduce((s, f) => s + disc(f.amount, i, f.t), 0)

/** Future worth at the horizon. */
export const futureWorth = (flows: Flow[], i: number, n: number) =>
  presentWorth(flows, i) * Math.pow(1 + i, n)

/** Capital recovery factor (A/P, i, n). */
export const capitalRecoveryFactor = (i: number, n: number) =>
  i === 0 ? 1 / n : (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)

/** Annual worth — the equivalent uniform yearly amount. */
export const annualWorth = (flows: Flow[], i: number, n: number) =>
  presentWorth(flows, i) * capitalRecoveryFactor(i, n)

/** Compounded value of everything that has happened up to (and at) time t. */
export const valueAt = (flows: Flow[], i: number, t: number) =>
  flows.filter((f) => f.t <= t + 1e-9).reduce((s, f) => s + f.amount * Math.pow(1 + i, t - f.t), 0)

/** Capital recovery: the yearly cost of owning the asset.
 *  CR = (P − S)(A/P, i, n) + S·i, with P the initial cost and S the salvage. */
export function capitalRecovery(spec: CashflowSpec, i: number): number {
  const n = horizonOf(spec)
  const P = -spec.discrete.filter((d) => d.amount < 0).reduce((s, d) => s + d.amount, 0)
  const S = spec.salvage
  if (P === 0) return 0
  return (P - S) * capitalRecoveryFactor(i, n) + S * i
}

/** Benefit/cost ratio: PW of the inflows ÷ PW of the outflows. */
export function benefitCost(flows: Flow[], i: number): number | null {
  const b = flows.filter((f) => f.amount > 0).reduce((s, f) => s + disc(f.amount, i, f.t), 0)
  const c = -flows.filter((f) => f.amount < 0).reduce((s, f) => s + disc(f.amount, i, f.t), 0)
  return c > 0 ? b / c : null
}

/** Internal rate of return (PW = 0), bisection; null when there's no sign change. */
export function irr(flows: Flow[]): number | null {
  const f = (r: number) => presentWorth(flows, r)
  let lo = -0.9999
  let hi = 10
  let flo = f(lo)
  const fhi = f(hi)
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null
  for (let k = 0; k < 120; k++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (Math.abs(fm) < 1e-8) return mid
    if (flo * fm < 0) hi = mid
    else {
      lo = mid
      flo = fm
    }
  }
  return (lo + hi) / 2
}

export interface Metrics {
  pw: number
  fw: number
  aw: number
  irr: number | null
  cr: number
  bc: number | null
  n: number
}

export function metrics(spec: CashflowSpec): Metrics {
  const i = spec.marr / 100
  const flows = expandFlows(spec)
  const n = horizonOf(spec)
  return {
    pw: presentWorth(flows, i),
    fw: futureWorth(flows, i, n),
    aw: annualWorth(flows, i, n),
    irr: irr(flows),
    cr: capitalRecovery(spec, i),
    bc: benefitCost(flows, i),
    n,
  }
}

export const fmtMoney = (v: number): string => {
  const a = Math.abs(v)
  const s =
    a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}k` : a.toFixed(a < 100 ? 1 : 0)
  return `${v < 0 ? '−' : ''}$${s}`
}
