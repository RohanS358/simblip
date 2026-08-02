# SIMBLIP — UX Masterplan

*A grounded first-principles blueprint: the ideal interaction model for a browser-based physics
simulation notebook, cross-referenced against the actual codebase as of 2026-08. Companion to
`docs/design-system.md`, `docs/architecture.md` and `docs/ui-simplification-plan.md` — this
document supersedes none of them; it is the layer above that explains **why**, judges what's
already right, and specifies what still needs to change.*

## How to read this

Every section states the ideal first, reasoned from HCI theory, then a verdict against the real
app:

- **KEEP** — the current implementation already *is* the first-principles answer. Cited by file.
  Do not touch it; re-deriving it from scratch would waste effort re-arriving at the same place.
- **CHANGE** — there's a real gap between the ideal and what ships. Concrete, file-level spec.
- **ADD** — nothing exists yet; net-new surface, specified to be implementation-ready.

SIMBLIP is not a blank slate. `lib/motion.ts` already argues for under-damped springs from first
principles. `docs/ui-simplification-plan.md` already cut the dock from a sprawling toolbar to 11
items and turned the sidebar into a rail-plus-one-open-section. `components/workspace/tutorial.tsx`
already teaches by having the learner build a real spring–mass oscillator on their own blank page
instead of watching a slideshow. Pretending none of that exists and re-inventing a generic
Figma-clone would be a worse document than one that tells you exactly where the remaining leverage
is.

## Contents

1. [Overall UX Philosophy](#1-overall-ux-philosophy)
2. [Information Architecture](#2-information-architecture)
3. [Canvas Experience](#3-canvas-experience)
4. [Every Panel](#4-every-panel)
5. [Toolbar Redesign](#5-toolbar-redesign)
6. [Dock System](#6-dock-system)
7. [Properties Panel](#7-properties-panel)
8. [Tool System](#8-tool-system)
9. [Text System](#9-text-system)
10. [Context Menus](#10-context-menus)
11. [Gestures](#11-gestures)
12. [Keyboard Shortcut Philosophy](#12-keyboard-shortcut-philosophy)
13. [Object Creation Workflow](#13-object-creation-workflow)
14. [Simulation Workflow](#14-simulation-workflow)
15. [Error Prevention](#15-error-prevention)
16. [Accessibility](#16-accessibility)
17. [Performance UX](#17-performance-ux)
18. [Collaboration UX](#18-collaboration-ux)
19. [AI Integration](#19-ai-integration)
20. [Mobile & Tablet Experience](#20-mobile--tablet-experience)
21. [Microinteractions](#21-microinteractions)
22. [Visual Language](#22-visual-language)
23. [Cognitive Load Audit](#23-cognitive-load-audit)
24. [Complete Beginner Learning Experience](#24-complete-beginner-learning-experience)
25. [First-Time User Journey](#25-first-time-user-journey)
26. [Expert Mode](#26-expert-mode)
27. [UX Critique — ranked](#27-ux-critique--ranked)

**Quick index — every CHANGE/ADD spec, in one place:** recents+favorites (§2), breadcrumb tooltip
(§2), mini-map (§3), alignment guides (§3), dead layout.ts flexibility (§4), notification badge
counts (§4), toolbar overflow policy (§5), behavior param tiering (§7, the single highest-leverage
item — see §23, §27), physics validation (§7, §15), measurement tool (§8), inline math in text (§9),
context-menu smart ordering (§10), two-finger tap + rotate gesture (§11), shortcut registry (§12),
pre-Play sanity warnings (§15), color-redundant state icons (§16), audible event log (§16), loading
skeleton (§17), annotation-overlay review (§18), AI draft rationale (§19), tablet gesture priority
(§20), haptics scoped to Android (§21), sound kept off by default (§21), accent-contrast audit
(§22), tutorial difficulty pill (§24), workflow + teaching tutorial courses (§24), **auto-open
tutorial on first Welcome page (§25 — do this first, see §27)**, usage-derived Advanced-tier
disclosure (§26).

---

# 1. Overall UX Philosophy

**The ideal.** The philosophy question for a simulation notebook is different from the philosophy
question for a design tool. Figma's chrome can stay invisible because the *content* — a rectangle,
a color — carries no intellectual weight of its own; all the cognitive work is compositional. In
SIMBLIP the content (a spring–mass system, a Kirchhoff loop, a derivative) carries real intellectual
weight that the learner is trying to acquire. So "the UI disappears" cannot mean "the UI is thin" —
it must mean **the UI never competes with the physics for attention**. Every chrome decision is
graded against one question: *does this pull eyes away from the thing the student is trying to
understand right now?*

This reframes several classic HCI heuristics for this specific domain:

- **Recognition over recall (Nielsen)** applies to *tools*, not to *physics*. A student should never
  have to recall which icon means "spring" — but they SHOULD have to recall (i.e., actively
  retrieve) that F = -kx, because that retrieval *is* the learning. A UI that auto-fills physics
  answers is optimizing the wrong heuristic.
- **Direct manipulation (Shneiderman)** is the load-bearing principle of the whole product, more
  than in a typical creative tool, because manipulating the *simulated object itself* is the
  pedagogy — dragging a mass and watching a spring stretch teaches Hooke's Law faster than reading
  about it. Every property that CAN be a drag/scrub gesture on the canvas should be, before it's a
  sidebar field.
- **Progressive disclosure** has a domain-specific shape here: disclose by *physics sophistication*,
  not just by "beginner vs. expert" UI complexity. A student in the mechanics unit and a student in
  circuits are both "beginners" globally but need entirely different vocabularies surfaced.

**Emotional target.** First-time users should feel *curious, not intimidated* — the blank canvas
plus a pulsing spotlight ring (already how `tutorial.tsx` works) says "try it" rather than "read
this." Returning users should feel *fluent* — muscle memory for tool switches (`P`, `E`, `N`...),
spatial memory for where their notebooks live. Experts (teachers building a lesson, power students)
should feel like they're operating an instrument, not filling out a form — this is where the
scrub-to-edit `ExprInput` pattern in `components/workspace/inspector.tsx` earns its keep: once
learned, it's faster than tabbing through form fields.

**Verdict.**
- **KEEP** — the "instrument, not engineering software" instinct is already encoded: pastel accent
  system reserved for *state* not decoration (`docs/design-system.md`), motion restricted to chrome
  only ("nothing on the canvas itself animates except physics" — same doc), and the geometry+behavior
  separation in `lib/scene/types.ts`/`lib/behaviors/registry.ts` which is exactly what lets a shape
  stay just a shape until the student *chooses* to make it physical — that choice-to-convert moment
  IS the "aha" the philosophy should protect.
- **CHANGE** — nowhere in the codebase is this philosophy written down as a decision filter for
  *future* features (it lives as scattered code comments). Add a one-page `docs/ux-philosophy.md`
  (or fold this section in verbatim) that every future PR touching `components/workspace/` or
  `components/objects/` is checked against — specifically the "does this compete with the physics
  for attention" test — so it survives past this document into day-to-day review.

---

# 2. Information Architecture

**The ideal for a notebook-shaped product.** The three real IA questions are: (1) where do I find
a thing I made before, (2) where do I put a new thing, (3) what's the relationship between things
(this page belongs to this lesson belongs to this notebook). A physical notebook answers all three
with one structure — a spine of sections and pages — and that's *why* the notebook metaphor is the
right IA anchor here rather than a flat file browser (Figma) or a folder tree (Drive): the spine
gives spatial + sequential memory simultaneously, which matters pedagogically because a course *is*
sequential.

**Hierarchy.** Notebook → Section → Page is the correct depth — three levels is inside working-memory
limits (Miller's 7±2, but really closer to 3-4 for *navigational* chunks per Hick's Law: every extra
level multiplies decision time at every traversal). A fourth level ("sub-pages") should be resisted;
if a page needs children, that's a section.

**Verdict.**
- **KEEP** — `components/workspace/notebook-tree.tsx` already implements exactly Notebook → Section →
  Page with desktop-grade context menus, and — this is the important part — it's *one component*
  reused verbatim across the desktop rail, the tablet rail-sheet, and the phone drawer (per its own
  header comment). That's the correct IA decision already made: the tree structure is a single
  source of truth, not three parallel implementations that could drift.
- **KEEP** — Search-as-navigation via `command-palette.tsx` (Cmd/Ctrl+K) already unifies pages,
  notebooks, library assets *and* the component palette into one index, and reuses the same registry
  the canvas's `/` slash-menu searches (per its header comment). This is the Hick's-Law-correct
  answer to "where do I find X" for anything past ~15 items: don't make the user descend a tree,
  let them type. Good — don't add a second, competing search surface.
- **CHANGE — Recents/Favorites.** Nothing in the reviewed surface (`sidebar.tsx`, `notebook-tree.tsx`,
  `command-palette.tsx`) shows a "recently opened pages" or pinned-favorites rail. For a teacher
  managing many notebooks across many classes, "last 5 pages I touched" is the single highest-value
  navigation shortcut and it's currently missing. **Spec:** a `recentPages: string[]` ring (last 8
  page ids, capped, MRU-ordered) in `lib/store/workspace.ts`, surfaced as the *default* view when
  the command palette opens with an empty query (before the user types anything) — zero new UI
  chrome, it just changes what the palette shows on open vs. what it shows once you start typing.
- **CHANGE — Breadcrumb / "where am I."** The tab bar (`tabs-bar.tsx`) shows open pages but not the
  page's notebook/section lineage. When a student has 4 tabs open across 2 notebooks, nothing
  answers "which notebook is this page in" without opening the sidebar. **Spec:** a small,
  low-contrast breadcrumb (`Notebook / Section`) as a hover tooltip on the tab, not permanent chrome
  — permanent breadcrumbs would cost vertical space the canvas philosophy says not to spend for
  information only needed occasionally (progressive disclosure: show on demand, not always-on).

---

# 3. Canvas Experience

**The ideal.** An infinite canvas for physics has one constraint a general whiteboard doesn't:
*simulation needs a coordinate frame with real units*, because F=ma isn't scale-invariant — a
"large" spring and a "small" spring behave differently if the canvas silently rescales pixels to
meters. So the canvas has to reconcile two coordinate systems (screen pixels for direct manipulation
feel, world units in cm/m for physics correctness) without ever making the student think about the
seam.

**Verdict.**
- **KEEP** — this reconciliation already exists and is handled correctly: `lib/scene/units.ts`
  (`pxToCmRounded`, `cmToPx`) plus `readBuffer`/`world` runtime split content-space from
  render-space, so drag gestures stay pixel-perfect (Fitts's Law: target size in *screen* pixels,
  not world units, is what determines how easy a target is to hit) while physics stays
  unit-correct underneath. Don't unify these into one coordinate space — that would be the naive
  "simpler" design that's actually wrong for this domain.
- **KEEP** — pointer state kept in refs, not React state, during drags (`canvas.tsx` header comment:
  "drags never re-render anything but the objects they move"). This is the correct direct-manipulation
  performance answer — 60fps drag feedback is itself part of the UI's credibility; a stuttery drag
  reads as "this simulator is unreliable" before the student even presses Play.
- **KEEP** — draw-and-hold sketch recognition (circle/rect/line/spring recognized from freehand,
  upgrading geometry only, never meaning) is the correct middle path between "force users into a
  shape-picker" (kills the play/sketch feeling) and "never recognize anything" (loses the
  productivity win). Recognition-upgrades-geometry-not-meaning is precisely the right invariant:
  it means a recognized circle is exactly as blank a slate as a manually-picked circle — no surprise
  behavior gets attached just because the recognizer fired.
- **CHANGE — mini-map / overview mode.** No overview/mini-map surface was found. On an infinite
  canvas, "where is everything relative to where I am" is a real problem once a lesson has 15+
  objects spread out (a teacher building a multi-part circuit board, say). Users currently have only
  zoom-to-fit as an escape hatch (if it exists) or manual panning. **Spec:** a small (120×80px)
  collapsed-by-default mini-map, bottom-right, that expands on hover/tap — shows object bounding
  boxes as dots, current viewport as a rectangle, click-to-jump. Low priority: only build once a real
  lesson regularly exceeds ~20 objects; below that, zoom-to-fit (Shift+1 or similar) covers it more
  cheaply. This is a good example of Hick's Law cutting the other way — for the *common* case (a
  handful of objects), a mini-map is one more thing to visually parse, so it must stay collapsed
  until the object count actually justifies it.
- **CHANGE — smart alignment guides.** No evidence of Figma-style alignment/distribution guides
  (dashed lines snapping to align centers/edges with nearby objects) in `canvas.tsx`'s gesture
  handling. For pedagogical diagrams (aligning three masses on a shelf, evenly spacing circuit
  components), this is a real friction point today — placement is eyeballed. **Spec:** on drag,
  compute alignment candidates against the 5 nearest siblings' edges/centers (not all objects — O(n)
  against a spatial index, not O(n²)), show a 1px accent-blue guide line when within ~4px world-snap
  threshold, snap position to it. This is Gestalt's Law of Continuity made interactive — the guide
  line *is* the affordance that tells the student "these are now aligned," which is itself a small
  piece of implicit geometry teaching.
- **KEEP — precision/numeric fallback for placement.** Pure direct manipulation (drag to place) has
  a Fitts's Law floor: below a certain target size or precision requirement, pointer accuracy
  degrades, especially on touch. `inspector.tsx` already covers all three transform axes with
  scrubbable/typeable fields (`cmField` for W/H, `numField` for `Rot°`, position implicitly via the
  same pattern) — the numeric escape hatch is complete, not partial. No action needed.

---

# 4. Every Panel

**The ideal panel count for a domain tool is the number of *distinct mental modes* the user
switches between, not the number of features.** Nielsen's minimalist-design heuristic says every
extra unit of interface is a unit of competition for attention against every other unit — so the
right process isn't "design a panel for each feature," it's "find the smallest number of panels
that cover every mode, then route every feature into one of them." SIMBLIP has already run this
consolidation once (`docs/ui-simplification-plan.md`); this section re-derives the same target from
theory and checks whether it still holds.

The modes a physics-notebook user actually cycles through are: **browse** (which page/notebook am I
in), **build** (place/draw objects), **configure** (set an object's properties/behaviors), **run**
(play/pause/inspect results), and **occasionally-reach-for** (calculator, pen settings, notifications
— things used often over a session but not continuously). That's 5 modes, and SIMBLIP's panel
inventory maps onto them almost exactly:

| Mode | Panel | File |
|---|---|---|
| Browse | Notebook tree (sidebar section) | `notebook-tree.tsx` |
| Build | Components palette (sidebar section) + floating toolbar | `library-panel.tsx` / `palette.tsx`, `toolbar.tsx` |
| Configure | Properties (sidebar section, = Inspector) | `inspector.tsx` |
| Run | Transport (play/pause/reset) | `transport.tsx` |
| Occasionally-reach-for | Tools section (calculator, quick-insert), pen settings popover | `tools-panel.tsx`, `pen-settings.tsx` |

**Verdict, panel by panel:**

- **KEEP — the rail-plus-one-open-section sidebar** (`sidebar.tsx`). This is the textbook answer to
  "can panels merge" for Notebook/Components/Tools/Library/Properties: they're mutually exclusive
  *modes* (you're never browsing pages and configuring an object's mass at the same literal instant
  of attention), so a rail (always-visible mode switcher, near-zero width) plus one expanded pane
  (the mode's content, full height) is strictly better than 5 permanently-tiled panels — it trades a
  small amount of clicking (switch mode) for a large amount of screen real estate back to the canvas.
  This is progressive disclosure applied to panel real estate, not just to individual controls.
- **KEEP — Inspector living inside the rail, not as a separate floating/docked panel.** Properties
  is a *configure*-mode panel exactly like the other four; giving it independent dock/side/merge
  logic (which `lib/store/layout.ts` still technically supports — see Dock System below) was the
  wrong shape for this mode taxonomy. The current code has already un-done that (comment at
  `shell.tsx:226-228`: "the right Inspector dock retired when Properties joined the rail").
- **KEEP — Calculator as a floating, draggable, persistent-position panel**, not embedded in a
  sidebar section. This is the correct exception: a calculator is used in short bursts *while*
  looking at something else on the canvas (a graph, a formula object), so it needs to coexist
  spatially with the canvas rather than occupy sidebar real estate that would hide the very thing
  the calculation is about. Deliberately excluding page variables from its scope (per its header
  comment) is also correct — it prevents the classic confusion of "is this scratch math or part of
  my document," an error-prevention decision more than a features decision.
- **CHANGE — dead panel-arrangement flexibility in `lib/store/layout.ts`.** This store still models
  *two* independently-dockable, side-swappable, mergeable-into-tabs panels (`PanelId = 'pages' |
  'inspector'`, `sides`, `order`, `merged`, `moveSide`, `swapOrder`), but `shell.tsx` only ever
  instantiates one `<Dock side="left" panels={['pages']}>`. This is speculative flexibility with no
  second caller — the exact shape of complexity Nielsen's minimalist heuristic and the ladder in
  this document's own review process both flag. **Spec:** collapse `layout.ts` to what's actually
  used — a single `sidebarSide: 'left' | 'right'` boolean-ish preference (if left/right placement is
  even still a user-facing preference worth keeping; if not, delete the file and hard-code left).
  Don't keep `moveSide`/`swapOrder`/`merged` "in case Properties needs to un-merge again later" —
  per this doc's own method, YAGNI applies to panel-arrangement code exactly as it does to anything
  else; if a second dockable panel returns, that logic is cheap to rebuild against the real
  requirement at the time.
- **CHANGE — Notifications has no persistent affordance audit here.** `notifications.tsx` aggregates
  shares/assignments/announcements behind (presumably) a bell icon. Confirm it follows the same
  progressive-disclosure contract as everything else: badge count visible at rest (recognition, not
  recall — "do I have anything new" should never require opening the panel to check), full detail
  only on open. If the current badge is a generic dot rather than a count, upgrade it — for a teacher
  with 30 student submissions, "something changed" and "12 things changed" call for different
  urgency, and a dot can't carry that.

---

# 5. Toolbar Redesign

**The ideal.** A toolbar's job is to expose the *small, closed set* of primitive actions that don't
belong to any single object — placement tools and drawing modes — at the lowest possible Fitts's-Law
cost (large targets, close together, always in the same place so muscle memory forms). Everything
that ISN'T a placement/drawing mode (utilities, toggles, one-off actions) actively hurts the toolbar
by diluting that closed set and forcing a recall decision ("was Ask AI on the toolbar or in a menu?")
every time.

**Verdict.**
- **KEEP — the current 9-tool toolbar** (`toolbar.tsx`: Select, Pen, Shaper, Eraser, Text, Note,
  Formula, Graph, Grid Table) plus a Shapes flyout. Nine primary targets is comfortably inside the
  range where spatial/muscle memory forms reliably (compare: a dozen-key numpad, a QWERTY home row)
  and every one of the nine is a genuine placement/drawing mode, not a utility. The file's own header
  comment documents the *removal* of ink-to-shape/ink-annotate toggles, touch-assist toggles, the
  calculator, the components palette, Ask AI, and Code quick-insert from this surface — i.e., this
  section's ideal was already independently arrived at and executed (`docs/ui-simplification-plan.md
  §3`). Nothing to change here; re-deriving "keep the toolbar to placement tools only" from scratch
  would just restate the file's own comment.
- **KEEP — flyout groups (Shapes) instead of flattening every shape onto the bar.** Ten shape
  variants (line, circle, oval, square, rect, triangle, pentagon...octagon) as ten permanent toolbar
  icons would roughly double the bar's width for a set that's used far less often than Pen or Select.
  Nesting them one level deep behind a single "Shapes" trigger is the correct progressive-disclosure
  trade — Hick's Law cost is paid once (find Shapes) instead of on every glance at the bar.
- **CHANGE — no visible affordance for "this triggers a flyout" vs. "this is a direct tool."**
  From the tool list alone it's not clear whether Shapes (and Table/Graph, which also route through
  `tools-panel.tsx`'s quick-insert) render a small corner caret or overflow chevron distinguishing
  "click to place" from "click to open a submenu." If they don't already, add a small caret
  (bottom-right, 4px, low-contrast) — this is a one-line CSS-affordance fix, not a redesign, but it's
  the difference between "discoverable" and "you find it by accident once and remember forever,"
  which is a worse learnability curve than necessary.
- **CHANGE — no stated overflow policy for a future 10th+ tool.** The toolbar works at 9 items on
  desktop; nothing in the reviewed files states what happens at item 10 (a new domain adds a
  primitive) or on a narrow viewport where 9 icons already may not fit. **Spec:** define the rule now
  while the bar is still small: after a fixed width budget, the least-recently-used tool (by a simple
  per-user use-count in preferences, not a fixed priority order) folds into a single "More" overflow
  button — so the bar self-prunes to *this specific user's* actual habits rather than a
  product-manager's guess at priority order.

---

# 6. Dock System

**The ideal.** "Dock" here means two different things that are worth naming separately because they
have different ideal answers: (a) the *panel-hosting* dock — where do sidebar-like panels live and
can they move — covered in §4 above (verdict: no, they shouldn't move; one rail, left, done); and
(b) the *floating tool dock* — the toolbar's physical container. For (b), the question the prompt
poses ("Canva? Figma? Adobe? Apple Dock? Windows Taskbar? something new?") has a real answer for
this domain: **closest to Figma's floating pill**, not Apple's Dock (which magnifies on hover — a
neat trick for an app launcher, actively bad for a tool palette where jittering icon sizes would
make Fitts's-Law targeting *harder*, not easier) and not a Windows taskbar (which mixes running-app
identity with launching, a concept that doesn't exist here).

**Verdict.**
- **KEEP — a floating pill toolbar, fixed position, no hover-magnify, no running-state indicators.**
  This matches `toolbar.tsx`'s "Floating tool switcher" framing exactly. Correct choice; don't import
  Apple-Dock-style magnification "for delight" — it would be delight purchased at the cost of
  precision, a bad trade for a tool people click 200 times a session.
- **KEEP — one fixed rail for panels (§4), not a rearrangeable multi-panel dock.** Already covered;
  repeating the verdict here only to close the loop on the prompt's explicit "Adobe?" option — Adobe's
  many-independently-dockable-panel model is the wrong reference for a 5-mode app; it's the right
  model for Photoshop's dozens of orthogonal palettes, and importing it here would be solving a
  problem SIMBLIP doesn't have.
- **ADD — nothing.** No net-new dock surface is justified by current usage. Resist the temptation to
  add a "customizable toolbar" (drag tools to reorder/hide) — that's Adobe-style power-user
  flexibility that trades a small win for expert users against a real learnability cost for everyone
  else (a toolbar that looks different on every machine breaks the "muscle memory transfers between
  any two SIMBLIP sessions, including a teacher's demo machine and a student's laptop" property,
  which matters more here than in a general creative tool because screenshots/demos/tutorials all
  assume one canonical layout).

---

# 7. Properties Panel

**The ideal.** The properties panel is where progressive disclosure earns its keep hardest, because
a physics object genuinely has a beginner-relevant subset of parameters (mass, for a Rigid Body) and
an expert-relevant remainder (collision group, tracer overlays) that a beginner should never have to
scroll past to find mass. The two competing failure modes: hide too much and experts hit a wall
("where's restitution?"); hide too little and beginners face a form with 10 fields for a simple
circle.

**Verdict.**
- **KEEP — the Properties/Variables two-tab split** (`inspector.tsx` `TabsList`/`TabsTrigger`). Two
  tabs is the right depth: "this object" vs. "this page's shared values" are genuinely different
  mental scopes (object-local vs. document-global), and two is inside the zero-cost range for tab
  switching — Hick's Law barely registers a cost at n=2, since it's effectively a binary toggle a
  user can eventually stop consciously choosing at all.
- **KEEP — behavior params sourced from `BehaviorSpec.params`** (`lib/behaviors/registry.ts`). This
  is the single-source-of-truth answer to "should beginners see everything": the registry, not the
  Inspector component, decides what fields exist for `rigidBody` (mass, friction, restitution, vx,
  vy, omega, collide, showMotion/showTrail/showForces — 10 params). That the Inspector doesn't
  hand-roll per-behavior forms is exactly right — it means adding a new physics domain (per the
  registry's own header comment: "Adding a domain = adding rows here + a solver") automatically gets
  a correctly-generated properties UI, no UI code to write.
  - **CHANGE within this KEEP:** ten flat params for Rigid Body (mass/friction/restitution/vx/vy/omega/
    collide/showMotion/showTrail/showForces) is already past the point where a flat list serves
    beginners well — a student placing their first mass needs exactly one of those ten (mass) to get
    a working simulation; the rest are either advanced (collision group, angular velocity) or
    debug/instructor tooling (the three `show*` tracer toggles). **Spec:** group behavior params into
    `common` (shown always: mass, and — for a body — initial velocity) vs. `advanced` (collapsed
    behind a "More" disclosure row, one click) at the `BehaviorParamSpec` level — add an optional
    `tier: 'common' | 'advanced'` field to the spec (default `'common'` so existing behaviors need no
    migration), and have the Inspector render advanced params under a closed-by-default
    `<Collapsible>` (already a Radix primitive in the project). Tracer toggles (`showMotion`,
    `showTrail`, `showForces`) are the clearest advanced-tier candidates — they're visualization aids
    for someone already fluent, not day-one physics.
- **KEEP — `ExprInput`'s click-vs-double-click contract** (single click never enters edit mode; only
  double-click does; plain click-drag scrubs numeric fields; Shift=coarse, Alt=fine). This is a
  precise, well-reasoned application of **error prevention**: the single most common Inspector
  mis-click in any form-heavy tool is "I clicked to select and accidentally started editing." Making
  select and edit require a different gesture (single vs. double click) removes that error class
  entirely, and doing it via the *existing* Figma convention means users arrive with the gesture
  already learned from another tool — recognition over recall at the cross-application level.
- **CHANGE — validation/error surfacing.** `ExprInput` accepts an `error` prop, confirming some error
  path exists, but there's no evidence in the reviewed excerpt of *what* triggers it beyond a parse
  failure, nor of a physically-impossible-value class of error (negative mass, restitution > 1,
  friction < 0). **Spec:** these are exactly the "impossible physics" cases §15 (Error Prevention)
  should own — the fix belongs in `lib/behaviors/registry.ts` as a `validate?: (n: number) =>
  string | null` per param spec (not in the Inspector component, keeping the registry as the single
  source of truth per the KEEP above), surfaced through the same `error` prop `ExprInput` already
  supports. This is additive to an existing contract, not a new one.

---

# 8. Tool System

**The ideal.** Every tool should communicate its own state machine through the cursor and a single
sentence, with no separate documentation needed — the tool literally teaches its own gesture the
first time it's used, via what happens on the canvas.

**Verdict, by tool family:**
- **KEEP — Select.** Standard direct-manipulation contract (click selects, drag-on-empty marquees,
  drag-on-object moves) — no reinvention needed; this is the one tool where matching every other
  canvas tool in existence is the *correct* choice, since violating it would cost a wrong-expectation
  tax on every user who's touched any other canvas tool before.
- **KEEP — Pen / Shaper split**, rather than a single pen with a "beautify" toggle buried in a
  settings panel. Making "stays as drawn" vs. "always straightens/snaps" two separate tools (rather
  than one tool with a mode flag) is the correct legibility trade: the toolbar icon itself now
  communicates the behavior (Fitts's Law aside — this is really an *affordance* argument, Norman's
  sense: the tool's identity encodes its effect, so there's nothing to recall, only to recognize).
- **KEEP — draw-and-hold recognition + Shift-orthogonal routing** (`canvas.tsx` header). Already
  covered in §3; repeating only to note it's a *tool-system* decision as much as a canvas one — the
  Pen tool's full behavior (recognize on hold, route orthogonally on Shift) is discoverable through
  play, which is the tutorial philosophy (§24) applied at the gesture level, not just the lesson
  level.
- **KEEP — Eraser as drag-to-remove, not click-to-remove.** Matches physical eraser affordance
  exactly (Norman: the interface metaphor should match the physical tool it's named after) —
  dragging is also more forgiving for touch/stylus imprecision than requiring a precise click per ink
  stroke.
- **ADD — Measurement tool.** The masterplan prompt's tool list includes Measurement; nothing in
  `toolbar.tsx`'s 9 tools or `tools-panel.tsx`'s quick-inserts corresponds to a ruler/distance/angle
  tool. Given the domain (mechanics diagrams routinely need "how far apart are these two masses,"
  circuit diagrams need lead lengths), this is a real gap, not a nice-to-have. **Spec, kept small on
  purpose:** not a new permanent toolbar slot (§5's 9-tool budget is deliberately tight) — instead, a
  quick-insert in the Tools sidebar section exactly like Table/Graph/Code already are
  (`tools-panel.tsx`'s existing pattern: pick here, then click-drag on canvas). Output is a
  lightweight annotation object (reuses the existing annotation/label rendering path in
  `lib/scene/annotate.ts` if that already supports free-floating labels) showing live distance in the
  page's units — not a new geometry kind, not a new behavior, just a specialized line+label pairing.
  This keeps the addition proportional: one new entry in an existing menu, not a new subsystem.
- **KEEP — Force/Joint/Spring as behaviors, not tools.** The masterplan prompt lists Force, Joint,
  Spring as if they were toolbar-level tools; SIMBLIP's architecture correctly treats them as
  *behaviors* attached to geometry after the fact (`lib/behaviors/registry.ts`'s `BEHAVIOR_SPECS`
  already includes a `spring` type per the tutorial course reference in `tutorial.tsx`). This is the
  architecturally correct call, not a gap: geometry+behaviors (`docs/architecture.md`) means "a
  spring" is a line with a spring behavior, so a dedicated Spring *tool* would fork the mental model
  into "some physics things are drawn, some are placed as special tools" for no real gain. Do not add
  toolbar-level Force/Joint/Spring tools — that would be regressing an already-correct architectural
  decision to satisfy a generic prompt checklist.
- **ADD — persistent object grouping.** §3 flagged the missing mini-map and alignment guides but
  under-covered one more Canvas-Experience topic the prompt explicitly names: object grouping.
  `lib/scene/selection-actions.ts` has no group/ungroup and no align/distribute anywhere (grep-
  confirmed) — multi-select gets a shared bounding box and a group-rotate handle (`canvas.tsx:2719–
  2774`) but releases back into N independent objects on pointer-up; there is no way to lock a
  sub-assembly (a linkage, a lens bench, a five-resistor ladder) into one unit that moves as a whole.
  This is the clearest missing *capability*, not polish, in an otherwise disciplined selection model
  — and unusually cheap to add correctly, because the extension point already exists exactly for
  this: `selection-actions.ts:3–12` documents `registerSelectionActions` as the mechanism for "object
  kinds/behaviors that carry their own verbs" to contribute actions without patching the pipeline
  file. **Spec:** `Group` (⌘G) wraps selected ids in a new `group` geometry kind holding child ids,
  reusing the *existing* group-rotate transform math for the now-*persistent* case; `Ungroup` (⌘⇧G)
  is the inverse; `Align left/center/right`, `Align top/middle/bottom`, `Distribute horizontal/
  vertical` are pure bbox math against helpers the snap system (§3) already computes. All of it
  registers into the `'arrange'` action group and therefore surfaces in the dock's contextual segment
  *and* the canvas context menu automatically — both already render from `actionsForSelection`, so
  this is new geometry logic plus registry entries, not new UI.
- **KEEP — "system boundary" containers as the canvas's frame system.** The prompt's Canvas
  Experience section separately asks about a "Frame system" for grouping/sectioning the canvas by
  region. This already exists, just under a domain-specific name: `factory.ts:234–237`'s mechanics/
  electrical/electronics/digital/optics/waves/quantum "System boundary" objects are dashed regions
  that scope sketch recognition to a domain — draw inside one and freehand strokes are interpreted as
  that domain's components, so a tablet user can sketch a whole circuit without touching the palette.
  This is a better answer than a generic Figma-style frame would be, because the frame carries
  *meaning* (which recognizer applies here) rather than being purely organizational — don't add a
  second, meaningless frame primitive alongside it; if a non-domain-scoped grouping frame is ever
  needed, it's the same object the Group addition above already specifies.

---

# 9. Text System

**The ideal.** Text in a physics notebook plays three distinct roles — running prose (explaining a
setup), a label/caption (naming a part), and a formula (a claim with units) — and conflating them
into one generic "text box" is a common failure: it either overpowers formulas with plain-text math
that can't be typeset, or overpowers prose with a formula editor that's clumsy for a sentence.

**Verdict.**
- **KEEP — live per-line markdown rendering, Obsidian-style** (`components/objects/text.tsx`): every
  line renders formatted except the one holding the caret, which shows raw source. This is the
  correct resolution of a genuine WYSIWYG-vs-source tension — full WYSIWYG (Google Docs-style) hides
  the markup entirely, which is bad for a technical-writing surface where users benefit from *seeing*
  the markdown they're producing; full source (plain markdown file) never shows formatted output
  until you leave the field, which breaks the "does this look right" feedback loop. Per-line hybrid
  gets both: immediate feedback on every line you're not currently touching, uncorrupted editing on
  the one you are.
- **KEEP — grow-only height, fixed writing width.** Matches how paper note-taking actually works
  (width is fixed by the page, height is however long you need) and avoids the classic "box shrank
  and ate my last paragraph" surprise of auto-sizing-both-axes text boxes.
- **KEEP — Formula as its own object, not a text-block feature**, with LaTeX rendering via KaTeX and
  calculus actions (d/dx, ∂/∂x, ∫dx, Laplace, Fourier) surfaced in the Properties panel *once
  selected* rather than as a permanently-visible toolbar on the card (`components/objects/formula.tsx`).
  This is progressive disclosure applied correctly at the object level: an unselected formula card is
  pure content (just the typeset expression), and the "what can I do with this" affordances only
  appear once the user has expressed intent by selecting it — exactly mirroring how the Properties
  panel already works for every other object type, so formulas don't need a special mental model.
- **KEEP — Note as a separate tool/object from Text** (`StickyNote` icon, distinct from `Type`). A
  sticky note (short, informal, callout-colored) and a text block (structured, longer-form) are
  different enough in *intended length and formality* that collapsing them into "text with a style
  toggle" would cost a decision at creation time ("do I want the note style?") that a separate tool
  avoids entirely — you pick the tool that already IS the right style.
- **CHANGE — confirm inline math inside prose.** A sentence like "the amplitude decays as
  e^(-γt)" is common in physics writing, and it's unclear from `text.tsx`'s markdown renderer whether
  inline LaTeX (`$...$`) is supported alongside the block-level Formula object. If not: **spec** —
  extend the text renderer's per-line pass to detect `$...$` spans and pipe them through the same
  KaTeX call `formula.tsx` already uses (shared inline-math renderer, not a new dependency), so
  students aren't forced to break a sentence into a text block plus a separate Formula card just to
  write one variable with a subscript.

---

# 10. Context Menus

**The ideal.** A right-click (or long-press) menu earns its place only if it's *faster* than the
alternative for that specific action — for anything reachable in one click from a visible panel, a
context-menu duplicate just adds a maintenance path that can drift. Its real job is surfacing
actions that have no other permanent home: object-specific operations (convert to physics object,
duplicate, bring to front) and multi-select batch operations.

**Verdict.**
- **KEEP — `handleContextMenu` in `canvas.tsx` plus desktop-grade context menus on the notebook tree**
  (`notebook-tree.tsx`: "Right-click anything for rename/duplicate/share/assign/present/export").
  Consistent right-click coverage across both the canvas and the page tree is the correct baseline —
  a user who's learned "right-click gets me object actions" on the canvas shouldn't have to relearn
  that the tree works differently.
- **KEEP — explicit native-context-menu suppression on secondary surfaces** paired with
  long-press-vs-Android-contextmenu de-duplication (`clearLongPress() // Android fires contextmenu on
  long-press; avoid doubling`). This is exactly the kind of unglamorous cross-platform error
  prevention that's easy to skip and very visible when skipped (a double-fired menu, or the raw OS
  menu leaking through over canvas content) — already handled correctly.
- **ADD — "recent actions" / smart top row.** Neither reviewed file shows the context menu reordering
  itself by object state (e.g., promoting "Add Rigid Body" to the top of an unconverted shape's menu,
  since that's overwhelmingly the first thing done to a fresh shape per the tutorial's own teaching
  order). **Spec, small:** for the canvas's object context menu specifically — put "Convert to physics
  object" (the behaviors submenu) as the first item, above generic ops (duplicate/delete/bring-to-
  front), whenever the object has zero behaviors attached; once a behavior exists, drop back to the
  standard order. This is a state-conditioned reorder, not a personalization/ML feature — cheap, and
  it directly encodes the domain's most common single next-step.
- **Explicitly not recommended: AI actions inside the context menu.** See §19 — AI suggestions belong
  in the dedicated AI surface, not blended into the object context menu, to keep "what does
  right-click do" a fixed, learnable, non-probabilistic set of actions.

---

# 11. Gestures

**The ideal.** A canvas that has to serve mouse, trackpad, touch and stylus users identically without
a device-detection fork should map each input's *native* affordance to the same logical action
(pan/zoom/select) rather than forcing every device through one input's idiom (e.g. requiring a
two-finger gesture on a mouse-only desktop, or requiring a scroll wheel on a phone).

**Verdict.**
- **KEEP — the existing device coverage is already comprehensive**: `onWheel` handles both plain
  scroll (pan) and ctrl+wheel (Chromium/Firefox's synthesized trackpad pinch), with Safari's
  proprietary `gesture*` events covered as a separate path per the code comment — a detail that's
  easy to miss and a common source of "pinch-zoom doesn't work in Safari" bugs, already handled.
  Touch pinch is tracked independently (`touchesRef`, `pinchRef` with a distance/center baseline).
  This is the correct "same logical zoom action, four different event sources" architecture — nothing
  to redesign, only to keep exercising as new gestures are added.
- **KEEP — immediate-mode painting during an active gesture** ("the object layer and the grid each
  get paint and no React... the store is written only when the gesture SETTLES"). This is the right
  performance answer for Fitts's-Law-critical operations: a pinch-zoom or pan that stutters because
  React is re-rendering the tree on every frame reads as laggy, and laggy pan/zoom is one of the
  fastest ways to make an infinite canvas feel untrustworthy before the user has evaluated anything
  else about the product.
- **ADD — two-finger tap (secondary-click equivalent) for touch context menus.** Long-press already
  maps to context menu (per the Android de-dupe comment above), which is the correct primary mapping.
  Confirm a two-finger-tap alias also exists for users who've learned that convention from other apps
  (Procreate, GoodNotes) — if not, it's a small additive gesture, not a conflicting one.
- **ADD — rotate gesture (two-finger twist) for object rotation on touch.** Rotation currently has a
  handle (`onRotateStart`, visible in the resize-handle set) which is correct for mouse/precision
  input, but a two-finger twist is the native touch/stylus-tablet idiom for rotation and is currently
  unconfirmed. Given the resize/rotate handle set already exists and works, this is a genuine
  *addition* (a second input path to the same `onRotateStart` logic, gated to when exactly two touch
  points are on a selected object), not a replacement.

---

# 12. Keyboard Shortcut Philosophy

**The ideal.** Shortcuts should be *learned by doing*, not memorized from a reference sheet — every
shortcut should be visible at its point of use (a tooltip, a menu-item suffix) before it's ever
required knowledge, so muscle memory forms as a side effect of normal use rather than as separate
study. The uniquely wrong approach for an educational tool is Adobe's: hundreds of shortcuts,
discoverable only through a hidden preferences panel, that assume the user already knows the product
well enough to want to customize it.

**Verdict.**
- **KEEP — single-letter, mnemonic tool shortcuts surfaced inline** (`toolbar.tsx`'s `TOOLS` array
  carries `key: 'V'/'P'/'S'/'E'/'T'/'N'/'F'/'G'/'B'` alongside each tool's icon and label — the
  shortcut key is data attached to the same definition that renders the tooltip, not a separate
  system that could drift out of sync). Mnemonic-where-possible (P=Pen, E=Eraser, T=Text, N=Note,
  F=Formula, G=Graph) is the correct scheme for a learn-by-recognition shortcut set — a mnemonic key
  is partially guessable even before it's been seen once, which a fully memorized scheme (Adobe's
  arbitrary bindings) never offers.
- **KEEP — visible, tablet-reachable Undo/Redo buttons alongside the existing Ctrl+Z shortcuts**
  (`undo-redo.tsx`: "The keyboard shortcuts already existed; this makes them discoverable — and
  reachable on a tablet, where there's no Ctrl+Z"). This is precisely the right instinct: a shortcut
  that only works on one input device is an accessibility and discoverability gap at once, and
  exposing the same action as a `Kbd`-labeled button teaches the shortcut to keyboard users too, for
  free, every time they glance at the button instead of clicking it.
- **CHANGE — no single shortcut registry / cheat-sheet surface.** No file matching `*shortcut*` exists
  in the project; bindings currently live wherever the component happens to need them (`toolbar.tsx`'s
  `TOOLS` array, `undo-redo.tsx`'s hardcoded Ctrl+Z listener, presumably others in `canvas.tsx` for
  copy/paste/delete). This works today because the set is still small, but it means there's no single
  place to answer "what are all the shortcuts" — needed for a `?`-triggered cheat-sheet overlay (a
  well-established pattern: Gmail, Linear, Notion, Figma all bind `?`) and for catching accidental
  collisions as more get added. **Spec:** a `lib/shortcuts.ts` registry — `{ key, when: 'always' |
  'canvas-focused' | 'selection', label, action }[]` — that existing components register into rather
  than binding `addEventListener('keydown', ...)` independently; `toolbar.tsx`'s `TOOLS` array becomes
  one source feeding the registry rather than a second parallel list. The `?` overlay becomes a
  one-file render of the registry, grouped by `when`. This is infrastructure only justified because
  the shortcut *count* is about to grow (measurement tool, alignment guides and other additions in
  this document each want one) — introducing it now, while the set is still small enough to migrate
  in one pass, is cheaper than introducing it after 40 scattered bindings exist.

---

# 13. Object Creation Workflow

**The ideal.** For a domain with a small closed set of primitives (circle, rect, line, spring...) but
an open set of *meanings* (any shape can become any physics object), creation should be a two-step
funnel — place geometry, then optionally attach meaning — rather than forcing the user to pre-declare
"I want a rigid-body circle" before they've drawn anything. This is arguably the single most
important workflow decision in the whole product, because it's what makes "playing" (§1) true instead
of aspirational: a shape is genuinely just a shape until the student decides otherwise.

**Verdict.**
- **KEEP — the entire creation funnel already IS this**: draw or place bare geometry
  (`lib/scene/factory.ts`'s `baseObject`/`createGeometry`, always `behaviors: []` at birth) → select
  it → attach a behavior from the registry via the Inspector. `factory.ts`'s own header comment states
  the invariant precisely: "A palette component is nothing special — it is geometry + pre-attached
  behaviors. The user can build the identical thing by drawing and converting; the palette only saves
  clicks." That sentence is the whole object-creation philosophy in one line, and it's already true of
  the code, not just the docs — do not add a "creation wizard" or a modal that asks "what kind of
  object is this" up front; that would reintroduce exactly the pre-declaration cost this architecture
  was built to avoid.
- **KEEP — multiple entry points converging on the same funnel**: drag from the toolbar, drag from
  the Components palette (pre-behaviored, per above), draw-and-hold recognition (§3/§8), and search
  via the command palette / canvas `/` menu (§2) all terminate in the same `createGeometry`/
  `fromRecognition`/`componentById` factory calls. Recognition over recall says users should be able
  to reach the same result by whichever method matches how they're currently thinking (visually
  browsing vs. typing a name vs. sketching) — having one factory underneath four entry points is what
  makes that consistent rather than four subtly different creation paths.
- **ADD — voice/AI creation is intentionally scoped, not general-purpose.** Per §19's verdict (AI
  belongs in a bounded corner surface, not blended into primary creation), AI can *suggest* a
  fully-behaviored object ("build me a spring-mass system") but must materialize it through the exact
  same `createGeometry` + behavior-attach calls a manual drag would use, landing on the canvas as
  ordinary, fully-editable objects — never a special "AI object" type. This keeps the funnel single,
  with AI as one more entry point into it rather than a parallel creation system.

---

# 14. Simulation Workflow

**The ideal.** The defining pedagogical feature a static diagramming tool can never have is: **the
system stays editable while it's running.** Watching a graph update and then reaching in to change a
spring constant mid-oscillation and seeing the frequency shift in real time teaches the relationship
between parameter and behavior faster than any static before/after comparison — so the workflow's
central design commitment should be minimizing the distance between "I have a hypothesis" and "I saw
it happen," including *during* a run, not just before one.

**Verdict.**
- **KEEP — the entire runtime already optimizes for exactly this.** `lib/physics/world.ts`: Play
  builds one Matter.js world "exactly as drawn... nothing is regenerated or templated," and critically,
  "per-frame, behavior expressions... are re-evaluated against the page's variable scope, so editing a
  variable bends a running experiment." This is the single highest-leverage architectural decision in
  the codebase for the stated pedagogical goal, already made and already correct — a design that
  required Stop-edit-Play to change a parameter would be a strictly worse tool for this specific
  purpose, however common that pattern is in general simulation software (MATLAB/Simulink require a
  stop-edit-run cycle; SIMBLIP's edit-while-running is a genuine differentiator, not a parity feature).
- **KEEP — 120Hz physics writes decoupled from ≤15Hz graph reads via an outside-React ring buffer**
  (`lib/physics/bus.ts`). This is what makes "watch the graph while you drag the slider" possible
  without the UI thread fighting the physics thread — the right performance architecture in service of
  the same live-editing goal, not just an optimization for its own sake.
- **KEEP — DOM-direct transform writes during Play, bypassing React** (`lib/physics/world.ts` header:
  "Body transforms are written straight to the DOM through an element registry — React is not in the
  60 Hz path"). Consistent with the canvas's gesture-painting approach (§11) — the same architectural
  principle (React owns state, not the 60Hz visual path) applied uniformly across drag-gestures and
  physics-playback, so the *feel* of dragging an object before Play and watching it move during Play
  stays consistent rather than one being smooth and the other choppy.
- **KEEP — hold-to-reposition transport, Play/Pause/StepBack/StepForward/Reset** (`transport.tsx`).
  Frame-stepping (not just play/pause) is the correct minimum control set for a *learning* tool
  specifically — stepping one frame at a time is how a student inspects the exact instant a collision
  happens, which a plain play/pause pair can't do.
- **CHANGE — no "compare simulations" surface.** The masterplan prompt's lifecycle explicitly
  includes comparing runs (e.g., k=5 vs k=10 side by side), and nothing reviewed supports this — Play
  always overwrites the previous run's live state, and the buffer (`bus.ts`) has finite capacity
  (~40s ring) with no snapshot/save-this-run affordance. **Spec, scoped conservatively:** not a full
  version-control-for-simulations system — a single "Pin this run" action on the transport, available
  after a run completes, that freezes the current buffer's samples into a page-local named snapshot
  (stored in the page doc, not a new backend concept) and overlays it as a second, dimmed trace on any
  Graph object reading that channel. One pinned run at a time is enough to start (A/B, not an
  unbounded comparison matrix) — that's the 80% case (change one parameter, compare to what you just
  had) without building a general experiment-management system nobody asked for yet.

---

# 15. Error Prevention

**The ideal.** Nielsen's "error prevention" heuristic ranks above good error *messages* for a reason:
a prevented error costs nothing, a well-explained one still costs the interruption. For a physics
tool specifically there are two error classes that need different treatment — **syntax errors** (a
malformed expression) which should be caught character-by-character before commit, and **physically
impossible states** (negative mass, restitution above 1) which can be syntactically perfect but
still wrong, and need domain validation, not parser validation.

**Verdict.**
- **KEEP — human-authored SimScript diagnostics, not raw parser errors** (`lib/scene/
  simscript-diagnostics.ts`: "instead of V8's bare 'Unexpected token', they say *which line* and
  *why*" — reserved-name collisions, unknown `create()` kinds with a "did you mean," unclosed
  brackets pointing at the opener, unterminated strings, `connect()` arity). This is precisely the
  right bar for error messages in a tool students will hit errors in constantly while learning: a
  raw parser error teaches "the computer is confused," a "did you mean create('spring')?" teaches the
  actual vocabulary. Also excellent: the same diagnostics module feeds both the live-editing IDE and
  the AI training-pipeline linter, so "what counts as valid SimScript" can't drift between the two
  surfaces — a single source of truth for correctness, the same pattern as the behavior registry.
- **KEEP — commit-on-blur/Enter for `ExprInput`, never mid-keystroke** (§7). This alone prevents an
  entire class of error: a half-typed expression (`3 + `) never reaches the physics engine, because
  nothing commits until the field is left in a complete state.
- **CHANGE — physically-impossible values have no domain-level validation yet** (already specified
  in §7 as the concrete fix: an optional `validate?: (n: number) => string | null` per
  `BehaviorParamSpec`, surfaced through `ExprInput`'s existing `error` prop). Restated here because
  this is the section that owns the *principle* — the syntax layer (SimScript diagnostics) is
  already excellent; the missing layer is domain-physics validation, and it should live in the
  registry for the same single-source-of-truth reason the params themselves do.
- **KEEP — AI drafts require an explicit human confirmation step before touching the canvas**
  (`app/api/ai/route.ts` header: "Nothing here ever touches the canvas directly — the client's 'Add
  to canvas' button is still the only path in"). This is error prevention applied to AI specifically:
  a model can hallucinate a nonsensical scene graph, but it can never *commit* one — the human stays
  the only actor who can put something on the page, which also means every AI-introduced error is
  caught at the same review moment a manually-typed error would be, not silently.
- **ADD — a pre-Play sanity pass with warnings, not hard blocks.** Nothing reviewed shows a check
  that runs *before* pressing Play (e.g., "this spring has no attached mass," "this circuit loop is
  open," "two rigid bodies fully overlap at rest"). These aren't malformed data — Matter.js will
  happily simulate them — but the result is confusing to a learner who can't tell "my physics
  understanding is wrong" from "my diagram is technically broken." **Spec, deliberately soft:** a
  small warning-triangle badge on the Play button (not a blocking modal — blocking would violate
  §1's "never compete with the physics for attention" and would be actively wrong pedagogically,
  since sometimes an "invalid" setup like a fully-overlapping pair IS the interesting demonstration).
  Hovering/tapping the badge lists the specific conditions found, written in the same
  human-diagnostic voice as SimScript's. The student can always press Play anyway.

---

# 16. Accessibility

**The ideal.** Accessibility for a physics-education tool has one wrinkle beyond a typical app: the
canvas's *visual* channel (motion, color-coded state) often carries information — a graph line, a
current-flow animation — that has no text equivalent by default. A general "add alt text" pass
doesn't cover that; the domain needs specific attention to color-independent state encoding and
motion-independent event marking (e.g., a screen-reader-audible "collision at t=1.4s" event, not
just a visual flash).

**Verdict.**
- **KEEP — six built-in themes including a dedicated high-contrast accessibility theme**
  (`theme-provider.tsx`'s `APP_THEMES`: Light, Sepia, Lily, Dark, Dim, Midnight, Contrast — "Contrast
  is a high-visibility accessibility theme"). Treating accessibility contrast as a first-class theme
  choice rather than a hidden OS-detected override means a user can pick it deliberately regardless
  of their OS setting, and it gets the same design attention (a real palette in `globals.css`) as
  every cosmetic theme rather than a bolted-on afterthought.
- **KEEP — reduced motion honored at both the CSS layer** (`app/globals.css`'s
  `@media (prefers-reduced-motion: reduce)` block) **and the JS animation layer**
  (`lib/motion.ts`'s `useOsReducedMotion`, explicitly documented to win over the in-app motion
  setting: "a vestibular user shouldn't have to find our Appearance panel to make the UI hold
  still"). Belt-and-suspenders coverage across both the declarative (CSS transition/animation) and
  imperative (Framer Motion spring) paths is exactly what's needed, since a single-layer fix
  routinely misses whichever path wasn't covered.
- **KEEP — 139 `aria-label`s already present across `components/workspace/`**, and — notably — the
  tutorial system's own step-targeting selectors read those same labels (`tutorial.tsx`'s `T.pen =
  '[aria-label^="Pen"]'`). This is a good structural sign: aria-labels aren't decorative afterthoughts
  bolted on for a screen-reader audit, they're load-bearing enough that another subsystem (the
  tutorial spotlight) depends on them, which means they're much less likely to silently rot.
- **CHANGE — color-coded simulation state needs a non-color channel.** `docs/design-system.md`
  documents a real, thoughtful accent system (blue=selection, violet=AI, mint=running, amber=
  variables, rose=errors) — a strong palette for sighted, non-colorblind users, but for a
  deuteranopia/protanopia user (the most common colorblindness types), mint-running vs. rose-error
  can be genuinely hard to distinguish at a glance. **Spec:** confirm state indicators pair color with
  a shape/icon redundantly (a running-state dot plus a small ▶ glyph, an error state plus a ⚠ glyph)
  wherever accent color alone currently *is* the signal — this is Gestalt's principle that a second
  visual channel (shape) should back up the primary one (color) whenever color carries meaning, not
  just decoration.
- **ADD — an audible/textual event log for simulation events.** For a screen-reader user, "the mass
  collided with the ground at t=1.4s" currently exists only as a visual flash on the canvas (if
  anything marks it at all). **Spec, scoped:** a collapsed-by-default text log panel (not a new
  permanent chrome element — an option inside the existing Graph/Properties surfaces) that appends a
  line per notable physics event (collision, circuit-loop closed, variable-triggered threshold
  crossed) already derivable from the same `bus.ts` sample stream graphs already read — this is a new
  *reader* of an existing data source, not a new instrumentation system.

---

# 17. Performance UX

**The ideal.** Perceived performance for a notebook app is dominated by two moments: opening a page
that was recently open (should feel instant — Jakob Nielsen's 0.1s "feels instantaneous" threshold)
and recovering from an interruption (tab close, crash, offline) without visible data loss. Both are
solved by *not treating "closed" as "gone"* — keeping recently-touched state warm and always writing
to durable storage before it's strictly needed.

**Verdict.**
- **KEEP — the three-tier page residency policy is close to a textbook answer to the first moment**
  (`lib/store/page-cache.ts`): GRACE (3-minute warm cache after closing — switching back is instant
  with undo history intact), PRESSURE (immediate eviction under real memory strain, correctly
  overriding the grace period rather than politely waiting for a full tab crash), CAP (hard ceiling
  so rapid page-hopping can't blow the memory budget before grace ever expires). This is genuinely
  sophisticated performance UX — most notebook apps pick one policy (always cache, or always evict);
  having all three with PRESSURE able to override GRACE is the correct nuance, because "instant
  switch-back" and "don't run out of memory" are both real requirements that trade off against each
  other, not a single axis to optimize.
- **KEEP — evicting is never deleting; it flushes to a local archive first** (same file). This is the
  crash-recovery/data-loss half of the ideal solved as a side effect of the memory-management policy,
  rather than as a bolted-on separate autosave system — one mechanism serving two goals cleanly.
- **KEEP — pointer-based (not viewport-width-based) shell selection** (`hooks/use-mobile.ts`'s
  documented reasoning: a 1024px iPad in landscape is wider than plenty of desktop windows, so width
  alone misclassifies it; `pointer`/`hover` media features describe the actual input, which is the
  real question). This isn't strictly a *performance* decision but belongs in this section's spirit —
  it's the same "measure the real signal, not a proxy for it" discipline applied to shell selection
  that GRACE/PRESSURE/CAP applies to memory.
- **CHANGE — no loading-skeleton evidence for cold page opens.** The reviewed files cover *warm*
  reopens exhaustively (page-cache.ts) but nothing confirms what a genuinely cold load (first open of
  a large page, or a slow network fetching a PDF-backed page) shows while content streams in. A blank
  canvas for 800ms reads as broken; a skeleton (faint placeholder boxes at each object's known
  position/size, since the page's object metadata is likely available before full content is) reads
  as loading. **Spec, cheap:** if page metadata (object positions/sizes without full content) is
  available before the full `PageDoc` resolves, render placeholder rects at those positions —
  otherwise, a minimal centered spinner is an acceptable floor; the point is only that *nothing*
  currently confirmed fills that gap, so it should be checked and closed if missing, not that a
  heavy skeleton system needs building.

---

# 18. Collaboration UX

**The ideal.** In a classroom, "collaboration" is not symmetric peer editing (Figma's model) — it's
almost always **asymmetric**: a teacher distributes, a student works in isolation, and work flows
back for review. Optimizing for live-multiplayer-cursors (the default assumption "collaboration UX"
usually triggers) would be solving the wrong problem; the harder, more valuable problem is
distribution and review without anyone accidentally clobbering anyone else's copy.

**Verdict.**
- **KEEP — every share/assignment/board-present ships a frozen copy, never a live link to the
  original** (`page-actions.tsx`: "All three ship frozen copies — the original page is never
  exposed"). This is the single most important collaboration-safety decision available for a
  classroom tool, and it's already correct: a student opening a shared assignment can never
  accidentally (or maliciously) edit the teacher's master, and a teacher presenting on a room board
  can freely improvise during class without fear of corrupting the lesson file everyone else will
  later receive. This is a stronger, simpler guarantee than a permissions/ACL system would give for
  the same case, and it required no locking/conflict-resolution machinery at all — the classic sign
  of the right architectural cut.
- **KEEP — one portable `PageBundle` format underlies every transport path** (`page-bundle.ts`:
  shares, assignments, submissions, board sessions, exports all serialize through `bundlePage()`).
  Consistent with §2/§13's recurring pattern in this codebase — one canonical
  data/creation/serialization path with many entry points, rather than parallel bespoke
  implementations per feature. Backward-compatible by construction (old rows with no `bundle` field
  still import as plain boards) — a good example of extending a format without a migration.
- **KEEP — room boards with QR-pairing for presentation** (per project memory and
  `app/api/board-live/[sessionId]/route.ts`'s existence) as the *live* half of collaboration, kept
  cleanly separate from the *async* half (shares/assignments above). Splitting "show my screen to a
  room right now" from "hand this student a copy to work on independently" into different mechanisms
  is correct — they have almost nothing in common technically (one is ephemeral/session-based, the
  other is a durable copy) and conflating them into one "collaboration" feature would blur two very
  different trust models (a room board is public-in-the-room; an assignment copy is private to one
  student).
- **CHANGE — review/feedback loop needs a stated interaction model.** `notifications.tsx` already
  surfaces new submissions to teachers and new assignments to students, which covers the
  *notification* half of the loop. What's unconfirmed is the *reviewing* half: when a teacher opens a
  submission, is it read-only with an annotation layer (mark it up without touching the student's
  work) or editable-in-place? For the "frozen copy" guarantee above to remain trustworthy, teacher
  review of a submission should itself default to **annotation-over-a-locked-base** — the teacher's
  marks are a separate overlay layer (reusing the annotation object type per `lib/scene/annotate.ts`
  already used for ink-on-shapes) rather than direct edits to the submitted `PageDoc`, so "what the
  student actually submitted" stays provably intact even after feedback is added. This is a
  clarification of intent more than a new build, since the annotation primitive it needs already
  exists for a different purpose (ink-to-shape).

---

# 19. AI Integration

**The ideal, stated as a boundary first.** AI should appear exactly where it removes *setup* friction
(assembling a known configuration faster than manual placement) and should never appear where it
would remove *understanding* friction that IS the point of the exercise — an AI that solves the
physics problem for the student has optimized away the product's entire value proposition. The
sharpest test: would this AI feature let a student get a correct-looking result without ever forming
the mental model the lesson is trying to build? If yes, it doesn't belong here regardless of how
impressive the demo looks.

**Verdict.**
- **KEEP — AI drafts, never writes.** (`app/api/ai/route.ts`: every response is validated against
  the Simulation JSON schema and returned as a *draft*; "the client's 'Add to canvas' button is still
  the only path in.") This is the correct application of the boundary above to the *creation*
  workflow specifically — AI can save setup time (assembling a spring-mass-damper from a sentence)
  without ever silently mutating a student's page, and the human confirmation step is also where a
  student is naturally prompted to look at what got proposed before accepting it, rather than it
  materializing invisibly.
- **KEEP — AI tools are generated from the same registries the palette and Inspector read**
  (`app/api/ai/route.ts` header: "Every palette component is a generated tool... derived from the
  same COMPONENTS/BEHAVIOR_SPECS registries"). This closes the loop with §7/§13/§15's recurring
  pattern: the behavior registry is the single source of truth for what a physics object can be, and
  AI is one more *reader* of it rather than a system with its own separate (and driftable) notion of
  what's buildable. A new physics domain added to the registry is automatically AI-buildable with no
  AI-specific code to write.
- **KEEP — AI lives in a dedicated corner bubble, removed from the primary toolbar**
  (`toolbar.tsx`'s header: "Ask AI... moved to... a dedicated AI corner bubble" per
  `docs/ui-simplification-plan.md §3`). This matches this section's own ideal restated in toolbar
  terms (§5): AI is a distinct interaction mode (conversational, non-deterministic output) from
  placement tools (deterministic, one-click), and giving it its own fixed, small, always-in-the-
  same-place surface rather than toolbar real estate keeps the primary 9-tool set free of an
  action whose *result* can't be predicted before you press it — which would otherwise violate the
  "muscle memory / predictable outcome" property every other toolbar button has.
- **ADD — AI should explain its draft in the language of the lesson, not just render it.** Nothing
  reviewed shows the AI response including a short plain-language rationale alongside the generated
  scene (e.g., "I added a spring (k defaults to moderate stiffness) and a mass below it, with a
  ground so it has something to rest against"). Per the "AI should teach, not just generate" question
  the masterplan prompt raises directly: the win here is cheap relative to the value — the model
  already has to reason about what it's building to call the right tools; surfacing one sentence of
  that reasoning in the confirmation step (right where "Add to canvas" already lives) turns an opaque
  generation into a worked micro-example, at no new architectural cost.
- **Explicitly not recommended: AI inline on the canvas (a persistent assistant avatar, proactive
  tips, autocomplete-while-drawing).** Each of these would put a probabilistic, attention-competing
  element directly in the canvas's visual field, which is precisely what §1's philosophy rules out.
  The corner-bubble boundary already correctly excludes all of these; this is a note to future
  feature proposals more than a gap in current implementation.

---

# 20. Mobile & Tablet Experience

**The ideal.** A shrunken desktop UI fails on touch for structural reasons, not just sizing ones:
hover states don't exist, precise multi-panel layouts fight limited screen real estate, and touch
targets need roughly triple the tolerance of a mouse cursor (Fitts's Law with a much larger effective
pointer). The right model is closer to a native mobile app's navigation stack (push a screen, don't
tile a panel) than a responsive breakpoint of the desktop layout.

**Verdict.**
- **KEEP — a genuinely separate shell, not a responsive breakpoint** (`mobile-shell.tsx`'s own
  framing: "a Notes-style app, not a shrunken desktop. Navigation instead of panels: Home → notebook →
  editor"). This is exactly the right call structurally — navigation-stack-of-screens instead of
  panels solves the "no room for 3 simultaneous panels" problem completely rather than partially
  (which is what cramming collapsed panels into a small viewport would achieve).
- **KEEP — Properties as a bottom sheet on mobile, not a squeezed sidebar.** A bottom sheet is the
  correct native-feeling pattern for "a panel that's needed sometimes, full-width, without leaving
  the current screen" on touch — it matches the platform convention (iOS/Android share sheets, most
  native editing apps) so no new gesture vocabulary has to be taught, satisfying recognition-over-
  recall at the platform level, not just the app level.
- **KEEP — pointer/hover-based shell selection, not viewport width** (§17). Repeating the verdict here
  because it's the load-bearing decision that makes the phone/tablet/desktop split correct at the
  boundary cases that actually break naive implementations (iPad landscape, a 2-in-1 with keyboard
  detached) — this is precisely the class of edge case a masterplan built by "just add a `md:`
  breakpoint" would get wrong, and SIMBLIP's own code comment documents having identified and fixed
  that exact mistake.
- **KEEP — the same `notebook-tree.tsx` component powering desktop rail, tablet rail-sheet, and phone
  drawer** (§2). Worth restating here specifically because it's the concrete mechanism that prevents
  "the tablet experience" from silently drifting out of sync with desktop feature parity over time —
  a common failure mode where mobile ships 80% of a feature set because it's a separate
  implementation that stops getting updated.
- **CHANGE — tablet-specific gesture affordances from §11 (rotate-by-twist, two-finger context tap)
  are the highest-leverage additions for this shell specifically**, since a tablet user (the most
  likely in-classroom device alongside a teacher's laptop) has no keyboard shortcuts, no right-click,
  and no hover at all — every one of §11's touch-native gesture additions closes a gap that's
  currently *only* reachable via a visible on-screen handle for tablet users, where a mouse user has
  a keyboard fallback. Prioritize §11's rotate-gesture addition for tablet specifically before any of
  this document's desktop-only additions (alignment guides, mini-map), since tablet users have no
  alternate path to the same functionality and desktop users do.

---

# 21. Microinteractions

**The ideal.** Per §1's central rule, chrome motion exists to confirm state changes at a glance, not
to entertain — every animation should answer "did that register?" faster than a user could
consciously wonder it, and never linger long enough to make the user wait on the UI rather than the
physics.

**Verdict.**
- **KEEP — a three-kind spring taxonomy, not one global spring** (`lib/motion.ts`: `default` for
  general panels, `soft` — lower stiffness — "for big surfaces (sheets, modals, the focus view),"
  `snap` — higher stiffness, lower mass — "small things that should feel instant but not robotic
  (buttons)"). This is the correct granularity: a sheet covering a third of the screen and a button's
  press-state genuinely warrant different physical weight (a heavier object should move with more
  inertia — this is literally just physics, applied to UI motion, which is a fitting detail for this
  specific product), and three named kinds is few enough to stay consistent across the codebase
  without needing a design-system audit to keep them aligned.
- **KEEP — under-damped ("bouncy") as the lively default, with a `smooth` (critically damped) and
  `none` fallback selectable in Appearance**, all three routed through the same reactive `useSpring`
  hook. The file's own header comment already makes the HCI case precisely (real UI motion overshoots
  slightly, which reads as "alive" vs. the "correct but dead" feeling of critical damping) — this
  document has nothing to add to reasoning that's already this explicit in the source.
- **KEEP — canvas content itself never animates except physics** (`docs/design-system.md`: "nothing
  on the canvas itself animates except physics... animation must never compete with the simulation for
  perceived motion"). This is §1's philosophy already written down as a hard design-system rule, not
  just an aspiration — the correct place for it to live, since it constrains every future object
  renderer, not just current chrome.
- **CHANGE — no sound design exists, and that default should be kept, not treated as a gap.** A
  literal reading of the masterplan prompt's microinteractions checklist ("Sound... Haptics...
  Delight") would suggest adding audio feedback; for THIS product specifically that's the wrong call
  by default — a classroom of 20 students each running a spring-mass simulation with per-action sound
  effects would be actively hostile to the room, not delightful. If sound is ever added (e.g., a
  distinct "collision" chime tied to the pre-Play sanity pass from §15, useful for a screen-reader-off
  low-vision user), it must default OFF, be a per-user Appearance preference exactly like motion
  already is, and never fire more than once per discrete event class — never a per-frame or per-drag
  sound. This section's verdict is explicitly "do not add this without the OFF-by-default
  constraint," not "go add sound."
- **ADD — light haptic feedback on touch/tablet for two specific, discrete moments only:** successful
  behavior attachment (the "aha, it's alive now" moment) and a completed Play→Reset cycle. Scoped
  narrowly on purpose — the Vibration API (`navigator.vibrate`) is Android-only (no iOS Safari
  support), so this is a nice-to-have progressive enhancement for Android tablets specifically, not a
  cross-platform feature to build UI around; a single `navigator.vibrate?.(10)` call at those two
  moments, no-op everywhere else, is proportionate to that reach.

---

# 22. Visual Language

**The ideal.** A workspace tool's visual language should read as an *instrument* — calm, precise,
low-chroma chrome — reserving saturated color exclusively for information (state, selection,
domain-coded data) so a glance at color always means something rather than being ambient decoration
competing with the same signal.

**Verdict.**
- **KEEP — `docs/design-system.md` in full.** This is the rare case where the design-system document
  already states and justifies almost everything this masterplan section would otherwise have to
  derive from scratch: a single UI typeface (Plus Jakarta Sans, variable weight, loaded locally for
  deterministic no-layout-shift loading) plus a monospace for code/expressions/numeric readouts
  (JetBrains Mono — giving live numeric values a tabular, instrument-panel feel, which is a genuinely
  sharp detail for a physics tool specifically); a UI type scale sitting at 12.5–13px "like Figma/
  Linear — a workspace, not a website" (correctly rejecting marketing-site type scale for a dense
  tool); an oklch-based color system with warm-near-white/deep-neutral paper tones (never pure black/
  white, which is the correct call for reducing eye strain across long working sessions); exactly
  five reserved accent colors each mapped to one state (selection, AI, running, variables, errors);
  glass surfaces implemented as reusable utility classes (`.glass`, `.glass-strong`, `.hairline`)
  rather than forked per-component styles; a 4px base grid with continuous-corner radii; and an
  explicit "Never" list banning heavy/stacked shadows, gradients on chrome, and default browser focus
  rings. This is a mature, internally consistent system — this masterplan's job here is to confirm it
  holds, not to propose an alternative.
- **KEEP — reusing shadcn/ui primitives via the token layer, never forking** (`docs/design-system.md`:
  "re-skin via the token layer only — never fork a primitive to restyle it"). This is the correct
  anti-drift discipline: a forked Radix primitive silently diverges from upstream bug fixes and
  accessibility improvements over time; a themed primitive stays current for free.
- **CHANGE — no stated contrast audit across all six themes for the five accent colors.** The
  Contrast theme (§16) is presumably built to pass WCAG AA at minimum, but it's unconfirmed whether
  the five state-accent colors (blue/violet/mint/amber/rose) individually hold sufficient contrast
  against each of the six themes' paper tones — Sepia and Lily in particular, being warm/tinted
  light themes rather than pure near-white, are the likeliest to quietly fail a contrast check that
  the plain Light theme passes. **Spec:** a one-time automated audit (a small script computing WCAG
  contrast ratio for each of the 5 accents against each of the 6 paper/ink pairs defined in
  `globals.css`) rather than a manual per-theme visual check — cheap to write once, and worth
  re-running any time a theme's palette changes.

---

# 23. Cognitive Load Audit

**The ideal, and the method.** Rather than re-litigating every panel again (§4–§9 already did that
work at the component level), this section asks the higher-altitude question per *screen state*:
at this specific moment, what is competing for the user's attention, and does all of it deserve to
be there right now? This is Cognitive Load Theory's core move applied to UI — intrinsic load (the
physics itself) is fixed and worth spending attention on; extraneous load (chrome, decisions,
navigation) should be minimized regardless of how "useful" any individual element is in isolation.

| Screen state | What's visually present (confirmed) | Verdict |
|---|---|---|
| **Blank new page, nothing selected** | Rail (collapsed icons only), floating toolbar (9 tools), transport (collapsed/idle), tab bar, top bar (search, identity) | Correct minimum — every element here is either a fixed orientation anchor (rail, top bar) or the entry point to the one action available (place something). Nothing to cut. |
| **Object selected, not yet behaviored** | Above, plus selection outline + resize/rotate handles + Properties auto-opens in rail | Right call per §10's ADD (behaviors-first context menu ordering) — Properties should default to showing "Convert to physics object" prominently here, since an unbehaviored object mid-lesson has exactly one likely next action. |
| **Object selected, behaviors attached, not playing** | Above, plus full behavior param list in Properties | This is where §7's tiered-params CHANGE matters most — ten flat Rigid Body params at this exact moment is the single highest-density screen in the app today; collapsing to common/advanced directly reduces peak load at the moment it's highest. |
| **Simulation running (Play)** | Canvas motion, transport controls (play/pause/step/reset), any open Graph objects live-updating | Correctly minimal per §1/§14 — edit gestures lock during Play (`canvas.tsx`), which isn't just a technical guard, it's a cognitive-load decision: removing editable-chrome affordances the instant Play starts tells the user unambiguously "watch now, edit later" without a single word of copy. |
| **Sidebar Notebook section open (browsing)** | Rail + expanded notebook tree pane, canvas dimmed/occluded behind it on narrow viewports | Matches §2's verdict — one pane at a time, full height, is already the minimal-load answer; the only addition on this row is §2's Recents surface, which *reduces* load further by shortening the average browse rather than adding a new element. |
| **Mobile editor (phone)** | Full-bleed canvas, floating toolbar, collapsed top actions, bottom-sheet Properties only on demand | Lowest-chrome screen in the app by design (§20) — correctly so, since screen area is the scarcest resource on this shell and every §4–§9 panel had to prove its case to exist at all even on desktop. |

**Cross-cutting finding.** The one recurring extraneous-load risk across every dense row above (object
selected + behaviored, in particular) is *flat parameter lists* — every instance of this pattern in
the codebase should default to §7's common/advanced tiering, not just Rigid Body. **Action:** treat
the `tier` field proposed in §7 as a registry-wide convention applied to every `BehaviorSpec`, not a
one-off fix for one behavior type.

---

# 24. Complete Beginner Learning Experience

**The ideal, restated as a constraint.** "Learn by doing on a real blank page, one concept at a
time, no pre-built demo" is exactly right for this domain — and it's worth saying plainly that this
is not a hypothetical to design toward. It's already built, in `components/workspace/tutorial.tsx`,
and it is the single best-realized section of this entire masterplan against its own stated ideal.
This section audits it rather than re-inventing it, then addresses the real gap: the prompt asks for
a Beginner/Intermediate/Advanced *progression*, and what exists is six physics-content courses at
uneven difficulty with no explicit tiering between them.

**What already exists, verified against the "perfect tutorial" checklist:**
- Real canvas, nothing pre-built — steps operate on the user's own page (`TutorialPanel({ pageId
  })`), never a sandboxed demo scene. ✅
- One concept at a time — each step is a single sentence, a single expected action, one spotlighted
  control (`StepHighlight` tracks the exact DOM element via the same `aria-label` selectors §16 noted
  are load-bearing). ✅
- Self-verifying, not click-through — steps auto-complete by watching real store state (`hasB`,
  `hasSymbol`, `c.played`), with a live "Detected on your page!" vs. "Watching your page…" status. The
  user is never asked to click "I did this"; the software confirms it. This is a stronger claim than
  almost any onboarding tour in the design-tool category makes, and it's the single feature this
  document would most strongly tell another team to copy. ✅
- Never blocking — a `Skip` button is always available on unchecked steps, so a student who's already
  ahead of the tutorial (or whose action satisfied the intent in a way the checker didn't anticipate)
  is never trapped. ✅
- Persistent, resumable progress per course, stored per-device (`localStorage`, `PROGRESS_KEY`),
  survives navigating away and back. ✅

**Verdict, mapped onto the requested three tiers:**

## Beginner Tutorial
- **KEEP — `basics` and `mechanics` courses cover exactly the prompt's requested beginner
  progression**: workspace navigation (pan/zoom taught inline: "Two fingers (or Space+drag) pan;
  pinch or scroll zooms" appears as a note inside a drawing step, not a separate navigation lesson —
  correctly folded into doing rather than given as prerequisite reading), first object creation (pen
  → sketch recognition upgrades a scribble to a circle, teaching the recognition feature *as* the
  first-object step rather than as a separate concept), property editing (Inspector, via the mass →
  Play → change-k-while-running mechanics step), and a first full run with visible results (the graph
  tracing y(t) live). This is the requested progression, already correctly sequenced.
- **CHANGE — no explicit "start here" signal.** The course-picker list (`COURSES.map` in the
  `!course` branch) presents all six courses as equal-weight cards, ordered by array position
  (`basics, mechanics, circuits, optics, waves, quantum`), which happens to already put the two
  correct beginner courses first — but nothing in the UI *tells* a first-time user that. **Spec,
  minimal:** a small "Start here" pill on the `basics` card only, shown until that specific course is
  completed once per user — a one-boolean condition on existing progress state, no new mechanism.

## Intermediate Tutorial
- **KEEP — `circuits` course** (Ohm's law loop: place battery+resistor, wire by drawing ink between
  terminals, Play to see live conventional-current animation, then perturb resistance and watch I=V/R
  respond) as a correct intermediate step: it introduces a new interaction primitive (ink-as-wire,
  distinct from the mechanics course's drag-and-connect) while reusing the exact same "place → wire →
  Play → perturb-and-observe" rhythm the mechanics course already taught, which is the right kind of
  intermediate difficulty curve — a new domain, a familiar interaction shape.
- **CHANGE — the prompt's other intermediate topics (constraints, measurements, variables-as-a-
  concept, grouping, templates/reusable components, annotations, efficiency shortcuts, common
  mistakes) have no dedicated course.** These are *workflow* skills, not *physics-domain* skills, and
  currently the only place a student would organically learn them is by noticing UI affordances on
  their own (e.g., discovering the Variables tab in §7 by chance). **Spec:** a distinct `workflow`
  tutorial category, separate from the physics-domain `COURSES` array (a new `id`/`title`/`steps`
  list, same `Course` shape, same `TutorialPanel` renderer — this is additive content, not new
  mechanism) — e.g. "Working faster": add a page Variable and reference it from two objects' expr
  fields (teaches the shared-scope concept directly, using the mechanics course's existing g/k
  variables as material), group three objects and move them together, save a configured object as a
  reusable Library asset. Reuses 100% of the existing tutorial engine; it's a content gap, not an
  engineering one.

## Advanced Tutorial
- **KEEP — `optics`, `waves`, and `quantum` as advanced *physics-content* courses.** These are
  genuinely advanced (Huygens–Fresnel interference building up photon-by-photon at the Born-rule
  level, transmission-line Smith-chart behavior, quantum-well confinement and tunneling
  transmission) — content-wise these already exceed what "advanced tutorial" usually means in a
  learning-platform masterplan template. No change needed to the physics depth; it's real
  university-level material, correctly taught through the same watch-and-detect mechanism as the
  basics course, which is itself notable (the tutorial engine didn't need a more sophisticated
  authoring model to scale from "draw a circle" to "observe Born-rule photon statistics" — good sign
  the abstraction is right-sized).
- **ADD — a genuine *tool-mastery* advanced course is missing**, covering the prompt's actual
  "advanced tutorial" ask: power-user shortcuts (§12's `?` cheat-sheet, once built), the pinned-run
  comparison feature (§14's ADD), presenting on a room board (§18), and reviewing a submission
  (§18's annotation-overlay CHANGE). **Spec:** one more `workflow`-category course, "Teaching with
  SIMBLIP" — targeted at instructors specifically rather than students, since everything else in the
  tutorial system today is implicitly student-facing (built around a student's own experiment). This
  is the one piece of net-new tutorial *content* this document recommends; everything else in §24 is
  either already correct or a small addition to the existing list.

---

# 25. First-Time User Journey

**The ideal.** The fastest possible path from "I have an account" to "I saw physics happen because of
something I did" should require zero decisions the user isn't equipped to make yet — no "create your
first project" empty-state choice, no template gallery to evaluate. The first page should already
contain a working example, so the very first thing a new user can do is press one button (Play) and
watch it work, before they've done anything themselves.

**Verdict.**
- **KEEP — no public sign-up, institution-provisioned accounts** (`app/login/page.tsx`: "SIMBLIP is
  licensed to institutions, and accounts are provisioned by the institution admin"). For a classroom
  tool this is the right trust model, not a limitation to route around — it means the first thing
  *every* user experiences is a real login with an identity the institution already vouches for, with
  no email-verification/plan-selection/self-serve friction to design at all. Sign-in already redirects
  straight to `homeFor(profile.role)` on success, and re-entrant on an already-valid session (the
  `init()` check before the form even renders) — correct, minimal, gets out of the way fast.
- **KEEP — the auto-seeded "Welcome" page is close to the ideal first-run experience already.**
  `shell.tsx`'s first-notebook seed creates variables (`g=9.81`, `k=30`), an amber welcome Note with
  plain-language instructions ("Everything here is a drawing with behaviors attached. Press ▶ Play"),
  and a fully assembled hanging spring–mass system built through the *same* component factory a
  manual placement would use (`componentById('spring')!.create(...)`) — meaning it's not a special
  read-only demo object; the new user can immediately drag it, select it, and open its real Inspector
  properties. This is precisely right: the first thing shown is not a screenshot of what's possible,
  it's a live, editable, already-correct example that happens to also be a genuine object.
- **CHANGE — the guided tutorial itself defaults closed and isn't surfaced on this exact page.**
  `shell.tsx`: `const [tutorialOpen, setTutorialOpen] = useState(false)` — the single strongest
  onboarding mechanism this document found (§24) requires a first-time user to notice and click a
  GraduationCap toggle before it ever appears. Given the Welcome page already primes exactly the
  `basics`/`mechanics` courses' content (same variables, same spring–mass setup), this is a low-risk,
  high-value connection to close. **Spec:** auto-open `TutorialPanel` (pre-selected to the `basics`
  course) the first time a brand-new account's seeded Welcome page loads — gated on a single
  `hasSeenTutorialPrompt` flag in the same per-user store that already tracks course progress, so it
  fires exactly once per account, never again, and never for any other page. This is a one-line
  behavior change (flip the default open-state under a narrow, already-available condition), not new
  UI.
- **ADD — nothing else.** Once the tutorial-visibility gap above is closed, the rest of this journey
  (seeded working example → self-verifying guided first steps → real Play → real graph) already
  satisfies "remove every moment of uncertainty" about as well as it can within a login-gated,
  institution-provisioned product. Resist adding a template gallery or "choose your path" screen
  before the Welcome page — that would reintroduce exactly the evaluate-before-you-can-start friction
  this section's ideal explicitly rules out.

---

# 26. Expert Mode

**The ideal.** Progressive disclosure should be *reversible by usage*, not a permanent mode switch a
user has to find and flip — the interface should quietly reveal more as behavior demonstrates
readiness (opening the same collapsed "Advanced" param group three sessions running is a stronger
readiness signal than any onboarding-quiz could produce), without ever hiding something an expert
already knows how to use once they've used it.

**Verdict.**
- **KEEP — expertise is already expressed through infrastructure, not a mode flag**, across every
  layer this document reviewed: the same `ExprInput` accepts a bare number from a beginner or a full
  variable expression from an expert, with no separate "advanced input" field; the same behavior
  registry produces both the beginner's Rigid Body and the "advanced" transmission-line/quantum-well
  behaviors the `waves`/`quantum` courses use; the same toolbar and creation funnel serve a first-time
  circle and a professor's 40-object circuit. There is no fork in the product for "expert users" today
  because the architecture doesn't require one — capability scales with what the user chooses to type
  or attach, not with a settings toggle. This is the correct default position, and this document's
  additions (§7's common/advanced param tiering, §24's workflow course) are deliberately designed to
  extend that same pattern rather than introduce a first "beginner mode / expert mode" toggle
  anywhere in the product.
- **CHANGE — the one place a real tier switch is being proposed (§7's per-param `tier` field) should
  default its disclosure state to *usage-derived*, not a single global preference.** Concretely: track
  a per-user, per-behavior-type "has opened Advanced" boolean (one bit per behavior type touched,
  trivial to store alongside existing preferences) and default that specific behavior's Advanced
  section to open on subsequent uses once it's been opened once — so a student who dug into
  `showTrail` for one Rigid Body doesn't have to re-expand it on their fifth Rigid Body of the
  session, while a different student who's never opened Advanced for anything still gets the calmer
  collapsed default. This is a small, local rule (remember per behavior-type, not globally) that
  achieves "reveal power over time" without a settings-panel expert-mode toggle to discover in the
  first place.
- **ADD — surface the keyboard-shortcut registry (§12) as the expert on-ramp.** Once `lib/
  shortcuts.ts` exists, the `?` cheat-sheet overlay it enables is itself the correct "eventually
  beginners become experts" mechanism the prompt asks for — not a mode switch, but a reference a user
  reaches for with increasing frequency as they internalize the app, then stops needing at all once
  the shortcuts are muscle memory. This is a better match for how expertise actually develops than
  any explicit mode toggle would be.

---

# 27. UX Critique — ranked

A direct, unsparing pass, ranked by (impact on a real class using the product) × (how cheap the fix
is relative to that impact) — cheapest, highest-leverage first. Every item below was already spec'd
earlier in this document; this section exists only to force a priority order rather than a flat list
of forty co-equal recommendations, since the prompt explicitly asks this document to end with a
ranked brutal audit rather than another exhaustive catalogue.

1. **The best onboarding feature in the product is off by default and undiscovered on the exact page
   built to showcase it (§25).** This is the single highest-leverage fix in this entire document: a
   one-line default-state change connects a first-time user's seeded demo page directly to a
   tutorial system that already, today, teaches it correctly. Every hour spent on any other item in
   this critique before this one is mis-prioritized.
2. **Ten-parameter flat Rigid Body panel is the single densest, most intimidating screen a beginner
   hits, at the exact moment (right after their first successful behavior-attach) they should feel
   momentum, not a form (§7, §23).** Tiering into common/advanced is a small, mechanical change
   (one field on an existing spec type) with an outsized effect on the app's single worst cognitive-
   load spike.
3. **No shortcut registry means no `?` cheat-sheet, and every future shortcut is one more
   `addEventListener` call that can silently collide with an existing binding (§12).** Cheap to build
   now, expensive to retrofit once the binding count triples — this is a "pay it now while it's a
   10-line migration" item, not a "nice eventually" item.
4. **No physically-impossible-value validation on behavior params (negative mass, restitution >1)
   means the very first wrong-but-syntactically-valid mistake a student makes produces a confusing
   silent physics glitch instead of a clear message, right when SimScript's diagnostics prove the
   team already knows how to write a good one (§7, §15).** The gap is more embarrassing for being
   adjacent to work that's already excellent.
5. **`lib/store/layout.ts` still carries full two-panel dock-arrangement machinery
   (`moveSide`/`swapOrder`/`merged`) for a UI that only ever mounts one panel through it (§4).** Not
   user-facing, but it's exactly the kind of dead flexibility that costs the next engineer real time
   figuring out whether it's load-bearing before they can safely touch `Dock` or `Sidebar` — cheap to
   delete now, a genuine time-sink to untangle later once more code has grown around the assumption
   that it might still matter.
6. **The six tutorial courses are presented as one flat, equal-weight list with no difficulty
   signal, so "Basics" and "Quantum — confinement & tunneling" read as equally-appropriate first
   choices (§24).** A single "Start here" pill is disproportionately cheap for how much it clarifies
   the very first decision a new user makes inside the tutorial system.
7. **Everything else in this document** — alignment guides, a mini-map, a measurement tool, pinned-run
   comparison, inline math in text blocks, submission-review-as-annotation-overlay, accent-color
   contrast audit, tablet rotate/two-finger gestures, AI-draft rationale text — is real, spec'd, and
   worth doing, but none of it is *urgent* the way items 1–6 are: each is additive capability for an
   app whose core loop (draw → behavior → Play → observe, live-editable throughout) is already
   sound, well-architected, and — per the volume of KEEP verdicts in this document relative to CHANGE
   and ADD — already closer to its own first-principles ideal than most products this thoroughly
   audited turn out to be.

---

*End of blueprint. Companion reading: `docs/design-system.md` (visual tokens), `docs/architecture.md`
(geometry+behaviors, data flow), `docs/ui-simplification-plan.md` (the prior panel-consolidation pass
this document validates and extends). Sections can be expanded individually on request — this is a
first full pass across all 27 requested areas, calibrated for signal over volume per the grounded
approach chosen for this document.*
