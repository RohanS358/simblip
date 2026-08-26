// The ONE Tiptap schema for every rich-text surface in the app — the live
// editor, the read-only view, and any HTML/JSON conversion. Defined in a
// single place so those can never drift apart, which is precisely what went
// wrong with the previous engine: it had two renderers (renderEditorLine and
// renderMarkdown) that were required to produce pixel-identical output and
// already disagreed about indentation.
//
// Mapping from the legacy mark model (lib/text/marks.ts), for reference:
//
//   bold/italic/underline/strike/code   → the same-named StarterKit marks
//   highlight                           → Highlight
//   link                                → StarterKit's Link (https-gated below)
//   color / size / font / weight        → ONE textStyle mark, four attributes
//
// That last line is the real simplification. The legacy model needed an
// "exclusive kind" rule enforced by hand in applyMark() — a newer size had
// to clip and replace an older one, or two sizes would both cover the same
// character. ProseMirror gives that for free: two marks of the same type
// with different attributes cannot coexist on one character, so the rule is
// structural rather than something a function has to remember to apply.
//
// Block structure (headings, lists, quotes, rules) stops being literal
// prefix characters living inside the text and becomes real nodes, and
// indentation stops being runs of 8 spaces and becomes real list nesting.

import { StarterKit } from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Highlight } from '@tiptap/extension-highlight'
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import type { Extensions } from '@tiptap/core'

/** Adds `fontWeight` to the textStyle mark. The only custom schema in the
 *  whole set — Tiptap ships Color/FontFamily/FontSize as first-class
 *  extensions, but named weight steps (TEXT_WEIGHTS: thin…black) are a
 *  Figma-style concept this app added, distinct from the `bold` toggle mark
 *  which is always 700. */
const FontWeight = TextStyle.extend({
  name: 'textStyleFontWeight',
  addAttributes() {
    return {
      fontWeight: {
        default: null,
        parseHTML: (element: HTMLElement) => element.style.fontWeight || null,
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.fontWeight ? { style: `font-weight: ${attributes.fontWeight}` } : {},
      },
    }
  },
})

export interface TextExtensionOptions {
  placeholder?: string
  /** Yjs owns history when collaboration is on — StarterKit's own undo/redo
   *  must be off in that case or the two fight over the same keystrokes.
   *  See docs/tiptap-text-engine-plan.md §3.5. */
  collaborative?: boolean
}

export function textExtensions({ placeholder, collaborative = false }: TextExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      // Yjs supplies history in collaborative mode (Phase I).
      undoRedo: collaborative ? false : undefined,
      link: {
        openOnClick: false,
        autolink: true,
        // Same https-only gate the legacy renderer applied before writing a
        // value into an href — stored content is not a trusted source, and
        // this is the one place a javascript: URL could otherwise get in.
        protocols: ['http', 'https'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
    Highlight,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    FontWeight,
    TaskList,
    TaskItem.configure({ nested: true }),
    // Styled by `.tiptap-editor .tiptap p.is-editor-empty:first-child::before`
    // in globals.css, which reads the data-placeholder attribute this sets.
    Placeholder.configure({ placeholder: placeholder ?? '' }),
  ]
}
