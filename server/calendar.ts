import ICAL from 'ical.js'
import { at9 } from './clock.ts'

export type Busy = { start: number, end: number, title: string }

// Today's busy times as minutes after midnight Pacific, from an iCal feed. All-day, "free" and cancelled events don't block.
export function busyOn(ics: string, date: string): Busy[] {
  const dayStart = Date.parse(at9(date, 0))
  const dayEnd = dayStart + 86400000
  const cal = new ICAL.Component(ICAL.parse(ics))
  for (const tz of cal.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
  const events = cal.getAllSubcomponents('vevent').map(v => new ICAL.Event(v))
  const masters = new Map(events.filter(e => !e.isRecurrenceException()).map(e => [e.uid, e]))
  for (const e of events) if (e.isRecurrenceException()) masters.get(e.uid)?.relateException(e)

  const out: Busy[] = []
  const add = (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    if (start.isDate || event.component.getFirstPropertyValue('transp') === 'TRANSPARENT' || event.component.getFirstPropertyValue('status') === 'CANCELLED') return
    const s = start.toJSDate().getTime()
    const e = end.toJSDate().getTime()
    if (e <= dayStart || s >= dayEnd) return
    out.push({ start: Math.max(0, Math.round((s - dayStart) / 60000)), end: Math.min(1440, Math.round((e - dayStart) / 60000)), title: event.summary ?? 'Busy' })
  }
  for (const event of masters.values()) {
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate)
      continue
    }
    const it = event.iterator()
    for (let next = it.next(), n = 0; next && n < 5000; next = it.next(), n++) {
      if (next.toJSDate().getTime() >= dayEnd) break
      const o = event.getOccurrenceDetails(next)
      add(o.item, o.startDate, o.endDate)
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

export async function busyToday(url: string, date: string) {
  const res = await fetch(url.replace(/^webcal:/, 'https:'), { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Calendar link returned ${res.status}`)
  return busyOn(await res.text(), date)
}
