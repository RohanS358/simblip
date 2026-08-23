// OOXML `prst` preset-shape point tables, split out of lib/store/pptx-import.ts.
//
// This is a constant table, but canvas.tsx, toolbar.tsx and sundial-dock.tsx
// used to import it straight from pptx-import — which top-level imports JSZip
// and the whole 1200-line OOXML compiler, dragging both into the workspace's
// first-load chunk for a lookup table. Keep this module dependency-free.

/** Unit-bbox point sets (0-1 range, scaled by box w/h at call site) for the
 *  polygon prst shapes geometryKindOf recognizes. */
export const PRST_POLYGON_POINTS: Record<string, number[][]> = {
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  rtTriangle: [[0, 0], [0, 1], [1, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  parallelogram: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]],
  trapezoid: [[0.25, 0], [0.75, 0], [1, 1], [0, 1]],
  pentagon: [[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]],
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  octagon: [[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]],
  star5: [
    [0.5, 0], [0.62, 0.35], [1, 0.35], [0.69, 0.57], [0.81, 0.91],
    [0.5, 0.7], [0.19, 0.91], [0.31, 0.57], [0, 0.35], [0.38, 0.35],
  ],
  rightArrow: [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]],
  leftArrow: [[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]],
  upArrow: [[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]],
  downArrow: [[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]],
}
