// Undo withAttachments(): the prompt the assistant receives is "ATTACHED FILES … REQUEST: …". Routing has to look at the
// REQUEST (is it "solve this"?) and teach from the attached MATERIAL, so the two are split apart here. Pure.

export interface Attached { request: string; material: string }

export function splitAttached(prompt: string): Attached | null {
  const m = /^ATTACHED FILES[^\n]*\n([\s\S]*?)\n\nREQUEST: ([\s\S]*)$/.exec(prompt)
  if (!m) return null
  const material = m[1].split('\n').filter((l) => !/^--- .+ ---$/.test(l)).join('\n').trim()
  return material ? { request: m[2].trim(), material } : null
}
