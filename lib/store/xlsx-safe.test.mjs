// Spreadsheet import/export after replacing the npm `xlsx` 0.18.5 package (prototype pollution
// GHSA-4r6h-8v6p-xvw6 and ReDoS GHSA-5pgg-2g8v-p4x9, no fix on npm) with SheetJS's own maintained build.
// Run: node --experimental-strip-types --import ./scripts/test/register.mjs --test --test-force-exit lib/store/xlsx-safe.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { workbookToXSpreadsheet, xSpreadsheetToWorkbook } from './xlsx-convert.ts'

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../node_modules/xlsx/package.json'), 'utf8'))
const bytes = (wb, bookType = 'xlsx') => XLSX.write(wb, { type: 'array', bookType })

test('the installed SheetJS is a patched release (the npm 0.18.5 build has two open CVEs)', () => {
  const [maj, min, patch] = pkg.version.split('.').map(Number)
  assert.ok(maj > 0 || min > 20 || (min === 20 && patch >= 2), `xlsx ${pkg.version} must be >= 0.20.2`)
  const declared = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')).dependencies.xlsx
  assert.match(declared, /cdn\.sheetjs\.com\/xlsx-0\.20\.\d+/, 'pinned to the vendor build, not a floating npm range')
})

test('cells survive export and re-import (what xlsx-view.tsx does)', () => {
  const sheet = { name: 'Data', rows: { 0: { cells: { 0: { text: 'V' }, 1: { text: '10' } } }, 2: { cells: { 1: { text: 'k' } } } } }
  const wb = xSpreadsheetToWorkbook({ 0: sheet })
  const back = workbookToXSpreadsheet(XLSX.read(bytes(wb), { type: 'array' }))
  assert.equal(back[0].name, 'Data')
  assert.equal(back[0].rows[0].cells[0].text, 'V')
  assert.equal(back[0].rows[0].cells[1].text, '10')
  assert.equal(back[0].rows[2].cells[1].text, 'k')
})

test('csv and legacy .xls are still read (the attachments reader accepts both)', () => {
  const csv = XLSX.read(new TextEncoder().encode('a,b\n1,2\n'), { type: 'array' })
  assert.equal(XLSX.utils.sheet_to_csv(csv.Sheets[csv.SheetNames[0]]).trim(), 'a,b\n1,2')
  const xls = XLSX.read(bytes(xSpreadsheetToWorkbook({ 0: { name: 'Old', rows: { 0: { cells: { 0: { text: 'x' } } } } } }), 'biff8'), { type: 'array' })
  assert.equal(xls.SheetNames[0], 'Old')
})

test('hostile sheet names (__proto__, constructor, prototype) cannot pollute Object.prototype', () => {
  const polluted = () => ({}).polluted !== undefined || Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')
  const data = {
    0: { name: '__proto__', rows: { 0: { cells: { 0: { text: 'polluted' } } } } },
    1: { name: 'constructor', rows: { 0: { cells: { 0: { text: 'x' } } } } },
    2: { name: 'prototype', rows: { 0: { cells: { 0: { text: 'y' } } } } },
  }
  let wb
  try {
    wb = xSpreadsheetToWorkbook(data)
    const back = workbookToXSpreadsheet(XLSX.read(bytes(wb), { type: 'array' }))
    void back
  } catch {
    /* refusing such a workbook is fine; polluting the runtime is not */
  }
  assert.equal(polluted(), false)
  assert.equal(Object.keys(Object.prototype).length, 0, 'Object.prototype gained no enumerable keys')
  assert.equal(({}).constructor, Object)
})

test('a spreadsheet with a huge formula-like string does not hang the reader (ReDoS guard)', () => {
  const evil = 'a'.repeat(32_000) + '!'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[evil, 1]]), 'S')
  const t0 = Date.now()
  XLSX.read(bytes(wb), { type: 'array' })
  assert.ok(Date.now() - t0 < 5000, `read took ${Date.now() - t0} ms`)
})
