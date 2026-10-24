import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.HANDLED_DB = ':memory:'
delete process.env.ANTHROPIC_API_KEY
delete process.env.RESEND_API_KEY
delete process.env.TWILIO_ACCOUNT_SID
delete process.env.VAPI_API_KEY
const { loadRules } = await import('../server/rules.ts')
const { loadPlaybooks } = await import('../server/playbooks.ts')
const { createCase, updateCase, setFields, plan, setProfile, getProfile, prefillFromProfile, getCase, coerceAnswers, remember } = await import('../server/engine.ts')
const { routeByTriggers, intake, reply } = await import('../server/agent.ts')
const { executeAction, completeAction } = await import('../server/actions.ts')
const { civicReport } = await import('../server/civic.ts')
const { db } = await import('../server/db.ts')
const { readFileSync } = await import('node:fs')

loadRules()
loadPlaybooks()
setProfile(JSON.parse(readFileSync('profiles/valentina.json', 'utf8')))

test('Spanish and Portuguese voice notes route without a key', () => {
  assert.equal(routeByTriggers('Hola, acabo de llegar a San Francisco desde Montevideo')?.id, 'arrival_kit')
  assert.equal(routeByTriggers('Acabei de chegar, me mudei para San Francisco')?.id, 'arrival_kit')
  assert.equal(routeByTriggers('hay un bache enorme frente a mi casa')?.id, 'report_311')
  assert.equal(routeByTriggers('I just got laid off today')?.id, 'layoff_kit')
})

test('arrival kit for a Puentes fellow builds the first-weeks deadlines from her profile', () => {
  const id = createCase('arrival')
  updateCase(id, { playbook: 'arrival_kit', pack: 'newcomer' })
  prefillFromProfile(id)
  setFields(id, { staying_for: 'moving', work_authorized: true, visa_waiver: false })
  const v = plan(id)
  const titles = v.deadlines.map((d: any) => `${d.due_at} ${d.title}`)
  assert.ok(titles.some((t: string) => t.startsWith('2026-10-31') && t.includes('AR-11')), titles.join('\n'))
  assert.ok(titles.some((t: string) => t.startsWith('2026-10-30') && t.includes('Social Security')), titles.join('\n'))
  assert.ok(!titles.some((t: string) => t.includes('driver license')), 'she said she will not drive')
  const ssn = v.actions.find((a: any) => a.step === 'ssn')
  assert.match(JSON.stringify(ssn.payload), /O-1/)
  assert.match(JSON.stringify(ssn.payload), /Flux Labs/)
})

test('answers are remembered so the next playbook does not ask again', () => {
  const a = createCase('first')
  updateCase(a, { playbook: 'layoff_kit', pack: 'work' })
  setFields(a, coerceAnswers('layoff_kit', { hr_email: 'hr@flux.example', has_equity: 'sí' }))
  assert.equal(getCase(a).fields.has_equity, true)
  remember('employer_name', 'Flux Labs', 'test')
  const b = createCase('second')
  updateCase(b, { playbook: 'arrival_kit', pack: 'newcomer' })
  prefillFromProfile(b)
  assert.equal(getCase(b).fields.arrival_date, '2026-10-20')
  assert.equal(getCase(b).fields.employer_name, 'Flux Labs')
  assert.equal(getProfile().memory.employer_name.value, 'Flux Labs')
})

test('no-key intake asks for missing fields, then plans after answers', async () => {
  const id = createCase('offline')
  await intake(id, { text: 'Hola, acabo de llegar a San Francisco', source: 'voice note' })
  const c = getCase(id)
  assert.equal(c.playbook, 'arrival_kit')
  assert.ok(c.questions!.some(q => q.field === 'staying_for'))
  await reply(id, { answers: { staying_for: 'moving here', work_authorized: 'yes', visa_waiver: 'no' } })
  const after = getCase(id)
  assert.equal(after.questions, null)
  assert.ok(Number((db.prepare('select count(*) n from actions where case_id = ?').get(id) as any).n) > 0)
})

test('without paid providers, approved actions hand off to the phone and still schedule follow-ups', async () => {
  const id = createCase('deposit')
  updateCase(id, { playbook: 'deposit_return', pack: 'renter' })
  prefillFromProfile(id)
  setFields(id, { move_out_date: '2026-10-24', forwarding_address: '88 Ocean Ave, Oakland' })
  const v = plan(id)
  const email = v.actions.find((a: any) => a.tool === 'send_email')
  const r: any = await executeAction(email.id)
  assert.equal(r.result.handoff, 'email')
  assert.match(r.result.url, /^mailto:landlord%40example\.com\?subject=/)
  await completeAction(email.id)
  const jobs = db.prepare(`select * from jobs where case_id = ? and kind = 'followup'`).all(id)
  assert.equal(jobs.length, 1)
  assert.equal(getCase(id).status, 'waiting_on_other_party')
})

test('civic report has counts and no personal details', () => {
  const r = civicReport()
  const text = JSON.stringify(r)
  assert.ok(r.obligations.length > 0)
  assert.ok(!text.includes('Valentina'))
  assert.ok(!text.includes('Guerrero'))
  assert.ok(r.steps_with_no_online_path.some((s: any) => s.host === 'www.uscis.gov'))
})
