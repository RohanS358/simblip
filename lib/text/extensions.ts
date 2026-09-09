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
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { Extension, Node, mergeAttributes, type Extensions } from '@tiptap/core'
import { DEFAULT_PARAGRAPH, resolveStyle, type ParagraphFormat } from './doc-styles'

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

// ── The Word-style document flow ─────────────────────────────────────────
// Everything below is used ONLY by a `doc` page's flowing body (see
// components/workspace/doc-flow.tsx). A text box on a canvas keeps the
// leaner textExtensions() set above — it has no pages to break across, no
// ruler, and no margins, so paragraph geometry would be dead weight there.

/** Paragraph-level geometry (§12): alignment, the three indents, the two
 *  spacings, line height, and the two pagination hints. Added as GLOBAL
 *  attributes rather than by re-declaring the Paragraph node, so headings and
 *  list paragraphs get the same knobs for free and StarterKit's own nodes
 *  stay untouched.
 *
 *  Every value is rendered as inline CSS — which is what makes the browser,
 *  and not us, the line breaker. `indentFirstLine` is `text-indent`, a
 *  property that already means exactly Word's first-line indent including the
 *  negative/hanging case, so there is nothing to compute.
 *
 *  The two keep-* flags render as data attributes instead: they change nothing
 *  visually, they are instructions to the pagination pass, which reads them
 *  back off the measured DOM element (lib/text/pagination-plugin.ts). */
const ParagraphFormatting = Extension.create({
  name: 'paragraphFormatting',
  addGlobalAttributes() {
    const px = (v: unknown) => (typeof v === 'number' && v !== 0 ? `${v}px` : null)
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          // Named style (lib/text/doc-styles.ts). Null = Normal, or — on a
          // heading — the style its level implies.
          style: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-style'),
            renderHTML: (a: Record<string, unknown>) => (a.style ? { 'data-style': String(a.style) } : {}),
          },
          align: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.textAlign || null,
            renderHTML: (a: Record<string, unknown>) => (a.align ? { style: `text-align: ${a.align}` } : {}),
          },
          indentLeft: {
            default: null,
            parseHTML: (el: HTMLElement) => parseFloat(el.style.marginLeft) || null,
            renderHTML: (a: Record<string, unknown>) =>
              px(a.indentLeft) ? { style: `margin-left: ${px(a.indentLeft)}` } : {},
          },
          indentRight: {
            default: null,
            parseHTML: (el: HTMLElement) => parseFloat(el.style.marginRight) || null,
            renderHTML: (a: Record<string, unknown>) =>
              px(a.indentRight) ? { style: `margin-right: ${px(a.indentRight)}` } : {},
          },
          indentFirstLine: {
            default: null,
            parseHTML: (el: HTMLElement) => parseFloat(el.style.textIndent) || null,
            renderHTML: (a: Record<string, unknown>) =>
              px(a.indentFirstLine) ? { style: `text-indent: ${px(a.indentFirstLine)}` } : {},
          },
          spaceBefore: {
            default: null,
            parseHTML: (el: HTMLElement) => parseFloat(el.style.marginTop) || null,
            renderHTML: (a: Record<string, unknown>) =>
              px(a.spaceBefore) ? { style: `margin-top: ${px(a.spaceBefore)}` } : {},
          },
          spaceAfter: {
            default: null,
            parseHTML: (el: HTMLElement) => parseFloat(el.style.marginBottom) || null,
            renderHTML: (a: Record<string, unknown>) =>
              px(a.spaceAfter) ? { style: `margin-bottom: ${px(a.spaceAfter)}` } : {},
          },
          lineHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => parseFloat(el.style.lineHeight) || null,
            renderHTML: (a: Record<string, unknown>) =>
              a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {},
          },
          keepWithNext: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-keep-with-next') === 'true' || null,
            renderHTML: (a: Record<string, unknown>) => (a.keepWithNext ? { 'data-keep-with-next': 'true' } : {}),
          },
          keepTogether: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-keep-together') === 'true' || null,
            renderHTML: (a: Record<string, unknown>) => (a.keepTogether ? { 'data-keep-together': 'true' } : {}),
          },
        },
      },
    ]
  },
})

/** An explicit page break (§22). A leaf block whose only job is to tell the
 *  pagination pass "end the page here" — it has no height of its own and
 *  renders as a thin dashed rule so the author can see and delete it. */
const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },
  renderHTML() {
    return ['div', { 'data-page-break': 'true', class: 'doc-page-break' }]
  },
})

/** A picture in the flow — from a .docx's inline drawings, or pasted.
 *
 *  The source is kept in `data-src` rather than `src` because it is an
 *  `opfs:<fileId>` reference, not a URL a browser could fetch: an <img src>
 *  pointing at it would render a broken-image icon for one frame and log a
 *  network error. resolveFlowImages (components/workspace/doc-flow.tsx) swaps
 *  in a blob URL once the bytes are read. Deliberately NOT a React NodeView —
 *  the node has no interactive parts, and a NodeView per image would put a
 *  React root inside every line box of a long document. */
const DocImage = Node.create({
  name: 'docImage',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-src'),
        renderHTML: (a: Record<string, unknown>) => (a.src ? { 'data-src': String(a.src) } : {}),
      },
      width: { default: null },
      height: { default: null },
      alt: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: 'img[data-src]' }, { tag: 'img[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'doc-image' })]
  },
})

/** The schema for a doc page's body. Strictly a superset of textExtensions()
 *  — a text box's stored ProseMirror JSON is therefore valid flow content and
 *  vice versa, which is what lets "Pull text boxes into body" be a move rather
 *  than a conversion. */
export function docExtensions(options: TextExtensionOptions = {}): Extensions {
  return [
    ...textExtensions(options),
    ParagraphFormatting,
    PageBreak,
    DocImage,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
  ]
}

/** The resolved geometry of one block, for the pagination pass and the .docx
 *  exporter. Re-exported here so callers need only one import. */
export function formatOf(node: { type?: string; attrs?: Record<string, unknown> | null }): ParagraphFormat {
  const attrs = node.attrs ?? null
  const styleId =
    (attrs?.style as string | undefined) ??
    (node.type === 'heading' ? `Heading${Math.min(3, Number(attrs?.level ?? 1))}` : null)
  return resolveStyle(styleId, attrs)
}

export { DEFAULT_PARAGRAPH }
