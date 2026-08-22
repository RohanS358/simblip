"use client";

// Component palette — the sidebar's "Components" section. A component is
// just geometry + pre-attached behaviors — the user can always build the
// same thing by drawing and converting. Click a component, then click the
// canvas to place it (stays armed).
//
// This used to float as its own popup pinned to the dock (tracking the
// dock's side via useDockRect); it's a browser (domain tabs, scrollable
// grid), and browsers belong in the sidebar, not a flyout — see
// docs/ui-simplification-plan.md §3/§4. It now renders inline, filling
// whatever container the sidebar gives it.

import { useMemo, useState } from "react";
import { motion as fm, AnimatePresence } from "framer-motion";
import { Check, Search, Shapes, SlidersHorizontal, X } from "lucide-react";
import { useSpring } from "@/lib/motion";
import { COMPONENTS } from "@/lib/scene/factory";
import { useDocStore } from "@/lib/store/document";
import { usePrefs } from "@/lib/store/preferences";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PanelHeader } from "./panel-header";
import { ComponentIcon } from "./component-icons";
import { cn } from "@/lib/utils";

// Stable empty reference — see components/objects/table.tsx.
const EMPTY_PACKAGES: Record<string, unknown> = Object.freeze({});

// A package is the unit the user actually installs and reasons about, so it
// carries a colour of its own. Each supplies only a HUE ANGLE — lightness and
// chroma come from --pkg-l / --pkg-c, which every theme defines from its own
// --accent-blue (app/globals.css). One hue, twelve themes, always legible.
const DOMAINS = [
  { id: "mechanics", label: "Mechanics", hue: 255 },
  { id: "electrical", label: "Electrical", hue: 80 },
  { id: "electronics", label: "Electronics", hue: 145 },
  { id: "digital", label: "Digital", hue: 295 },
  { id: "optics", label: "Optics", hue: 200 },
  { id: "waves", label: "Waves", hue: 330 },
  { id: "quantum", label: "Quantum", hue: 270 },
  { id: "economics", label: "Economics", hue: 165 },
  { id: "dsa", label: "DSA", hue: 25 },
] as const;

type DomainId = (typeof DOMAINS)[number]["id"];

const DOMAIN_LABEL: Record<DomainId, string> = Object.fromEntries(
  DOMAINS.map((d) => [d.id, d.label]),
) as Record<DomainId, string>;

const DOMAIN_HUE: Record<DomainId, number> = Object.fromEntries(
  DOMAINS.map((d) => [d.id, d.hue]),
) as Record<DomainId, number>;

/** A package's colour at full strength — for icons, dots and rules. */
const pkgColor = (id: string) =>
  `oklch(var(--pkg-l) var(--pkg-c) ${DOMAIN_HUE[id as DomainId] ?? 255})`;

/** The same colour as a wash, for armed tiles. `pct` is 0-100. */
const pkgTint = (id: string, pct: number) =>
  `color-mix(in oklch, ${pkgColor(id)} ${pct}%, transparent)`;

/** Search + a package filter, same pattern as the Institution Library: a query
 *  box and a multi-select popover, both narrowing the same list. Results are
 *  grouped by package, each with its own colour, because "which package is
 *  this part from" is the question a user actually asks of this panel. */
export function Palette() {
  const packages = usePrefs((s) => s.packages ?? EMPTY_PACKAGES);
  const [doms, setDoms] = useState<Set<DomainId>>(() => new Set());
  const [query, setQuery] = useState("");
  const tool = useDocStore((s) => s.tool);
  const toolOption = useDocStore((s) => s.toolOption);
  const setTool = useDocStore((s) => s.setTool);

  const activeDomains = useMemo(
    () => DOMAINS.filter((d) => packages[d.id] !== false),
    [packages],
  );

  // Search first, filter second — so the count beside each package in the
  // popover always matches what selecting it would actually show.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMPONENTS.filter((c) => packages[c.domain] !== false).filter(
      (c) => !q || c.label.toLowerCase().includes(q),
    );
  }, [query, packages]);

  // Packages the user disabled in prefs can linger in `doms` from a previous
  // session; ignore those rather than filtering everything away.
  const live = useMemo(
    () => new Set([...doms].filter((d) => packages[d] !== false)),
    [doms, packages],
  );

  const groups = useMemo(() => {
    return activeDomains
      .filter((d) => live.size === 0 || live.has(d.id))
      .map((d) => ({ ...d, items: searched.filter((c) => c.domain === d.id) }))
      .filter((g) => g.items.length > 0);
  }, [activeDomains, live, searched]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      aria-label="Component palette"
    >
      <PanelHeader
        icon={Shapes}
        title="Components"
        accent="var(--accent-amber)"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components…"
            className="h-8 pl-8 text-ui-sm"
          />
        </div>

        {/* Nine packages never fit a ~240px panel, so the old chip row scrolled
            sideways and everything past the third was invisible until you
            dragged. One popover shows them all, and multi-select means you can
            hold two packages side by side instead of flipping between them. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-ui-xs",
                  "transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.97]",
                  live.size > 0
                    ? "border-[var(--accent-blue)]/40 bg-[color-mix(in_oklch,var(--accent-blue)_12%,transparent)] text-foreground"
                    : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="h-3 w-3 shrink-0" />
                {live.size === 0 ? "All packages" : `${live.size} selected`}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-1">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-ui-2xs font-medium text-muted-foreground">
                  Packages
                </span>
                {live.size > 0 && (
                  <button
                    type="button"
                    className="text-ui-2xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                    onClick={() => setDoms(new Set())}
                  >
                    Clear
                  </button>
                )}
              </div>
              {activeDomains.map((d) => {
                const on = live.has(d.id);
                const n = searched.filter((c) => c.domain === d.id).length;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() =>
                      setDoms((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-ui-xs transition-colors duration-150 hover:bg-accent"
                  >
                    <span
                      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-150"
                      style={
                        on
                          ? {
                              borderColor: pkgColor(d.id),
                              backgroundColor: pkgColor(d.id),
                              color: "white",
                            }
                          : { borderColor: pkgColor(d.id) }
                      }
                    >
                      {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{d.label}</span>
                    <span className="shrink-0 text-ui-2xs tabular-nums text-muted-foreground">
                      {n}
                    </span>
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
          {/* Selected packages stay visible outside the popover, each its own
              remove target — otherwise a filter set two minutes ago silently
              explains a short list. */}
          {[...live].map((d) => (
            <button
              key={d}
              type="button"
              aria-label={`Remove ${DOMAIN_LABEL[d]} filter`}
              onClick={() =>
                setDoms((prev) => {
                  const next = new Set(prev);
                  next.delete(d);
                  return next;
                })
              }
              className="group flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-ui-2xs transition-colors duration-150"
              style={{ backgroundColor: pkgTint(d, 14), color: pkgColor(d) }}
            >
              {DOMAIN_LABEL[d]}
              <X className="h-2.5 w-2.5 opacity-50 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </PanelHeader>

      <div className="@container min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {groups.map((g) => (
          <section key={g.id} className="mb-3 last:mb-0">
            {/* The package rule doubles as the colour key: this hue, from here
                down, is what every tile in the group is tinted with. */}
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: pkgColor(g.id) }}
              />
              <h3
                className="text-ui-2xs font-medium"
                style={{ color: pkgColor(g.id) }}
              >
                {g.label}
              </h3>
              <span className="text-ui-2xs tabular-nums text-muted-foreground">
                {g.items.length}
              </span>
              <span
                className="ml-1 h-px flex-1"
                style={{ backgroundColor: pkgTint(g.id, 25) }}
              />
            </div>

            <div className="grid auto-rows-min grid-cols-3 gap-1.5">
              {g.items.map((c) => {
                const armed = tool === "place" && toolOption === c.id;
                return (
                  // Same hover assist as the sidebar rail (RailButton in
                  // sidebar.tsx): the app's Tooltip, not a native title —
                  // consistent styling, and it appears immediately instead of
                  // after the OS delay. It carries the whole weight below the
                  // container-query breakpoint, where the label is hidden.
                  <Tooltip key={c.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-pressed={armed}
                        // Every tile carries a whisper of its package's colour at
                        // rest — a faint border and wash — so a mixed grid reads as
                        // grouped even where a section header has scrolled off.
                        // Arming raises the SAME hue to full strength, so the
                        // selected state is an intensity step, not a new colour.
                        // Hover/armed variants come off CSS vars rather than more
                        // inline styles, since inline styles have no hover.
                        style={
                          {
                            "--pk": pkgColor(c.domain),
                            "--pk-wash": pkgTint(c.domain, 5),
                            "--pk-wash-hover": pkgTint(c.domain, 11),
                            "--pk-wash-armed": pkgTint(c.domain, 16),
                            "--pk-line": pkgTint(c.domain, 28),
                            "--pk-line-hover": pkgTint(c.domain, 55),
                          } as React.CSSProperties
                        }
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-ui-xs",
                          "transition-[color,background-color,border-color,transform] duration-150 ease-strong active:scale-[0.97]",
                          armed
                            ? "border-[color:var(--pk)] bg-[var(--pk-wash-armed)] text-foreground"
                            : "border-[color:var(--pk-line)] bg-[var(--pk-wash)] text-muted-foreground hover:border-[color:var(--pk-line-hover)] hover:bg-[var(--pk-wash-hover)] hover:text-foreground",
                        )}
                        onClick={() =>
                          setTool(
                            armed ? "select" : "place",
                            armed ? null : c.id,
                          )
                        }
                      >
                        <span
                          className={cn(
                            "flex h-9 w-full items-center justify-center px-1 text-[color:var(--pk)]",
                            !armed && "opacity-80",
                          )}
                        >
                          <ComponentIcon def={c} />
                        </span>
                        {/* Below ~14rem of panel a three-up grid leaves ~60px per
                        tile, where "Potentiometer" clips and "3-Phase Induction
                        Motor" runs to three lines. The icon is what identifies a
                        part anyway, so the label drops out and the title
                        attribute carries the name. Above that it stays, wrapping
                        to at most two lines instead of overflowing. */}
                        <span className="line-clamp-2 break-words text-center font-medium leading-tight @max-[14rem]:hidden">
                          {c.label}
                        </span>
                        {/* The package is now the group header, so a per-tile tag
                        would just repeat it. "symbol" still matters — it says
                        this part draws but doesn't simulate. */}
                        {!c.live && (
                          <span className="text-ui-3xs uppercase tracking-wide opacity-60 @max-[14rem]:hidden">
                            symbol
                          </span>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-ui-xs">
                      {c.live ? c.label : `${c.label} · symbol`}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </section>
        ))}

        {total === 0 && (
          <p className="py-8 text-center text-ui-sm leading-relaxed text-muted-foreground">
            {query.trim() ? (
              <>No components match “{query}”.</>
            ) : (
              "No components in the selected packages."
            )}
          </p>
        )}
      </div>

      {tool === "place" && (
        <p className="border-t border-border/60 py-1.5 text-center text-ui-xs text-muted-foreground">
          Click the canvas to place · Esc to stop
        </p>
      )}
    </div>
  );
}

/**
 * The pre-sidebar floating popup, kept only for surfaces that don't have a
 * sidebar rail to dock into — the room-board presenter (app/board/page.tsx)
 * is a kiosk-style view with its own top-bar controls, not the notebook
 * shell, so it still opens the palette as a dock-anchored flyout.
 */
export function FloatingPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const motion = useSpring();
  const dockPref = usePrefs((s) => s.notebook.dock);
  // Same mobile override as the dock itself (canvas-controls.tsx/toolbar.tsx)
  // — this flyout has to slide out of whichever side the dock is actually
  // rendering on, not the raw desktop preference.
  const isMobile = useIsMobile();
  const dock =
    isMobile && (dockPref === "left" || dockPref === "right")
      ? "bottom"
      : dockPref;
  const vertical = dock === "left" || dock === "right";
  // Grow out of the dock rather than up from the floor.
  const slideFrom =
    dock === "left"
      ? { x: -16, y: 0 }
      : dock === "right"
        ? { x: 16, y: 0 }
        : dock === "top"
          ? { x: 0, y: -16 }
          : { x: 0, y: 16 };

  return (
    <AnimatePresence>
      {open && (
        <fm.div
          initial={{ ...slideFrom, opacity: 0, scale: 0.96 }}
          animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          exit={{ ...slideFrom, opacity: 0, scale: 0.96 }}
          transition={motion}
          className={cn(
            "glass-strong absolute z-40 max-h-[70vh] rounded-2xl",
            vertical
              ? "top-1/2 w-[min(22rem,calc(100vw-6rem))] -translate-y-1/2 overflow-y-auto"
              : "left-1/2 w-[min(26rem,calc(100vw-1rem))] -translate-x-1/2",
            dock === "bottom" && "bottom-20",
            dock === "top" && "top-20",
            dock === "left" && "left-20",
            dock === "right" && "right-20",
          )}
          aria-label="Component palette"
        >
          <div className="flex items-center justify-end px-2 pt-2">
            <button
              type="button"
              aria-label="Close palette"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Palette />
        </fm.div>
      )}
    </AnimatePresence>
  );
}
