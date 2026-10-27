// What comes BACK from the model, made fit to show. Small models leave their working in the answer (<think> blocks), wrap
// the whole thing in a code fence, open with filler, repeat a paragraph, quote object ids the student never saw ("mvj6i7by…")
// and leave a stray `$` that turns the rest of the line into broken maths. None of that is information; all of it is noise
// on the screen and in the next turn's history. Pure.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Remove reasoning the model wrote for itself, including one that never closed (the stream was cut). */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/i, '')
}

/** Put people's words where ids were: “mvj6i7byqamz9t” → “Ball”. */
export function humaniseIds(text: string, names: Record<string, string>): string {
  const ids = Object.keys(names).filter((id) => id.length >= 6)
  if (!ids.length) return text
  const re = new RegExp(`(?:\\b(?:object|id|element)\\s+)?["“'\`]?\\b(${ids.map(escape).join('|')})\\b["”'\`]?`, 'gi')
  return text.replace(re, (_m, id: string) => `“${names[id] ?? names[id.toLowerCase()] ?? id}”`)
}

/** An odd number of `$` on a line means one is stray; drop the last so the maths before it still renders. */
function balanceMaths(line: string): string {
  const marks = [...line.matchAll(/(?<!\\)\$/g)]
  if (marks.length % 2 === 0) return line
  const last = marks[marks.length - 1].index!
  return line.slice(0, last) + line.slice(last + 1)
}

export function tidyReply(raw: string, names: Record<string, string> = {}): string {
  let t = stripThinking(raw).replace(/\r\n/g, '\n').trim()
  // A reply that is entirely one fenced block is the model quoting itself.
  const fenced = /^```(?:markdown|md|text)?\n([\s\S]*?)\n```$/.exec(t)
  if (fenced) t = fenced[1].trim()
  t = t.replace(/^(?:sure|certainly|of course|absolutely|great question|okay|ok)[!,.:]?\s+/i, '')
  t = humaniseIds(t, names)
  t = t.split('\n').map(balanceMaths).join('\n')
  // Repeated paragraphs: keep the first.
  const seen = new Set<string>()
  t = t
    .split(/\n{2,}/)
    .filter((p) => {
      const key = p.replace(/\s+/g, ' ').trim().toLowerCase()
      if (key.length < 25) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join('\n\n')
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
