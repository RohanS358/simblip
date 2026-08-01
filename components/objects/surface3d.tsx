'use client'

// 3D Graph — the surface-plot analog of the 2D Graph's function-plotter
// mode: pick two base axes and plot the third as a function of them, the
// literal "3D version of the 2D grid." Two input styles on the same text
// field, auto-detected (lib/render/surface-math.ts):
//   explicit  sin(x)*cos(y)            → one direct height-field
//   implicit  x^2 + y^2 + z^2 = 25     → root-found, renders as two caps
// so plane and sphere equations both just work by typing them in. Rotate/
// pan/zoom via OrbitControls, fullscreen via the generic canvas.tsx
// mechanism (COMPONENT_UI_KINDS / the fullscreen-eligible kind list).
//
// Calculus overlays mirror the 2D graph's philosophy — not extra surfaces,
// annotations at a point: derivative → the tangent PLANE + partials at a
// probe (x,y), integral → the volume under the surface over the base
// rectangle. Both are explicit-formula-only, same as the 2D graph restricts
// its tangent/area overlays to a single well-defined function.

import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { Line, Grid as DreiGrid, Html, OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei'
import { Box, TrendingUp, Sigma } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { usePrefs } from '@/lib/store/preferences'
import { evalExpr, type Scope } from '@/lib/formula/engine'
import { fmtNum } from '@/lib/scene/format'
import { useSpectrumRamp, useThemeColor, resolveThemeColor, sampleHeightRamp } from '@/lib/render/theme-color'
import {
  baseAxes,
  integrateGrid,
  isImplicitExpr,
  partials,
  sampleSurface,
  type Axis,
  type SurfaceBounds,
  type SurfaceGrid,
} from '@/lib/render/surface-math'
import { GRAPH_COLORS } from './graph'
import { getString, type ObjectRendererProps } from './types'

const SIZE = 5 // display cube extent per axis, scene units
const DEFAULT_RES = 28

const splitList = (s: string) =>
  s.split(';').map((c) => c.trim()).filter(Boolean)

const boundOf = (expr: string, fallback: number, scope: Scope): number => {
  if (!expr.trim()) return fallback
  const { value, error } = evalExpr(expr, scope, NaN)
  return error || !Number.isFinite(value) ? fallback : value
}

const scaleTo = (v: number, b: { min: number; max: number }) =>
  b.max === b.min ? 0 : ((v - b.min) / (b.max - b.min)) * SIZE - SIZE / 2

function AxisLabel({ position, children }: { position: [number, number, number]; children: React.ReactNode }) {
  return (
    <Html position={position} center distanceFactor={8} style={{ pointerEvents: 'none' }}>
      <span className="whitespace-nowrap font-mono text-[9px] text-muted-foreground">{children}</span>
    </Html>
  )
}

interface MeshData {
  positions: Float32Array
  colors: Float32Array
  indices: Uint32Array
}

function buildMeshData(grid: SurfaceGrid, dependent: Axis, ua: Axis, va: Axis, bounds: SurfaceBounds, ramp: THREE.Color[]): MeshData {
  const { uVals, vVals, height } = grid
  const nu = uVals.length
  const nv = vVals.length
  const positions: number[] = []
  const colors: number[] = []
  const idxAt: (number | null)[][] = []
  const db = bounds[dependent]
  let vi = 0
  for (let i = 0; i < nu; i++) {
    const row: (number | null)[] = []
    for (let j = 0; j < nv; j++) {
      const h = height[i][j]
      if (!Number.isFinite(h)) { row.push(null); continue }
      positions.push(scaleTo(uVals[i], bounds[ua]), scaleTo(h, db), scaleTo(vVals[j], bounds[va]))
      const t = (h - db.min) / (db.max - db.min || 1)
      const c = sampleHeightRamp(ramp, Math.min(1, Math.max(0, t)))
      colors.push(c.r, c.g, c.b)
      row.push(vi++)
    }
    idxAt.push(row)
  }
  const indices: number[] = []
  for (let i = 0; i < nu - 1; i++) {
    for (let j = 0; j < nv - 1; j++) {
      const a = idxAt[i][j], b = idxAt[i + 1][j], c = idxAt[i][j + 1], d = idxAt[i + 1][j + 1]
      if (a !== null && b !== null && c !== null) indices.push(a, b, c)
      if (b !== null && d !== null && c !== null) indices.push(b, d, c)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint32Array(indices) }
}

function SurfaceMesh({ data, opacity = 1 }: { data: MeshData; opacity?: number }) {
  if (data.indices.length === 0) return null
  return (
    <mesh>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} count={data.positions.length / 3} itemSize={3} />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} count={data.colors.length / 3} itemSize={3} />
        <bufferAttribute attach="index" args={[data.indices, 1]} count={data.indices.length} itemSize={1} />
      </bufferGeometry>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} transparent={opacity < 1} opacity={opacity} roughness={0.55} metalness={0.05} />
    </mesh>
  )
}

interface SceneProps {
  formulas: string[]
  dependent: Axis
  bounds: SurfaceBounds
  res: number
  scope: Scope
  deriv: boolean
  integ: boolean
  probeU: number
  probeV: number
}

function Surface3DScene({ formulas, dependent, bounds, res, scope, deriv, integ, probeU, probeV }: SceneProps) {
  const [ua, va] = baseAxes(dependent)
  // A static height-field plot reads best with real, multi-hue color
  // contrast (cool low → warm high) rather than the app's usual single-hue
  // sequential ramp, which was reading as flat/washed-out here.
  const ramp = useSpectrumRamp()
  const gridColor = useThemeColor('var(--border)')
  const axisColorU = useThemeColor('#99C2FF')
  const axisColorDep = useThemeColor('#65DCD5')
  const axisColorV = useThemeColor('#66BB6A')
  const derivColor = useThemeColor('var(--accent-mint)')

  const grids = useMemo(
    () => formulas.map((f) => sampleSurface(f, dependent, bounds, res, scope)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formulas.join(';'), dependent, JSON.stringify(bounds), res, JSON.stringify(scope)]
  )

  const meshes = useMemo(
    () =>
      grids.map((branches, i) => {
        // Primary formula shades by height (the rich, informative case);
        // additional layered formulas get a flat solid tint so multiple
        // surfaces stay visually distinct instead of competing on the ramp.
        const flat = [resolveThemeColor(GRAPH_COLORS[i % GRAPH_COLORS.length])]
        return branches.map((g) => buildMeshData(g, dependent, ua, va, bounds, i === 0 ? ramp : flat))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grids, dependent, ua, va, bounds, ramp]
  )

  const firstFormula = formulas[0]
  const firstIsExplicit = firstFormula !== undefined && !isImplicitExpr(firstFormula)
  const tangent = useMemo(() => {
    if (!deriv || !firstIsExplicit || !firstFormula) return null
    const hu = Math.max(1e-4, (bounds[ua].max - bounds[ua].min) * 1e-3)
    const hv = Math.max(1e-4, (bounds[va].max - bounds[va].min) * 1e-3)
    const p = partials(firstFormula, ua, va, probeU, probeV, scope, hu, hv)
    if (!Number.isFinite(p.z)) return null
    return p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deriv, firstIsExplicit, firstFormula, ua, va, probeU, probeV, JSON.stringify(bounds), JSON.stringify(scope)])

  const tangentQuad = useMemo(() => {
    if (!tangent) return null
    const su = (bounds[ua].max - bounds[ua].min) * 0.09
    const sv = (bounds[va].max - bounds[va].min) * 0.09
    const corners: [number, number][] = [[-su, -sv], [su, -sv], [su, sv], [-su, sv]]
    const pts = corners.map(([du, dv]) => {
      const u = probeU + du
      const v = probeV + dv
      const h = tangent.z + tangent.dU * du + tangent.dV * dv
      return new THREE.Vector3(scaleTo(u, bounds[ua]), scaleTo(h, bounds[dependent]), scaleTo(v, bounds[va]))
    })
    return pts
  }, [tangent, bounds, ua, va, dependent, probeU, probeV])

  const probeMarker = useMemo(() => {
    if (!tangent) return null
    return new THREE.Vector3(scaleTo(probeU, bounds[ua]), scaleTo(tangent.z, bounds[dependent]), scaleTo(probeV, bounds[va]))
  }, [tangent, bounds, ua, va, dependent, probeU, probeV])

  return (
    <Canvas
      frameloop="demand"
      camera={{ position: [SIZE * 1.1, SIZE * 0.9, SIZE * 1.1], fov: 45 }}
      // preserveDrawingBuffer: PDF export rasterizes the page via html2canvas,
      // which reads a WebGL canvas's pixel buffer directly — without this the
      // browser is free to clear that buffer right after compositing, so by
      // the time html2canvas gets to it the canvas is blank. Costs nothing
      // for interactive use, only matters for this off-screen capture.
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[SIZE, SIZE * 1.5, SIZE]} intensity={0.6} />
      <DreiGrid
        args={[SIZE, SIZE]}
        position={[0, -SIZE / 2, 0]}
        cellColor={gridColor}
        sectionColor={gridColor}
        cellSize={SIZE / 10}
        sectionSize={SIZE / 2}
        fadeDistance={SIZE * 4}
        infiniteGrid={false}
      />
      <Line points={[[-SIZE / 2, 0, 0], [0, 0, 0]]} color={axisColorU} lineWidth={1.5} />
      <arrowHelper args={[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), SIZE / 2, axisColorU, SIZE * 0.09, SIZE * 0.045]} />
      <Line points={[[0, -SIZE / 2, 0], [0, 0, 0]]} color={axisColorDep} lineWidth={1.5} />
      <arrowHelper args={[new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), SIZE / 2, axisColorDep, SIZE * 0.09, SIZE * 0.045]} />
      <Line points={[[0, 0, -SIZE / 2], [0, 0, 0]]} color={axisColorV} lineWidth={1.5} />
      <arrowHelper args={[new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), SIZE / 2, axisColorV, SIZE * 0.09, SIZE * 0.045]} />
      <AxisLabel position={[SIZE / 2 + 0.3, 0, 0]}>{ua} ({fmtNum(bounds[ua].min)}…{fmtNum(bounds[ua].max)})</AxisLabel>
      <AxisLabel position={[0, SIZE / 2 + 0.3, 0]}>{dependent} ({fmtNum(bounds[dependent].min)}…{fmtNum(bounds[dependent].max)})</AxisLabel>
      <AxisLabel position={[0, 0, SIZE / 2 + 0.3]}>{va} ({fmtNum(bounds[va].min)}…{fmtNum(bounds[va].max)})</AxisLabel>

      {meshes.map((branches, i) => branches.map((data, bi) => <SurfaceMesh key={`${i}-${bi}`} data={data} opacity={i === 0 ? 1 : 0.9} />))}

      {tangentQuad && (
        <mesh>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[new Float32Array(tangentQuad.flatMap((p) => [p.x, p.y, p.z])), 3]}
              count={4}
              itemSize={3}
            />
            <bufferAttribute attach="index" args={[new Uint16Array([0, 1, 2, 0, 2, 3]), 1]} count={6} itemSize={1} />
          </bufferGeometry>
          <meshBasicMaterial color={derivColor} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {probeMarker && (
        <mesh position={probeMarker}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshBasicMaterial color={derivColor} />
        </mesh>
      )}

      <OrbitControls makeDefault target={[0, 0, 0]} enableDamping enablePan enableZoom enableRotate />

      {/* Visual orbit gizmo — the small axis widget in the corner, same
          colors as the U/dependent/V axis triad. Drag it to orbit, click a
          head to snap the camera to that face, same convention as CAD/3D
          modeling tools. */}
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport
          axisColors={[`#${axisColorU.getHexString()}`, `#${axisColorDep.getHexString()}`, `#${axisColorV.getHexString()}`]}
          labels={[ua, dependent, va]}
          labelColor="black"
        />
      </GizmoHelper>
    </Canvas>
  )
}

export function Surface3DObject({ pageId, object }: ObjectRendererProps) {
  const setStringParam = useDocStore((s) => s.setStringParam)
  const scope = useDocStore((s) => s.scopes[pageId]) ?? {}
  usePrefs((s) => s.math)

  const formulasStr = getString(object, 'formulas', 'sin(x)*cos(y)')
  const dependent = (['x', 'y', 'z'].includes(getString(object, 'axis')) ? getString(object, 'axis') : 'z') as Axis
  const deriv = getString(object, 'deriv') === '1'
  const integ = getString(object, 'integ') === '1'
  const res = Math.max(8, Math.min(60, Number(getString(object, 'res')) || DEFAULT_RES))

  const formulas = useMemo(() => splitList(formulasStr), [formulasStr])
  const [ua, va] = baseAxes(dependent)

  const bounds: SurfaceBounds = useMemo(
    () => ({
      x: { min: boundOf(getString(object, 'xMin'), -5, scope), max: boundOf(getString(object, 'xMax'), 5, scope) },
      y: { min: boundOf(getString(object, 'yMin'), -5, scope), max: boundOf(getString(object, 'yMax'), 5, scope) },
      z: { min: boundOf(getString(object, 'zMin'), -5, scope), max: boundOf(getString(object, 'zMax'), 5, scope) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getString(object, 'xMin'), getString(object, 'xMax'), getString(object, 'yMin'), getString(object, 'yMax'), getString(object, 'zMin'), getString(object, 'zMax'), scope]
  )

  const [probeU, setProbeU] = useState(0)
  const [probeV, setProbeV] = useState(0)

  const firstFormula = formulas[0]
  const firstIsExplicit = firstFormula !== undefined && !isImplicitExpr(firstFormula)
  const calculusAvailable = formulas.length > 0 && firstIsExplicit

  const volume = useMemo(() => {
    if (!integ || !firstIsExplicit || !firstFormula) return null
    const grid = sampleSurface(firstFormula, dependent, bounds, res, scope)[0]
    return grid ? integrateGrid(grid) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integ, firstIsExplicit, firstFormula, dependent, JSON.stringify(bounds), res, JSON.stringify(scope)])

  const tangentReadout = useMemo(() => {
    if (!deriv || !firstIsExplicit || !firstFormula) return null
    const hu = Math.max(1e-4, (bounds[ua].max - bounds[ua].min) * 1e-3)
    const hv = Math.max(1e-4, (bounds[va].max - bounds[va].min) * 1e-3)
    return partials(firstFormula, ua, va, probeU, probeV, scope, hu, hv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deriv, firstIsExplicit, firstFormula, ua, va, probeU, probeV, JSON.stringify(bounds), scope])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-card/70 hairline">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        <Box className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold tracking-wide text-muted-foreground">
          {formulas.join(', ') || '3D Graph'} — {dependent}({ua}, {va})
        </span>
        {calculusAvailable && (
          <button
            type="button"
            aria-label={deriv ? 'Hide tangent plane' : 'Show tangent plane at the probe point'}
            aria-pressed={deriv}
            title={deriv ? 'Derivative: off' : 'Derivative — tangent plane and partials at the probe point'}
            className={deriv ? 'rounded p-0.5 text-[var(--accent-mint)]' : 'rounded p-0.5 text-muted-foreground hover:text-foreground'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'deriv', deriv ? '' : '1')}
          >
            <TrendingUp className="h-3.5 w-3.5" />
          </button>
        )}
        {calculusAvailable && (
          <button
            type="button"
            aria-label={integ ? 'Hide volume' : 'Show the volume under the surface'}
            aria-pressed={integ}
            title={integ ? 'Integral: off' : 'Integral — volume under the surface over the base rectangle'}
            className={integ ? 'rounded p-0.5 text-[var(--accent-violet)]' : 'rounded p-0.5 text-muted-foreground hover:text-foreground'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setStringParam(pageId, object.id, 'integ', integ ? '' : '1')}
          >
            <Sigma className="h-3.5 w-3.5" />
          </button>
        )}
        <select
          aria-label="Dependent axis — which variable is plotted as a function of the other two"
          value={dependent}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setStringParam(pageId, object.id, 'axis', e.target.value)}
          className="shrink-0 rounded-md border border-border/50 bg-background/60 px-1 py-0.5 font-mono text-[10.5px] text-foreground outline-none"
        >
          <option value="z">z = f(x, y)</option>
          <option value="y">y = f(x, z)</option>
          <option value="x">x = f(y, z)</option>
        </select>
      </div>

      {(deriv || integ) && calculusAvailable && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border/60 bg-accent/20 px-2 py-1 font-mono text-[9.5px]">
          {deriv && tangentReadout && (
            <>
              <span className="text-muted-foreground">probe {ua}=</span>
              <input
                type="number"
                value={probeU}
                onChange={(e) => setProbeU(Number(e.target.value))}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={`Probe ${ua}`}
                className="w-14 rounded border border-border/50 bg-background/60 px-1 outline-none"
              />
              <span className="text-muted-foreground">{va}=</span>
              <input
                type="number"
                value={probeV}
                onChange={(e) => setProbeV(Number(e.target.value))}
                onPointerDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label={`Probe ${va}`}
                className="w-14 rounded border border-border/50 bg-background/60 px-1 outline-none"
              />
              <span className="text-[var(--accent-mint)]">
                {dependent}={fmtNum(tangentReadout.z)} · ∂{dependent}/∂{ua}={fmtNum(tangentReadout.dU)} · ∂{dependent}/∂{va}={fmtNum(tangentReadout.dV)}
              </span>
            </>
          )}
          {integ && volume !== null && (
            <span className="text-[var(--accent-violet)]">
              ∫∫ {dependent} d{ua} d{va} = {fmtNum(volume)}
            </span>
          )}
        </div>
      )}

      {formulas.length > 0 ? (
        <div className="relative min-h-0 flex-1" style={{ touchAction: 'none' }} onPointerDown={(e) => e.stopPropagation()}>
          <Surface3DScene
            formulas={formulas}
            dependent={dependent}
            bounds={bounds}
            res={res}
            scope={scope}
            deriv={deriv}
            integ={integ}
            probeU={probeU}
            probeV={probeV}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
          Add a formula in the Inspector — e.g. <span className="font-mono">sin(x)*cos(y)</span> or an equation like{' '}
          <span className="font-mono">x^2+y^2+z^2=25</span> for a sphere.
        </div>
      )}
    </div>
  )
}
