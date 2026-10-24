import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.HANDLED_DB = ':memory:'
const { loadRules, allRules } = await import('../server/rules.ts')
const { loadPlaybooks, allPlaybooks } = await import('../server/playbooks.ts')
const { createCase, updateCase, setFields, plan, setProfile, prefillFromProfile, missingFields, getCase, render } = await import('../server/engine.ts')
const { depositInterest, rentIncreaseCheck, tollTextCheck, compareBill, vestSchedule } = await import('../server/compute.ts')
const { redact } = await import('../server/redact.ts')
const { evalFormula } = await import('../server/clock.ts')
const { readFileSync } = await import('node:fs')

loadRules()
loadPlaybooks()
setProfile(JSON.parse(readFileSync('profiles/jordan.json', 'utf8')))

test('every rule has a source and a status', () => {
  for (const r of allRules()) {
    assert.ok(r.source_url.startsWith('https://'), r.id)
    assert.ok(['verified', 'unverified'].includes(r.status), r.id)
    assert.ok(r.confirm_with, r.id)
  }
})

test('every playbook loads and references real rules', () => {
  const ids = new Set(allRules().map(r => r.id))
  assert.ok(allPlaybooks().length >= 20)
  for (const p of allPlaybooks()) {
    for (const r of p.rules) assert.ok(ids.has(r), `${p.id} -> ${r}`)
    assert.ok(p.actions.length > 0, p.id)
    assert.ok(p.sample, p.id)
  }
})

test('deposit interest uses only verified Rent Board rates', () => {
  const r = depositInterest({ deposit_amount: 4000, move_in_date: '2023-11-01', as_of: '2026-10-24' })
  assert.deepEqual(r.years.map(y => y.rate_percent), [5.2, 5.0])
  assert.equal(r.total_owed, 408)
  assert.equal(r.next_payment.due_date, '2026-11-01')
  assert.equal(r.next_payment.interest, 168)
})

test('deposit interest refuses to guess unverified years', () => {
  const r = depositInterest({ deposit_amount: 3000, move_in_date: '2020-06-01', as_of: '2026-10-24' })
  assert.ok(r.years_needing_confirmation.length >= 3)
  assert.equal(r.years_needing_confirmation.length, 3)
  assert.equal(r.total_owed, 156 + 150 + 126)
})

test('rent increase over the limit in a pre-1979 building', () => {
  const r = rentIncreaseCheck({ current_rent: 3400, new_rent: 3600, effective_date: '2027-01-01', year_built: 1925, unit_type: 'Flats & Duplex', last_increase_date: '2023-11-01' })
  assert.equal(r.rent_control_likely, true)
  assert.equal(r.allowable_percent, 1.6)
  assert.ok(r.max_allowed_rent! < 3600)
  assert.ok(r.overcharge_per_month! > 0)
})

test('toll text from a lookalike domain is a likely scam', () => {
  assert.equal(tollTextCheck({ message_text: 'Pay now https://bayareafastrak-tolls.com/pay' }).verdict, 'likely scam')
  assert.equal(tollTextCheck({ message_text: 'See https://www.bayareafastrak.org/account' }).verdict, 'likely real')
})

test('medical bill duplicate and EOB gap', () => {
  const r = compareBill({ amount_billed: 1840, eob_patient_responsibility: 350, bill_lines: [{ description: 'ER', amount: 1200 }, { description: 'CT', date: '2026-09-12', amount: 490 }, { description: 'CT', date: '2026-09-12', amount: 490 }, { description: 'Lab', amount: 150 }] })
  assert.equal(r.duplicate_total, 490)
  assert.equal(r.billed_over_eob, 1490)
})

test('vest schedule with cliff', () => {
  const r = vestSchedule({ grant_date: '2026-02-01', total_shares: 4800, frequency_months: 3 })
  assert.equal(r.first_vest.date, '2027-02-01')
  assert.equal(r.first_vest.shares, 1200)
  assert.equal(r.total, 4800)
})

test('redaction masks SSNs, cards and account numbers but keeps phones and dates', () => {
  const out = redact('SSN 123-45-6789, card 4111 1111 1111 1111, Account #: 99887766554, call +14155550123 by 2026-11-01')
  assert.ok(!out.includes('123-45-6789'))
  assert.ok(!out.includes('4111 1111 1111 1111'))
  assert.ok(!out.includes('99887766554'))
  assert.ok(out.includes('+14155550123'))
  assert.ok(out.includes('2026-11-01'))
})

test('deadline formulas', () => {
  const f = (p: string) => ({ termination_date: '2026-10-24' } as any)[p]
  assert.equal(evalFormula('termination_date + 60 days', f), '2026-12-23')
  assert.equal(evalFormula('termination_date + 3 months', f), '2027-01-24')
  assert.equal(evalFormula('termination_date + 2 business days', f), '2026-10-27')
})

test('template helpers', () => {
  assert.equal(render('${{$ a}} on {{date d}}', { a: 408, d: '2026-11-01' }), '$408.00 on Sun, Nov 1, 2026')
  assert.equal(render('{{lines y.math}}', { y: [{ math: 'one' }, { math: 'two' }] }), '- one\n- two')
})

function newCase(playbookId: string, fields: Record<string, any>) {
  const id = createCase('test')
  updateCase(id, { playbook: playbookId, pack: 'x' })
  prefillFromProfile(id)
  setFields(id, fields)
  return id
}

test('deposit_interest plans a demand with the math in it', () => {
  const id = newCase('deposit_interest', {})
  assert.deepEqual(missingFields(getCase(id)), [])
  const v = plan(id)
  assert.equal(v.money_at_stake, 408)
  const demand = v.actions.find((a: any) => a.step === 'demand')
  assert.match(demand.payload.body, /2024-11-01: \$4,000\.00 x 5\.2% = \$208\.00/)
  assert.match(demand.payload.body, /Total owed: \$408\.00/)
  assert.ok(!JSON.stringify(demand.payload).includes('['), 'no unfilled placeholders')
})

test('layoff_kit builds six or more deadlines', () => {
  const id = newCase('layoff_kit', { termination_date: '2026-10-24', coverage_end_date: '2026-10-31', has_equity: true, equity_window_days: 90, on_work_visa: true, visa_type: 'H-1B', final_pay_received: false })
  const v = plan(id)
  const titles = v.deadlines.map((d: any) => `${d.due_at} ${d.title}`)
  assert.ok(v.deadlines.length >= 6, titles.join('\n'))
  assert.ok(titles.some((t: string) => t.startsWith('2026-12-30') && t.includes('COBRA')))
  assert.ok(titles.some((t: string) => t.startsWith('2027-01-22') && t.includes('Option exercise')))
  assert.ok(titles.some((t: string) => t.startsWith('2026-12-23') && t.includes('visa')))
  assert.ok(v.actions.some((a: any) => a.step === 'hr_email'))
  assert.ok(v.actions.some((a: any) => a.step === 'visa_attorney'))
})

test('break_in proposes a call with guardrails', () => {
  const id = newCase('break_in', { incident_date: '2026-10-23', incident_location: 'Valencia St near 20th St', damage: 'rear passenger window', items_stolen: ['gym bag'] })
  const v = plan(id)
  const call = v.actions.find((a: any) => a.tool === 'place_call')
  assert.equal(call.payload.to, '+15555550102')
  assert.ok(call.payload.must_not.some((m: string) => m.includes('$400')))
})

test('every playbook plans end to end with its sample-shaped fields filled', () => {
  for (const p of allPlaybooks()) {
    const fields: Record<string, any> = {}
    for (const [k, f] of Object.entries(p.required_fields)) {
      if (f.type === 'date') fields[k] = '2026-11-10'
      else if (f.type === 'number') fields[k] = 100
      else if (f.type === 'boolean') fields[k] = true
      else if (f.type === 'list') fields[k] = k === 'charges' ? [{ merchant: 'Netflix', amount: 22.99, date: '2026-10-03' }, { merchant: 'Netflix', amount: 22.99, date: '2026-09-03' }] : k === 'bill_lines' ? [{ description: 'Visit', amount: 100 }] : []
      else if (f.type === 'email') fields[k] = 'x@example.com'
      else if (f.type === 'phone') fields[k] = '+15555550199'
      else fields[k] = k.includes('address') ? '1000 Guerrero St' : 'test'
    }
    const id = newCase(p.id, fields)
    const v = plan(id)
    if (!p.lookups) assert.ok(v.actions.length > 0 || v.deadlines.length > 0, p.id)
  }
})
