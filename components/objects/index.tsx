'use client'

// Geometry-kind → renderer registry. The canvas never switches on kinds;
// new geometry registers here and the core stays closed for modification.

import type { ComponentType } from 'react'
import type { GeometryKind } from '@/lib/scene/types'
import type { ObjectRendererProps } from './types'
import { GeometryObject } from './geometry'
import { NoteObject } from './note'
import { TextObject } from './text'
import { FormulaObject } from './formula'
import { GraphObject } from './graph'
import { TableObject } from './table'
import { CashflowObject } from './cashflow'
import { TruthTableObject } from './truth-table'
import { CodeObject } from './code'
import { DsaObject } from './dsa'
import { GridTableObject } from './grid-table'
import { SliderObject } from './slider'
import { ButtonObject } from './button'
import { TriggerObject } from './trigger'

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
  table: TableObject,
  gridtable: GridTableObject,
  slider: SliderObject,
  button: ButtonObject,
  trigger: TriggerObject,
  cashflow: CashflowObject,
  truthtable: TruthTableObject,
  code: CodeObject,
  dsa: DsaObject,
}
