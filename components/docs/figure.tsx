// Screenshots for /docs.
//
// Every figure is captured from the REAL app by scripts/capture-docs.mjs —
// a local-mode notebook driven with Playwright — so a figure here is the
// product, not a drawing of it. Each is shot twice, light and dark, and the
// pair is swapped with Tailwind's `dark:` variant (globals.css maps that to
// every dark-family theme), so the manual matches whatever theme the reader
// is actually using.

import { cn } from '@/lib/utils'

/** Intrinsic sizes of the captured WebPs — set on the <img> so a page of
 *  figures does not reflow as they decode. */
const SIZES: Record<string, [number, number]> = {
  workspace: [1600, 1000],
  'add-page': [1024, 516],
  dock: [1000, 144],
  transport: [434, 56],
  settings: [1600, 1320],
  dsa: [1600, 1191],
  'circuit-parts': [1280, 520],
  'sim-before': [1240, 1280],
  'sim-during': [1240, 1280],
  'sim-after': [1240, 1280],
  'panel-notebook': [916, 1600],
  'panel-components': [916, 1600],
  'panel-tools': [916, 1600],
  'panel-assistant': [916, 1600],
  'panel-library': [916, 1600],
  'panel-uploads': [916, 1600],
  'panel-properties': [916, 1600],
}

/** Everything was captured at deviceScaleFactor 2, so half the pixel width is
 *  the figure's native CSS size. Displaying above that upscales a screenshot
 *  and it goes soft — the transport strip is 217px wide, not 880. */
const nativeWidth = (name: string) => (SIZES[name]?.[0] ?? 1600) / 2

function Shot({ name, alt, className }: { name: string; alt: string; className?: string }) {
  const [w, h] = SIZES[name] ?? [1600, 1000]
  const common = cn('h-auto w-full rounded-lg', className)
  return (
    <>
      <img src={`/docs/${name}-light.webp`} alt={alt} width={w} height={h} loading="lazy" decoding="async" className={cn(common, 'dark:hidden')} />
      <img src={`/docs/${name}-dark.webp`} alt={alt} width={w} height={h} loading="lazy" decoding="async" className={cn(common, 'hidden dark:block')} />
    </>
  )
}

/**
 * One screenshot with its caption.
 * `tall` constrains the very tall sidebar-panel shots so they do not take
 * over the page — they stay legible at a couple of hundred pixels wide.
 */
export function Figure({
  name,
  alt,
  caption,
  tall = false,
}: {
  name: string
  alt: string
  caption: React.ReactNode
  tall?: boolean
}) {
  return (
    <figure className="my-5">
      <div
        className={cn('overflow-hidden rounded-xl border border-border/60 bg-card/40 p-2', 'mx-auto')}
        style={{ maxWidth: tall ? '19rem' : nativeWidth(name) }}
      >
        <Shot name={name} alt={alt} />
      </div>
      <figcaption className="mt-2 text-ui-xs leading-relaxed text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  )
}

/** A strip of frames from one run — the way a still image shows motion. */
export function FigureRow({
  items,
  caption,
}: {
  items: { name: string; alt: string; label: string }[]
  caption: React.ReactNode
}) {
  return (
    <figure className="my-5">
      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.name}
            className="mx-auto w-full overflow-hidden rounded-xl border border-border/60 bg-card/40 p-2"
            style={{ maxWidth: nativeWidth(it.name) }}
          >
            <Shot name={it.name} alt={it.alt} />
            <p className="mt-1.5 text-center text-ui-2xs font-medium uppercase tracking-wider text-muted-foreground">
              {it.label}
            </p>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-ui-xs leading-relaxed text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  )
}
