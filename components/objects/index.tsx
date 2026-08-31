'use client'

// Geometry-kind → renderer registry. The canvas never switches on kinds;
// new geometry registers here and the core stays closed for modification.
//
// formula/graph/surface3d/chart are dynamic imports: they're the only kinds
// pulling in katex, recharts or three.js, and most pages don't use them —
// loading those libs unconditionally for every notebook page was the single
// biggest contributor to this app's Lighthouse TBT/unused-JS scores.

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import type { GeometryKind } from '@/lib/scene/types'
import type { ObjectRendererProps } from './types'
import { GeometryObject } from './geometry'
import { NoteObject } from './note'
import { TextObject } from './text'
import { TableObject } from './table'
import { CashflowObject } from './cashflow'
import { TruthTableObject } from './truth-table'
import { CodeObject } from './code'
import { DsaObject } from './dsa'
import { GridTableObject } from './grid-table'
import { SliderObject } from './slider'
import { ButtonObject } from './button'
import { TriggerObject } from './trigger'
import { PictureObject } from './picture'
import { GroupObject } from './group'

const FormulaObject = dynamic(() => import('./formula').then((m) => m.FormulaObject), { ssr: false })
const GraphObject = dynamic(() => import('./graph').then((m) => m.GraphObject), { ssr: false })
const Surface3DObject = dynamic(() => import('./surface3d').then((m) => m.Surface3DObject), { ssr: false })
const ChartObject = dynamic(() => import('./chart').then((m) => m.ChartObject), { ssr: false })

export const OBJECT_RENDERERS: Record<GeometryKind, ComponentType<ObjectRendererProps>> = {
  circle: GeometryObject,
  rect: GeometryObject,
  polygon: GeometryObject,
  line: GeometryObject,
  stroke: GeometryObject,
  symbol: GeometryObject,
  note: NoteObject,
  text: TextObject,
  formula: FormulaObject,
  graph: GraphObject,
  surface3d: Surface3DObject,
  chart: ChartObject,
  table: TableObject,
  gridtable: GridTableObject,
  slider: SliderObject,
  button: ButtonObject,
  trigger: TriggerObject,
  cashflow: CashflowObject,
  truthtable: TruthTableObject,
  code: CodeObject,
  dsa: DsaObject,
  picture: PictureObject,
  group: GroupObject,
}
