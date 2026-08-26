// Typographic primitives for /docs. Deliberately tiny: the documentation is
// long, so every paragraph, list and reference table in it goes through one
// of these instead of carrying its own class soup. Same design tokens the
// workspace uses (text-ui-* scale, glass surfaces, accent vars), so the
// manual reads as part of the product rather than a bolted-on site.

import { cn } from '@/lib/utils'

export function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-ui-sm leading-[1.75] text-muted-foreground', className)}>{children}</p>
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-ui-md leading-[1.7] text-foreground/90">{children}</p>
}

/** Inline emphasis for a UI label the reader has to find on screen. */
export function UI({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>
}

/** Inline code / expression / file name. */
export function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-[4px] bg-muted px-1 py-px font-mono text-ui-xs text-foreground">
      {children}
    </code>
  )
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="relative pl-4 text-ui-sm leading-[1.7] text-muted-foreground">
          <span
            aria-hidden
            className="absolute left-0 top-[0.6em] h-1 w-1 rounded-full bg-[var(--accent-blue)]"
          />
          {item}
        </li>
      ))}
    </ul>
  )
}

export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-ui-sm leading-[1.7] text-muted-foreground">
          <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--accent-blue)_16%,transparent)] text-ui-2xs font-bold text-[var(--accent-blue)]">
            {i + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  )
}

/** Term → meaning reference list. The workhorse of this manual: almost every
 *  "what is each of these" answer is one of these tables. */
export function Defs({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50">
      {items.map(([term, def], i) => (
        <div key={i} className="grid gap-x-4 gap-y-0.5 px-3.5 py-2.5 sm:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)]">
          <dt className="text-ui-sm font-semibold text-foreground">{term}</dt>
          <dd className="text-ui-sm leading-[1.65] text-muted-foreground">{def}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A dense chip grid — for long inventories (component names, gate types)
 *  where each entry needs a name and nothing else. */
export function Chips({ items }: { items: React.ReactNode[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span
          key={i}
          className="rounded-lg border border-border/60 bg-card/60 px-2 py-1 text-ui-xs text-foreground/80"
        >
          {item}
        </span>
      ))}
    </div>
  )
}

/** A callout. `tone` picks the accent — note (blue), tip (mint), warn (amber). */
export function Callout({
  tone = 'note',
  title,
  children,
}: {
  tone?: 'note' | 'tip' | 'warn'
  title?: string
  children: React.ReactNode
}) {
  const color =
    tone === 'tip' ? 'var(--accent-mint)' : tone === 'warn' ? 'var(--accent-amber)' : 'var(--accent-blue)'
  return (
    <div
      className="rounded-xl border-l-2 bg-card/50 px-3.5 py-3"
      style={{ borderLeftColor: color }}
    >
      {title && (
        <p className="mb-1 text-ui-xs font-bold uppercase tracking-[0.1em]" style={{ color }}>
          {title}
        </p>
      )}
      <div className="space-y-2 text-ui-sm leading-[1.7] text-muted-foreground">{children}</div>
    </div>
  )
}

/** A real table, for the handful of places a grid genuinely beats a list
 *  (the role/permission matrix). */
export function Grid({
  head,
  rows,
}: {
  head: React.ReactNode[]
  rows: React.ReactNode[][]
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/50">
      <table className="w-full border-collapse text-ui-sm">
        <thead>
          <tr className="border-b border-border/50 bg-muted/30">
            {head.map((h, i) => (
              <th
                key={i}
                className={cn(
                  'px-3 py-2 text-left text-ui-xs font-semibold uppercase tracking-wider text-muted-foreground',
                  i > 0 && 'text-center'
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/40 last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    'whitespace-nowrap px-3 py-2',
                    j === 0 ? 'font-medium text-foreground' : 'text-center text-muted-foreground'
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
