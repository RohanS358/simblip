# SIMBLIP — Design System

## Direction

"Apple designed MATLAB for engineering students." References: VisionOS, Freeform, Linear, Arc,
Concepts. The workspace should feel like precision instruments floating over calm paper.

## Foundations

### Typography
- **Plus Jakarta Sans** (variable, 200–800, from `public/fonts` via `next/font/local`) — the only
  UI typeface. Why local: deterministic loading, no layout shift, offline dev.
- **JetBrains Mono** for code, expressions and numeric readouts (tabular feel for live values).
- Scale: 11 (micro labels) / 12.5 (UI) / 14 (body) / 16 / 20 / 28 (titles). UI text sits at
  12.5–13px like Figma/Linear — a workspace, not a website.

### Color
- Paper: near-white warm gray (`oklch 0.982`), dark mode: deep neutral (`oklch 0.16`).
- Ink: soft black, never pure `#000`.
- Accents are **calm pastels** with one signal blue for selection/focus:
  - `--accent-blue` (selection, primary actions)
  - `--accent-violet` (AI)
  - `--accent-mint` (simulation / running state)
  - `--accent-amber` (variables / formula)
  - `--accent-rose` (errors, destructive)
- Why pastel + one blue: multi-domain canvases get colorful fast (graphs, circuits, ink). The
  chrome must recede; only *state* gets saturated color.

### Liquid glass surfaces
Panels (sidebar, toolbar, inspector) are frosted:
```
background: color-mix(in oklch, var(--card) 72%, transparent);
backdrop-filter: blur(24px) saturate(140%);
border: 1px solid --border (hairline, 1px, low alpha);
shadow: 0 8px 30px rgb(0 0 0 / .06)   ← soft, single, never stacked
```
Utility classes: `.glass`, `.glass-strong`, `.hairline`.

### Space & radius
- 4px base grid. Panels use 12–16px padding; canvas chrome floats with 16–24px margins.
- Radius: 10px controls, 16px panels, 20px floating toolbars — continuous-corner feel.

### Motion
- Framer Motion for panel enter/exit; springs `{ type: "spring", stiffness: 380, damping: 30 }`.
- Micro-interactions ≤ 200ms; nothing on the canvas itself animates except physics.
- Why: animation must never compete with the simulation for perceived motion.

## Never
- No Bootstrap/Material look, no heavy shadows, no gradients on chrome, no pure black/white,
  no default focus rings (custom 2px accent ring, offset 2px).

## Components
Reuse shadcn/ui primitives (already in `components/ui`) and re-skin via the token layer only —
never fork a primitive to restyle it. New workspace components live in `components/workspace`.
