'use client'

// Phase B harness for the Tiptap text engine (docs/tiptap-text-engine-plan.md).
// Dev-only: proves the new editor renders, types, formats and round-trips
// real stored content before Phase C swaps it into RichTextArea.
//
// Delete this route once Phase C lands and the real text objects exercise
// the editor on the canvas.

import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { TiptapArea } from '@/components/objects/text-editor'
import { pmDocToStoredText, parseDoc, type PmDoc } from '@/lib/text/pm'
import { serialize } from '@/lib/text/marks'

// One sample per storage generation, so the harness exercises the whole
// lazy-migration path (see parseDoc in lib/text/pm.ts).
const SAMPLES: { label: string; value: string }[] = [
  {
    label: 'Gen 1 — raw markdown delimiters',
    value: '# Heading\n**bold** and *italic* and `code`\n- item one\n- item two\n> a quote\n- [ ] todo\n- [x] done',
  },
  {
    label: 'Gen 2 — {text, marks}',
    value: serialize({
      text: 'Styled heading\nBody text with formatting.\n- first\n        - nested\n1. step one',
      marks: [
        { start: 0, end: 14, kind: 'bold' },
        { start: 0, end: 14, kind: 'size', value: 'xl' },
        { start: 30, end: 41, kind: 'color', value: 'blue' },
        { start: 30, end: 41, kind: 'italic' },
      ],
    }),
  },
  { label: 'Gen 3 — empty', value: '' },
]

export default function TiptapHarness() {
  const [value, setValue] = useState(SAMPLES[0].value)
  const [editor, setEditor] = useState<Editor | null>(null)

  const stored = (() => {
    try {
      return pmDocToStoredText(parseDoc(value) as PmDoc)
    } catch (err) {
      return { text: `error: ${String(err)}`, marks: [] }
    }
  })()

  const cmd = (label: string, run: () => void, active?: string) => (
    <button
      key={label}
      onClick={() => {
        run()
        editor?.commands.focus()
      }}
      className={`rounded border px-2 py-1 text-xs ${
        active && editor?.isActive(active) ? 'bg-foreground text-background' : 'bg-card'
      }`}
    >
      {label}
    </button>
  )

  const chain = () => editor!.chain().focus()

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Tiptap engine harness (Phase B)</h1>

      <div className="flex flex-wrap gap-2">
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            onClick={() => setValue(s.value)}
            className="rounded border bg-card px-2 py-1 text-xs"
          >
            {s.label}
          </button>
        ))}
      </div>

      {editor && (
        <div className="flex flex-wrap gap-1.5 border-y py-2">
          {cmd('B', () => chain().toggleBold().run(), 'bold')}
          {cmd('I', () => chain().toggleItalic().run(), 'italic')}
          {cmd('U', () => chain().toggleUnderline().run(), 'underline')}
          {cmd('S', () => chain().toggleStrike().run(), 'strike')}
          {cmd('Code', () => chain().toggleCode().run(), 'code')}
          {cmd('Mark', () => chain().toggleHighlight().run(), 'highlight')}
          {cmd('H1', () => chain().toggleHeading({ level: 1 }).run(), 'heading')}
          {cmd('H2', () => chain().toggleHeading({ level: 2 }).run())}
          {cmd('• List', () => chain().toggleBulletList().run(), 'bulletList')}
          {cmd('1. List', () => chain().toggleOrderedList().run(), 'orderedList')}
          {cmd('☐ Task', () => chain().toggleTaskList().run(), 'taskList')}
          {cmd('Quote', () => chain().toggleBlockquote().run(), 'blockquote')}
          {cmd('HR', () => chain().setHorizontalRule().run())}
          {cmd('Blue', () => chain().setColor('var(--accent-blue)').run())}
          {cmd('28px', () => chain().setFontSize('28px').run())}
          {cmd('Georgia', () => chain().setFontFamily('Georgia, serif').run())}
          {cmd('Undo', () => chain().undo().run())}
          {cmd('Redo', () => chain().redo().run())}
        </div>
      )}

      <div className="min-h-40 rounded border p-3">
        <TiptapArea
          value={value}
          onChange={setValue}
          editable
          placeholder="Type here…"
          onEditor={setEditor}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide">Stored (ProseMirror JSON)</h2>
          <pre className="max-h-72 overflow-auto rounded border bg-card p-2 text-[11px]">{
            (() => {
              try {
                return JSON.stringify(JSON.parse(value), null, 1)
              } catch {
                return value
              }
            })()
          }</pre>
        </section>
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide">
            Legacy view — pmDocToStoredText (what pptx/docx export sees)
          </h2>
          <pre className="max-h-72 overflow-auto rounded border bg-card p-2 text-[11px]">
{JSON.stringify(stored, null, 1)}
          </pre>
        </section>
      </div>
    </div>
  )
}
