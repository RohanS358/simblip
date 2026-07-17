'use client'

// Analysis panel for the DSA Lab: operation counts measured from the actual
// run, the inferred recurrence relation for each recursive function, and a
// heuristic Big-O estimate. Honest labelling — these are measurements of
// this execution, not proofs.

import { useMemo } from 'react'
import { analyzeTrace } from '@/lib/dsa/analysis'
import type { TraceResult } from '@/lib/dsa/trace'

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border/60 px-2.5 py-1.5">
      <span className="font-mono text-[15px] font-semibold" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
      <span className="text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  )
}

export function DsaAnalysisView({ trace }: { trace: TraceResult | null }) {
  const report = useMemo(() => (trace ? analyzeTrace(trace) : null), [trace])

  if (!trace || !report) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
        Run some code to analyze it.
      </div>
    )
  }
  const c = trace.counters

  return (
    <div className="h-full space-y-3 overflow-auto p-3">
      <div>
        <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Measured this run
        </div>
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          <Stat label="comparisons" value={c.comparisons} accent="var(--accent-blue)" />
          <Stat label="assignments" value={c.assignments} accent="var(--accent-amber)" />
          <Stat label="array accesses" value={c.arrayAccesses} />
          <Stat label="swaps" value={c.swaps} />
          <Stat label="function calls" value={c.calls} accent="var(--accent-mint)" />
          <Stat label="loop iterations" value={c.iterations} />
          <Stat label="heap allocations" value={c.allocations} accent="var(--accent-violet)" />
          <Stat label="deletes" value={c.frees} />
        </div>
      </div>

      {report.recurrences.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Recurrence relations · inferred from the call tree
          </div>
          <div className="space-y-2">
            {report.recurrences.map((r) => (
              <div key={r.fn} className="rounded-xl border border-border/60 p-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] font-bold">{r.fn}()</span>
                  <span className="rounded-full bg-[color-mix(in_oklch,var(--accent-mint)_16%,transparent)] px-2 py-0.5 font-mono text-[12px] font-semibold text-foreground">
                    {r.bigO}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[13.5px] text-foreground">{r.formula}</div>
                <div className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
                  {r.sizeNote} · {r.method} · {r.calls} calls, max depth {r.maxDepth}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.loopEstimate && (
        <div>
          <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Iterative estimate
          </div>
          <div className="rounded-xl border border-border/60 p-2.5 text-[11.5px] leading-snug text-foreground">
            {report.loopEstimate}
          </div>
        </div>
      )}

      {report.perFunction.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Work per function
          </div>
          <div className="overflow-hidden rounded-xl border border-border/60">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border/50 bg-muted/30 text-left text-muted-foreground">
                  <th className="px-2.5 py-1 font-medium">function</th>
                  <th className="px-2.5 py-1 text-right font-medium">calls</th>
                  <th className="px-2.5 py-1 text-right font-medium">ops (own work)</th>
                </tr>
              </thead>
              <tbody>
                {report.perFunction.map((f) => (
                  <tr key={f.fn} className="border-b border-border/30 font-mono last:border-0">
                    <td className="px-2.5 py-1">{f.fn}</td>
                    <td className="px-2.5 py-1 text-right">{f.calls}</td>
                    <td className="px-2.5 py-1 text-right">{f.exclusiveOps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="pb-1 text-[9.5px] italic leading-snug text-muted-foreground">
        Estimates are measured from this one execution — vary the input size to sanity-check them.
      </p>
    </div>
  )
}
