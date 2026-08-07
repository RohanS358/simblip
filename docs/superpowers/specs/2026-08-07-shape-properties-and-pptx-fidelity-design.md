# Shape/component properties, name labels, presentation viewer mode, and PPTX fidelity

Date: 2026-08-07
Status: approved for planning

## Problem

Four related gaps in the Document/Presentation ("sheet") page kinds, all touching
the same object model and canvas:

1. **No Appearance editing for shapes/components.** The Inspector's
   `ObjectProperties` (components/workspace/inspector.tsx) gives every object
   Transform (position/size/rotation) and kind-specific params, but only
   `text` objects get an Appearance section (fill color, stroke, corner
   radius, opacity, hidden). Every other geometry kind — `rect`, `circle`,
   `polygon`, `line`, `picture`, and every component kind (`formula`,
   `graph`, `chart`, `table`, `slider`, `button`, `trigger`, …) — has no way
   to edit fill/stroke/corner-radius/opacity at all, even though the render
   layer (`components/objects/geometry.tsx`'s `bodyFill()`) already reads
   `metadata.fillColor` / `metadata.strokeColor` / `metadata.strokeWidth` and
   has for some time — the UI to set them was simply never built for
   non-text kinds.

2. **Custom object names aren't shown anywhere on canvas.** `object.name` is
   already editable (top of the Inspector), but nothing renders it near/on
   the object. A renamed shape looks identical to an unnamed one.

3. **Presentation "Present" mode isn't a real slideshow viewer.**
   `PresentOverlay` (components/workspace/presentation-view.tsx) mounts
   `InfiniteCanvas` with `locked` — a prop designed to freeze pan/zoom, not
   to suppress selection. `handleObjectPointerDown` in canvas.tsx always
   selects on pointerdown regardless of `locked`, so clicking any object
   during a live presentation both fires its interactivity (buttons/
   triggers/switches already work) AND selects it, which can surface resize
   handles and selection chrome mid-presentation — never intended for an
   audience-facing view.

4. **PPTX import loses real fidelity.** Root-caused against a real slide
   (see screenshot: title rendered as barely-visible ghost text, a bordered
   label box clipped its own text at both edges, a body paragraph was cut
   off mid-word at the slide edge, and name cards were clipped bottom and
   right):
   - `lib/store/pptx-import.ts` reads only each slide's own XML. It never
     resolves `<p:ph>` placeholder inheritance (slide → slide layout →
     slide master), so any run relying on inherited color/size — the
     overwhelming majority of real PowerPoint title/body text — gets no
     color/size at all and falls through to the app's default text
     styling. This is the direct cause of the near-invisible title.
   - Theme colors (`<a:schemeClr val="...">`) are resolved through a
     hardcoded 10-entry guess table (`SCHEME_FALLBACK`) instead of the
     deck's actual `ppt/theme/theme1.xml` `<a:clrScheme>`, so scheme-colored
     text/fills can come out visibly wrong.
   - `<a:noFill/>` (explicitly transparent) isn't distinguished from "no
     fill specified" — both currently produce no fill, which happens to be
     the right output today only by accident (no fallback fill is ever
     applied).
   - `geometryKindOf()` only ever returns `rect` or `circle` — every other
     `prst` value (rounded rect, triangle, arrows, etc.) collapses to a
     plain rect, losing real shape fidelity.
   - **Box sizing**: imported objects get PowerPoint's stored box
     `x/y/w/h` verbatim (`shapeBox()`), with no re-fit against SIMBLIP's own
     text metrics (different font stack/line-height than PowerPoint's).
     Height self-heals automatically the first time the object mounts
     (`text.tsx`'s grow-only `fit()` effect runs unconditionally on every
     render), but there is **no equivalent for width** — a box imported
     narrower than its actual text requirement stays that width forever,
     clipping content horizontally exactly as seen in the screenshot
     (mid-word clipping in the title box, paragraph cut off at the slide's
     right edge).
   - Export (`lib/store/pptx-export.ts`) doesn't carry `cornerRadius` or
     `opacity` through, so styling added via the new Appearance panel
     (item 1) would silently vanish on export.

## Non-goals

- Pixel-perfect PPTX fidelity (gradients, patterns, tables, charts,
  SmartArt, animations, transitions) — explicitly out of scope, matching
  the existing "best-effort" framing in pptx-import.ts's own header comment.
- Changing how canvas objects other than text/shapes render their own card
  chrome (formula/graph/table/etc. keep their existing rounded-card look;
  they only gain opacity/hidden, not fill/stroke/corner-radius, since those
  would fight their built-in styling — see Design §1).
- Full theme/master resolution beyond color scheme + placeholder
  inheritance (e.g. we still won't resolve inherited paragraph
  indent/spacing rules beyond what's already reconstructed today).

## Design

### 1. Shared `AppearanceSection` in the Inspector

Extract the fill/stroke/corner-radius/opacity/hidden controls currently
built inline inside `TextObjectPanel` (components/workspace/inspector.tsx)
into a standalone `AppearanceSection({ pageId, object })` component. Render
it from `ObjectProperties` for every geometry kind, with fields gated by
kind:

| Kind | Fill | Stroke color | Stroke width | Corner radius | Opacity | Hidden |
|---|---|---|---|---|---|---|
| rect | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| circle | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| polygon | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| line | — | ✓ (line color) | ✓ | — | ✓ | ✓ |
| picture | — | ✓ (border) | ✓ | ✓ (clip) | ✓ | ✓ |
| text | (existing, unchanged) | | | | | |
| all components (formula/graph/chart/table/slider/button/trigger/…) | — | — | — | — | ✓ | ✓ |

All fields write to the same `object.metadata.*` keys `bodyFill()` already
reads (`fillColor`, `strokeColor`, `strokeWidth`) plus `cornerRadius`,
`opacity`, `hidden` (already read by text.tsx/canvas.tsx's `ObjectWrapper`
for those three). No new metadata keys for shapes — `cornerRadius` needs
adding to `geometry.tsx`'s rect render path (currently ignores it; text.tsx
already reads it at metadata.cornerRadius).

### 2. Name-as-label

`ObjectWrapper` (components/workspace/canvas.tsx) renders a small label
above the object's bounding box when `object.name` differs from the
kind's auto-generated default pattern (e.g. `/^(Circle|Rect|Polygon|Line)\s+\d+$/`
— reuse whatever naming convention `baseObject()`/factory already applies).
Label only renders in edit mode, not during Present (§3) — it's an editor
affordance, not slide content.

### 3. `viewer` mode on `InfiniteCanvas`

Add a `viewer?: boolean` prop, passed only from `PresentOverlay`. When set:
- `handleObjectPointerDown` skips selection entirely and does not call
  `setSelection` — falls straight to the existing `!editing` interactivity
  branch (button/trigger/switch clicks keep working, since that codepath
  doesn't depend on selection).
- `ObjectWrapper` never renders selection ring, resize handles, or the
  name label (§2), regardless of store selection state.
- Replaces the current (incidental) reuse of `locked` for this purpose —
  `locked` keeps its original pan/zoom-freeze meaning; `viewer` is
  additive and orthogonal.

### 4. PPTX import/export fidelity

In priority order (each independently shippable, but bundled here since
they touch the same file):

1. **Placeholder inheritance.** When a run has no explicit color/size,
   resolve it from the slide's matching layout placeholder
   (`ppt/slideLayouts/slideLayoutN.xml`, matched by `<p:ph type/idx>`), then
   the slide master if the layout also has none. Read the layout/master XML
   alongside the slide's own (new `loadSlideLayoutChain()` helper,
   mirroring `loadSlideRels()`'s pattern).
2. **Real theme colors.** Parse `ppt/theme/theme1.xml`'s `<a:clrScheme>`
   once per deck and use it in `solidFillColor()`'s scheme-color branch
   instead of `SCHEME_FALLBACK`, keeping the current table only as a
   last-resort default if theme parsing fails.
3. **`<a:noFill/>` handling.** Treat explicit `noFill` as "definitely no
   fill" distinct from "unspecified," so future fallback-fill logic (if any
   is ever added) can't misfire on shapes that were deliberately
   transparent.
4. **Shape kind expansion.** Map common `prst` values (`roundRect`,
   `triangle`, arrow variants) onto `polygon` with computed points, instead
   of collapsing everything non-ellipse to `rect`.
5. **Width fit on import.** After building each slide's objects, do one
   pass that measures each text/note box's actual required width (reuse
   the same measurement approach as text.tsx's `fit()`, or a headless
   equivalent) and widens the box if the source width is too narrow for
   its content — mirrors the existing grow-only height autosize, applied to
   width, import-only.
6. **Export round-trip.** Carry `metadata.cornerRadius` and
   `metadata.opacity` through in `pptx-export.ts`'s shape/text branches so
   Appearance-panel styling (§1) survives an export → re-import cycle.

## Testing

- Manual: import a real-world .pptx with title/body placeholders that rely
  on inherited styling (the deck behind the screenshot, if available) and
  confirm text is visible and correctly sized/positioned.
- Manual: select each geometry kind on a Document/Presentation page,
  confirm Appearance controls appear/don't appear per the table in §1 and
  visibly change the rendered object.
- Manual: rename an object, confirm the label appears on canvas in edit
  mode and disappears in Present mode.
- Manual: place a Button/Trigger/switch on a slide, enter Present mode,
  confirm it's clickable with zero selection chrome ever appearing.
- Manual: round-trip export → re-import a deck styled via the new
  Appearance panel; corner radius and opacity should survive.
