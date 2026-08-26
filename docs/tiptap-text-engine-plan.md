# Tiptap Text Engine — Analysis & Migration Plan

Replacing the hand-rolled contentEditable text engine with Tiptap/ProseMirror,
keeping every existing UI surface, then turning on Yjs realtime collaboration.

Status: plan. Nothing implemented yet.
Date: 2026-08-26.

---

## 1. What exists today (the honest audit)

### 1.1 The model

Text is stored as **one JSON blob in a scene object's `text` string param**:

```jsonc
{ "text": "Hello world\n- item", "marks": [ { "start": 0, "end": 5, "kind": "bold" } ] }
```

- `lib/text/marks.ts` (568 lines) — the mark model. Offset ranges over a flat
  `'\n'`-joined string. Toggle kinds (bold/italic/underline/strike/highlight/code)
  and exclusive kinds (color/size/font/weight/link).
- Block structure is **not** in the model. It is literal prefix characters left
  inside `text`: `"# "`, `"> "`, `"- "`, `"1. "`, `"- [ ] "`, and indentation is
  literal runs of 8 spaces (`INDENT_UNIT`).
- `lib/text/render.ts` (469 lines) — renders `{text, marks}` → HTML, twice:
  `renderEditorLine()` per line for the live editor, `renderMarkdown()` for the
  read-only view. Both must produce pixel-identical output.
- `components/objects/text.tsx` (1279 lines) — a bespoke editor: one
  `<div data-i>` per source line inside one contentEditable, imperative DOM
  writes, manual caret/Range math, manual mark shifting on every keystroke.

### 1.2 Why it sucks — the root causes, not the symptoms

This is not a polish problem. Four structural decisions guarantee bugs:

**(a) The DOM-length ≡ model-length invariant.**
Caret mapping (`posAt`) works by walking Ranges and assuming
`el.textContent.length === rawLine.length`. Every feature that wants to render
something *other than* the literal characters breaks this. The codebase is full
of scar tissue proving it:
- Indentation cannot be `padding-left`; it must be 8 real space glyphs, because
  padding broke the invariant (documented at `render.ts:159-176`).
- Empty prefixed lines need a `CARET_HOST` `<span>` containing a **zero-width
  space**, then two separate readers (`posAt` and `onInput`) must strip it back
  out (`stripCaretHost`).
- Bullet glyphs are `::before` on a `font-size: 0` marker span, so the real
  characters `- ` stay in the DOM at zero size.

Every one of those is a workaround for the same invariant. There will be more.

**(b) Manual offset bookkeeping on every edit.**
`shiftMarks()` must be called by hand for every insertion and deletion, with the
correct offset and delta, from ~15 call sites in `text.tsx` (Enter, Backspace,
Delete, Tab, paste, cut, selection-replace, prefix removal, list continuation…).
Miss one, or compute `lineStart(idx) + at` wrong, and formatting silently slides
onto the wrong characters. `clipDeletion` handles partial overlap. This is
re-implementing ProseMirror's `Mapping`/`StepMap` by hand, worse.

**(c) The panel↔selection bridge.**
`lib/store/text-editor.ts` exposes `snapshotSelection()` purely because focusing
a real `<input>` (the Size field) collapses `window.getSelection()` out of the
contentEditable. There is a `snapshotFreshRef` boolean guarding "a second panel
edit on the same field re-reading a stale DOM selection". This is an entire
state machine that exists only because selection lives in the DOM instead of in
a document model.

**(d) Two renderers that must agree.**
`renderEditorLine` and `renderMarkdown` are separate code paths that must stay
pixel-identical. They already diverge on indentation (8 spaces vs `2.2em`
padding) — the file admits it.

### 1.3 Capability gaps this design causes

Things the current engine cannot reasonably do, all for the same reason:
- Tables inside a text box (no block nesting — blocks are line prefixes).
- Nested lists with real semantics (nesting is a space count).
- Multi-line block quotes, code blocks with a language.
- Undo/redo scoped to the text box (undo is whole-document `pushHistory`).
- Input rules (`- ` → bullet as you type) without fighting the prefix regex.
- Realtime collaboration — offset marks cannot be merged concurrently.

### 1.4 Everything that touches the format (the blast radius)

`parse()` / `serialize()` / `runsForLine()` / `migrateLegacyMarkdown()` callers:

| File | Uses | Direction |
|---|---|---|
| `components/objects/text.tsx` | parse, serialize | read+write |
| `components/objects/note.tsx` | via `RichTextArea` | — |
| `components/workspace/inspector.tsx` | parse, serialize, applyMark | read+write |
| `components/workspace/canvas.tsx` | htmlToStoredText, serialize (paste) | write |
| `components/workspace/presentation-view.tsx` | parse (plain text) | read |
| `lib/store/pptx-export.ts` | parse, runsForLine, resolveSizePx | read |
| `lib/store/pptx-import.ts` | serialize, parse, resolveSizePx | write |
| `lib/store/docx-export.ts` / `docx-import.ts` | raw string | read/write |
| `lib/scene/page-templates.ts` | serialize | write |
| `lib/scene/selection-actions.ts` | parse (plain text) | read |
| `lib/ai/slides.ts` | serialize, migrateLegacyMarkdown | write |
| `lib/ai/explain.ts` | block prefixes, `$…$` | write |
| `lib/text/text-editing.test.mjs` | the whole mark layer | test |

**This is the real cost of the migration.** The editor rewrite is the easy half.

### 1.5 What is genuinely good and must be kept

Do not throw these away:
- `TEXT_FONTS` / `TEXT_FONT_LABELS` / `FONT_GROUPS` — 26 fonts, grouped, with
  next/font wiring. Pure data. Keep as-is.
- `TEXT_COLORS`, `TEXT_SIZES`, `TEXT_WEIGHTS`, `resolveSizePx` — pure data.
- The Properties-panel UI in `inspector.tsx:2445-3000` — the buttons, swatches,
  color wheel, font dropdown, weight steps. **The UI stays. Only its
  implementation calls change.**
- The "exclusive mark" rule (a newer size replaces an older size on the same
  text). Tiptap's `TextStyle` mark gives this for free — one mark, many attrs.
- Inline `$…$` KaTeX with the lazy-load fallback.
- The security gates: https-only links, hex-validated colors, id-looked-up fonts.

---

## 2. Target architecture

### 2.1 The one-line summary

> Replace `{text, marks}` + hand-written caret math with a **ProseMirror
> document**, edited via Tiptap, stored as ProseMirror JSON, and — for
> collaboration — backed by a **Yjs `Y.XmlFragment`** synced over the
> WebSocket route that already exists.

### 2.2 Schema mapping (current model → Tiptap)

Every current capability maps onto a stock Tiptap node/mark. Nothing here is
custom except the two marked ✱.

**Marks**

| Today | Tiptap | Extension |
|---|---|---|
| `bold` | `bold` | StarterKit |
| `italic` | `italic` | StarterKit |
| `strike` | `strike` | StarterKit |
| `code` | `code` | StarterKit |
| `underline` | `underline` | StarterKit |
| `link` (https-gated) | `link` | `@tiptap/extension-link` |
| `highlight` | `highlight` | `@tiptap/extension-highlight` |
| `color` | `textStyle` attr `color` | `@tiptap/extension-text-style` |
| `size` | `textStyle` attr `fontSize` | TextStyle (built-in in v3) |
| `font` | `textStyle` attr `fontFamily` | TextStyle (built-in in v3) |
| `weight` ✱ | `textStyle` attr `fontWeight` | one custom attr on TextStyle |

The four exclusive kinds collapse into **one** `textStyle` mark with four
attributes. That is exactly the "newer value replaces older" semantic
`applyMark`'s exclusive branch hand-implements — ProseMirror gives it for free,
because two marks of the same type with different attrs cannot coexist on a
character.

**Nodes**

| Today (line prefix) | Tiptap node | Extension |
|---|---|---|
| `# ` … `###### ` | `heading` level 1-6 | StarterKit |
| `> ` | `blockquote` | StarterKit |
| `- ` / `* ` / `+ ` | `bulletList` > `listItem` | StarterKit |
| `1. ` | `orderedList` > `listItem` | StarterKit |
| `- [ ] ` | `taskList` > `taskItem` | `@tiptap/extension-task-list` |
| `---` | `horizontalRule` | StarterKit |
| 8-space indent | real list nesting / `Indent` | list nesting (Tab) |
| `$…$` ✱ | `mathInline` node | `@tiptap/extension-mathematics` |
| — (new) | `codeBlock`, `table` | StarterKit / extension-table |

Indentation stops being spaces and becomes actual nesting. Tab/Shift-Tab are
`sinkListItem`/`liftListItem`. That deletes `INDENT_UNIT`, `splitIndent`, and
`indentLine` outright.

### 2.3 Storage format

Store **ProseMirror JSON** in the same `parameters.text` string param:

```jsonc
{ "type": "doc", "content": [ { "type": "paragraph", "content": [
  { "type": "text", "marks": [{"type":"bold"}], "text": "Hello" } ] } ] }
```

Detection is already solved: `parse()` sniffs `raw[0] === '{'`. Add a second
sniff for `obj.type === 'doc'`. Everything else falls through to the existing
legacy path.

**Three storage generations, one reader:**

```
raw string           → migrateLegacyMarkdown()  → {text,marks} → storedTextToPmDoc()
{text, marks} JSON   → (current)                              → storedTextToPmDoc()
{type:"doc", ...}    → (target)                               → used directly
```

`storedTextToPmDoc()` is the one new conversion function that matters. It is
mechanical: split `text` on `\n`, match each line against `BLOCK_PREFIX_RE`
(reuse it — do not rewrite it), emit the corresponding node, and turn
`runsForLine()` output into text nodes with marks. **`runsForLine` already does
the hard flattening work** — reuse it rather than writing a new one.

Migration is lazy and non-destructive: read old, write new. No batch job, no
DB migration, no downtime. An old page opens, converts in memory, and only
persists PM JSON when the user actually edits it.

### 2.4 Export path: `pmDocToStoredText()`

pptx-export, docx-export, presentation-view and selection-actions all consume
`{text, marks}`. Rather than rewrite four exporters, add the **inverse**
converter and keep them untouched:

```ts
pmDocToStoredText(doc: PmJSON): StoredText  // blocks → line prefixes, marks → ranges
```

This is the lazy move: one function preserves four consumers. It is lossy for
things the old model cannot express (tables, code blocks) — those degrade to
plain text lines, which is what pptx-export would do anyway.

Do this **first**, before touching the editor. It de-risks everything after.

---

## 3. Realtime collaboration

### 3.1 What you already have (do not rebuild it)

- `app/api/board-live/[sessionId]/route.ts` — a working WebSocket endpoint on
  Vercel via `experimental_upgradeWebSocket` from `@vercel/functions`.
- `lib/server/board-live-bus.ts` — Redis pub/sub fan-out across function
  instances (`registerSocket` / `publish` / `ensureBoardLiveListener`).
- `lib/data/board-live-client.ts` — client transport with exponential-backoff
  reconnect, already treating drops as routine (Vercel force-closes at max
  duration).
- Auth over `?token=` with `verifyToken`, and per-session authorization.

**You do not need Hocuspocus, y-websocket's server, Liveblocks, or PartyKit.**
Yjs updates are opaque `Uint8Array`s. Your bus already fans out opaque
messages. Add one message type and you have a collab provider.

### 3.2 The protocol addition

```ts
// lib/data/board-live-types.ts
type BoardLiveClientMsg =
  | …existing…
  | { type: 'ydoc'; objectId: string; update: string }   // base64 Yjs update
  | { type: 'yawareness'; objectId: string; update: string }

type BoardLiveServerMsg =
  | …existing…
  | { type: 'ydoc'; objectId: string; update: string; origin: BoardLiveRole }
  | { type: 'yawareness'; objectId: string; update: string; origin: BoardLiveRole }
```

Base64 because the channel is JSON today. Costs ~33% size on keystroke-sized
deltas (tens of bytes) — irrelevant. Do not switch the whole channel to binary
for this.

### 3.3 The custom provider

A Yjs provider is ~80 lines. It needs exactly four things:

1. On `doc.on('update', …)` → send `{type:'ydoc', objectId, update: b64}`.
2. On receiving `ydoc` → `Y.applyUpdate(doc, fromB64(update))`.
3. On connect → send `Y.encodeStateAsUpdate(doc)` (full state, so a late joiner
   converges) and apply whatever comes back.
4. Awareness (cursors/names) via `y-protocols/awareness`, same two steps.

Yjs is a CRDT: applying updates in any order, twice, or out of order converges.
Reconnect needs no special handling beyond re-sending state. This is why the
existing "drops are routine" transport is *sufficient* rather than merely
tolerable.

### 3.4 Persistence

Server-side, on `ydoc` messages: broadcast first, persist after (the exact
pattern `obj-patch` already uses at `route.ts:66-80`).

Persist strategy — **debounced snapshot, not update log**:
- Keep a `Y.Doc` per active object server-side (or just accept the client's
  snapshot).
- Every ~10s of quiet, write `pmDocToJson(yDocToPm(doc))` into
  `parameters.text` via the existing `edited` jsonb path.

This means the durable storage stays plain PM JSON — **the Yjs doc is transport,
not the source of truth**. Enormous simplification: offline pages, exports,
templates, and the AI all keep reading a plain JSON document. No `y-indexeddb`
required, no Yjs dependency in any export path.

`ponytail:` snapshot-on-quiet, not an append-only update log — upgrade to an
update log only if you need version history / time-travel.

### 3.5 Offline & single-user

When `NEXT_PUBLIC_BOARD_LIVE !== '1'` or no session is live, **do not create a
Y.Doc at all**. Tiptap runs plain, with its own history extension, writing PM
JSON on change. Collaboration is a strictly additive layer:

```
Collaboration OFF → StarterKit history, onUpdate → setStringParam
Collaboration ON  → Collaboration + CollaborationCaret, history from Yjs
```

Note: `@tiptap/extension-collaboration` **requires disabling StarterKit's
`undoRedo`** (Yjs owns undo). Wire that as a conditional in the extension array.

---

## 4. The plan

Ten phases. Phases A–C are the risky part; after C the rest is mechanical.
Each phase is independently shippable and leaves the app working.

### Phase A — Converters + tests (no UI change)

New file `lib/text/pm.ts`:
- `storedTextToPmDoc(stored: StoredText): PmJSON`
- `pmDocToStoredText(doc: PmJSON): StoredText`
- `isPmDoc(raw: string): boolean`

Extend `parse()` in `marks.ts` to route PM JSON, or better — add
`parseDoc(raw): PmJSON` in `pm.ts` as the new single entry point and leave
`parse()` alone for now.

Test (`lib/text/pm.test.mjs`, node:test, same style as `text-editing.test.mjs`):
round-trip property — for a corpus of `{text, marks}` covering every mark kind,
every block prefix, nesting, and mixed marks:
`pmDocToStoredText(storedTextToPmDoc(x))` ≈ `x`.

**Ship gate:** tests pass. Zero runtime behavior change.

### Phase B — Install and stand up a bare Tiptap editor

```bash
npm i @tiptap/react @tiptap/core @tiptap/pm @tiptap/starter-kit \
      @tiptap/extension-text-style @tiptap/extension-highlight \
      @tiptap/extension-underline @tiptap/extension-link \
      @tiptap/extension-task-list @tiptap/extension-task-item \
      @tiptap/extension-mathematics
```
(all `3.30.5`; `@tiptap/pm` is the ProseMirror bundle — do not install
prosemirror-* directly)

New file `lib/text/extensions.ts` — the single shared extension list, so the
editor, any future read-only renderer, and the server-side converter agree.
Add the `fontWeight` attr to TextStyle here.

New file `components/objects/text-editor.tsx` — `<TiptapArea>`, initially used
by nothing. Renders, types, applies bold. Nothing else.

**Ship gate:** it renders and types behind a dev-only flag.

### Phase C — Swap `RichTextArea`'s internals

This is the phase that deletes the pain.

- `RichTextArea` keeps its **exact same props** (`placeholder`, `padY`,
  `autoEdit`, `deleteWhenEmpty`, `hug`, `fillHeight`, `className`). `note.tsx`
  and `TextObject` do not change.
- Inside: `useEditor()` instead of `useLiveTextEditor()`.
- `onUpdate` → `setStringParam(pageId, object.id, 'text', JSON.stringify(editor.getJSON()))`,
  debounced.
- Read-only view: `<EditorContent editor={editor} editable={false} />` — **one
  renderer, not two**. This alone deletes `renderEditorLine` vs
  `renderMarkdown` divergence.
- Keep grow-only autosize (`fit()`), it is orthogonal and correct.

**Deleted in this phase:** `useLiveTextEditor` (~880 lines), `posAt`,
`placeCaretAt`, `selectRange`, `replaceRange`, `caretPosition`,
`selectionSpan`, `indentLine`, `CARET_HOST`, `stripCaretHost`, all
`shiftMarks` call sites.

**Ship gate:** typing, Enter, Backspace, lists, headings, paste, undo all work
in a text box and a note. Old documents open correctly.

### Phase D — Rewire the Properties panel

`lib/store/text-editor.ts` becomes:

```ts
export interface TextEditorHandle { editor: Editor | null }
```

That is the whole interface. `toggleMark`, `prefixLine`, `setSpan` and
**`snapshotSelection` all disappear** — Tiptap commands operate on the stored
document selection, which does not evaporate when an `<input>` takes focus.
`snapshotFreshRef` and its entire state machine go with it.

`inspector.tsx` call-site changes only (the UI markup is untouched):

| Before | After |
|---|---|
| `toggleMark('bold')` | `editor.chain().focus().toggleBold().run()` |
| `toggleMark('highlight')` | `…toggleHighlight().run()` |
| `prefixLine('- ')` | `…toggleBulletList().run()` |
| `prefixLine('- [ ] ')` | `…toggleTaskList().run()` |
| `prefixLine('# ')` | `…toggleHeading({level:1}).run()` |
| `setSpan('color', id)` | `…setColor(v).run()` |
| `setSpan('size', '22')` | `…setMark('textStyle',{fontSize:'22px'}).run()` |
| `setSpan('font', id)` | `…setFontFamily(TEXT_FONTS[id]).run()` |
| `setSpan('link', url)` | `…setLink({href:url}).run()` |
| `snapshotSelection()` | *(delete the call)* |

**Bonus that was previously impossible:** `editor.isActive('bold')` gives the
panel live active-state, so the Bold button can finally light up.

**Ship gate:** every panel control works, including the Size number input and
the color wheel, without any snapshot dance.

### Phase E — Input rules, shortcuts, slash menu

- Markdown input rules come free with StarterKit (`- ` → bullet, `# ` →
  heading, `> ` → quote, `1. ` → ordered).
- Ctrl+B/I/U: StarterKit. Remove the hand-rolled branches in `onKeyDown`.
- Tab/Shift+Tab: list sink/lift.
- Keep `e.stopPropagation()` on the editor container so canvas shortcuts do not
  fire while typing — that guard is still needed and still correct.

### Phase F — KaTeX

`@tiptap/extension-mathematics` provides `mathInline`. Point its renderer at
the existing `lib/text/katex-lazy.ts` so the lazy chunk and the
"render literal source until loaded" fallback are preserved. Keep
`useKatexReady`.

### Phase G — Paste

Tiptap handles HTML paste natively via `parseHTML` on each extension — this
replaces `htmlToStoredText()` for in-editor paste entirely.

Keep `htmlToStoredText` for **canvas-level** paste (`canvas.tsx:1667`, pasting
onto empty canvas to create a new box) but pipe it through
`storedTextToPmDoc()`. Or, cleaner: use `generateJSON(html, extensions)` from
`@tiptap/html`. Keep the existing `e.stopPropagation()` double-guard — the
comment says both guards have failed alone before; believe it.

### Phase H — Export/import round-trip verification

No code change expected if Phase A is right, but verify for real:
- pptx export → open in PowerPoint → bold/size/color/bullets intact.
- pptx import → a deck's runs land as real marks.
- docx export/import.
- presentation-view plain-text extraction.
- AI slides (`lib/ai/slides.ts`) — switch `serialize({text, marks})` to
  emit PM JSON directly, or leave it emitting the old format and let
  `parseDoc` convert. **Leave it.** Lazier and it still works.

### Phase I — Collaboration

1. Add `ydoc`/`yawareness` to `board-live-types.ts` and the route's
   `handleMessage`.
2. `npm i yjs y-prosemirror y-protocols @tiptap/extension-collaboration @tiptap/extension-collaboration-caret`
3. `lib/text/collab-provider.ts` — the ~80-line provider over
   `connectBoardLive`.
4. Conditional extensions in `RichTextArea`: when a live session exists, add
   `Collaboration.configure({ document: ydoc, field: object.id })` +
   `CollaborationCaret.configure({ provider, user: {name, color} })`, and set
   `StarterKit.configure({ undoRedo: false })`.
5. Server: debounced snapshot write to `parameters.text`.

**Ship gate:** two browsers, same board session, same text box, concurrent
typing converges with visible remote carets.

### Phase J — Delete the dead code

- `lib/text/render.ts` — delete `renderEditorLine`, `CARET_HOST_CHAR`,
  `stripCaretHost`. `renderMarkdown` may survive briefly for the AI answer
  renderer; check `lib/ai/answer-formatting.test.mjs` first.
- `lib/text/marks.ts` — keep the **data** (`TEXT_FONTS`, `TEXT_COLORS`,
  `TEXT_SIZES`, `TEXT_WEIGHTS`, `FONT_GROUPS`, `resolveSizePx`,
  `BLOCK_PREFIX_RE`) and the legacy migration. Delete `applyMark`,
  `shiftMarks`, `clipDeletion`, `splitIndent`, `continuationPrefix`,
  `INDENT_UNIT`. Keep `runsForLine` — `pmDocToStoredText` and pptx-export use it.
- `lib/text/text-editing.test.mjs` — the nine regression cases it covers become
  structurally impossible. Delete it; `pm.test.mjs` replaces it.

Expected net: **−1500 lines, +400 lines.**

---

## 5. Risks and the honest answers

**"Tiptap is a big dependency."**
~250KB gzipped for the full set. Non-negotiable if you want a real editor —
the alternative is the 2300 lines you already have, which is worse and buggier.
Mitigate with `next/dynamic` on the editor (the read-only path can render from
PM JSON without loading ProseMirror at all, via `generateHTML` at build/render
time — worth doing on the presentation view where boxes are never editable).

**"Migration will corrupt documents."**
Mitigated by lazy conversion (read old / write new only on edit), by the Phase A
round-trip test being a ship gate, and by keeping the legacy migration path
intact. Add a `docs/` note: no batch migration, ever.

**"pptx/docx export will regress."**
This is the real risk, not the editor. `pmDocToStoredText` is the mitigation and
it is built in Phase A, before anything can break. Phase H verifies with real
files.

**"Vercel WebSockets will drop mid-edit."**
They will — the existing client already treats this as routine. Yjs's CRDT
property means a drop costs nothing but latency. This is the one place the
architecture is *already* better suited to collab than to what it does today.

**"Yjs and the doc store will fight over `parameters.text`."**
Only if both write. The rule: **when collab is on, Yjs owns the field and only
the server's debounced snapshot writes it.** When collab is off, `onUpdate`
writes it. Never both. Enforce in one place, in `RichTextArea`.

**"Custom `fontSize`/`fontWeight` attrs on TextStyle are custom code."**
Yes — about 20 lines, `addAttributes` with `parseHTML`/`renderHTML`. That is the
entire custom surface of the whole schema. Acceptable.

---

## 6. What you get that you cannot get today

Free with the migration, no extra work:
- Tables, code blocks with syntax highlighting, real nested lists.
- Per-box undo/redo (`editor.commands.undo()`), scoped correctly.
- Live active-state on every panel button.
- Markdown input rules as you type.
- Collaborative editing with cursors.
- Drag-and-drop of content within a box.
- A schema that **rejects invalid documents** instead of rendering them wrong.

---

## 7. Recommended order of attack

Do not do all ten phases in one go. The natural stopping points:

1. **A + B** — converters and a bare editor behind a flag. Low risk, high
   confidence gain. *Start here.*
2. **C + D** — the actual swap. This is the day the editor stops sucking.
3. **E + F + G** — polish: input rules, math, paste.
4. **H** — verify exports for real, with real files.
5. **I** — collaboration.
6. **J** — delete the corpse.

Phases 1–3 alone are worth doing even if collaboration never ships.

---

## Appendix — key file map

| Path | Fate |
|---|---|
| `components/objects/text.tsx` | gutted; `RichTextArea` shell survives, props unchanged |
| `components/objects/note.tsx` | untouched |
| `lib/text/marks.ts` | data + legacy migration survive; edit algebra deleted |
| `lib/text/render.ts` | mostly deleted |
| `lib/text/pm.ts` | **new** — converters |
| `lib/text/extensions.ts` | **new** — shared schema |
| `lib/text/collab-provider.ts` | **new** — Yjs over board-live |
| `lib/store/text-editor.ts` | shrinks to `{ editor }` |
| `components/workspace/inspector.tsx` | call sites only; UI markup untouched |
| `lib/data/board-live-types.ts` | +2 message types |
| `app/api/board-live/[sessionId]/route.ts` | +1 handler branch |
| `lib/store/pptx-export.ts`, `docx-*`, `page-templates.ts`, `ai/slides.ts` | untouched (via `pmDocToStoredText`) |
