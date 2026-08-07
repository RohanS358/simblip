'use client'

// SheetJS workbook <-> x-data-spreadsheet's own SpreadsheetData shape, for
// xlsx-view.tsx's import (on first open) and "Export as .xlsx" action. Cell
// values only — formulas are imported as their last-computed value (SheetJS
// gives us `.v`), not re-evaluated live; x-data-spreadsheet has no formula
// engine of its own.

import * as XLSX from 'xlsx'

interface XSheetData {
  name?: string
  rows?: Record<number, { cells: Record<number, { text: string }> }>
}
type XSpreadsheetData = Record<number, XSheetData>

export function workbookToXSpreadsheet(wb: XLSX.WorkBook): XSpreadsheetData {
  const out: XSpreadsheetData = {}
  wb.SheetNames.forEach((name, sheetIndex) => {
    const ws = wb.Sheets[name]
    const ref = ws['!ref']
    const rows: XSheetData['rows'] = {}
    if (ref) {
      const range = XLSX.utils.decode_range(ref)
      for (let r = range.s.r; r <= range.e.r; r++) {
        const cells: Record<number, { text: string }> = {}
        let hasCell = false
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })]
          if (cell === undefined) continue
          const text = cell.v === undefined || cell.v === null ? '' : String(cell.v)
          if (text === '') continue
          cells[c - range.s.c] = { text }
          hasCell = true
        }
        if (hasCell) rows[r - range.s.r] = { cells }
      }
    }
    out[sheetIndex] = { name, rows }
  })
  return out
}

export function xSpreadsheetToWorkbook(data: XSpreadsheetData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const sheets = Object.values(data)
  const names = new Set<string>()
  sheets.forEach((sheet, i) => {
    const aoa: string[][] = []
    const rowIndices = Object.keys(sheet.rows ?? {}).map(Number)
    const maxRow = rowIndices.length ? Math.max(...rowIndices) : -1
    for (let r = 0; r <= maxRow; r++) {
      const row = sheet.rows?.[r]
      const cellIndices = row ? Object.keys(row.cells).map(Number) : []
      const maxCol = cellIndices.length ? Math.max(...cellIndices) : -1
      const line: string[] = []
      for (let c = 0; c <= maxCol; c++) line.push(row?.cells[c]?.text ?? '')
      aoa.push(line)
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    let name = sheet.name || `Sheet${i + 1}`
    while (names.has(name)) name = `${name}_${i + 1}`
    names.add(name)
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  })
  if (sheets.length === 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1')
  return wb
}
