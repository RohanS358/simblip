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
import { CashflowObject } from './cashflow'
import { TruthTableObject } from './truth-table'
import { CodeObject } from './code'

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
  cashflow: CashflowObject,
  truthtable: TruthTableObject,
  code: CodeObject,
}
