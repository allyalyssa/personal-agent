import { db } from './db.ts'

function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function day(iso: string) {
  return iso.slice(0, 10).replace(/-/g, '')
}

// Subscribe a phone calendar to /calendar.ics and every deadline, check-in and booking shows up.
export function calendarFeed(caseId?: string) {
  const rows = (caseId
    ? db.prepare(`select d.*, c.title as case_title from deadlines d join cases c on c.id = d.case_id where d.case_id = ?`).all(caseId)
    : db.prepare(`select d.*, c.title as case_title from deadlines d join cases c on c.id = d.case_id where c.status != 'resolved'`).all()) as any[]
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Handled//EN', 'X-WR-CALNAME:Handled', 'CALSCALE:GREGORIAN']
  for (const d of rows) {
    const end = new Date(`${d.due_at.slice(0, 10)}T12:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    lines.push(
      'BEGIN:VEVENT',
      `UID:handled-${d.id}@handled.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day(d.due_at)}`,
      `DTEND;VALUE=DATE:${day(end.toISOString())}`,
      `SUMMARY:${esc(`${d.kind === 'deadline' ? 'Deadline: ' : ''}${d.title}`)}`,
      `DESCRIPTION:${esc(`${d.case_title}${d.note ? `\n${d.note}` : ''}`)}`,
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(d.title)}`, 'END:VALARM',
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
