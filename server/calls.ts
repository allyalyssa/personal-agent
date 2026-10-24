import { db, json } from './db.ts'
import { now } from './clock.ts'
import { getCase, getProfile, logEvent, updateCase, setFields, plan } from './engine.ts'
import { structured } from './llm.ts'
import { notifyUser } from './actions.ts'
import { redact, redactDeep } from './redact.ts'

type CallPayload = {
  to: string
  contact_name: string
  goal: string
  opener: string
  facts: string[]
  must_not: string[]
  ask: string[]
  outcome?: Record<string, any>
}

const VAPI = 'https://api.vapi.ai'

function vapiHeaders() {
  if (!process.env.VAPI_API_KEY) throw new Error('Calling is not configured: set VAPI_API_KEY and VAPI_PHONE_NUMBER_ID in .env')
  return { Authorization: `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' }
}

export function callSystemPrompt(p: CallPayload, userName: string) {
  return `You are an AI assistant making a phone call on behalf of ${userName}. You are talking to ${p.contact_name}.
You already said you are an AI assistant calling for ${userName}. If asked again, say so plainly.

Goal: ${p.goal}

Facts you may share:
${p.facts.map(f => `- ${f}`).join('\n')}

Get answers to:
${p.ask.map(q => `- ${q}`).join('\n')}

Never agree to any of these without ${userName}; say you will check with them and call back:
${p.must_not.map(m => `- ${m}`).join('\n')}
Never share payment card numbers, Social Security numbers, or passwords. You have none.

Speak in short, natural sentences, one question at a time. If they put you on hold, wait.
When you have the answers or a firm booking, repeat the key details back (date, time, price), thank them, and say goodbye.`
}

export async function placeCall(caseId: string, actionId: number, p: CallPayload) {
  const userName = getProfile().name
  const res = await fetch(`${VAPI}/call`, {
    method: 'POST',
    headers: vapiHeaders(),
    body: JSON.stringify({
      phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
      customer: { number: p.to, name: p.contact_name },
      assistant: {
        firstMessage: `Hi, this is an AI assistant calling on behalf of ${userName}. ${p.opener}`,
        model: {
          provider: process.env.VAPI_MODEL_PROVIDER ?? 'openai',
          model: process.env.VAPI_MODEL ?? 'gpt-4o',
          messages: [{ role: 'system', content: callSystemPrompt(p, userName) }]
        },
        maxDurationSeconds: 300
      }
    })
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Vapi ${res.status}: ${JSON.stringify(body.message ?? body)}`)
  watchCall(caseId, actionId, body.id)
  return { provider: 'vapi', call_id: body.id, status: body.status, to: p.to }
}

const watching = new Set<string>()

export function watchCall(caseId: string, actionId: number, callId: string) {
  if (watching.has(callId)) return
  watching.add(callId)
  let lastStatus = ''
  const timer = setInterval(async () => {
    const res = await fetch(`${VAPI}/call/${callId}`, { headers: vapiHeaders() })
    const call = await res.json()
    if (call.status !== lastStatus) {
      lastStatus = call.status
      logEvent(caseId, 'call', `Call ${call.status}`, { call_id: callId })
    }
    if (call.status !== 'ended') return
    clearInterval(timer)
    watching.delete(callId)
    await finishCall(caseId, actionId, call)
  }, 4000)
}

function transcriptOf(call: any): string {
  if (call.artifact?.transcript) return call.artifact.transcript
  if (call.transcript) return call.transcript
  const messages = call.artifact?.messages ?? call.messages ?? []
  return messages.filter((m: any) => m.role === 'bot' || m.role === 'user' || m.role === 'assistant').map((m: any) => `${m.role === 'user' ? 'Them' : 'AI'}: ${m.message ?? m.content}`).join('\n')
}

// After the call, Claude reads the transcript and pulls out the outcome the playbook asked for.
export async function finishCall(caseId: string, actionId: number, call: any) {
  const a = db.prepare('select * from actions where id = ?').get(actionId) as any
  const payload = json(a.payload, {} as any)
  const transcript = redact(transcriptOf(call))
  const outcomeSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['reached', 'resolved', 'summary', 'appointment_date', 'appointment_time', 'price', 'next_step', 'fields'],
    properties: {
      reached: { type: 'boolean', description: 'Spoke with a person who could help' },
      resolved: { type: 'boolean', description: 'The call goal was achieved' },
      summary: { type: 'string', description: 'Two sentences, plain English' },
      appointment_date: { type: ['string', 'null'], description: 'YYYY-MM-DD if a date was agreed' },
      appointment_time: { type: ['string', 'null'], description: 'Time or window as said, e.g. 9-11am' },
      price: { type: ['number', 'null'], description: 'Quoted or agreed price in dollars' },
      next_step: { type: 'string' },
      fields: {
        type: 'array',
        description: `Other facts learned. Keys wanted: ${Object.keys(payload.outcome ?? {}).join(', ') || 'none'}`,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'value'],
          properties: { key: { type: 'string' }, value: { type: 'string' } }
        }
      }
    }
  }
  const outcome = transcript.trim()
    ? await structured<any>(
      `You read phone call transcripts for a personal assistant app and record exactly what was agreed. Today is ${now().toISOString().slice(0, 10)}. Only record what the other party actually said; use null when something was not stated.`,
      [{ type: 'text', text: `Call goal: ${payload.goal}\nWanted: ${JSON.stringify(payload.outcome ?? {})}\nEnded because: ${call.endedReason}\n\nTranscript:\n${transcript}` }],
      outcomeSchema
    )
    : { reached: false, resolved: false, summary: `No conversation (${call.endedReason}).`, appointment_date: null, appointment_time: null, price: null, next_step: 'Try again or call manually.', fields: [] }

  const result = redactDeep({ call_id: call.id, ended_reason: call.endedReason, duration_s: call.startedAt && call.endedAt ? Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000) : null, recording_url: call.artifact?.recordingUrl ?? call.recordingUrl ?? null, transcript, outcome })
  db.prepare(`update actions set status = ?, result = ?, done_at = ? where id = ?`).run(outcome.resolved ? 'done' : 'failed', JSON.stringify(result), now().toISOString(), actionId)
  logEvent(caseId, 'call_result', `Call with ${payload.contact_name}: ${outcome.summary}`, result)

  const learned: Record<string, any> = Object.fromEntries(outcome.fields.map((f: any) => [f.key, f.value]))
  if (outcome.price !== null) learned.quoted_price = outcome.price
  if (outcome.appointment_date) learned.appointment_date = outcome.appointment_date
  if (outcome.appointment_time) learned.appointment_time = outcome.appointment_time
  setFields(caseId, learned)

  if (outcome.appointment_date) {
    const title = `${payload.contact_name}: ${outcome.appointment_time ?? ''} ${outcome.price !== null ? `($${outcome.price})` : ''}`.replace(/\s+/g, ' ').trim()
    db.prepare(`insert into deadlines (case_id, title, due_at, kind, note) values (?, ?, ?, 'event', ?)`).run(caseId, title, outcome.appointment_date, `Booked by phone. ${outcome.next_step}`)
    logEvent(caseId, 'calendar', `Added to calendar: ${title} on ${outcome.appointment_date}`)
    updateCase(caseId, { status: 'waiting_on_other_party' })
  }
  const c = getCase(caseId)
  // Re-plan so drafts that depend on the call (quote, appointment) pick up the new facts.
  if (c.playbook) plan(caseId)
  await notifyUser(caseId, `${c.title}. ${outcome.summary}`)
}
