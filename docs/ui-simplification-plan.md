# SIMBLIP — UI Simplification Plan

**Goal:** the app is functionally complete (per [implementation-plan.md](implementation-plan.md),
[syllabus-coverage-plan.md](syllabus-coverage-plan.md)) but the *surface area* is starting to
work against new users. This plan reduces what's visible at any one moment without removing any
capability, and gives desktop, tablet and phone the same mental model instead of three unrelated
layouts that happen to share components.

Status: plan only — nothing in this document has been implemented yet.

---

## 1. What's actually on screen today (audit)

| Surface | File | What it holds |
|---|---|---|
| Floating dock | [toolbar.tsx](../components/workspace/toolbar.tsx) | 10 mode tools (select→code) + shapes-group + **2 ink toggles** + **3 touch-only toggles** + calculator + components + attach + Ask AI = **up to 17 controls**, one flat row/column |
| Sidebar (left) | [sidebar.tsx](../components/workspace/sidebar.tsx) | Notebook/Section/Page tree (top ~54%) **permanently split** with the institution Library (bottom ~46%) — two unrelated jobs sharing one panel, both fighting for height |
| Component palette | [palette.tsx](../components/workspace/palette.tsx) | A *third* floating panel, opened from the dock, tabbed by domain (mechanics/electrical/…) |
| Calculator | [calculator.tsx](../components/workspace/calculator.tsx) | A *fourth* floating panel, also opened from the dock |
| AI panel | [ai-panel.tsx](../components/workspace/ai-panel.tsx) | A *fifth* floating panel, also opened from the dock |
| Inspector (right) | [inspector.tsx](../components/workspace/inspector.tsx) | Contextual — only appears with a selection. Already well-scoped, not part of this problem. |
| Settings | [settings-dialog.tsx](../components/workspace/settings-dialog.tsx) | 8 tabs; **the ink-to-shape / ink-annotate toggles are already duplicated here** (Workspace tab) *and* on the dock |
| Mobile | [mobile-shell.tsx](../components/workspace/mobile-shell.tsx) | A completely separate nav model (Home → Notebook → Editor + hamburger drawer) that reimplements notebook tree, library, settings entry, theme toggle, etc. a second time, with its own ordering |

**The core problem isn't any single element — it's that the dock tries to be a mode-switcher,
a toggle-bank, and an app-launcher at once, while the sidebar is locked into exactly one layout
no matter what the user is trying to do, and mobile invented a fourth information architecture
that doesn't match either.** Every new feature has been added as "one more icon," so the icon
count only grows.

---

## 2. Principles this plan optimizes for

- **Hick's Law** — decision time rises with the number of visible choices. Cutting the dock from
  17 to 11 targets and moving everything else behind two clicks (rail → section) measurably
  lowers time-to-first-action for a new user.
- **Miller's 7±2 / chunking** — 11 dock items is already at the edge of what scans as one group;
  grouping the rest into 4 *named* sidebar sections (Notebook, Components, Tools, Library) turns
  "17 loose icons" into "1 row of tools + 4 labeled drawers," which is far easier to hold in
  working memory.
- **Progressive disclosure** — advanced/occasional controls (calculator, physics components,
  touch-assist toggles) shouldn't cost permanent screen real estate for the 90% of the time
  they're not needed.
- **Recognition over recall** — a rail with icon + label beats a memorized keyboard-shortcut-only
  flyout; it's also self-documenting for a first-time user, which matters a lot for a teaching
  tool used by students who didn't onboard themselves.
- **Consistency across breakpoints (spatial/model consistency)** — right now desktop, tablet and
  phone don't just resize, they *reorganize concepts differently*. A student who learns "Tools"
  lives under one icon on their laptop should find the same label in the same relative position
  on the classroom iPad. This is as much a psychological win (transferable muscle memory) as a
  code-reuse one.
- **Don't relocate without a reason** — anything staying in the dock stays because it's either a
  *drawing mode* (select/pen/shaper/eraser) or an *inline object* you place by clicking-then-
  drawing on the canvas (text/note/formula/graph/table/shapes/document). Anything that's a
  *utility, browser, or toggle* moves out.

---

## 3. The floating dock — reduced to 11

Keep exactly what you specified, in this order:

`Select · Pen · Shaper · Eraser · Text · Note · Formula · Graph · Table · Shapes · Document`

("Shapes" = the existing shapes-group button — line/circle/oval/square/rect/triangle…octagon.
Recommend keeping the tooltip **"Shapes"** rather than "Polygons," since a line and circle aren't
polygons; the icon and behavior don't change, only the label question. Happy to rename it
literally to "Polygons" if you'd rather match your notes verbatim — flag it either way.)

**Removed from the dock, and where each one goes:**

| Control | Was | Goes to | Why there |
|---|---|---|---|
| Ink → shape toggle | dock button | *(remove; already in Settings → Workspace)* | Exact duplicate control already exists in [settings-dialog.tsx:490](../components/workspace/settings-dialog.tsx#L490) — this is a pure deletion, no new home needed |
| Ink annotations toggle | dock button | *(remove; already in Settings → Workspace)* | Same — [settings-dialog.tsx:496](../components/workspace/settings-dialog.tsx#L496) |
| Touch ortho-pen / free-move / measure | dock buttons, touch-only | **Pen settings popover**, new "Touch assist" section | These only ever modify how the *pen* behaves on touch input — [pen-settings.tsx](../components/workspace/pen-settings.tsx) is already, per its own code comment, "the ONE control surface for the pen." Splitting touch modifiers into a different surface than the rest of pen behavior is the inconsistency; folding them in removes 3 icons and improves the pen story at once |
| Calculator | dock button | **Sidebar → Tools** | It's a utility you reach for occasionally, not a drawing mode — belongs in a browsable drawer, not permanently parked on the canvas edge |
| Components (physics/circuit palette) | dock button → floating popup | **Sidebar → Components** | This is literally a *browser* (domain tabs, scrollable grid) — sidebars are for browsing, floating popups pinned to a toolbar button are for quick pickers. Moving it removes the palette's dependency on tracking the dock's position/side entirely (see `useDockRect` gymnastics in [toolbar.tsx:217-248](../components/workspace/toolbar.tsx#L217-L248) and the `slideFrom` logic in [palette.tsx:36-44](../components/workspace/palette.tsx#L36-L44) — both go away) |
| Ask AI | dock button → floating panel | **A dedicated corner bubble**, not the dock and not buried in the rail | AI chat is a distinct product surface (violet-tinted, conversational), not a drawing tool or a browsable list — it deserves the same "always-reachable, never in your way" treatment chat assistants get everywhere else (Intercom/Linear pattern: small circular button in the canvas corner opposite the dock). Keeping it *outside* both the dock and the rail also means the AI panel's open/close no longer competes for dock space at all |

Net: dock drops from up to 17 controls to a fixed 11. It never changes size based on device
class, role, or feature flags anymore — what you see is the complete list, always.

---

## 4. The sidebar — from "one fixed split" to a rail + one open section

Replace the current permanent 54/46 split in [sidebar.tsx](../components/workspace/sidebar.tsx)
with an **activity-bar pattern** (VS Code / Linear's left rail):

```
┌──┬─────────────────────┐        ┌──┐
│▤ │                     │        │▤ │   ← collapsed: just the rail,
│◇ │   (open section      │  ⇄    │◇ │      maximum canvas width
│▦ │    content)          │        │▦ │
│▥ │                     │        │▥ │
└──┴─────────────────────┘        └──┘
```

- **Rail** (fixed ~48px strip, always visible on desktop): 4 icons —
  **Notebook** (book icon — today's tree), **Components** (today's palette content),
  **Tools** (calculator + quick-insert shortcuts for table/graph/code), **Library**
  (today's `LibraryPanel`, already built).
- Clicking a rail icon opens **one** panel showing that section's content at the sidebar's
  usual width (persisted, same `simblip-sidebar-w` mechanism already in
  [sidebar.tsx:138-141](../components/workspace/sidebar.tsx#L138-L141)). Clicking the same icon
  again, or clicking a rail icon while nothing matches the current state, collapses back to the
  bare rail.
- Only one section is expanded at a time — no more permanent internal split fighting over
  vertical space. The Notebook tree finally gets the *entire* panel height when it's open, and so
  does the Library when *it's* open.
- **Why "Tools" also lists table/graph/code even though they're already dock buttons:** the dock
  versions are "pick a mode, then draw/click on the canvas" (fast, muscle-memory, one object at a
  time). The sidebar versions are a *browsable insert panel* — useful when you want to drop a
  couple of tables while reading through existing content without hunting for the dock. This
  mirrors what Figma/Notion do (a floating "+" tool *and* a slash-menu/insert panel) and isn't
  redundant in practice, it's two different intents reaching the same object type. "Code" lives
  *only* here, not on the dock — it's the least-used object type for a physics/engineering
  notebook and doesn't earn permanent dock real estate.

**Implementation shape:** extract a single config —
`lib/store/sidebar-sections.ts` — listing `{ id, icon, label, render }` for the four sections.
`sidebar.tsx` becomes: rail (maps the config to icon buttons) + one active section's `render()`.
This same config is what lets tablet and phone reuse the *identical* taxonomy (§6).

---

## 5. Settings — light consolidation while we're in here

Not core to your ask, but cheap given the dock/sidebar rework touches the same surface:

- Fold the **Workspace** tab (just 2 toggles, [settings-dialog.tsx:489-502](../components/workspace/settings-dialog.tsx#L489-L502)) into the **Notebook** tab as an "Editing behavior" section. A tab that holds two switches doesn't earn its own slot in an 8-tab strip that already scrolls ([settings-dialog.tsx:399](../components/workspace/settings-dialog.tsx#L399) even leaves a comment noting the strip stopped fitting).
- Result: 7 tabs (Profile, Appearance, Pen, Notebook, Math, Shortcuts, About) — still a scroll, but one fewer, and removes an entire tab whose *only* content was already duplicated at the dock (soon to be removed there anyway).

---

## 6. Per-device application

The device split stays exactly where it already is —
[hooks/use-mobile.ts](../hooks/use-mobile.ts)'s `useIsMobile()` (touch vs. mouse+hover, not
viewport width) chooses [shell.tsx](../components/workspace/shell.tsx) vs.
[mobile-shell.tsx](../components/workspace/mobile-shell.tsx); `useIsNarrow(767)` then splits
tablet from phone *inside* `MobileShell`. This plan doesn't change that detection — it changes
what each shell shows, using one shared taxonomy so the three feel like one app.

### Desktop (mouse + hover)
- Rail is always visible at the canvas edge (collapsed by default, remembers last open section
  per device via existing localStorage pattern).
- Dock: the 11-item version, position configurable exactly as today (Settings → Notebook → Dock
  position).
- AI bubble: floats in whichever corner the dock *isn't* occupying.
- Inspector: unchanged.

### Tablet (touch, wide enough for panels — iPad landscape/portrait)
- Today's `MobileShell` buries every nav concept (notebooks, shared-with-me, assignments,
  review, tutorials, theme, settings) inside one hamburger drawer
  ([mobile-shell.tsx:191-339](../components/workspace/mobile-shell.tsx#L191-L339)) — a flat list
  with no grouping.
- Replace the hamburger drawer's *workspace* portion with the same rail: a slim persistent icon
  strip at the left edge that opens a slide-over sheet per section (Notebook/Components/Tools/
  Library), same taxonomy as desktop. App-level items (tutorials, theme, settings, sign out) stay
  in a much shorter "..." menu — they're not workspace navigation, they shouldn't share a list
  with it.
- This also means the tablet no longer needs its own copy of the notebook tree UI
  ([mobile-shell.tsx:250-278](../components/workspace/mobile-shell.tsx#L250-L278)) — it renders
  the same Notebook section component the rail already has.
- Dock and Palette/Calculator here are the same reused components as desktop.

### Phone (touch, narrow — the actual "no room for panels" case)
- Screen is genuinely too narrow for a persistent rail *or* side panels — this is the one place
  a hamburger drawer is still the right call. But its **contents get reordered to the same
  taxonomy**: Notebook, Components, Tools, Library grouped and labeled identically to the rail,
  followed by a clearly separated "App" group (tutorials, theme, settings, sign out) — instead of
  today's single undifferentiated list.
- Inspector stays a bottom sheet (already correct for thumb reach).
- Everything else (full-bleed canvas, dock, tab strip only appearing once there's something to
  switch between) is already right and shouldn't change.

**Net effect:** "Notebook / Components / Tools / Library" becomes one taxonomy a user learns
once and finds — rail on desktop, rail-as-sheet on tablet, grouped drawer section on phone —
everywhere. Today those four concepts don't even *exist* as a named group anywhere in the app.

---

## 7. Smaller suggestions worth doing in the same pass

1. **Disambiguate "Document."** The dock's paperclip is "attach a session file"; the sidebar's
   "New document" creates a Doc *page*. Once "Document" is the dock label you asked for, keep its
   tooltip specific ("Attach file — this session only") so it doesn't read as a shortcut to make
   a Doc page.
2. **Second-click-for-options, consistently.** Pen already opens its settings via double-click
   while active. Extend the same gesture to Shapes/Table/Graph/Formula (double-click the already-
   active tool → its quick options, e.g. default table size, graph channel presets) instead of
   making every micro-setting a trip to the sidebar. Keeps "recognition over recall" close to the
   point of use; the sidebar Tools section stays for the heavier stuff (calculator, browsing).
3. **One-time spotlight on ship.** Existing users have muscle memory for the current dock/sidebar.
   A silent IA change causes "where did X go" friction even when the new version is better. A
   single dismissible coach-mark ("Components and Tools moved here →") the first time someone
   opens the app post-update avoids that — cheap, and this is exactly the kind of change where
   skipping it costs goodwill.
4. **Command palette as the escape hatch.** ⌘K already exists
   ([command-palette.tsx](../components/workspace/command-palette.tsx)). Once IA changes, make
   sure it can jump straight to any rail section or dock tool by name/keyword — for power users,
   "search for it" should always be faster than any click path, which also de-risks any location
   choice above (if the rail-click path is wrong for someone, search bails them out).
5. **Merge the two floating strips visually.** `Transport` (play/pause/step/speed) and `Toolbar`
   currently float as two independent elements near each other. Once the dock is down to a
   settled 11 items, consider anchoring Transport as a slim strip that always sits flush against
   the dock's edge (whichever side it's docked to) rather than two separately-animated floating
   pieces — reduces the "debris on the canvas" feeling.

---

## 8. Implementation checklist (file-level)

- [ ] `components/workspace/toolbar.tsx` — drop ink-toggle buttons, calculator button, components
      button, touch-only toggle buttons, Ask AI button. Down to 11 `ToolButton`s.
- [ ] `components/workspace/pen-settings.tsx` — add "Touch assist" section (ortho-pen/free-move/
      measure), reading `useWorkspaceStore`, rendered only when `useIsTouchDevice()`.
- [ ] `lib/store/sidebar-sections.ts` (new) — `{ id: 'notebook'|'components'|'tools'|'library', icon, label, render }[]`, single source of truth for rail + tablet sheet + phone drawer grouping.
- [ ] `components/workspace/sidebar.tsx` — rewrite as rail + one active section using the config above; today's tree becomes the "notebook" section's `render()`, `LibraryPanel` becomes "library"'s.
- [ ] `components/workspace/palette.tsx` — de-float; becomes the "components" section's `render()` (domain tabs + grid, same UI, no more `useDockRect`/`slideFrom` positioning math).
- [ ] `components/workspace/calculator.tsx` — becomes the "tools" section's `render()` (keep a floating variant only if tablet/phone still want it inline in the editor — verify against §6 before deleting the floating path).
- [ ] New small component for the AI corner bubble (desktop + tablet + phone), replacing the dock's Ask AI button; wraps existing `ai-panel.tsx` open/close state.
- [ ] `components/workspace/settings-dialog.tsx` — fold Workspace tab's two `PrefRow`s into Notebook tab.
- [ ] `components/workspace/mobile-shell.tsx` — swap the drawer's flat workspace list for the shared rail-as-sheet (tablet) / grouped-by-section (phone) rendering; delete the now-duplicate inline notebook-tree JSX.
- [ ] Optional: one-time coach-mark component gated on a `localStorage` "seen" flag, per §7.3.

Nothing here touches `lib/store/layout.ts` (`PanelId`/`Side` for pages↔inspector docking) — that
system is orthogonal and stays as-is; the sidebar's internal rail state is local UI state, not a
dockable panel.
