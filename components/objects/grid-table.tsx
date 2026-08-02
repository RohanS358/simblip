'use client'

// Transparent Canva / MS Word style Grid Table renderer.
// Displays a simple grid layout with direct cell editing, row/column addition/removal,
// and draggable column splitter handles for internal section resizing.

import { useMemo, useState } from 'react'
import { Plus, Minus, Grid, LayoutGrid, Eye, EyeOff } from 'lucide-react'
import { useDocStore } from '@/lib/store/document'
import { getNumber, getString, type ObjectRendererProps } from './types'
import { cn } from '@/lib/utils'

export function GridTableObject({ pageId, object, selected }: ObjectRendererProps) {
  const updateObjectParameter = useDocStore((s) => s.updateObjectParameter)
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null)
  const [resizingCol, setResizingCol] = useState<number | null>(null)

  const rowsCount = getNumber(object, 'rows', 3)
  const colsCount = getNumber(object, 'cols', 3)
  const cellsStr = getString(object, 'cells', '')
  const transparent = getNumber(object, 'transparent', 1) === 1
  const colWidthsStr = getString(object, 'colWidths', '')

  const matrix: string[][] = useMemo(() => {
    try {
      if (cellsStr) {
        const parsed = JSON.parse(cellsStr)
        if (Array.isArray(parsed)) return parsed
      }
    } catch {
      // fallback
    }
    return Array.from({ length: rowsCount }, (_, r) =>
      Array.from({ length: colsCount }, (_, c) => `Cell ${r + 1},${c + 1}`)
    )
  }, [cellsStr, rowsCount, colsCount])

  const colWidths: number[] = useMemo(() => {
    try {
      if (colWidthsStr) {
        const parsed = JSON.parse(colWidthsStr)
        if (Array.isArray(parsed) && parsed.length === colsCount) return parsed
      }
    } catch {
      // fallback
    }
    return Array(colsCount).fill(100 / colsCount)
  }, [colWidthsStr, colsCount])

  const updateMatrix = (newMatrix: string[][]) => {
    updateObjectParameter(pageId, object.id, 'cells', JSON.stringify(newMatrix))
    updateObjectParameter(pageId, object.id, 'rows', newMatrix.length)
    updateObjectParameter(pageId, object.id, 'cols', newMatrix[0]?.length || 1)
  }

  const handleCellChange = (r: number, c: number, val: string) => {
    const next = matrix.map((rowArr, ri) =>
      ri === r ? rowArr.map((cell, ci) => (ci === c ? val : cell)) : rowArr
    )
    updateMatrix(next)
  }

  const addRow = () => {
    const newRow = Array(colsCount).fill('')
    updateMatrix([...matrix, newRow])
  }

  const removeRow = () => {
    if (matrix.length <= 1) return
    updateMatrix(matrix.slice(0, matrix.length - 1))
  }

  const addCol = () => {
    const next = matrix.map((r) => [...r, ''])
    updateMatrix(next)
  }

  const removeCol = () => {
    if (colsCount <= 1) return
    const next = matrix.map((r) => r.slice(0, r.length - 1))
    updateMatrix(next)
  }

  const toggleTransparent = () => {
    updateObjectParameter(pageId, object.id, 'transparent', transparent ? 0 : 1)
  }

  // Handle column splitter drag to resize column widths
  const handleColResizeStart = (e: React.MouseEvent, cIndex: number) => {
    e.stopPropagation()
    e.preventDefault()
    setResizingCol(cIndex)

    const startX = e.clientX
    const startWidth = colWidths[cIndex] || 100 / colsCount

    const onMouseMove = (moveEvt: MouseEvent) => {
      const deltaPercent = ((moveEvt.clientX - startX) / (object.size.w || 300)) * 100
      const nextWidths = [...colWidths]
      nextWidths[cIndex] = Math.max(10, Math.min(80, startWidth + deltaPercent))
      updateObjectParameter(pageId, object.id, 'colWidths', JSON.stringify(nextWidths))
    }

    const onMouseUp = () => {
      setResizingCol(null)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div
      className={cn(
        'relative flex h-full w-full flex-col overflow-hidden rounded-xl transition-colors select-none',
        transparent
          ? 'bg-transparent border border-dashed border-border/60 hover:border-border'
          : 'bg-card/90 border border-border shadow-sm backdrop-blur-md'
      )}
    >
      {/* Selection Action Toolbar */}
      {selected && (
        <div className="flex items-center justify-between gap-1 border-b border-border/60 bg-background/80 px-2 py-1 backdrop-blur-md text-[11px]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 hover:bg-accent text-foreground font-medium"
              title="Add Row"
            >
              <Plus className="h-3 w-3" /> Row
            </button>
            <button
              type="button"
              onClick={removeRow}
              className="flex items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 hover:bg-accent text-foreground font-medium"
              title="Remove Row"
            >
              <Minus className="h-3 w-3" /> Row
            </button>
            <div className="h-3 w-px bg-border/60 mx-0.5" />
            <button
              type="button"
              onClick={addCol}
              className="flex items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 hover:bg-accent text-foreground font-medium"
              title="Add Column"
            >
              <Plus className="h-3 w-3" /> Col
            </button>
            <button
              type="button"
              onClick={removeCol}
              className="flex items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 hover:bg-accent text-foreground font-medium"
              title="Remove Column"
            >
              <Minus className="h-3 w-3" /> Col
            </button>
          </div>

          <button
            type="button"
            onClick={toggleTransparent}
            className="flex items-center gap-1 rounded bg-accent/60 px-1.5 py-0.5 hover:bg-accent text-muted-foreground hover:text-foreground"
            title="Toggle Transparent Background"
          >
            {transparent ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {transparent ? 'Transparent' : 'Solid'}
          </button>
        </div>
      )}

      {/* Grid Table Layout */}
      <div className="flex-1 overflow-auto p-1">
        <table className="w-full h-full border-collapse text-[12.5px]">
          <tbody>
            {matrix.map((row, r) => (
              <tr key={r} className="border-b border-border/50 last:border-0">
                {row.map((cellValue, c) => (
                  <td
                    key={c}
                    style={{ width: `${colWidths[c] || 100 / colsCount}%` }}
                    className={cn(
                      'relative border-r border-border/50 last:border-0 p-1.5 align-top transition-colors',
                      r === 0 ? 'font-semibold bg-accent/30' : '',
                      selected && 'hover:bg-accent/40 cursor-text'
                    )}
                    onClick={(e) => {
                      if (selected) {
                        e.stopPropagation()
                        setEditingCell({ r, c })
                      }
                    }}
                  >
                    {editingCell?.r === r && editingCell?.c === c ? (
                      <input
                        autoFocus
                        type="text"
                        value={cellValue}
                        onChange={(e) => handleCellChange(r, c, e.target.value)}
                        onBlur={() => setEditingCell(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === 'Escape') setEditingCell(null)
                        }}
                        aria-label={`Cell row ${r + 1}, column ${c + 1}`}
                        className="w-full bg-transparent font-inherit outline-none border-b border-[var(--accent-blue)]"
                      />
                    ) : (
                      <span className="block break-words">{cellValue || '\u00A0'}</span>
                    )}

                    {/* Column Resizer Handle */}
                    {selected && c < colsCount - 1 && (
                      <div
                        onMouseDown={(e) => handleColResizeStart(e, c)}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--accent-blue)]/60 transition-colors z-10"
                        title="Drag to resize column"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
