// "dentist tomorrow 5pm", "call mom in 2 hours", "exam on friday" → a title and a local date/time.
// Pure: `now` is passed in so it is testable. Understands today/tomorrow, weekdays, YYYY-MM-DD, "in N units", and "5pm" / "17:30".

export interface When { title: string; date?: string; time?: string }

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const p2 = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

export function parseWhen(text: string, now: Date = new Date()): When {
  let t = ` ${text.trim()} `
  let date: string | undefined
  let time: string | undefined
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(t)
    if (!m) return false
    fn(m)
    t = t.replace(m[0], ' ')
    return true
  }
  const addDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return ymd(d) }

  take(/\bin\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)\b/i, (m) => {
    const n = Number(m[1])
    const u = m[2].toLowerCase()
    if (u.startsWith('d')) date = addDays(n)
    else if (u.startsWith('w')) date = addDays(n * 7)
    else {
      const d = new Date(now.getTime() + n * (u.startsWith('m') ? 60_000 : 3_600_000))
      date = ymd(d)
      time = `${p2(d.getHours())}:${p2(d.getMinutes())}`
    }
  })
  if (!date) {
    take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => { date = `${m[1]}-${m[2]}-${m[3]}` }) ||
      take(/\bday after tomorrow\b/i, () => { date = addDays(2) }) ||
      take(/\btomorrow\b/i, () => { date = addDays(1) }) ||
      take(/\b(?:today|tonight)\b/i, () => { date = addDays(0) }) ||
      take(/\b(?:(?:on|next|this)\s+)?(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?\b/i, (m) => {
        const i = DAYS.findIndex((d) => d.startsWith(m[1].toLowerCase().slice(0, 3)))
        date = addDays(((i - now.getDay() + 7) % 7) || 7)
      })
  }
  if (!time) {
    take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => {
      let h = Number(m[1]) % 12
      if (m[3].toLowerCase() === 'pm') h += 12
      time = `${p2(h)}:${m[2] ?? '00'}`
    }) ||
      take(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => { time = `${p2(Number(m[1]))}:${m[2]}` }) ||
      take(/\bat\s+(\d{1,2})\b/i, (m) => { time = `${p2(Number(m[1]) % 24)}:00` })
  }
  // A time with no day means the next time that clock reads: today if still ahead, else tomorrow.
  if (time && !date) {
    const [h, mi] = time.split(':').map(Number)
    date = h * 60 + mi > now.getHours() * 60 + now.getMinutes() ? addDays(0) : addDays(1)
  }
  const title = t.replace(/\s+/g, ' ').trim().replace(/^(?:to|that|about|on|at|for)\s+/i, '').replace(/\s+(?:on|at|by|for|in)$/i, '').trim()
  return { title, date, time }
}
