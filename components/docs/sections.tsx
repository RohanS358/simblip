'use client'

// The SIMBLIP user manual — content only. /docs (components/docs/docs-view)
// renders it; this file is the one place the prose lives.
//
// Reference tables that CAN be generated are generated: components, behaviors,
// keyboard shortcuts and the role/permission matrix all read the same modules
// the app itself reads (lib/scene/factory, lib/behaviors/registry,
// lib/keymap, lib/auth/types), so adding a component or rebinding a default
// key updates the manual with it. Hand-written prose covers only what no
// registry knows: what a thing is FOR and how to use it.

import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Atom,
  BookOpen,
  BrainCircuit,
  Boxes,
  Files,
  GraduationCap,
  HardDrive,
  Keyboard,
  LayoutDashboard,
  LifeBuoy,
  Package,
  PenTool,
  Play,
  Rocket,
  Settings,
  Shapes,
  Sigma,
  Terminal,
} from 'lucide-react'
import { Kbd } from '@/components/ui/kbd'
import { ACTIONS, SHORTCUT_GROUPS, comboLabel } from '@/lib/keymap'
import { BEHAVIOR_SPECS } from '@/lib/behaviors/registry'
import { COMPONENTS } from '@/lib/scene/factory'
import { COMPONENT_PACKAGES } from '@/lib/packages/registry'
import { can, ROLE_LABEL, type Permission, type Role } from '@/lib/auth/types'
import { Bullets, C, Callout, Chips, Defs, Grid, Lead, P, Steps, UI } from './prose'
import { Figure, FigureRow } from './figure'

export interface DocArticle {
  id: string
  title: string
  /** Extra words the search box should match on beyond the title. */
  keywords?: string
  body: React.ReactNode
}

export interface DocSection {
  id: string
  title: string
  icon: LucideIcon
  blurb: string
  articles: DocArticle[]
}

// ── Generated reference blocks ──────────────────────────────────────────────

/** Every palette component, grouped by the package it ships in. */
function ComponentInventory() {
  return (
    <div className="space-y-5">
      {COMPONENT_PACKAGES.map((pkg) => {
        const items = COMPONENTS.filter(
          (c) => c.domain === pkg.domain && !c.id.startsWith('system-')
        )
        if (items.length === 0) return null
        return (
          <div key={pkg.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h4 className="text-ui-md font-semibold text-foreground">{pkg.name}</h4>
              <span className="text-ui-2xs uppercase tracking-wider text-muted-foreground">
                {items.length} components
              </span>
            </div>
            <P>{pkg.description}</P>
            <Chips items={items.map((c) => c.label)} />
          </div>
        )
      })}
    </div>
  )
}

/** The behavior registry, rendered as the Add Behavior menu shows it. */
function BehaviorInventory() {
  return (
    <div className="space-y-2">
      {BEHAVIOR_SPECS.map((b) => (
        <div key={b.type} className="rounded-xl border border-border/50 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-ui-sm font-semibold text-foreground">{b.label}</span>
            <C>{b.type}</C>
            {!b.live && (
              <span className="rounded-full bg-[color-mix(in_oklch,var(--accent-amber)_18%,transparent)] px-1.5 py-px text-ui-3xs font-bold uppercase tracking-wider text-[var(--accent-amber)]">
                solver pending
              </span>
            )}
          </div>
          <p className="mt-1 text-ui-sm leading-[1.65] text-muted-foreground">{b.hint}</p>
          {b.params.length > 0 && (
            <p className="mt-1.5 text-ui-xs text-muted-foreground/80">
              <span className="font-medium text-foreground/70">Parameters: </span>
              {b.params.map((p) => p.label).join(' · ')}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

/** The live keymap. Labels are recomputed after mount because comboLabel()
 *  reads navigator to decide ⌘ vs Ctrl — rendering that during SSR would
 *  hydrate-mismatch on a Mac. */
function ShortcutTable() {
  const [labels, setLabels] = useState<Record<string, string>>({})
  useEffect(() => {
    setLabels(Object.fromEntries(ACTIONS.map((a) => [a.id, comboLabel(a.default)])))
  }, [])

  const WHEN: Record<string, string> = {
    'while-editing': 'while editing',
    'while-paused': 'while paused',
    'while-running-or-paused': 'while running or paused',
  }

  return (
    <div className="space-y-5">
      {SHORTCUT_GROUPS.map((group) => (
        <div key={group} className="space-y-2">
          <h4 className="text-ui-md font-semibold text-foreground">{group}</h4>
          <dl className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50">
            {ACTIONS.filter((a) => a.group === group).map((a) => (
              <div key={a.id} className="flex items-center gap-3 px-3.5 py-2">
                <dt className="min-w-0 flex-1 text-ui-sm text-muted-foreground">
                  {a.label}
                  {a.when && (
                    <span className="ml-1.5 text-ui-2xs text-muted-foreground/70">
                      ({WHEN[a.when]})
                    </span>
                  )}
                </dt>
                <dd className="shrink-0">
                  <Kbd>{labels[a.id] ?? comboLabel(a.default)}</Kbd>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <Callout tone="tip" title="Rebinding">
        <p>
          Every one of these is editable in <UI>Settings → Hotkeys</UI>. Click a shortcut, press the
          combination you want, and it takes effect immediately — a combination already claimed by
          another action is refused rather than silently stolen.
        </p>
      </Callout>
    </div>
  )
}

/** Who can do what, straight out of lib/auth/types. */
const PERMISSIONS: [Permission, string][] = [
  ['edit-notebooks', 'Create and edit notebooks'],
  ['use-ai', 'Use the AI assistant'],
  ['browse-library', 'Browse the institution library'],
  ['publish-library', 'Publish to the library'],
  ['approve-library', 'Approve library submissions'],
  ['share-pages', 'Share a page with someone'],
  ['create-assignments', 'Create assignments'],
  ['review-submissions', 'Review submissions'],
  ['submit-assignments', 'Submit assignments'],
  ['present-on-board', 'Present on a room board'],
  ['manage-institution', 'Manage the institution'],
]

const ROLES: Role[] = ['admin', 'teacher', 'student', 'board']

function PermissionMatrix() {
  return (
    <Grid
      head={['Capability', ...ROLES.map((r) => ROLE_LABEL[r])]}
      rows={PERMISSIONS.map(([perm, label]) => [
        label,
        ...ROLES.map((role) => (can(role, perm) ? '✓' : '—')),
      ])}
    />
  )
}

// ── The manual ──────────────────────────────────────────────────────────────

export const SECTIONS: DocSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    icon: Rocket,
    blurb: 'What SIMBLIP is, the one idea behind it, and your first working simulation.',
    articles: [
      {
        id: 'what-it-is',
        title: 'What SIMBLIP is',
        keywords: 'overview intro introduction about product notebook simulation engine',
        body: (
          <>
            <Lead>
              SIMBLIP is an engineering notebook where the things you draw can be simulated. Notes,
              sketches, circuits, equations, graphs, code and live experiments all live on the same
              canvas, in the same pages, inside the same notebook tree.
            </Lead>
            <P>
              It is not a drawing app with a physics demo bolted on, and not a physics simulator
              with a notes tab. There is one document model: everything on a page is an object, and
              any object can be given physical meaning. That is why a pendulum can sit next to the
              paragraph explaining it, share a variable with the graph plotting it, and keep running
              while you edit both.
            </P>
            <P>
              SIMBLIP is licensed to institutions rather than sold as individual accounts. Your
              school, college or university is provisioned as a tenant, and you sign in with the
              account it issues you. Which parts of the app you see depends on your role — see{' '}
              <UI>Classroom platform</UI>.
            </P>
            <Figure
              name="workspace"
              alt="The SIMBLIP workspace: header and tab strip on top, icon rail and notebook tree on the left, an infinite canvas holding a spring, a mass, a ground plane and a live graph, and the tool dock floating at the bottom."
              caption="The whole workspace. Header and tabs across the top, the icon rail and its panel down the left, the tool dock floating over the canvas, and — on this page — a spring, a mass, a ground plane and a graph bound to the mass."
            />
          </>
        ),
      },
      {
        id: 'core-idea',
        title: 'The core idea: geometry + behaviors',
        keywords: 'concept model architecture behavior geometry attach convert philosophy',
        body: (
          <>
            <P>
              Every object on a page is <UI>dumb geometry</UI> — a circle, a rectangle, a polygon, a
              line, a pen stroke, a piece of text, a schematic symbol — plus a list of{' '}
              <UI>behaviors</UI> attached to it. The geometry decides what it looks like. The
              behaviors decide what it does.
            </P>
            <Bullets
              items={[
                <>A circle with nothing attached is a drawing.</>,
                <>
                  The same circle with a <UI>Rigid Body</UI> attached has mass, falls, collides and
                  spins.
                </>,
                <>
                  With a <UI>Static Body</UI> instead, it is an immovable wall.
                </>,
                <>
                  With a <UI>Motor</UI>, it drives its own rotation. With a <UI>Charge</UI>, it
                  responds to electric fields.
                </>,
              ]}
            />
            <P>
              Nothing in the palette is privileged. A <UI>Mass</UI> from the Components panel is
              literally a circle with a Rigid Body pre-attached — you could have drawn the circle and
              attached the behavior yourself, and the result would be identical. The palette saves
              clicks, it does not unlock anything.
            </P>
            <Callout tone="tip" title="Why this matters to you">
              <p>
                If you can find a behavior in the Properties panel, you can attach it to anything the
                behavior accepts. There is no “convert to simulation object” wizard to learn, because
                converting IS attaching a behavior.
              </p>
            </Callout>
          </>
        ),
      },
      {
        id: 'first-sim',
        title: 'Your first simulation',
        keywords: 'tutorial quickstart first steps how to start walkthrough example pendulum',
        body: (
          <>
            <P>Five minutes, no prior setup. From a signed-in notebook:</P>
            <Steps
              items={[
                <>
                  Create a page. In the notebook tree press <UI>+</UI> and pick{' '}
                  <UI>Whiteboard</UI> — an infinite board is the simplest surface to experiment on.
                </>,
                <>
                  Open <UI>Components</UI> in the left rail, stay on the <UI>Mechanics</UI> tab, and
                  click <UI>Ground</UI>. Now click low down on the canvas to place it. The component
                  stays armed, so you can place several.
                </>,
                <>
                  Click <UI>Mass</UI> and drop one well above the ground. Press <Kbd>Esc</Kbd> to go
                  back to the Select tool.
                </>,
                <>
                  Press <UI>Play</UI> on the transport (or <Kbd>Q</Kbd>). The mass falls, lands, and
                  settles. Press <UI>Reset</UI> (<Kbd>R</Kbd>) and it returns to exactly where you
                  drew it — the simulation never edits your scene.
                </>,
                <>
                  Select the mass and open <UI>Properties</UI>. Change <C>Elasticity</C> to{' '}
                  <C>0.9</C> and press Play again. Now it bounces. You can change it while it is
                  running.
                </>,
                <>
                  Draw a circle with the <UI>Pen</UI> anywhere on the page, select it, and in
                  Properties choose <UI>Add behavior → Rigid Body</UI>. Press Play. Your doodle falls
                  too — that is the whole model in one gesture.
                </>,
              ]}
            />
            <FigureRow
              items={[
                { name: 'sim-before', alt: 'Two masses and a block suspended above a ground plane before the simulation starts.', label: 'Edit' },
                { name: 'sim-during', alt: 'The same masses part-way through their fall, still in mid-air above the ground.', label: 'Playing' },
                { name: 'sim-after', alt: 'The masses and block at rest on the ground plane after the run.', label: 'At rest' },
              ]}
              caption="One run, three moments. Nothing was positioned by hand after the first frame — the bodies were dropped from the palette, and gravity, collision and friction did the rest. Reset puts them back exactly where you drew them."
            />
          </>
        ),
      },
      {
        id: 'signing-in',
        title: 'Signing in and your workspace',
        keywords: 'login account sign in institution tenant role offline demo',
        body: (
          <>
            <P>
              There is no public sign-up. Your institution issues your account, and signing in at{' '}
              <C>/login</C> drops you into <C>/notebook</C> — your personal workspace inside that
              institution. The landing page redirects you there automatically if you are already
              signed in.
            </P>
            <P>
              Your notebooks are yours. Things other people give you — shared pages, assignments,
              library assets — always arrive as copies, so nothing you receive can change under you
              and nothing you edit can damage the original.
            </P>
            <P>
              Your work is stored on the device first, so the notebook keeps working on a flaky
              network or none at all. Cloud sync is something you switch on per page rather than a
              blanket upload — see <UI>Data, storage and sync</UI>.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'workspace',
    title: 'The workspace',
    icon: LayoutDashboard,
    blurb: 'Every piece of chrome around the canvas, and what each one is for.',
    articles: [
      {
        id: 'layout',
        title: 'Layout at a glance',
        keywords: 'shell interface chrome header sidebar canvas dock status bar tour',
        body: (
          <>
            <P>The desktop workspace has five fixed pieces:</P>
            <Defs
              items={[
                [
                  'Header',
                  <>
                    Global search, undo/redo, the open-page tab strip, per-page controls, sync
                    status, notifications and your account menu.
                  </>,
                ],
                [
                  'Left rail',
                  <>
                    A column of icons — Notebook, Assistant, Components, Tools, Uploads, Library,
                    Properties and (when the page has one) Contents. Clicking one opens its panel;
                    clicking it again collapses the panel back to the rail.
                  </>,
                ],
                [
                  'Canvas',
                  <>
                    The page itself. Infinite and pannable on a board; a fixed stack of sheets on a
                    document; a scrolling reader on a PDF.
                  </>,
                ],
                [
                  'Dock',
                  <>
                    The floating tool bar — Select, Pen, Shaper, Eraser, Text, Note, Formula, Graph,
                    Grid Table, shapes and colour. It can be pinned to any edge or dragged loose.
                  </>,
                ],
                [
                  'Transport',
                  <>
                    Play, Pause, Step and Reset, plus the simulation clock. It is the only control
                    that starts or stops physics.
                  </>,
                ],
              ]}
            />
            <P>
              On a phone this becomes a navigation app instead: Home → notebook → editor, with a
              bottom tab bar and properties as a sheet. See <UI>Touch, tablet and mobile</UI>.
            </P>
          </>
        ),
      },
      {
        id: 'tabs',
        title: 'Tabs and split view',
        keywords: 'tabs open pages split screen panes side by side multitask',
        body: (
          <>
            <P>
              Every page you open becomes a tab in the header strip, browser-style. Click a tab to
              focus it, <UI>×</UI> to close it. The strip scrolls horizontally when it fills up.
            </P>
            <P>
              The split icon on a tab adds it as a second pane beside the current one — up to four
              panes at once, each resizable by dragging the seam between them. A PDF on the left and
              a board on the right is the common case: read the problem, build the answer.
            </P>
            <Callout title="Which page do the tools act on?">
              <p>
                Whichever pane you last clicked into. The dock, transport and undo history follow
                that focused pane, so drawing after clicking a PDF annotates the PDF, not the board
                next to it.
              </p>
            </Callout>
          </>
        ),
      },
      {
        id: 'canvas-nav',
        title: 'Moving around the canvas',
        keywords: 'pan zoom scroll navigate viewport fit reset zoom minimap gestures',
        body: (
          <>
            <Bullets
              items={[
                <>
                  <UI>Pan</UI> — hold <Kbd>Space</Kbd> and drag, drag with two fingers, or scroll.
                </>,
                <>
                  <UI>Zoom</UI> — <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd> + scroll wheel, pinch on a
                  touchscreen, or the zoom controls in the header.
                </>,
                <>
                  <UI>Fit the page</UI> — <Kbd>Ctrl</Kbd>+<Kbd>9</Kbd>. <UI>Back to 100%</UI> —{' '}
                  <Kbd>Ctrl</Kbd>+<Kbd>0</Kbd>.
                </>,
                <>
                  <UI>Measure</UI> — hold <Kbd>Alt</Kbd> and drag between two points for a live
                  distance readout.
                </>,
                <>
                  <UI>Mini-map</UI> — appears once a page has enough objects to get lost in. Object
                  positions show as dots, your viewport as a rectangle; click to jump.
                </>,
              ]}
            />
            <P>
              Scroll direction, grid style and grid size are all preferences —{' '}
              <UI>Settings → Editor</UI>. Pinch sensitivity, hold-before-drag and palm rejection are
              under <UI>Settings → Gestures</UI>.
            </P>
          </>
        ),
      },
      {
        id: 'transport-ctl',
        title: 'The transport',
        keywords: 'play pause step reset simulation clock run time frame',
        body: (
          <>
            <Defs
              items={[
                ['Play / Pause', <>Starts or freezes the simulation. <Kbd>Q</Kbd>.</>],
                [
                  'Step forward / back',
                  <>
                    While paused, advances or rewinds one frame — <Kbd>E</Kbd> and <Kbd>W</Kbd>. The
                    way to catch the exact instant of a collision.
                  </>,
                ],
                [
                  'Reset',
                  <>
                    <Kbd>R</Kbd>. Throws away the running world and restores the scene exactly as
                    drawn. Editing while paused or running is safe: Reset always returns to your
                    edited scene, never to an earlier snapshot of it.
                  </>,
                ],
                ['Clock', <>Elapsed simulated time, which is not the same as wall-clock time.</>],
              ]}
            />
            <Figure
              name="transport"
              alt="The transport controls: Play, step back, step forward, reset, and pin this run."
              caption="The transport, in the header: Play, step back, step forward, Reset, and pin-this-run for comparing two attempts."
            />
            <Callout tone="tip" title="Edit while it runs">
              <p>
                Parameters are re-read every frame. Change gravity, a spring constant or a resistor
                mid-run and the experiment bends immediately — no stop, edit, restart cycle.
              </p>
            </Callout>
          </>
        ),
      },
      {
        id: 'search',
        title: 'Search and the command palette',
        keywords: 'search command palette ctrl k quick find jump component insert',
        body: (
          <>
            <P>
              <Kbd>Ctrl</Kbd>/<Kbd>⌘</Kbd>+<Kbd>K</Kbd> opens one search box over everything: your
              pages, your notebooks, library assets, and the entire component palette. Picking a page
              opens it; picking a component drops it straight onto the page you are on.
            </P>
            <P>
              On the canvas, typing <Kbd>/</Kbd> opens the same registry as a quick-insert menu at
              the cursor — the fastest way to place a resistor without leaving the keyboard.
            </P>
          </>
        ),
      },
      {
        id: 'zen',
        title: 'Zen mode and panel control',
        keywords: 'zen focus hide panels distraction free fullscreen toggle sidebar inspector',
        body: (
          <>
            <Bullets
              items={[
                <>
                  <Kbd>Ctrl</Kbd>+<Kbd>.</Kbd> hides every panel — canvas only.
                </>,
                <>
                  <Kbd>Ctrl</Kbd>+<Kbd>[</Kbd> toggles the left panel, <Kbd>Ctrl</Kbd>+<Kbd>]</Kbd>{' '}
                  toggles Properties.
                </>,
                <>
                  The dock itself can auto-hide, move to any edge, become a full-width bar or a
                  circular dial — <UI>Settings → Dock</UI>.
                </>,
              ]}
            />
          </>
        ),
      },
    ],
  },
  {
    id: 'pages',
    title: 'Notebooks, pages and files',
    icon: Files,
    blurb: 'The tree, the six kinds of page, and how files become pages.',
    articles: [
      {
        id: 'tree',
        title: 'The notebook tree',
        keywords: 'notebook folder section page tree organise organize rename move delete file',
        body: (
          <>
            <P>
              The <UI>Notebook</UI> panel is a filesystem, not a fixed two-level hierarchy. A
              top-level folder is a <UI>notebook</UI> (it gets a cover and an emoji); below that,
              folders nest as deep as you like and hold pages, more folders, or raw uploaded files.
            </P>
            <Bullets
              items={[
                <>Drag to reorder or reparent anything.</>,
                <>Right-click a node for rename, duplicate, colour, export, share and delete.</>,
                <>
                  Collapsed folders stay collapsed between sessions, and the panel remembers where
                  you were.
                </>,
                <>
                  Right-click a page for <UI>Export JSON</UI> (a per-page backup you can keep) and
                  for its <UI>cloud sync</UI> toggle — see <UI>Sync and multiple devices</UI>.
                </>,
                <>
                  <UI>Delete is immediate and permanent.</UI> There is no trash to restore from, so
                  export or back up anything you might want again.
                </>,
              ]}
            />
            <P>
              The same panel switches between three views with the filter row at the top:{' '}
              <UI>Notebooks</UI> (your own), <UI>Shared</UI> (copies people sent you) and{' '}
              <UI>Assignments</UI>. Only one is on screen at a time, so the tree gets the full panel
              height.
            </P>
          </>
        ),
      },
      {
        id: 'page-kinds',
        title: 'The kinds of page',
        keywords: 'board whiteboard document doc pdf image spreadsheet xlsx presentation pptx web page kind',
        body: (
          <>
            <P>
              Press <UI>+</UI> in the tree to add a page. The picker offers three top-level choices —{' '}
              <UI>Whiteboard</UI>, <UI>Document</UI> and <UI>Upload</UI> — and Document is the
              umbrella for every paper-shaped page.
            </P>
            <Figure
              name="add-page"
              alt="The Add a page dialog offering four tiles: Whiteboard, Document, Web Browser and Upload."
              caption="The page picker. Document covers the A4 doc, the presentation and the spreadsheet; Upload reads any file's extension and routes it to the matching kind for you."
            />
            <Defs
              items={[
                [
                  'Board',
                  <>
                    An infinite whiteboard. Pans and zooms without limit, holds every object type,
                    and is where simulations usually live.
                  </>,
                ],
                [
                  'Document',
                  <>
                    A scrolling stack of A4/Letter <UI>sheets</UI>. Each sheet is a full canvas
                    surface with the same tools, objects and physics as a board — it is paginated,
                    not restricted. Exports to PDF and .docx. Opening an uploaded .docx imports its
                    paragraphs onto these sheets.
                  </>,
                ],
                [
                  'Presentation',
                  <>
                    The same sheet engine laid out as a slide deck: a slide rail down the side, one
                    slide at a time, and a fullscreen <UI>Present</UI> mode. Imports .pptx (parsing
                    the real slide XML) and exports back to .pptx.
                  </>,
                ],
                [
                  'Spreadsheet',
                  <>
                    A real editable grid, not a screenshot. Imports .xlsx/.xls/.csv on first open and
                    re-exports on demand.
                  </>,
                ],
                [
                  'PDF',
                  <>
                    A reader for any uploaded document — PPT and DOCX are converted to PDF in the
                    browser. Scroll the pages and mark them up with the real pen, with a linked notes
                    pane beside them.
                  </>,
                ],
                [
                  'Image',
                  <>
                    View and annotate an uploaded PNG/JPEG/WebP/GIF/SVG. Ink lives on a transparent
                    overlay; the image itself is never altered.
                  </>,
                ],
                [
                  'Web',
                  <>
                    A browser page you can cache for offline reading and draw on top of. The
                    annotations are stored with your document, not with the website.
                  </>,
                ],
              ]}
            />
            <Callout title="Upload routes itself">
              <p>
                You never have to pick the right kind for a file. <UI>Upload</UI> reads the
                extension and creates the matching page — .pptx becomes a presentation, .xlsx a
                spreadsheet, .docx a document, a PDF a reader, an image an image page. The same
                resolver runs when you double-click a file already sitting in the tree.
              </p>
            </Callout>
          </>
        ),
      },
      {
        id: 'sheets',
        title: 'Working with sheets and slides',
        keywords: 'sheet page sorter reorder thumbnail slide add remove resize export pdf docx',
        body: (
          <>
            <Bullets
              items={[
                <>
                  A document’s sheets appear in a filmstrip at the bottom (the <UI>page sorter</UI>).
                  Drag a thumbnail to reorder, tap to jump.
                </>,
                <>
                  Sheets can be resized individually, and each can carry its own background colour.
                </>,
                <>
                  A sheet does not pan or zoom internally — it is a fixed piece of paper. Zoom the
                  whole document instead.
                </>,
                <>
                  <UI>Export PDF</UI> and <UI>Export .docx</UI> sit in the per-page controls at the
                  right of the tab strip; a presentation gets its own control bar under the slide
                  rail.
                </>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'uploads-files',
        title: 'Files and uploads',
        keywords: 'upload file attach drag drop opfs storage picture asset library reuse',
        body: (
          <>
            <P>
              Drag a file onto the canvas, or use the <UI>Uploads</UI> panel. Every uploaded file is
              stored once and referenced everywhere it appears, so inserting the same diagram on ten
              pages costs one copy of the bytes.
            </P>
            <P>
              A file in the tree has no renderer of its own — opening it creates a companion page of
              the right kind and links the two, so opening it again reuses that page instead of
              re-importing.
            </P>
            <P>
              PDFs placed <em>on</em> a board render inline through pdf.js and stay crisp at any
              zoom. Files with a real editor of their own (pptx, docx, xlsx) are attached as proper
              pages and previewed through that editor.
            </P>
          </>
        ),
      },
      {
        id: 'page-actions',
        title: 'Sharing, assigning and presenting a page',
        keywords: 'share copy assignment present board room clone frozen distribute',
        body: (
          <>
            <P>
              The page menu offers three outward actions, and all three ship a <UI>frozen copy</UI> —
              the original page is never exposed and never edited by anyone else:
            </P>
            <Defs
              items={[
                ['Share a copy', <>Send the page to a person or a room. They get their own editable duplicate.</>],
                [
                  'Create an assignment',
                  <>
                    Turn the page into work. Every student receives a personal working copy and
                    submits from their own notebook.
                  </>,
                ],
                [
                  'Present on a board',
                  <>
                    Push the page to a paired classroom display. The board loads a temporary copy you
                    can annotate, simulate and rewind live.
                  </>,
                ],
              ]}
            />
          </>
        ),
      },
    ],
  },
  {
    id: 'panels',
    title: 'Panels reference',
    icon: Shapes,
    blurb: 'Every panel in the left rail, plus the floating surfaces around the canvas.',
    articles: [
      {
        id: 'rail',
        title: 'The eight rail sections',
        keywords: 'sidebar panel rail notebook assistant components tools uploads library properties contents',
        body: (
          <>
            <Defs
              items={[
                [
                  'Notebook',
                  <>
                    Your file tree, plus the Shared and Assignments views. The default landing
                    section.
                  </>,
                ],
                [
                  'Assistant',
                  <>
                    The AI conversation. Describe a scene, read the script it produced, add it to the
                    canvas. See <UI>The AI assistant</UI>.
                  </>,
                ],
                [
                  'Components',
                  <>
                    The palette, grouped by subject package with a domain tab strip and a search box.
                    Click a component, then click the canvas to place it; it stays armed for repeats.
                  </>,
                ],
                [
                  'Tools',
                  <>
                    The utilities that do not earn permanent dock space: the calculator toggle,
                    interactive controls (Slider, Button, Trigger) and quick-insert objects (Formula
                    Table, Graph, 3D Graph, Chart, Code, Measurement).
                  </>,
                ],
                [
                  'Uploads',
                  <>
                    Every picture and file in your workspace as one asset library. Clicking one
                    inserts a reference into the open page.
                  </>,
                ],
                [
                  'Library',
                  <>
                    The institution library — searchable, categorised, favouritable assets published
                    by teachers and admins. Insertion always clones. Students browse read-only.
                  </>,
                ],
                [
                  'Properties',
                  <>
                    The inspector for whatever is selected: geometry, style, parameters and the
                    behavior list. This is where you attach behaviors and where every expression
                    field lives.
                  </>,
                ],
                [
                  'Contents',
                  <>
                    An outline of the current page — a PDF’s embedded bookmarks, a deck’s slide
                    headings. Only appears when the open page actually publishes one.
                  </>,
                ],
              ]}
            />
            <div className="my-5 grid gap-4 sm:grid-cols-3">
              <Figure name="panel-notebook" alt="The Notebook panel showing the folder tree with a notebook, a section and a page." caption="Notebook — the tree, plus Shared and Assignments." />
              <Figure name="panel-tools" alt="The Tools panel with the calculator toggle, interactive controls and quick-insert objects." caption="Tools — calculator, controls, quick insert." />
              <Figure name="panel-uploads" alt="The Uploads panel listing the files and pictures in the workspace." caption="Uploads — every file, reusable anywhere." />
            </div>
          </>
        ),
      },
      {
        id: 'inspector',
        title: 'Properties (the inspector)',
        keywords: 'inspector properties panel parameters attach behavior style expression edit selection',
        body: (
          <>
            <P>
              Select an object and Properties shows everything about it: name, position, size,
              rotation, colours and stroke, its parameters, and the behaviors attached to it.
            </P>
            <Bullets
              items={[
                <>
                  <UI>Add behavior</UI> lists only the behaviors that make sense for that geometry,
                  each with a one-line description of what it does.
                </>,
                <>
                  Every numeric field is an <UI>expression field</UI>. Type <C>9.81</C>, or{' '}
                  <C>g</C>, or <C>2*pi*f</C>, or a reference to another object’s live channel.
                </>,
                <>
                  Multi-selection edits shared fields at once. Selection actions (align, distribute,
                  group, order) sit at the top.
                </>,
                <>
                  On a phone or tablet, opening properties lifts the selected object out of the
                  canvas and floats it above the dimmed page, still live, so you can see what your
                  edit did. Tap the dimmed area to send it back.
                </>,
              ]}
            />
            <Figure
              name="panel-properties"
              alt="The Properties panel for a selected object, showing its geometry and style fields and the behaviors attached to it."
              tall
              caption="Properties for the selected object. The behavior list is where a drawing becomes a physical object."
            />
          </>
        ),
      },
      {
        id: 'notes-gallery',
        title: 'Note gallery',
        keywords: 'notes gallery sticky scrapbook todo calendar personal drawer ctrl n',
        body: (
          <>
            <P>
              <Kbd>Ctrl</Kbd>+<Kbd>N</Kbd> opens a drawer from the right edge: a masonry wall of
              sticky notes and pasted images, a to-do list, and a month calendar of personal events.
            </P>
            <P>
              It is deliberately not a rail section. Every rail panel is about the page you have
              open; this one belongs to <em>you</em> and follows you across every page and notebook.
            </P>
          </>
        ),
      },
      {
        id: 'calculator',
        title: 'Calculator',
        keywords: 'calculator scratch arithmetic mathjs floating drag resize ctrl 1',
        body: (
          <>
            <P>
              <Kbd>Ctrl</Kbd>+<Kbd>1</Kbd>, or the toggle in the Tools panel. It floats over the
              canvas, drags anywhere, resizes from its corner and stays put when you switch pages.
            </P>
            <P>
              It runs the same maths engine the formula fields use, so <C>sqrt(2)</C>,{' '}
              <C>sin(pi/4)</C>, <C>3^4</C> and <C>log(100, 10)</C> all work. Page variables are
              deliberately <em>not</em> in scope — this is scratch arithmetic, not part of the
              document.
            </P>
          </>
        ),
      },
      {
        id: 'event-log',
        title: 'Simulation event log',
        keywords: 'event log accessibility screen reader collision events announce aria',
        body: (
          <>
            <P>
              Physics events — a collision, a body coming to rest — are announced to screen readers
              live, and kept in a scrollable log you can read back after a run. The log is collapsed
              by default; the announcements need no setup.
            </P>
          </>
        ),
      },
      {
        id: 'notifications',
        title: 'Notifications and sync status',
        keywords: 'notifications bell shares assignments announcements sync cloud devices status',
        body: (
          <>
            <P>
              The bell in the header aggregates shares you have received, assignment activity (new
              work if you are a student, new submissions if you are a teacher) and room
              announcements. Read state is tracked per user, per device.
            </P>
            <P>
              Beside it, the sync indicator shows whether your work has reached the cloud, and opens
              a popover for device-to-device sync. See <UI>Data, storage and sync</UI>.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'tools',
    title: 'Drawing and tools',
    icon: PenTool,
    blurb: 'The dock, the pen, the shape menu, and every object you can place.',
    articles: [
      {
        id: 'dock-tools',
        title: 'The dock tools',
        keywords: 'toolbar dock select pen shaper eraser text note formula graph grid table tools',
        body: (
          <>
            <Defs
              items={[
                ['Select · V', <>Click to select, drag to move, drag a marquee to select many. Handles resize and rotate.</>],
                ['Pen · P', <>Freehand ink. Stays exactly as drawn unless Ink to Shape is on.</>],
                [
                  'Shaper · S',
                  <>
                    Draws with 90° elbows — the same as holding Shift with the pen. For wiring
                    diagrams and orthogonal connectors.
                  </>,
                ],
                ['Eraser · E', <>Drag over ink to remove it. Scribble-to-erase is a pen setting.</>],
                ['Text · T', <>A live formatted text block. Bold, italic, colour, size, lists, links.</>],
                ['Note · N', <>A sticky note — quick, coloured, resizable.</>],
                ['Formula · F', <>A maths card that renders and solves. See <UI>Formulas and variables</UI>.</>],
                ['Graph · G', <>A live plot of simulation channels and your own expressions.</>],
                ['Grid Table · B', <>A plain layout table with editable cells and draggable column splitters.</>],
              ]}
            />
            <P>
              The dock also carries the shape menu, the colour and stroke controls, and (optionally)
              the transport, a page selector and a Tools/Components launcher — all configurable in{' '}
              <UI>Settings → Dock</UI>.
            </P>
            <Figure
              name="dock"
              alt="The floating tool dock: Select, Pen, Shaper, Eraser, Text, Note, Formula, Graph, Grid Table, the shape menu and attachments."
              caption="The dock, left to right: Select, Pen, Shaper, Eraser, Text, Note, Formula, Graph, Grid Table, the shape menu and attachments. Select is active here."
            />
          </>
        ),
      },
      {
        id: 'shapes',
        title: 'The shape menu',
        keywords: 'shapes circle oval square rectangle triangle polygon star arrow diamond trapezoid line beam',
        body: (
          <>
            <P>
              Nineteen ready shapes, placed by click-dragging on the canvas: Line/Beam, Circle, Oval,
              Square, Rectangle, Triangle, Right Triangle, Diamond, Parallelogram, Trapezoid,
              Pentagon, Hexagon, Heptagon, Octagon, Star, and arrows in all four directions.
            </P>
            <P>
              A shape placed this way is bare geometry — exactly what the pen would have produced if
              your hand were perfect. Give it meaning by attaching a behavior.
            </P>
          </>
        ),
      },
      {
        id: 'pen',
        title: 'The pen, ink and stylus',
        keywords: 'pen stylus pressure tilt smoothing thickness colour palette palm rejection ink erase',
        body: (
          <>
            <P>
              Double-tap the pen button (or open <UI>Settings → Pen feel</UI>) for the full pen
              panel:
            </P>
            <Defs
              items={[
                ['Style', <>The nib character — how the stroke responds to speed and pressure.</>],
                ['Thickness', <>Base stroke width, and what a mouse or a flat stylus always draws at.</>],
                ['Stability & Smoothness', <>How much the stroke is filtered as you draw. Higher settles a shaky hand; lower keeps detail.</>],
                ['Sensitivity', <>How strongly stylus pressure changes the width.</>],
                ['Dot size', <>Multiplier for single-tap dots, like the dot on an i.</>],
                ['Colour', <>The swatch palette, plus your own custom colours which stay in the palette.</>],
                ['Scribble to erase', <>Scrub back and forth over a stroke to delete it, no tool switch.</>],
              ]}
            />
            <P>
              Ink drawn on a PDF, an image or a web page lives on a real transparent canvas locked to
              that page — same pen, same undo, same settings as a board. There is no second drawing
              system to learn.
            </P>
          </>
        ),
      },
      {
        id: 'ink-recognition',
        title: 'Ink to shape and ink annotations',
        keywords: 'recognition sketch recognize convert doodle shape zigzag spring annotate scribble parameter',
        body: (
          <>
            <P>
              With <UI>Ink to Shape</UI> on (<UI>Settings → Editor</UI>), a freehand stroke that is
              clearly a circle, oval, square, rectangle, a regular triangle-through-octagon, or a
              line snaps to that clean geometry.
            </P>
            <Callout title="Recognition only upgrades geometry">
              <p>
                It never decides what something <em>means</em>. Meaning still comes from the behavior
                you attach, so a wrong guess costs you nothing but a tidier shape. Irregular doodles
                stay as ink on purpose.
              </p>
            </Callout>
            <P>
              <UI>Ink Annotations</UI> is the companion setting: a small scribble next to a component
              opens the parameter input for it, so you can write a value where you would have written
              it on paper.
            </P>
          </>
        ),
      },
      {
        id: 'quick-insert',
        title: 'Quick insert and interactive controls',
        keywords: 'slider button trigger table chart 3d graph code measurement place arm insert slash menu',
        body: (
          <>
            <P>
              The <UI>Tools</UI> panel arms an object; you then click the canvas to place it.{' '}
              <Kbd>Esc</Kbd> stops. The same set is reachable from the <Kbd>/</Kbd> menu on the
              canvas and from global search.
            </P>
            <Defs
              items={[
                ['Formula Table', <>A spreadsheet-style table whose column headers can be formulas.</>],
                ['Graph', <>Live plotting of channels and expressions.</>],
                ['3D Graph', <>Surface plots — explicit <C>sin(x)*cos(y)</C> or implicit <C>x^2+y^2+z^2=25</C>.</>],
                ['Chart', <>Bar, line, area, scatter and pie over a small data grid.</>],
                ['Code', <>The SimScript IDE — build a scene by typing it.</>],
                ['Measurement', <>Click-drag across the canvas to leave a dimensioned measurement.</>],
                ['Slider', <>Drag a value and watch the scene respond. Binds to a page variable or any object parameter.</>],
                ['Button', <>Runs an action on click: set, toggle or step a value.</>],
                ['Trigger', <>Watches a value and fires an action when a condition is met.</>],
              ]}
            />
            <Callout tone="tip" title="Interactive controls make a page a demo">
              <p>
                A slider bound to spring stiffness plus a graph of the resulting oscillation turns a
                static diagram into something a student can actually poke at.
              </p>
            </Callout>
          </>
        ),
      },
      {
        id: 'edit-ops',
        title: 'Editing, undo and clipboard',
        keywords: 'undo redo copy paste cut duplicate delete select all group align history',
        body: (
          <>
            <Bullets
              items={[
                <>
                  Undo and redo are in the header as buttons as well as on <Kbd>Ctrl</Kbd>+
                  <Kbd>Z</Kbd> / <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd>, so a tablet without
                  a keyboard can still reach them.
                </>,
                <>
                  Copy, cut, paste and duplicate work across pages and across notebooks, carrying
                  behaviors and parameters with the object.
                </>,
                <>
                  Everything the AI does goes through the same history — an auto-applied script is as
                  undoable as anything you typed.
                </>,
              ]}
            />
          </>
        ),
      },
    ],
  },
  {
    id: 'objects',
    title: 'Object reference',
    icon: Boxes,
    blurb: 'What each kind of thing on a page does.',
    articles: [
      {
        id: 'text-objects',
        title: 'Text, notes and pictures',
        keywords: 'text note sticky picture image formatting bold italic colour font markdown',
        body: (
          <>
            <Defs
              items={[
                [
                  'Text',
                  <>
                    A formatted block that is WYSIWYG all the time — bold, italic, underline,
                    colour, size and lists are style ranges over the text, never markdown characters
                    you have to look at. The line with the caret renders exactly like every other
                    line.
                  </>,
                ],
                ['Note', <>A sticky note: coloured, resizable, deliberately small.</>],
                [
                  'Picture',
                  <>
                    A raster image placed as one object among others — drag, resize and select it
                    like any shape. Different from an <UI>image page</UI>, which is a whole tab for
                    viewing and annotating one image.
                  </>,
                ],
                [
                  'File',
                  <>
                    A document embedded in a board. PDFs render inline via pdf.js; pptx/docx/xlsx are
                    attached as their own page and previewed through that page’s real editor.
                  </>,
                ],
              ]}
            />
          </>
        ),
      },
      {
        id: 'math-objects',
        title: 'Formula, table and grid table',
        keywords: 'formula card calculus derivative integral laplace fourier table columns summary grid table',
        body: (
          <>
            <Defs
              items={[
                [
                  'Formula',
                  <>
                    Write <C>f(x) = x^2 + 3*x, 10&lt;x&lt;20</C> (bounds optional; several variables
                    give partials). Select it and the calculus actions — d/dx, ∂/∂x, ∫dx, Laplace,
                    Fourier — appear in Properties, and the worked step-by-step solution renders
                    inside the card.
                  </>,
                ],
                [
                  'Formula Table',
                  <>
                    Excel-style. Each column header is either a plain name (<C>x</C>) or a formula (
                    <C>z = x + y</C>), evaluated against the page scope in declaration order, so a
                    column can reference one to its left. The last row is a Sum/Avg/Min/Max summary.
                  </>,
                ],
                [
                  'Grid Table',
                  <>
                    A layout table: editable cells, add/remove rows and columns, draggable column
                    splitters. No maths, just structure.
                  </>,
                ],
              ]}
            />
          </>
        ),
      },
      {
        id: 'plot-objects',
        title: 'Graph, 3D graph and chart',
        keywords: 'graph plot series channel axis scale reference line phase portrait surface 3d chart bar pie',
        body: (
          <>
            <Defs
              items={[
                [
                  'Graph',
                  <>
                    Plots live simulation channels from one or many objects, and your own expressions
                    against the page scope, on the same axes. Custom axes, scales, reference lines
                    and phase portraits (plot one channel against another rather than against time).
                    With no series bound, it plots your formulas over the x range like a graphing
                    calculator.
                  </>,
                ],
                [
                  '3D Graph',
                  <>
                    The surface-plot counterpart. Two input styles on one field, auto-detected:
                    explicit <C>sin(x)*cos(y)</C> gives a height field, implicit{' '}
                    <C>x^2 + y^2 + z^2 = 25</C> is root-found and rendered as two caps. A graph can
                    also reinterpret its first three plotted panels as X/Y/Z for a 3D trajectory.
                  </>,
                ],
                [
                  'Chart',
                  <>
                    Bar, line, area, scatter and pie over a small labels-plus-series grid — the
                    spreadsheet-simple counterpart to Graph. Switching chart type keeps the same
                    data; “stacked” is a modifier on bar and area, not a separate chart family.
                  </>,
                ],
              ]}
            />
          </>
        ),
      },
      {
        id: 'analysis-objects',
        title: 'Truth table, cash flow and measurements',
        keywords: 'truth table logic cashflow npv irr marr payback economics measurement dimension',
        body: (
          <>
            <Defs
              items={[
                [
                  'Truth Table',
                  <>
                    Pick which of the circuit’s inputs and outputs to tabulate. Every input
                    combination is then actually <em>simulated</em> on the real board — no symbolic
                    shortcut — and the results laid out as a table.
                  </>,
                ],
                [
                  'Cash Flow',
                  <>
                    An engineering-economics timeline: arrows up for inflow, down for outflow, height
                    proportional to amount. The spec (investments, annuities, salvage, MARR) is
                    edited in Properties, and PW/FW/AW/IRR/CR/BC sit above the diagram. Hover the
                    timeline for the compounded value at that instant.
                  </>,
                ],
                [
                  'Measurement',
                  <>
                    A persistent dimensioned line between two points on the page, for annotating a
                    drawing with real distances.
                  </>,
                ],
              ]}
            />
          </>
        ),
      },
      {
        id: 'system-object',
        title: 'Systems (grouping frames)',
        keywords: 'system frame group region domain container organise',
        body: (
          <>
            <P>
              Each domain has a <UI>System</UI> component: a labelled frame that sits behind its
              contents and groups them into one named subsystem. Use it to say “this rectangle of the
              page is the power stage” without changing how anything inside behaves.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'components',
    title: 'Component packages',
    icon: Package,
    blurb: 'Every subject package and the parts it ships, straight from the palette registry.',
    articles: [
      {
        id: 'palette-how',
        title: 'Using the palette',
        keywords: 'palette components place arm search domain tab package enable disable',
        body: (
          <>
            <Steps
              items={[
                <>Open <UI>Components</UI> in the left rail.</>,
                <>Pick a domain tab, or type in the search box to search every domain at once.</>,
                <>Click a component — it arms.</>,
                <>Click the canvas to place it. It stays armed, so you can place a row of resistors without going back to the panel.</>,
                <><Kbd>Esc</Kbd> disarms and returns you to Select.</>,
              ]}
            />
            <Figure
              name="panel-components"
              alt="The Components panel showing the Mechanics package — System, Mass, Block, Beam, Wheel, Reference Point, Ground, Spring, Rope, Rod, Damper, Hinge, Motor, Charged Ball, field regions and Heat Source — with the Electrical package beginning below."
              tall
              caption="The palette, grouped by package with a live count per subject. Every icon is the glyph the canvas actually draws, so what you pick is what you get."
            />
            <P>
              Packages can be switched off in <UI>Settings → Packages</UI> if a subject is noise for
              you, and an institution can license a subset — a component you do not have access to
              simply is not in the palette.
            </P>
          </>
        ),
      },
      {
        id: 'package-list',
        title: 'The packages and their components',
        keywords: 'mechanics electrical electronics digital optics waves quantum economics dsa resistor capacitor gate transistor lens list inventory',
        body: (
          <>
            <P>
              This inventory is generated from the same registry the palette reads, so it is always
              the current one.
            </P>
            <ComponentInventory />
          </>
        ),
      },
    ],
  },
  {
    id: 'behaviors',
    title: 'Behavior reference',
    icon: Atom,
    blurb: 'The full list of behaviors you can attach, what each one means, and its parameters.',
    articles: [
      {
        id: 'attaching',
        title: 'Attaching a behavior',
        keywords: 'attach behavior add convert physics object properties geometry compatible',
        body: (
          <>
            <Steps
              items={[
                <>Select the object.</>,
                <>Open <UI>Properties</UI> in the left rail.</>,
                <>Press <UI>Add behavior</UI> and pick from the list — only behaviors valid for that geometry are offered.</>,
                <>Fill in its parameters. Every one accepts an expression, not just a number.</>,
              ]}
            />
            <P>
              An object can carry several behaviors at once. A motorised wheel is a circle with both
              a Rigid Body and a Motor; a charged ball is a Rigid Body plus a Charge. Remove a
              behavior and the object reverts to being a drawing — nothing else about it changes.
            </P>
            <Callout tone="warn" title="Constraints come from where things are">
              <p>
                A spring whose endpoint touches a mass attaches to that mass. A hinge pins whatever
                bodies it overlaps. If it finds nothing, it anchors to the world. Drawing the system
                <em> is</em> wiring the system — so if a constraint is not doing what you expect,
                check what it is actually touching.
              </p>
            </Callout>
          </>
        ),
      },
      {
        id: 'behavior-list',
        title: 'Every behavior',
        keywords: 'rigid body static spring rope rod damper hinge motor force wire node charge field sensor lens slit wave quantum well tunnel barrier list',
        body: (
          <>
            <P>
              Generated from the behavior registry — the same table the Add Behavior menu, the world
              builder and the AI importer read. A few are registered but await their solver; those
              are marked.
            </P>
            <BehaviorInventory />
          </>
        ),
      },
    ],
  },
  {
    id: 'simulation',
    title: 'Simulation',
    icon: Play,
    blurb: 'How Play works, what each engine solves, and how to measure what happens.',
    articles: [
      {
        id: 'play-model',
        title: 'How Play works',
        keywords: 'play edit mode simulate world build reset frame rate step physics loop',
        body: (
          <>
            <P>
              Pressing Play compiles the page exactly as drawn into one running world. Nothing is
              regenerated from a template, and nothing about your scene is modified — Reset simply
              discards the running world.
            </P>
            <Bullets
              items={[
                <>Rigid-body physics steps at a fixed 120 Hz, independent of your display rate.</>,
                <>Circuits are solved every step alongside it.</>,
                <>Parameters that are expressions are re-evaluated every frame against the page scope.</>,
                <>Graphs sample at a lower rate on purpose — plotting at 120 Hz would cost more than it shows.</>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'mechanics',
        title: 'Mechanics',
        keywords: 'physics rigid body collision gravity friction elasticity spring damper hinge motor rope rod constraint',
        body: (
          <>
            <P>
              Bodies have mass, friction and elasticity, collide (including against concave meshes
              built from your own sketches), and can be stacked, linked and driven. Springs, ropes,
              rods, dampers, hinges and motors connect them.
            </P>
            <P>
              Gravity <C>g</C> is a page variable like any other. Set it to <C>1.62</C> and your
              experiment is on the Moon; sweep it with a slider and watch the period of a pendulum
              change while it swings.
            </P>
            <P>
              A Rigid Body also carries three tracers you can switch on in Properties:{' '}
              <UI>motion vectors</UI>, <UI>path trail</UI> and <UI>force arrows</UI>. A{' '}
              <UI>Reference Point</UI> is a near-massless body with the trail already on — an
              observer you can pin to something to see where it goes.
            </P>
          </>
        ),
      },
      {
        id: 'circuits',
        title: 'Circuits and electronics',
        keywords: 'circuit kirchhoff mna nodal analysis resistor capacitor inductor diode transistor opamp current flow wire net solve',
        body: (
          <>
            <P>
              Symbol terminals and drawn wires are resolved into nets, then each step runs Modified
              Nodal Analysis — real KCL/KVL and Ohm’s law, with companion models for capacitors and
              inductors, iterated piecewise states for diodes, LEDs, BJTs and MOSFETs, and the op-amp
              as a constrained source.
            </P>
            <Bullets
              items={[
                <>
                  Wires bond at their endpoints within a snap radius. Two components merely{' '}
                  <em>overlapping</em> do not conduct.
                </>,
                <>
                  Ink counts: a pen stroke that touches two terminals is a wire, and current animates
                  along it.
                </>,
                <>
                  Current is drawn twice — conventional flow one way, electron drift the other — and
                  the animation speed tracks the actual amps.
                </>,
                <>
                  Meters are components: Voltmeter, Ammeter, Wattmeter and Probe read the live
                  solution.
                </>,
              ]}
            />
            <Figure
              name="circuit-parts"
              alt="A battery, a resistor and a bulb placed on the canvas as schematic symbols, each with visible terminals."
              caption="Circuit parts are ordinary scene objects drawn as proper schematic symbols. Join their terminals — with the Shaper, the Pen, or plain ink — and the solver treats what you drew as the netlist."
            />
          </>
        ),
      },
      {
        id: 'digital',
        title: 'Digital logic',
        keywords: 'logic gates flip flop latch mux decoder counter register seven segment clock probe truth table',
        body: (
          <>
            <P>
              Gates, flip-flops, latches, multiplexers, decoders, adders, comparators, counters,
              shift registers and 7-segment displays are solved as a fixpoint pass every step,
              alongside the analog solver.
            </P>
            <Bullets
              items={[
                <>Every pin shows its live 0 or 1.</>,
                <>Inputs are clickable while the simulation runs — toggle one and watch it propagate.</>,
                <>The Clock component drives sequential logic at a frequency you set.</>,
                <>
                  Drop a <UI>Truth Table</UI> on the page, pick the inputs and outputs, and it
                  simulates every combination for real.
                </>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'optics-waves-quantum',
        title: 'Optics, waves and quantum',
        keywords: 'optics lens mirror screen slit diffraction interference huygens fresnel double slit photon born rule quantum well tunnelling barrier wave',
        body: (
          <>
            <Defs
              items={[
                [
                  'Geometric optics',
                  <>Light sources, thin lenses, mirrors and screens — rays traced through the layout you drew.</>,
                ],
                [
                  'Diffraction and interference',
                  <>
                    A source, a slit mask and a screen produce a Huygens–Fresnel phasor sum over the
                    open apertures at real dimensions. The single-slit envelope and the cos² fringes
                    come out of the wave equation, not out of a picture of one. Change wavelength,
                    gap or spacing and the pattern responds as theory says it should.
                  </>,
                ],
                [
                  'Photons',
                  <>
                    In Play, single photons land stochastically at Born-rule positions, so you watch
                    randomness accumulate into the interference pattern.
                  </>,
                ],
                [
                  'Waves and EM',
                  <>Plane-wave sources, boundaries, media interfaces and transmission lines.</>,
                ],
                [
                  'Quantum',
                  <>
                    Particle-in-a-box eigenstates and rectangular tunnelling barriers, solved from
                    the Schrödinger picture with live parameters.
                  </>,
                ],
              ]}
            />
          </>
        ),
      },
      {
        id: 'probes',
        title: 'Probes, channels and binding',
        keywords: 'probe channel bind drag arrow series graph measure value source object variable',
        body: (
          <>
            <P>
              Objects publish <UI>channels</UI> — a mass streams <C>x</C>, <C>y</C>, <C>vx</C>,{' '}
              <C>vy</C>, angle, angular velocity and kinetic energy; a resistor streams <C>V</C>,{' '}
              <C>I</C>, <C>P</C>; a logic probe streams its level. Each object only offers the
              channels it can genuinely produce.
            </P>
            <Steps
              items={[
                <>Find the probe dot in the header of anything that consumes values — a graph, a variable, a slider.</>,
                <>Press it and drag. A dotted arrow follows your pointer.</>,
                <>Release over the object you want to read. A chip at the arrowhead lets you pick which channel.</>,
              ]}
            />
            <P>
              What gets written is an ordinary parameter, so the same binding is visible and editable
              in Properties as text: <C>[Mass 1(vy)]</C>. You do not have to press Play first —
              channels are known before the simulation has ever run.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'formulas',
    title: 'Formulas and variables',
    icon: Sigma,
    blurb: 'Every field is an expression. This is the language they all speak.',
    articles: [
      {
        id: 'expressions',
        title: 'Expression fields',
        keywords: 'expression field formula math input numeric evaluate mathjs functions syntax',
        body: (
          <>
            <P>
              Anywhere the app asks for a number, it will also take an expression: a mass, a spring
              constant, a resistance, a motor speed, a force field, a graph axis, a table column.
            </P>
            <Bullets
              items={[
                <>Arithmetic and powers: <C>2*pi*r</C>, <C>3^4</C>, <C>(a+b)/2</C>.</>,
                <>Functions: <C>sin</C>, <C>cos</C>, <C>tan</C>, <C>sqrt</C>, <C>log</C>, <C>exp</C>, <C>abs</C>, <C>min</C>, <C>max</C> and the rest of the standard library.</>,
                <>Page variables by name: <C>g</C>, <C>k</C>, <C>m</C>.</>,
                <>Live channels of other objects: <C>[Mass 1(vy)]</C>.</>,
              ]}
            />
            <P>
              Autocomplete in an expression field offers the variables and channels actually
              available on that page, so you can discover a binding from the field you are editing
              rather than having to go and build a variable first.
            </P>
          </>
        ),
      },
      {
        id: 'variables',
        title: 'Page variables',
        keywords: 'variable scope page define dependency order cycle spreadsheet semantics sweep',
        body: (
          <>
            <P>
              A page has its own set of named variables, with spreadsheet semantics: definition order
              does not matter. Dependencies are worked out from the expressions themselves and solved
              in the right order, so you can define <C>ω = sqrt(k/m)</C> above the line that defines{' '}
              <C>k</C>.
            </P>
            <P>
              A circular definition becomes an inline error on the offending variable — it never
              throws and never stops the page.
            </P>
            <Callout tone="tip" title="This is what makes a page an experiment">
              <p>
                Define <C>k</C> once, use it in the spring, plot <C>sqrt(k/m)</C> on a graph, bind{' '}
                <C>k</C> to a slider — then drag the slider mid-simulation and every one of those
                reacts together.
              </p>
            </Callout>
          </>
        ),
      },
      {
        id: 'formula-card',
        title: 'The formula card and calculus',
        keywords: 'formula card derivative integral partial laplace fourier steps solution latex katex bounds',
        body: (
          <>
            <P>
              Write <C>f(x) = x^2 + 3*x</C> in a Formula object and it renders as typeset maths.
              Add bounds — <C>, 10&lt;x&lt;20</C> — to restrict it. Several variables give partial
              derivatives.
            </P>
            <P>
              Select the card and Properties gains the calculus actions: <UI>d/dx</UI>,{' '}
              <UI>∂/∂x</UI>, <UI>∫dx</UI>, <UI>Laplace</UI> and <UI>Fourier</UI>. The result appears
              as a worked, step-by-step solution inside the card, not just a final answer.
            </P>
          </>
        ),
      },
      {
        id: 'number-format',
        title: 'Units, notation and precision',
        keywords: 'units notation scientific engineering precision decimal angle degrees radians thousands separator format',
        body: (
          <>
            <P>
              <UI>Settings → Math</UI> controls how every number in the app is displayed, with a live
              preview at the top of the tab:
            </P>
            <Defs
              items={[
                ['Decimal precision', <>0–8 digits after the point.</>],
                [
                  'Number notation',
                  <>
                    <UI>Auto</UI> switches to exponents for very large or small values,{' '}
                    <UI>Plain</UI> never does, <UI>Scientific</UI> always does, and{' '}
                    <UI>Engineering</UI> locks exponents to powers of three.
                  </>,
                ],
                [
                  'Angle units',
                  <>Degrees or radians for display. The solver always works in radians internally.</>,
                ],
                ['Unit labels', <>Append cm, N, m/s and friends to readouts.</>],
                ['Thousands separator', <>Digit grouping, 1,234.5.</>],
              ]}
            />
          </>
        ),
      },
    ],
  },
  {
    id: 'ai',
    title: 'The AI assistant',
    icon: BrainCircuit,
    blurb: 'Describe a scene, read what it wrote, decide whether it lands on your canvas.',
    articles: [
      {
        id: 'ai-what',
        title: 'What the assistant does',
        keywords: 'ai assistant generate scene describe prompt simscript build page local model private',
        body: (
          <>
            <P>
              Open <UI>Assistant</UI> in the left rail and describe what you want — “a projectile
              hitting a spring on an incline”, “a half-wave rectifier with a smoothing capacitor”,
              “plot the velocity of the falling mass”.
            </P>
            <P>
              The assistant replies with a <UI>SimScript</UI> — the same scene-building script you
              could have typed in the Code object yourself. It produces exactly the primitives and
              behaviors a person places by hand; there is nothing it can build that you cannot.
            </P>
            <P>
              It is a real conversation. Every turn keeps its script, so you can compare two
              attempts, re-run an earlier one, or copy a script into the Code IDE and edit it.
            </P>
            <Figure
              name="panel-assistant"
              alt="The Assistant panel docked in the left rail, with its prompt box and conversation area."
              tall
              caption="The assistant sits in the rail beside Notebook and Components rather than in a floating bubble — describing a scene is a normal way to work here."
            />
          </>
        ),
      },
      {
        id: 'ai-modes',
        title: 'Manual and Auto',
        keywords: 'manual auto mode apply add to canvas verify verifier lint undo safety',
        body: (
          <>
            <Defs
              items={[
                [
                  'Manual',
                  <>
                    The script lands in the thread and waits. You read it, then press <UI>Add</UI>.
                    Nothing touches your canvas until you say so. This is the default.
                  </>,
                ],
                [
                  'Auto',
                  <>
                    A verified script executes the moment it arrives. Faster when you are iterating.
                  </>,
                ],
              ]}
            />
            <P>
              Auto is only reasonable because of the verifier: a script reaches the canvas only after
              passing every static check, so “just do it” cannot quietly produce a broken scene. Both
              modes run identical generation — the only difference is who presses the button. And an
              auto-applied script is undoable like any other edit.
            </P>
          </>
        ),
      },
      {
        id: 'ai-lanes',
        title: 'Asking, editing and explaining',
        keywords: 'explain edit existing page question answer lane intent routing',
        body: (
          <>
            <Bullets
              items={[
                <>Ask for a scene and you get a script to add.</>,
                <>Ask a question about physics or about the page and you get an explanation, not a scene.</>,
                <>Ask for a change to what is already on the page and it plans an edit against the existing objects rather than starting over.</>,
              ]}
            />
            <P>
              Which of these happens is decided from your wording, so you do not have to pick a mode
              first.
            </P>
          </>
        ),
      },
      {
        id: 'ai-limits',
        title: 'Privacy, availability and limits',
        keywords: 'privacy local ollama on device offline model quality students permission not available',
        body: (
          <>
            <Bullets
              items={[
                <>
                  The assistant runs against a local model. Your prompts and your scenes stay on the
                  machine serving the app.
                </>,
                <>
                  If no model is available, the panel says so rather than silently failing — a
                  machine with no local model is a supported configuration, the notebook does not
                  depend on the AI for anything.
                </>,
                <>
                  Output quality depends on the model. Complicated multi-part requests are more
                  reliable split into two or three smaller ones.
                </>,
                <>
                  Students do not get the assistant. That is deliberate: the goal is that students
                  build the systems themselves.
                </>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'simscript',
        title: 'SimScript and the Code object',
        keywords: 'simscript code ide editor script syntax highlighting diagnostics snippets build scene by typing',
        body: (
          <>
            <P>
              The <UI>Code</UI> object is a small but real IDE for SimScript: syntax highlighting,
              line-accurate diagnostics (reserved words, unknown kinds, unclosed brackets or
              strings) marked in the gutter, and snippet buttons that insert a ready-made line at the
              cursor.
            </P>
            <P>
              Anything the assistant produces is plain SimScript you can paste here, read and change.
              It is the same path to the canvas either way.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'dsa',
    title: 'DSA Lab',
    icon: Terminal,
    blurb: 'Write C++ in the notebook and watch it execute.',
    articles: [
      {
        id: 'dsa-what',
        title: 'What the DSA Lab is',
        keywords: 'dsa algorithms c++ cpp interpreter code visualise step trace lab data structures',
        body: (
          <>
            <P>
              Place a <UI>DSA Lab</UI> from the palette (or the Tools panel) and you get a C++ editor
              on the left and a live visualisation on the right. The code is re-interpreted on every
              edit into a step-by-step trace, and the transport replays it: the current line stays
              highlighted in the editor while memory, pointers and the call tree animate beside it.
            </P>
            <P>
              It is a teaching-subset interpreter, not a full C++ compiler. It covers what an
              algorithms course actually writes: scalars, arrays including 2D, pointers and
              references, struct/class with fields, methods and constructors, <C>new</C>/
              <C>delete</C>, <C>vector</C>, <C>stack</C>, <C>queue</C>, <C>pair</C>, <C>map</C>,{' '}
              <C>set</C>, priority queue, deque, <C>std::string</C>, <C>cout</C>, control flow and
              recursion.
            </P>
            <Figure
              name="dsa"
              alt="The DSA Lab object: a C++ editor on the left with line numbers and the current line highlighted, and on the right the Memory, Graph, Binary Tree, Recursion Tree and Analysis tabs showing a main() stack frame."
              caption="One DSA Lab object. Editor on the left; on the right the five views — Memory, Graph, Binary Tree, Recursion Tree and Analysis — over its own transport for stepping the trace."
            />
          </>
        ),
      },
      {
        id: 'dsa-views',
        title: 'The views',
        keywords: 'memory addresses pointer arrows recursion call tree bst binary tree graph adjacency complexity analysis big o',
        body: (
          <>
            <Defs
              items={[
                [
                  'Memory',
                  <>
                    Every variable is a block with its name, value and a real address. Arrays are
                    consecutive cell strips with indices, so pointer arithmetic is honest. Heap
                    allocations are highlighted, pointers are drawn as arrows between the actual
                    cells, and the most recent write glows.
                  </>,
                ],
                [
                  'Call tree',
                  <>
                    Every function call is a node; recursive calls branch with their own parameters,
                    so <C>fib(5)</C> literally grows into a tree and each node shows its return value
                    once it finishes.
                  </>,
                ],
                [
                  'Tree',
                  <>
                    When your program has a struct with two self-referential pointer fields —{' '}
                    <C>Node* left; Node* right;</C>, whatever you named them — it is drawn as an
                    actual tree diagram instead of a tangle of boxes. Covers BST, AVL and
                    heap-as-tree.
                  </>,
                ],
                [
                  'Graph',
                  <>
                    A <C>vector&lt;vector&lt;int&gt;&gt;</C> adjacency list anywhere in memory —
                    including nested inside a <C>class Graph</C> — is drawn as a node/edge diagram.
                  </>,
                ],
                [
                  'Analysis',
                  <>
                    Operation counts measured from the actual run, the inferred recurrence relation
                    for each recursive function, and a heuristic Big-O estimate. Honestly labelled:
                    these are measurements of this execution, not proofs.
                  </>,
                ],
              ]}
            />
          </>
        ),
      },
    ],
  },
  {
    id: 'classroom',
    title: 'Classroom platform',
    icon: GraduationCap,
    blurb: 'Roles, assignments, the library, room boards and the admin console.',
    articles: [
      {
        id: 'roles',
        title: 'Roles and what each can do',
        keywords: 'role permission admin teacher student board institution tenant access matrix',
        body: (
          <>
            <P>
              Your institution is the tenant; you belong to exactly one and have exactly one role.{' '}
              <UI>Room Board</UI> is not a person — it is the account a physical classroom display
              signs in with.
            </P>
            <PermissionMatrix />
            <P>
              Students deliberately get fewer shortcuts — no assistant, no library publishing —
              because the point of the platform is that they build the systems themselves.
            </P>
          </>
        ),
      },
      {
        id: 'assignments',
        title: 'Assignments',
        keywords: 'assignment create submit review feedback due date dashboard status progress grade student teacher',
        body: (
          <>
            <P>Any page can become an assignment. The flow, end to end:</P>
            <Steps
              items={[
                <>A teacher opens a page and chooses <UI>Create assignment</UI>, setting a title and a due date.</>,
                <>Every student receives their own working copy in their <UI>Assignments</UI> view — the original teaching page is never handed out.</>,
                <>Students work in their copy with the full notebook, then submit from it.</>,
                <>The teacher sees a live dashboard: opened → in progress → submitted → reviewed, with feedback flowing straight back.</>,
              ]}
            />
            <P>
              <UI>Due soon</UI> surfaces on your home screen, and assignment activity reaches you
              through the notification bell.
            </P>
          </>
        ),
      },
      {
        id: 'insights',
        title: 'Insights dashboard',
        keywords: 'insights analytics teacher completion rate trend per student breakdown statistics',
        body: (
          <>
            <P>
              Teachers get an insights view over their assignments: overall stats, a class-wide
              completion-rate trend, a per-assignment breakdown table, and per-student performance
              and trend. It aggregates the assignments and submissions you already have — nothing
              extra is collected to produce it.
            </P>
          </>
        ),
      },
      {
        id: 'library',
        title: 'The institution library',
        keywords: 'library assets publish approve browse favourite categories search clone insert shared resources',
        body: (
          <>
            <P>
              A shared bank of pages and assets for the whole institution. Search it, browse by
              category, favourite what you use often, and insert with one click — insertion always
              clones, so the library copy cannot be edited by accident.
            </P>
            <P>
              Teachers and admins publish to it; admins approve. Students browse it read-only.
            </P>
            <Figure
              name="panel-library"
              alt="The institution Library panel with its search box, category filters and asset grid."
              tall
              caption="The Library panel. Search, categories and favourites; inserting an asset always clones it, so the library copy cannot be edited by accident."
            />
          </>
        ),
      },
      {
        id: 'boards',
        title: 'Room boards, QR pairing and Present',
        keywords: 'board room qr code scan present display classroom projector annotate mirror live cursor remote',
        body: (
          <>
            <Steps
              items={[
                <>The classroom display signs in as a board account and shows a rotating QR code.</>,
                <>A teacher scans it with their phone and picks any page from their notebook.</>,
                <>The board loads a temporary copy. Annotate it, simulate it, rewind it — the original teaching material is never touched.</>,
                <>The teacher’s device can drive the board remotely, with the pointer mirrored live so the room can follow.</>,
              ]}
            />
            <P>
              <UI>Present</UI> mode also works on its own for a fullscreen slideshow of a
              presentation page, with viewport sync and remote control.
            </P>
          </>
        ),
      },
      {
        id: 'sharing',
        title: 'Sharing pages with people',
        keywords: 'share send copy person room recipient notification clone received',
        body: (
          <>
            <P>
              Sharing sends a frozen copy to a person or a room. The recipient finds it in their{' '}
              <UI>Shared</UI> view and gets a notification. Because it is a copy, they can change it
              freely and you never lose your original — and if you change yours afterwards, theirs
              does not move under them.
            </P>
          </>
        ),
      },
      {
        id: 'admin',
        title: 'Admin console',
        keywords: 'admin console manage institution users rooms provisioning branding accounts',
        body: (
          <>
            <P>
              Admins get <C>/admin</C>: managing people and their roles, rooms and their members,
              board accounts, library approvals and institution settings such as name, logo and
              accent colour.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings reference',
    icon: Settings,
    blurb: 'Every tab in the settings window and what it controls.',
    articles: [
      {
        id: 'settings-where',
        title: 'Opening settings',
        keywords: 'settings preferences open account menu gear where',
        body: (
          <>
            <P>
              Your account menu at the top right → <UI>Settings</UI>. On a phone it opens as a
              grouped iOS-style list you drill into; on desktop it is a window with a sidebar,
              searchable from the box at the top.
            </P>
            <Figure
              name="settings"
              alt="The settings window with a searchable sidebar listing General, Appearance, Interface, Dock, Editor, Files and links, Hotkeys, Gestures, Math, Packages, Pen feel, Simulation Engine, Privacy, Documentation and About."
              caption="Settings, on the Appearance tab. Every tab is listed down the left with a search box above it; the selected tab's controls fill the right."
            />
          </>
        ),
      },
      {
        id: 'settings-options',
        title: 'Preferences',
        keywords: 'general appearance interface dock editor files hotkeys gestures math packages theme accent scale grid',
        body: (
          <>
            <Defs
              items={[
                ['General', <>Your name, email, role and institution, and signing out.</>],
                [
                  'Appearance',
                  <>
                    Theme (light, dark, dim, midnight, sepia, solarized, high contrast and several
                    tinted themes, or follow the system), accent tint including a custom colour, and
                    interface motion — bouncy springs, smooth transitions, or off for reduced motion.
                    Also <UI>Focus object on edit</UI>, the touch behaviour that lifts a selected
                    object out of the canvas while you edit it.
                  </>,
                ],
                [
                  'Interface',
                  <>
                    Text and scaling: interface scale (panels, docks, toolbars), canvas object scale
                    (text inside tables, graphs and code blocks on the page), a separate sidebar text
                    size, and panel letter spacing.
                  </>,
                ],
                [
                  'Dock',
                  <>
                    Where the tool dock lives and what it looks like. Fixed to an edge (bottom, top,
                    left, right) or freely draggable; compact or extended layout; and in extended
                    mode you can embed the transport, the Tools/Components launcher and the page
                    selector inside it. Appearance options cover container style (floating island,
                    full-width bar, or circular dial), shape, colour treatment, size and auto-hide.
                  </>,
                ],
                [
                  'Editor',
                  <>
                    Canvas and grid: scrolling axis (free, vertical or horizontal), grid style (dots,
                    ruled, graph or none) and cell size. Editing behaviour: <UI>Ink to Shape</UI>,{' '}
                    <UI>Ink Annotations</UI> and disabling double-tap zoom.
                  </>,
                ],
                [
                  'Files and links',
                  <>
                    Sync preferences per content category, a storage browser showing usage by type
                    with a delete-capable tree, and full local backup and restore.
                  </>,
                ],
                ['Hotkeys', <>Every keyboard shortcut, rebindable. See <UI>Keyboard shortcuts</UI>.</>],
                [
                  'Gestures',
                  <>
                    Touch feel: pinch sensitivity, hold-before-drag delay (so a quick swipe still
                    scrolls), the tap-versus-drag distance threshold, and palm rejection radius.
                  </>,
                ],
                ['Math', <>Precision, number notation, angle unit, unit labels and thousands separator, with a live preview.</>],
                ['Packages', <>Turn subject component packages on or off so the palette only carries the subjects you teach or study.</>],
              ]}
            />
          </>
        ),
      },
      {
        id: 'settings-tools',
        title: 'Tools',
        keywords: 'pen feel simulation engine privacy about version credits analytics terms',
        body: (
          <>
            <Defs
              items={[
                ['Pen feel', <>The full stylus panel — style, thickness, stability, smoothness, pressure sensitivity, dot size, colour palette and scribble-to-erase.</>],
                ['Simulation Engine', <>Information about the solver driving Play.</>],
                [
                  'Privacy',
                  <>
                    The full privacy policy as shown at first sign-in, the analytics opt-in, and a
                    link to re-read the terms.
                  </>,
                ],
                ['About', <>Version, update check and credits.</>],
              ]}
            />
          </>
        ),
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    icon: Keyboard,
    blurb: 'The complete keymap, generated from the app itself.',
    articles: [
      {
        id: 'keymap',
        title: 'All shortcuts',
        keywords: 'shortcut keyboard hotkey keys bindings rebind list cheat sheet',
        body: <ShortcutTable />,
      },
    ],
  },
  {
    id: 'data',
    title: 'Data, storage and sync',
    icon: HardDrive,
    blurb: 'Where your work lives, how it travels, and how to get it out.',
    articles: [
      {
        id: 'storage',
        title: 'Where your work is stored',
        keywords: 'storage local offline device browser opfs usage quota delete files manifest',
        body: (
          <>
            <P>
              Your notebook is stored on the device first — that is what lets the app keep working on
              a bad connection or none at all. What leaves the device is then a choice you make per
              page, not an automatic upload of everything.
            </P>
            <P>
              <UI>Settings → Files and links → Storage</UI> shows what is actually taking up space:
              a usage-by-type breakdown and a tree you can delete from, covering documents and PDFs,
              presentations, spreadsheets, images, boards and everything else.
            </P>
          </>
        ),
      },
      {
        id: 'sync',
        title: 'Sync and multiple devices',
        keywords: 'sync cloud devices realtime presence conflict offline pwa install',
        body: (
          <>
            <Callout tone="warn" title="Page sync is opt-in, and off by default">
              <p>
                A page’s entry in the tree always syncs — that is how another device knows the page
                exists. Its <em>content</em> — objects, sheets, notes, annotations, and the bytes of
                every image it references — only syncs once you switch sync on for that page
                (right-click the page → the sync toggle). Until you do, another device sees the page
                listed but empty, and nothing personal has left the machine.
              </p>
            </Callout>
            <Bullets
              items={[
                <>The header indicator shows whether your work has reached the cloud.</>,
                <>
                  Sync preferences in <UI>Settings → Files and links</UI> let you choose which
                  categories of content travel at all.
                </>,
                <>Individual uploaded files have their own sync toggle, independent of the page.</>,
                <>Device-to-device sync moves a workspace directly between two of your machines.</>,
                <>
                  SIMBLIP installs as an app on desktop and mobile, with offline support — add it to
                  your home screen or install it from the browser’s address bar.
                </>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'backup',
        title: 'Backup and restore',
        keywords: 'backup export zip restore import move device everything download data',
        body: (
          <>
            <P>
              <UI>Settings → Files and links → Backup</UI> produces a single zip of everything this
              account has on this device: the notebook tree, every page’s content, spreadsheet grids
              and the bytes of every locally stored file. Re-importing the same zip restores it, or
              moves you to a new device.
            </P>
            <Callout tone="warn" title="Take one before anything drastic">
              <p>
                This is the app’s only complete “all your data” export. Clearing browser storage for
                the site removes local content that has not synced.
              </p>
            </Callout>
          </>
        ),
      },
      {
        id: 'export',
        title: 'Getting individual work out',
        keywords: 'export pdf docx pptx xlsx image print share download',
        body: (
          <>
            <Bullets
              items={[
                <>A document page exports to PDF and to .docx.</>,
                <>A presentation exports to .pptx.</>,
                <>A spreadsheet re-exports to .xlsx.</>,
                <>An annotated PDF exports with your ink.</>,
                <>Any page can be shared as a copy to a person or a room.</>,
                <>Right-click any page in the tree for <UI>Export JSON</UI> — a portable copy of that one page.</>,
              ]}
            />
          </>
        ),
      },
      {
        id: 'privacy',
        title: 'Privacy',
        keywords: 'privacy policy analytics consent terms data collection opt in',
        body: (
          <>
            <P>
              The full policy is in <UI>Settings → Privacy</UI>, identical to the text shown at first
              sign-in. Analytics is opt-in and can be turned off there at any time. AI prompts go to
              a local model, not to a third-party service.
            </P>
          </>
        ),
      },
    ],
  },
  {
    id: 'help',
    title: 'Help and troubleshooting',
    icon: LifeBuoy,
    blurb: 'Common confusions, and how to report something that is genuinely wrong.',
    articles: [
      {
        id: 'faq',
        title: 'Things that trip people up',
        keywords: 'faq troubleshooting problem not working help nothing happens common issues',
        body: (
          <>
            <Defs
              items={[
                [
                  'Nothing happens when I press Play',
                  <>
                    Objects with no behaviors are drawings. Select one, open Properties, and attach a
                    Rigid Body — or place a component from the palette, which comes with its
                    behaviors already attached.
                  </>,
                ],
                [
                  'My spring is not pulling on the mass',
                  <>
                    Constraints attach by touching. Make sure the spring’s endpoint actually overlaps
                    the body. If it finds nothing, it anchors to the world instead.
                  </>,
                ],
                [
                  'My circuit reads zero',
                  <>
                    Wires bond at their endpoints within a snap radius, and overlapping bodies do not
                    conduct. Check that each wire end lands on a terminal, and that the loop is
                    actually closed — most circuits also need a Ground.
                  </>,
                ],
                [
                  'The tools are drawing on the wrong page',
                  <>
                    In a split view, the dock follows whichever pane you last clicked into. Click the
                    pane you mean first.
                  </>,
                ],
                [
                  'My pen strokes keep turning into shapes',
                  <>
                    That is <UI>Ink to Shape</UI>. Turn it off in <UI>Settings → Editor</UI>.
                  </>,
                ],
                [
                  'A shortcut does nothing',
                  <>
                    Some are conditional — stepping only works while paused, the eraser only while
                    editing. Check the condition next to it in the shortcuts list, and check nothing
                    has rebound it in <UI>Settings → Hotkeys</UI>.
                  </>,
                ],
                [
                  'I deleted a page by mistake',
                  <>
                    Deletion is permanent — there is no trash. If the page had cloud sync enabled
                    and another device has not synced since, that device may still hold a copy.
                    Otherwise the recovery route is a backup zip taken earlier. Use{' '}
                    <UI>Export JSON</UI> on pages you care about.
                  </>,
                ],
                [
                  'The AI panel says it is unavailable',
                  <>
                    The assistant needs a local model on the machine serving the app. Everything else
                    in the notebook works without it. Students do not get the assistant at all.
                  </>,
                ],
              ]}
            />
          </>
        ),
      },
      {
        id: 'report',
        title: 'Reporting a bug',
        keywords: 'bug report feedback issue problem contact support submit',
        body: (
          <>
            <P>
              Your account menu → <UI>Report a bug</UI>. It is two fields: what happened, and what
              you expected. Your browser, OS, viewport and the route you filed it from are captured
              automatically — those are exactly what makes a report reproducible and exactly what
              nobody remembers to include.
            </P>
          </>
        ),
      },
      {
        id: 'contact',
        title: 'Licensing and contact',
        keywords: 'licensing contact institution buy pricing sales sign up account',
        body: (
          <>
            <P>
              SIMBLIP is licensed to institutions rather than to individuals. If your school or
              university is not provisioned yet, contact licensing from the landing page. If you
              already have an account and cannot sign in, your institution’s admin manages accounts
              from the admin console.
            </P>
          </>
        ),
      },
    ],
  },
]
