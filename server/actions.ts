import { db, json } from './db.ts'
import { now, evalFormula } from './clock.ts'
import { updateCase, logEvent, scheduleFollowups, getProfile } from './engine.ts'
import { placeCall, finishCall } from './calls.ts'

export async function sendEmail(p: { to: string, subject: string, body: string, cc?: string }) {
  if (!process.env.RESEND_API_KEY) throw new Error('Email is not configured: set RESEND_API_KEY and EMAIL_FROM in .env')
  const profile = getProfile()
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [p.to],
      cc: p.cc ? [p.cc] : undefined,
      reply_to: profile.email,
      subject: p.subject,
      text: p.body
    })
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body)}`)
  return { provider: 'resend', id: body.id, to: p.to }
}

export async function sendSms(p: { to: string, body: string }) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  if (!sid) throw new Error('SMS is not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM in .env')
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: p.to, From: process.env.TWILIO_FROM!, Body: p.body })
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${body.message}`)
  return { provider: 'twilio', sid: body.sid, to: p.to }
}

// Messages to the user themself (reminders, call outcomes) go out without approval.
export async function notifyUser(caseId: string, text: string) {
  logEvent(caseId, 'notify', text)
  const phone = getProfile().phone
  if (phone && process.env.TWILIO_ACCOUNT_SID) {
    try {
      await sendSms({ to: phone, body: `Handled: ${text}` })
    } catch (e: any) {
      logEvent(caseId, 'error', `Could not text you: ${e.message}`)
    }
  }
}

function prefillUrl(p: { url: string, params?: Record<string, string> }) {
  const u = new URL(p.url)
  for (const [k, v] of Object.entries(p.params ?? {})) u.searchParams.set(k, v)
  return u.toString()
}

// With no paid provider configured, Handled still does all the drafting and hands the last tap
// to the phone: the mail app, the messages app, or the dialer with the script on screen.
function handoff(tool: string, p: Record<string, any>) {
  if (tool === 'send_email' && !process.env.RESEND_API_KEY) {
    const q = new URLSearchParams({ subject: p.subject ?? '', body: p.body ?? '' })
    if (p.cc) q.set('cc', p.cc)
    return { handoff: 'email', url: `mailto:${encodeURIComponent(p.to)}?${q.toString().replace(/\+/g, '%20')}` }
  }
  if (tool === 'send_sms' && !process.env.TWILIO_ACCOUNT_SID) return { handoff: 'sms', url: `sms:${p.to}?&body=${encodeURIComponent(p.body ?? '')}` }
  if (tool === 'place_call' && !process.env.VAPI_API_KEY) return { handoff: 'call', url: `tel:${p.to}` }
  return null
}

export async function executeAction(id: number, edited?: Record<string, any>) {
  const a = db.prepare('select * from actions where id = ?').get(id) as any
  if (a.status !== 'proposed') throw new Error(`Action ${id} is ${a.status}`)
  const payload = { ...json(a.payload, {} as Record<string, any>), ...(edited ?? {}) }
  const manual = handoff(a.tool, payload)
  if (manual) {
    db.prepare(`update actions set status = 'handoff', payload = ?, result = ? where id = ?`).run(JSON.stringify(payload), JSON.stringify(manual), id)
    logEvent(a.case_id, 'handoff', `Ready on your phone: ${a.title}`, manual)
    return { ok: true, result: manual }
  }
  db.prepare(`update actions set status = 'running', payload = ? where id = ?`).run(JSON.stringify(payload), id)

  let result: any
  try {
    if (a.tool === 'send_email') result = await sendEmail(payload as any)
    else if (a.tool === 'send_sms') result = await sendSms(payload as any)
    else if (a.tool === 'place_call') result = await placeCall(a.case_id, id, payload as any)
    else if (a.tool === 'create_calendar_event') {
      db.prepare(`insert into deadlines (case_id, title, due_at, kind, note) values (?, ?, ?, 'event', ?)`).run(a.case_id, payload.title ?? a.title, payload.date ?? a.due_at, payload.note ?? null)
      result = { calendar: 'added to Handled calendar feed', date: payload.date ?? a.due_at }
    }
    else if (a.tool === 'prepare_form') result = { prepared: true, official_url: payload.official_url, note: 'Prepared. Open the official site, paste the fields, and press submit yourself.' }
    else if (a.tool === 'open_url_prefilled') result = { url: prefillUrl(payload as any) }
    else if (a.tool === 'schedule_followup') {
      const runAt = evalFormula(`today + ${payload.wait}`, () => null)
      db.prepare(`insert into jobs (case_id, kind, run_at, payload) values (?, 'followup', ?, ?)`).run(a.case_id, `${runAt}T09:00:00-07:00`, JSON.stringify(payload))
      result = { scheduled_for: runAt }
    }
    else throw new Error(`Unknown tool ${a.tool}`)
  } catch (e: any) {
    db.prepare(`update actions set status = 'failed', result = ? where id = ?`).run(JSON.stringify({ error: e.message }), id)
    logEvent(a.case_id, 'error', `${a.title} failed`, { error: e.message })
    return { ok: false, error: e.message }
  }

  const status = a.tool === 'place_call' ? 'in_progress' : 'done'
  db.prepare(`update actions set status = ?, result = ?, done_at = ? where id = ?`).run(status, JSON.stringify(result), now().toISOString(), id)
  logEvent(a.case_id, 'action', a.tool === 'place_call' ? `Calling: ${a.title}` : `Done: ${a.title}`, { tool: a.tool, payload, result })
  if (payload.waits_on_other_party) updateCase(a.case_id, { status: 'waiting_on_other_party' })
  if (a.step) scheduleFollowups(a.case_id, a.step)
  return { ok: true, result }
}

// The user did the last step themself (sent the email, made the call). For a call, what they
// heard becomes the outcome, exactly as an automated call's transcript would.
export async function completeAction(id: number, notes?: string) {
  const a = db.prepare('select * from actions where id = ?').get(id) as any
  const payload = json(a.payload, {} as Record<string, any>)
  const result = { ...json(a.result, {}), completed_by: 'you', notes: notes ?? null }
  db.prepare(`update actions set status = 'done', result = ?, done_at = ? where id = ?`).run(JSON.stringify(result), now().toISOString(), id)
  logEvent(a.case_id, 'action', `Done: ${a.title}`, { tool: a.tool, by: 'you', notes })
  if (payload.waits_on_other_party) updateCase(a.case_id, { status: 'waiting_on_other_party' })
  if (a.step) scheduleFollowups(a.case_id, a.step)
  if (a.tool === 'place_call' && notes) await finishCall(a.case_id, id, { id: null, endedReason: 'you made the call', transcript: `Notes from ${getProfile().name}: ${notes}` })
}

export function rejectAction(id: number) {
  const a = db.prepare('select * from actions where id = ?').get(id) as any
  db.prepare(`update actions set status = 'rejected', done_at = ? where id = ?`).run(now().toISOString(), id)
  logEvent(a.case_id, 'rejected', `Skipped: ${a.title}`)
}
