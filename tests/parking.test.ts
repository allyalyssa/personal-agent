import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.HANDLED_DB = ':memory:'
const { loadRules } = await import('../server/rules.ts')
const { loadPlaybooks } = await import('../server/playbooks.ts')
const { sweepingCheck, nextSweeping, depositInterest } = await import('../server/compute.ts')
const { createCase, updateCase, setFields, plan, setProfile, prefillFromProfile, get } = await import('../server/engine.ts')
const { readFileSync } = await import('node:fs')

loadRules()
loadPlaybooks()
setProfile(JSON.parse(readFileSync('profiles/valentina.json', 'utf8')))

// Live schedule for Guerrero St, 22nd to 23rd (west side), as DataSF returned it on 2026-10-24.
const guerrero = [
  { side: 'West', when: 'Thu 1st, 3rd, 5th, 7:00-9:00', weekday: 'Thu', weeks: [1, 3, 5], from_hour: 7, to_hour: 9, holidays: false },
  { side: 'West', when: 'Thu 2nd & 4th, 7:00-9:00', weekday: 'Thu', weeks: [2, 4], from_hour: 7, to_hour: 9, holidays: false },
  { side: 'West', when: 'Mon 2nd & 4th, 7:00-9:00', weekday: 'Mon', weeks: [2, 4], from_hour: 7, to_hour: 9, holidays: false },
  { side: 'West', when: 'Mon 1st, 3rd, 5th, 7:00-9:00', weekday: 'Mon', weeks: [1, 3, 5], from_hour: 7, to_hour: 9, holidays: false }
]

test('a ticket written during the sweeping window matches', () => {
  assert.equal(sweepingCheck({ schedules: guerrero, issued_at: '2026-10-22T07:30:00.000' }).scheduled, true)
})

test('a ticket written when no sweeping is scheduled gives grounds to protest', () => {
  const r = sweepingCheck({ schedules: guerrero, issued_at: '2026-10-21T07:30:00.000' })
  assert.equal(r.contest_grounds, true)
  assert.match(r.explanation, /no sweeping/)
  assert.equal(sweepingCheck({ schedules: guerrero, issued_at: '2026-10-22T09:15:00.000' }).contest_grounds, true)
})

test('next sweep is the Monday 2nd/4th window', () => {
  const n = nextSweeping({ schedules: guerrero, from: '2026-10-24T10:00' })
  assert.equal(n.date, '2026-10-26')
  assert.equal(n.starts, '07:00')
})

test('deposit interest subtracts the Rent Board fee share for rent-controlled buildings', () => {
  const r = depositInterest({ deposit_amount: 4000, move_in_date: '2023-11-01', as_of: '2026-10-24', year_built: 1907, units: 21 })
  assert.equal(r.total_owed, 408)
  assert.equal(r.fee_deduction_max, 59)
  assert.equal(r.net_minimum, 349)
  assert.equal(depositInterest({ deposit_amount: 4000, move_in_date: '2023-11-01', as_of: '2026-10-24', year_built: 1995, units: 1 }).fee_deduction_max, 0)
})

test('fallback paths pick the first value present', () => {
  assert.equal(get({ a: null, b: { c: 'x' } }, 'a|b.c'), 'x')
})

test('parking ticket plans a protest only when City data gives grounds, with the 21-day deadline', () => {
  const citation = { found: true, issued_at: '2026-10-21T07:30:00.000', location: '1000 GUERRERO ST', fine: 105, violation: 'STR CLEAN' }
  const id = createCase('ticket')
  updateCase(id, { playbook: 'parking_ticket', pack: 'car' })
  prefillFromProfile(id)
  setFields(id, { citation_number: '2007000000', citation, sweeping: { found: true, block: 'Guerrero St, 22nd St - 23rd St', schedules: guerrero } })
  const v = plan(id)
  assert.equal(v.money_at_stake, 105)
  assert.ok(v.actions.some((a: any) => a.step === 'protest'))
  assert.equal(v.deadlines.find((d: any) => d.rule_id === 'sfmta_citation_contest').due_at, '2026-11-11')
  assert.match(v.actions.find((a: any) => a.step === 'protest').payload.fields.Reason, /Wednesday/)
})
