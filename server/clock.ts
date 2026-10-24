import { db } from './db.ts'

const read = db.prepare(`select value from settings where key = 'offset_ms'`)
const write = db.prepare(`insert into settings (key, value) values ('offset_ms', ?) on conflict(key) do update set value = excluded.value`)

export function offsetMs() {
  const row = read.get() as { value: string } | undefined
  return row ? Number(row.value) : 0
}

export function now() {
  return new Date(Date.now() + offsetMs())
}

export function advance(days: number) {
  write.run(String(offsetMs() + days * 86400000))
}

export function resetClock() {
  write.run('0')
}

export function isoDate(d: Date) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// A wall-clock hour in Pacific time on a date, with the right offset for daylight time.
export function at9(date: string, hour = 9) {
  const probe = new Date(`${date}T17:00:00Z`)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' }).formatToParts(probe).find(p => p.type === 'timeZoneName')!.value
  const hours = Number(name.replace('GMT', '') || 0)
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`).toISOString()
}

export function today() {
  return isoDate(now())
}

export function parseDate(s: string) {
  return new Date(s.length === 10 ? `${s}T12:00:00-07:00` : s)
}

export function addDays(date: string, n: number) {
  const d = parseDate(date)
  d.setUTCDate(d.getUTCDate() + n)
  return isoDate(d)
}

export function addMonths(date: string, n: number) {
  const d = parseDate(date)
  d.setUTCMonth(d.getUTCMonth() + n)
  return isoDate(d)
}

export function addBusinessDays(date: string, n: number) {
  let d = date
  let left = Math.abs(n)
  while (left > 0) {
    d = addDays(d, Math.sign(n))
    const day = parseDate(d).getUTCDay()
    if (day !== 0 && day !== 6) left--
  }
  return d
}

export function daysBetween(a: string, b: string) {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000)
}

// Formulas look like "termination_date + 60 days" or "today + 2 business days - 1 days".
// Returns null when the anchor field is missing, so the caller can ask for it.
export function evalFormula(formula: string, lookup: (path: string) => any): string | null {
  const [anchor, ...rest] = formula.trim().split(/\s+(?=[+-]\s)/)
  const base = anchor === 'today' ? today() : lookup(anchor.trim())
  if (!base || !/^\d{4}-\d{2}-\d{2}/.test(String(base))) return null
  let d = String(base).slice(0, 10)
  for (const term of rest) {
    const m = term.match(/^([+-])\s*(\d+)\s*(business days?|days?|months?|weeks?)$/)
    if (!m) throw new Error(`Bad deadline formula: ${formula}`)
    const n = Number(m[2]) * (m[1] === '-' ? -1 : 1)
    if (m[3].startsWith('business')) d = addBusinessDays(d, n)
    else if (m[3].startsWith('month')) d = addMonths(d, n)
    else if (m[3].startsWith('week')) d = addDays(d, n * 7)
    else d = addDays(d, n)
  }
  return d
}
