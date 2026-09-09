'use client'

// Starter content for AddPageDialog's Document/Presentation/Spreadsheet
// templates — the same real-content-not-just-a-blank-page idea Word/
// PowerPoint/Excel's own template galleries use. Each template seeds actual
// objects/cells, not just an empty page with a different name.
//
// Slide and spreadsheet templates seed OBJECTS, whose text formatting is
// out-of-band mark ranges over a plain string (lib/text/marks.ts) — a heading
// is built by serializing {text, marks} with a 'bold' + 'size' mark spanning
// the line, exactly like the Properties panel's Bold/Size controls would
// produce by hand. The DOCUMENT template is the exception: a doc page has a
// flowing body now, so its template is ProseMirror JSON for that body rather
// than a set of positioned text boxes.

import { baseObject } from './factory'
import { str, type SceneObject } from './types'
import { serialize, type Mark } from '@/lib/text/marks'

function styledText(text: string, marks: Mark[]) {
  return str(serialize({ text, marks }))
}

// ── Document (the page's flowing body) ────────────────────────────────────

export type DocTemplateId = 'blank' | 'report' | 'resume' | 'meeting-notes'

// A doc template seeds the page's flowing BODY, not text boxes on a sheet.
// It used to place `text` SceneObjects at fixed x/y — which meant the very
// first thing a new document taught you was that its "text" is a box you drag
// around, and that adding a sentence to the summary would overlap the heading
// below it. A template is now what a Word template is: content in the flow.

interface Block {
  text: string
  heading?: 1 | 2
}

const pm = (blocks: Block[]): string =>
  JSON.stringify({
    type: 'doc',
    content: blocks.map((b) =>
      b.heading
        ? {
            type: 'heading',
            attrs: { level: b.heading, style: `Heading${b.heading}` },
            content: [{ type: 'text', text: b.text }],
          }
        : b.text
          ? { type: 'paragraph', content: [{ type: 'text', text: b.text }] }
          : { type: 'paragraph' }
    ),
  })

/** Starter body text for a new document, as ProseMirror JSON ready for
 *  PageDoc.flow. Empty string for the blank template — a blank page really is
 *  blank, and writing an empty document would only cost a store write. */
export function docTemplate(id: DocTemplateId): string {
  switch (id) {
    case 'report':
      return pm([
        { text: 'Report Title', heading: 1 },
        { text: 'Prepared by · Date' },
        { text: 'Summary', heading: 2 },
        { text: 'A brief overview of the report’s purpose and key findings.' },
        { text: 'Details', heading: 2 },
        { text: 'Expand on the summary here — background, method, and results.' },
        { text: 'Conclusion', heading: 2 },
        { text: 'Closing remarks and next steps.' },
      ])
    case 'resume':
      return pm([
        { text: 'Your Name', heading: 1 },
        { text: 'email · phone · location' },
        { text: 'Experience', heading: 2 },
        { text: 'Job Title — Company · Dates' },
        { text: 'Key achievement or responsibility.' },
        { text: 'Education', heading: 2 },
        { text: 'Degree — Institution · Year' },
        { text: 'Skills', heading: 2 },
        { text: 'Skill one, skill two, skill three.' },
      ])
    case 'meeting-notes':
      return pm([
        { text: 'Meeting Notes', heading: 1 },
        { text: 'Date · Attendees' },
        { text: 'Agenda', heading: 2 },
        { text: '1. Topic one' },
        { text: '2. Topic two' },
        { text: '3. Topic three' },
        { text: 'Action Items', heading: 2 },
        { text: '☐ Task — Owner — Due date' },
      ])
    case 'blank':
    default:
      return ''
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
