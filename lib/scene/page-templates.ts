'use client'

// Starter content for AddPageDialog's Document/Presentation/Spreadsheet
// templates — the same real-content-not-just-a-blank-page idea Word/
// PowerPoint/Excel's own template galleries use. Each template seeds actual
// objects/cells, not just an empty page with a different name.
//
// Text formatting in this app is out-of-band mark ranges over a plain
// string (lib/text/marks.ts), not CSS metadata on the object — a heading is
// built by serializing {text, marks} with a 'bold' + 'size' mark spanning
// the heading line, exactly like the Properties panel's Bold/Size controls
// would produce by hand.

import { baseObject } from './factory'
import { str, type SceneObject } from './types'
import { serialize, type Mark } from '@/lib/text/marks'

function styledText(text: string, marks: Mark[]) {
  return str(serialize({ text, marks }))
}

// ── Document (doc-kind sheets: text objects on a canvas page) ──────────────

function heading(text: string, x: number, y: number, w = 700): SceneObject {
  const obj = baseObject('text', { x, y })
  obj.size = { w, h: 40 }
  obj.parameters.text = styledText(text, [
    { start: 0, end: text.length, kind: 'bold' },
    { start: 0, end: text.length, kind: 'size', value: 'xl' },
  ])
  return obj
}

function body(text: string, x: number, y: number, w = 700, h = 100): SceneObject {
  const obj = baseObject('text', { x, y })
  obj.size = { w, h }
  obj.parameters.text = str(text)
  return obj
}

export type DocTemplateId = 'blank' | 'report' | 'resume' | 'meeting-notes'

export function docTemplate(id: DocTemplateId): SceneObject[] {
  switch (id) {
    case 'report':
      return [
        heading('Report Title', 48, 100),
        body('Prepared by · Date', 48, 150, 700, 30),
        heading('Summary', 48, 210),
        body('A brief overview of the report’s purpose and key findings.', 48, 250),
        heading('Details', 48, 380),
        body('Expand on the summary here — background, method, and results.', 48, 420),
        heading('Conclusion', 48, 620),
        body('Closing remarks and next steps.', 48, 660),
      ]
    case 'resume':
      return [
        heading('Your Name', 48, 60),
        body('email · phone · location', 48, 100, 700, 24),
        heading('Experience', 48, 150),
        body('Job Title — Company · Dates\nKey achievement or responsibility.', 48, 190, 700, 80),
        heading('Education', 48, 300),
        body('Degree — Institution · Year', 48, 340, 700, 40),
        heading('Skills', 48, 410),
        body('Skill one, skill two, skill three.', 48, 450, 700, 40),
      ]
    case 'meeting-notes':
      return [
        heading('Meeting Notes', 48, 60),
        body('Date · Attendees', 48, 110, 700, 30),
        heading('Agenda', 48, 160),
        body('1. Topic one\n2. Topic two\n3. Topic three', 48, 200, 700, 90),
        heading('Action Items', 48, 320),
        body('☐ Task — Owner — Due date', 48, 360, 700, 60),
      ]
    case 'blank':
    default:
      return []
  }
}

// ── Presentation (slides: one array of SceneObjects per slide) ─────────────

export function slideTitle(text: string): SceneObject {
  const obj = baseObject('text', { x: 60, y: 200 })
  obj.size = { w: 840, h: 80 }
  obj.parameters.text = styledText(text, [
    { start: 0, end: text.length, kind: 'bold' },
    { start: 0, end: text.length, kind: 'size', value: 'xl' },
  ])
  return obj
}

function slideSubtitle(text: string): SceneObject {
  const obj = baseObject('text', { x: 60, y: 300 })
  obj.size = { w: 840, h: 50 }
  obj.parameters.text = styledText(text, [{ start: 0, end: text.length, kind: 'size', value: 'l' }])
  return obj
}

export function slideHeading(text: string): SceneObject {
  const obj = baseObject('text', { x: 60, y: 50 })
  obj.size = { w: 840, h: 60 }
  obj.parameters.text = styledText(text, [
    { start: 0, end: text.length, kind: 'bold' },
    { start: 0, end: text.length, kind: 'size', value: 'l' },
  ])
  return obj
}

export function slideBody(text: string, y = 140): SceneObject {
  const obj = baseObject('text', { x: 60, y })
  obj.size = { w: 840, h: 300 }
  obj.parameters.text = str(text)
  return obj
}

export type PptxTemplateId = 'blank' | 'title-deck' | 'pitch-deck'

export function pptxTemplate(id: PptxTemplateId): SceneObject[][] {
  switch (id) {
    case 'title-deck':
      return [
        [slideTitle('Presentation Title'), slideSubtitle('Subtitle or presenter name')],
        [slideHeading('Agenda'), slideBody('• Topic one\n• Topic two\n• Topic three')],
        [slideHeading('Thank You'), slideBody('Questions?')],
      ]
    case 'pitch-deck':
      return [
        [slideTitle('Company Name'), slideSubtitle('One-line pitch')],
        [slideHeading('Problem'), slideBody('What problem are you solving, and for whom?')],
        [slideHeading('Solution'), slideBody('How does your product solve it?')],
        [slideHeading('Market'), slideBody('Market size and opportunity.')],
        [slideHeading('The Ask'), slideBody('What you’re raising and what it enables.')],
      ]
    case 'blank':
    default:
      return [[]]
  }
}

// ── Spreadsheet (x-data-spreadsheet's own SpreadsheetData shape) ───────────

interface XSheetData {
  name?: string
  rows?: Record<number, { cells: Record<number, { text: string }> }>
}
type XSpreadsheetData = Record<number, XSheetData>

function rowsOf(grid: string[][]): XSheetData['rows'] {
  const rows: XSheetData['rows'] = {}
  grid.forEach((line, r) => {
    const cells: Record<number, { text: string }> = {}
    line.forEach((text, c) => {
      if (text) cells[c] = { text }
    })
    if (Object.keys(cells).length) rows[r] = { cells }
  })
  return rows
}

export type XlsxTemplateId = 'blank' | 'budget' | 'task-tracker'

export function xlsxTemplate(id: XlsxTemplateId): XSpreadsheetData {
  switch (id) {
    case 'budget':
      return {
        0: {
          name: 'Budget',
          rows: rowsOf([
            ['Category', 'Budgeted', 'Actual', 'Difference'],
            ['Housing', '1200', '1150', '=B2-C2'],
            ['Food', '400', '450', '=B3-C3'],
            ['Transport', '200', '180', '=B4-C4'],
            ['Savings', '300', '300', '=B5-C5'],
            ['Total', '=SUM(B2:B5)', '=SUM(C2:C5)', '=SUM(D2:D5)'],
          ]),
        },
      }
    case 'task-tracker':
      return {
        0: {
          name: 'Tasks',
          rows: rowsOf([
            ['Task', 'Owner', 'Status', 'Due Date'],
            ['Example task', 'Name', 'Not started', ''],
          ]),
        },
      }
    case 'blank':
    default:
      return {}
  }
}
