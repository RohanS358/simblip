'use client'

// 3D trajectory view for the graph object. Reinterprets the first three
// plotted panels (series/formulas) as X, Y(up), Z instead of each vs
// xChannel — one parametric curve rather than N lines. Shares `rows` with
// the 2D path (docs/graph-engine.md); this file only differs in how those
// rows are projected and rendered.
//
// Calculus overlays translate rather than reuse the 2D SVG layer:
//  - derivative → the tangent/velocity VECTOR r'(t) at a scrubbed point
//    (an ArrowHelper), since "slope" isn't meaningful in 3D but velocity is.
//  - integral → a shaded "curtain" between the curve and the floor of the
//    plotted Y-range over [intA, intB], colored the same as the trajectory.
// Hover-to-scrub isn't available the way recharts gives it for free in 2D
// (no natural mouse→domain mapping over a rotatable scene), so a slider
// drives the scrub position instead.

import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Line, Grid, Html, OrbitControls, Bounds } from '@react-three/drei'
import { useHeightRamp, useThemeColor, sampleHeightRamp } from '@/lib/render/theme-color'
import { useSharpDpr } from '@/lib/render/use-sharp-dpr'
import { fmtNum } from '@/lib/scene/format'

const SIZE = 5 // display cube extent per axis, scene units

interface Bounds {
  min: number
  max: number
}

function axisBounds(rows: Record<string, number>[], key: string): Bounds {
  const vals = rows.map((r) => r[key]).filter((v) => Number.isFinite(v))
  if (vals.length === 0) return { min: 0, max: 1 }
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (min === max) {
    min -= 1
    max += 1
  }
  return { min, max }
}

const scaleTo = (v: number, b: Bounds) => ((v - b.min) / (b.max - b.min)) * SIZE - SIZE / 2

export interface Graph3DAxis {
  key: string
  name: string
  color: string
}

interface Graph3DProps {
  rows: Record<string, number>[]
  axes: [Graph3DAxis, Graph3DAxis, Graph3DAxis]
  xChannel: string
  deriv: boolean
  integ: boolean
  intA: number
  intB: number
}

function AxisLabel({ position, children }: { position: [number, number, number]; children: React.ReactNode }) {
  return (
    <Html position={position} center distanceFactor={8} style={{ pointerEvents: 'none' }}>
      <span className="whitespace-nowrap font-mono text-[9px] text-muted-foreground">{children}</span>
    </Html>
  )
}

export function Graph3D({ rows, axes, xChannel, deriv, integ, intA, intB }: Graph3DProps) {
  const [ax, ay, az] = axes
  const ramp = useHeightRamp()
  const gridColor = useThemeColor('var(--border)')
  const axisColorX = useThemeColor(ax.color)
  const axisColorY = useThemeColor(ay.color)
  const axisColorZ = useThemeColor(az.color)
  const derivColor = useThemeColor('var(--accent-mint)')
  const [scrubT, setScrubT] = useState(1)
  const { ref: dprRef, dpr } = useSharpDpr<HTMLDivElement>()

  const validRows = useMemo(
    () => rows.filter((r) => Number.isFinite(r[ax.key]) && Number.isFinite(r[ay.key]) && Number.isFinite(r[az.key])),
    [rows, ax.key, ay.key, az.key]
  )

  const bx = useMemo(() => axisBounds(validRows, ax.key), [validRows, ax.key])
  const by = useMemo(() => axisBounds(validRows, ay.key), [validRows, ay.key])
  const bz = useMemo(() => axisBounds(validRows, az.key), [validRows, az.key])

  const points = useMemo(
    () =>
      validRows.map(
        (r) => new THREE.Vector3(scaleTo(r[ax.key], bx), scaleTo(r[ay.key], by), scaleTo(r[az.key], bz))
      ),
    [validRows, ax.key, ay.key, az.key, bx, by, bz]
  )

  const colors = useMemo(
    () =>
      validRows.map((r): [number, number, number] => {
        const t = (r[ay.key] - by.min) / (by.max - by.min || 1)
        const c = sampleHeightRamp(ramp, t)
        return [c.r, c.g, c.b]
      }),
    [validRows, ay.key, by, ramp]
  )

  const hasPlot = points.length > 1

  // Derivative: central-difference tangent/velocity vector at the scrubbed
  // row, in real data units (so speed is meaningful), placed at the scaled
  // point.
  const scrubIndex = hasPlot ? Math.round(scrubT * (validRows.length - 1)) : 0
  const tangent = useMemo(() => {
    if (!deriv || !hasPlot) return null
    const i = Math.min(Math.max(scrubIndex, 0), validRows.length - 1)
    const a = validRows[Math.max(0, i - 1)]
    const b = validRows[Math.min(validRows.length - 1, i + 1)]
    const dt = (b[xChannel] ?? 0) - (a[xChannel] ?? 0)
    const raw: [number, number, number] =
      dt === 0
        ? [0, 0, 0]
        : [(b[ax.key] - a[ax.key]) / dt, (b[ay.key] - a[ay.key]) / dt, (b[az.key] - a[az.key]) / dt]
    const dir = new THREE.Vector3(...raw)
    const speed = dir.length()
    return { origin: points[i], dir: speed > 0 ? dir.clone().normalize() : dir, speed, raw }
  }, [deriv, hasPlot, scrubIndex, validRows, points, ax.key, ay.key, az.key, xChannel])

  // Integral: a ruled "curtain" between the curve and the floor of the
  // plotted Y-range over [intA, intB] — area computed as trapezoids of
  // height (y - floorY) over horizontal distance traveled in the XZ base,
  // the direct 3D generalization of the 2D `integrate()` trapezoid loop.
  const curtain = useMemo(() => {
    if (!integ || !hasPlot) return null
    const band = validRows
      .filter((r) => r[xChannel] >= intA && r[xChannel] <= intB)
      .sort((p, q) => p[xChannel] - q[xChannel])
    if (band.length < 2) return null
    const floorY = -SIZE / 2
    const positions: number[] = []
    const vColors: number[] = []
    for (const r of band) {
      const top = new THREE.Vector3(scaleTo(r[ax.key], bx), scaleTo(r[ay.key], by), scaleTo(r[az.key], bz))
      const t = (r[ay.key] - by.min) / (by.max - by.min || 1)
      const c = sampleHeightRamp(ramp, t)
      positions.push(top.x, top.y, top.z, top.x, floorY, top.z)
      vColors.push(c.r, c.g, c.b, c.r, c.g, c.b)
    }
    const indices: number[] = []
    for (let i = 0; i < band.length - 1; i++) {
      const a0 = i * 2
      const b0 = i * 2 + 1
      const a1 = (i + 1) * 2
      const b1 = (i + 1) * 2 + 1
      indices.push(a0, b0, a1, b0, b1, a1)
    }
    let area = 0
    for (let i = 1; i < band.length; i++) {
      const p = band[i - 1]
      const q = band[i]
      const h1 = p[ay.key] - by.min
      const h2 = q[ay.key] - by.min
      const dx = q[ax.key] - p[ax.key]
      const dz = q[az.key] - p[az.key]
      const dl = Math.hypot(dx, dz)
      area += ((h1 + h2) / 2) * dl
    }
    return {
      positions: new Float32Array(positions),
      colors: new Float32Array(vColors),
      indices: new Uint16Array(indices),
      area,
    }
  }, [integ, hasPlot, validRows, xChannel, intA, intB, ax.key, ay.key, az.key, bx, by, bz, ramp])

  if (!hasPlot) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={dprRef}
        className="relative min-h-0 flex-1"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => e.stopPropagation()}
        // OrbitControls owns the wheel entirely once it's over this widget —
        // it dollies the camera on ANY wheel, with no ctrlKey check. Every
        // ancestor (canvas.tsx's board pan/zoom, doc-view.tsx/pdf-view.tsx's
        // page zoom) ALSO listens for wheel natively and doesn't stop at
        // preventDefault, so without this, scrolling to dolly the embedded
        // camera simultaneously panned/zoomed the page underneath it — the
        // widget's content visibly translated relative to the rest of the
        // page while "zooming" it. Capture-phase stopPropagation (an
        // ancestor of the R3F canvas, so it runs before OrbitControls' own
        // listener even sees the event) keeps every wheel gesture over this
        // widget local to it, regardless of modifier keys.
        onWheelCapture={(e) => e.stopPropagation()}
        // A right-click-drag to pan (OrbitControls) still ends in a native
        // 'contextmenu' event on release — left unstopped, that bubbled up
        // to canvas.tsx's own object context menu, which popped open over
        // the plot right as the pan finished.
        onContextMenu={(e) => e.stopPropagation()}
      >
        <Canvas
          frameloop="demand"
          camera={{ position: [SIZE * 1.1, SIZE * 0.9, SIZE * 1.1], fov: 45 }}
          // See surface3d.tsx: needed so PDF export's html2canvas pass can
          // actually read this WebGL canvas's pixels instead of capturing it
          // blank.
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
          // useSharpDpr: keeps the render target's resolution matched to the
          // widget's actual on-screen size, including any ancestor page-zoom
          // (doc-view/pdf-view) — see lib/render/use-sharp-dpr.ts.
          dpr={dpr}
          // R3F's own auto-sizing (react-use-measure) reads the container's
          // getBoundingClientRect — which, unlike a plain ResizeObserver,
          // DOES include ancestor CSS transforms — and by default
          // re-measures on every 'scroll' event, not just real resizes.
          // doc-view.tsx's zoom-anchor logic sets scrollLeft/scrollTop on
          // EVERY wheel tick of a ctrl+wheel zoom to keep the cursor's
          // content point fixed, and each of those is itself a scroll event.
          // So mid-zoom, this canvas's `size` (camera aspect, and Bounds'
          // fit target below) was being asynchronously reset via a stale,
          // already-transformed measurement on every tick — a moving target
          // Bounds kept re-fitting against, which is what read as jitter and
          // the origin visibly drifting. Turning off scroll-triggered
          // remeasurement leaves `size` to only change on an actual layout
          // resize (still correctly reacts to the fullscreen toggle etc.),
          // while useSharpDpr above independently — and smoothly — tracks
          // the live CSS zoom for resolution only.
          //
          // Un-debounced real resizes had the identical symptom on MOUNT:
          // react-use-measure's default `debounce.resize` is 0, so every
          // ResizeObserver tick during the layout's initial settling burst
          // (sidebar, the editor/viz splitter, other objects mounting
          // nearby, font metrics landing) committed immediately as a new
          // `size` — and each one restarted Bounds' fit animation from
          // wherever the camera was mid-flight, which is what read as the
          // trajectory jittering/snapping for the first second after the
          // widget appeared. Debouncing settles `size` the same way
          // useSharpDpr already settles `dpr`, so Bounds only fits once
          // layout has actually stopped moving.
          resize={{ scroll: false, debounce: 150 }}
        >
          {/* Bounds(fit, observe): see surface3d.tsx — re-frames camera
              distance to content on every container resize (including the
              fullscreen toggle), instead of leaving a fixed-FOV camera
              under-filling a much wider viewport. Distance-only along the
              current view direction, so manual orbit survives the refit. */}
          <Bounds fit clip observe margin={1.2}>
            <Grid
              args={[SIZE, SIZE]}
              position={[0, -SIZE / 2, 0]}
              cellColor={gridColor}
              sectionColor={gridColor}
              cellSize={SIZE / 10}
              sectionSize={SIZE / 2}
              fadeDistance={SIZE * 4}
              infiniteGrid={false}
            />
            {/* Conventional X/Y/Z axes through the data's centroid (the scaled
                cube is always centered at the origin by construction), each
                colored to match its source panel — a corner "bounding box"
                triad reads as off-center since all the axis chrome sits in one
                octant; a centered cross keeps the composition balanced and
                doubles as the answer to "where are X/Y/Z". */}
            <Line points={[[-SIZE / 2, 0, 0], [0, 0, 0]]} color={axisColorX} lineWidth={1.5} />
            <arrowHelper
              args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), SIZE / 2, axisColorX, SIZE * 0.09, SIZE * 0.045]}
            />
            <Line points={[[0, -SIZE / 2, 0], [0, 0, 0]]} color={axisColorY} lineWidth={1.5} />
            <arrowHelper
              args={[new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), SIZE / 2, axisColorY, SIZE * 0.09, SIZE * 0.045]}
            />
            <Line points={[[0, 0, -SIZE / 2], [0, 0, 0]]} color={axisColorZ} lineWidth={1.5} />
            <arrowHelper
              args={[new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), SIZE / 2, axisColorZ, SIZE * 0.09, SIZE * 0.045]}
            />
            <AxisLabel position={[SIZE / 2 + 0.3, 0, 0]}>
              {ax.name} ({fmtNum(bx.min)}…{fmtNum(bx.max)})
            </AxisLabel>
            <AxisLabel position={[0, SIZE / 2 + 0.3, 0]}>
              {ay.name} ({fmtNum(by.min)}…{fmtNum(by.max)})
            </AxisLabel>
            <AxisLabel position={[0, 0, SIZE / 2 + 0.3]}>
              {az.name} ({fmtNum(bz.min)}…{fmtNum(bz.max)})
            </AxisLabel>

            <Line points={points} vertexColors={colors} lineWidth={2.5} />

            {curtain && (
              <mesh>
                <bufferGeometry>
                  <bufferAttribute
                    attach="attributes-position"
                    args={[curtain.positions, 3]}
                    count={curtain.positions.length / 3}
                    itemSize={3}
                  />
                  <bufferAttribute
                    attach="attributes-color"
                    args={[curtain.colors, 3]}
                    count={curtain.colors.length / 3}
                    itemSize={3}
                  />
                  <bufferAttribute
                    attach="index"
                    args={[curtain.indices, 1]}
                    count={curtain.indices.length}
                    itemSize={1}
                  />
                </bufferGeometry>
                <meshBasicMaterial vertexColors transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
              </mesh>
            )}

            {deriv && tangent && (
              <>
                <mesh position={tangent.origin}>
                  <sphereGeometry args={[0.045, 12, 12]} />
                  <meshBasicMaterial color={axisColorY} />
                </mesh>
                {tangent.speed > 0 && (
                  <arrowHelper
                    args={[tangent.dir, tangent.origin, Math.min(2.2, 0.6 + tangent.speed * 0.2), derivColor, undefined, undefined]}
                  />
                )}
              </>
            )}
          </Bounds>

          <OrbitControls makeDefault target={[0, 0, 0]} enableDamping enablePan enableZoom enableRotate />
        </Canvas>
      </div>

      {deriv && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/60 bg-accent/20 px-2 py-1 font-mono text-[9.5px]">
          <input
            type="range"
            min={0}
            max={1}
            step={1 / Math.max(1, validRows.length - 1)}
            value={scrubT}
            onChange={(e) => setScrubT(Number(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-3 w-24 accent-[var(--accent-mint)]"
            aria-label="Scrub the tangent point along the trajectory"
          />
          {tangent ? (
            <span className="text-[var(--accent-mint)]">
              d/d{xChannel} = ({fmtNum(tangent.raw[0])}, {fmtNum(tangent.raw[1])}, {fmtNum(tangent.raw[2])}) · |v| ={' '}
              {fmtNum(tangent.speed)}
            </span>
          ) : (
            <span className="text-muted-foreground">Drag to scrub the tangent point…</span>
          )}
        </div>
      )}

      {integ && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/60 bg-accent/20 px-2 py-1 font-mono text-[9.5px]">
          <span className="text-muted-foreground">
            ∫ over {fmtNum(intA)}…{fmtNum(intB)} d{xChannel}
          </span>
          {curtain ? (
            <span style={{ color: ay.color }}>
              curtain area ({ax.name}·{ay.name} vs floor) = {fmtNum(curtain.area)}
            </span>
          ) : (
            <span className="text-muted-foreground">No samples in range.</span>
          )}
        </div>
      )}
    </div>
  )
}
