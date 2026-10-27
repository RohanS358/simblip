// Slash commands for the assistant: "/teach ohms law", "/teach-page", "/teach-course circuits".
//
// Wording is a poor way to tell a program what you want. "teach me whatever is in this page" and "teach me Ohm's law" differ by
// a few words, and any rule that guesses between them guesses wrong sometimes. A command says it outright, so it is routed
// without guessing: straight to the tool, or to a chosen lane of the model. Plain sentences still work for everything else.
// Pure — the panel decides what to do with a plan.

export type CommandPlan =
  /** Run a tool with these arguments, no model needed to pick them. */
  | { kind: 'tool'; tool: string; args: Record<string, unknown> }
  /** Send to the model, in a lane the student chose. `prompt` is what the model reads (without the slash). */
  | { kind: 'lane'; intent: 'explain' | 'simulate' | 'edit'; prompt: string }
  /** Handled in the panel itself. */
  | { kind: 'local'; action: 'help' }

export interface Command {
  name: string
  /** How to type it. */
  usage: string
  /** One line, shown in the menu. */
  summary: string
  /** A group in the menu. */
  group: 'Teach' | 'Ask' | 'Make' | 'Build' | 'Run' | 'Notebook' | 'Help'
  /** Takes text after it (required unless `optionalArg`). */
  arg?: 'required' | 'optional'
  /** Returns a plain-language problem with the text after the command, if any. */
  check?: (arg: string) => string | undefined
  plan: (arg: string) => CommandPlan
}

const tool = (t: string, args: Record<string, unknown> = {}): CommandPlan => ({ kind: 'tool', tool: t, args })

/** "front | back" → a card. Without a "|" there is no answer to store, so the tool asks for one. */
const recall = (a: string): CommandPlan => {
  const [front, ...rest] = a.split('|')
  return tool('learn.cards.create', { conceptId: 'chat', front: front.trim(), back: rest.join('|').trim() })
}

export const COMMANDS: Command[] = [
  { name: 'teach', usage: '/teach <topic>', summary: 'A narrated, animated lesson on any topic', group: 'Teach', arg: 'required', plan: (a) => tool('teach.lesson', { topic: a }) },
  { name: 'teach-page', usage: '/teach-page', summary: 'Walk through everything on the page you have open', group: 'Teach', arg: 'optional', plan: (a) => tool('teach.page', /\b(brief|short|quick)\b/i.test(a) ? { brief: true } : {}) },
  { name: 'teach-course', usage: '/teach-course <course>', summary: 'Play a whole course, lesson after lesson', group: 'Teach', arg: 'required', plan: (a) => tool('teach.course', { name: a }) },
  { name: 'ask', usage: '/ask <question>', summary: 'The teacher answers using the page you have open', group: 'Ask', arg: 'required', plan: (a) => tool('teach.ask', { question: a }) },
  { name: 'solve', usage: '/solve <problem>', summary: 'Solve a problem step by step, with diagrams', group: 'Ask', arg: 'required', plan: (a) => tool('teach.material', { text: a.length >= 8 ? a : `${a} (problem)`, request: 'solve this', mode: 'solve' }) },
  { name: 'explain', usage: '/explain <question>', summary: 'A written explanation, no simulation', group: 'Ask', arg: 'required', plan: (a) => ({ kind: 'lane', intent: 'explain', prompt: a }) },
  { name: 'build', usage: '/build <description>', summary: 'Build a simulation on the page', group: 'Build', arg: 'required', plan: (a) => ({ kind: 'lane', intent: 'simulate', prompt: a }) },
  { name: 'edit', usage: '/edit <change>', summary: 'Change what is already on the page', group: 'Build', arg: 'required', plan: (a) => ({ kind: 'lane', intent: 'edit', prompt: a }) },
  { name: 'slides', usage: '/slides <topic>', summary: 'Write a slide deck on a topic', group: 'Make', arg: 'required', plan: (a) => ({ kind: 'lane', intent: 'explain', prompt: `Make slides on ${a}` }) },
  { name: 'notes', usage: '/notes <text>', summary: 'Pin a sticky note in your Note Gallery', group: 'Make', arg: 'required', plan: (a) => tool('life.note', { text: a }) },
  { name: 'todo', usage: '/todo <task>', summary: 'Add a to-do', group: 'Make', arg: 'required', plan: (a) => tool('life.todo', { text: a }) },
  { name: 'remind', usage: '/remind <what> <when>', summary: 'Set a reminder, e.g. call mom tomorrow 5pm', group: 'Make', arg: 'required', plan: (a) => tool('life.remind', { text: a }) },
  { name: 'event', usage: '/event <title> <when>', summary: 'Add a calendar event, e.g. exam friday 10am', group: 'Make', arg: 'required', plan: (a) => tool('life.event', { text: a }) },
  { name: 'recall', usage: '/recall <question> | <answer>', summary: 'Make a flash card to revise later', group: 'Make', arg: 'required', check: (a) => (/\S\s*\|\s*\S/.test(a) ? undefined : 'A flash card needs a question and an answer split by “|”, like /recall What is Ohm’s law? | V = IR.'), plan: (a) => recall(a) },
  { name: 'run', usage: '/run', summary: 'Run the simulation', group: 'Run', plan: () => tool('scene.run') },
  { name: 'pause', usage: '/pause', summary: 'Pause the simulation', group: 'Run', plan: () => tool('scene.pause') },
  { name: 'reset', usage: '/reset', summary: 'Put the simulation back as drawn', group: 'Run', plan: () => tool('scene.reset') },
  { name: 'undo', usage: '/undo', summary: 'Undo the last change', group: 'Run', plan: () => tool('scene.undo') },
  { name: 'redo', usage: '/redo', summary: 'Redo it', group: 'Run', plan: () => tool('scene.redo') },
  { name: 'describe', usage: '/describe', summary: 'What is on this page', group: 'Notebook', plan: () => tool('scene.describe') },
  { name: 'quiz', usage: '/quiz', summary: 'The next flash card that is due', group: 'Notebook', plan: () => tool('learn.cards.next') },
  { name: 'pages', usage: '/pages', summary: 'List the pages in your notebook', group: 'Notebook', plan: () => tool('page.list') },
  { name: 'open', usage: '/open <page>', summary: 'Open a page by name', group: 'Notebook', arg: 'required', plan: (a) => tool('page.open', { name: a }) },
  { name: 'new', usage: '/new [name]', summary: 'A new page next to this one', group: 'Notebook', arg: 'optional', plan: (a) => tool('page.create', a ? { name: a } : {}) },
  { name: 'help', usage: '/help', summary: 'Show every command', group: 'Help', plan: () => ({ kind: 'local', action: 'help' }) },
]

const byName = new Map(COMMANDS.map((c) => [c.name, c]))

export type Parsed =
  | { ok: true; command: Command; arg: string; plan: CommandPlan }
  | { ok: false; error: string }

/** null when the text is not a command at all (an ordinary message, or a path like "/usr/bin"). */
export function parseCommand(text: string): Parsed | null {
  const m = /^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const name = m[1].toLowerCase()
  const arg = (m[2] ?? '').trim()
  const command = byName.get(name)
  if (!command) {
    const near = COMMANDS.filter((c) => c.name.startsWith(name.slice(0, 3))).slice(0, 3).map((c) => `/${c.name}`)
    return { ok: false, error: `I don't have a /${name} command.${near.length ? ` Did you mean ${near.join(' or ')}?` : ''} Type /help to see them all.` }
  }
  if (command.arg === 'required' && !arg) return { ok: false, error: `/${command.name} needs something after it, like ${command.usage.replace(/<([^>]+)>/, '“$1”')}.` }
  const problem = command.check?.(arg)
  if (problem) return { ok: false, error: problem }
  return { ok: true, command, arg, plan: command.plan(arg) }
}

/** The menu: commands whose name starts with what has been typed after the slash (all of them for a bare "/"). */
export function matchCommands(typed: string): Command[] {
  const m = /^\/([a-z-]*)$/i.exec(typed)
  if (!m) return []
  const q = m[1].toLowerCase()
  const starts = COMMANDS.filter((c) => c.name.startsWith(q))
  return starts.length ? starts : COMMANDS.filter((c) => c.name.includes(q))
}

export function helpText(): string {
  const groups = ['Teach', 'Ask', 'Build', 'Run', 'Notebook', 'Help'] as const
  const lines = ['Type `/` for the list. Anything that is not a command is just a message to me.', '']
  for (const g of groups) {
    const list = COMMANDS.filter((c) => c.group === g)
    if (!list.length) continue
    lines.push(`**${g}**`)
    for (const c of list) lines.push(`- \`${c.usage}\` — ${c.summary}`)
    lines.push('')
  }
  return lines.join('\n').trim()
}
